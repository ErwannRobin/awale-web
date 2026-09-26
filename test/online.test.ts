// Online play, without a network.
//
// The room rules are pure functions (`src/lib/roomCore.ts`), so the first half
// of this file exercises the server directly: seating, turn order, illegal
// moves, duplicate sends, resignation, walkouts, rematches.
//
// The second half wires two real `OnlineSession`s to a fake server through
// in-memory pipes and plays whole games through the actual protocol — encode,
// decode, apply, fingerprint — which is the part that would otherwise only be
// tested by two people and two phones.
import assert from 'node:assert/strict';
import {
  ABANDON_MS,
  IDLE_SWEEP_MS, MIN_ALARM_MS, REACT_GAP_MS,
  command, createRoom, disconnect, isCoherent, isJoinable, join, liveChange, liveEntry, nextAlarmAt,
  snapshot, spectate, sweep,
  type RoomState,
} from '../src/lib/roomCore.ts';
import {
  PROTOCOL_VERSION, normaliseRoomCode, parseClientMsg, parseLiveGames, parseServerMsg, stateHash,
  type ServerMsg,
} from '../src/lib/protocol.ts';
import { applyMove, legalMoves, type Seat, type Winner } from '../src/lib/rules.ts';
import { OnlineSession } from '../src/lib/online.ts';
import type { TransportFactory, TransportHandlers } from '../src/lib/transport.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL ${name}`);
    console.log(String(error));
  }
}

async function checkAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL ${name}`);
    console.log(String(error));
  }
}

const TOKEN_A = 'aaaaaaaaaaaaaaaa';
const TOKEN_B = 'bbbbbbbbbbbbbbbb';
const TOKEN_C = 'cccccccccccccccc';

/** A room with both seats taken and the game running. */
function seatedRoom(now = 1000): RoomState {
  let room = createRoom('ABCDE', now);
  room = join(room, TOKEN_A, 'Ama', now).state;
  room = join(room, TOKEN_B, 'Kofi', now).state;
  return room;
}

const errorsIn = (effects: { msg: ServerMsg }[]): string[] =>
  effects.filter(e => e.msg.t === 'err').map(e => (e.msg as { code: string }).code);

// ---------------------------------------------------------------------------
console.log('room: seating');

check('the first player waits, the second starts the game', () => {
  const now = 1000;
  let room = createRoom('ABCDE', now);
  assert.equal(room.status, 'waiting');

  const first = join(room, TOKEN_A, 'Ama', now);
  room = first.state;
  assert.equal(first.seat, 0);
  assert.equal(room.status, 'waiting');

  const second = join(room, TOKEN_B, 'Kofi', now);
  room = second.state;
  assert.equal(second.seat, 1);
  assert.equal(room.status, 'playing');
  assert.equal(room.turn, room.startSeat);
  assert.equal(room.pits.reduce((a, b) => a + b, 0), 48);
});

check('a third player is turned away, not seated', () => {
  const room = seatedRoom();
  const third = join(room, TOKEN_C, 'Nosy', 2000);
  assert.equal(third.seat, null);
  assert.equal(third.error, 'room-full');
  // And the room is untouched by the attempt.
  assert.equal(third.state.players[0]?.token, TOKEN_A);
  assert.equal(third.state.players[1]?.token, TOKEN_B);
});

check('a returning token gets its own seat back', () => {
  let room = seatedRoom();
  room = disconnect(room, TOKEN_B, 2000).state;
  assert.equal(room.players[1]?.online, false);

  const back = join(room, TOKEN_B, 'Kofi', 3000);
  assert.equal(back.seat, 1);
  assert.equal(back.error, null);
  assert.equal(back.state.players[1]?.online, true);
  assert.equal(back.state.players[1]?.offlineSince, null);
  // The room is still full for anyone else.
  assert.equal(join(back.state, TOKEN_C, 'Nosy', 3100).error, 'room-full');
});

check('a reconnect is answered with the position, not a new game', () => {
  let room = seatedRoom();
  room = command(room, TOKEN_A, { t: 'move', pit: 2, ply: 0 }, 2000).state;
  const before = snapshot(room);

  const back = join(room, TOKEN_A, 'Ama', 3000);
  const welcome = back.effects.find(e => e.msg.t === 'welcome');
  assert.ok(welcome, 'a reconnecting player is welcomed');
  const sent = (welcome!.msg as { snapshot: typeof before }).snapshot;
  assert.deepEqual(sent.pits, before.pits);
  assert.equal(sent.ply, 1);
  assert.equal(sent.turn, before.turn);
});

check('each seat carries its country, and both players see both flags', () => {
  let room = createRoom('ABCDE', 1000);
  room = join(room, TOKEN_A, 'Ama', 1000, 'CI').state;
  const second = join(room, TOKEN_B, 'Marie', 1000, 'FR');
  const sync = second.effects.find(e => e.msg.t === 'sync');
  const seen = (sync!.msg as { snapshot: ReturnType<typeof snapshot> }).snapshot;
  assert.deepEqual(seen.players.map(p => p?.country), ['CI', 'FR']);
  // A reconnect without a country keeps the one the seat already had.
  const back = join(second.state, TOKEN_A, 'Ama', 2000);
  assert.equal(back.state.players[0]?.country, 'CI');
});

check('a hello carries a real country, and drops anything else', () => {
  const hello = (country: unknown) => parseClientMsg(JSON.stringify({
    t: 'hello', v: PROTOCOL_VERSION, token: TOKEN_A, name: 'Ama', country,
  }));
  assert.equal((hello('ci') as { country?: string }).country, 'CI');
  assert.equal('country' in hello('XX')!, false);
  assert.equal('country' in hello(42)!, false);
  const peer = parseServerMsg(JSON.stringify({
    t: 'peer', seat: 1, player: { name: 'Kofi', online: true, country: 'gh' },
  }));
  assert.equal((peer as { player: { country?: string } }).player.country, 'GH');
});

// ---------------------------------------------------------------------------
console.log('room: the matchmaker\'s question');

check('an empty room is not somewhere to send a stranger', () => {
  assert.equal(isJoinable(createRoom('ABCDE', 1000)), false);
});

check('a room with one player waiting in it is', () => {
  const room = join(createRoom('ABCDE', 1000), TOKEN_A, 'Ama', 1000).state;
  assert.equal(isJoinable(room), true);
});

check('a room whose only player has walked away is not', () => {
  // The failure this exists to stop: a quick-match code outliving the player
  // who asked for it, so the next player waits for someone never coming.
  let room = join(createRoom('ABCDE', 1000), TOKEN_A, 'Ama', 1000).state;
  room = disconnect(room, TOKEN_A, 2000).state;
  assert.equal(isJoinable(room), false);
});

check('a room already playing is not', () => {
  assert.equal(isJoinable(seatedRoom()), false);
});

check('a finished room is not', () => {
  const room = command(seatedRoom(), TOKEN_A, { t: 'resign' }, 2000).state;
  assert.equal(isJoinable(room), false);
});

// ---------------------------------------------------------------------------
console.log('room: moves');

check('only the player to move may move', () => {
  const room = seatedRoom();
  const wrong = command(room, TOKEN_B, { t: 'move', pit: 8, ply: 0 }, 2000);
  assert.deepEqual(errorsIn(wrong.effects), ['not-your-turn']);
  assert.equal(wrong.state.ply, 0);
});

check('a move from the opponent\'s row is refused', () => {
  const room = seatedRoom();
  const wrong = command(room, TOKEN_A, { t: 'move', pit: 7, ply: 0 }, 2000);
  assert.deepEqual(errorsIn(wrong.effects), ['illegal-move']);
  assert.equal(wrong.state.ply, 0);
});

check('an empty pit is refused', () => {
  let room = seatedRoom();
  // Empty pit 0 by playing it, then hand the turn back and try it again.
  room = command(room, TOKEN_A, { t: 'move', pit: 0, ply: 0 }, 2000).state;
  room = command(room, TOKEN_B, { t: 'move', pit: 6, ply: 1 }, 2100).state;
  assert.equal(room.pits[0], 0);
  const wrong = command(room, TOKEN_A, { t: 'move', pit: 0, ply: 2 }, 2200);
  assert.deepEqual(errorsIn(wrong.effects), ['illegal-move']);
});

check('a pit outside the board cannot crash the room', () => {
  const room = seatedRoom();
  for (const pit of [-1, 12, 99, 1.5, Number.NaN]) {
    const step = command(room, TOKEN_A, { t: 'move', pit, ply: 0 }, 2000);
    assert.deepEqual(errorsIn(step.effects), ['illegal-move'], `pit ${pit}`);
    assert.equal(step.state.ply, 0);
  }
});

check('a double tap does not move twice', () => {
  const room = seatedRoom();
  const first = command(room, TOKEN_A, { t: 'move', pit: 2, ply: 0 }, 2000);
  assert.equal(first.state.ply, 1);

  // The turn has already passed, so the second tap is refused on that alone.
  const again = command(first.state, TOKEN_A, { t: 'move', pit: 2, ply: 0 }, 2001);
  assert.deepEqual(errorsIn(again.effects), ['not-your-turn']);
  assert.equal(again.state.ply, 1);
  assert.deepEqual(again.state.pits, first.state.pits);
});

check('a duplicate that arrives late, on your own turn, is still refused', () => {
  // The nastier case: a resend that crosses the opponent's reply and lands
  // when it *is* your turn again. Only the ply counter catches this one.
  let room = seatedRoom();
  room = command(room, TOKEN_A, { t: 'move', pit: 2, ply: 0 }, 2000).state;
  room = command(room, TOKEN_B, { t: 'move', pit: 6, ply: 1 }, 2100).state;
  assert.equal(room.turn, 0, 'back to the first player');

  const stale = command(room, TOKEN_A, { t: 'move', pit: 2, ply: 0 }, 2200);
  assert.deepEqual(errorsIn(stale.effects), ['stale-ply']);
  assert.equal(stale.state.ply, 2);
  assert.deepEqual(stale.state.pits, room.pits);
});

check('a confirmed move carries a fingerprint of the position it produced', () => {
  const room = seatedRoom();
  const step = command(room, TOKEN_A, { t: 'move', pit: 2, ply: 0 }, 2000);
  const move = step.effects.find(e => e.msg.t === 'move');
  assert.ok(move);
  const body = move!.msg as { hash: string };
  assert.equal(body.hash, stateHash(step.state.pits, step.state.scores, step.state.turn));
  // And the same move replayed on a client's own engine agrees with it.
  const local = applyMove(room.pits, room.scores, 2);
  assert.equal(stateHash(local.pits, local.scores, local.next), body.hash);
});

// ---------------------------------------------------------------------------
console.log('room: endings');

check('resigning hands the game to the other seat', () => {
  const room = seatedRoom();
  const step = command(room, TOKEN_A, { t: 'resign' }, 2000);
  assert.equal(step.state.status, 'over');
  assert.equal(step.state.winner, 1);
  assert.equal(step.state.reason, 'resign');
  const over = step.effects.find(e => e.msg.t === 'over');
  assert.ok(over);
  assert.equal(over!.to, 'all');
});

check('you cannot resign a game that is already over', () => {
  const room = command(seatedRoom(), TOKEN_A, { t: 'resign' }, 2000).state;
  const again = command(room, TOKEN_B, { t: 'resign' }, 2100);
  assert.deepEqual(errorsIn(again.effects), ['not-playing']);
  assert.equal(again.state.winner, 1);
});

check('a dropped player keeps their seat until the grace period runs out', () => {
  const room = disconnect(seatedRoom(), TOKEN_B, 2000).state;

  const early = sweep(room, 2000 + ABANDON_MS - 1);
  assert.equal(early.state.status, 'playing');
  assert.equal(early.effects.length, 0);

  const late = sweep(room, 2000 + ABANDON_MS + 1);
  assert.equal(late.state.status, 'over');
  assert.equal(late.state.winner, 0);
  assert.equal(late.state.reason, 'abandoned');
});

check('a player who comes back in time is not timed out', () => {
  let room = disconnect(seatedRoom(), TOKEN_B, 2000).state;
  room = join(room, TOKEN_B, 'Kofi', 2000 + ABANDON_MS - 1000).state;
  const later = sweep(room, 2000 + ABANDON_MS + 5000);
  assert.equal(later.state.status, 'playing');
});

check('a finished game is not swept again', () => {
  let room = command(seatedRoom(), TOKEN_A, { t: 'resign' }, 2000).state;
  room = disconnect(room, TOKEN_B, 2100).state;
  const later = sweep(room, 2100 + ABANDON_MS * 3);
  assert.equal(later.effects.length, 0);
  assert.equal(later.state.winner, 1);
});

// ---------------------------------------------------------------------------
console.log('room: alarm scheduling');

// These four guard a real incident: an alarm scheduled at a timestamp already
// in the past fires immediately, and the handler that reschedules it computes
// the same past timestamp again. One abandoned room span millions of alarms
// and storage writes in minutes.

check('a room with nobody missing wakes up only for the tidy-up pass', () => {
  const now = 5000;
  assert.equal(nextAlarmAt(seatedRoom(), now), now + IDLE_SWEEP_MS);
});

check('a dropped player sets the alarm at the end of their grace period', () => {
  const room = disconnect(seatedRoom(), TOKEN_B, 2000).state;
  assert.equal(nextAlarmAt(room, 2500), 2000 + ABANDON_MS);
});

check('an alarm is never scheduled in the past', () => {
  const room = disconnect(seatedRoom(), TOKEN_B, 2000).state;
  const late = 2000 + ABANDON_MS * 10;   // the sweep ran late, or the DO slept
  assert.equal(nextAlarmAt(room, late), late + MIN_ALARM_MS);
});

check('the alarm stops chasing a deadline once the game is over', () => {
  // The loop that was: status 'over', a player still flagged offline, and a
  // deadline permanently behind us.
  let room = disconnect(seatedRoom(), TOKEN_B, 2000).state;
  room = sweep(room, 2000 + ABANDON_MS + 1).state;
  assert.equal(room.status, 'over');
  const now = 2000 + ABANDON_MS * 4;
  assert.equal(nextAlarmAt(room, now), now + IDLE_SWEEP_MS);
});

// ---------------------------------------------------------------------------
console.log('room: rematch');

check('a rematch needs both players, and swaps who opens', () => {
  const first = seatedRoom();
  const startedFirst = first.startSeat;
  let room = command(first, TOKEN_A, { t: 'move', pit: 2, ply: 0 }, 2000).state;
  room = command(room, TOKEN_A, { t: 'resign' }, 2100).state;
  assert.equal(room.status, 'over');

  const asked = command(room, TOKEN_A, { t: 'rematch' }, 2200);
  assert.equal(asked.state.status, 'over', 'one player is not enough');
  assert.deepEqual(asked.state.rematch, [true, false]);
  const offer = asked.effects.find(e => e.msg.t === 'rematch');
  assert.ok(offer, 'the opponent is told');
  assert.equal(offer!.to, 1);

  const agreed = command(asked.state, TOKEN_B, { t: 'rematch' }, 2300);
  assert.equal(agreed.state.status, 'playing');
  assert.equal(agreed.state.ply, 0);
  assert.deepEqual(agreed.state.scores, [0, 0]);
  assert.deepEqual(agreed.state.pits, Array(12).fill(4));
  assert.notEqual(agreed.state.startSeat, startedFirst, 'the other side opens');
  assert.equal(agreed.state.turn, agreed.state.startSeat);
});

check('a rematch cannot be asked for mid-game', () => {
  const room = seatedRoom();
  const step = command(room, TOKEN_A, { t: 'rematch' }, 2000);
  assert.deepEqual(errorsIn(step.effects), ['not-playing']);
});

// ---------------------------------------------------------------------------
console.log('room: a full game');

check('two greedy players finish a legal game with all 48 seeds accounted for', () => {
  let room = seatedRoom();
  let now = 2000;
  let moves = 0;

  while (room.status === 'playing' && moves < 400) {
    const legal = legalMoves(room.pits, room.turn);
    assert.ok(legal.length > 0, 'a playing room always has a legal move');
    // Take the move that banks the most seeds; anything deterministic will do.
    let best = legal[0];
    let bestGain = -1;
    for (const pit of legal) {
      const outcome = applyMove(room.pits, room.scores, pit);
      const gain = outcome.scores[room.turn] - room.scores[room.turn];
      if (gain > bestGain) { bestGain = gain; best = pit; }
    }
    const step = command(room, room.turn === 0 ? TOKEN_A : TOKEN_B,
      { t: 'move', pit: best, ply: room.ply }, (now += 10));
    assert.deepEqual(errorsIn(step.effects), [], `move ${best} at ply ${room.ply}`);
    room = step.state;
    moves++;
    assert.ok(isCoherent(room), `position stays coherent at ply ${room.ply}`);
  }

  assert.equal(room.status, 'over', `game finished within ${moves} moves`);
  assert.notEqual(room.winner, null);
  assert.equal(
    room.pits.reduce((a, b) => a + b, 0) + room.scores[0] + room.scores[1], 48,
  );
});

// ---------------------------------------------------------------------------
console.log('protocol');

check('a malformed message is rejected rather than guessed at', () => {
  for (const raw of ['', 'null', '{}', '[]', 'not json', '{"t":"nope"}',
    '{"t":"move"}', '{"t":"move","pit":"2","ply":0}',
    '{"t":"hello","v":1,"token":"short"}']) {
    assert.equal(parseClientMsg(raw), null, raw);
  }
  assert.deepEqual(
    parseClientMsg(`{"t":"hello","v":${PROTOCOL_VERSION},"token":"${TOKEN_A}","name":"Ama"}`),
    { t: 'hello', v: PROTOCOL_VERSION, token: TOKEN_A, name: 'Ama' },
  );
});

check('a hello carries a session token when there is one, and nothing when there is not', () => {
  const hello = (extra: string) =>
    parseClientMsg(`{"t":"hello","v":${PROTOCOL_VERSION},"token":"${TOKEN_A}","name":"Ama"${extra}}`);

  // Signed out is the default, and it must not put an `auth` key on the wire.
  assert.equal('auth' in (hello('') as object), false);

  assert.deepEqual(hello(',"auth":"v1.abc.def"'), {
    t: 'hello', v: PROTOCOL_VERSION, token: TOKEN_A, name: 'Ama', auth: 'v1.abc.def',
  });

  // Nothing here can check a signature, so the only judgement it makes is
  // "short enough to be worth showing the verifier".
  assert.equal('auth' in (hello(',"auth":""') as object), false);
  assert.equal('auth' in (hello(',"auth":123') as object), false);
  assert.equal('auth' in (hello(`,"auth":"${'x'.repeat(1025)}"`) as object), false);
});

check('a server message survives a round trip', () => {
  const room = seatedRoom();
  const encoded = JSON.stringify({ t: 'welcome', seat: 0, snapshot: snapshot(room) });
  const decoded = parseServerMsg(encoded);
  assert.ok(decoded && decoded.t === 'welcome');
  assert.equal(decoded.seat, 0);
  assert.deepEqual(decoded.snapshot.pits, room.pits);
});

check('a room code is read the way a person would say it', () => {
  assert.equal(normaliseRoomCode('abcde'), 'ABCDE');
  assert.equal(normaliseRoomCode(' ab-cd e '), 'ABCDE');
  assert.equal(normaliseRoomCode('ABCD'), null, 'too short');
  assert.equal(normaliseRoomCode('ABCDEF'), null, 'too long');
  assert.equal(normaliseRoomCode('ABCD0'), null, 'zero is not in the alphabet');
  assert.equal(normaliseRoomCode('ABCDI'), null, 'nor is I');
});

// ---------------------------------------------------------------------------
console.log('room: the clock');

const MIN = 60_000;

/** A timed room, both seated at `now`, the first seat to move. */
function timedRoom(control: 'blitz' | 'rapid' | 'classic' = 'blitz', now = 1000): RoomState {
  let room = createRoom('ABCDE', now);
  room = join(room, TOKEN_A, 'Ama', now, undefined, control).state;
  room = join(room, TOKEN_B, 'Kofi', now).state;
  return room;
}

const clockOf = (effects: { msg: ServerMsg }[], t: 'move' | 'over') =>
  (effects.find(e => e.msg.t === t)?.msg as { clock?: [number, number] } | undefined)?.clock;

check('the first player to name a clock sets it; the game starts it', () => {
  const room = timedRoom('blitz');
  assert.equal(room.control, 'blitz');
  const snap = snapshot(room, 1000);
  assert.deepEqual(snap.clock, { control: 'blitz', left: [3 * MIN, 3 * MIN], running: 0 });
});

check('a later player cannot change the clock', () => {
  let room = createRoom('ABCDE', 1000);
  room = join(room, TOKEN_A, 'Ama', 1000, undefined, 'blitz').state;
  room = join(room, TOKEN_B, 'Kofi', 1000, undefined, 'classic').state;
  assert.equal(room.control, 'blitz');
});

check('an untimed room has no clock anywhere', () => {
  const room = seatedRoom();
  assert.equal(snapshot(room).clock, undefined);
  const step = command(room, TOKEN_A, { t: 'move', pit: 2, ply: 0 }, 60_000);
  assert.equal(clockOf(step.effects, 'move'), undefined);
  assert.equal(sweep(step.state, 10 * 60 * MIN).state.status, 'playing', 'no flag ever falls');
});

check('the snapshot counts the running clock down', () => {
  const room = timedRoom('blitz', 1000);
  assert.deepEqual(snapshot(room, 11_000).clock?.left, [3 * MIN - 10_000, 3 * MIN]);
});

check('a move takes the thinking time off and adds the increment', () => {
  const room = timedRoom('blitz', 1000);
  const step = command(room, TOKEN_A, { t: 'move', pit: 2, ply: 0 }, 11_000);
  // 3:00 − 0:10 + 0:02 for the mover; the other clock untouched and now running.
  assert.deepEqual(clockOf(step.effects, 'move'), [3 * MIN - 8_000, 3 * MIN]);
  assert.equal(step.state.turnStartedAt, 11_000);
  assert.deepEqual(snapshot(step.state, 16_000).clock, {
    control: 'blitz', left: [3 * MIN - 8_000, 3 * MIN - 5_000], running: 1,
  });
});

check('a move that arrives after the flag loses on time and is not played', () => {
  const room = timedRoom('blitz', 1000);
  const step = command(room, TOKEN_A, { t: 'move', pit: 2, ply: 0 }, 1000 + 3 * MIN);
  assert.equal(step.state.status, 'over');
  assert.equal(step.state.winner, 1);
  assert.equal(step.state.reason, 'timeout');
  assert.equal(step.state.ply, 0, 'the board did not move');
  assert.deepEqual(clockOf(step.effects, 'over'), [0, 3 * MIN]);
});

check('the alarm is set for the flag, and the sweep calls it', () => {
  const room = timedRoom('blitz', 1000);
  assert.equal(nextAlarmAt(room, 2000), 1000 + 3 * MIN, 'no later than the flag');
  assert.equal(sweep(room, 1000 + 3 * MIN - 1).state.status, 'playing', 'not a moment early');
  const flagged = sweep(room, 1000 + 3 * MIN);
  assert.equal(flagged.state.winner, 1);
  assert.equal(flagged.state.reason, 'timeout');
  assert.equal(flagged.state.turnStartedAt, null, 'the clocks stop');
  assert.ok(isCoherent(flagged.state));
});

check('resigning stops the clocks where they stand', () => {
  const room = timedRoom('rapid', 1000);
  const step = command(room, TOKEN_A, { t: 'resign' }, 31_000);
  assert.deepEqual(clockOf(step.effects, 'over'), [5 * MIN - 30_000, 5 * MIN]);
  assert.equal(snapshot(step.state, 99_000).clock?.running, null);
});

check('a rematch starts both clocks from full', () => {
  let room = timedRoom('blitz', 1000);
  room = command(room, TOKEN_A, { t: 'resign' }, 61_000).state;
  room = command(room, TOKEN_A, { t: 'rematch' }, 62_000).state;
  room = command(room, TOKEN_B, { t: 'rematch' }, 63_000).state;
  assert.equal(room.status, 'playing');
  assert.deepEqual(snapshot(room, 63_000).clock?.left, [3 * MIN, 3 * MIN]);
  assert.equal(room.turnStartedAt, 63_000);
});

check('a room stored before clocks existed still plays, untimed', () => {
  const legacy = seatedRoom() as Partial<RoomState>;
  delete legacy.control;
  delete legacy.left;
  delete legacy.turnStartedAt;
  const step = command(legacy as RoomState, TOKEN_A, { t: 'move', pit: 2, ply: 0 }, 2000);
  assert.equal(step.state.ply, 1);
  assert.equal(snapshot(step.state).clock, undefined);
});

check('only a known clock is accepted from the wire', () => {
  const ok = parseClientMsg(JSON.stringify({ t: 'hello', v: 1, token: TOKEN_A, name: 'A', tc: 'rapid' }));
  assert.equal(ok?.t === 'hello' && ok.tc, 'rapid');
  const bad = parseClientMsg(JSON.stringify({ t: 'hello', v: 1, token: TOKEN_A, name: 'A', tc: 'forever' }));
  assert.equal(bad?.t === 'hello' && bad.tc, undefined);
  const move = parseServerMsg(JSON.stringify({ t: 'move', pit: 2, by: 0, ply: 1, hash: 'x', clock: [1, -5] }));
  assert.equal(move?.t === 'move' && move.clock, undefined, 'a negative clock is dropped');
});

// ---------------------------------------------------------------------------
console.log('room: reactions');

const reactionsIn = (effects: { to: unknown; msg: ServerMsg }[]) =>
  effects.filter(e => e.msg.t === 'react').map(e => ({ to: e.to, ...(e.msg as { by: number; e: number }) }));

check('a reaction goes to everyone at the board, from its seat', () => {
  const step = command(seatedRoom(), TOKEN_B, { t: 'react', e: 4 }, 5000);
  assert.deepEqual(reactionsIn(step.effects), [{ to: 'all', t: 'react', by: 1, e: 4 }]);
});

check('reacting too fast is dropped, not echoed', () => {
  const room = command(seatedRoom(), TOKEN_A, { t: 'react', e: 0 }, 5000).state;
  const again = command(room, TOKEN_A, { t: 'react', e: 1 }, 5000 + REACT_GAP_MS - 1);
  assert.deepEqual(reactionsIn(again.effects), []);
  assert.deepEqual(errorsIn(again.effects), [], 'and without an error to answer');
  const later = command(room, TOKEN_A, { t: 'react', e: 1 }, 5000 + REACT_GAP_MS);
  assert.equal(reactionsIn(later.effects).length, 1);
});

check('each seat has its own allowance', () => {
  const room = command(seatedRoom(), TOKEN_A, { t: 'react', e: 0 }, 5000).state;
  assert.equal(reactionsIn(command(room, TOKEN_B, { t: 'react', e: 5 }, 5001).effects).length, 1);
});

check('a handshake after the game is allowed; an empty waiting room is not', () => {
  const over = command(seatedRoom(), TOKEN_A, { t: 'resign' }, 2000).state;
  assert.equal(reactionsIn(command(over, TOKEN_B, { t: 'react', e: 5 }, 3000).effects).length, 1);
  const waiting = join(createRoom('ABCDE', 1000), TOKEN_A, 'Ama', 1000).state;
  assert.equal(reactionsIn(command(waiting, TOKEN_A, { t: 'react', e: 0 }, 3000).effects).length, 0);
});

check('only the fixed set travels', () => {
  for (const e of [-1, 6, 1.5, '0', null]) {
    assert.equal(parseClientMsg(JSON.stringify({ t: 'react', e })), null, `e = ${String(e)}`);
  }
  assert.deepEqual(parseClientMsg(JSON.stringify({ t: 'react', e: 2 })), { t: 'react', e: 2 });
  assert.equal(parseServerMsg(JSON.stringify({ t: 'react', by: 2, e: 0 })), null, 'no such seat');
});

// ---------------------------------------------------------------------------
console.log('room: spectators and the live list');

check('a spectator is shown the room as it stands', () => {
  const room = command(seatedRoom(), TOKEN_A, { t: 'move', pit: 2, ply: 0 }, 2000).state;
  const msg = spectate(room, 2000);
  assert.equal(msg.t, 'watching');
  assert.deepEqual((msg as { snapshot: { pits: number[] } }).snapshot.pits, room.pits);
});

check('spectators who came early are told when the game starts', () => {
  const first = join(createRoom('ABCDE', 1000), TOKEN_A, 'Ama', 1000).state;
  const second = join(first, TOKEN_B, 'Kofi', 1100);
  const toWatchers = second.effects.filter(e => e.to === 'watchers');
  assert.equal(toWatchers.length, 1);
  assert.equal((toWatchers[0].msg as { snapshot: { status: string } }).snapshot.status, 'playing');
});

check('a quick-match game is listed; a friend game is not', () => {
  let open = createRoom('ABCDE', 1000);
  open = join(open, TOKEN_A, 'Ama', 1000, 'CI', 'blitz', true).state;
  open = join(open, TOKEN_B, 'Kofi', 1200, 'GH', undefined, true).state;
  assert.deepEqual(liveEntry(open), {
    room: 'ABCDE',
    players: [{ name: 'Ama', online: true, country: 'CI' }, { name: 'Kofi', online: true, country: 'GH' }],
    control: 'blitz',
    startedAt: 1200,
  });
  assert.equal(liveEntry(seatedRoom()), null, 'nobody asked for a friend game to be listed');
});

check('only the first player decides whether a room is listed', () => {
  let room = join(createRoom('ABCDE', 1000), TOKEN_A, 'Ama', 1000).state;
  room = join(room, TOKEN_B, 'Kofi', 1000, undefined, undefined, true).state;
  assert.equal(liveEntry(room), null, 'a joiner cannot put a friend game on show');
});

check('the live list hears a game start, end, and start again', () => {
  let waiting = createRoom('ABCDE', 1000);
  waiting = join(waiting, TOKEN_A, 'Ama', 1000, undefined, undefined, true).state;
  const playing = join(waiting, TOKEN_B, 'Kofi', 1000, undefined, undefined, true).state;
  assert.equal(liveChange(waiting, playing), 'start');
  const moved = command(playing, TOKEN_A, { t: 'move', pit: 2, ply: 0 }, 2000).state;
  assert.equal(liveChange(playing, moved), null, 'a move changes nothing on the list');
  const over = command(moved, TOKEN_A, { t: 'resign' }, 3000).state;
  assert.equal(liveChange(moved, over), 'end');
  let again = command(over, TOKEN_A, { t: 'rematch' }, 4000).state;
  again = command(again, TOKEN_B, { t: 'rematch' }, 4000).state;
  assert.equal(liveChange(over, again), 'start', 'a rematch is a new game on the list');
});

check('the list survives a bad row', () => {
  const rows = parseLiveGames([
    { room: 'abcde', players: [{ name: 'A' }, { name: 'B' }], control: 'rapid', startedAt: 5 },
    { room: 'nope', players: [{ name: 'A' }, { name: 'B' }] },
    { room: 'FGHJK', players: [{ name: 'A' }] },
    'junk',
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].room, 'ABCDE');
});

// ---------------------------------------------------------------------------
// Two real sessions, talking to a fake server through in-memory pipes.
// ---------------------------------------------------------------------------

/** A server that speaks the wire protocol but lives in this process. */
class FakeServer {
  state: RoomState;
  now = 1000;
  private sockets: { token: string; seat: Seat | null; watch?: boolean; handlers: TransportHandlers }[] = [];
  private queue: (() => void)[] = [];
  /** Set to corrupt the next `move` fingerprint, to prove desync is noticed. */
  corruptNextHash = false;

  constructor(code = 'ABCDE') {
    this.state = createRoom(code, this.now);
  }

  /** A transport that reaches this server. Delivery is always asynchronous. */
  connect(): TransportFactory {
    return handlers => {
      const socket = { token: '', seat: null as Seat | null, handlers };
      this.sockets.push(socket);
      this.queue.push(() => handlers.status('open'));
      return {
        get status() { return 'open' as const; },
        send: (data: string) => { this.queue.push(() => this.receive(socket, data)); },
        close: () => {
          this.sockets = this.sockets.filter(s => s !== socket);
          if (socket.token) {
            const step = disconnect(this.state, socket.token, this.now);
            this.state = step.state;
            this.emit(step.effects);
          }
          this.queue.push(() => handlers.status('closed'));
        },
      };
    };
  }

  private receive(
    socket: { token: string; seat: Seat | null; watch?: boolean; handlers: TransportHandlers },
    data: string,
  ): void {
    const msg = parseClientMsg(data);
    if (!msg) return;
    if (msg.t === 'hello' && msg.watch) {
      socket.watch = true;
      this.send(socket, spectate(this.state, this.now));
      return;
    }
    if (socket.watch) return;
    if (msg.t === 'hello') {
      const result = join(this.state, msg.token, msg.name, this.now, msg.country, msg.tc);
      if (result.error) {
        this.send(socket, { t: 'err', code: result.error });
        return;
      }
      socket.token = msg.token;
      socket.seat = result.seat;
      this.state = result.state;
      this.emit(result.effects);
      return;
    }
    if (!socket.token) return;
    const step = command(this.state, socket.token, msg, this.now);
    this.state = step.state;
    this.emit(step.effects);
  }

  private emit(effects: { to: 'all' | Seat | 'watchers'; msg: ServerMsg }[]): void {
    for (const effect of effects) {
      let msg = effect.msg;
      if (msg.t === 'move' && this.corruptNextHash) {
        this.corruptNextHash = false;
        msg = { ...msg, hash: 'wrong' };
      }
      for (const socket of this.sockets) {
        if (effect.to === 'watchers' ? !socket.watch : effect.to !== 'all' && socket.seat !== effect.to) continue;
        this.send(socket, msg);
      }
    }
  }

  private send(
    socket: { handlers: TransportHandlers },
    msg: ServerMsg,
  ): void {
    const body = JSON.stringify(msg);
    this.queue.push(() => socket.handlers.message(body));
  }

  /** The alarm: let time-driven rules (the flag, a walkout) act at `now`. */
  sweepAt(now: number): void {
    this.now = now;
    const step = sweep(this.state, now);
    this.state = step.state;
    this.emit(step.effects);
  }

  /** Runs everything in flight, including replies to replies. */
  async settle(): Promise<void> {
    for (let guard = 0; guard < 5000 && this.queue.length > 0; guard++) {
      this.queue.shift()!();
      await Promise.resolve();
    }
    assert.equal(this.queue.length, 0, 'the server settled');
  }
}

/** A player: a real session, plus the board `useGame` would be animating. */
class TestClient {
  session: OnlineSession;
  seat: Seat | null = null;
  pits: number[] = [];
  scores: number[] = [0, 0];
  turn: Seat = 0;
  status: string = 'waiting';
  over: { winner: Winner; reason: string } | null = null;
  desyncs = 0;
  resets = 0;
  /** Every error the session reported, in order. It clears itself on repair. */
  errors: string[] = [];
  /** Reactions heard, as [seat, index]. */
  reactions: [number, number][] = [];

  constructor(
    server: FakeServer, token: string, name: string, control?: 'blitz' | 'rapid' | 'classic', watch = false,
  ) {
    this.session = new OnlineSession({
      factory: server.connect(),
      token,
      name,
      control,
      watch,
      callbacks: {
        reset: snap => {
          this.resets++;
          this.seat = this.session.current.seat;
          this.pits = [...snap.pits];
          this.scores = [...snap.scores];
          this.turn = snap.turn;
          this.status = snap.status;
          this.over = snap.winner !== null
            ? { winner: snap.winner, reason: snap.reason ?? '?' }
            : null;
        },
        move: (pit, _by, ply, hash) => {
          // Exactly what the real game does: replay the move on the local
          // engine, then check the position against the server's fingerprint.
          const outcome = applyMove(this.pits, this.scores, pit);
          this.pits = outcome.pits;
          this.scores = outcome.scores;
          this.turn = outcome.end ? this.turn : outcome.next;
          if (!this.session.checkHash(hash, this.pits, this.scores, this.turn)) {
            this.desyncs++;
            return;
          }
          this.session.confirmMove(ply, this.pits, this.scores, this.turn);
        },
        over: (winner, reason) => {
          this.status = 'over';
          this.over = { winner, reason };
        },
        react: (by, e) => { this.reactions.push([by, e]); },
        change: () => {
          this.seat = this.session.current.seat;
          const error = this.session.current.error;
          if (error && this.errors[this.errors.length - 1] !== error) {
            this.errors.push(error);
          }
        },
      },
    });
  }

  get myTurn(): boolean {
    return this.status === 'playing' && this.seat !== null && this.turn === this.seat;
  }

  playFirstLegal(): number {
    const legal = legalMoves(this.pits, this.turn);
    assert.ok(legal.length > 0, 'something to play');
    this.session.sendMove(legal[0]);
    return legal[0];
  }
}

console.log('session: two players over the wire');

await checkAsync('both players are seated and told the same position', async () => {
  const server = new FakeServer();
  const ama = new TestClient(server, TOKEN_A, 'Ama');
  const kofi = new TestClient(server, TOKEN_B, 'Kofi');
  await server.settle();

  assert.equal(ama.seat, 0);
  assert.equal(kofi.seat, 1);
  assert.equal(ama.status, 'playing');
  assert.equal(kofi.status, 'playing');
  assert.deepEqual(ama.pits, kofi.pits);
  assert.equal(ama.session.current.connection, 'online');

  ama.session.close();
  kofi.session.close();
  await server.settle();
});

await checkAsync('a whole game is played move by move and both boards agree', async () => {
  const server = new FakeServer();
  const ama = new TestClient(server, TOKEN_A, 'Ama');
  const kofi = new TestClient(server, TOKEN_B, 'Kofi');
  await server.settle();

  let moves = 0;
  while (ama.status === 'playing' && moves < 400) {
    const mover = ama.myTurn ? ama : kofi;
    assert.ok(mover.myTurn, 'exactly one side is to move');
    mover.playFirstLegal();
    await server.settle();
    moves++;

    assert.deepEqual(ama.pits, kofi.pits, `boards agree at move ${moves}`);
    assert.deepEqual(ama.scores, kofi.scores, `scores agree at move ${moves}`);
    assert.deepEqual(ama.pits, server.state.pits, `client matches server at move ${moves}`);
    assert.equal(ama.desyncs, 0);
  }

  assert.equal(ama.status, 'over', `the game ended (after ${moves} moves)`);
  assert.deepEqual(ama.over, kofi.over, 'both are told the same result');
  assert.equal(server.state.status, 'over');

  ama.session.close();
  kofi.session.close();
  await server.settle();
});

await checkAsync('a move sent out of turn changes nothing', async () => {
  const server = new FakeServer();
  const ama = new TestClient(server, TOKEN_A, 'Ama');
  const kofi = new TestClient(server, TOKEN_B, 'Kofi');
  await server.settle();

  const waiter = ama.myTurn ? kofi : ama;
  const before = [...waiter.pits];
  waiter.session.sendMove(legalMoves(waiter.pits, waiter.seat!)[0]);
  await server.settle();

  assert.deepEqual(waiter.pits, before);
  assert.equal(server.state.ply, 0);
  // The refusal was seen, and then answered: a rejected move leaves the board
  // waiting for a confirmation that never comes, so the session resyncs and
  // the error clears itself once the position is back.
  assert.deepEqual(waiter.errors, ['not-your-turn']);
  assert.equal(waiter.session.current.error, null, 'repaired, not left broken');
  assert.deepEqual(waiter.pits, server.state.pits);

  ama.session.close();
  kofi.session.close();
  await server.settle();
});

await checkAsync('a wrong fingerprint is caught and answered with a resync', async () => {
  const server = new FakeServer();
  const ama = new TestClient(server, TOKEN_A, 'Ama');
  const kofi = new TestClient(server, TOKEN_B, 'Kofi');
  await server.settle();

  server.corruptNextHash = true;
  const mover = ama.myTurn ? ama : kofi;
  mover.playFirstLegal();
  await server.settle();

  // Someone noticed, said so, and was put back on the server's position.
  assert.ok(ama.desyncs + kofi.desyncs > 0, 'the drift was noticed');
  assert.deepEqual(ama.pits, server.state.pits, 'and repaired from the server');
  assert.deepEqual(kofi.pits, server.state.pits);

  ama.session.close();
  kofi.session.close();
  await server.settle();
});

await checkAsync('a reconnecting player is put back on the live position', async () => {
  const server = new FakeServer();
  const ama = new TestClient(server, TOKEN_A, 'Ama');
  let kofi = new TestClient(server, TOKEN_B, 'Kofi');
  await server.settle();

  const mover = ama.myTurn ? ama : kofi;
  mover.playFirstLegal();
  await server.settle();
  const position = [...ama.pits];

  kofi.session.close();
  await server.settle();

  kofi = new TestClient(server, TOKEN_B, 'Kofi');
  await server.settle();

  assert.equal(kofi.seat, 1, 'the same seat');
  assert.deepEqual(kofi.pits, position, 'the same board');
  assert.equal(kofi.status, 'playing');

  ama.session.close();
  kofi.session.close();
  await server.settle();
});

await checkAsync('resigning ends the game for both sides at once', async () => {
  const server = new FakeServer();
  const ama = new TestClient(server, TOKEN_A, 'Ama');
  const kofi = new TestClient(server, TOKEN_B, 'Kofi');
  await server.settle();

  ama.session.resign();
  await server.settle();

  assert.equal(ama.over?.winner, 1);
  assert.equal(kofi.over?.winner, 1);
  assert.equal(ama.over?.reason, 'resign');
  assert.equal(kofi.status, 'over');

  ama.session.close();
  kofi.session.close();
  await server.settle();
});

await checkAsync('a rematch restarts both boards with the other side opening', async () => {
  const server = new FakeServer();
  const ama = new TestClient(server, TOKEN_A, 'Ama');
  const kofi = new TestClient(server, TOKEN_B, 'Kofi');
  await server.settle();
  const firstOpener = server.state.startSeat;

  ama.session.resign();
  await server.settle();

  ama.session.rematch();
  await server.settle();
  assert.equal(kofi.session.current.rematchOffered, true, 'the offer reached them');
  assert.equal(ama.session.current.rematchSent, true);
  assert.equal(kofi.status, 'over', 'and nothing restarts on one vote');

  kofi.session.rematch();
  await server.settle();

  assert.equal(ama.status, 'playing');
  assert.equal(kofi.status, 'playing');
  assert.deepEqual(ama.pits, Array(12).fill(4));
  assert.deepEqual(ama.scores, [0, 0]);
  assert.notEqual(server.state.startSeat, firstOpener);
  assert.equal(ama.turn, server.state.startSeat);

  ama.session.close();
  kofi.session.close();
  await server.settle();
});

await checkAsync('a timed game hands the clock over with every move', async () => {
  const server = new FakeServer();
  const ama = new TestClient(server, TOKEN_A, 'Ama', 'blitz');
  const kofi = new TestClient(server, TOKEN_B, 'Kofi');
  await server.settle();

  const clock = () => kofi.session.current.snapshot?.clock;
  assert.equal(clock()?.control, 'blitz', 'the joiner plays at the creator\'s clock');
  const opener = server.state.turn;
  assert.equal(clock()?.running, opener);

  server.now += 7_000;
  (opener === 0 ? ama : kofi).playFirstLegal();
  await server.settle();

  assert.equal(clock()?.running, opener === 0 ? 1 : 0, 'the other clock runs now');
  assert.equal(clock()?.left[opener], 3 * MIN - 7_000 + 2_000);

  // Then the side to move lets the flag fall.
  server.sweepAt(server.now + 3 * MIN);
  await server.settle();
  assert.equal(ama.over?.reason, 'timeout');
  assert.equal(kofi.session.current.snapshot?.clock?.running, null, 'both clocks stopped');

  ama.session.close();
  kofi.session.close();
  await server.settle();
});

await checkAsync('a reaction reaches both players, sender included', async () => {
  const server = new FakeServer();
  const ama = new TestClient(server, TOKEN_A, 'Ama');
  const kofi = new TestClient(server, TOKEN_B, 'Kofi');
  await server.settle();

  kofi.session.react(1);
  await server.settle();
  assert.deepEqual(ama.reactions, [[1, 1]]);
  assert.deepEqual(kofi.reactions, [[1, 1]], 'the sender sees their own bubble too');

  ama.session.close();
  kofi.session.close();
  await server.settle();
});

await checkAsync('a spectator follows the game move by move, and cannot play', async () => {
  const server = new FakeServer();
  const ama = new TestClient(server, TOKEN_A, 'Ama');
  const kofi = new TestClient(server, TOKEN_B, 'Kofi');
  const fan = new TestClient(server, TOKEN_C, 'Fan', undefined, true);
  await server.settle();

  assert.equal(fan.session.current.watching, true);
  assert.equal(fan.session.current.connection, 'online');
  assert.equal(fan.seat, null, 'no seat for a spectator');
  assert.deepEqual(fan.session.current.snapshot?.players.map(p => p?.name), ['Ama', 'Kofi']);

  for (let i = 0; i < 6 && ama.status === 'playing'; i++) {
    (ama.myTurn ? ama : kofi).playFirstLegal();
    await server.settle();
    assert.deepEqual(fan.pits, server.state.pits, `the spectator's board after move ${i + 1}`);
    assert.equal(fan.desyncs, 0);
  }

  // A move from the spectator's socket goes nowhere.
  const before = server.state.ply;
  fan.session.sendMove(legalMoves(server.state.pits, server.state.turn)[0]);
  await server.settle();
  assert.equal(server.state.ply, before);

  ama.session.resign();
  await server.settle();
  assert.equal(fan.over?.reason, 'resign', 'and it hears how the game ended');

  for (const c of [ama, kofi, fan]) c.session.close();
  await server.settle();
});

console.log('');
if (failures.length > 0) {
  console.log(`${passed} passed, ${failures.length} failed`);
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
