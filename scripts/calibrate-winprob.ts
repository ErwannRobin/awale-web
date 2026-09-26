// Fits the win-probability bar to real outcomes, rather than to a guess.
//
//   npm run winprob:calibrate -- mine <seed> <games> <out.jsonl>
//   npm run winprob:calibrate -- fit <in.jsonl>...
//
// `mine` plays self-play games between two players of different strength —
// each side searches to its own depth, from 2 plies to 7, and plays a random
// legal move some of the time — so the positions look like people of every
// level playing, not like the Master playing itself. At every position it
// records what the bar would see (the evaluation for the side to move, the
// seeds still on the board, the score difference) and, at the end, how the
// game actually went for that side.
//
// `fit` searches the two constants of the model in `lib/winProbability.ts`
// for the ones that predict those outcomes best (lowest log loss), prints them
// with a calibration table — how often a side given 70% actually won — and
// leaves the pasting to a person, so a new fit is always a reviewed change.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { evaluate, value } from '../src/lib/ai.ts';
import { applyMove, legalMoves, type Seat } from '../src/lib/rules.ts';
import { winProbability } from '../src/lib/winProbability.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Sample {
  /** Evaluation for the side to move. */
  e: number;
  /** Seeds on the board. */
  r: number;
  /** Banked score difference, side to move minus the other. */
  d: number;
  /** How it ended for the side to move: 1 win, 0.5 draw, 0 loss. */
  y: number;
}

function choose(pits: number[], scores: number[], player: Seat, depth: number, noise: number, rng: () => number): number {
  const moves = legalMoves(pits, player);
  if (rng() < noise) return moves[Math.floor(rng() * moves.length)];
  let best = moves[0], bestValue = -Infinity;
  for (const mv of moves) {
    const v = value(pits, scores, mv, 0, depth) + rng() * 0.01;   // break ties at random
    if (v > bestValue) { bestValue = v; best = mv; }
  }
  return best;
}

function mine(seed: number, games: number, out: string): void {
  const rng = mulberry32(seed);
  writeFileSync(out, '');
  let samples = 0;
  for (let g = 0; g < games; g++) {
    let pits = Array(12).fill(4) as number[];
    let scores = [0, 0];
    let turn: Seat = rng() < 0.5 ? 0 : 1;
    const depth: [number, number] = [2 + Math.floor(rng() * 6), 2 + Math.floor(rng() * 6)];
    const noise: [number, number] = [rng() * 0.25, rng() * 0.25];
    const seen: { player: Seat; e: number; r: number; d: number }[] = [];
    let winner: Seat | 'draw' | null = null;

    for (let ply = 0; ply < 300 && winner === null; ply++) {
      const e = evaluate(pits, scores, turn);
      if (e === null) break;
      seen.push({ player: turn, e, r: pits.reduce((a, b) => a + b, 0), d: scores[turn] - scores[1 - turn] });
      const out = applyMove(pits, scores, choose(pits, scores, turn, depth[turn], noise[turn], rng));
      pits = out.pits;
      scores = out.scores;
      if (out.end) winner = out.end.winner;
      else turn = out.next;
    }
    if (winner === null) continue;   // an endless shuffle: no outcome to learn from
    const lines = seen.map(s => JSON.stringify({
      e: s.e, r: s.r, d: s.d,
      y: winner === 'draw' ? 0.5 : winner === s.player ? 1 : 0,
    } satisfies Sample));
    appendFileSync(out, lines.join('\n') + '\n');
    samples += lines.length;
    if (g % 50 === 0) console.log(`seed ${seed}: game ${g}/${games}, ${samples} samples`);
  }
  console.log(`seed ${seed}: ${samples} samples → ${out}`);
}

function logLoss(samples: Sample[], k: number, c: number): number {
  let sum = 0;
  for (const s of samples) {
    const p = Math.min(1 - 1e-6, Math.max(1e-6, winProbability(s.e, s.r, s.d, { k, c })));
    sum -= s.y * Math.log(p) + (1 - s.y) * Math.log(1 - p);
  }
  return sum / samples.length;
}

function fit(files: string[]): void {
  const samples: Sample[] = [];
  for (const f of files) {
    for (const line of readFileSync(f, 'utf8').split('\n')) if (line.trim()) samples.push(JSON.parse(line));
  }
  console.log(`${samples.length} positions`);

  let best = { k: 1, c: 0, loss: Infinity };
  for (let k = 0.1; k <= 3; k += 0.05) {
    for (let c = 0; c <= 40; c += 2) {
      const loss = logLoss(samples, k, c);
      if (loss < best.loss) best = { k: +k.toFixed(2), c, loss };
    }
  }
  const coin = logLoss(samples, 0, 0);
  console.log(`best: k = ${best.k}, c = ${best.c}, log loss ${best.loss.toFixed(4)} (a coin flip: ${coin.toFixed(4)})`);

  // Calibration: of the positions given about p, how often did that side win?
  console.log('\npredicted   actual   positions');
  for (let lo = 0; lo < 1; lo += 0.1) {
    const bin = samples.filter(s => {
      const p = winProbability(s.e, s.r, s.d, best);
      return p >= lo && (p < lo + 0.1 || (lo >= 0.9 && p <= 1));
    });
    if (bin.length === 0) continue;
    const predicted = bin.reduce((a, s) => a + winProbability(s.e, s.r, s.d, best), 0) / bin.length;
    const actual = bin.reduce((a, s) => a + s.y, 0) / bin.length;
    console.log(`${(predicted * 100).toFixed(1).padStart(6)}%   ${(actual * 100).toFixed(1).padStart(6)}%   ${bin.length}`);
  }
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'mine') mine(Number(args[0] ?? 1), Number(args[1] ?? 100), args[2] ?? 'winprob.jsonl');
else if (mode === 'fit') fit(args);
else console.log('usage: calibrate-winprob mine <seed> <games> <out> | fit <in>...');
