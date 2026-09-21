// Where the match server is, and who this browser is when it gets there.
//
// The URL is a build-time variable, and an empty one is a supported state: with
// no server configured the online screens never appear and the rest of the game
// is untouched. That is what keeps `npm run build` honest in CI, where there is
// no server to point at.
import { getStore } from './storage.ts';

const TOKEN_KEY = 'awale.online.token.v1';

const RAW_URL: string = (import.meta.env?.VITE_ONLINE_URL as string | undefined)?.trim() ?? '';

/**
 * `VITE_ONLINE_URL=same-origin` — the deployed shape, where one Cloudflare
 * Worker serves both the game and the rooms.
 *
 * Deriving the address from the page removes the last thing a deploy could get
 * wrong: a site cannot end up pointing at the wrong server when it *is* the
 * server. It only works where the page came over http(s), which is true of the
 * web and false inside the native shell (`capacitor:`/`file:`) — that build
 * needs a real URL, and gets no online play without one rather than a broken
 * connection with one.
 */
const SAME_ORIGIN = 'same-origin';

/** Configured base URL, or '' when online play is switched off for this build. */
export function onlineBaseUrl(): string {
  if (RAW_URL !== SAME_ORIGIN) return RAW_URL.replace(/\/+$/, '');
  if (typeof location === 'undefined') return '';
  return location.protocol === 'http:' || location.protocol === 'https:'
    ? location.origin
    : '';
}

export const onlineEnabled = (): boolean => onlineBaseUrl().length > 0;

/**
 * The room's WebSocket address.
 *
 * `VITE_ONLINE_URL` may be given as http(s) or ws(s) — a deploy URL copied out
 * of a dashboard is nearly always the former, and quietly accepting it is
 * cheaper than a support question.
 */
export function roomSocketUrl(code: string): string {
  const base = onlineBaseUrl();
  const ws = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  return `${ws}/room/${encodeURIComponent(code)}`;
}

export function queueUrl(): string {
  const base = onlineBaseUrl();
  return `${base.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')}/queue`;
}

/** The link a player sends to a friend. Points at this build, not the server. */
export function shareLink(code: string): string {
  if (typeof location === 'undefined') return code;
  const url = new URL(location.href);
  url.hash = '';
  url.search = `?join=${encodeURIComponent(code)}`;
  return url.toString();
}

/** A `?join=CODE` on the address bar, if there is one. */
export function readJoinCode(): string | null {
  if (typeof location === 'undefined') return null;
  try {
    return new URL(location.href).searchParams.get('join');
  } catch {
    return null;
  }
}

/** Drops `?join=` once used, so a refresh does not rejoin a finished game. */
export function clearJoinCode(): void {
  if (typeof history === 'undefined' || typeof location === 'undefined') return;
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has('join')) return;
    url.searchParams.delete('join');
    // Keep whatever state the entry holds: this rewrites the address only, and
    // the screen stack (lib/navigation.ts) lives in that state.
    history.replaceState(history.state, '', url.toString());
  } catch { /* older WebView */ }
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * This browser's seat key, stable across reloads.
 *
 * It is what lets a dropped player walk back into their own seat instead of
 * finding the room full. Not an account and not a secret worth stealing — it
 * proves one thing, for as long as one game lasts.
 */
export function playerToken(): string {
  const store = getStore();
  const existing = store.get(TOKEN_KEY);
  if (existing && existing.length >= 8) return existing;
  const fresh = randomToken();
  store.set(TOKEN_KEY, fresh);
  return fresh;
}
