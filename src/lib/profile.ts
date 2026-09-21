// The local player profile: a display name, an avatar colour, and the country
// the player's games are counted under. Replaces the hardcoded "Player123 /
// 1250" chip. There are no accounts, so this is stored on the device.
//
// The country is the only field anything else ever sees: it travels with a
// finished game to the world table, on its own, with no name and no identifier
// attached. See lib/worldStats.ts.
import { getStore } from './storage.ts';
import { isCountryCode, normaliseCountry, UNKNOWN_COUNTRY, type CountryKey } from './country.ts';

const KEY = 'awale.profile.v1';

export const AVATARS = ['clay', 'olive', 'indigo', 'amber', 'plum', 'teal'] as const;
export type AvatarKey = (typeof AVATARS)[number];

/**
 * How the country in the profile was arrived at.
 *
 * `auto` means the edge worked it out from the request's IP and may correct
 * itself on a later launch — someone who travels gets the country they are
 * actually in. `manual` means the player picked one, and then nothing ever
 * overrides it: a player abroad, or behind a VPN, stays where they said.
 */
export type CountrySource = 'auto' | 'manual';

export interface Profile {
  name: string;
  avatar: AvatarKey;
  /** ISO 3166-1 alpha-2, or `ZZ` while nothing has been detected or chosen. */
  country: CountryKey;
  countrySource: CountrySource;
}

export const NAME_MAX = 18;

export function defaultProfile(): Profile {
  return { name: '', avatar: 'clay', country: UNKNOWN_COUNTRY, countrySource: 'auto' };
}

/** Trim, collapse whitespace and cap the length; empty means "use the default label". */
export function sanitiseName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export function loadProfile(): Profile {
  try {
    const raw = getStore().get(KEY);
    if (!raw) return defaultProfile();
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      name: typeof o.name === 'string' ? sanitiseName(o.name) : '',
      avatar: AVATARS.includes(o.avatar as AvatarKey) ? (o.avatar as AvatarKey) : 'clay',
      country: normaliseCountry(o.country),
      // A profile written before countries existed is `auto`, so the next
      // launch detects one instead of leaving the player nowhere for good.
      countrySource: o.countrySource === 'manual' ? 'manual' : 'auto',
    };
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(p: Profile): Profile {
  const clean: Profile = {
    name: sanitiseName(p.name),
    avatar: p.avatar,
    country: normaliseCountry(p.country),
    countrySource: p.countrySource === 'manual' ? 'manual' : 'auto',
  };
  getStore().set(KEY, JSON.stringify(clean));
  return clean;
}

/**
 * Record a country the player chose. Pinned as `manual` from here on, even if
 * they pick the one detection had already found — the point is that they said
 * so. Games already played keep the country they were played under; only the
 * next game is counted here.
 */
export function chooseCountry(p: Profile, code: string): Profile {
  return saveProfile({ ...p, country: normaliseCountry(code), countrySource: 'manual' });
}

/**
 * Record a country the edge detected. Ignored once the player has chosen one,
 * and ignored when detection came back with nothing to say.
 */
export function applyDetectedCountry(p: Profile, code: unknown): Profile {
  if (p.countrySource === 'manual') return p;
  if (!isCountryCode(code)) return p;
  const detected = normaliseCountry(code);
  if (detected === p.country) return p;
  return saveProfile({ ...p, country: detected, countrySource: 'auto' });
}
