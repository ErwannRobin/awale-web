// Vibration feedback.
//
// Two backends behind four exports. On the web this is the Vibration API,
// which Android supports and iOS Safari does not, so it is a progressive
// nicety. In the native shell it is @capacitor/haptics, which is real on both
// platforms and gives iOS the Taptic Engine rather than a dumb buzz.
//
// The native call is a dynamic import inside a native-only branch, so a
// browser build never loads the plugin.
import { getSettings } from './settings.ts';
import { isNative } from './platform.ts';

type Feel = 'tap' | 'capture' | 'win' | 'lose';

/** Web fallback patterns, in milliseconds. */
const PATTERN: Record<Feel, number | number[]> = {
  tap: 8,
  capture: [0, 18, 40, 26],
  win: [0, 30, 60, 30, 60, 70],
  lose: [0, 60, 80, 60],
};

async function nativeBuzz(feel: Feel): Promise<void> {
  const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
  switch (feel) {
    case 'tap':
      return Haptics.impact({ style: ImpactStyle.Light });
    case 'capture':
      return Haptics.impact({ style: ImpactStyle.Medium });
    case 'win':
      return Haptics.notification({ type: NotificationType.Success });
    case 'lose':
      return Haptics.notification({ type: NotificationType.Warning });
  }
}

function webBuzz(feel: Feel): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  navigator.vibrate(PATTERN[feel]);
}

function buzz(feel: Feel): void {
  if (!getSettings().haptics) return;
  try {
    if (isNative()) {
      void nativeBuzz(feel).catch(() => { /* no haptic engine on this device */ });
      return;
    }
    webBuzz(feel);
  } catch {
    /* some browsers throw when the page is not visible */
  }
}

export const hapticTap = () => buzz('tap');
export const hapticCapture = () => buzz('capture');
export const hapticWin = () => buzz('win');
export const hapticLose = () => buzz('lose');
