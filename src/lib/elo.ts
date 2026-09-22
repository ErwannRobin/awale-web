// ELO rating system for Awale online matches.
//
// Standard ELO implementation with configurable parameters for Awale.
// See: https://en.wikipedia.org/wiki/Elo_rating_system

/** Default ELO parameters for Awale */
export const DEFAULT_ELO = {
  /** Starting rating for new players */
  INITIAL_RATING: 1200,
  /** K-factor: maximum rating change per game */
  K_FACTOR: 32,
  /** K-factor for new players (first few games) */
  NEW_PLAYER_K_FACTOR: 64,
  /** Number of games before a player is no longer considered "new" */
  NEW_PLAYER_GAMES: 10,
} as const;

export interface EloConfig {
  initialRating?: number;
  kFactor?: number;
  newPlayerKFactor?: number;
  newPlayerGames?: number;
}

export interface PlayerRating {
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
}

/**
 * Calculate the expected score for player A against player B.
 * Expected score is the probability that A wins.
 */
export function expectedScore(ratingA: number, ratingB: number): number {
  const diff = ratingB - ratingA;
  return 1 / (1 + Math.pow(10, diff / 400));
}

/**
 * Calculate new ratings after a match.
 *
 * @param winnerRating - Rating of the winner (or both ratings if draw)
 * @param loserRating - Rating of the loser (or both ratings if draw)
 * @param winnerGames - Games played by winner
 * @param loserGames - Games played by loser
 * @param isDraw - Whether the game was a draw
 * @param config - Optional ELO configuration
 * @returns New ratings for both players
 */
export function calculateNewRatings(
  winnerRating: number,
  loserRating: number,
  winnerGames: number,
  loserGames: number,
  isDraw: boolean,
  config: EloConfig = {},
): { winner: number; loser: number } {
  const {
    kFactor = DEFAULT_ELO.K_FACTOR,
    newPlayerKFactor = DEFAULT_ELO.NEW_PLAYER_K_FACTOR,
    newPlayerGames = DEFAULT_ELO.NEW_PLAYER_GAMES,
  } = config;

  const kWinner = winnerGames < newPlayerGames ? newPlayerKFactor : kFactor;
  const kLoser = loserGames < newPlayerGames ? newPlayerKFactor : kFactor;

  if (isDraw) {
    const eA = expectedScore(winnerRating, loserRating);
    const eB = expectedScore(loserRating, winnerRating);
    const newRatingA = winnerRating + kWinner * (0.5 - eA);
    const newRatingB = loserRating + kLoser * (0.5 - eB);
    return { winner: newRatingA, loser: newRatingB };
  }

  const eWinner = expectedScore(winnerRating, loserRating);
  const eLoser = expectedScore(loserRating, winnerRating);

  const newWinnerRating = winnerRating + kWinner * (1 - eWinner);
  const newLoserRating = loserRating + kLoser * (0 - eLoser);

  return { winner: newWinnerRating, loser: newLoserRating };
}

/**
 * Update a player's rating after a match result.
 *
 * @param player - Current player rating info
 * @param opponentRating - Opponent's rating
 * @param result - 'win', 'loss', or 'draw'
 * @param config - Optional ELO configuration
 * @returns Updated player rating info
 */
export function updatePlayerRating(
  player: PlayerRating,
  opponentRating: number,
  result: 'win' | 'loss' | 'draw',
  config: EloConfig = {},
): PlayerRating {
  const isDraw = result === 'draw';
  const isWin = result === 'win';

  const { winner, loser } = calculateNewRatings(
    player.rating,
    opponentRating,
    player.gamesPlayed,
    0, // We don't track opponent's games here
    isDraw,
    config,
  );

  const newRating = isDraw ? winner : isWin ? winner : loser;

  return {
    rating: Math.round(newRating),
    gamesPlayed: player.gamesPlayed + 1,
    wins: player.wins + (isWin ? 1 : 0),
    losses: player.losses + (result === 'loss' ? 1 : 0),
    draws: player.draws + (isDraw ? 1 : 0),
  };
}

/**
 * Create initial rating for a new player.
 */
export function initialRating(config: EloConfig = {}): PlayerRating {
  return {
    rating: config.initialRating ?? DEFAULT_ELO.INITIAL_RATING,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    draws: 0,
  };
}

/**
 * Calculate the rating change from a match result.
 * Useful for displaying rating changes to players.
 */
export function ratingChange(
  playerRating: number,
  opponentRating: number,
  result: 'win' | 'loss' | 'draw',
  gamesPlayed: number,
  config: EloConfig = {},
): number {
  const isDraw = result === 'draw';
  const isWin = result === 'win';

  const { winner, loser } = calculateNewRatings(
    playerRating,
    opponentRating,
    gamesPlayed,
    0,
    isDraw,
    config,
  );

  const newRating = isDraw ? winner : isWin ? winner : loser;
  return Math.round(newRating - playerRating);
}

/**
 * Sort players by rating for leaderboard display.
 * Higher rating = better position (position 1 is the best).
 */
export function sortByRating(
  players: { userId: string; rating: number; name: string; gamesPlayed: number }[],
  ascending: boolean = false,
): typeof players {
  return [...players].sort((a, b) => {
    const diff = b.rating - a.rating;
    if (diff !== 0) return ascending ? -diff : diff;
    if (b.gamesPlayed !== a.gamesPlayed) {
      return ascending ? b.gamesPlayed - a.gamesPlayed : a.gamesPlayed - b.gamesPlayed;
    }
    return ascending ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
  });
}
