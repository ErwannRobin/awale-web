// One move, start to finish — the layer the local game loop and the online
// server both stand on.
//
// `engine.ts` knows how seeds are sown and captured. It does NOT know when a
// game is over from the *players'* point of view: the 25-seed majority, and the
// side to move having no legal reply. Those two rules used to live inside
// `useGame.ts`, which was fine while the only judge was the local device.
//
// Online play adds a second judge. A server that ends a game on a different
// rule from the client is the worst class of bug in a board game: both sides
// see a different result and neither is obviously wrong. So the rule lives
// here, once, and both callers import it.
import { distribute, isValid, owner, WINNING_SCORE } from './engine.ts';

export type Seat = 0 | 1;
export type Winner = Seat | 'draw';

/**
 * Why the game stopped.
 * - `board`  — the engine's own end conditions (see `endGame`)
 * - `score`  — someone passed the 25-seed majority
 * - `blocked` — the side to move has no legal move
 */
export type EndReason = 'board' | 'score' | 'blocked';

export interface GameEnd {
  winner: Winner;
  reason: EndReason;
}

export interface MoveOutcome {
  /** The board after sowing, capturing, and any end-of-game folding. */
  pits: number[];
  scores: number[];
  mover: Seat;
  /** Whose turn it is next. Meaningless when `end` is set. */
  next: Seat;
  /** Pit indices that received a seed, in order — this drives the animation. */
  sowed: number[];
  /** Pits emptied by capture, last-sown first. */
  captured: number[];
  end: GameEnd | null;
}

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

export function legalMoves(pits: number[], player: Seat): number[] {
  const out: number[] = [];
  for (let j = player * 6; j < player * 6 + 6; j++) if (isValid(pits, j)) out.push(j);
  return out;
}

/** 48 seeds is the whole board; anything else is a corrupt position. */
export const seedsOnBoard = (pits: number[], scores: number[]): number =>
  pits.reduce((a, b) => a + b, 0) + scores[0] + scores[1];

export const decideWinner = (scores: number[]): Winner =>
  scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : 'draw';

/** Is this a move `player` is actually allowed to make right now? */
export function canPlay(pits: number[], player: Seat, pit: number): boolean {
  if (!Number.isInteger(pit) || pit < 0 || pit > 11) return false;
  if (owner(pit) !== player) return false;
  return isValid(pits, pit);
}

/**
 * Play `pit` from the given position. Pure — the inputs are not touched.
 *
 * The order of the end-of-game checks is load-bearing and matches the original
 * C engine: the engine's own conditions first, then the 25-seed majority, then
 * the blocked-player rule.
 */
export function applyMove(pits: number[], scores: number[], pit: number): MoveOutcome {
  const work = [...pits];
  const sc = [...scores];
  const mover = owner(pit) as Seat;
  const result = distribute(work, sc, pit);
  const next = other(mover);

  if (!result.running || sc[mover] >= WINNING_SCORE) {
    return {
      pits: work, scores: sc, mover, next,
      sowed: result.sowed, captured: result.captured,
      end: { winner: decideWinner(sc), reason: result.running ? 'score' : 'board' },
    };
  }

  // The side to move cannot move. Each player keeps the seeds still sitting in
  // their own row.
  //
  // NOTE: `engine.endGame`'s second condition pays the *whole* board to one
  // side in a neighbouring situation. The two rules disagree, and this one is
  // the one the game has always shown players, so it is the one the server
  // follows too. Unifying them changes results and belongs in its own change.
  if (legalMoves(work, next).length === 0) {
    for (let k = 0; k < 6; k++) sc[0] += work[k];
    for (let k = 6; k < 12; k++) sc[1] += work[k];
    return {
      pits: Array(12).fill(0), scores: sc, mover, next,
      sowed: result.sowed, captured: result.captured,
      end: { winner: decideWinner(sc), reason: 'blocked' },
    };
  }

  return {
    pits: work, scores: sc, mover, next,
    sowed: result.sowed, captured: result.captured,
    end: null,
  };
}
