// The daily puzzle: which position a date gets, and how a streak is kept.
//
// Everything here is date arithmetic, which is where off-by-one and
// daylight-saving bugs live — so the assertions pin actual calendar days.
import {
  coerceDaily, currentStreak, dailyFor, dayKey, dayNumber, emptyDaily, keyOfDayNumber,
  msUntilNext, recordAttempt, tierOfDay, tryMarks, DAILY_LAUNCH,
  type DailyEntry, type DailyPool,
} from '../src/lib/daily.ts';
import { formatClock, formatWait } from '../src/lib/format.ts';
import daily from '../src/content/daily.json' with { type: 'json' };

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

// ---- calendar -----------------------------------------------------------
eq('day key is the local date', dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
eq('day numbers round-trip', keyOfDayNumber(dayNumber('2026-09-26')), '2026-09-26');
eq('consecutive days are one apart', dayNumber('2026-03-30') - dayNumber('2026-03-29'), 1);
eq('across a year end', dayNumber('2027-01-01') - dayNumber('2026-12-31'), 1);

// 2026-09-28 is a Monday.
eq('Monday is gentle', tierOfDay('2026-09-28'), 0);
eq('Tuesday is gentle', tierOfDay('2026-09-29'), 0);
eq('Wednesday is tricky', tierOfDay('2026-09-30'), 1);
eq('Friday is tricky', tierOfDay('2026-10-02'), 1);
eq('Saturday is tough', tierOfDay('2026-10-03'), 2);
eq('Sunday is tough', tierOfDay('2026-10-04'), 2);

{
  const midnightish = new Date(2026, 5, 1, 23, 0, 0);
  eq('an hour to midnight', msUntilNext(midnightish), 3_600_000);
}

// ---- which puzzle -------------------------------------------------------
const entry = (tag: number): DailyEntry => ({ l: 0, s: [0, 0], p: [tag, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], m: 2 });
const fake: DailyPool = [
  [entry(100), entry(101), entry(102)],
  [entry(200), entry(201), entry(202), entry(203)],
  [entry(300), entry(301)],
];

eq('launch day is #1', dailyFor(DAILY_LAUNCH, fake).number, 1);
eq('the next day is #2', dailyFor(keyOfDayNumber(dayNumber(DAILY_LAUNCH) + 1), fake).number, 2);
ok('same day, same puzzle', JSON.stringify(dailyFor('2026-10-07', fake)) === JSON.stringify(dailyFor('2026-10-07', fake)));

{
  // Walk ten weeks: every tier's entries come round in order, with no repeat
  // before the whole tier has been used.
  const seen: number[][] = [[], [], []];
  const monday = dayNumber('2026-09-28');
  for (let d = 0; d < 70; d++) {
    const p = dailyFor(keyOfDayNumber(monday + d), fake);
    seen[p.tier].push(p.pits[0]);
  }
  // Each day of a tier takes the entry after the previous one, wrapping round.
  const inOrder = (xs: number[], base: number, size: number) =>
    xs.every((x, i) => i === 0 || x - base === (xs[i - 1] - base + 1) % size);
  ok('gentle tier cycles in order', seen[0].length === 20 && inOrder(seen[0], 100, 3));
  ok('tricky tier cycles in order', seen[1].length === 30 && inOrder(seen[1], 200, 4));
  ok('tough tier cycles in order', seen[2].length === 20 && inOrder(seen[2], 300, 2));
}

{
  const real = daily as DailyPool;
  ok('the shipped pool has three tiers', real.length === 3 && real.every(t => t.length > 0));
  const p = dailyFor('2026-10-03', real);
  ok('a real puzzle is a 48-seed board', p.pits.reduce((a, b) => a + b, 0) + p.scores[0] + p.scores[1] === 48);
  ok('a real puzzle states its length', p.moves >= 2);
}

// ---- streaks ------------------------------------------------------------
{
  let p = emptyDaily();
  p = recordAttempt(p, '2026-10-01', false);
  eq('a loss is a try', p.tries['2026-10-01'], 1);
  eq('a loss does not start a streak', p.streak, 0);
  p = recordAttempt(p, '2026-10-01', true);
  eq('the win counts the tries it took', p.solved['2026-10-01'], 2);
  eq('first solve starts a streak', p.streak, 1);
  ok('tries for a solved day are dropped', p.tries['2026-10-01'] === undefined);
  const again = recordAttempt(p, '2026-10-01', true);
  ok('winning the same day again changes nothing', again === p);
  p = recordAttempt(p, '2026-10-02', true);
  eq('the next day extends the streak', p.streak, 2);
  eq('best follows', p.best, 2);
  p = recordAttempt(p, '2026-10-04', true);
  eq('a missed day restarts it', p.streak, 1);
  eq('best is kept', p.best, 2);

  eq('streak shows on the day solved', currentStreak(p, '2026-10-04'), 1);
  eq('and the day after, not solved yet', currentStreak(p, '2026-10-05'), 1);
  eq('but not once a day is missed', currentStreak(p, '2026-10-06'), 0);
}

{
  let p = emptyDaily();
  for (let d = 0; d < 80; d++) p = recordAttempt(p, keyOfDayNumber(dayNumber('2026-01-01') + d), true);
  ok('old days are pruned', Object.keys(p.solved).length <= 45);
  eq('but the streak runs on', p.streak, 80);
}

eq('garbage is an empty record', coerceDaily('nope'), emptyDaily());
eq('bad fields are dropped', coerceDaily({ streak: -3, last: 'yesterday', solved: { x: 1, '2026-10-01': 2 } }),
  { streak: 0, best: 0, last: null, solved: { '2026-10-01': 2 }, tries: {} });

eq('one try is one green square', tryMarks(1), '🟩');
eq('three tries', tryMarks(3), '🟫🟫🟩');

// ---- formatting ---------------------------------------------------------
eq('wait in hours', formatWait(5 * 3_600_000 + 7 * 60_000), '5h 07m');
eq('wait in minutes', formatWait(12 * 60_000 + 5_000), '12m');
eq('under a minute', formatWait(30_000), '<1m');
eq('clock, minutes', formatClock(299_000), '4:59');
eq('clock rounds up to the second', formatClock(59_001), '1:00');
eq('clock, tenths near the end', formatClock(9_450), '9.4');
eq('clock never goes negative', formatClock(-5), '0.0');

console.log(`daily: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
