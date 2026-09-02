// Signing in, from the browser's side.
//
// The browser never sees the phone-verif API key and never decides who anybody
// is. It asks our own Worker to start a sign-in, shows the player the WhatsApp
// step, and then asks the Worker — repeatedly, patiently — whether it worked.
// The answer comes back as a signed token it stores and sends on to a room.
//
// Signed out is a supported, complete state: everything except the account name
// works exactly as it did before there were accounts.
import { getStore } from './storage.ts';
import { onlineBaseUrl } from './onlineConfig.ts';
import { peekClaims } from './authCore.ts';

const KEY = 'awale.auth.v1';

/** The origin the embedded verification frame posts from. Checked on every message. */
export const VERIFY_ORIGIN = 'https://phone-verif.com';

export interface Account {
  id: string;
  name: string;
}

export interface Session {
  token: string;
  user: Account;
}

export interface StartedSignIn {
  sessionId: string;
  token: string;
  embedUrl: string;
  whatsappUrl: string | null;
  qrCodeUrl: string | null;
  expiresAt: number | null;
}

export type SignInStatus = 'pending' | 'verified' | 'expired' | 'failed';

export interface StatusReply {
  status: SignInStatus;
  session?: { token: string; user: { id: string; name: string; isNew: boolean } };
}

function authUrl(path: string): string {
  const base = onlineBaseUrl().replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
  return `${base}${path}`;
}

/** Sign-in needs the match server, so it is off wherever online play is off. */
export function authEnabled(): boolean {
  return onlineBaseUrl().length > 0;
}

// --- the stored session ----------------------------------------------------

/**
 * The session this browser is holding, if it is still worth sending.
 *
 * The expiry is read from the token's own payload, which the browser cannot
 * verify — that is fine here, because the only thing it decides is whether to
 * bother asking. Every token is checked properly by the server.
 */
export function loadSession(): Session | null {
  try {
    const raw = getStore().get(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    const token = typeof o.token === 'string' ? o.token : '';
    const user = o.user as Record<string, unknown> | undefined;
    const id = typeof user?.id === 'string' ? user.id : '';
    if (!token || !id) return null;
    const claims = peekClaims(token);
    if (!claims || claims.exp <= Date.now()) { clearSession(); return null; }
    return { token, user: { id, name: typeof user?.name === 'string' ? user.name : '' } };
  } catch {
    return null;
  }
}

export function saveSession(session: Session): Session {
  getStore().set(KEY, JSON.stringify(session));
  return session;
}

export function clearSession(): void {
  getStore().remove(KEY);
}

/** The header every authenticated call carries; empty when signed out. */
export function authHeaders(session: Session | null): Record<string, string> {
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}

// --- the flow --------------------------------------------------------------

export class SignInError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new SignInError(response.status, body || `HTTP ${response.status}`);
  }
  return await response.json() as T;
}

/** Begins a sign-in and returns what the player needs in order to finish it. */
export async function startSignIn(signal?: AbortSignal): Promise<StartedSignIn> {
  const response = await fetch(authUrl('/auth/start'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal,
  });
  return json<StartedSignIn>(response);
}

export async function checkSignIn(
  sessionId: string, signal?: AbortSignal,
): Promise<StatusReply> {
  const response = await fetch(
    authUrl(`/auth/status?session_id=${encodeURIComponent(sessionId)}`),
    { signal },
  );
  return json<StatusReply>(response);
}

/** Renames the account. Returns a fresh session, because the name is in the token. */
export async function renameAccount(session: Session, name: string): Promise<Session> {
  const response = await fetch(authUrl('/auth/name'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(session) },
    body: JSON.stringify({ name }),
  });
  const body = await json<{ token: string; user: Account }>(response);
  return saveSession({ token: body.token, user: body.user });
}

/**
 * Confirms a stored session against the server, dropping it if it is not real.
 *
 * Runs once at startup. A token that fails here is one whose key has rotated or
 * that somebody pasted in by hand, and either way the honest thing to show is
 * the signed-out screen.
 */
export async function refreshSession(session: Session): Promise<Session | null> {
  try {
    const response = await fetch(authUrl('/auth/me'), { headers: authHeaders(session) });
    if (response.status === 401) { clearSession(); return null; }
    if (!response.ok) return session; // Server trouble: keep what we have.
    const body = await response.json() as { user: Account };
    return saveSession({ token: session.token, user: body.user });
  } catch {
    return session; // Offline. The token is still good; the network is not.
  }
}

/**
 * Polls until the sign-in settles.
 *
 * `nudge` exists because the embedded frame tells the page when it is done.
 * That message is never believed on its own — it only shortens the wait before
 * the next question to our own server, which is the one that decides.
 */
export async function waitForSignIn(opts: {
  sessionId: string;
  signal: AbortSignal;
  intervalMs?: number;
  onStatus?: (status: SignInStatus) => void;
  /** Handed a function that cuts the current wait short. See `nudge` above. */
  onReady?: (nudge: () => void) => void;
}): Promise<StatusReply> {
  const interval = opts.intervalMs ?? 2500;
  let wake: (() => void) | null = null;
  opts.onReady?.(() => wake?.());

  for (;;) {
    if (opts.signal.aborted) throw new DOMException('aborted', 'AbortError');
    const reply = await checkSignIn(opts.sessionId, opts.signal);
    opts.onStatus?.(reply.status);
    if (reply.status !== 'pending') return reply;
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        opts.signal.removeEventListener('abort', onAbort);
        wake = null;
        resolve();
      };
      const timer = setTimeout(done, interval);
      const onAbort = () => {
        clearTimeout(timer);
        wake = null;
        reject(new DOMException('aborted', 'AbortError'));
      };
      opts.signal.addEventListener('abort', onAbort, { once: true });
      wake = done;
    });
  }
}
