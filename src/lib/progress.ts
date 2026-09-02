// Challenge completion, persisted through the pluggable key/value store
// (see lib/storage.ts) so a native build only swaps the backend.
import { getStore } from './storage.ts';

const KEY = 'awale.challenges.completed.v1';

export function loadCompleted(): number[] {
  try {
    const raw = getStore().get(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(n => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

export function saveCompleted(list: number[]): void {
  getStore().set(KEY, JSON.stringify([...new Set(list)].sort((a, b) => a - b)));
}

// A challenge is unlocked if it is the first, or the previous one is completed.
export function isUnlocked(index: number, completed: number[]): boolean {
  return index === 0 || completed.includes(index - 1);
}
