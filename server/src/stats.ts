// The world table: how many games have been played, at which level, from where.
//
// One Durable Object for everybody, because counters have to agree with
// themselves — a single instance handling one request at a time is the whole of
// the locking, exactly as it is for the lobby next door. At this game's scale a
// single object is nowhere near a bottleneck; sharding it later means summing a
// handful of shards on read, not changing what is stored.
//
// What is stored is counters and nothing else:
//
//   total            games counted, worldwide
//   updated          when the last one landed
//   country:<CC>     { games, byLevel } for one country
//
// There is no row per game, no identifier, no IP. A game arrives, a number goes
// up by one, and the game itself is forgotten. That is also why a player who
// changes country leaves their old games behind them: the counter they were
// added to has no idea who they were, and nothing ever goes back to move them.
import {
  addGame, coerceTally, rankCountries, sanitiseLevel,
  type CountryTable, type CountryTally,
} from '../../src/lib/countryStats.ts';
import { normaliseCountry } from '../../src/lib/country.ts';

const TOTAL_KEY = 'total';
const UPDATED_KEY = 'updated';
const PREFIX = 'country:';

export class Stats implements DurableObject {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case '/count': {
        const country = normaliseCountry(url.searchParams.get('country'));
        const level = sanitiseLevel(Number(url.searchParams.get('level')));
        const key = PREFIX + country;
        const [tally, total] = await Promise.all([
          this.state.storage.get<CountryTally>(key),
          this.state.storage.get<number>(TOTAL_KEY),
        ]);
        const next = addGame(coerceTally(tally), level);
        // One write, so a crash between the two cannot leave the world total
        // disagreeing with the countries that make it up.
        await this.state.storage.put({
          [key]: next,
          [TOTAL_KEY]: (typeof total === 'number' ? total : 0) + 1,
          [UPDATED_KEY]: Date.now(),
        });
        return Response.json({ ok: true, country, level });
      }

      case '/table': {
        return Response.json(await this.table());
      }

      default:
        return new Response('not found', { status: 404 });
    }
  }

  private async table(): Promise<CountryTable> {
    const rows = await this.state.storage.list<CountryTally>({ prefix: PREFIX });
    const table: Record<string, CountryTally> = {};
    for (const [key, tally] of rows) table[key.slice(PREFIX.length)] = coerceTally(tally);
    const stored = await this.state.storage.get<number>(TOTAL_KEY);
    const counted = Object.values(table).reduce((n, t) => n + t.games, 0);
    return {
      // The stored total is the truth; `counted` covers an object that somehow
      // has countries but never wrote a total.
      total: typeof stored === 'number' && stored > 0 ? stored : counted,
      updatedAt: (await this.state.storage.get<number>(UPDATED_KEY)) ?? 0,
      countries: rankCountries(table),
    };
  }
}
