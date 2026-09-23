// Key/value persistence behind a tiny interface, so the game logic never
// touches `localStorage` directly.
//
// PORTING NOTE: a native shell swaps the backend at startup and everything else
// keeps working, e.g.
//
//   import { Preferences } from '@capacitor/preferences';
//   setStore({
//     get: k => cache.get(k) ?? null,          // hydrate `cache` before render
//     set: (k, v) => { cache.set(k, v); void Preferences.set({ key: k, value: v }); },
//     remove: k => { cache.delete(k); void Preferences.remove({ key: k }); },
//   });
//
// The interface is deliberately synchronous: the app reads progress during
// render, and every native KV store can be mirrored into an in-memory cache.

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** Always-available fallback: private-mode browsers, SSR, tests, RN before hydration. */
function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: k => map.get(k) ?? null,
    set: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
  };
}

/** Just what is used of `Storage`, so this file also compiles for the Worker,
 *  which shares the stats code and has no `localStorage` at all. */
interface WebStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function webStore(): KeyValueStore | null {
  try {
    const localStorage = (globalThis as { localStorage?: WebStorage }).localStorage;
    if (!localStorage) return null;
    const probe = '__awale_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return {
      get: k => localStorage.getItem(k),
      set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* quota */ } },
      remove: k => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
    };
  } catch {
    return null; // Safari private mode throws on write.
  }
}

let store: KeyValueStore = webStore() ?? memoryStore();

export function setStore(next: KeyValueStore): void { store = next; }
export function getStore(): KeyValueStore { return store; }
