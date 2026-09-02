// The QR code, read back by something that is not us.
//
// A QR that looks right and does not scan is worse than no QR: the player
// stands there pointing a camera at it. Structure checks — the right size, the
// finder patterns in the corners — catch a lot, but they cannot tell you
// whether a real reader gets the link out the other end.
//
// So this decodes what we drew, with an independent decoder, and compares it
// with what went in. It covers our half of the job as much as the encoder's:
// the module grid is turned into pixels here exactly as the SVG turns it into a
// picture, so an off-by-one in the quiet zone or a flipped row would fail here
// too.
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { QUIET_ZONE, encodeQr } from '../src/lib/qr.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL ${name}`);
    console.log(String(error));
  }
}

/** Modules per pixel. Six is well above what a decoder needs and stays fast. */
const SCALE = 6;

/** Renders a code the way the SVG does, then reads it with a real decoder. */
function roundTrip(text: string): string | null {
  const { size, path } = encodeQr(text);

  const dark = new Set<string>();
  for (const [, x, y] of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) dark.add(`${x},${y}`);

  const px = size * SCALE;
  // White everywhere, including the quiet zone, which is what the SVG's
  // background rect paints.
  const data = new Uint8ClampedArray(px * px * 4).fill(255);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      if (!dark.has(`${Math.floor(x / SCALE)},${Math.floor(y / SCALE)}`)) continue;
      const i = (y * px + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }

  return jsQR(data, px, px)?.data ?? null;
}

console.log('QR codes a scanner can actually read');

check('a real sign-in link survives the round trip', () => {
  const link = 'https://wa.me/1234567890?text=Verification%20token%3A%20%5Bi2vzxv%5D%20reply%20to%20sign%20in';
  assert.equal(roundTrip(link), link);
});

check('a short link and a long one both come back whole', () => {
  const short = 'https://wa.me/1';
  assert.equal(roundTrip(short), short);

  // Long enough to push the encoder to a larger version, which is where a
  // layout mistake stops being invisible.
  const long = 'https://wa.me/33612345678?text='
    + encodeURIComponent('Verification token: [abc123] — send this message to sign in to Awale');
  assert.equal(roundTrip(long), long);
});

check('the characters a pre-filled WhatsApp link is made of survive', () => {
  // Percent-encoding, brackets and an em dash: the message phone-verif writes
  // is not plain ASCII, and a mode chosen wrongly would mangle it silently.
  const link = 'https://wa.me/33612345678?text='
    + encodeURIComponent('Jeton : [i2vzxv] — ne pas modifier');
  assert.equal(roundTrip(link), link);
});

check('the quiet zone is really there, and is really white', () => {
  const { size, path } = encodeQr('https://wa.me/1234567890');
  const dark = new Set<string>();
  for (const [, x, y] of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) dark.add(`${x},${y}`);

  // Nothing may be drawn in the border, on any edge.
  for (let i = 0; i < size; i++) {
    for (let q = 0; q < QUIET_ZONE; q++) {
      assert.equal(dark.has(`${i},${q}`), false, `top row ${q}`);
      assert.equal(dark.has(`${i},${size - 1 - q}`), false, `bottom row ${q}`);
      assert.equal(dark.has(`${q},${i}`), false, `left column ${q}`);
      assert.equal(dark.has(`${size - 1 - q},${i}`), false, `right column ${q}`);
    }
  }
});

console.log('');
if (failures.length > 0) {
  console.log(`${passed} passed, ${failures.length} failed`);
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
