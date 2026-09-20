// Move preview — "if I play this pit, where do the seeds land?"
//
// Pure, and deliberately separate from `rules.ts`: a preview must never touch
// the real position, and it stops short of the end-of-game folding that
// `applyMove` does, because a preview only answers a question about sowing and
// capture. It is built on the same `distribute` the real move uses, so the
// arrows the player sees and the seeds they get can never disagree.
import { distribute, owner } from './engine.ts';

export interface MovePreview {
  /** The pit being previewed. */
  source: number;
  /** Seeds each pit would receive, indexed by pit (0 where nothing lands). */
  gain: number[];
  /** Pit contents after sowing, before any capture. */
  after: number[];
  /** Where the last seed lands. */
  last: number;
  /** Pits the move would empty into the store, last-sown first. */
  captured: number[];
  /** Total seeds the move would add to the mover's store. */
  capturedSeeds: number;
  /** Which side collects those seeds. */
  mover: 0 | 1;
}

/**
 * Work out what playing `pit` would do. The caller is expected to have checked
 * the move is legal; an empty pit simply previews nothing.
 */
export function previewMove(pits: number[], pit: number): MovePreview {
  const mover = owner(pit) as 0 | 1;
  const work = [...pits];
  const scores = [0, 0];
  const gain = Array(12).fill(0) as number[];

  const result = distribute(work, scores, pit);
  for (const idx of result.sowed) gain[idx]++;

  // Rebuild the post-sow board ourselves: `distribute` has already emptied the
  // captured pits in `work`, and it may have folded the rest away on a
  // game-ending move.
  const after = [...pits];
  after[pit] = 0;
  for (let i = 0; i < 12; i++) after[i] += gain[i];

  const capturedSeeds = result.captured.reduce((sum, c) => sum + after[c], 0);
  const last = result.sowed.length > 0 ? result.sowed[result.sowed.length - 1] : pit;

  return { source: pit, gain, after, last, captured: result.captured, capturedSeeds, mover };
}
