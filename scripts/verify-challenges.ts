// Quality gate for the challenge positions and the daily puzzle pool.
//
//   npm run verify:challenges
//
// Checks two things per position:
//  1. Seed conservation. Pits + both stores must total 48 — four of the
//     original twelve did not, and one had 71 seeds on a 48-seed board.
//  2. Solvability. The human (North, moving first) must have a line that beats
//     the configured AI. The search reports `exhausted` when it hit a limit, in
//     which case a "no" is "not found", not "impossible" — those are warnings,
//     not failures, so the gate never blocks on search budget alone.
import {
  aiReplyAtDepth, legalMoves, solve, solveWithin, seedTotal, step, HUMAN, type Position,
} from './challenges.ts';
import challenges from '../src/content/challenges.json' with { type: 'json' };
import daily from '../src/content/daily.json' with { type: 'json' };

interface Entry { levelIA?: number; scores: [number, number]; pits: number[] }

const NODE_BUDGET = Number(process.env.AWALE_NODE_BUDGET ?? 400_000);

/** The search depths each puzzle level can play at — see `AwaleAI`. */
const DEPTHS: Record<number, number[]> = { 0: [2], 1: [3], 2: [4, 5, 6] };
const only = process.argv[2] ? Number(process.argv[2]) : null;

let failures = 0;
let warnings = 0;

(challenges as Entry[]).forEach((c, i) => {
  const n = i + 1;
  if (only !== null && only !== n) return;

  const pos: Position = { pits: c.pits, scores: c.scores, level: c.levelIA ?? 1 };

  const total = seedTotal(pos);
  if (total !== 48) {
    console.error(`FAIL #${n}: ${total} seeds, expected 48`);
    failures++;
    return;
  }
  if (c.pits.length !== 12 || c.pits.some(v => v < 0)) {
    console.error(`FAIL #${n}: malformed pits`);
    failures++;
    return;
  }

  const t0 = Date.now();

  // Shortest lines first. A depth-first search with no limit can spend its
  // whole budget down one long line while a win sits four moves away, so ask
  // "a forced win in 2? 3? …" before the open-ended search. Level 2 is held to
  // every depth its search can drift to; the other levels never move.
  const replies = pos.level === 2
    ? (p: number[], s: number[]) => DEPTHS[2].map(d => aiReplyAtDepth(p, s, d))
    : undefined;
  let quick: { len: number; w: number; n: number } | null = null;
  for (let len = 2; len <= 10 && !quick; len++) {
    const b = solveWithin(pos, len, { nodeBudget: NODE_BUDGET, replies });
    if (b.solvable) quick = { len, w: b.winningFirstMoves.length, n: b.firstMoves.length };
    else if (b.budgetHit) break;
  }
  if (quick) {
    const ms = Date.now() - t0;
    console.log(`ok   #${n} lvl ${pos.level} — forced win in ${quick.len}, ${quick.w}/${quick.n} first moves (${ms}ms)`);
    return;
  }

  const r = solve(pos, { nodeBudget: NODE_BUDGET });
  const ms = Date.now() - t0;
  const shape = `${r.winningFirstMoves.length}/${r.firstMoves.length} first moves win`;

  if (r.solvable) {
    console.log(`ok   #${n} lvl ${pos.level} — ${shape} (${r.nodes} nodes, ${ms}ms)`);
  } else if (r.exhausted) {
    console.warn(`warn #${n} lvl ${pos.level} — no win found within ${NODE_BUDGET} nodes (${ms}ms). Inconclusive.`);
    warnings++;
  } else {
    console.error(`FAIL #${n} lvl ${pos.level} — proved unwinnable for the player (${r.nodes} nodes)`);
    failures++;
  }
});

// ---- the daily pool --------------------------------------------------------
//
// Each entry promises, on screen, that the player "can force the win in m
// moves". That is checked exactly, both ways: a forced win within m moves
// exists, and none within m − 1 (so the number is the shortest, not just a
// true one). Level 2 must hold against every depth its search can drift to.
interface DailyEntry { l: number; s: [number, number]; p: number[]; m: number }
const DAILY_BUDGET = 400_000;

if (only === null) {
  let checked = 0;
  const seen = new Set<string>();
  (daily as DailyEntry[][]).forEach((tier, t) => {
    if (tier.length === 0) { console.error(`FAIL daily tier ${t} is empty`); failures++; }
    tier.forEach((e, i) => {
      const name = `daily ${t}.${i}`;
      const pos: Position = { pits: e.p, scores: e.s, level: e.l };
      const key = `${e.p.join(',')}|${e.s.join(',')}`;
      if (seen.has(key)) { console.error(`FAIL ${name}: duplicate position`); failures++; return; }
      seen.add(key);
      if (seedTotal(pos) !== 48 || e.p.length !== 12 || e.p.some(v => v < 0)) {
        console.error(`FAIL ${name}: not a 48-seed board`); failures++; return;
      }
      if (!(e.l in DEPTHS)) { console.error(`FAIL ${name}: level ${e.l} is not a puzzle level`); failures++; return; }
      if (legalMoves(e.p, HUMAN).some(mv => step(e.p, e.s, HUMAN, mv).over)) {
        console.error(`FAIL ${name}: a first move ends the game`); failures++; return;
      }
      const replies = (p: number[], s: number[]) => DEPTHS[e.l].map(d => aiReplyAtDepth(p, s, d));
      const at = solveWithin(pos, e.m, { nodeBudget: DAILY_BUDGET, replies });
      const before = solveWithin(pos, e.m - 1, { nodeBudget: DAILY_BUDGET, replies });
      if (!at.solvable) {
        console.error(`FAIL ${name}: no forced win in ${e.m} moves${at.budgetHit ? ' found (budget)' : ''}`);
        failures++;
      } else if (before.solvable) {
        console.error(`FAIL ${name}: also wins in ${e.m - 1} moves — the stated length is not the shortest`);
        failures++;
      } else if (before.budgetHit) {
        console.warn(`warn ${name}: could not rule out a win in ${e.m - 1} moves`);
        warnings++;
      }
      checked++;
    });
  });
  console.log(`daily: ${checked} positions checked across ${(daily as DailyEntry[][]).map(t => t.length).join(' / ')}`);
}

console.log(`\n${failures} failures, ${warnings} inconclusive`);
if (failures > 0) process.exit(1);
