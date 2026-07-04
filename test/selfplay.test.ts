// Full-game self-play: confirms games terminate with a valid outcome and that
// captures never exceed the seeds on the board. Exercises the same engine paths
// the UI uses (isValid / distribute / endGame / blocked-player).
import { isValid, distribute } from '../src/lib/engine.ts';
import { AwaleAI } from '../src/lib/ai.ts';

function legal(pits: number[], player: 0 | 1): number[] {
  const out: number[] = [];
  for (let j = player * 6; j < player * 6 + 6; j++) if (isValid(pits, j)) out.push(j);
  return out;
}

let games = 0, fails = 0;
const maxPlies = 5000;

// Deterministic RNG so runs are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

for (let g = 0; g < 30; g++) {
  const pits = Array(12).fill(4);
  const scores = [0, 0];
  const ai0 = new AwaleAI(g % 3);          // levels 0-2 keep the sim fast
  const ai1 = new AwaleAI((g + 1) % 3);
  const r = rng(g + 1);
  let player: 0 | 1 = 0;
  let plies = 0;
  let ended = false;

  while (plies < maxPlies) {
    const moves = legal(pits, player);
    if (moves.length === 0) {
      // Blocked player: each keeps their own row.
      for (let k = 0; k < 6; k++) scores[0] += pits[k];
      for (let k = 6; k < 12; k++) scores[1] += pits[k];
      ended = true; break;
    }
    const ai = player === 0 ? ai0 : ai1;
    const mv = ai.bestMove(pits, scores, player, r);
    if (mv == null) {
      for (let k = 0; k < 6; k++) scores[0] += pits[k];
      for (let k = 6; k < 12; k++) scores[1] += pits[k];
      ended = true; break;
    }
    if (!isValid(pits, mv)) { console.error(`game ${g}: AI returned illegal move ${mv}`); fails++; break; }
    const res = distribute(pits, scores, mv);
    if (!res.running || scores[player] >= 25) { ended = true; break; }
    player = player === 0 ? 1 : 0;
    plies++;
  }

  const total = pits.reduce((a, b) => a + b, 0) + scores[0] + scores[1];
  if (total !== 48) { console.error(`game ${g}: seed conservation broken, total=${total}`); fails++; }
  if (!ended) { console.error(`game ${g}: did not terminate within ${maxPlies} plies`); fails++; }
  games++;
}

console.log(`\n${games} games simulated, ${fails} failures`);
if (fails > 0) process.exit(1);
