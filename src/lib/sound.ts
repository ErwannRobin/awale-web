// Sound effects, synthesised with the Web Audio API.
//
// No audio files: a seed landing in a wooden pit is a short filtered noise
// burst, and everything else is a couple of decaying sine partials. That keeps
// the bundle asset-free, works offline, and gives the native build nothing to
// package.
//
// PORTING NOTE: React Native has no Web Audio. Swap the four `play*` exports
// for expo-av / react-native-sound clips; nothing else calls into this file.
import { getSettings } from './settings.ts';

type Ctx = AudioContext & { resume(): Promise<void> };

let ctx: Ctx | null = null;
let unavailable = false;

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

/** Short decaying sine, used for the melodic cues. */
function tone(freq: number, duration: number, gain: number, type: OscillatorType = 'sine', delay = 0) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** Filtered noise burst — a seed hitting wood. */
function knock(gain: number, freq: number, delay = 0) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const frames = Math.floor(ac.sampleRate * 0.05);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Exponential decay keeps it a click rather than a hiss.
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 6);
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(freq, t0);
  band.Q.setValueAtTime(1.6, t0);
  const amp = ac.createGain();
  amp.gain.setValueAtTime(gain, t0);
  src.connect(band).connect(amp).connect(ac.destination);
  src.start(t0);
}

/** One seed dropped into a pit. `step` varies the pitch across a sowing run. */
export function playSow(step = 0): void {
  if (!enabled()) return;
  knock(0.32, 320 + (step % 6) * 28);
}

/** A pit swept into your store. */
export function playCapture(count = 1): void {
  if (!enabled()) return;
  knock(0.4, 220);
  for (let i = 0; i < Math.min(count, 4); i++) tone(520 + i * 90, 0.16, 0.12, 'triangle', i * 0.05);
}

export function playTap(): void {
  if (!enabled()) return;
  knock(0.18, 700);
}

export function playWin(): void {
  if (!enabled()) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.5, 0.14, 'sine', i * 0.11));
}

export function playLose(): void {
  if (!enabled()) return;
  [392, 349.23, 293.66].forEach((f, i) => tone(f, 0.55, 0.12, 'sine', i * 0.14));
}

/**
 * Call from a user gesture (a button press) so the audio context is unlocked
 * before the first sound that actually matters. Silent no-op when sound is off.
 */
export function primeAudio(): void {
  if (!getSettings().sound) return;
  audio();
}
