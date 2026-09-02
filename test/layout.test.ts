// The counterclockwise invariant. Seeds are sown by walking pit indices
// 0 → 1 → … → 11 → 0, so that walk MUST read counterclockwise on screen in
// every orientation and for either viewpoint. A layout that mirrors the board
// silently turns the game clockwise; these assertions catch that.
import { boardLayout, ringWinding, isCounterClockwise, screenPositions } from '../src/lib/layout.ts';
import type { Orientation } from '../src/lib/layout.ts';

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

const views: (0 | 1)[] = [0, 1];
const orientations: Orientation[] = ['landscape', 'portrait'];

for (const v of views) {
  for (const o of orientations) {
    const l = boardLayout(v, o);
    ok(`counterclockwise · viewpoint ${v} · ${o}`, isCounterClockwise(l));
    ok(`winding is non-degenerate · viewpoint ${v} · ${o}`, ringWinding(l) !== 0);

    // Every pit placed exactly once.
    const pos = screenPositions(l);
    eq(`all 12 pits placed · viewpoint ${v} · ${o}`, pos.size, 12);

    // Consecutive pits must be neighbours on screen (no jumps across the board).
    let jumps = 0;
    for (let i = 0; i < 12; i++) {
      const p = pos.get(i)!, q = pos.get((i + 1) % 12)!;
      if (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) !== 1) jumps++;
    }
    eq(`ring is contiguous · viewpoint ${v} · ${o}`, jumps, 0);

    // The viewer's own six pits are the ones they can tap.
    eq(`near row belongs to viewpoint · ${v} · ${o}`, l.near, [0, 1, 2, 3, 4, 5].map(k => v * 6 + k));
  }
}

// A mirrored grid (the bug this test exists for) must read clockwise.
{
  const good = boardLayout(0, 'portrait');
  const mirrored = { ...good, gridDirection: 'column' as const };
  ok('mirrored portrait grid is detected as clockwise', !isCounterClockwise(mirrored));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
