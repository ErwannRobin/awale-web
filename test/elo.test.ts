// Tests for the ELO rating system
import {
  calculateNewRatings,
  expectedScore,
  initialRating,
  ratingChange,
  sortByRating,
  updatePlayerRating,
  DEFAULT_ELO,
  type PlayerRating,
} from '../src/lib/elo.ts';

// Test expected score calculation
console.assert(
  Math.abs(expectedScore(1200, 1200) - 0.5) < 0.001,
  'Expected score between equal ratings should be 0.5',
);

console.assert(
  expectedScore(1500, 1200) > 0.5,
  'Higher rated player should have expected score > 0.5',
);

console.assert(
  expectedScore(1200, 1500) < 0.5,
  'Lower rated player should have expected score < 0.5',
);

console.assert(
  expectedScore(2000, 1000) > 0.75,
  'Much higher rated player should have expected score > 0.75',
);

// Test initial rating
const initial = initialRating();
console.assert(
  initial.rating === DEFAULT_ELO.INITIAL_RATING,
  'Initial rating should match default',
);
console.assert(
  initial.gamesPlayed === 0,
  'Initial games played should be 0',
);

// Test rating calculation after a win
const { winner: winnerRating, loser: loserRating } = calculateNewRatings(
  1200, 1200, 0, 0, false, {},
);
console.assert(
  winnerRating > 1200,
  'Winner rating should increase after beating equal opponent',
);
console.assert(
  loserRating < 1200,
  'Loser rating should decrease after losing to equal opponent',
);
console.assert(
  Math.abs(winnerRating - loserRating) > 0,
  'Rating change should not be zero',
);

// Test rating calculation after a draw
const { winner: drawWinner, loser: drawLoser } = calculateNewRatings(
  1200, 1200, 0, 0, true, {},
);
console.assert(
  Math.abs(drawWinner - 1200) < Math.abs(winnerRating - 1200),
  'Rating change after draw should be less than after win',
);
console.assert(
  Math.abs(drawWinner - 1200) === Math.abs(drawLoser - 1200),
  'Equal opponents should move by the same amount after a draw',
);

// Test new player K-factor
const { winner: newPlayerWin } = calculateNewRatings(
  1200, 1200, 0, 0, false, {},
);
const { winner: experiencedWin } = calculateNewRatings(
  1200, 1200, 15, 15, false, {},
);
console.assert(
  Math.abs(newPlayerWin - 1200) > Math.abs(experiencedWin - 1200),
  'New player should have larger rating changes',
);

// Test updatePlayerRating
const player: PlayerRating = {
  rating: 1200,
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  draws: 0,
};

const updated = updatePlayerRating(player, 1200, 'win', {});
console.assert(
  updated.rating > 1200,
  'Rating should increase after win',
);
console.assert(
  updated.gamesPlayed === 1,
  'Games played should increment',
);
console.assert(
  updated.wins === 1,
  'Wins should increment',
);

const updated2 = updatePlayerRating(updated, 1200, 'loss', {});
console.assert(
  updated2.rating < updated.rating,
  'Rating should decrease after loss',
);
console.assert(
  updated2.losses === 1,
  'Losses should increment',
);

const updated3 = updatePlayerRating(updated2, 1200, 'draw', {});
console.assert(
  updated3.draws === 1,
  'Draws should increment',
);

// Test ratingChange
const change = ratingChange(1200, 1200, 'win', 0, {});
console.assert(
  change > 0,
  'Rating change for win should be positive',
);

const lossChange = ratingChange(1200, 1200, 'loss', 0, {});
console.assert(
  lossChange < 0,
  'Rating change for loss should be negative',
);

// Test sortByRating
const players = [
  { userId: '1', rating: 1000, name: 'Alice', gamesPlayed: 10 },
  { userId: '2', rating: 1500, name: 'Bob', gamesPlayed: 20 },
  { userId: '3', rating: 1200, name: 'Charlie', gamesPlayed: 5 },
];

const sorted = sortByRating(players);
console.assert(
  sorted[0].rating === 1500,
  'Highest rated player should be first',
);
console.assert(
  sorted[1].rating === 1200,
  'Second highest rated player should be second',
);
console.assert(
  sorted[2].rating === 1000,
  'Lowest rated player should be last',
);

// Test sortByRating ascending
const sortedAsc = sortByRating(players, true);
console.assert(
  sortedAsc[0].rating === 1000,
  'Lowest rated player should be first when ascending',
);
console.assert(
  sortedAsc[2].rating === 1500,
  'Highest rated player should be last when ascending',
);

console.log('All ELO tests passed!');
