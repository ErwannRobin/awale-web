// Service-worker registration.
//
// The native shell ships every asset inside the app bundle and loads them off
// disk, so the worker has nothing left to cache there — it is skipped rather
// than left to install a second, redundant copy of the game.
import { isNative } from './platform.ts';

export function registerServiceWorker(): void {
  if (isNative()) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      // Offline support is a bonus, never a requirement — an install failure
      // (file:// origin, no HTTPS, a locked-down WebView) must not break play.
      console.warn('Service worker registration failed:', err);
    });
  });
}
