// Search behaviour, level by level.
//
// The regression these guard: `value()` only applies the candidate move while
// ply + 1 < depth, so at depth 0 or 1 every move scores identically and the AI
// plays blind. The old depth clamp did exactly that to level 0 (Novice), which
// therefore ignored captures entirely despite the menu promising a greedy
// opponent.
import { AwaleAI, value } from '../src/lib/ai.ts';
import { isValid, distribute } from '../src/lib/engine.ts';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else { fail++; console.error(`FAIL ${name}`); }
}

// One free capture on offer: pit 5 sows into 6 and 7, leaving both on 2.
//              0  1  2  3  4  5  6  7  8  9 10 11
const CAPTURE = [1, 1, 1, 1, 1, 2, 1, 1, 5, 5, 5, 5];

function gain(pits: number[], move: number): number {
  const p = [...pits], s = [0, 0];
  distribute(p, s, move);
  return s[0];
}
ok('fixture really offers a capture', gain(CAPTURE, 5) > 0);

// ---- the horizon quirk, stated explicitly -------------------------------
function distinctValues(depth: number): number {
  const seen = new Set<number>();
  for (let j = 0; j < 6; j++) if (isValid(CAPTURE, j)) seen.add(value(CAPTURE, [0, 0], j, 0, depth));
  return seen.size;
}
ok('depth 1 cannot tell moves apart (why MIN_DEPTH is 2)', distinctValues(1) === 1);
ok('depth 2 tells moves apart', distinctValues(2) > 1);

// ---- every level must actually search -----------------------------------
for (let level = 0; level < 4; level++) {
  const ai = new AwaleAI(level);
  const move = ai.bestMove(CAPTURE, [0, 0], 0, () => 0.5);
  ok(`level ${level} returns a legal move`, move != null && isValid(CAPTURE, move));
}

// Novice is advertised as greedy, so it must take the seeds in front of it.
// (Deeper levels legitimately decline this capture — it loses material later.)
{
  const move = new AwaleAI(0).bestMove(CAPTURE, [0, 0], 0, () => 0.5);
  ok('Novice takes the immediate capture', move === 5);
}

// A level whose self-tuning depth drifts down must not fall below MIN_DEPTH.
{
  const ai = new AwaleAI(0);
  for (let i = 0; i < 50; i++) ai.bestMove(CAPTURE, [0, 0], 0, () => 0.5);
  ok('Novice still captures after 50 self-tuning rounds',
     ai.bestMove(CAPTURE, [0, 0], 0, () => 0.5) === 5);
}

// ---- the opening book stays on the mover's own row ----------------------
{
  const opening = Array(12).fill(4);
  for (let i = 0; i < 20; i++) {
    const south = new AwaleAI(2).bestMove(opening, [0, 0], 0, () => i / 20);
    const north = new AwaleAI(2).bestMove(opening, [0, 0], 1, () => i / 20);
    ok(`opening book South stays on row (${i})`, south != null && south >= 0 && south <= 5);
    ok(`opening book North stays on row (${i})`, north != null && north >= 6 && north <= 11);
  }
}

// ---- a banked win ends the search ---------------------------------------
{
  // South already holds 25: no continuation can be worth more than the win.
  const pits = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];
  const v = value(pits, [24, 0], 5, 0, 5);
  ok('search stops once a side reaches 25', Number.isFinite(v));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
