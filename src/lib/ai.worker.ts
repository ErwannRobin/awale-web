// Runs the negamax search off the main thread so the UI never blocks.
// One stateful AwaleAI per game (self-tuning depth), plus a fixed
// strongest-level instance for hints.
import { AwaleAI, evaluate } from './ai.ts';

interface NewGameMsg { type: 'newGame'; level: number }
interface BestMoveMsg {
  type: 'bestMove';
  id: number;
  which: 'game' | 'hint';
  pits: number[];
  scores: number[];
  player: 0 | 1;
}
/** The win-probability bar's question: how does this position stand? */
interface EvalMsg {
  type: 'eval';
  id: number;
  pits: number[];
  scores: number[];
  player: 0 | 1;
}
export type AIRequest = NewGameMsg | BestMoveMsg | EvalMsg;
export type AIResponse =
  | { type: 'move'; id: number; which: 'game' | 'hint'; move: number | null }
  | { type: 'eval'; id: number; value: number | null };

let gameAI = new AwaleAI(3);
let hintAI = new AwaleAI(3);

self.onmessage = (e: MessageEvent<AIRequest>) => {
  const msg = e.data;
  if (msg.type === 'newGame') {
    gameAI = new AwaleAI(msg.level);
    hintAI = new AwaleAI(3);
    return;
  }
  if (msg.type === 'eval') {
    const res: AIResponse = { type: 'eval', id: msg.id, value: evaluate(msg.pits, msg.scores, msg.player) };
    (self as unknown as Worker).postMessage(res);
    return;
  }
  const ai = msg.which === 'game' ? gameAI : hintAI;
  const move = ai.bestMove(msg.pits, msg.scores, msg.player);
  const res: AIResponse = { type: 'move', id: msg.id, which: msg.which, move };
  (self as unknown as Worker).postMessage(res);
};
