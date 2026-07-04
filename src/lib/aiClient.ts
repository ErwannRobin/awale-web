// Thin promise wrapper around the AI web worker.
import type { AIRequest, AIResponse } from './ai.worker';

export class AIClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, (move: number | null) => void>();

  constructor() {
    this.worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<AIResponse>) => {
      const { id, move } = e.data;
      const resolve = this.pending.get(id);
      if (resolve) { this.pending.delete(id); resolve(move); }
    };
  }

  newGame(level: number) {
    this.pending.clear();
    const msg: AIRequest = { type: 'newGame', level };
    this.worker.postMessage(msg);
  }

  bestMove(which: 'game' | 'hint', pits: number[], scores: number[], player: 0 | 1): Promise<number | null> {
    const id = this.nextId++;
    return new Promise(resolve => {
      this.pending.set(id, resolve);
      const msg: AIRequest = { type: 'bestMove', id, which, pits: [...pits], scores: [...scores], player };
      this.worker.postMessage(msg);
    });
  }

  dispose() { this.worker.terminate(); }
}
