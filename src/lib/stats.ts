// Player record: results, streaks, per-level breakdown and an Elo rating.
//
// Everything is local. There is no server, so the rating measures you against
// the four AI levels only — it is a personal progress number, not a ladder
// position. See `docs` in the Stats screen for how that is worded to the user.
import { getStore } from './storage.ts';

const KEY = 'awale.stats.v2';

export const LEVEL_COUNT = 4;

/** Fixed strength estimates for the four AI levels, used as Elo opponents. */
export const LEVEL_RATING = [900, 1150, 1400, 1650];

export const START_RATING = 1000;
const K_FACTOR = 24;

export type Outcome = 'win' | 'loss' | 'draw';

export interface GameRecord {
  at: number;                 // epoch ms
  level: number;              // 0..3
  outcome: Outcome;
  you: number;                // your captured seeds
  them: number;
  ratingBefore: number;
  ratingAfter: number;
}

export interface LevelTally { games: number; wins: number; losses: number; draws: number }

export interface Stats {
  rating: number;
  peakRating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number;             // current consecutive wins (0 if the last game was not a win)
  bestStreak: number;
  seedsCaptured: number;
  bestMargin: number;         // largest winning margin
  byLevel: LevelTally[];
  history: GameRecord[];      // most recent first, capped
}

const HISTORY_CAP = 50;

const emptyTally = (): LevelTally => ({ games: 0, wins: 0, losses: 0, draws: 0 });

export function emptyStats(): Stats {
  return {
    rating: START_RATING,
    peakRating: START_RATING,
    games: 0, wins: 0, losses: 0, draws: 0,
    streak: 0, bestStreak: 0,
    seedsCaptured: 0, bestMargin: 0,
    byLevel: Array.from({ length: LEVEL_COUNT }, emptyTally),
    history: [],
  };
}

const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);

// Stored stats are user-editable JSON; rebuild rather than trust the blob.
function coerce(raw: unknown): Stats {
  const d = emptyStats();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  const byLevel = Array.isArray(o.byLevel) ? o.byLevel : [];
  const history = Array.isArray(o.history) ? o.history : [];
  return {
    rating: num(o.rating, d.rating),
    peakRating: num(o.peakRating, num(o.rating, d.rating)),
    games: num(o.games, 0),
    wins: num(o.wins, 0),
    losses: num(o.losses, 0),
    draws: num(o.draws, 0),
    streak: num(o.streak, 0),
    bestStreak: num(o.bestStreak, 0),
    seedsCaptured: num(o.seedsCaptured, 0),
    bestMargin: num(o.bestMargin, 0),
    byLevel: Array.from({ length: LEVEL_COUNT }, (_, i) => {
      const t = (byLevel[i] ?? {}) as Record<string, unknown>;
      return {
        games: num(t.games, 0), wins: num(t.wins, 0),
        losses: num(t.losses, 0), draws: num(t.draws, 0),
      };
    }),
    history: history
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .slice(0, HISTORY_CAP)
      .map(r => ({
        at: num(r.at, 0),
        level: Math.min(LEVEL_COUNT - 1, Math.max(0, num(r.level, 0))),
        outcome: r.outcome === 'win' || r.outcome === 'loss' ? r.outcome : 'draw',
        you: num(r.you, 0),
        them: num(r.them, 0),
        ratingBefore: num(r.ratingBefore, START_RATING),
        ratingAfter: num(r.ratingAfter, START_RATING),
      })),
  };
}

export function loadStats(): Stats {
  try {
    const raw = getStore().get(KEY);
    return coerce(raw ? JSON.parse(raw) : null);
  } catch {
    return emptyStats();
  }
}

export function saveStats(stats: Stats): void {
  getStore().set(KEY, JSON.stringify(stats));
}

export function resetStats(): Stats {
  const s = emptyStats();
  saveStats(s);
  return s;
}

/** Standard Elo expectation for `rating` against `opponent`. */
export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

const SCORE: Record<Outcome, number> = { win: 1, draw: 0.5, loss: 0 };

/**
 * Fold one finished game into the record and return the new stats. Pure apart
 * from reading the clock, so tests can pass `at` explicitly.
 */
export function applyResult(
  prev: Stats,
  { level, outcome, you, them, at = Date.now() }:
  { level: number; outcome: Outcome; you: number; them: number; at?: number },
): Stats {
  const lvl = Math.min(LEVEL_COUNT - 1, Math.max(0, Math.round(level)));
  const expected = expectedScore(prev.rating, LEVEL_RATING[lvl]);
  const ratingAfter = Math.round(prev.rating + K_FACTOR * (SCORE[outcome] - expected));

  const byLevel = prev.byLevel.map((t, i) => (i === lvl
    ? {
        games: t.games + 1,
        wins: t.wins + (outcome === 'win' ? 1 : 0),
        losses: t.losses + (outcome === 'loss' ? 1 : 0),
        draws: t.draws + (outcome === 'draw' ? 1 : 0),
      }
    : t));

  const streak = outcome === 'win' ? prev.streak + 1 : 0;
  const record: GameRecord = {
    at, level: lvl, outcome, you, them,
    ratingBefore: prev.rating, ratingAfter,
  };

  return {
    rating: ratingAfter,
    peakRating: Math.max(prev.peakRating, ratingAfter),
    games: prev.games + 1,
    wins: prev.wins + (outcome === 'win' ? 1 : 0),
    losses: prev.losses + (outcome === 'loss' ? 1 : 0),
    draws: prev.draws + (outcome === 'draw' ? 1 : 0),
    streak,
    bestStreak: Math.max(prev.bestStreak, streak),
    seedsCaptured: prev.seedsCaptured + you,
    bestMargin: outcome === 'win' ? Math.max(prev.bestMargin, you - them) : prev.bestMargin,
    byLevel,
    history: [record, ...prev.history].slice(0, HISTORY_CAP),
  };
}

/** The AI level whose rating is closest to the player's — used by Quick Match. */
export function suggestedLevel(rating: number): number {
  let best = 0;
  for (let i = 1; i < LEVEL_RATING.length; i++) {
    if (Math.abs(LEVEL_RATING[i] - rating) < Math.abs(LEVEL_RATING[best] - rating)) best = i;
  }
  return best;
}

export interface RankTier { key: string; min: number }

/** Rating bands shown as a rank. Keys are looked up in the translation table. */
export const RANKS: RankTier[] = [
  { key: 'rank.seedling', min: 0 },
  { key: 'rank.sower', min: 950 },
  { key: 'rank.harvester', min: 1100 },
  { key: 'rank.strategist', min: 1250 },
  { key: 'rank.elder', min: 1400 },
  { key: 'rank.master', min: 1550 },
];

export function rankFor(rating: number): { tier: RankTier; index: number; next: RankTier | null } {
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) if (rating >= RANKS[i].min) index = i;
  return { tier: RANKS[index], index, next: RANKS[index + 1] ?? null };
}

export const winRate = (t: { games: number; wins: number }): number =>
  (t.games === 0 ? 0 : Math.round((t.wins / t.games) * 100));
