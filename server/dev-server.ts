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
  command, createRoom, disconnect, isExpired, join, seatOf, sweep,
  type Effect, type RoomState,
} from '../src/lib/roomCore.ts';
import {
  PROTOCOL_VERSION, makeRoomCode, normaliseRoomCode, parseClientMsg,
  type ServerMsg,
} from '../src/lib/protocol.ts';
import type { Seat } from '../src/lib/rules.ts';

const PORT = Number(process.env.PORT ?? 8787);
const WAIT_TTL_MS = 120_000;
const SWEEP_EVERY_MS = 5_000;

interface Conn {
  ws: WebSocket;
  token: string;
  seat: Seat | null;
}

const rooms = new Map<string, RoomState>();
const conns = new Map<string, Set<Conn>>();
let waiting: { code: string; at: number } | null = null;

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
      if (effect.to !== 'all' && conn.seat !== effect.to) continue;
      send(conn.ws, effect.msg);
    }
  }
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
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
  if (url.pathname === '/queue' && request.method === 'POST') {
    const now = Date.now();
    let body: { code: string; role: 'created' | 'joined' };
    if (waiting && now - waiting.at < WAIT_TTL_MS) {
      body = { code: waiting.code, role: 'joined' };
      waiting = null;
    } else {
      const code = makeRoomCode();
      waiting = { code, at: now };
      body = { code, role: 'created' };
    }
    response.writeHead(200, { ...cors, 'content-type': 'application/json' })
      .end(JSON.stringify(body));
    return;
  }
  response.writeHead(404, cors).end('not found');
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
      const result = join(room, msg.token, msg.name, now);
      if (result.error) {
        send(ws, { t: 'err', code: result.error });
        ws.close();
        return;
      }
      conn.token = msg.token;
      conn.seat = result.seat;
      rooms.set(code, result.state);
      dispatch(code, result.effects);
      return;
    }

    if (!conn.token || seatOf(room, conn.token) === null) {
      send(ws, { t: 'err', code: 'not-seated' });
      return;
    }
    const step = command(room, conn.token, msg, now);
    rooms.set(code, step.state);
    dispatch(code, step.effects);
  });

  ws.on('close', () => {
    connsOf(code).delete(conn);
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
      rooms.set(code, step.state);
      dispatch(code, step.effects);
    }
    if (isExpired(step.state, now) && connsOf(code).size === 0) {
      rooms.delete(code);
      conns.delete(code);
    }
  }
}, SWEEP_EVERY_MS).unref();

server.listen(PORT, () => {
  console.log(`awale match server (dev) on ws://127.0.0.1:${PORT}`);
  console.log(`grace period for a dropped player: ${ABANDON_MS / 1000}s`);
});
