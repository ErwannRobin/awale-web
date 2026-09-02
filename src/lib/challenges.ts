// The twelve fixed challenge positions.
//
// Goal text is NOT stored here — it lives in the translation tables under
// `challenge.1` … `challenge.12`, so the puzzles are translatable.
//
// Every position is checked by `npm run verify:challenges`: seeds must total
// 48, and the player must have a line that beats the configured AI.
import challenges from '../content/challenges.json';
import type { StringKey } from '../i18n/index.ts';

export interface Challenge {
  /** Engine level for the computer opponent, default 1. */
  levelIA?: number;
  /** [computer (South, player 0), human (North, player 1)] seeds already banked. */
  scores: [number, number];
  /** The twelve pits; pits + scores always total 48. */
  pits: number[];
}

export const CHALLENGES = challenges as Challenge[];

export const challengeGoalKey = (index: number): StringKey =>
  `challenge.${index + 1}` as StringKey;
