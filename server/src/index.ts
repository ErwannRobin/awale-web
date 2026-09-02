// The Worker in front of the rooms. It routes and nothing else.
//
//   GET  /room/:code   WebSocket upgrade into that room's Durable Object
//   POST /queue        quick match: a code to sit in, or one to walk into
//   GET  /health       is anybody home
//
// There are no accounts, no database and nothing to log in to. A room code is
// the whole of the authorisation model: know it and you can take a seat, which
// is exactly the security a game you share by link needs, and no more.
import { normaliseRoomCode } from '../../src/lib/protocol.ts';

export { Room } from './room.ts';
export { Lobby } from './lobby.ts';

export interface Env {
  ROOM: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  /** Comma-separated origins allowed to call /queue. Unset means any. */
  ALLOWED_ORIGINS?: string;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean);
  if (!origin) return {};
  if (allowed && allowed.length > 0 && !allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/health') {
      return new Response('ok', { headers: { ...cors, 'content-type': 'text/plain' } });
    }

    if (url.pathname === '/queue') {
      // One lobby for everyone. A single Durable Object is a bottleneck only at
      // a scale this game is nowhere near; sharding it later is a one-line
      // change to the name below.
      const id = env.LOBBY.idFromName('global');
      const response = await env.LOBBY.get(id).fetch(request);
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(response.body, { status: response.status, headers });
    }

    const match = /^\/room\/([^/]+)$/.exec(url.pathname);
    if (match) {
      const code = normaliseRoomCode(decodeURIComponent(match[1]));
      if (!code) return new Response('bad room code', { status: 400, headers: cors });

      // `idFromName` is what makes the room code mean something: the same code
      // always reaches the same object, from anywhere in the world.
      const id = env.ROOM.idFromName(code);
      const target = new URL(request.url);
      target.searchParams.set('code', code);
      return env.ROOM.get(id).fetch(new Request(target.toString(), request));
    }

    return new Response('not found', { status: 404, headers: cors });
  },
};
