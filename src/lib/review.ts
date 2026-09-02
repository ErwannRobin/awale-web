// The App Store / Play Store review prompt.
//
// Both stores expose an in-app rating sheet (SKStoreReviewController on iOS,
// the Play In-App Review API on Android) and both throttle it hard — iOS shows
// it at most a handful of times a year per user, and neither tells you whether
// anything appeared. So the prompt must be *asked for at a good moment* and
// never depended on.
//
// House rules on top of the system's:
//   - only after a win, never after a loss;
//   - not until the player has won enough games to have an opinion;
//   - at most `MAX_ASKS` times, at least `MIN_DAYS_BETWEEN` days apart.
//
// Deliberately not wired to a "Rate us" button: on iOS a button that promises
// a rating form and then silently does nothing (because the OS throttled it)
// is a review rejection. A store deep link is the right thing there, and it
// needs an App Store id this project does not have yet.
import { getStore } from './storage.ts';
import { isNative } from './platform.ts';

const KEY = 'awale.review.v1';

export const MIN_WINS = 3;
export const MAX_ASKS = 3;
export const MIN_DAYS_BETWEEN = 90;

const DAY_MS = 86_400_000;

export interface ReviewState {
  /** How many times the sheet has been requested. */
  asks: number;
  /** Epoch ms of the last request, 0 if never. */
  lastAskAt: number;
}

export const emptyReviewState = (): ReviewState => ({ asks: 0, lastAskAt: 0 });

function coerce(raw: unknown): ReviewState {
  const d = emptyReviewState();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown, fb: number) =>
    (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fb);
  return { asks: num(o.asks, 0), lastAskAt: num(o.lastAskAt, 0) };
}

export function loadReviewState(): ReviewState {
  try {
    const raw = getStore().get(KEY);
    return coerce(raw ? JSON.parse(raw) : null);
  } catch {
    return emptyReviewState();
  }
}

export function saveReviewState(state: ReviewState): void {
  getStore().set(KEY, JSON.stringify(state));
}

/**
 * The gate, kept pure so `test/native.test.ts` can hold it to the rules above
 * without a device.
 */
export function shouldAskForReview(state: ReviewState, wins: number, now: number): boolean {
  if (wins < MIN_WINS) return false;
  if (state.asks >= MAX_ASKS) return false;
  if (state.lastAskAt > 0 && now - state.lastAskAt < MIN_DAYS_BETWEEN * DAY_MS) return false;
  return true;
}

/**
 * Request the sheet if this is a good moment. Returns whether it was asked
 * for — *not* whether anything was shown, which no store will tell us.
 */
export async function maybeRequestReview(wins: number): Promise<boolean> {
  if (!isNative()) return false;

  const state = loadReviewState();
  const now = Date.now();
  if (!shouldAskForReview(state, wins, now)) return false;

  // Recorded before the call, so a plugin that throws cannot make the app ask
  // again on the very next win.
  saveReviewState({ asks: state.asks + 1, lastAskAt: now });

  try {
    const { InAppReview } = await import('@capacitor-community/in-app-review');
    await InAppReview.requestReview();
    return true;
  } catch (err) {
    console.warn('In-app review unavailable:', err);
    return false;
  }
}
