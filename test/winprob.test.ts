// The win-probability bar: the evaluation it reads, and the curve that turns
// that evaluation into odds.
import { evaluate } from '../src/lib/ai.ts';
import { winProbability, WIN_MODEL } from '../src/lib/winProbability.ts';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else { fail++; console.error(`FAIL ${name}`); }
}
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// ---- the curve ------------------------------------------------------------
ok('an even position is a coin flip', close(winProbability(0, 48, 0), 0.5));
for (const [e, r, d] of [[3, 40, 0], [7, 20, 4], [-5, 12, -2], [12, 30, 9]]) {
  ok(`the two sides add up to one (${e}, ${r})`, close(winProbability(e, r, d) + winProbability(-e, r, -d), 1));
}
ok('a better evaluation is better odds', winProbability(2, 30, 0) < winProbability(6, 30, 0));
ok('the same lead counts for more with fewer seeds left',
  winProbability(4, 40, 0) < winProbability(4, 8, 0));
ok('a lead bigger than the board cannot be caught', winProbability(-20, 6, 7) === 1);
ok('nor overturned from behind', winProbability(20, 6, -7) === 0);
ok('an empty board is decided by the scores', winProbability(0, 0, 0) === 0.5);
ok('the model has been fitted, not left at its placeholder', !(WIN_MODEL.k === 1 && WIN_MODEL.c === 0));
ok('and it never claims certainty from a search alone', winProbability(40, 48, 0) < 1);

// ---- the evaluation --------------------------------------------------------
{
  // South to move can take four seeds: pit 5 lands on 6 and 7. One ply sees
  // just that; the bar's full depth also sees North's heavy pits answer it,
  // which is the point of looking deeper.
  //              0  1  2  3  4  5  6  7  8  9 10 11
  const capture = [1, 1, 1, 1, 1, 2, 1, 1, 5, 5, 5, 5];
  ok('the capture itself is seen', evaluate(capture, [10, 10], 0, 2) === 4);
  const e = evaluate(capture, [10, 10], 0);
  ok('and the full search sees the reply to it', e !== null && e < 4);

  // The same position seen from the other chair reads the same, sign and all.
  const mirrored = [...capture.slice(6), ...capture.slice(0, 6)];
  ok('the evaluation does not care which seat is which', evaluate(mirrored, [10, 10], 1) === e);
}
ok('no legal move, no evaluation', evaluate([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1], [20, 22], 0) === null);

console.log(`winprob: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
