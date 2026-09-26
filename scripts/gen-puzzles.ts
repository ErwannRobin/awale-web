// Finds puzzle positions the solver can PROVE, for the challenge list and the
// daily puzzle.
//
//   npm run puzzles:generate -- mine <seed> <games> <out.jsonl>
//   npm run puzzles:generate -- pick <out-dir> <in.jsonl>...
//
// `mine` plays self-play games (part engine, part random, so the positions look
// like real games and not like the engine's own favourite lines), stops on
// North's turns, and asks `solveWithin` whether North can force a win in 2
// moves, then 3, and so on. A candidate is kept only when every answer on the
// way was exact — the budget never ran out — so its length is the true
// shortest forced win and can be printed on the puzzle. Seeds make a run
// reproducible; several seeds in parallel processes make it quick.
//
// `pick` reads every mined file, removes duplicates, sorts what is left into
// three tiers, and writes `daily.json` into the given directory. The challenge
// positions are chosen by hand from the same candidates, because each one
// needs goal text a person has written — and should then be removed from the
// mined files before a pick, so no position is both a challenge and a daily.
//
// Level 2 is the one level whose search depth drifts during a game (4 to 6
// plies, by how fast the device is), so a level-2 candidate has to beat every
// reply the AI could give at any of those depths — see `replies` in
// `solveWithin`.
import { appendFileSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AwaleAI } from '../src/lib/ai.ts';
import { distribute } from '../src/lib/engine.ts';
import {
  aiReplyAtDepth, legalMoves, solveWithin, step, HUMAN, type Position,
} from './challenges.ts';

/** Small, fast, seedable — so a run can be reproduced from its seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Candidate {
  level: number;
  scores: [number, number];
  pits: number[];
  /** Legal first moves, and how many of them force the win in `len` moves. */
  n: number;
  w: number;
  winning: number[];
  /** Fewest of the player's own moves that force the win (exact). */
  len: number;
  /** The biggest immediate capture on offer is not a winning move. */
  greedyFails: boolean;
  /** Seeds the player trails by (negative = ahead). */
  behind: number;
  onBoard: number;
  nodes: number;
}

const LEVEL_DEPTHS: Record<number, number[]> = { 0: [2], 1: [3], 2: [4, 5, 6] };

const repliesFor = (level: number) => (pits: number[], scores: number[]) =>
  LEVEL_DEPTHS[level].map(d => aiReplyAtDepth(pits, scores, d));

function greedyMove(pits: number[], scores: number[]): number {
  let best = -1, bestGain = -1;
  for (const mv of legalMoves(pits, HUMAN)) {
    const p = [...pits], s = [...scores];
    distribute(p, s, mv);
    const gain = s[HUMAN] - scores[HUMAN];
    if (gain > bestGain) { bestGain = gain; best = mv; }
  }
  return best;
}

const BUDGET = 40_000;
const MAX_LEN = 8;

/**
 * Is this a puzzle, and if so, what kind? Null for anything unproved or dull.
 *
 * Asks "can the player force a win in 1 move? 2? 3?…" and stops at the first
 * yes. Every no on the way is exact (see `solveWithin`), so `len` is the true
 * shortest forced win and `w` the exact count of first moves that achieve it —
 * both safe to print on the puzzle. A position whose search runs out of budget
 * before an answer is simply skipped.
 */
export function assess(pits: number[], scores: [number, number], level: number): Candidate | null {
  const first = legalMoves(pits, HUMAN);
  if (first.length < 2) return null;
  // A first move that ends the game on the spot is not a puzzle.
  for (const mv of first) if (step(pits, scores, HUMAN, mv).over) return null;

  const pos: Position = { pits, scores, level };
  const replies = repliesFor(level);
  let nodes = 0;
  for (let len = 2; len <= MAX_LEN; len++) {
    const r = solveWithin(pos, len, { nodeBudget: BUDGET, replies });
    nodes += r.nodes;
    if (r.budgetHit) return null;
    if (!r.solvable) continue;
    if (r.winningFirstMoves.length === first.length) return null;
    return {
      level, scores, pits,
      n: first.length,
      w: r.winningFirstMoves.length,
      winning: r.winningFirstMoves,
      len,
      greedyFails: !r.winningFirstMoves.includes(greedyMove(pits, scores)),
      behind: scores[0] - scores[1],
      onBoard: pits.reduce((a, b) => a + b, 0),
      nodes,
    };
  }
  return null;
}

function mine(seed: number, games: number, out: string): void {
  const rng = mulberry32(seed);
  const seen = new Set<string>();
  let kept = 0;
  // Written as found, so a long run can be stopped at any point and still
  // leave everything it proved behind.
  writeFileSync(out, '');

  for (let g = 0; g < games; g++) {
    let pits = Array(12).fill(4) as number[];
    let scores: [number, number] = [0, 0];
    let turn: 0 | 1 = rng() < 0.5 ? 0 : 1;
    const levels: [number, number] = [Math.floor(rng() * 3), Math.floor(rng() * 3)];
    const noise = 0.15 + rng() * 0.35;

    for (let ply = 0; ply < 160; ply++) {
      const moves = legalMoves(pits, turn);
      if (moves.length === 0) break;

      if (turn === HUMAN && ply >= 16) {
        const onBoard = pits.reduce((a, b) => a + b, 0);
        const key = `${pits.join(',')}|${scores.join(',')}`;
        if (onBoard >= 7 && onBoard <= 30 && scores[0] < 25 && scores[1] < 25
            && !seen.has(key) && rng() < 0.25) {
          seen.add(key);
          // Level 1 first. A position it survives is worth trying against the
          // deeper level 2; one it does not is worth trying against level 0.
          const mid = assess(pits, scores, 1);
          for (const c of [mid, assess(pits, scores, mid ? 2 : 0)]) {
            if (c) { appendFileSync(out, JSON.stringify(c) + '\n'); kept++; }
          }
        }
      }

      const move = rng() < noise
        ? moves[Math.floor(rng() * moves.length)]
        : new AwaleAI(levels[turn]).bestMove(pits, scores, turn, rng);
      if (move == null) break;
      const st = step(pits, scores, turn, move);
      if (st.over) break;
      pits = st.pits;
      scores = [st.scores[0], st.scores[1]];
      turn = st.turn;
    }
    if (g % 20 === 0) console.log(`seed ${seed}: game ${g}/${games}, ${kept} kept`);
  }
  console.log(`seed ${seed}: ${kept} candidates → ${out}`);
}

/**
 * The daily pool's three tiers, easiest first — see `lib/daily.ts`.
 *
 * Length is what a person feels most: a short forced win can be seen, a long
 * one has to be played out. So the easy tier is short lines against the two
 * weaker levels, and the hard tier is long lines with a single way in.
 */
function tierOf(c: Candidate): 0 | 1 | 2 | null {
  if (c.level <= 1 && c.len >= 2 && c.len <= 4 && c.w * 2 <= c.n) return 0;
  if (c.level >= 1 && c.w === 1 && c.n >= 3 && c.len >= 5) return 2;
  if (c.len >= 4 && c.len <= 7 && c.w <= 2 && c.w < c.n) return 1;
  return null;
}

function pick(outDir: string, inputs: string[]): void {
  const all: Candidate[] = [];
  const seen = new Set<string>();
  for (const file of inputs) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const c = JSON.parse(line) as Candidate;
      const key = `${c.level}|${c.pits.join(',')}|${c.scores.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(c);
    }
  }
  // A position appears at most once in the whole pool, whatever its level.
  const used = new Set<string>();
  const tiers: Candidate[][] = [[], [], []];
  // Hardest tier first, so the scarcest positions go where they are needed.
  for (const t of [2, 1, 0] as const) {
    const pool = all
      .filter(c => tierOf(c) === t && !used.has(`${c.pits.join(',')}|${c.scores.join(',')}`))
      .sort((a, b) => (b.len - a.len) || (a.w / a.n - b.w / b.n) || (b.behind - a.behind));
    for (const c of pool) {
      const key = `${c.pits.join(',')}|${c.scores.join(',')}`;
      if (used.has(key)) continue;
      used.add(key);
      tiers[t].push(c);
    }
  }
  const rng = mulberry32(2026);
  const shuffle = <T>(xs: T[]) => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  };
  // A year of Mondays-and-Tuesdays (and of weekends) before an easy (or hard)
  // puzzle comes round again; the middle tier, three days a week, 35 weeks.
  const CAP = 104;
  const daily = tiers.map(tier => shuffle(tier.slice(0, CAP)).map(c => ({
    l: c.level, s: c.scores, p: c.pits, m: c.len,
  })));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'daily.json'), JSON.stringify(daily).replace(/\],\[/g, '],\n[') + '\n');
  console.log(`tiers: ${tiers.map(t => t.length).join(' / ')} → ${daily.map(t => t.length).join(' / ')} kept`);
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'mine') mine(Number(args[0] ?? 1), Number(args[1] ?? 100), args[2] ?? 'candidates.jsonl');
else if (mode === 'pick') pick(args[0], args.slice(1));
else console.log('usage: gen-puzzles mine <seed> <games> <out> | pick <out-dir> <in>...');
