// The browser's side of the country stats: where am I, count this game, what is
// everybody else playing, how do the nations stand, and who is this player.
//
// Small requests to our own Worker, all of them optional. With no server
// configured (`VITE_ONLINE_URL` empty) every function here answers "nothing"
// and the game is exactly what it was: a local record, no network.
//
// What leaves the device when a game is counted anonymously is one line — the
// AI level, the outcome and a two-letter country code. No name, no token, no
// board, nothing that ties two games to the same player. The Worker keeps
// counters, not rows. A signed-in player's game also carries their session, so
// it can land on their public profile; that part is the account's, not the
// world table's.
import { onlineBaseUrl } from './onlineConfig.ts';
import { getSettings } from './settings.ts';
import { normaliseCountry, type CountryKey } from './country.ts';
import {
  coerceHeadToHead, coerceTable, rankCountries, sanitiseLevel,
  type CountryTable, type HeadToHead, type NationRow,
} from './countryStats.ts';
import { loadSession, authHeaders } from './auth.ts';
import type { PlayerRating } from './elo.ts';
import type { PublicStats } from './stats.ts';
import type { AvatarKey } from './profile.ts';

const TIMEOUT_MS = 6_000;

function apiUrl(path: string): string {
  const base = onlineBaseUrl().replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
  return base ? `${base}${path}` : '';
}

/** Every call here is best-effort: a failure must never interrupt a game. */
async function ask(path: string, init?: RequestInit): Promise<Response | null> {
  const url = apiUrl(path);
  if (!url) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: abort.signal });
    return response.ok ? response : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The country the edge thinks this request came from, or null.
 *
 * The IP never leaves the edge and is never stored: Cloudflare resolves it
 * while handling the request, and the answer is two letters.
 */
export async function detectCountry(): Promise<string | null> {
  const response = await ask('/geo');
  if (!response) return null;
  try {
    const body = await response.json() as { country?: unknown };
    const code = normaliseCountry(body.country);
    return code === 'ZZ' ? null : code;
  } catch {
    return null;
  }
}

/**
 * Count one finished game towards the world table.
 *
 * The country travels with the game rather than being re-derived later, so a
 * player who moves country tomorrow leaves today's games where they were
 * played. The Worker falls back to the request's own country only when the
 * body has none to offer.
 */
export async function reportGame(
  { level, country, outcome, you, them }:
  { level: number; country: string; outcome: 'win' | 'loss' | 'draw'; you: number; them: number },
): Promise<void> {
  const world = getSettings().shareStats;
  const session = loadSession();
  // Nothing to say to anybody: not shared, and no profile to keep up to date.
  if (!world && !session) return;
  await ask('/stats/game', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(session) },
    body: JSON.stringify({
      level: sanitiseLevel(level),
      country: normaliseCountry(country),
      outcome,
      you,
      them,
      world,
    }),
  });
}

/** The world table, or null when there is no server or it did not answer. */
export async function fetchCountryTable(): Promise<CountryTable | null> {
  const response = await ask('/stats/countries');
  if (!response) return null;
  try {
    const body = await response.json() as Record<string, unknown>;
    const countries = rankCountries(coerceTable(
      // Accept the wire shape (a list of rows) and a bare map alike.
      Array.isArray(body.countries)
        ? Object.fromEntries(body.countries.map(row => {
            const r = row as Record<string, unknown>;
            return [String(r.code ?? ''), r];
          }))
        : body.countries,
    ));
    const total = typeof body.total === 'number' && Number.isFinite(body.total)
      ? body.total
      : countries.reduce((n, row) => n + row.games, 0);
    const updatedAt = typeof body.updatedAt === 'number' ? body.updatedAt : 0;
    const pvpTotal = typeof body.pvpTotal === 'number' ? body.pvpTotal : 0;
    return { total, pvpTotal, updatedAt, countries, rivalries: headToHeads(body.rivalries) };
  } catch {
    return null;
  }
}

const headToHeads = (raw: unknown): HeadToHead[] =>
  (Array.isArray(raw) ? raw.map(coerceHeadToHead).filter((r): r is HeadToHead => r !== null) : []);

export interface NationsTable {
  nations: NationRow[];
  rivalries: HeadToHead[];
  pvpTotal: number;
  updatedAt: number;
}

/** Countries ranked by nation points, with every rivalry between them. */
export async function fetchNations(): Promise<NationsTable | null> {
  const response = await ask('/stats/nations');
  if (!response) return null;
  try {
    const body = await response.json() as Record<string, unknown>;
    // The rows are built by the same pure function on the server; they are
    // only checked for shape here, not recomputed.
    const nations = Array.isArray(body.nations)
      ? (body.nations as NationRow[]).filter(n => n && typeof n.code === 'string')
      : [];
    return {
      nations,
      rivalries: headToHeads(body.rivalries),
      pvpTotal: typeof body.pvpTotal === 'number' ? body.pvpTotal : 0,
      updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

/** Two countries' record against each other, or null when there is none yet. */
export async function fetchRivalry(a: string, b: string): Promise<HeadToHead | null> {
  const q = new URLSearchParams({ a, b });
  const response = await ask(`/stats/rivalry?${q}`);
  if (!response) return null;
  try {
    return coerceHeadToHead(await response.json());
  } catch {
    return null;
  }
}

/** One row of the online leaderboard. */
export interface LeaderboardPlayer {
  userId: string;
  name: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  position: number;
  country: CountryKey;
  avatar: AvatarKey;
}

export interface LeaderboardTable {
  players: LeaderboardPlayer[];
  total: number;
  updatedAt: number;
}

export async function fetchLeaderboard(): Promise<LeaderboardTable | null> {
  const response = await ask('/leaderboard');
  if (!response) return null;
  try {
    const body = await response.json() as LeaderboardTable;
    const players = Array.isArray(body.players) ? body.players : [];
    return {
      // An entry from before countries existed reads as unknown.
      players: players.map(p => ({ ...p, country: normaliseCountry(p.country), avatar: p.avatar ?? 'clay' })),
      total: typeof body.total === 'number' ? body.total : players.length,
      updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

/** Another player, as the server lets anybody see them. */
export interface PublicPlayer {
  userId: string;
  name: string;
  country: CountryKey;
  avatar: AvatarKey;
  createdAt: number;
  lastSeenAt: number;
  /** Online, player-versus-player. */
  rating: PlayerRating;
  /** Against the AI. */
  ai: PublicStats;
  position: number | null;
}

export async function fetchPlayer(userId: string): Promise<PublicPlayer | null> {
  const response = await ask(`/players/${encodeURIComponent(userId)}`);
  if (!response) return null;
  try {
    const body = await response.json() as PublicPlayer;
    return body && typeof body.userId === 'string'
      ? { ...body, country: normaliseCountry(body.country) }
      : null;
  } catch {
    return null;
  }
}

/** Whether the world table is worth asking for at all. */
export const worldStatsEnabled = (): boolean => onlineBaseUrl().length > 0;
