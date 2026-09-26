// The match server, for a laptop.
//
// Same rooms, same rules, same protocol as the Cloudflare deployment — this is
// a second adapter around `src/lib/roomCore.ts`, not a second implementation.
// It exists so `npm run dev` has something to talk to, and so the Playwright
// suite can play a real two-browser game in CI without a cloud account.
//
// State lives in a Map and dies with the process. That is fine here and would
// not be in production, which is the difference between this file and the
// Durable Object next door.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ABANDON_MS,
  command, createRoom, disconnect, isExpired, isJoinable, join, liveChange, liveEntry,
  seatOf, spectate, sweep,
  type Effect, type RoomState,
} from '../src/lib/roomCore.ts';
import {
  PROTOCOL_VERSION, isTimeControl, makeRoomCode, normaliseRoomCode, parseClientMsg,
  type LiveGame, type ServerMsg, type TimeControlId,
} from '../src/lib/protocol.ts';
import {
  addCountryGame, addHeadToHead, addPvpMatch, rankCountries, rankNations, rivalryKey,
  sanitiseLevel, sanitiseOutcome, type CountryTally, type HeadToHead,
} from '../src/lib/countryStats.ts';
import { normaliseCountry, UNKNOWN_COUNTRY } from '../src/lib/country.ts';
import type { Seat } from '../src/lib/rules.ts';

const PORT = Number(process.env.PORT ?? 8787);
const WAIT_TTL_MS = 120_000;
// Often enough that a flag falls within a second of the clock reaching zero —
// the Durable Object gets an alarm set for the exact moment instead.
const SWEEP_EVERY_MS = 1_000;

interface Conn {
  ws: WebSocket;
  token: string;
  seat: Seat | null;
  /** A spectator: no seat, counted in the audience. */
  watch?: boolean;
}

/** The public list of live games — the Worker's `Live` object, in a Map. */
const live = new Map<string, LiveGame>();

function tellLive(before: RoomState, after: RoomState): void {
  const change = liveChange(before, after);
  if (change === 'start') {
    const entry = liveEntry(after);
    if (entry) live.set(entry.room, entry);
  } else if (change === 'end') {
    live.delete(after.code);
  }
}

function announceAudience(code: string): void {
  const n = [...connsOf(code)].filter(c => c.watch).length;
  dispatch(code, [{ to: 'all', msg: { t: 'audience', n } }]);
}

/**
 * The world table, for a laptop. Same shape as the Durable Object's, same pure
 * fold, and just as forgetful as the rooms around it — it dies with the process.
 *
 * There is no edge here to say which country a request came from, so `/geo`
 * answers with `DEV_COUNTRY` if you set one and "unknown" otherwise. That is
 * the honest answer for a machine talking to itself, and it exercises the same
 * path a real player behind Tor takes.
 */
const DEV_COUNTRY = normaliseCountry(process.env.DEV_COUNTRY ?? UNKNOWN_COUNTRY);
let countries: Record<string, CountryTally> = {};
let gamesCounted = 0;
let pvpCounted = 0;
let countedAt = 0;
const rivalries = new Map<string, HeadToHead>();

/**
 * Online games, counted for the nations ranking.
 *
 * The one place this file is deliberately looser than production: there are
 * no accounts here, so no game is "rated", and counting only rated games would
 * leave the nations screen empty forever on a laptop. Every finished game
 * counts instead, so the screens and the Playwright suite have something real
 * to show.
 */
function countOnlineGame(room: RoomState): void {
  const [p0, p1] = room.players;
  if (!p0 || !p1 || room.winner === null) return;
  const winner = room.winner === 'draw' ? 'draw' : room.winner === 0 ? 'a' : 'b';
  countries = addPvpMatch(countries, p0.country, p1.country, winner);
  const pair = rivalryKey(p0.country, p1.country);
  if (pair) {
    const next = addHeadToHead(rivalries.get(pair), p0.country, p1.country, winner);
    if (next) rivalries.set(pair, next);
  }
  pvpCounted++;
  countedAt = Date.now();
}

const rooms = new Map<string, RoomState>();
const conns = new Map<string, Set<Conn>>();
/** One waiting code per time control, like the Worker's one lobby per control. */
const waiting = new Map<TimeControlId, { code: string; at: number }>();

const roomOf = (code: string): RoomState => {
  const existing = rooms.get(code);
  if (existing) return existing;
  const fresh = createRoom(code, Date.now());
  rooms.set(code, fresh);
  return fresh;
};

const connsOf = (code: string): Set<Conn> => {
  const existing = conns.get(code);
  if (existing) return existing;
  const fresh = new Set<Conn>();
  conns.set(code, fresh);
  return fresh;
};

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function dispatch(code: string, effects: Effect[]): void {
  for (const effect of effects) {
    for (const conn of connsOf(code)) {
      if (effect.to === 'watchers' ? !conn.watch : effect.to !== 'all' && conn.seat !== effect.to) continue;
      send(conn.ws, effect.msg);
    }
  }
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

function http(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors).end();
    return;
  }
  if (url.pathname === '/health') {
    response.writeHead(200, { ...cors, 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (url.pathname === '/live') {
    const games = [...live.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 30);
    response.writeHead(200, { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify(games));
    return;
  }
  if (url.pathname === '/geo') {
    response.writeHead(200, { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify({ country: DEV_COUNTRY }));
    return;
  }
  if (url.pathname === '/stats/countries') {
    response.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({
      total: gamesCounted,
      pvpTotal: pvpCounted,
      updatedAt: countedAt,
      countries: rankCountries(countries),
      rivalries: [...rivalries.values()],
    }));
    return;
  }
  if (url.pathname === '/stats/nations') {
    response.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({
      // No accounts here, so no people half: players and ratings stay at zero.
      nations: rankNations(rankCountries(countries), []),
      rivalries: [...rivalries.values()],
      pvpTotal: pvpCounted,
      updatedAt: countedAt,
    }));
    return;
  }
  if (url.pathname === '/stats/rivalry') {
    const pair = rivalryKey(url.searchParams.get('a'), url.searchParams.get('b'));
    response.writeHead(200, { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify(pair ? rivalries.get(pair) ?? null : null));
    return;
  }
  if (url.pathname === '/stats/game' && request.method === 'POST') {
    readJson(request, body => {
      const claimed = normaliseCountry(body.country);
      const country = claimed === UNKNOWN_COUNTRY ? DEV_COUNTRY : claimed;
      const level = sanitiseLevel(Number(body.level));
      const outcome = sanitiseOutcome(body.outcome);
      if (body.world === false) {
        response.writeHead(200, { ...cors, 'content-type': 'application/json' })
          .end(JSON.stringify({ ok: true, country, level, outcome }));
        return;
      }
      countries = addCountryGame(countries, country, level, outcome);
      gamesCounted++;
      countedAt = Date.now();
      response.writeHead(200, { ...cors, 'content-type': 'application/json' })
        .end(JSON.stringify({ ok: true, country, level, outcome }));
    }, () => {
      response.writeHead(400, cors).end('bad json');
    });
    return;
  }
  if (url.pathname === '/queue' && request.method === 'POST') {
    const now = Date.now();
    const asked = url.searchParams.get('tc');
    const tc: TimeControlId = isTimeControl(asked) ? asked : 'none';
    let body: { code: string; role: 'created' | 'joined' };
    // A waiting code is only worth handing out if somebody is still sitting in
    // it. See the same check, against the Room object, in `src/index.ts`.
    const held = waiting.get(tc);
    const fresh = held && now - held.at < WAIT_TTL_MS ? held : null;
    const room = fresh ? rooms.get(fresh.code) : undefined;
    if (fresh && room && isJoinable(room)) {
      body = { code: fresh.code, role: 'joined' };
      waiting.delete(tc);
    } else {
      const code = makeRoomCode();
      waiting.set(tc, { code, at: now });
      body = { code, role: 'created' };
    }
    response.writeHead(200, { ...cors, 'content-type': 'application/json' })
      .end(JSON.stringify(body));
    return;
  }
  response.writeHead(404, cors).end('not found');
}

/** Body in, parsed object out — a request body is a stream in Node, not a promise. */
function readJson(
  request: IncomingMessage,
  ok: (body: Record<string, unknown>) => void,
  bad: () => void,
): void {
  let raw = '';
  request.on('data', chunk => { raw += chunk; if (raw.length > 4096) request.destroy(); });
  request.on('end', () => {
    try {
      const parsed = JSON.parse(raw || '{}') as unknown;
      if (!parsed || typeof parsed !== 'object') { bad(); return; }
      ok(parsed as Record<string, unknown>);
    } catch {
      bad();
    }
  });
  request.on('error', bad);
}

const server = createServer(http);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const match = /^\/room\/([^/]+)$/.exec(url.pathname);
  const code = match ? normaliseRoomCode(decodeURIComponent(match[1])) : null;
  if (!code) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, ws => attach(code, ws));
});

function attach(code: string, ws: WebSocket): void {
  const conn: Conn = { ws, token: '', seat: null };
  connsOf(code).add(conn);

  ws.on('message', raw => {
    const msg = parseClientMsg(String(raw));
    if (!msg) {
      send(ws, { t: 'err', code: 'bad-message' });
      return;
    }
    const now = Date.now();
    const room = roomOf(code);

    if (msg.t === 'hello') {
      if (msg.v !== PROTOCOL_VERSION) {
        send(ws, { t: 'err', code: 'bad-version' });
        ws.close();
        return;
      }
      if (msg.watch) {
        conn.watch = true;
        send(ws, spectate(room, now));
        announceAudience(code);
        return;
      }
      const result = join(room, msg.token, msg.name, now, msg.country, msg.tc, msg.listed);
      if (result.error) {
        send(ws, { t: 'err', code: result.error });
        ws.close();
        return;
      }
      conn.token = msg.token;
      conn.seat = result.seat;
      rooms.set(code, result.state);
      dispatch(code, result.effects);
      const n = [...connsOf(code)].filter(c => c.watch).length;
      if (n > 0) send(ws, { t: 'audience', n });
      tellLive(room, result.state);
      return;
    }

    if (conn.watch) {
      if (msg.t === 'ping') send(ws, { t: 'pong' });
      return;
    }
    if (!conn.token || seatOf(room, conn.token) === null) {
      send(ws, { t: 'err', code: 'not-seated' });
      return;
    }
    const step = command(room, conn.token, msg, now);
    rooms.set(code, step.state);
    if (room.status === 'playing' && step.state.status === 'over') countOnlineGame(step.state);
    dispatch(code, step.effects);
    tellLive(room, step.state);
  });

  ws.on('close', () => {
    connsOf(code).delete(conn);
    if (conn.watch) { announceAudience(code); return; }
    if (!conn.token) return;
    // Another tab on the same token means the player has not actually left.
    for (const other of connsOf(code)) if (other.token === conn.token) return;
    const step = disconnect(roomOf(code), conn.token, Date.now());
    rooms.set(code, step.state);
    dispatch(code, step.effects);
  });

  ws.on('error', () => { /* close fires next and does the cleanup */ });
}

// The Durable Object uses a storage alarm for this; here a plain interval is
// the same idea with less machinery.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const step = sweep(room, now);
    if (step.effects.length > 0) {
      if (room.status === 'playing' && step.state.status === 'over') countOnlineGame(step.state);
      rooms.set(code, step.state);
      dispatch(code, step.effects);
      tellLive(room, step.state);
    }
    if (isExpired(step.state, now) && connsOf(code).size === 0) {
      tellLive(step.state, { ...step.state, status: 'over' });
      rooms.delete(code);
      conns.delete(code);
    }
  }
}, SWEEP_EVERY_MS).unref();

server.listen(PORT, () => {
  console.log(`awale match server (dev) on ws://127.0.0.1:${PORT}`);
  console.log(`grace period for a dropped player: ${ABANDON_MS / 1000}s`);
});
