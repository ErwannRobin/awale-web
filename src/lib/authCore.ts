// Signed sessions, and the arithmetic that decides whether one is real.
//
// Phone-verif.com proves that a person holds a phone number. It does not, on
// its own, prove anything to *this* game: the browser could claim any user id
// it liked. So the Worker confirms the verification with phone-verif directly
// and then mints its own token, signed with a key the browser never sees. This
// file is that token — minting, reading, and the webhook signature check — and
// nothing else.
//
// It is pure and platform-free, like `roomCore.ts`: the Worker imports it, the
// browser imports the reader half, and `test/auth.test.ts` runs it under Node.
// WebCrypto is the one dependency, and all three have it.

/** Bumped when the token payload changes shape; older tokens stop verifying. */
export const TOKEN_VERSION = 'v1';

/** How long a session lasts before the player signs in again. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** A verification session is only worth polling for so long. */
export const VERIFICATION_TTL_MS = 15 * 60 * 1000;

/**
 * The shortest gap between two questions to phone-verif about the same session.
 *
 * The browser polls on its own schedule and there may be more than one tab, but
 * the number of times we ask *them* has to stay small: the guide's own advice is
 * webhooks in production and polling "on user actions", and a rate-limited 429
 * looks exactly like a sign-in that never finishes. So the upstream call is
 * throttled here, per session, and every poll in between is answered from the
 * record we already hold.
 */
export const UPSTREAM_MIN_GAP_MS = 3000;

export interface SessionClaims {
  /** phone-verif's stable `user_id`. The only identity this game has. */
  sub: string;
  /** Display name when the token was minted; the account is the source. */
  name: string;
  /** Issued at, epoch ms. */
  iat: number;
  /** Expires at, epoch ms. */
  exp: number;
}

export type TokenFailure = 'malformed' | 'bad-signature' | 'expired';

export type TokenResult =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: TokenFailure };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// --- base64url -------------------------------------------------------------
//
// Tokens travel in an Authorization header and a query string, so the padding
// and the `+/` of standard base64 are more trouble than the few lines it takes
// to avoid them.

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(text: string): Uint8Array | null {
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/')
      + '='.repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// --- signing ---------------------------------------------------------------

/**
 * The session signing key.
 *
 * Derived rather than configured, so there is one secret to deploy instead of
 * two. HKDF with a fixed info string means the API key cannot be recovered from
 * a token, and rotating the API key invalidates every session — which is what
 * a rotation is for.
 *
 * Pass a dedicated `AUTH_SESSION_SECRET` instead when sessions should outlive
 * an API key rotation; the derivation is the same, only the input changes.
 */
export async function signingKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('awale.auth.salt.v1'),
      info: encoder.encode('awale.session.token.v1'),
    },
    material,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** `v1.<payload>.<signature>`, both halves base64url. */
export async function mintToken(claims: SessionClaims, key: CryptoKey): Promise<string> {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const body = `${TOKEN_VERSION}.${payload}`;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Read a token back, or say why it cannot be trusted.
 *
 * `crypto.subtle.verify` compares in constant time, so a forged signature
 * leaks nothing about the real one — which is why the comparison is not done
 * by hand.
 */
export async function readToken(
  token: string, key: CryptoKey, now = Date.now(),
): Promise<TokenResult> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    return { ok: false, reason: 'malformed' };
  }
  const signature = base64UrlDecode(parts[2]);
  const payload = base64UrlDecode(parts[1]);
  if (!signature || !payload) return { ok: false, reason: 'malformed' };

  const body = encoder.encode(`${parts[0]}.${parts[1]}`);
  if (!(await crypto.subtle.verify('HMAC', key, bufferOf(signature), body))) {
    return { ok: false, reason: 'bad-signature' };
  }

  let claims: SessionClaims;
  try {
    const parsed: unknown = JSON.parse(decoder.decode(payload));
    if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'malformed' };
    const o = parsed as Record<string, unknown>;
    if (typeof o.sub !== 'string' || !o.sub) return { ok: false, reason: 'malformed' };
    if (typeof o.exp !== 'number' || typeof o.iat !== 'number') {
      return { ok: false, reason: 'malformed' };
    }
    claims = { sub: o.sub, name: typeof o.name === 'string' ? o.name : '', iat: o.iat, exp: o.exp };
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (claims.exp <= now) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}

/** A view's buffer is not always its own; WebCrypto wants the bytes exactly. */
function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

export function claimsFor(userId: string, name: string, now = Date.now()): SessionClaims {
  return { sub: userId, name, iat: now, exp: now + SESSION_TTL_MS };
}

/**
 * Read a token's claims without checking the signature.
 *
 * For the browser only, and only to draw a name and decide when to refresh.
 * Nothing may be authorised on the strength of it: the browser holds no key, so
 * it cannot tell a real token from one someone typed into localStorage. The
 * server checks every token it is shown.
 */
export function peekClaims(token: string): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const payload = base64UrlDecode(parts[1]);
  if (!payload) return null;
  try {
    const o = JSON.parse(decoder.decode(payload)) as Record<string, unknown>;
    if (typeof o.sub !== 'string' || typeof o.exp !== 'number') return null;
    return {
      sub: o.sub,
      name: typeof o.name === 'string' ? o.name : '',
      iat: typeof o.iat === 'number' ? o.iat : 0,
      exp: o.exp,
    };
  } catch {
    return null;
  }
}

// --- webhook signatures ----------------------------------------------------

/**
 * Is this webhook really from phone-verif?
 *
 * The header is `sha256=<hex>` over the *raw* body — re-serialising the JSON
 * first would change the bytes and fail every time. Verified with WebCrypto so
 * the comparison stays constant-time.
 */
export async function verifyWebhook(
  rawBody: string, header: string | null, secret: string,
): Promise<boolean> {
  if (!header || !secret) return false;
  const hex = header.startsWith('sha256=') ? header.slice(7) : header;
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return false;
  const signature = new Uint8Array(hex.length / 2);
  for (let i = 0; i < signature.length; i++) {
    signature[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, bufferOf(signature), encoder.encode(rawBody));
}

// --- verification sessions -------------------------------------------------

export type VerificationStatus = 'pending' | 'verified' | 'expired' | 'failed';

/** What the Worker remembers about a sign-in that is still in flight. */
export interface VerificationRecord {
  sessionId: string;
  status: VerificationStatus;
  userId: string | null;
  isNewUser: boolean;
  createdAt: number;
  /** Set when phone-verif answers; used only for the expiry sweep. */
  settledAt: number | null;
  /** When we last asked phone-verif about this session. See UPSTREAM_MIN_GAP_MS. */
  polledAt: number;
}

export function newVerification(sessionId: string, now = Date.now()): VerificationRecord {
  return {
    sessionId,
    status: 'pending',
    userId: null,
    isNewUser: false,
    createdAt: now,
    settledAt: null,
    polledAt: 0,
  };
}

/** Is it our turn to ask phone-verif, or should this poll be answered from store? */
export function shouldPollUpstream(record: VerificationRecord, now = Date.now()): boolean {
  if (record.status !== 'pending') return false;
  if (isStale(record, now)) return false;
  // Never asked is its own case, not "asked at the epoch": the gap is a
  // duration, and comparing it against a timestamp that was never set only
  // happens to work because real clocks are large numbers.
  if (record.polledAt === 0) return true;
  return now - record.polledAt >= UPSTREAM_MIN_GAP_MS;
}

export function markPolled(record: VerificationRecord, now = Date.now()): VerificationRecord {
  return { ...record, polledAt: now };
}

/** A pending sign-in nobody finished stops being worth polling. */
export function isStale(record: VerificationRecord, now = Date.now()): boolean {
  return record.status === 'pending' && now - record.createdAt > VERIFICATION_TTL_MS;
}

/**
 * Fold a confirmation into a record.
 *
 * Deliberately one-way: once a session is verified it stays verified, so a
 * webhook and a poll arriving in either order reach the same answer, and a
 * later failure cannot un-verify somebody who is already playing.
 */
export function settle(
  record: VerificationRecord,
  next: { status: VerificationStatus; userId?: string | null; isNewUser?: boolean },
  now = Date.now(),
): VerificationRecord {
  if (record.status === 'verified') return record;
  // "Verified, but we were not told who" is not a verification.
  if (next.status === 'verified' && !next.userId) return record;
  return {
    ...record,
    status: next.status,
    userId: next.userId ?? record.userId,
    isNewUser: next.isNewUser ?? record.isNewUser,
    settledAt: next.status === 'pending' ? null : now,
  };
}

/** Names are shown to strangers in a room, so they get the same cap as a seat. */
export function cleanDisplayName(raw: unknown, fallback = ''): string {
  if (typeof raw !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[\u0000-\u001F\u007F]/g, '');
  return stripped.replace(/\s+/g, ' ').trim().slice(0, 20) || fallback;
}
