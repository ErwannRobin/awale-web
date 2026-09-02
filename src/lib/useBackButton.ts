import { useEffect, useRef } from 'react';
import { isNative } from './platform.ts';

/**
 * The Android hardware/gesture back button.
 *
 * Without this, back closes the app from anywhere — including mid-game, which
 * Play Store reviewers do flag. `handler` decides what "back" means for the
 * screen that is showing; `App.tsx` maps it onto the screen stack.
 *
 * No-op on iOS and on the web, where there is no such button.
 */
export function useBackButton(handler: () => void): void {
  // Kept in a ref so the listener is registered once, not on every render.
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!isNative()) return;
    let remove: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const handle = await App.addListener('backButton', () => ref.current());
        if (cancelled) void handle.remove();
        else remove = () => void handle.remove();
      } catch {
        /* no listener, no back handling — the OS default stands */
      }
    })();

    return () => { cancelled = true; remove?.(); };
  }, []);
}
