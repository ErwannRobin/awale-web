// The world table: how many games have been played, at which level, from where,
// how they went — and which countries have been beating which online.
//
// One Durable Object for everybody, because counters have to agree with
// themselves — a single instance handling one request at a time is the whole of
// the locking, exactly as it is for the lobby next door. At this game's scale a
// single object is nowhere near a bottleneck; sharding it later means summing a
// handful of shards on read, not changing what is stored.
//
// What is stored is counters and nothing else:
//
//   total            AI games counted, worldwide
//   pvpTotal         rated online games counted, worldwide
//   updated          when the last one landed
//   country:<CC>     { games, byLevel, wins, losses, draws, pvp } for one country
//   h2h:<AA>-<BB>    two countries' record against each other
//
// There is no row per game, no identifier, no IP. A game arrives, a number goes
// up by one, and the game itself is forgotten. That is also why a player who
// changes country leaves their old games behind them: the counter they were
// added to has no idea who they were, and nothing ever goes back to move them.
import {
  addGame, addHeadToHead, addPvpMatch, coerceHeadToHead, coerceTally, rankCountries,
  rivalryKey, sanitiseLevel, sanitiseOutcome,
  type CountryTable, type CountryTally, type HeadToHead,
} from '../../src/lib/countryStats.ts';
import { normaliseCountry } from '../../src/lib/country.ts';

const TOTAL_KEY = 'total';
const PVP_TOTAL_KEY = 'pvpTotal';
const UPDATED_KEY = 'updated';
const PREFIX = 'country:';
const H2H_PREFIX = 'h2h:';

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
        const outcome = sanitiseOutcome(url.searchParams.get('outcome'));
        const key = PREFIX + country;
        const [tally, total] = await Promise.all([
          this.state.storage.get<CountryTally>(key),
          this.state.storage.get<number>(TOTAL_KEY),
        ]);
        const next = addGame(coerceTally(tally), level, outcome);
        // One write, so a crash between the two cannot leave the world total
        // disagreeing with the countries that make it up.
        await this.state.storage.put({
          [key]: next,
          [TOTAL_KEY]: (typeof total === 'number' ? total : 0) + 1,
          [UPDATED_KEY]: Date.now(),
        });
        return Response.json({ ok: true, country, level, outcome });
      }

      /**
       * A rated online game between two countries' players. Only the Room
       * object calls this, after it has seen the game through itself; the
       * Worker never routes a browser here.
       */
      case '/pvp': {
        const a = normaliseCountry(url.searchParams.get('a'));
        const b = normaliseCountry(url.searchParams.get('b'));
        const w = url.searchParams.get('winner');
        const winner = w === 'a' || w === 'b' ? w : 'draw';
        const pair = rivalryKey(a, b);
        const [ta, tb, h2h, pvpTotal] = await Promise.all([
          this.state.storage.get<CountryTally>(PREFIX + a),
          this.state.storage.get<CountryTally>(PREFIX + b),
          pair ? this.state.storage.get<HeadToHead>(H2H_PREFIX + pair) : Promise.resolve(undefined),
          this.state.storage.get<number>(PVP_TOTAL_KEY),
        ]);
        const table = addPvpMatch(
          { [a]: coerceTally(ta), ...(a === b ? {} : { [b]: coerceTally(tb) }) },
          a, b, winner,
        );
        const writes: Record<string, unknown> = {
          [PREFIX + a]: table[a],
          [PVP_TOTAL_KEY]: (typeof pvpTotal === 'number' ? pvpTotal : 0) + 1,
          [UPDATED_KEY]: Date.now(),
        };
        if (a !== b) writes[PREFIX + b] = table[b];
        const nextH2h = pair ? addHeadToHead(coerceHeadToHead(h2h), a, b, winner) : null;
        if (pair && nextH2h) writes[H2H_PREFIX + pair] = nextH2h;
        await this.state.storage.put(writes);
        return Response.json({ ok: true, rivalry: nextH2h });
      }

      /** One pair's record, for the end-of-game banner. */
      case '/rivalry': {
        const pair = rivalryKey(url.searchParams.get('a'), url.searchParams.get('b'));
        if (!pair) return Response.json(null);
        const row = await this.state.storage.get<HeadToHead>(H2H_PREFIX + pair);
        return Response.json(coerceHeadToHead(row) ?? null);
      }

      case '/table': {
        return Response.json(await this.table());
      }

      default:
        return new Response('not found', { status: 404 });
    }
  }

  private async table(): Promise<CountryTable> {
    const [rows, pairs, stored, pvpTotal, updatedAt] = await Promise.all([
      this.state.storage.list<CountryTally>({ prefix: PREFIX }),
      this.state.storage.list<HeadToHead>({ prefix: H2H_PREFIX }),
      this.state.storage.get<number>(TOTAL_KEY),
      this.state.storage.get<number>(PVP_TOTAL_KEY),
      this.state.storage.get<number>(UPDATED_KEY),
    ]);
    const table: Record<string, CountryTally> = {};
    for (const [key, tally] of rows) table[key.slice(PREFIX.length)] = coerceTally(tally);
    const counted = Object.values(table).reduce((n, t) => n + t.games, 0);
    const rivalries: HeadToHead[] = [];
    for (const raw of pairs.values()) {
      const row = coerceHeadToHead(raw);
      if (row && row.games > 0) rivalries.push(row);
    }
    rivalries.sort((x, y) => y.games - x.games);
    return {
      // The stored total is the truth; `counted` covers an object that somehow
      // has countries but never wrote a total.
      total: typeof stored === 'number' && stored > 0 ? stored : counted,
      pvpTotal: typeof pvpTotal === 'number' ? pvpTotal : 0,
      updatedAt: updatedAt ?? 0,
      countries: rankCountries(table),
      rivalries,
    };
  }
}
