// Shared challenge machinery: a faithful replay of the game loop, and a search
// for whether the human can force a win from a fixed position.
//
// The rules here mirror `useGame.animateMove` exactly — including the blocked-
// player payout, which differs from `engine.endGame`'s own rule. Keep the two
// in step or the verifier will bless positions the game does not.
import { isValid, distribute, WINNING_SCORE } from '../src/lib/engine.ts';
import { AwaleAI } from '../src/lib/ai.ts';

export interface Position {
  pits: number[];
  scores: [number, number];   // [South = computer, North = human]
  level: number;
}

export const HUMAN: 0 | 1 = 1;   // challenges always put the human on North
export const AI_SIDE: 0 | 1 = 0;

export function legalMoves(pits: number[], player: 0 | 1): number[] {
  const out: number[] = [];
  for (let j = player * 6; j < player * 6 + 6; j++) if (isValid(pits, j)) out.push(j);
  return out;
}

export type Result = 'human' | 'ai' | 'draw';

function decide(scores: number[]): Result {
  if (scores[HUMAN] > scores[AI_SIDE]) return 'human';
  if (scores[AI_SIDE] > scores[HUMAN]) return 'ai';
  return 'draw';
}

/** Blocked side to move: each player keeps the seeds still on their own row. */
function blockedPayout(pits: number[], scores: number[]): number[] {
  const s = [...scores];
  for (let k = 0; k < 6; k++) s[0] += pits[k];
  for (let k = 6; k < 12; k++) s[1] += pits[k];
  return s;
}

export interface Step {
  pits: number[];
  scores: number[];
  turn: 0 | 1;
  over: Result | null;
}

/** Apply one move exactly as the game does, returning the next state. */
export function step(pits: number[], scores: number[], turn: 0 | 1, move: number): Step {
  const p = [...pits], s = [...scores];
  const r = distribute(p, s, move);
  if (!r.running || s[turn] >= WINNING_SCORE) {
    return { pits: p, scores: s, turn, over: decide(s) };
  }
  const next = (1 - turn) as 0 | 1;
  if (legalMoves(p, next).length === 0) {
    const paid = blockedPayout(p, s);
    return { pits: Array(12).fill(0), scores: paid, turn: next, over: decide(paid) };
  }
  return { pits: p, scores: s, turn: next, over: null };
}

/**
 * The AI's reply. A fresh instance each time keeps the search sound: the real
 * `AwaleAI` self-tunes its depth over a game, so a shared instance would make
 * the same node answer differently depending on the path taken to reach it.
 * A fresh instance is the AI at its clamped starting depth, i.e. its weakest
 * form for that level — so a position this verifier calls unsolvable really is.
 */
export function aiReply(pits: number[], scores: number[], level: number): number | null {
  return new AwaleAI(level).bestMove(pits, scores, AI_SIDE, () => 0.5);
}

export interface SolveOptions { maxPly?: number; nodeBudget?: number }

export interface SolveReport {
  solvable: boolean;
  /** Human first moves that lead to a forced win. */
  winningFirstMoves: number[];
  firstMoves: number[];
  nodes: number;
  /** True when a limit was hit, so a `false` verdict is "not found", not "impossible". */
  exhausted: boolean;
}

/**
 * Depth-first search over the human's choices, with the AI replying
 * deterministically (so only the human branches). Memoised on the full state —
 * scores included, so an entry is a complete answer regardless of the path that
 * reached it. A state already on the current path is a repetition and counts as
 * "no forced win down this line", which also terminates the perpetual cycles the
 * engine's own draw check misses.
 */
export function solve(pos: Position, opts: SolveOptions = {}): SolveReport {
  const maxPly = opts.maxPly ?? 200;
  const nodeBudget = opts.nodeBudget ?? 2_000_000;
  const memo = new Map<string, boolean>();
  const onPath = new Set<string>();
  let nodes = 0;
  let exhausted = false;

  const key = (p: number[], s: number[], t: number) => `${p.join(',')}|${s[0]},${s[1]}|${t}`;

  // The AI is a pure function of the position, and a depth-5 search is by far
  // the most expensive thing here — cache it or the same reply is recomputed
  // once per transposition.
  const replies = new Map<string, number | null>();
  const cachedReply = (p: number[], s: number[]): number | null => {
    const k = key(p, s, AI_SIDE);
    if (replies.has(k)) return replies.get(k)!;
    const mv = aiReply(p, s, pos.level);
    replies.set(k, mv);
    return mv;
  };

  function humanWins(pits: number[], scores: number[], turn: 0 | 1, ply: number): boolean {
    if (nodes++ > nodeBudget || ply > maxPly) { exhausted = true; return false; }

    const k = key(pits, scores, turn);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    if (onPath.has(k)) return false;   // repetition — no progress down this branch
    onPath.add(k);

    let answer = false;
    if (turn === AI_SIDE) {
      const reply = cachedReply(pits, scores);
      if (reply == null) {
        answer = decide(blockedPayout(pits, scores)) === 'human';
      } else {
        const st = step(pits, scores, turn, reply);
        answer = st.over ? st.over === 'human' : humanWins(st.pits, st.scores, st.turn, ply + 1);
      }
    } else {
      for (const mv of legalMoves(pits, turn)) {
        const st = step(pits, scores, turn, mv);
        const won = st.over ? st.over === 'human' : humanWins(st.pits, st.scores, st.turn, ply + 1);
        if (won) { answer = true; break; }
      }
    }

    onPath.delete(k);
    memo.set(k, answer);
    return answer;
  }

  const firstMoves = legalMoves(pos.pits, HUMAN);
  const winningFirstMoves: number[] = [];
  for (const mv of firstMoves) {
    const st = step(pos.pits, pos.scores, HUMAN, mv);
    const won = st.over ? st.over === 'human' : humanWins(st.pits, st.scores, st.turn, 1);
    if (won) winningFirstMoves.push(mv);
  }

  return {
    solvable: winningFirstMoves.length > 0,
    winningFirstMoves,
    firstMoves,
    nodes,
    exhausted,
  };
}

export const seedTotal = (pos: Position): number =>
  pos.pits.reduce((a, b) => a + b, 0) + pos.scores[0] + pos.scores[1];
