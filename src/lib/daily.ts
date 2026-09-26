// The daily puzzle: one position a day, the same one for everybody.
//
// No server is involved. The pool is a fixed list shipped with the game
// (`src/content/daily.json`, mined and proved by `scripts/gen-puzzles.ts`), and
// the date alone picks the day's entry — so two players anywhere in the world
// who open the game on the same calendar day get the same board, offline
// included, and can compare how they did.
//
// The week has a shape, like a newspaper crossword: Monday and Tuesday are
// gentle, the middle of the week is harder, and the weekend is the real test.
// Within a tier the pool is walked in order, so nothing repeats until every
// entry of that tier has had its day.
//
// Everything here is pure except `loadDaily`/`saveDaily`, which go through the
// pluggable store like the rest of the player's progress.
import { getStore } from './storage.ts';

/** One pool entry, kept terse because the pool ships in the bundle. */
export interface DailyEntry {
  /** AI level, 0–2. */
  l: number;
  /** [computer (South), player (North)] seeds already banked. */
  s: [number, number];
  /** The twelve pits. */
  p: number[];
  /** Fewest moves of the player's own that force the win — proved exactly. */
  m: number;
}

/** Easy (Mon–Tue), medium (Wed–Fri), hard (Sat–Sun). */
export type DailyTier = 0 | 1 | 2;
export type DailyPool = [DailyEntry[], DailyEntry[], DailyEntry[]];

export interface DailyPuzzle {
  /** Puzzle #1 is the launch day; the number goes up by one a day. */
  number: number;
  /** The player's local calendar day, `YYYY-MM-DD`. */
  day: string;
  tier: DailyTier;
  level: number;
  scores: [number, number];
  pits: number[];
  moves: number;
}

/** Day one. */
export const DAILY_LAUNCH = '2026-09-26';

const DAY_MS = 86_400_000;

/** A local calendar day, as the player's own clock sees it. */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Days since 1970-01-01 for a `YYYY-MM-DD` key.
 *
 * Counted in UTC on purpose: the key is already the player's local date, and
 * doing the arithmetic in local time would make a daylight-saving change give
 * one day 23 or 25 hours.
 */
export function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export const keyOfDayNumber = (n: number): string =>
  new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Day of the week, 0 = Sunday — of the calendar day, not of any clock. */
const weekday = (n: number): number => (n + 4) % 7;   // 1970-01-01 was a Thursday

/** [tier, slot within that tier's days of the week]. */
const SLOTS: Record<number, [DailyTier, number]> = {
  1: [0, 0], 2: [0, 1],             // Monday, Tuesday
  3: [1, 0], 4: [1, 1], 5: [1, 2],  // Wednesday to Friday
  6: [2, 0], 0: [2, 1],             // Saturday, Sunday
};
const SLOTS_PER_WEEK: Record<DailyTier, number> = { 0: 2, 1: 3, 2: 2 };

export const tierOfDay = (key: string): DailyTier => SLOTS[weekday(dayNumber(key))][0];

/** The day's puzzle. */
export function dailyFor(key: string, pool: DailyPool): DailyPuzzle {
  const n = dayNumber(key);
  const [tier, slot] = SLOTS[weekday(n)];
  // Weeks start on Monday: day -3 (1969-12-29) was one.
  const week = Math.floor((n + 3) / 7);
  const entries = pool[tier];
  const index = ((week * SLOTS_PER_WEEK[tier] + slot) % entries.length + entries.length) % entries.length;
  const e = entries[index];
  return {
    number: n - dayNumber(DAILY_LAUNCH) + 1,
    day: key,
    tier,
    level: e.l,
    scores: [e.s[0], e.s[1]],
    pits: [...e.p],
    moves: e.m,
  };
}

/** Milliseconds until the next puzzle, i.e. the player's next local midnight. */
export function msUntilNext(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(0, next.getTime() - now.getTime());
}

// ---- the player's record -------------------------------------------------

const KEY = 'awale.daily.v1';
/** Enough days to draw a month and a bit; older ones only matter as a streak. */
const KEEP_DAYS = 45;

export interface DailyProgress {
  /** Consecutive days solved, ending on `last`. */
  streak: number;
  best: number;
  /** The last day solved. */
  last: string | null;
  /** Solved days (recent ones only), with how many tries each took. */
  solved: Record<string, number>;
  /** Games lost on a day not yet solved. */
  tries: Record<string, number>;
}

export const emptyDaily = (): DailyProgress => ({ streak: 0, best: 0, last: null, solved: {}, tries: {} });

const isKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const count = (v: unknown): number =>
  (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

function days(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isKey(k)) out[k] = count(v);
  return out;
}

/** Stored progress is user-editable JSON: every field is checked. */
export function coerceDaily(raw: unknown): DailyProgress {
  if (!raw || typeof raw !== 'object') return emptyDaily();
  const o = raw as Record<string, unknown>;
  return {
    streak: count(o.streak),
    best: count(o.best),
    last: isKey(o.last) ? o.last : null,
    solved: days(o.solved),
    tries: days(o.tries),
  };
}

export function loadDaily(): DailyProgress {
  try {
    const raw = getStore().get(KEY);
    return coerceDaily(raw ? JSON.parse(raw) : null);
  } catch {
    return emptyDaily();
  }
}

export function saveDaily(p: DailyProgress): void {
  getStore().set(KEY, JSON.stringify(p));
}

/** Drops days too old to show, so the blob stays small for good. */
function prune(map: Record<string, number>, today: string): Record<string, number> {
  const cutoff = dayNumber(today) - KEEP_DAYS;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(map)) if (dayNumber(k) > cutoff) out[k] = v;
  return out;
}

/**
 * One finished attempt at `day`'s puzzle.
 *
 * A loss is a try. The first win on a day banks it, with the tries it took,
 * and extends the streak if the previous day was solved too; winning the same
 * puzzle again later changes nothing — the record is how you did first.
 */
export function recordAttempt(p: DailyProgress, day: string, won: boolean): DailyProgress {
  if (p.solved[day] !== undefined) return p;
  const tries = (p.tries[day] ?? 0) + 1;
  if (!won) return { ...p, tries: prune({ ...p.tries, [day]: tries }, day) };

  const rest = { ...p.tries };
  delete rest[day];
  const follows = p.last !== null && dayNumber(day) - dayNumber(p.last) === 1;
  const streak = follows ? p.streak + 1 : 1;
  return {
    streak,
    best: Math.max(p.best, streak),
    last: day,
    solved: prune({ ...p.solved, [day]: tries }, day),
    tries: prune(rest, day),
  };
}

/**
 * The streak as it stands today. It survives until the end of the day after
 * the last solve — missing yesterday is what breaks it, not failing to have
 * solved today yet.
 */
export function currentStreak(p: DailyProgress, today: string): number {
  if (p.last === null) return 0;
  const gap = dayNumber(today) - dayNumber(p.last);
  return gap === 0 || gap === 1 ? p.streak : 0;
}

/**
 * How the attempts looked, for the line a player pastes into a chat: one
 * square per failed try, then the solve. No board, so nothing is spoiled.
 */
export function tryMarks(tries: number): string {
  return '🟫'.repeat(Math.min(Math.max(tries - 1, 0), 9)) + '🟩';
}
