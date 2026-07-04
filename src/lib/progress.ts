// Challenge completion, persisted in localStorage (server-side progress can
// replace this later without touching the UI).
const KEY = 'awale.challenges.completed.v1';

export function loadCompleted(): number[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(n => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

export function saveCompleted(list: number[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...new Set(list)].sort((a, b) => a - b)));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

// A challenge is unlocked if it is the first, or the previous one is completed.
export function isUnlocked(index: number, completed: number[]): boolean {
  return index === 0 || completed.includes(index - 1);
}
