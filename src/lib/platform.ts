// Which shell the game is running in.
//
// Split out from `native.ts` so the modules that only need to ask the question
// — haptics, notifications, the service worker, the back button — do not pull
// in the whole native bootstrap, and so `native.ts` can import them back
// without a cycle.
import { Capacitor } from '@capacitor/core';

/** True inside the iOS/Android shell, false in any browser. */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** `'ios' | 'android' | 'web'`. */
export function platform(): string {
  try {
    return Capacitor.getPlatform();
  } catch {
    return 'web';
  }
}
