// A QR code, drawn by us.
//
// The sign-in link has to cross from a screen to a phone, and the shortest
// route is a camera. Phone-verif will generate a QR for a session, but that is
// a network round trip, a credit, and a dependency on their service being up at
// the moment somebody is trying to sign in — for a picture we can draw from a
// string we already hold. So we draw it.
//
// The encoding itself is `qrcode-generator`, which is the reference JS
// implementation of the spec and has no dependencies of its own. What is here
// is the part that is ours: choosing the correction level, and turning the
// module grid into a single SVG path.
import qrcode from 'qrcode-generator';

/**
 * Error correction level.
 *
 * M recovers about 15% of the code and is the usual choice. A sign-in QR is
 * read once, straight off a clean screen, held still — the damage a higher
 * level protects against is damage this code will never meet, and buying it
 * would only make the modules smaller and harder to read.
 */
const CORRECTION = 'M';

/**
 * The white border. Four modules is the spec's minimum, and scanners genuinely
 * need it: without a quiet zone a reader cannot find the edge of the code
 * against whatever is behind it.
 */
export const QUIET_ZONE = 4;

export interface QrCode {
  /** Width of the grid in modules, quiet zone included. Use as the SVG viewBox. */
  size: number;
  /** Every dark module as one `d` attribute, so the whole code is a single node. */
  path: string;
}

/**
 * Encodes `text` as a QR code laid out for SVG.
 *
 * Version 0 means "pick the smallest version the text fits in", so a short link
 * gets a coarse, easily-read code and a long one still works.
 */
export function encodeQr(text: string): QrCode {
  const code = qrcode(0, CORRECTION);
  code.addData(text);
  code.make();

  const modules = code.getModuleCount();
  const size = modules + QUIET_ZONE * 2;

  // One path of many subpaths rather than a rect per module: a version-10 code
  // is over 3,000 modules, and that many DOM nodes is felt on a phone.
  let path = '';
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      if (!code.isDark(row, col)) continue;
      path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
    }
  }

  return { size, path };
}
