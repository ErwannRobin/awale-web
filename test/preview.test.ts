// The landing pit the board points at must be the pit the move actually fills
// last. Every case here checks `landingPit` against `applyMove` — the code
// that really plays the move — so the two can never drift apart.
import { landingPit } from '../src/lib/preview.ts';
import { applyMove, legalMoves, type Seat } from '../src/lib/rules.ts';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else { fail++; console.error(`FAIL ${name}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) pass++;
  else { fail++; console.error(`FAIL ${name}\n  got  ${a}\n  want ${b}`); }
}

const fresh = () => Array(12).fill(4) as number[];

// ---- the basics ---------------------------------------------------------
eq('opening move · four seeds land in pit 4', landingPit(fresh(), 0), 4);
eq('a single seed lands next door', landingPit([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0), 1);
eq('sowing wraps past the last pit', landingPit([0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0], 5), 8);
// Eleven seeds fill the other eleven pits; the twelfth would be the pit itself,
// which sowing skips, so a twelfth seed goes one further.
eq('a lap skips the pit it came from', landingPit([12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0), 1);
eq('an empty pit has no landing pit', landingPit(fresh().fill(0), 3), 3);

// ---- it agrees with the real move, everywhere ---------------------------
{
  let seed = 12345;
  const rnd = (n: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed % n;
  };

  let checked = 0, mismatches = 0;
  for (let trial = 0; trial < 4000; trial++) {
    // Scatter 48 seeds at random across the twelve pits and the two stores.
    const pits = Array(12).fill(0) as number[];
    const scores = [0, 0];
    for (let s = 0; s < 48; s++) {
      const slot = rnd(14);
      if (slot < 12) pits[slot]++; else scores[slot - 12]++;
    }
    const seat = rnd(2) as Seat;
    for (const move of legalMoves(pits, seat)) {
      const real = applyMove(pits, scores, move);
      checked++;
      if (landingPit(pits, move) !== real.sowed[real.sowed.length - 1]) mismatches++;
    }
  }
  ok('random positions were actually exercised', checked > 2000);
  eq('landing pit matches the played move in every case', mismatches, 0);
}

// ---- it never touches the position it is given --------------------------
{
  const pits = fresh();
  const copy = [...pits];
  landingPit(pits, 3);
  eq('landingPit is pure', pits, copy);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
