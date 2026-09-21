// Where would this move's last seed land?
//
// That one pit is the whole preview. Showing the entire future distribution —
// every pit that gains a seed, every pit that would be swept — turns a glance
// into a reading exercise, which is the opposite of the point.
//
// Pure, and deliberately apart from `rules.ts`: a preview must never touch the
// real position. The walk below is the same one `engine.distribute` does, and
// `test/preview.test.ts` holds the two to each other.

/**
 * The pit the last seed of `pit` falls into. Sowing runs counterclockwise
 * through the twelve pits and skips the pit it came from, so a handful big
 * enough to lap the board passes its own hole by.
 *
 * An empty pit has no last seed; it answers with itself.
 */
export function landingPit(pits: number[], pit: number): number {
  let left = pits[pit];
  let j = pit;
  while (left > 0) {
    j = (j + 1) % 12;
    if (j !== pit) left--;
  }
  return j;
}
