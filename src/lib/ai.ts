import { owner, isValid, distribute, WINNING_SCORE } from './engine.ts';

// Negamax with alpha-beta. Legacy quirk to KEEP: at the depth horizon the move i
// itself is NOT applied — the leaf evaluates the parent's position.
//
// `alpha`/`beta` bound the value the caller still cares about. Callers that want
// an exact score (the root, and the tests) pass the default full window; the
// recursion narrows it to skip replies that are already refuted. Pruning never
// changes the value returned through a full window, so every level plays the
// same moves it did before — it just reaches them far deeper per second.
export function value(pits: number[], scores: number[], i: number, ply: number, depth: number,
                      alpha = -100, beta = 100): number {
  const p = [...pits], s = [...scores];
  const me = owner(i), other = 1 - me;
  if (ply + 1 < depth) {
    const r = distribute(p, s, i);
    // The game also stops the moment someone banks 25 — searching past that
    // would let the AI trade a win away for a bigger final margin.
    if (r.running && s[me] < WINNING_SCORE && s[other] < WINNING_SCORE) {
      // Horizon collapse. Children at ply + 1 === depth skip their own move, so
      // they all return the same parent-relative score, s[other] - s[me]; this
      // node negates that back to s[me] - s[other]. Expanding them cost ~5x the
      // nodes for zero information. Only "is there a reply at all?" matters,
      // because no reply leaves `best` at the -100 sentinel below.
      if (ply + 2 === depth) {
        for (let j = other * 6; j < other * 6 + 6; j++)
          if (isValid(p, j)) return s[me] - s[other];
        return 100;
      }
      // We return -best, so the caller's alpha becomes an upper bound on best.
      let best = -100;
      const cut = -alpha;
      for (let j = other * 6; j < other * 6 + 6; j++)
        if (isValid(p, j)) {
          const v = value(p, s, j, ply + 1, depth, Math.max(best, -beta), cut);
          if (v > best) best = v;
          if (best >= cut) break;   // the caller already has a better line
        }
      return -best;
    }
  }
  return s[me] - s[other];
}

// Tie-breaker: how many moves can I stall before being forced to feed the opponent?
export function delay2(pits: number[], scores: number[], i: number, ply: number, depth: number): number {
  const p = [...pits], s = [...scores];
  const me = owner(i), i0 = me * 6;
  if (i + p[i] > i0 + 5) return 0;
  if (ply < depth) {
    distribute(p, s, i);
    let d = 0;
    for (let j = i0 + 5; j >= i0; j--)
      if (p[j] !== 0 && d === 0) d = Math.max(d, delay2(p, s, j, ply + 1, depth));
    return d + 1;
  }
  let d = 0;
  for (let j = i0 + 5; j >= i0; j--) if (p[j] !== 0 && j + p[j] < i0 + 5) d++;
  return d;
}

/** How deep the win-probability bar looks. Measured at a few milliseconds. */
export const EVAL_DEPTH = 9;

/**
 * How the position stands for `player`, who is to move: the score difference
 * (their seeds minus the opponent's, banked ones included) that the search
 * expects at its horizon after their best move. The same `value` every level
 * plays with, so the bar and the Master agree about a position. Null when
 * `player` has no legal move — the game is over, and the scores say how.
 */
export function evaluate(pits: number[], scores: number[], player: 0 | 1, depth = EVAL_DEPTH): number | null {
  let best: number | null = null;
  for (let j = player * 6; j < player * 6 + 6; j++) {
    if (!isValid(pits, j)) continue;
    const v = value(pits, scores, j, 0, depth);
    if (best === null || v > best) best = v;
  }
  return best;
}

export class AwaleAI {
  private depths = [2, 3, 4, 5];
  private budgets = [0.01, 0.1, 0.5, 1.0]; // seconds per level
  readonly level: number;                  // 0 (weakest) .. 3 (strongest)
  constructor(level: number) { this.level = level; }

  // `value()` only applies the candidate move when ply + 1 < depth, so a depth
  // below 2 evaluates the position BEFORE the move and every move scores the
  // same. The original clamp let level 0 fall to depth 0, which is why Novice
  // used to ignore captures entirely; MIN_DEPTH keeps every level playing.
  private static readonly MIN_DEPTH = 2;

  // Per-level depth ceilings. Levels 0-2 are pinned where they have always been
  // — they are meant to be beatable, and alpha-beta must not silently promote
  // them. Expert used to share the 3 * level formula, which capped it at 9: with
  // the old plain search that was already ~0.7s, but with pruning depth 9 costs
  // ~20ms, so the ceiling, not the time budget, was holding Expert back. 14 is
  // what the 1s budget actually buys now.
  private static readonly CEILINGS = [2, 3, 6, 14];

  private clampDepth(): number {
    const d = Math.min(Math.max(this.depths[this.level], AwaleAI.MIN_DEPTH), AwaleAI.CEILINGS[this.level]);
    this.depths[this.level] = d;
    return d;
  }

  bestMove(pits: number[], scores: number[], player: 0 | 1, rng: () => number = Math.random): number | null {
    const off = player * 6;
    if (pits.every(x => x === 4)) {        // weighted-random opening book
      const h = Math.floor(rng() * 100);
      const pit = h < 20 ? 5 : h < 40 ? 4 : h < 60 ? 3 : h < 80 ? 2 : h < 95 ? 1 : 0;
      return pit + off;
    }
    const depth = this.clampDepth();

    const moves: number[] = [];
    for (let j = off; j < off + 6; j++) if (isValid(pits, j)) moves.push(j);
    if (moves.length === 0) return null;
    if (moves.length === 1) return moves[0];

    const t0 = performance.now();
    let bestValue = -100; const values = new Map<number, number>();
    for (const j of moves) { const v = value(pits, scores, j, 0, depth); values.set(j, v); bestValue = Math.max(bestValue, v); }
    let move = moves[moves.length - 1], bestDelay = -100;
    for (const j of moves) if (values.get(j) === bestValue) {
      const d = delay2(pits, scores, j, 0, depth);
      if (d > bestDelay) { bestDelay = d; move = j; }
    }
    const secs = (performance.now() - t0) / 1000;   // self-tuning depth per level
    const budget = this.budgets[this.level];
    // Cost roughly quadruples per ply, so a big overshoot needs more than one
    // step back — otherwise a single bushy position stalls the board for
    // several moves in a row while the depth creeps down one ply at a time.
    if (secs > budget) this.depths[this.level] -= secs > budget * 4 ? 2 : 1;
    if (secs < budget / 6) this.depths[this.level]++;
    this.clampDepth();                              // never drift below MIN_DEPTH
    return move;
  }
}
// Keep ONE AwaleAI instance per game (the self-tuning depth is stateful).
