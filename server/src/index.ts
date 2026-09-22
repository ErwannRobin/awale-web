// The Worker. It routes, and hands everything it does not recognise to the
// built web app sitting next to it.
//
//   GET  /room/:code   WebSocket upgrade into that room's Durable Object
//   POST /queue        quick match: a code to sit in, or one to walk into
//   POST /auth/*       signing in with a phone number, via phone-verif.com
//   GET  /health       is anybody home
//   everything else    the game itself, from the ASSETS binding
//
// Serving the site from the same Worker is what lets the browser find the
// match server without being told where it is: same origin, so no CORS, no
// build-time URL, and no way for a deploy to leave a new site talking to an
// old server.
//
// A room code is still the whole of the authorisation model for a room: know
// it and you can take a seat, which is the security a game you share by link
// needs. Signing in adds an identity on top of that rather than replacing it —
// a signed-in player's seat is proved by a token nobody else can forge, and
// everyone else plays exactly as before, anonymously.
import { normaliseRoomCode } from '../../src/lib/protocol.ts';
import { handleAuth, type AuthEnv } from './auth.ts';
import type { QueueReply } from './lobby.ts';
import type { RoomProbe } from './room.ts';
import type { LeaderboardResponse } from './leaderboard.ts';

export { Room } from './room.ts';
export { Lobby } from './lobby.ts';
export { Identity } from './identity.ts';
export { Leaderboard } from './leaderboard.ts';

export interface Env extends AuthEnv {
  ROOM: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  LEADERBOARD: DurableObjectNamespace;
  /** The built web app. Present in a deploy; absent under `wrangler dev` if
   *  the app has not been built yet, which is a warning, not a crash. */
  ASSETS?: Fetcher;
  /** Comma-separated origins allowed to call /queue from another site. */
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

/**
 * Quick match.
 *
 * The lobby holds at most one waiting code, and hands it to the next player who
 * asks. On its own that is not quite enough: a player who asks for a match and
 * then closes the tab leaves their code behind, and the next player walks into
 * an empty room and waits for someone who is never coming — which is easy to
 * hit and looks exactly like a broken matchmaker.
 *
 * So a handed-out code is checked before it is trusted. If nobody is still
 * sitting in that room, we go back to the lobby, which by then has forgotten
 * the stale code and issues a fresh one to wait in.
 */
async function queue(env: Env): Promise<QueueReply> {
  // One lobby for everyone. A single Durable Object is a bottleneck only at a
  // scale this game is nowhere near; sharding it later is a one-line change to
  // the name below.
  const lobby = env.LOBBY.get(env.LOBBY.idFromName('global'));
  // A fresh request each time, rather than forwarding the player's: a Request
  // cannot be sent twice, and the lobby wants nothing from theirs but the verb.
  const ask = async (): Promise<QueueReply> => {
    const response = await lobby.fetch('https://lobby/queue', { method: 'POST' });
    return await response.json();
  };

  const first = await ask();
  if (first.role === 'created') return first;
  if (await joinable(first.code, env)) return first;
  return ask();
}

async function joinable(code: string, env: Env): Promise<boolean> {
  try {
    const room = env.ROOM.get(env.ROOM.idFromName(code));
    const probe = await room.fetch(`https://room/?code=${code}&probe=1`);
    if (!probe.ok) return false;
    const body = await probe.json() as RoomProbe;
    return body.joinable === true;
  } catch {
    // A matchmaker that fails closed sends the player to a fresh room, which is
    // a wait. Failing open sends them to a room that may be empty, which is a
    // wait that never ends.
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Sign-in, before the room routes: `/auth/*` is never a room code.
    const auth = await handleAuth(request, env, cors);
    if (auth) return auth;

    if (url.pathname === '/health') {
      return new Response('ok', { headers: { ...cors, 'content-type': 'text/plain' } });
    }

    if (url.pathname === '/queue') {
      if (request.method !== 'POST') {
        return new Response('use POST', { status: 405, headers: cors });
      }
      const reply = await queue(env);
      return Response.json(reply, { headers: cors });
    }

    if (url.pathname === '/leaderboard') {
      const leaderboard = env.LEADERBOARD.get(env.LEADERBOARD.idFromName('global'));
      return leaderboard.fetch(new Request(request.url, request));
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

    // Not an API route, so it is the game: index.html, the hashed bundles, the
    // manifest, the service worker.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response(
      'The web app is not bundled with this Worker. Run `npm run build` in the '
      + 'repository root, then deploy again.',
      { status: 404, headers: { ...cors, 'content-type': 'text/plain' } },
    );
  },
};
