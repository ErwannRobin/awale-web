// Runs the negamax search off the main thread so the UI never blocks.
// One stateful AwaleAI per game (self-tuning depth), plus a fixed
// strongest-level instance for hints.
import { AwaleAI } from './ai';

interface NewGameMsg { type: 'newGame'; level: number }
interface BestMoveMsg {
  type: 'bestMove';
  id: number;
  which: 'game' | 'hint';
  pits: number[];
  scores: number[];
  player: 0 | 1;
}
export type AIRequest = NewGameMsg | BestMoveMsg;
export interface AIResponse { type: 'move'; id: number; which: 'game' | 'hint'; move: number | null }

let gameAI = new AwaleAI(3);
let hintAI = new AwaleAI(3);

self.onmessage = (e: MessageEvent<AIRequest>) => {
  const msg = e.data;
  if (msg.type === 'newGame') {
    gameAI = new AwaleAI(msg.level);
    hintAI = new AwaleAI(3);
    return;
  }
  const ai = msg.which === 'game' ? gameAI : hintAI;
  const move = ai.bestMove(msg.pits, msg.scores, msg.player);
  const res: AIResponse = { type: 'move', id: msg.id, which: msg.which, move };
  (self as unknown as Worker).postMessage(res);
};
