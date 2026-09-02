// Awalé (oware) rules engine — faithful port of a 15-year-old battle-tested C
// engine. The logic here is intentionally identical to the original; do not
// "improve" it, quirks included.

/** 48 seeds on the board, so 25 is an unassailable majority. */
export const WINNING_SCORE = 25;

export const owner = (pit: number) => Math.floor((pit % 12) / 6);

// Does playing pit i capture ALL the opponent's seeds? (empty pits count as "yes" —
// that exact quirk matters for the grand-slam rule below)
export function attacksAllSeeds(pits: number[], i: number): boolean {
  if (pits[i] === 0) return true;
  const p = [...pits]; const other = 1 - owner(i);
  let n = p[i]; p[i] = 0; let j = i;
  while (n > 0) { j = (j + 1) % 12; if (j !== i) { p[j]++; n--; } }
  let attacked = 0;
  while (j >= 0 && Math.floor(j / 6) === other && (p[j] === 2 || p[j] === 3)) { j--; attacked++; }
  if (attacked <= 4) {
    const nonEmpty = p.slice(other * 6, other * 6 + 6).filter(x => x !== 0).length;
    return attacked === nonEmpty;
  }
  return false;
}

export function isValid(pits: number[], i: number): boolean {
  if (pits[i] === 0) return false;
  const me = owner(i), i0 = me * 6, i1 = (1 - me) * 6;
  // A starving opponent must be fed if you can reach their row:
  const oppEmpty = pits.slice(i1, i1 + 6).every(x => x === 0);
  if (oppEmpty && i + pits[i] <= i0 + 5) return false;
  // Grand-slam prevention: capturing ALL opponent seeds is illegal if an alternative exists:
  if (attacksAllSeeds(pits, i)) {
    for (let j = i0; j < i0 + 6; j++) if (!attacksAllSeeds(pits, j)) return false;
  }
  return true;
}

export interface MoveResult { running: boolean; sowed: number[]; captured: number[]; }

// Mutates pits and scores. sowed = pit indices receiving a seed IN ORDER (drives the
// sowing animation). captured = pits emptied by capture, last-sown first.
export function distribute(pits: number[], scores: number[], i: number): MoveResult {
  const me = owner(i), other = 1 - me;
  const sowed: number[] = []; let n = pits[i]; pits[i] = 0; let j = i;
  while (n > 0) { j = (j + 1) % 12; if (j !== i) { pits[j]++; sowed.push(j); n--; } }
  const last = j; let attacked = 0;
  while (j >= 0 && Math.floor(j / 6) === other && (pits[j] === 2 || pits[j] === 3)) { j--; attacked++; }
  const captured: number[] = [];
  const firstKept = last - Math.min(attacked, 4);   // captures are CAPPED at 4 pits per move
  for (let k = last; k > firstKept; k--) { scores[me] += pits[k]; pits[k] = 0; captured.push(k); }
  return { running: !endGame(pits, scores, i), sowed, captured };
}

// Called after captures; on game end folds remaining seeds into scores. Three conditions:
export function endGame(pits: number[], scores: number[], i: number): boolean {
  const me = owner(i), other = 1 - me, i0 = me * 6, i1 = other * 6;
  if (pits.slice(i1, i1 + 6).every(x => x === 0)) {          // 1. opponent has nothing left
    for (let j = i0; j < i0 + 6; j++) scores[me] += pits[j];
    return true;
  }
  const reach = (2 - me) * 6;                                 // 2. mover empty & unfeedable
  if (pits.slice(i0, i0 + 6).every(x => x === 0)
      && [0,1,2,3,4,5].every(k => i1 + k + pits[i1 + k] < reach)) {
    for (let j = i1; j < i1 + 6; j++) scores[other] += pits[j];
    return true;
  }
  if (pits.slice(0, 5).every(x => x === 0) && pits.slice(6, 11).every(x => x === 0)
      && pits[5] === pits[11] && pits[5] < 6) {               // 3. cyclic: seeds orbit forever
    scores[me] += pits[5]; scores[other] += pits[5];
    return true;
  }
  return false;
}
