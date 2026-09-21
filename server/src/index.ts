// The Worker. It routes, and hands everything it does not recognise to the
// built web app sitting next to it.
//
//   GET  /room/:code   WebSocket upgrade into that room's Durable Object
//   POST /queue        quick match: a code to sit in, or one to walk into
//   POST /auth/*       signing in with a phone number, via phone-verif.com
//   GET  /geo          which country this request came from
//   POST /stats/game   count one finished game: a level and a country
//   GET  /stats/countries  the world table
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
import { normaliseCountry, UNKNOWN_COUNTRY } from '../../src/lib/country.ts';
import { sanitiseLevel } from '../../src/lib/countryStats.ts';
import { handleAuth, type AuthEnv } from './auth.ts';
import type { QueueReply } from './lobby.ts';
import type { RoomProbe } from './room.ts';

export { Room } from './room.ts';
export { Lobby } from './lobby.ts';
export { Identity } from './identity.ts';
export { Leaderboard } from './leaderboard.ts';
export { Stats } from './stats.ts';

export interface Env extends AuthEnv {
  ROOM: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  LEADERBOARD: DurableObjectNamespace;
  /** The world table. Absent on an older deploy, which simply has no stats. */
  STATS?: DurableObjectNamespace;
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
    'access-control-allow-headers': 'content-type, authorization',
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

/**
 * Which country this request came from.
 *
 * Cloudflare has already worked it out by the time we see the request, from an
 * IP we never have to read, store, or send anywhere — `request.cf.country` (and
 * the `CF-IPCountry` header behind it) is the whole of the geolocation in this
 * codebase. `XX` and `T1` mean an anonymising proxy or Tor, which is a country
 * we do not know rather than one we can guess at.
 */
function requestCountry(request: Request): string {
  const cf = (request as { cf?: { country?: string } }).cf;
  const raw = cf?.country ?? request.headers.get('cf-ipcountry') ?? '';
  return normaliseCountry(raw);
}

/** The Stats object, or null on a deploy that predates the binding. */
function statsObject(env: Env): DurableObjectStub | null {
  if (!env.STATS) return null;
  return env.STATS.get(env.STATS.idFromName('global'));
}

/**
 * Count one finished game.
 *
 * The country comes from the body when the player has one set, and from the
 * edge otherwise. Taking the body at its word is deliberate: a player may say
 * where they are from, including a country they are not currently sitting in,
 * and these are play counts rather than anything worth defending. The level is
 * clamped, the country has to be a real code, and nothing else is read.
 */
async function countGame(request: Request, env: Env): Promise<Response> {
  const stats = statsObject(env);
  if (!stats) return new Response('stats are not enabled', { status: 503 });

  let body: Record<string, unknown> = {};
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const claimed = normaliseCountry(body.country);
  const country = claimed === UNKNOWN_COUNTRY ? requestCountry(request) : claimed;
  const level = sanitiseLevel(typeof body.level === 'number' ? body.level : Number(body.level));

  const response = await stats.fetch(
    `https://stats/count?country=${country}&level=${level}`,
    { method: 'POST' },
  );
  return new Response(response.body, { status: response.status, headers: response.headers });
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

    if (url.pathname === '/geo') {
      return Response.json(
        { country: requestCountry(request) },
        // Never cached: two players behind the same CDN node are not
        // necessarily in the same country, and this answer is per-request.
        { headers: { ...cors, 'cache-control': 'no-store' } },
      );
    }

    if (url.pathname === '/stats/game') {
      if (request.method !== 'POST') {
        return new Response('use POST', { status: 405, headers: cors });
      }
      const counted = await countGame(request, env);
      return new Response(counted.body, {
        status: counted.status,
        headers: { ...cors, 'content-type': counted.headers.get('content-type') ?? 'text/plain' },
      });
    }

    if (url.pathname === '/stats/countries') {
      const stats = statsObject(env);
      if (!stats) return Response.json({ total: 0, updatedAt: 0, countries: [] }, { headers: cors });
      const table = await stats.fetch('https://stats/table');
      return new Response(table.body, {
        status: table.status,
        headers: {
          ...cors,
          'content-type': 'application/json',
          // A table that is a minute stale is still a true picture, and this
          // is the one route a crowd could all ask for at once.
          'cache-control': 'public, max-age=60',
        },
      });
    }

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
      const reply = await leaderboard.fetch(new Request(request.url, request));
      const headers = new Headers(reply.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(reply.body, { status: reply.status, headers });
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
