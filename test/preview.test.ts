// The move preview must promise exactly what the move delivers. Every case
// here checks the preview against `applyMove` — the code that actually plays
// the move — so the two can never drift apart.
import { previewMove } from '../src/lib/preview.ts';
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
{
  const p = previewMove(fresh(), 0);
  eq('opening move · four seeds sown', p.gain.reduce((a, b) => a + b, 0), 4);
  eq('opening move · pits 1-4 each gain one', p.gain.slice(0, 6), [0, 1, 1, 1, 1, 0]);
  eq('opening move · source empties', p.after[0], 0);
  eq('opening move · lands on pit 4', p.last, 4);
  eq('opening move · captures nothing', p.captured, []);
  eq('opening move · store gains nothing', p.capturedSeeds, 0);
  eq('opening move · mover is south', p.mover, 0);
}

// A pit holding more than 11 seeds laps the board and skips its own hole.
{
  const pits = [13, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
  const p = previewMove(pits, 0);
  eq('lap · source stays empty', p.after[0], 0);
  eq('lap · source gains nothing', p.gain[0], 0);
  eq('lap · two seeds in the first pit round', p.gain[1], 2);
  eq('lap · thirteen seeds placed', p.gain.reduce((a, b) => a + b, 0), 13);
}

// A capture: the last seed makes an opponent pit hold three, sweeping back
// through the pit before it, which holds two.
{
  const pits = [0, 0, 0, 0, 0, 2, 1, 2, 1, 0, 0, 0];
  const p = previewMove(pits, 5);
  eq('capture · sweeps both pits', p.captured.slice().sort(), [6, 7]);
  eq('capture · store gains five', p.capturedSeeds, 5);
  eq('capture · last seed lands in pit 7', p.last, 7);
}

// ---- preview agrees with the real move, everywhere ----------------------
// Random positions, both seats, every legal move: the preview's post-sow
// board minus its captures must be the board `applyMove` produces, and its
// store tally must be the score `applyMove` awards.
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
      const p = previewMove(pits, move);
      const real = applyMove(pits, scores, move);
      checked++;

      // Post-sow board, with the captured pits emptied.
      const expected = [...p.after];
      for (const c of p.captured) expected[c] = 0;

      // `applyMove` folds the remaining seeds away when the move ends the
      // game; only the still-running case has a board to compare.
      const boardOk = real.end !== null
        || JSON.stringify(expected) === JSON.stringify(real.pits);
      const storeOk = p.capturedSeeds === real.scores[seat] - scores[seat];
      const sowOk = JSON.stringify(p.captured.slice().sort())
        === JSON.stringify(real.captured.slice().sort());
      const lastOk = p.last === real.sowed[real.sowed.length - 1];

      if (!boardOk || !storeOk || !sowOk || !lastOk) {
        mismatches++;
        if (mismatches === 1) {
          console.error(`  first mismatch: pits=${JSON.stringify(pits)} move=${move}`);
        }
      }
    }
  }
  ok('random positions were actually exercised', checked > 2000);
  eq('preview matches the played move in every case', mismatches, 0);
}

// ---- the preview never touches the position it is given ------------------
{
  const pits = fresh();
  const copy = [...pits];
  previewMove(pits, 3);
  eq('previewMove is pure', pits, copy);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
