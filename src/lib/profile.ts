// The local player profile: a display name and an avatar colour. Replaces the
// hardcoded "Player123 / 1250" chip. There are no accounts, so this is stored
// on the device and is only ever shown to its owner.
import { getStore } from './storage.ts';

const KEY = 'awale.profile.v1';

export const AVATARS = ['clay', 'olive', 'indigo', 'amber', 'plum', 'teal'] as const;
export type AvatarKey = (typeof AVATARS)[number];

export interface Profile {
  name: string;
  avatar: AvatarKey;
}

export const NAME_MAX = 18;

export function defaultProfile(): Profile {
  return { name: '', avatar: 'clay' };
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
    };
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(p: Profile): Profile {
  const clean: Profile = { name: sanitiseName(p.name), avatar: p.avatar };
  getStore().set(KEY, JSON.stringify(clean));
  return clean;
}
