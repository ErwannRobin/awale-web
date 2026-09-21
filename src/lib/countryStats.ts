// Counting games per country, per difficulty. Pure, and shared by both sides:
// the browser folds its own games into the same shape the Worker keeps for
// everybody's, so the local "by country" table and the world table cannot
// drift into meaning different things.
//
// The counters are cumulative and never re-attributed. That is the whole of
// how "a player may change country, but their old games stay where they were
// played": a finished game is added once, to the country that was set at the
// moment it ended, and nothing ever goes back to move it.
import { normaliseCountry, type CountryKey } from './country.ts';

export const LEVEL_COUNT = 4;

/** Games played from one country, and how they split across the AI levels. */
export interface CountryTally {
  games: number;
  /** Index = AI level 0..3. */
  byLevel: number[];
}

export interface CountryRow extends CountryTally {
  code: CountryKey;
}

/** What `/stats/countries` answers with. */
export interface CountryTable {
  /** Games counted worldwide, including the ones with no known country. */
  total: number;
  updatedAt: number;
  countries: CountryRow[];
}

export const emptyTally = (): CountryTally => ({
  games: 0,
  byLevel: Array.from({ length: LEVEL_COUNT }, () => 0),
});

const num = (v: unknown): number =>
  (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** A level from anywhere — a request body, an old record — clamped to 0..3. */
export const sanitiseLevel = (v: unknown): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
  return Math.min(LEVEL_COUNT - 1, Math.max(0, n));
};

/** Stored counters are just JSON; rebuild rather than trust the blob. */
export function coerceTally(raw: unknown): CountryTally {
  const t = emptyTally();
  if (!raw || typeof raw !== 'object') return t;
  const o = raw as Record<string, unknown>;
  const byLevel = Array.isArray(o.byLevel) ? o.byLevel : [];
  const levels = Array.from({ length: LEVEL_COUNT }, (_, i) => num(byLevel[i]));
  // `games` is kept rather than recomputed from the levels: the two are written
  // together, and trusting the stored total keeps a future extra level honest.
  return { games: Math.max(num(o.games), 0), byLevel: levels };
}

/** One finished game, folded in. Returns a new tally; the input is untouched. */
export function addGame(prev: CountryTally, level: unknown): CountryTally {
  const lvl = sanitiseLevel(level);
  return {
    games: prev.games + 1,
    byLevel: prev.byLevel.map((n, i) => (i === lvl ? n + 1 : n)),
  };
}

/** The same fold over a map keyed by country, which is how both sides store it. */
export function addCountryGame(
  table: Record<string, CountryTally>,
  country: unknown,
  level: unknown,
): Record<string, CountryTally> {
  const key = normaliseCountry(country);
  return { ...table, [key]: addGame(coerceTally(table[key]), level) };
}

/** Busiest first, then alphabetically, so the order never wobbles on a tie. */
export function rankCountries(table: Record<string, CountryTally>): CountryRow[] {
  return Object.entries(table)
    .map(([code, tally]) => ({ code: normaliseCountry(code), ...coerceTally(tally) }))
    .filter(row => row.games > 0)
    .sort((a, b) => b.games - a.games || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

export function coerceTable(raw: unknown): Record<string, CountryTally> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, CountryTally> = {};
  for (const [code, tally] of Object.entries(raw as Record<string, unknown>)) {
    const key = normaliseCountry(code);
    const next = coerceTally(tally);
    const seen = out[key];
    // Two spellings of the same country (or anything unknown) merge into one row.
    out[key] = seen
      ? { games: seen.games + next.games, byLevel: seen.byLevel.map((n, i) => n + next.byLevel[i]) }
      : next;
  }
  return out;
}
