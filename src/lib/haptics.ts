// Vibration feedback.
//
// Uses the web Vibration API, which Android supports and iOS Safari does not —
// so this is a progressive nicety on the web and becomes real on both platforms
// in a native shell.
//
// PORTING NOTE: with Capacitor installed, replace the bodies with
// `Haptics.impact({ style: ImpactStyle.Light })` etc. from @capacitor/haptics.
// The four exports below are the whole surface.
import { getSettings } from './settings.ts';

function buzz(pattern: number | number[]): void {
  if (!getSettings().haptics) return;
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    navigator.vibrate(pattern);
  } catch {
    /* some browsers throw when the page is not visible */
  }
}

export const hapticTap = () => buzz(8);
export const hapticCapture = () => buzz([0, 18, 40, 26]);
export const hapticWin = () => buzz([0, 30, 60, 30, 60, 70]);
export const hapticLose = () => buzz([0, 60, 80, 60]);
