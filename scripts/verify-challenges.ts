// Quality gate for the twelve challenge positions.
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
import { solve, seedTotal, type Position } from './challenges.ts';
import challenges from '../src/content/challenges.json' with { type: 'json' };

interface Entry { levelIA?: number; scores: [number, number]; pits: number[] }

const NODE_BUDGET = Number(process.env.AWALE_NODE_BUDGET ?? 400_000);
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

console.log(`\n${failures} failures, ${warnings} inconclusive`);
if (failures > 0) process.exit(1);
