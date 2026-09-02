// Service-worker registration.
//
// PORTING NOTE: a Capacitor build already ships its assets on-device, so the
// worker is redundant there — harmless, but you can skip the call in main.tsx
// when running inside the native shell.
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      // Offline support is a bonus, never a requirement — an install failure
      // (file:// origin, no HTTPS, a locked-down WebView) must not break play.
      console.warn('Service worker registration failed:', err);
    });
  });
}
