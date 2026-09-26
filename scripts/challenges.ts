// Shared challenge machinery: a faithful replay of the game loop, and a search
// for whether the human can force a win from a fixed position.
//
// The rules here mirror `useGame.animateMove` exactly — including the blocked-
// player payout, which differs from `engine.endGame`'s own rule. Keep the two
// in step or the verifier will bless positions the game does not.
import { isValid, distribute, WINNING_SCORE } from '../src/lib/engine.ts';
import { AwaleAI, value, delay2 } from '../src/lib/ai.ts';

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

/**
 * The AI's reply at one fixed search depth — `AwaleAI.bestMove` with the
 * self-tuning taken out.
 *
 * Levels 0 and 1 never leave their starting depth, so `aiReply` is exactly the
 * opponent the player meets. Level 2 starts at 4 and may creep up to 6 when
 * the device is fast, so a level-2 puzzle is only sound if it survives every
 * depth in that range; the generator checks each one with this.
 */
export function aiReplyAtDepth(pits: number[], scores: number[], depth: number): number | null {
  const moves = legalMoves(pits, AI_SIDE);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];
  let bestValue = -100;
  const values = new Map<number, number>();
  for (const j of moves) {
    const v = value(pits, scores, j, 0, depth);
    values.set(j, v);
    bestValue = Math.max(bestValue, v);
  }
  let move = moves[moves.length - 1], bestDelay = -100;
  for (const j of moves) if (values.get(j) === bestValue) {
    const d = delay2(pits, scores, j, 0, depth);
    if (d > bestDelay) { bestDelay = d; move = j; }
  }
  return move;
}

export interface SolveOptions {
  maxPly?: number;
  nodeBudget?: number;
  /**
   * Every reply the AI might make here, in place of the level's own one. The
   * player only wins a line by beating ALL of them, so a level whose depth
   * drifts during a game (level 2) can be checked against every depth it may
   * reach, in any mix, in one search.
   */
  replies?: (pits: number[], scores: number[]) => (number | null)[];
}

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
  const replies = new Map<string, (number | null)[]>();
  const cachedReplies = (p: number[], s: number[]): (number | null)[] => {
    const k = key(p, s, AI_SIDE);
    const hit = replies.get(k);
    if (hit) return hit;
    const mv = opts.replies ? [...new Set(opts.replies(p, s))] : [aiReply(p, s, pos.level)];
    replies.set(k, mv);
    return mv;
  };

  // SOUNDNESS, and why the two verdicts are not symmetric:
  //
  //   `true`  is always a proof. A winning line was actually walked to a
  //           terminal position, so no budget can invalidate it. This is why
  //           more budget only ever finds MORE winning first moves for the same
  //           position — a smaller run reporting 2 of 4 and a larger one
  //           reporting 4 of 4 is expected, not a contradiction.
  //
  //   `false` is only meaningful when `exhausted` stayed false. Hitting the
  //           budget returns false and memoises it, so a poisoned entry can be
  //           reused elsewhere in the same run. That can only UNDER-report wins,
  //           never invent them — and because `exhausted` latches on and is
  //           never reset, any run that cached a budget-driven false reports
  //           `exhausted: true`. So "not solvable AND not exhausted" is the only
  //           negative anyone may trust, which is exactly what the caller checks.
  function humanWins(pits: number[], scores: number[], turn: 0 | 1, ply: number): boolean {
    if (nodes++ > nodeBudget || ply > maxPly) { exhausted = true; return false; }

    const k = key(pits, scores, turn);
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    if (onPath.has(k)) return false;   // repetition — no progress down this branch
    onPath.add(k);

    let answer = false;
    if (turn === AI_SIDE) {
      answer = true;
      for (const reply of cachedReplies(pits, scores)) {
        let won: boolean;
        if (reply == null) {
          won = decide(blockedPayout(pits, scores)) === 'human';
        } else {
          const st = step(pits, scores, turn, reply);
          won = st.over ? st.over === 'human' : humanWins(st.pits, st.scores, st.turn, ply + 1);
        }
        if (!won) { answer = false; break; }
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

export interface BoundedReport {
  solvable: boolean;
  /** First moves that force a win within the move limit. */
  winningFirstMoves: number[];
  firstMoves: number[];
  nodes: number;
  /** The node budget ran out, so a missing win is "not found", not "none". */
  budgetHit: boolean;
}

/**
 * Can the player force a win using at most `ownMoves` moves of their own?
 *
 * The question a "win in N" puzzle asks, and one `solve` cannot answer: its
 * memo ignores how deep a position was reached, so a win proved from a
 * shallow node would be reused at a deep one where the line no longer fits in
 * the limit. Here every entry carries its depth:
 *
 *   - a win is stored with the plies it needs, and reused only where that
 *     many plies are still left;
 *   - a "no win" is stored with the plies it was proved for, and reused only
 *     where no more are left than that.
 *
 * A "no win" that leaned on a repetition cut is not stored at all — whether a
 * line repeats depends on the path that reached it, so the verdict is only
 * true of that path. With that, and with the budget untouched, both verdicts
 * are exact: `solvable` false means no win exists within the limit.
 */
export function solveWithin(pos: Position, ownMoves: number, opts: SolveOptions = {}): BoundedReport {
  const nodeBudget = opts.nodeBudget ?? 2_000_000;
  const memoWin = new Map<string, number>();
  const memoNoWin = new Map<string, number>();
  const onPath = new Set<string>();
  let nodes = 0;
  let budgetHit = false;
  let cuts = 0;

  const key = (p: number[], s: number[], t: number) => `${p.join(',')}|${s[0]},${s[1]}|${t}`;
  const replyCache = new Map<string, (number | null)[]>();
  const repliesAt = (p: number[], s: number[]): (number | null)[] => {
    const k = key(p, s, AI_SIDE);
    const hit = replyCache.get(k);
    if (hit) return hit;
    const mv = opts.replies ? [...new Set(opts.replies(p, s))] : [aiReply(p, s, pos.level)];
    replyCache.set(k, mv);
    return mv;
  };

  /** Plies needed to force the win from here (≤ `left`), or -1. */
  function win(pits: number[], scores: number[], turn: 0 | 1, left: number): number {
    if (left <= 0) return -1;
    if (nodes++ > nodeBudget) { budgetHit = true; return -1; }
    const k = key(pits, scores, turn);
    const w = memoWin.get(k);
    if (w !== undefined && w <= left) return w;
    const lost = memoNoWin.get(k);
    if (lost !== undefined && lost >= left) return -1;
    if (onPath.has(k)) { cuts++; return -1; }
    onPath.add(k);
    const cutsBefore = cuts;

    // One ply from here: the move itself, then whatever the rest needs.
    const after = (move: number): number => {
      const st = step(pits, scores, turn, move);
      if (st.over) return st.over === 'human' ? 1 : -1;
      const rest = win(st.pits, st.scores, st.turn, left - 1);
      return rest < 0 ? -1 : rest + 1;
    };

    let result = -1;
    if (turn === AI_SIDE) {
      let worst = 0;
      for (const reply of repliesAt(pits, scores)) {
        const d = reply == null
          ? (decide(blockedPayout(pits, scores)) === 'human' ? 0 : -1)
          : after(reply);
        if (d < 0) { worst = -1; break; }
        worst = Math.max(worst, d);
      }
      result = worst;
    } else {
      for (const mv of legalMoves(pits, turn)) {
        const d = after(mv);
        if (d >= 0) { result = d; break; }
      }
    }

    onPath.delete(k);
    if (result >= 0) {
      memoWin.set(k, Math.min(memoWin.get(k) ?? Infinity, result));
    } else if (!budgetHit && cuts === cutsBefore) {
      memoNoWin.set(k, Math.max(memoNoWin.get(k) ?? 0, left));
    }
    return result;
  }

  // The first move is the first of `ownMoves`; the player moves on every
  // other ply after it, so the whole line is at most 2·ownMoves − 1 plies.
  const firstMoves = legalMoves(pos.pits, HUMAN);
  const winningFirstMoves: number[] = [];
  for (const mv of firstMoves) {
    const st = step(pos.pits, pos.scores, HUMAN, mv);
    const won = st.over
      ? st.over === 'human'
      : win(st.pits, st.scores, st.turn, 2 * ownMoves - 2) >= 0;
    if (won) winningFirstMoves.push(mv);
  }
  return { solvable: winningFirstMoves.length > 0, winningFirstMoves, firstMoves, nodes, budgetHit };
}

export const seedTotal = (pos: Position): number =>
  pos.pits.reduce((a, b) => a + b, 0) + pos.scores[0] + pos.scores[1];
