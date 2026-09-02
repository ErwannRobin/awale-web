// User settings, persisted through the pluggable key/value store.
//
// Read them with the `useSettings` hook (components) or `getSettings()`
// (anything outside React). Writes notify every subscriber, so a change in the
// Settings screen reaches the board without prop-drilling.
import { getStore } from './storage.ts';

const KEY = 'awale.settings.v1';

export type ThemeName = 'wood' | 'night' | 'sand';
export type SpeedName = 'slow' | 'normal' | 'fast' | 'instant';
export type Language = 'en' | 'fr';

export interface Settings {
  sound: boolean;
  haptics: boolean;
  speed: SpeedName;
  theme: ThemeName;
  /** Puts your own store under your thumb; it never mirrors the pit ring. */
  leftHanded: boolean;
  showCounts: boolean;
  language: Language;
}

/** Animation tempo multiplier. `instant` skips the sowing animation entirely. */
export const SPEED_FACTOR: Record<SpeedName, number> = {
  slow: 1.6,
  normal: 1,
  fast: 0.5,
  instant: 0,
};

function detectLanguage(): Language {
  try {
    const langs = typeof navigator !== 'undefined'
      ? [navigator.language, ...(navigator.languages ?? [])]
      : [];
    return langs.some(l => l?.toLowerCase().startsWith('fr')) ? 'fr' : 'en';
  } catch {
    return 'en';
  }
}

export function defaultSettings(): Settings {
  return {
    sound: true,
    haptics: true,
    speed: 'normal',
    theme: 'wood',
    leftHanded: false,
    showCounts: true,
    language: detectLanguage(),
  };
}

const THEMES: ThemeName[] = ['wood', 'night', 'sand'];
const SPEEDS: SpeedName[] = ['slow', 'normal', 'fast', 'instant'];

// Stored settings are user-editable JSON; validate every field rather than
// trusting the blob, or one bad key blanks the UI.
function coerce(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  const bool = (v: unknown, fb: boolean) => (typeof v === 'boolean' ? v : fb);
  return {
    sound: bool(o.sound, d.sound),
    haptics: bool(o.haptics, d.haptics),
    speed: SPEEDS.includes(o.speed as SpeedName) ? (o.speed as SpeedName) : d.speed,
    theme: THEMES.includes(o.theme as ThemeName) ? (o.theme as ThemeName) : d.theme,
    leftHanded: bool(o.leftHanded, d.leftHanded),
    showCounts: bool(o.showCounts, d.showCounts),
    language: o.language === 'fr' || o.language === 'en' ? o.language : d.language,
  };
}

let cache: Settings | null = null;
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  if (cache) return cache;
  try {
    const raw = getStore().get(KEY);
    cache = coerce(raw ? JSON.parse(raw) : null);
  } catch {
    cache = defaultSettings();
  }
  return cache;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  cache = next;
  getStore().set(KEY, JSON.stringify(next));
  listeners.forEach(fn => fn(next));
  return next;
}

export function resetSettings(): Settings {
  cache = defaultSettings();
  getStore().set(KEY, JSON.stringify(cache));
  listeners.forEach(fn => fn(cache!));
  return cache;
}

export function subscribeSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
