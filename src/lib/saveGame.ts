// The in-progress game, so a refresh — or a phone call in a native shell —
// does not throw the board away.
//
// Only free play against the AI and pass-and-play are saved. Challenges are
// short and always restartable from their fixed position, and the tutorial is
// scripted, so neither needs a resume slot.
import { getStore } from './storage.ts';

const KEY = 'awale.savedgame.v1';

export interface SavedGame {
  mode: 'ai' | 'local';
  level: number;
  pits: number[];
  scores: number[];
  turn: 0 | 1;
  /** Undo snapshots, so resuming keeps the undo stack. */
  history: { pits: number[]; scores: number[]; turn: 0 | 1 }[];
  at: number;
}

const isBoard = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length === 12 && v.every(n => typeof n === 'number' && n >= 0);

const isScores = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && n >= 0);

function coerce(raw: unknown): SavedGame | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.mode !== 'ai' && o.mode !== 'local') return null;
  if (!isBoard(o.pits) || !isScores(o.scores)) return null;
  if (o.turn !== 0 && o.turn !== 1) return null;
  // 48 seeds, always. A blob that does not add up is corrupt, not a game.
  const total = o.pits.reduce((a, b) => a + b, 0) + o.scores[0] + o.scores[1];
  if (total !== 48) return null;

  const history = Array.isArray(o.history) ? o.history : [];
  return {
    mode: o.mode,
    level: typeof o.level === 'number' ? Math.min(3, Math.max(0, Math.round(o.level))) : 3,
    pits: o.pits,
    scores: o.scores,
    turn: o.turn,
    history: history
      .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
      .filter(h => isBoard(h.pits) && isScores(h.scores) && (h.turn === 0 || h.turn === 1))
      .map(h => ({ pits: h.pits as number[], scores: h.scores as number[], turn: h.turn as 0 | 1 })),
    at: typeof o.at === 'number' ? o.at : Date.now(),
  };
}

export function loadSavedGame(): SavedGame | null {
  try {
    const raw = getStore().get(KEY);
    return raw ? coerce(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveGame(game: Omit<SavedGame, 'at'>): void {
  getStore().set(KEY, JSON.stringify({ ...game, at: Date.now() }));
}

export function clearSavedGame(): void {
  getStore().remove(KEY);
}
