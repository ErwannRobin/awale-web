// Promise wrapper around the AI search.
//
// Where Web Workers exist the search runs off the main thread. Where they do
// not (React Native, SSR, older WebViews, a worker that failed to boot) the
// same `AwaleAI` runs inline instead, so the game never freezes waiting for a
// reply that will not come.
import { AwaleAI } from './ai.ts';
import type { AIRequest, AIResponse } from './ai.worker.ts';

interface Backend {
  newGame(level: number): void;
  bestMove(which: 'game' | 'hint', pits: number[], scores: number[], player: 0 | 1): Promise<number | null>;
  dispose(): void;
}

// ---- inline backend (portable: no DOM, no Worker) -----------------------
function inlineBackend(): Backend {
  let gameAI = new AwaleAI(3);
  let hintAI = new AwaleAI(3);
  return {
    newGame(level) { gameAI = new AwaleAI(level); hintAI = new AwaleAI(3); },
    bestMove(which, pits, scores, player) {
      const ai = which === 'game' ? gameAI : hintAI;
      return Promise.resolve(ai.bestMove(pits, scores, player));
    },
    dispose() { /* nothing to tear down */ },
  };
}

// ---- worker backend -----------------------------------------------------
function workerBackend(): Backend | null {
  if (typeof Worker === 'undefined') return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }

  interface Pending {
    resolve: (move: number | null) => void;
    retry: (b: Backend) => Promise<number | null>;
  }

  let nextId = 1;
  const pending = new Map<number, Pending>();
  let broken = false;
  const fallback = inlineBackend();
  let lastLevel = 3;

  worker.onmessage = (e: MessageEvent<AIResponse>) => {
    const { id, move } = e.data;
    const entry = pending.get(id);
    if (entry) { pending.delete(id); entry.resolve(move); }
  };

  // A worker that dies must not leave the board stuck on "Thinking…" — replay
  // every outstanding request against the inline search instead.
  const failOver = () => {
    if (!broken) { broken = true; fallback.newGame(lastLevel); }
    for (const [id, entry] of [...pending]) {
      pending.delete(id);
      void entry.retry(fallback).then(entry.resolve);
    }
  };
  worker.onerror = failOver;
  worker.onmessageerror = failOver;

  return {
    newGame(level) {
      lastLevel = level;
      pending.clear();
      if (broken) { fallback.newGame(level); return; }
      const msg: AIRequest = { type: 'newGame', level };
      worker.postMessage(msg);
    },
    bestMove(which, pits, scores, player) {
      const snapPits = [...pits], snapScores = [...scores];
      const retry = (b: Backend) => b.bestMove(which, snapPits, snapScores, player);
      if (broken) return retry(fallback);
      const id = nextId++;
      return new Promise<number | null>(resolve => {
        pending.set(id, { resolve, retry });
        const msg: AIRequest = { type: 'bestMove', id, which, pits: snapPits, scores: snapScores, player };
        try {
          worker.postMessage(msg);
        } catch {
          failOver();
        }
      });
    },
    dispose() { pending.clear(); worker.terminate(); },
  };
}

export class AIClient {
  private backend: Backend = workerBackend() ?? inlineBackend();

  newGame(level: number) { this.backend.newGame(level); }

  bestMove(which: 'game' | 'hint', pits: number[], scores: number[], player: 0 | 1) {
    return this.backend.bestMove(which, pits, scores, player);
  }

  dispose() { this.backend.dispose(); }
}
