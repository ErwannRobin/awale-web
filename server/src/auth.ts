// Signing in, from the Worker's side.
//
// The shape of this is decided by one rule: **the API key never leaves the
// Worker**, and neither does the decision about who somebody is. The browser
// starts a sign-in, is handed a WhatsApp link, and then asks *us* whether it
// worked; we ask phone-verif. The page also receives a `postMessage` from the
// embedded phone-verif frame saying "done" — that is a hint to poll sooner and
// nothing more, because anything the page can send, an attacker can send too.
//
// Flow is `login`: phone-verif returns a stable `user_id` for a number and
// registers one the first time it sees it, which is exactly an account.
// See https://phone-verif.com/integration-guide.
import {
  claimsFor, cleanDisplayName, mintToken, readToken, signingKey, verifyWebhook,
  type SessionClaims,
} from '../../src/lib/authCore.ts';
import type { UserRecord, VerificationView } from './identity.ts';

const API_BASE = 'https://api.phone-verif.com';

/** Where the phone-verif frame is embedded from; also the postMessage origin. */
export const VERIFY_ORIGIN = 'https://phone-verif.com';

export interface AuthEnv {
  IDENTITY: DurableObjectNamespace;
  PHONE_VERIF_API_KEY?: string;
  /** Optional: sign sessions with this instead of deriving from the API key. */
  AUTH_SESSION_SECRET?: string;
  /** Where a player lands after WhatsApp. Defaults to the requesting origin. */
  PUBLIC_APP_URL?: string;
}

/** The browser's half of a started sign-in. No API key, no webhook secret. */
interface StartReply {
  sessionId: string;
  /** phone-verif's `validation_token`, which the embed URL needs. */
  token: string;
  embedUrl: string;
  whatsappUrl: string | null;
  qrCodeUrl: string | null;
  expiresAt: number | null;
}

interface StatusReply {
  status: VerificationView['status'];
  /** Present only once verified. */
  session?: { token: string; user: { id: string; name: string; isNew: boolean } };
}

// --- talking to phone-verif ------------------------------------------------

async function callApi(
  env: AuthEnv, path: string, init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const key = env.PHONE_VERIF_API_KEY;
  if (!key) throw new AuthError(503, 'sign-in is not configured');
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'X-API-Key': key, ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    // 402 means the account is out of credits and 429 means too fast; both are
    // worth distinguishing from "that session does not exist", because only one
    // of them is the player's problem.
    throw new AuthError(
      response.status === 402 || response.status === 429 ? 503 : 502,
      `phone-verif answered ${response.status}`,
    );
  }
  return await response.json() as Record<string, unknown>;
}

class AuthError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Reads whatever shape the upstream sent us, without trusting any of it. */
function str(source: unknown, key: string): string | null {
  if (!source || typeof source !== 'object') return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' && value ? value : null;
}

// --- session keys ----------------------------------------------------------

/**
 * One key per Worker instance.
 *
 * Deriving it costs an HKDF each time otherwise, on a path that runs for every
 * authenticated WebSocket. The cache is keyed by the secret so a rotation
 * cannot be served a stale key.
 */
const keyCache = new Map<string, Promise<CryptoKey>>();

export function sessionKey(env: AuthEnv): Promise<CryptoKey> {
  const secret = env.AUTH_SESSION_SECRET || env.PHONE_VERIF_API_KEY;
  if (!secret) return Promise.reject(new AuthError(503, 'sign-in is not configured'));
  const cached = keyCache.get(secret);
  if (cached) return cached;
  const fresh = signingKey(secret);
  keyCache.set(secret, fresh);
  return fresh;
}

/**
 * The claims behind an `Authorization: Bearer` header, or null.
 *
 * Exported because the room uses it too: a seat proved by a signed token cannot
 * be taken by someone who guessed the anonymous one.
 */
export async function claimsFromBearer(
  env: AuthEnv, header: string | null,
): Promise<SessionClaims | null> {
  if (!header?.startsWith('Bearer ')) return null;
  return claimsFromToken(env, header.slice(7).trim());
}

export async function claimsFromToken(
  env: AuthEnv, token: string,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const result = await readToken(token, await sessionKey(env));
    return result.ok ? result.claims : null;
  } catch {
    // No key configured. Unsigned-in is the honest answer, not a 500.
    return null;
  }
}

// --- the identity store ----------------------------------------------------

const stub = (env: AuthEnv, name: string) => env.IDENTITY.get(env.IDENTITY.idFromName(name));

const post = async <T>(
  target: DurableObjectStub, path: string, body?: unknown,
): Promise<T> => {
  const response = await target.fetch(`https://identity${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return await response.json() as T;
};

// --- the webhook secret ----------------------------------------------------

let webhookSecret: { value: string; fetchedAt: number } | null = null;
const SECRET_TTL_MS = 10 * 60 * 1000;

async function fetchWebhookSecret(env: AuthEnv): Promise<string | null> {
  if (webhookSecret && Date.now() - webhookSecret.fetchedAt < SECRET_TTL_MS) {
    return webhookSecret.value;
  }
  try {
    const body = await callApi(env, '/webhook-secret', { method: 'GET' });
    const value = str(body, 'webhook_secret') ?? str(body, 'secret');
    if (!value) return null;
    webhookSecret = { value, fetchedAt: Date.now() };
    return value;
  } catch {
    return null;
  }
}

// --- routes ----------------------------------------------------------------

/**
 * Handles `/auth/*`. Returns null when the path is not ours, so the router can
 * carry on to the rooms and the site.
 */
export async function handleAuth(
  request: Request, env: AuthEnv, cors: Record<string, string>,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/auth/')) return null;

  try {
    switch (url.pathname) {
      case '/auth/start':
        return await start(request, env, cors);
      case '/auth/status':
        return await status(url, env, cors);
      case '/auth/webhook':
        return await webhook(request, env);
      case '/auth/me':
        return await me(request, env, cors);
      case '/auth/name':
        return await rename(request, env, cors);
      default:
        return new Response('not found', { status: 404, headers: cors });
    }
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'sign-in failed';
    return Response.json({ error: message }, { status, headers: cors });
  }
}

async function start(
  request: Request, env: AuthEnv, cors: Record<string, string>,
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('use POST', { status: 405, headers: cors });
  }

  const sessionId = crypto.randomUUID();
  // Where WhatsApp sends the player back to. The app is served both from this
  // Worker and from a separate host, so the requesting origin is the best
  // default and `PUBLIC_APP_URL` is the override.
  const origin = env.PUBLIC_APP_URL || request.headers.get('Origin') || new URL(request.url).origin;

  const body = await callApi(env, '/start-verification?flow=login', {
    method: 'POST',
    body: JSON.stringify({
      session_id: sessionId,
      callback_url: `${origin.replace(/\/+$/, '')}/?signed-in=1`,
      is_public: false,
    }),
  });

  const session = body.session as Record<string, unknown> | undefined;
  const token = str(session, 'validation_token');
  if (!token) throw new AuthError(502, 'phone-verif did not return a token');

  await post(stub(env, `sess:${sessionId}`), `/session/open?id=${encodeURIComponent(sessionId)}`);

  const whatsapp = body.whatsapp as Record<string, unknown> | undefined;
  const validity = session?.validity_timestamp;
  const reply: StartReply = {
    sessionId,
    token,
    // The embed hides phone-verif's own header and footer, so the sign-in looks
    // like part of the game rather than a redirect to somebody else's site.
    embedUrl: `${VERIFY_ORIGIN}/verify?session_id=${encodeURIComponent(sessionId)}`
      + `&embedded=true&token=${encodeURIComponent(token)}`,
    // The way out when the frame is blocked, which is every native WebView.
    whatsappUrl: str(whatsapp, 'direct_link') ?? str(whatsapp, 'deeplink'),
    qrCodeUrl: str(whatsapp, 'qr_code_url'),
    expiresAt: typeof validity === 'number' ? validity * 1000 : null,
  };
  return Response.json(reply, { headers: cors });
}

/**
 * "Did it work yet?"
 *
 * The stored record first, because a webhook may already have answered; only
 * then phone-verif itself. That ordering is what lets this work with or without
 * a webhook configured — the poll is the fallback the guide suggests for
 * development, and the correct answer in production either way.
 */
async function status(
  url: URL, env: AuthEnv, cors: Record<string, string>,
): Promise<Response> {
  const sessionId = url.searchParams.get('session_id') ?? '';
  if (!sessionId) return new Response('missing session_id', { status: 400, headers: cors });

  const target = stub(env, `sess:${sessionId}`);
  let view = await post<VerificationView | null>(target, '/session/read');
  if (!view) return Response.json({ status: 'expired' } satisfies StatusReply, { headers: cors });

  if (view.status === 'pending') {
    const upstream = await pollUpstream(env, sessionId);
    if (upstream) {
      view = await post<VerificationView>(
        target, `/session/settle?id=${encodeURIComponent(sessionId)}`, upstream,
      );
    }
  }

  if (view.status !== 'verified' || !view.userId) {
    return Response.json({ status: view.status } satisfies StatusReply, { headers: cors });
  }

  const user = await post<UserRecord>(stub(env, `user:${view.userId}`), '/user/seen', {
    userId: view.userId,
  });
  const token = await mintToken(claimsFor(user.userId, user.name), await sessionKey(env));
  const reply: StatusReply = {
    status: 'verified',
    session: {
      token,
      user: { id: user.userId, name: user.name, isNew: view.isNewUser },
    },
  };
  return Response.json(reply, { headers: cors });
}

async function pollUpstream(
  env: AuthEnv, sessionId: string,
): Promise<{ status: VerificationView['status']; userId?: string | null; isNewUser?: boolean } | null> {
  let body: Record<string, unknown>;
  try {
    body = await callApi(
      env, `/check-verification-status?session_id=${encodeURIComponent(sessionId)}`,
      { method: 'GET' },
    );
  } catch {
    // Upstream trouble is not the player's session going wrong. Stay pending
    // and let the next poll try again.
    return null;
  }
  const session = (body.session ?? body) as Record<string, unknown>;
  const raw = typeof session.status === 'string' ? session.status : 'pending';
  if (raw === 'verified') {
    return {
      status: 'verified',
      userId: str(session, 'user_id'),
      isNewUser: session.is_new_user === true,
    };
  }
  if (raw === 'expired' || raw === 'failed') return { status: raw };
  return null;
}

/**
 * phone-verif telling us a sign-in finished.
 *
 * Verified against the signing secret before a single field is read: an
 * unsigned POST to this path is a stranger claiming to be a user, and the
 * signature is the only thing that says otherwise.
 */
async function webhook(request: Request, env: AuthEnv): Promise<Response> {
  if (request.method !== 'POST') return new Response('use POST', { status: 405 });

  const raw = await request.text();
  const secret = await fetchWebhookSecret(env);
  if (!secret) return new Response('webhook not configured', { status: 503 });
  if (!(await verifyWebhook(raw, request.headers.get('X-Webhook-Signature'), secret))) {
    return new Response('bad signature', { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return new Response('bad body', { status: 400 });
  }

  const sessionId = str(body, 'session_id');
  if (!sessionId) return new Response('no session', { status: 400 });

  const verified = body.event === 'verification_success';
  await post(
    stub(env, `sess:${sessionId}`), `/session/settle?id=${encodeURIComponent(sessionId)}`,
    verified
      ? { status: 'verified', userId: str(body, 'user_id'), isNewUser: body.is_new_user === true }
      : { status: 'failed' },
  );
  return new Response('ok');
}

async function me(
  request: Request, env: AuthEnv, cors: Record<string, string>,
): Promise<Response> {
  const claims = await claimsFromBearer(env, request.headers.get('Authorization'));
  if (!claims) return new Response('unauthorised', { status: 401, headers: cors });
  const user = await post<UserRecord | null>(stub(env, `user:${claims.sub}`), '/user/read');
  return Response.json(
    { user: { id: claims.sub, name: user?.name ?? claims.name }, expiresAt: claims.exp },
    { headers: cors },
  );
}

/** Renaming is the one thing an account can do, and it needs the account. */
async function rename(
  request: Request, env: AuthEnv, cors: Record<string, string>,
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('use POST', { status: 405, headers: cors });
  }
  const claims = await claimsFromBearer(env, request.headers.get('Authorization'));
  if (!claims) return new Response('unauthorised', { status: 401, headers: cors });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const name = cleanDisplayName(body.name, '');
  const user = await post<UserRecord>(stub(env, `user:${claims.sub}`), '/user/seen', {
    userId: claims.sub, name,
  });
  // The name lives in the token, so a rename mints a fresh one rather than
  // leaving the player's own screen a version behind.
  const token = await mintToken(claimsFor(user.userId, user.name), await sessionKey(env));
  return Response.json({ token, user: { id: user.userId, name: user.name } }, { headers: cors });
}
