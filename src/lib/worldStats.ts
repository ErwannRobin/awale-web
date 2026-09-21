// The browser's side of the country stats: where am I, count this game, and
// what is everybody else playing.
//
// Three small requests to our own Worker, all of them optional. With no server
// configured (`VITE_ONLINE_URL` empty) every function here answers "nothing"
// and the game is exactly what it was: a local record, no network.
//
// What leaves the device when a game is counted is one line — the AI level and
// a two-letter country code. No name, no token, no board, nothing that ties two
// games to the same player. The Worker keeps counters, not rows.
import { onlineBaseUrl } from './onlineConfig.ts';
import { getSettings } from './settings.ts';
import { normaliseCountry } from './country.ts';
import { coerceTable, rankCountries, sanitiseLevel, type CountryTable } from './countryStats.ts';

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
  { level, country }: { level: number; country: string },
): Promise<void> {
  if (!getSettings().shareStats) return;
  await ask('/stats/game', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level: sanitiseLevel(level), country: normaliseCountry(country) }),
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
    return { total, updatedAt, countries };
  } catch {
    return null;
  }
}

/** Whether the world table is worth asking for at all. */
export const worldStatsEnabled = (): boolean => onlineBaseUrl().length > 0;
