import { owner, isValid, distribute } from './engine';

// Plain negamax. Legacy quirk to KEEP: at the depth horizon the move i itself is NOT
// applied — the leaf evaluates the parent's position.
export function value(pits: number[], scores: number[], i: number, ply: number, depth: number): number {
  const p = [...pits], s = [...scores];
  const me = owner(i), other = 1 - me;
  if (ply + 1 < depth) {
    const r = distribute(p, s, i);
    if (r.running) {
      let best = -100;
      for (let j = other * 6; j < other * 6 + 6; j++)
        if (isValid(p, j)) best = Math.max(best, value(p, s, j, ply + 1, depth));
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

export class AwaleAI {
  private depths = [2, 3, 4, 5];
  private budgets = [0.01, 0.1, 0.5, 1.0]; // seconds per level
  constructor(readonly level: number) {}   // 0 (weakest) .. 3 (strongest)

  bestMove(pits: number[], scores: number[], player: 0 | 1, rng: () => number = Math.random): number | null {
    const off = player * 6;
    if (pits.every(x => x === 4)) {        // weighted-random opening book
      const h = Math.floor(rng() * 100);
      const pit = h < 20 ? 5 : h < 40 ? 4 : h < 60 ? 3 : h < 80 ? 2 : h < 95 ? 1 : 0;
      return pit + off;
    }
    // Legacy depth clamp — KEEP INCLUDING the quirk that forces level 0 to depth 0 (greedy):
    if (this.depths[this.level] > 3 * this.level) this.depths[this.level] = 3 * this.level;
    else if (this.depths[this.level] <= 1) this.depths[this.level] = 2;
    const depth = this.depths[this.level];

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
    if (secs > this.budgets[this.level]) this.depths[this.level]--;
    if (secs < this.budgets[this.level] / 6) this.depths[this.level]++;
    return move;
  }
}
// Keep ONE AwaleAI instance per game (the self-tuning depth is stateful).
