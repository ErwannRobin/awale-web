// Search behaviour, level by level.
//
// The regressions these guard:
//
// 1. `value()` only applies the candidate move while ply + 1 < depth, so at
//    depth 0 or 1 every move scores identically and the AI plays blind. The old
//    depth clamp did exactly that to level 0 (Novice), which therefore ignored
//    captures entirely despite the menu promising a greedy opponent.
// 2. `value()` prunes with alpha-beta and collapses the horizon ply. Both are
//    pure speed-ups: a full-window search must return exactly what the plain
//    negamax it replaced returned, or every level silently changes strength.
// 3. Expert's depth ceiling. It used to share the 3 * level formula, capping it
//    at 9 while its own 1s budget went almost unspent.
import { AwaleAI, value } from '../src/lib/ai.ts';
import { owner, isValid, distribute } from '../src/lib/engine.ts';

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

// ---- pruning must not change what the search returns --------------------
// Reference implementation: the plain negamax `value()` replaced, kept here so
// the alpha-beta version is checked against the behaviour it must preserve.
function plainValue(pits: number[], scores: number[], i: number, ply: number, depth: number): number {
  const p = [...pits], s = [...scores];
  const me = owner(i), other = 1 - me;
  if (ply + 1 < depth) {
    const r = distribute(p, s, i);
    if (r.running && s[me] < 25 && s[other] < 25) {
      let best = -100;
      for (let j = other * 6; j < other * 6 + 6; j++)
        if (isValid(p, j)) best = Math.max(best, plainValue(p, s, j, ply + 1, depth));
      return -best;
    }
  }
  return s[me] - s[other];
}

{
  // Walk a few pseudo-random games and compare every root move at every depth.
  let s = 12345 >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  let compared = 0, differed = 0;
  for (let g = 0; g < 8; g++) {
    const pits = Array(12).fill(4); const scores = [0, 0];
    let player: 0 | 1 = 0;
    for (let ply = 0; ply < 40; ply++) {
      const moves: number[] = [];
      for (let j = player * 6; j < player * 6 + 6; j++) if (isValid(pits, j)) moves.push(j);
      if (moves.length === 0 || scores[0] >= 25 || scores[1] >= 25) break;
      for (const depth of [1, 2, 3, 4, 5, 6]) for (const j of moves) {
        compared++;
        if (value(pits, scores, j, 0, depth) !== plainValue(pits, scores, j, 0, depth)) differed++;
      }
      const res = distribute(pits, scores, moves[Math.floor(rand() * moves.length)]);
      if (!res.running) break;
      player = (player === 0 ? 1 : 0);
    }
  }
  ok('pruning compared against plain negamax at all', compared > 500);
  ok(`alpha-beta matches plain negamax (${compared} root values)`, differed === 0);
}

// A narrowed window is an optimisation hint, never a different best move: the
// value may be clamped to the window, but it must stay on the correct side of it.
{
  const exact = value(CAPTURE, [0, 0], 5, 0, 4);
  ok('narrow window cannot claim less than the true value', value(CAPTURE, [0, 0], 5, 0, 4, exact - 1, exact) >= exact - 1);
  ok('narrow window cannot claim more than the true value', value(CAPTURE, [0, 0], 5, 0, 4, exact, exact + 1) <= exact + 1);
}

// ---- depth ceilings ------------------------------------------------------
// Expert's ceiling was 3 * level = 9. With pruning that costs a small fraction
// of its 1s budget, so the cap — not the budget — was what held it back.
{
  const depthOf = (ai: AwaleAI) => (ai as unknown as { depths: number[] }).depths[ai.level];
  const settle = (level: number) => {
    const ai = new AwaleAI(level);
    for (let i = 0; i < 60; i++) ai.bestMove(CAPTURE, [0, 0], 0, () => 0.5);
    return depthOf(ai);
  };
  ok('Novice stays at MIN_DEPTH', settle(0) === 2);
  ok('level 1 ceiling unchanged', settle(1) === 3);
  ok('level 2 ceiling unchanged', settle(2) === 6);
  const expert = settle(3);
  ok(`Expert now searches past the old cap of 9 (got ${expert})`, expert > 9);
  ok(`Expert stays within its ceiling of 14 (got ${expert})`, expert <= 14);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
