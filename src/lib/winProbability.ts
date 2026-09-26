// The win-probability bar: how likely the side to move is to win from here.
//
// A search score is seeds, not odds. A lead of four seeds is nearly nothing
// with forty on the board and nearly everything with six, so the model reads
// the evaluation against how much is still in play:
//
//   P(win) = 1 / (1 + e^(−k · eval / √(seeds on board + c)))
//
// with a draw counted as half a win. `k` and `c` are not chosen by hand: they
// are fitted by `scripts/calibrate-winprob.ts` to the outcomes of thousands of
// self-play games between players of every strength, and the fit is checked
// for calibration — of the positions it calls 70%, about 70% were won.
//
// Two positions need no model at all: a lead bigger than every seed left on
// the board cannot be caught.

export interface WinModel {
  k: number;
  c: number;
}

/**
 * Fitted by `npm run winprob:calibrate` on 123,675 positions from about 1,450
 * self-play games (seeds 101, 202, 303, 404; each side at its own depth, 2–7,
 * with random moves mixed in). Log loss 0.473, against 0.693 for a coin flip.
 * Calibration on the same data, predicted → actually won:
 *
 *    4.5% →  4.1%   25.0% → 25.3%   52.2% → 51.8%   74.9% → 74.5%   95.7% → 96.0%
 *
 * Re-fit whenever `evaluate`, `EVAL_DEPTH` or the rules change: the numbers
 * describe that search, not awalé in general.
 */
export const WIN_MODEL: WinModel = { k: 1.75, c: 20 };

/**
 * P(the side to move wins), draws counting half.
 *
 * @param e  the evaluation for the side to move (`ai.evaluate`)
 * @param r  seeds still on the board
 * @param d  banked seeds now, side to move minus the other
 */
export function winProbability(e: number, r: number, d: number, model: WinModel = WIN_MODEL): number {
  if (d > r) return 1;
  if (-d > r) return 0;
  if (r <= 0) return d > 0 ? 1 : d < 0 ? 0 : 0.5;
  return 1 / (1 + Math.exp(-model.k * e / Math.sqrt(r + model.c)));
}
