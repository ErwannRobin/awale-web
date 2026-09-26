// User settings, persisted through the pluggable key/value store.
//
// Read them with the `useSettings` hook (components) or `getSettings()`
// (anything outside React). Writes notify every subscriber, so a change in the
// Settings screen reaches the board without prop-drilling.
import { getStore } from './storage.ts';
import { isTimeControl, type TimeControlId } from './protocol.ts';

const KEY = 'awale.settings.v1';

export type ThemeName = 'wood' | 'night' | 'sand';
export type SpeedName = 'slow' | 'normal' | 'fast' | 'instant';
export type Language = 'en' | 'fr' | 'pt' | 'es' | 'ar';

/** Every language with a table, in the order the language picker shows them. */
export const LANGUAGE_CODES: Language[] = ['en', 'fr', 'pt', 'es', 'ar'];

const isLanguage = (v: unknown): v is Language =>
  typeof v === 'string' && (LANGUAGE_CODES as string[]).includes(v);

export interface Settings {
  sound: boolean;
  /** Ambiance loop, separate from sound effects — some players want one but not the other. */
  music: boolean;
  haptics: boolean;
  speed: SpeedName;
  theme: ThemeName;
  /** Puts your own store under your thumb; it never mirrors the pit ring. */
  leftHanded: boolean;
  showCounts: boolean;
  /**
   * The coaching text: the helper line under the turn pill and the tip card
   * below the board. A player who knows the game can switch both off with the
   * × on either of them, and bring them back from Settings.
   */
  showTips: boolean;
  language: Language;
  /**
   * Local "come back and play" reminders. Native shell only, and off until the
   * player turns it on — that toggle is what triggers the OS permission
   * prompt. See lib/notifications.ts.
   */
  reminders: boolean;
  /**
   * Count finished games towards the world table — one line per game (level
   * and country, nothing else, no identifier). Off means the game is counted
   * locally only and the Worker never hears about it. See lib/worldStats.ts.
   */
  shareStats: boolean;
  /** The clock online games are started with, and quick match queues for. */
  timeControl: TimeControlId;
}

/** Animation tempo multiplier. `instant` skips the sowing animation entirely. */
export const SPEED_FACTOR: Record<SpeedName, number> = {
  slow: 1.6,
  normal: 1,
  fast: 0.5,
  instant: 0,
};

/**
 * The first of the browser's preferred languages that has a table, by its
 * primary subtag — `pt-BR` and `pt-AO` are both Portuguese, `ar-MA` is Arabic.
 */
function detectLanguage(): Language {
  try {
    const langs = typeof navigator !== 'undefined'
      ? [navigator.language, ...(navigator.languages ?? [])]
      : [];
    for (const tag of langs) {
      const primary = tag?.toLowerCase().split('-')[0];
      if (isLanguage(primary)) return primary;
    }
    return 'en';
  } catch {
    return 'en';
  }
}

export function defaultSettings(): Settings {
  return {
    sound: true,
    music: true,
    haptics: true,
    speed: 'normal',
    theme: 'wood',
    leftHanded: false,
    showCounts: true,
    showTips: true,
    language: detectLanguage(),
    reminders: false,
    shareStats: true,
    timeControl: 'rapid',
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
    music: bool(o.music, d.music),
    haptics: bool(o.haptics, d.haptics),
    speed: SPEEDS.includes(o.speed as SpeedName) ? (o.speed as SpeedName) : d.speed,
    theme: THEMES.includes(o.theme as ThemeName) ? (o.theme as ThemeName) : d.theme,
    leftHanded: bool(o.leftHanded, d.leftHanded),
    showCounts: bool(o.showCounts, d.showCounts),
    showTips: bool(o.showTips, d.showTips),
    language: isLanguage(o.language) ? o.language : d.language,
    reminders: bool(o.reminders, d.reminders),
    shareStats: bool(o.shareStats, d.shareStats),
    timeControl: isTimeControl(o.timeControl) ? o.timeControl : d.timeControl,
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

/**
 * Drop the memoised copy so the next read comes from the store.
 *
 * The native shell swaps `localStorage` for Preferences during startup; if
 * anything read settings before that swap, the cached copy is from the wrong
 * backend. See lib/native.ts.
 */
export function invalidateSettingsCache(): void {
  cache = null;
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
