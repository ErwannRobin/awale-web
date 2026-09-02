// The native shell (Capacitor) — detection and one-time bootstrap.
//
// Every plugin is reached through a dynamic `import()` inside a native-only
// branch, so a browser build never loads native code and the Node test runner
// never evaluates it. `platform.ts` answers "are we native?" for the modules
// that only need that much.
//
// `initNative()` must run *before* the first render: it swaps the persistence
// backend, and screens read progress during render.
import { isNative, platform } from './platform.ts';
import { setStore } from './storage.ts';
import { invalidateSettingsCache } from './settings.ts';
import { refreshReminder } from './notifications.ts';

/**
 * Move persistence from `localStorage` to Preferences (UserDefaults /
 * SharedPreferences).
 *
 * WKWebView storage is evictable — iOS can clear it when the device is low on
 * space — and a player who lost their rating and challenge progress to a disk
 * cleanup would be right to be annoyed. Preferences is not evictable.
 *
 * The KeyValueStore interface is synchronous, so every key is read once here
 * into a Map and writes are mirrored out asynchronously.
 */
async function adoptPreferencesStore(): Promise<void> {
  const { Preferences } = await import('@capacitor/preferences');
  const cache = new Map<string, string>();

  const { keys } = await Preferences.keys();
  for (const key of keys) {
    const { value } = await Preferences.get({ key });
    if (value !== null) cache.set(key, value);
  }

  setStore({
    get: k => cache.get(k) ?? null,
    set: (k, v) => {
      cache.set(k, v);
      void Preferences.set({ key: k, value: v }).catch(() => { /* best effort */ });
    },
    remove: k => {
      cache.delete(k);
      void Preferences.remove({ key: k }).catch(() => { /* best effort */ });
    },
  });

  // Anything read before the swap (nothing should be, but be certain) is stale.
  invalidateSettingsCache();
}

async function styleStatusBar(): Promise<void> {
  const { StatusBar, Style } = await import('@capacitor/status-bar');
  // The app is dark in every theme's chrome, so the bar wants light text.
  // `Style.Dark` means "light text for dark backgrounds".
  await StatusBar.setStyle({ style: Style.Dark });
  if (platform() === 'android') {
    // No-op on Android 15+, which is edge-to-edge and ignores it.
    await StatusBar.setBackgroundColor({ color: '#150c06' }).catch(() => {});
  }
}

let started = false;

/**
 * Wire the shell up. Safe to call on the web: it returns immediately.
 *
 * Never rejects — a plugin that fails to load must not stop the game from
 * starting. A missing status bar is cosmetic; a missing Preferences store
 * falls back to `localStorage`, which still works inside the WebView.
 */
export async function initNative(): Promise<void> {
  if (!isNative() || started) return;
  started = true;

  await adoptPreferencesStore().catch(err => {
    console.warn('Preferences unavailable, keeping WebView storage:', err);
  });

  await styleStatusBar().catch(() => { /* cosmetic */ });

  // Backgrounding the app is the moment to (re)arm the "come back" reminder,
  // and returning to it is the moment to push that reminder further out.
  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('appStateChange', ({ isActive }) => {
      void refreshReminder(isActive ? 'resumed' : 'backgrounded');
    });
  } catch (err) {
    console.warn('App lifecycle listener failed:', err);
  }

  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch { /* launchAutoHide already handles it */ }
}

/** Close the app. Android only in practice; iOS forbids programmatic exit. */
export async function exitApp(): Promise<void> {
  if (platform() !== 'android') return;
  try {
    const { App } = await import('@capacitor/app');
    await App.exitApp();
  } catch { /* nothing sensible to do */ }
}
