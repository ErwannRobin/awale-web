// Lightweight assertions to confirm the engine port behaves.
// Run with:  npm test
import { owner, isValid, distribute, attacksAllSeeds, endGame } from '../src/lib/engine.ts';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; }
  else { fail++; console.error(`FAIL ${name}\n  got  ${a}\n  want ${b}`); }
}

// ownership
eq('owner 0', owner(0), 0);
eq('owner 5', owner(5), 0);
eq('owner 6', owner(6), 1);
eq('owner 11', owner(11), 1);

// basic sow: pit 0 (South) has 4 -> seeds into 1,2,3,4, no capture
{
  const pits = Array(12).fill(4);
  const scores = [0, 0];
  const r = distribute(pits, scores, 0);
  eq('sow origin empty', pits[0], 0);
  eq('sow order', r.sowed, [1, 2, 3, 4]);
  eq('sow neighbours', [pits[1], pits[2], pits[3], pits[4]], [5, 5, 5, 5]);
  eq('sow no capture', r.captured, []);
  eq('sow scores', scores, [0, 0]);
}

// capture: last seed lands making an opponent pit 2 or 3
{
  //                0  1  2  3  4  5  6  7  8  9 10 11
  const pits =    [ 0, 0, 0, 0, 0, 2, 1, 1, 1, 0, 0, 0];
  const scores = [0, 0];
  // pit 5 (South) has 2 -> sows into 6 (->2) and 7 (->2); last=7 in opp row, both 2 => capture both.
  // Pit 8 keeps its seed, so North is not starved and the capture stands.
  const r = distribute(pits, scores, 5);
  eq('capture scores South', scores[0], 4);
  eq('capture emptied 7', pits[7], 0);
  eq('capture emptied 6', pits[6], 0);
  eq('capture order last-first', r.captured, [7, 6]);
  eq('capture leaves North a seed', pits[8], 1);
}

// grand-slam prevention: a move capturing ALL opponent seeds is illegal when an alternative exists
{
  //               0  1  2  3  4  5  6  7  8  9 10 11
  const pits =   [ 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0];
  // pit 5 sows into 6 -> becomes 2, that's the only opponent seed row => grand slam.
  // pit 0 sows into 1 -> stays on own side, legal alternative exists.
  eq('grandslam detected', attacksAllSeeds(pits, 5), true);
  eq('grandslam illegal', isValid(pits, 5), false);
  eq('alt legal', isValid(pits, 0), true);
}

// feeding rule: opponent empty, must play a move reaching their row
{
  //               0  1  2  3  4  5  6  7  8  9 10 11
  const pits =   [ 1, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0];
  // opponent (6-11) all empty. pit 0 has 1 -> lands at 1, doesn't reach => illegal.
  // pit 5 has 3 -> reaches 6,7,8 => legal (feeds).
  eq('cannot starve', isValid(pits, 0), false);
  eq('must feed ok', isValid(pits, 5), true);
}

// endGame: opponent has nothing -> mover scoops own row
{
  const pits =   [ 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const scores = [0, 0];
  const ended = endGame(pits, scores, 0);
  eq('endgame opp empty ends', ended, true);
  eq('endgame own row folded', scores[0], 5);
}

// capture cap: at most 4 pits per move
{
  //               0  1  2  3  4  5  6  7  8  9 10 11
  const pits =   [ 0, 0, 0, 0, 0, 6, 1, 1, 1, 1, 1, 0];
  const scores = [0, 0];
  // pit 5 has 6 -> sows 6,7,8,9,10 (each ->2) and 11 (->1). last=11 (holds 1, no capture start).
  const r = distribute(pits, scores, 5);
  eq('cap: last no-capture stops', r.captured.length, 0);
}
{
  //               0  1  2  3  4  5  6  7  8  9 10 11
  const pits =   [ 0, 0, 0, 0, 0, 5, 1, 1, 1, 1, 1, 0];
  const scores = [0, 0];
  // pit 5 has 5 -> sows 6,7,8,9,10 each ->2. last=10, sweep back while 2/3, capped at 4.
  const r = distribute(pits, scores, 5);
  eq('cap: at most 4 pits', r.captured.length, 4);
  eq('cap: score 8', scores[0], 8);
}

// grand slam with no alternative: the move is legal, but NOTHING is captured —
// the whole capture is cancelled, not trimmed to leave one pit behind.
{
  //               0  1  2  3  4  5  6  7  8  9 10 11
  const pits =   [ 0, 0, 0, 0, 2, 1, 1, 0, 0, 0, 0, 0];
  const scores = [0, 0];
  // Both South moves sweep North's only seeds, so there is no alternative:
  eq('forced grandslam: pit 5 legal', isValid(pits, 5), true);
  eq('forced grandslam: pit 4 legal', isValid(pits, 4), true);
  // pit 5 sows into 6 -> becomes 2, which would be the whole North row.
  const r = distribute(pits, scores, 5);
  eq('forced grandslam: nothing captured', r.captured, []);
  eq('forced grandslam: no score', scores, [0, 0]);
  eq('forced grandslam: seeds stay put', pits, [0, 0, 0, 0, 2, 0, 2, 0, 0, 0, 0, 0]);
  eq('forced grandslam: game continues', r.running, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
