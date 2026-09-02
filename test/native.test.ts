// The two pieces of native-shell logic that are pure enough to pin down
// without a device: when the "come back" reminder fires, and when the store
// review sheet may be asked for.
//
// Everything else in lib/native.ts, lib/notifications.ts and lib/review.ts is
// a plugin call behind a dynamic import, which is exactly why those imports
// are dynamic — nothing here loads Capacitor.
import assert from 'node:assert/strict';
import {
  nextReminderAt,
  REMINDER_DELAY_DAYS,
  REMINDER_HOUR,
} from '../src/lib/notifications.ts';
import {
  shouldAskForReview,
  emptyReviewState,
  MIN_WINS,
  MAX_ASKS,
  MIN_DAYS_BETWEEN,
} from '../src/lib/review.ts';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const DAY_MS = 86_400_000;

console.log('reminder schedule');

check('lands REMINDER_DELAY_DAYS later, at the reminder hour', () => {
  const from = new Date(2026, 0, 10, 14, 37, 12);
  const at = nextReminderAt(from);
  assert.equal(at.getDate(), 10 + REMINDER_DELAY_DAYS);
  assert.equal(at.getHours(), REMINDER_HOUR);
  assert.equal(at.getMinutes(), 0);
  assert.equal(at.getSeconds(), 0);
});

check('crosses a month boundary correctly', () => {
  const at = nextReminderAt(new Date(2026, 0, 30, 9, 0, 0));
  assert.equal(at.getMonth(), 1);        // February
  assert.equal(at.getDate(), 2);
});

check('is always in the future, even asked for zero days out', () => {
  // 20:00 is past the reminder hour, so "today at 19:00" would be in the past.
  const from = new Date(2026, 5, 1, 20, 0, 0);
  const at = nextReminderAt(from, 0);
  assert.ok(at.getTime() > from.getTime(), 'reminder must not be scheduled in the past');
  assert.equal(at.getDate(), 2);
});

console.log('review gate');

check('stays quiet until the player has won enough games', () => {
  const now = Date.now();
  assert.equal(shouldAskForReview(emptyReviewState(), MIN_WINS - 1, now), false);
  assert.equal(shouldAskForReview(emptyReviewState(), MIN_WINS, now), true);
});

check('never asks more than MAX_ASKS times', () => {
  const now = Date.now();
  const spent = { asks: MAX_ASKS, lastAskAt: now - 10 * MIN_DAYS_BETWEEN * DAY_MS };
  assert.equal(shouldAskForReview(spent, 99, now), false);
});

check('waits MIN_DAYS_BETWEEN days between asks', () => {
  const now = Date.now();
  const recent = { asks: 1, lastAskAt: now - (MIN_DAYS_BETWEEN - 1) * DAY_MS };
  assert.equal(shouldAskForReview(recent, 99, now), false);

  const old = { asks: 1, lastAskAt: now - (MIN_DAYS_BETWEEN + 1) * DAY_MS };
  assert.equal(shouldAskForReview(old, 99, now), true);
});

check('a corrupt-looking state cannot unlock an extra ask', () => {
  const now = Date.now();
  // lastAskAt in the future (clock moved backwards) must not read as "long ago".
  const skewed = { asks: 1, lastAskAt: now + 30 * DAY_MS };
  assert.equal(shouldAskForReview(skewed, 99, now), false);
});

console.log(`\n${passed} assertions passed`);
