// The win-probability bar's number: P(South wins), kept in step with the board.
//
// The search runs in its own worker, never the game's, so the bar can neither
// slow the AI's reply nor disturb its self-tuning depth. It asks once per
// settled position — not during a sowing animation, whose board is a picture
// of a move half made — and a reply for a position the board has already left
// is thrown away.
import { useEffect, useRef, useState } from 'react';
import { AIClient } from './aiClient.ts';
import { winProbability } from './winProbability.ts';
import type { Phase, Winner } from './useGame.ts';

export function useWinProbability(
  pits: number[], scores: number[], turn: 0 | 1, phase: Phase, winner: Winner, enabled: boolean,
): number | null {
  const [p, setP] = useState<number | null>(null);
  const client = useRef<AIClient | null>(null);
  const asked = useRef(0);

  useEffect(() => () => { client.current?.dispose(); client.current = null; }, []);

  const key = `${pits.join(',')}|${scores.join(',')}|${turn}`;
  useEffect(() => {
    if (!enabled) return;
    if (phase === 'over') {
      setP(winner === 0 ? 1 : winner === 1 ? 0 : 0.5);
      return;
    }
    if (phase !== 'idle') return;
    const id = ++asked.current;
    client.current ??= new AIClient();
    const board = [...pits], banked = [...scores];
    void client.current.evaluate(board, banked, turn).then(e => {
      if (id !== asked.current || e === null) return;
      const onBoard = board.reduce((a, b) => a + b, 0);
      const mine = winProbability(e, onBoard, banked[turn] - banked[1 - turn]);
      setP(turn === 0 ? mine : 1 - mine);
    });
    // `key` stands for the position; the arrays themselves change identity
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, phase, winner, enabled]);

  return enabled ? p : null;
}
