// Counting games per country: against the AI, per difficulty and per outcome,
// and against other people online. Pure, and shared by every side: the browser
// folds its own games into the same shape the Worker keeps for everybody's, so
// the local "by country" table, the world table and the nations ranking cannot
// drift into meaning different things.
//
// The counters are cumulative and never re-attributed. That is the whole of
// how "a player may change country, but their old games stay where they were
// played": a finished game is added once, to the country that was set at the
// moment it ended, and nothing ever goes back to move it.
import { normaliseCountry, UNKNOWN_COUNTRY, type CountryKey } from './country.ts';

export const LEVEL_COUNT = 4;

/** How a game ended, from the human's side of the board. */
export type GameOutcome = 'win' | 'loss' | 'draw';

/**
 * Online games a country's players took part in.
 *
 * `wins`, `losses` and `draws` only count games against another country — a
 * derby between two players from the same place moves nobody up or down, so it
 * is kept apart as `internal`. `games` is every one of them.
 */
export interface PvpTally {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  internal: number;
}

/** Games played from one country, and how they went. */
export interface CountryTally {
  /** Games against the AI, all levels. */
  games: number;
  /** AI games per level. Index = level 0..3. */
  byLevel: number[];
  /**
   * AI games per level the human won, lost or drew. Older clients reported a
   * level and nothing else, so these can sum to less than `byLevel`: a win
   * rate is taken over the games whose outcome is known.
   */
  wins: number[];
  losses: number[];
  draws: number[];
  /** Rated online games. */
  pvp: PvpTally;
}

export interface CountryRow extends CountryTally {
  code: CountryKey;
}

/**
 * Two countries' record against each other, stored once per pair.
 * `a` sorts before `b`, so FR–CI and CI–FR are the same row.
 */
export interface HeadToHead {
  a: CountryKey;
  b: CountryKey;
  games: number;
  aWins: number;
  bWins: number;
  draws: number;
}

/** What `/stats/countries` answers with. */
export interface CountryTable {
  /** AI games counted worldwide, including the ones with no known country. */
  total: number;
  /** Rated online games counted worldwide. */
  pvpTotal: number;
  updatedAt: number;
  countries: CountryRow[];
  rivalries: HeadToHead[];
}

const zeros = () => Array.from({ length: LEVEL_COUNT }, () => 0);

export const emptyPvp = (): PvpTally => ({ games: 0, wins: 0, losses: 0, draws: 0, internal: 0 });

export const emptyTally = (): CountryTally => ({
  games: 0,
  byLevel: zeros(),
  wins: zeros(),
  losses: zeros(),
  draws: zeros(),
  pvp: emptyPvp(),
});

const num = (v: unknown): number =>
  (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

const levels = (v: unknown): number[] => {
  const list = Array.isArray(v) ? v : [];
  return Array.from({ length: LEVEL_COUNT }, (_, i) => num(list[i]));
};

/** A level from anywhere — a request body, an old record — clamped to 0..3. */
export const sanitiseLevel = (v: unknown): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
  return Math.min(LEVEL_COUNT - 1, Math.max(0, n));
};

/** An outcome from anywhere, or null when it is not one. */
export const sanitiseOutcome = (v: unknown): GameOutcome | null =>
  (v === 'win' || v === 'loss' || v === 'draw' ? v : null);

export function coercePvp(raw: unknown): PvpTally {
  if (!raw || typeof raw !== 'object') return emptyPvp();
  const o = raw as Record<string, unknown>;
  return {
    games: num(o.games), wins: num(o.wins), losses: num(o.losses),
    draws: num(o.draws), internal: num(o.internal),
  };
}

/** Stored counters are just JSON; rebuild rather than trust the blob. */
export function coerceTally(raw: unknown): CountryTally {
  if (!raw || typeof raw !== 'object') return emptyTally();
  const o = raw as Record<string, unknown>;
  // `games` is kept rather than recomputed from the levels: the two are written
  // together, and trusting the stored total keeps a future extra level honest.
  return {
    games: num(o.games),
    byLevel: levels(o.byLevel),
    wins: levels(o.wins),
    losses: levels(o.losses),
    draws: levels(o.draws),
    pvp: coercePvp(o.pvp),
  };
}

const bump = (list: number[], at: number, when: boolean) =>
  list.map((n, i) => (when && i === at ? n + 1 : n));

/** One finished AI game, folded in. Returns a new tally; the input is untouched. */
export function addGame(prev: CountryTally, level: unknown, outcome?: unknown): CountryTally {
  const lvl = sanitiseLevel(level);
  const how = sanitiseOutcome(outcome);
  return {
    ...prev,
    games: prev.games + 1,
    byLevel: bump(prev.byLevel, lvl, true),
    wins: bump(prev.wins, lvl, how === 'win'),
    losses: bump(prev.losses, lvl, how === 'loss'),
    draws: bump(prev.draws, lvl, how === 'draw'),
  };
}

/** The same fold over a map keyed by country, which is how both sides store it. */
export function addCountryGame(
  table: Record<string, CountryTally>,
  country: unknown,
  level: unknown,
  outcome?: unknown,
): Record<string, CountryTally> {
  const key = normaliseCountry(country);
  return { ...table, [key]: addGame(coerceTally(table[key]), level, outcome) };
}

/**
 * One rated online game, from one country's side. `internal` is a game against
 * somebody from the same country: it counts as played, not as won or lost.
 */
export function addPvpGame(prev: CountryTally, result: GameOutcome | 'internal'): CountryTally {
  const p = prev.pvp;
  return {
    ...prev,
    pvp: {
      games: p.games + 1,
      wins: p.wins + (result === 'win' ? 1 : 0),
      losses: p.losses + (result === 'loss' ? 1 : 0),
      draws: p.draws + (result === 'draw' ? 1 : 0),
      internal: p.internal + (result === 'internal' ? 1 : 0),
    },
  };
}

/**
 * A finished online game between a player from `a` and one from `b`, folded
 * into both countries' tallies. `winner` is 'a', 'b' or 'draw'.
 */
export function addPvpMatch(
  table: Record<string, CountryTally>,
  a: unknown,
  b: unknown,
  winner: 'a' | 'b' | 'draw',
): Record<string, CountryTally> {
  const ca = normaliseCountry(a);
  const cb = normaliseCountry(b);
  if (ca === cb) {
    // One country, one game, played twice over — count it once.
    return { ...table, [ca]: addPvpGame(coerceTally(table[ca]), 'internal') };
  }
  const as: GameOutcome = winner === 'draw' ? 'draw' : winner === 'a' ? 'win' : 'loss';
  const bs: GameOutcome = winner === 'draw' ? 'draw' : winner === 'b' ? 'win' : 'loss';
  return {
    ...table,
    [ca]: addPvpGame(coerceTally(table[ca]), as),
    [cb]: addPvpGame(coerceTally(table[cb]), bs),
  };
}

/** The storage key for a pair of countries, or null when there is no rivalry. */
export function rivalryKey(a: unknown, b: unknown): string | null {
  const ca = normaliseCountry(a);
  const cb = normaliseCountry(b);
  if (ca === cb || ca === UNKNOWN_COUNTRY || cb === UNKNOWN_COUNTRY) return null;
  return ca < cb ? `${ca}-${cb}` : `${cb}-${ca}`;
}

export function emptyHeadToHead(a: unknown, b: unknown): HeadToHead {
  const ca = normaliseCountry(a);
  const cb = normaliseCountry(b);
  const [x, y] = ca < cb ? [ca, cb] : [cb, ca];
  return { a: x, b: y, games: 0, aWins: 0, bWins: 0, draws: 0 };
}

export function coerceHeadToHead(raw: unknown): HeadToHead | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!rivalryKey(o.a, o.b)) return null;
  const base = emptyHeadToHead(o.a, o.b);
  // Stored sorted; a row that somehow is not gets its sides swapped back.
  const swapped = base.a !== normaliseCountry(o.a);
  return {
    ...base,
    games: num(o.games),
    aWins: num(swapped ? o.bWins : o.aWins),
    bWins: num(swapped ? o.aWins : o.bWins),
    draws: num(o.draws),
  };
}

/**
 * A game between a player from `winnerSide`'s country and one from the other.
 * `a`/`b` here are the game's two countries in any order; the stored row keeps
 * its own sorted order.
 */
export function addHeadToHead(
  prev: HeadToHead | null | undefined,
  a: unknown,
  b: unknown,
  winner: 'a' | 'b' | 'draw',
): HeadToHead | null {
  if (!rivalryKey(a, b)) return null;
  const row = prev ? { ...prev } : emptyHeadToHead(a, b);
  const winnerCode = winner === 'draw' ? null : normaliseCountry(winner === 'a' ? a : b);
  return {
    ...row,
    games: row.games + 1,
    aWins: row.aWins + (winnerCode === row.a ? 1 : 0),
    bWins: row.bWins + (winnerCode === row.b ? 1 : 0),
    draws: row.draws + (winnerCode === null ? 1 : 0),
  };
}

/** One country's rivalries, from its own side: busiest first. */
export interface RivalryView {
  opponent: CountryKey;
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

export function rivalriesOf(list: HeadToHead[], code: unknown): RivalryView[] {
  const me = normaliseCountry(code);
  return list
    .filter(h => h.a === me || h.b === me)
    .map(h => (h.a === me
      ? { opponent: h.b, games: h.games, wins: h.aWins, losses: h.bWins, draws: h.draws }
      : { opponent: h.a, games: h.games, wins: h.bWins, losses: h.aWins, draws: h.draws }))
    .sort((x, y) => y.games - x.games || (x.opponent < y.opponent ? -1 : 1));
}

/** Busiest first, then alphabetically, so the order never wobbles on a tie. */
export function rankCountries(table: Record<string, CountryTally>): CountryRow[] {
  return Object.entries(table)
    .map(([code, tally]) => ({ code: normaliseCountry(code), ...coerceTally(tally) }))
    .filter(row => row.games > 0 || row.pvp.games > 0)
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
    out[key] = seen ? mergeTally(seen, next) : next;
  }
  return out;
}

const addLists = (x: number[], y: number[]) => x.map((n, i) => n + (y[i] ?? 0));

function mergeTally(x: CountryTally, y: CountryTally): CountryTally {
  return {
    games: x.games + y.games,
    byLevel: addLists(x.byLevel, y.byLevel),
    wins: addLists(x.wins, y.wins),
    losses: addLists(x.losses, y.losses),
    draws: addLists(x.draws, y.draws),
    pvp: {
      games: x.pvp.games + y.pvp.games,
      wins: x.pvp.wins + y.pvp.wins,
      losses: x.pvp.losses + y.pvp.losses,
      draws: x.pvp.draws + y.pvp.draws,
      internal: x.pvp.internal + y.pvp.internal,
    },
  };
}

// ---- nations: the ranking that makes countries rivals -----------------------

/** Who plays for a country, from the leaderboard: signed-in accounts only. */
export interface CountryPeople {
  code: CountryKey;
  players: number;
  /** Mean online rating of the country's players, rounded. */
  avgRating: number;
  topRating: number;
  /** The country's best player, so the ranking can point at a person. */
  topPlayer: { userId: string; name: string } | null;
}

export interface NationRow {
  code: CountryKey;
  /** Nation points: 3 per win abroad, 1 per draw abroad. See `nationPoints`. */
  points: number;
  players: number;
  avgRating: number;
  topRating: number;
  topPlayer: { userId: string; name: string } | null;
  pvp: PvpTally;
  /** AI games, and how many of those the human won. */
  aiGames: number;
  aiWins: number;
  /** AI wins at the hardest level: the bragging number. */
  aiMasterWins: number;
  position: number;
}

/**
 * Nation points come from rated online games against other countries, and
 * nothing else. Those are the one result the server witnessed itself — both
 * players signed in, the board played out in a room it ran — so a nation
 * cannot be pushed up the table by anybody posting to an open endpoint.
 */
export const nationPoints = (pvp: PvpTally): number => pvp.wins * 3 + pvp.draws;

const sum = (list: number[]) => list.reduce((n, x) => n + x, 0);

/**
 * Countries ranked by nation points, then by how many players they field,
 * then by how much they play. Unknown is left out: nobody can be its rival.
 */
export function rankNations(countries: CountryRow[], people: CountryPeople[]): NationRow[] {
  const byCode = new Map<CountryKey, NationRow>();
  const row = (code: CountryKey): NationRow => {
    const seen = byCode.get(code);
    if (seen) return seen;
    const fresh: NationRow = {
      code, points: 0, players: 0, avgRating: 0, topRating: 0, topPlayer: null,
      pvp: emptyPvp(), aiGames: 0, aiWins: 0, aiMasterWins: 0, position: 0,
    };
    byCode.set(code, fresh);
    return fresh;
  };
  for (const c of countries) {
    if (c.code === UNKNOWN_COUNTRY) continue;
    const r = row(c.code);
    r.pvp = coercePvp(c.pvp);
    r.points = nationPoints(r.pvp);
    r.aiGames = c.games;
    r.aiWins = sum(c.wins);
    r.aiMasterWins = c.wins[LEVEL_COUNT - 1] ?? 0;
  }
  for (const p of people) {
    if (p.code === UNKNOWN_COUNTRY || p.players <= 0) continue;
    const r = row(p.code);
    r.players = p.players;
    r.avgRating = p.avgRating;
    r.topRating = p.topRating;
    r.topPlayer = p.topPlayer;
  }
  return [...byCode.values()]
    .sort((x, y) => y.points - x.points
      || y.players - x.players
      || (y.pvp.games + y.aiGames) - (x.pvp.games + x.aiGames)
      || (x.code < y.code ? -1 : x.code > y.code ? 1 : 0))
    .map((r, i) => ({ ...r, position: i + 1 }));
}

/**
 * The country to beat. For a nation in the table, that is the one directly
 * above it — or, at the top, the one breathing down its neck. `gap` is how many
 * nation points separate them, and `ahead` says which way.
 */
export interface Rival {
  nation: NationRow;
  gap: number;
  /** True when the rival is above: the player's nation is the one chasing. */
  ahead: boolean;
}

export function findRival(nations: NationRow[], code: unknown): Rival | null {
  const me = normaliseCountry(code);
  if (me === UNKNOWN_COUNTRY || nations.length === 0) return null;
  const at = nations.findIndex(n => n.code === me);
  if (at === -1) {
    // Not on the board yet: the target is the last nation that has scored.
    const scored = nations.filter(n => n.points > 0);
    const target = scored[scored.length - 1] ?? nations[nations.length - 1];
    return { nation: target, gap: target.points, ahead: true };
  }
  if (at > 0) {
    const above = nations[at - 1];
    return { nation: above, gap: above.points - nations[at].points, ahead: true };
  }
  const below = nations[1];
  if (!below) return null;
  return { nation: below, gap: nations[0].points - below.points, ahead: false };
}

/** Wins, as a whole percentage of the games whose outcome is known. */
export function aiWinRate(t: Pick<CountryTally, 'wins' | 'losses' | 'draws'>, level?: number): number {
  const pick = (list: number[]) => (level === undefined ? sum(list) : list[level] ?? 0);
  const known = pick(t.wins) + pick(t.losses) + pick(t.draws);
  return known === 0 ? 0 : Math.round((pick(t.wins) / known) * 100);
}
