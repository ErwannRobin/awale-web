// Generates the seed-sound pack with the ElevenLabs sound-effects API.
//
//   ELEVENLABS_API_KEY=... npm run sounds:generate
//   ELEVENLABS_API_KEY=... npm run sounds:generate -- drop-1 scoop-1   # only these
//
// Output goes to public/sounds/v1/*.wav — fixed names, read by src/lib/sound.ts.
// The version in the path is deliberate: the service worker caches by URL, so a
// new pack must be v2 rather than new bytes at an old name.
//
// Audio comes back as raw 24 kHz mono PCM, which this script trims, normalises,
// fades and wraps in a WAV header. No encoder is needed, and a seed drop is
// about 10 KB. To shrink the pack afterwards, if you have ffmpeg:
//
//   for f in public/sounds/v1/*.wav; do ffmpeg -i "$f" -b:a 96k "${f%.wav}.mp3"; done
//
// then drop the .mp3 file in alongside — sound.ts tries .wav then .mp3 per
// clip name, so it's picked up with no code change, and .wav can be deleted
// or kept as a fallback.
//
// API SHAPE: this targets POST /v1/sound-generation with the `xi-api-key`
// header. If ElevenLabs has moved on, the script prints the server's error body
// verbatim — that response says what changed. MODEL_ID and OUTPUT_FORMAT are
// overridable by environment variable so a change needs no code edit.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const KEY = process.env.ELEVENLABS_API_KEY;
const ENDPOINT = process.env.ELEVENLABS_ENDPOINT ?? 'https://api.elevenlabs.io/v1/sound-generation';
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? '';
const OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT ?? 'pcm_24000';
const SAMPLE_RATE = Number(OUTPUT_FORMAT.replace(/^pcm_/, '')) || 24000;
const OUT_DIR = join(import.meta.dirname, '..', 'public', 'sounds', 'v1');

interface Spec {
  name: string;
  text: string;
  seconds: number;
  /** Peak the trimmed clip is normalised to. Keeps the pack internally balanced. */
  peak: number;
  /**
   * Hard cap on the clip's length after trimming, in ms. `duration_seconds` is
   * a hint, not a limit — the model sometimes returns a sustained ring several
   * times longer than asked (measured: a "short dry knock" came back at 850–
   * 960ms). At the game's 220ms-per-seed sowing cadence (110ms on "fast"), a
   * clip that long overlaps 3-4 deep on itself and turns to mud. Omit for
   * clips that are not on that per-seed cadence (the capture scoop).
   */
  maxMs?: number;
}

// Close-mic, dry, no music: anything atmospheric fights the game's own pacing,
// and a clip with a room tail smears when twelve of them play in a row.
const DRY = 'Close-up mono recording, dry, no reverb, no room tone, no music, no voices.';

const SPECS: Spec[] = [
  // Six single-seed drops into a bare pit. Variants exist so a sowing run never
  // repeats the same waveform twice in a row.
  ...[1, 2, 3, 4, 5, 6].map(i => ({
    name: `drop-${i}`,
    text: `One small hard dried seed dropped from a few centimetres into an empty carved wooden bowl. A single short dry wooden knock with a brief hollow ring, then silence. ${DRY}`,
    seconds: 0.5,
    peak: 0.85,
    maxMs: 320,
  })),
  // Four drops onto seeds already in the pit: duller, with a rattle.
  ...[1, 2, 3, 4].map(i => ({
    name: `drop-seeds-${i}`,
    text: `One small hard dried seed dropped onto a small pile of dried seeds inside a carved wooden bowl. A short dull click followed by a faint rattle of seeds settling. ${DRY}`,
    seconds: 0.5,
    peak: 0.8,
    maxMs: 300,
  })),
  // The capture: a handful swept up and poured into the store.
  ...[1, 2].map(i => ({
    name: `scoop-${i}`,
    text: `A hand sweeps about ten dried seeds out of a carved wooden bowl and pours them into another wooden bowl. Wooden scrape, then seeds tumbling and settling. ${DRY}`,
    seconds: 1.5,
    peak: 0.9,
  })),
  {
    name: 'tap-1',
    text: `A single soft fingertip tap on a polished wooden board. Very short and quiet. ${DRY}`,
    seconds: 0.5,
    peak: 0.5,
    maxMs: 220,
  },
];

async function generate(spec: Spec): Promise<Int16Array> {
  const url = `${ENDPOINT}?output_format=${encodeURIComponent(OUTPUT_FORMAT)}`;
  const body: Record<string, unknown> = {
    text: spec.text,
    duration_seconds: spec.seconds,
    // High influence: these prompts describe a physical event precisely, and the
    // model's own embellishments (music beds, room tails) are exactly wrong here.
    prompt_influence: 0.75,
  };
  if (MODEL_ID) body.model_id = MODEL_ID;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': KEY!, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${spec.name}: HTTP ${res.status} ${res.statusText}\n${await res.text()}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 64) throw new Error(`${spec.name}: response was ${bytes.length} bytes`);
  // Raw little-endian signed 16-bit PCM.
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 2));
}

/**
 * Trim silence, cap the length, normalise to `peak`, fade the tail so the clip
 * cannot click.
 */
function clean(pcm: Int16Array, peak: number, maxMs?: number): Int16Array {
  const f = Float32Array.from(pcm, v => v / 32768);

  let max = 0;
  for (const v of f) max = Math.max(max, Math.abs(v));
  if (max === 0) throw new Error('clip is silent');

  // Anything under 0.8% of the loudest sample is silence for our purposes.
  const floor = max * 0.008;
  let start = 0;
  while (start < f.length && Math.abs(f[start]) < floor) start++;
  let end = f.length - 1;
  while (end > start && Math.abs(f[end]) < floor) end--;

  // Keep 3ms of run-up so the attack is not sliced into.
  start = Math.max(0, start - Math.floor(SAMPLE_RATE * 0.003));
  end = Math.min(f.length - 1, end + Math.floor(SAMPLE_RATE * 0.004));

  // A sustained ring past `maxMs` gets cut, not just left to decay on its own —
  // the model's own decay is sometimes minutes-long-sounding relative to a real
  // wooden knock. A longer fade on the cut hides the truncation.
  if (maxMs != null) end = Math.min(end, start + Math.floor(SAMPLE_RATE * maxMs / 1000));

  const cut = f.slice(start, end + 1);
  const gain = peak / max;
  const naturalFade = Math.floor(SAMPLE_RATE * 0.008);
  const cappedFade = Math.floor(SAMPLE_RATE * 0.025);
  const fade = Math.min(maxMs != null ? cappedFade : naturalFade, Math.floor(cut.length / 4));
  const out = new Int16Array(cut.length);
  for (let i = 0; i < cut.length; i++) {
    const tail = i >= cut.length - fade ? (cut.length - i) / fade : 1;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(cut[i] * gain * tail * 32767)));
  }
  return out;
}

function wav(pcm: Int16Array): Buffer {
  const header = Buffer.alloc(44);
  const dataBytes = pcm.length * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);            // PCM chunk size
  header.writeUInt16LE(1, 20);             // format: PCM
  header.writeUInt16LE(1, 22);             // channels: mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);             // block align
  header.writeUInt16LE(16, 34);            // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, dataBytes)]);
}

if (!KEY) {
  console.error('ELEVENLABS_API_KEY is not set.');
  process.exit(1);
}

const only = process.argv.slice(2);
const todo = only.length ? SPECS.filter(s => only.includes(s.name)) : SPECS;
if (todo.length === 0) {
  console.error(`No spec matched ${only.join(', ')}. Known: ${SPECS.map(s => s.name).join(', ')}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
let failed = 0;
for (const spec of todo) {
  try {
    const pcm = clean(await generate(spec), spec.peak, spec.maxMs);
    const file = join(OUT_DIR, `${spec.name}.wav`);
    writeFileSync(file, wav(pcm));
    const ms = Math.round((pcm.length / SAMPLE_RATE) * 1000);
    console.log(`  ok  ${spec.name}.wav  ${ms}ms  ${(pcm.length * 2 / 1024).toFixed(1)}KB`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${spec.name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`\n${todo.length - failed} written, ${failed} failed → public/sounds/v1/`);
process.exit(failed ? 1 : 0);
