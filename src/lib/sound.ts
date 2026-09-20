// Sound effects, synthesised with the Web Audio API.
//
// No audio files: every sound is built from noise bursts and damped
// resonances, so the bundle stays asset-free, works offline, and gives the
// native build nothing to package.
//
// The model for a seed drop is a physical one. A real awalé seed hitting a
// carved pit makes three things at once:
//   1. a very short bright click  — the shell striking wood,
//   2. a low wooden "tock"        — the pit body ringing, loud and long when
//                                   the pit is empty, dull and short once it
//                                   is full of seeds,
//   3. a scatter of tiny rattles  — the seed settling against the seeds
//                                   already in the pit.
// Every drop is randomised (pitch, level, micro-timing), because a run of
// identical clicks reads as a machine, not as a hand sowing seeds.
//
// PORTING NOTE: React Native has no Web Audio. Swap the `play*` exports for
// expo-av / react-native-sound clips; nothing else calls into this file.
import { getSettings } from './settings.ts';

type Ctx = AudioContext & { resume(): Promise<void> };

let ctx: Ctx | null = null;
let unavailable = false;
// Everything goes through one bus: a gain stage feeding a limiter-ish
// compressor. That is what lets the sounds be loud — peaks get caught instead
// of clipping, so the average level can sit much higher than before.
let bus: GainNode | null = null;

const MASTER = 1.9;

// Browsers refuse to start audio before a gesture, so the context is created
// lazily on the first sound and resumed if it was suspended.
function audio(): Ctx | null {
  if (unavailable) return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) { unavailable = true; return null; }
      ctx = new Ctor() as Ctx;
      const input = ctx.createGain();
      input.gain.value = 1;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.knee.value = 12;
      comp.ratio.value = 8;
      comp.attack.value = 0.003;
      comp.release.value = 0.18;
      const out = ctx.createGain();
      out.gain.value = MASTER;
      input.connect(comp).connect(out).connect(ctx.destination);
      bus = input;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    unavailable = true;
    return null;
  }
}

function enabled(): boolean {
  return getSettings().sound && !unavailable;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// One white-noise buffer, reused by every burst at a random offset. Generating
// a fresh buffer per seed was the old approach; at twelve drops a second it is
// pure waste.
let noiseBuf: AudioBuffer | null = null;
function noise(ac: Ctx): AudioBuffer {
  if (!noiseBuf || noiseBuf.sampleRate !== ac.sampleRate) {
    const frames = Math.floor(ac.sampleRate * 0.5);
    noiseBuf = ac.createBuffer(1, frames, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < frames; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** A shaped noise burst: the impact part of a hit. */
function burst(
  ac: Ctx, t0: number, gain: number, dur: number,
  filter: BiquadFilterType, freq: number, q: number,
) {
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const f = ac.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t0);
  f.Q.setValueAtTime(q, t0);
  const amp = ac.createGain();
  amp.gain.setValueAtTime(Math.max(gain, 0.0002), t0);
  amp.gain.exponentialRampToValueAtTime(0.0002, t0 + dur);
  src.connect(f).connect(amp).connect(bus!);
  // A random read offset keeps successive bursts from sounding identical.
  src.start(t0, rnd(0, 0.4), dur + 0.02);
}

/** A damped sine partial: one resonant mode of the wooden pit. */
function mode(ac: Ctx, t0: number, freq: number, gain: number, dur: number) {
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  // Real wood drops slightly in pitch as the mode dies away.
  osc.frequency.exponentialRampToValueAtTime(freq * 0.94, t0 + dur);
  const amp = ac.createGain();
  amp.gain.setValueAtTime(Math.max(gain, 0.0002), t0);
  amp.gain.exponentialRampToValueAtTime(0.0002, t0 + dur);
  osc.connect(amp).connect(bus!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Short decaying tone, used for the melodic cues. */
function tone(freq: number, duration: number, gain: number, type: OscillatorType = 'sine', delay = 0) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  amp.gain.setValueAtTime(0.0002, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0002, t0 + duration);
  osc.connect(amp).connect(bus!);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/**
 * One seed landing in a pit.
 *
 * @param seeds how many seeds were ALREADY in the pit. An empty pit rings;
 *              a full one thuds and rattles.
 * @param level overall loudness scale, for seeds heard "in the background".
 */
function seedDrop(ac: Ctx, t0: number, seeds: number, level = 1) {
  // 0 seeds → 1 (hollow, ringing). Many seeds → towards 0 (packed, damped).
  const hollow = 1 / (1 + seeds * 0.55);
  const g = level * rnd(0.85, 1.15);

  // 1. shell click — very short and bright, this is what makes it read as a
  //    hard seed rather than a soft knock.
  burst(ac, t0, 0.5 * g, 0.012, 'highpass', rnd(2600, 4200), 0.7);
  // 2. wood contact — the dry body of the impact.
  burst(ac, t0 + rnd(0, 0.002), 0.42 * g, 0.045 + 0.05 * hollow, 'bandpass', rnd(520, 780), 2.2);
  // 3. pit resonance — two modes, loud and long only while the pit is empty.
  const f = rnd(185, 235) * (1 + seeds * 0.03);
  mode(ac, t0, f, 0.30 * g * hollow, 0.10 + 0.16 * hollow);
  mode(ac, t0 + 0.001, f * rnd(1.85, 2.1), 0.16 * g * hollow, 0.07 + 0.09 * hollow);

  // 4. settling — the seed nudging the seeds already down there. One or two
  //    faint, late, high clicks; the fuller the pit, the more of them.
  const rattles = Math.min(seeds, 3);
  for (let i = 0; i < rattles; i++) {
    burst(ac, t0 + rnd(0.012, 0.055), 0.16 * g, 0.010, 'bandpass', rnd(1600, 3400), 1.4);
  }
}

/**
 * One seed dropped into a pit during a sowing run.
 *
 * @param step  position in the run — used for a slow, natural drift in tone.
 * @param seeds seeds already in the destination pit, before this one lands.
 */
export function playSow(step = 0, seeds = 0): void {
  if (!enabled()) return;
  const ac = audio();
  if (!ac) return;
  // A tiny scheduling jitter: a hand does not sow on a metronome.
  const t0 = ac.currentTime + rnd(0, 0.006);
  // Seeds sown later in a run land a touch harder as the hand empties.
  seedDrop(ac, t0, seeds, 0.9 + Math.min(step, 8) * 0.012);
}

/**
 * A pit (or several) swept into your store: a handful of seeds poured in, then
 * a short rising cue so a capture is unmistakable.
 *
 * @param count number of pits captured.
 * @param seeds total seeds scooped up, when the caller knows it.
 */
export function playCapture(count = 1, seeds = count * 3): void {
  if (!enabled()) return;
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime;

  // The scoop: wood scraping as the hand sweeps the pit clean.
  burst(ac, t0, 0.26, 0.16, 'bandpass', 900, 1.1);

  // The pour: many seeds tumbling into the store over ~200ms, accelerating and
  // thinning out at the end, each landing on a pile that keeps growing.
  const n = Math.min(Math.max(seeds, 3), 14);
  for (let i = 0; i < n; i++) {
    const at = t0 + 0.02 + Math.pow(i / n, 0.72) * 0.22 + rnd(0, 0.012);
    seedDrop(ac, at, 4 + i, 0.62 - (i / n) * 0.2);
  }

  // Game cue, kept quiet under the seeds.
  for (let i = 0; i < Math.min(count, 4); i++) tone(520 + i * 90, 0.16, 0.09, 'triangle', 0.05 + i * 0.05);
}

export function playTap(): void {
  if (!enabled()) return;
  const ac = audio();
  if (!ac) return;
  burst(ac, ac.currentTime, 0.55, 0.022, 'bandpass', rnd(900, 1100), 0.8);
}

export function playWin(): void {
  if (!enabled()) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.5, 0.15, 'sine', i * 0.11));
}

export function playLose(): void {
  if (!enabled()) return;
  [392, 349.23, 293.66].forEach((f, i) => tone(f, 0.55, 0.14, 'sine', i * 0.14));
}

/**
 * Call from a user gesture (a button press) so the audio context is unlocked
 * before the first sound that actually matters. Silent no-op when sound is off.
 */
export function primeAudio(): void {
  if (!getSettings().sound) return;
  audio();
}
