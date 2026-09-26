// The public list of games being played right now, for spectators to pick
// from.
//
// One Durable Object for everybody, like the lobby. Rooms tell it when a
// listed game starts and when it ends; the list is whatever is left. Only
// quick-match games are listed (see `hello.listed`): a friend's game can be
// watched by whoever holds its code and by nobody else.
//
// A room that dies without saying so — an eviction at the wrong moment —
// would leave a row behind for ever, so rows also expire on their own after
// MAX_AGE_MS, far longer than any game with a clock on it lasts.
import { parseLiveGames, type LiveGame } from '../../src/lib/protocol.ts';

const PREFIX = 'game:';
/** Rows older than this are assumed to belong to a room that forgot to say. */
const MAX_AGE_MS = 3 * 60 * 60_000;
/** The most a list ever shows: the newest games first. */
const MAX_ROWS = 30;

export class Live implements DurableObject {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/start' && request.method === 'POST') {
      const [game] = parseLiveGames([await request.json().catch(() => null)]);
      if (!game) return new Response('bad game', { status: 400 });
      await this.state.storage.put(PREFIX + game.room, game);
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/end' && request.method === 'POST') {
      const room = url.searchParams.get('room') ?? '';
      await this.state.storage.delete(PREFIX + room);
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/list') {
      const now = Date.now();
      const rows = await this.state.storage.list<LiveGame>({ prefix: PREFIX });
      const stale: string[] = [];
      const games: LiveGame[] = [];
      for (const [key, game] of rows) {
        if (now - game.startedAt > MAX_AGE_MS) stale.push(key);
        else games.push(game);
      }
      if (stale.length > 0) await this.state.storage.delete(stale);
      games.sort((a, b) => b.startedAt - a.startedAt);
      return Response.json(games.slice(0, MAX_ROWS));
    }

    return new Response('not found', { status: 404 });
  }
}
