// Leaderboard Durable Object for tracking ELO ratings globally.
//
// Maintains a sorted list of players by their ELO rating.
// Uses a single DO for the entire leaderboard to ensure consistency.
//
// Each entry also carries the player's country, so the same object can answer
// "who plays for France, and how strong are they" — the people half of the
// nations ranking. The results half lives in the Stats object.
import { sortByRating, type PlayerRating } from '../../src/lib/elo.ts';
import { normaliseCountry, UNKNOWN_COUNTRY, type CountryKey } from '../../src/lib/country.ts';
import type { CountryPeople } from '../../src/lib/countryStats.ts';
import { AVATARS, type AvatarKey } from '../../src/lib/profile.ts';

interface LeaderboardEntry {
  userId: string;
  name: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  lastSeenAt: number;
  /** Absent on an entry written before countries existed. */
  country?: CountryKey;
  avatar?: AvatarKey;
}

interface LeaderboardData {
  entries: Map<string, LeaderboardEntry>;
  updatedAt: number;
}

const DATA_KEY = 'leaderboard';

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

export interface LeaderboardResponse {
  players: LeaderboardPlayer[];
  total: number;
  updatedAt: number;
}

export class Leaderboard implements DurableObject {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();

    switch (url.pathname) {
      case '/leaderboard': {
        if (request.method === 'GET') {
          return Response.json(await this.getLeaderboard());
        }
        return new Response('Method not allowed', { status: 405 });
      }

      case '/leaderboard/player': {
        if (request.method === 'GET') {
          const userId = url.searchParams.get('userId');
          if (!userId) {
            return new Response('Missing userId', { status: 400 });
          }
          const board = await this.getLeaderboard();
          const player = board.players.find(p => p.userId === userId);
          return player
            ? Response.json(player)
            : new Response('Player not found', { status: 404 });
        }
        return new Response('Method not allowed', { status: 405 });
      }

      case '/leaderboard/countries': {
        return Response.json(await this.countries());
      }

      case '/leaderboard/update': {
        if (request.method === 'POST') {
          return await this.updatePlayer(request, now);
        }
        return new Response('Method not allowed', { status: 405 });
      }

      default:
        return new Response('Not found', { status: 404 });
    }
  }

  private async getLeaderboard(): Promise<LeaderboardResponse> {
    const data = await this.loadData();
    const sorted = sortByRating(
      Array.from(data.entries.values(), e => ({
        userId: e.userId,
        name: e.name,
        rating: e.rating,
        gamesPlayed: e.gamesPlayed,
      })),
      false,
    );

    const players: LeaderboardPlayer[] = sorted.map((e, index) => {
      // A map lookup rather than a scan per row: the board is read far more
      // often than it is written, and it grows with every sign-in.
      const entry = data.entries.get(e.userId)!;
      return {
        userId: e.userId,
        name: e.name,
        rating: e.rating,
        gamesPlayed: e.gamesPlayed,
        wins: entry.wins,
        losses: entry.losses,
        draws: entry.draws,
        position: index + 1,
        country: entry.country ?? UNKNOWN_COUNTRY,
        avatar: entry.avatar ?? 'clay',
      };
    });

    return { players, total: players.length, updatedAt: data.updatedAt };
  }

  /** Signed-in players per country, and how strong they are. */
  private async countries(): Promise<CountryPeople[]> {
    const data = await this.loadData();
    const by = new Map<CountryKey, { sum: number; people: LeaderboardEntry[] }>();
    for (const e of data.entries.values()) {
      const code = e.country ?? UNKNOWN_COUNTRY;
      if (code === UNKNOWN_COUNTRY) continue;
      const seen = by.get(code) ?? { sum: 0, people: [] };
      seen.sum += e.rating;
      seen.people.push(e);
      by.set(code, seen);
    }
    return [...by.entries()].map(([code, { sum, people }]) => {
      const top = people.reduce((best, p) => (p.rating > best.rating ? p : best));
      return {
        code,
        players: people.length,
        avgRating: Math.round(sum / people.length),
        topRating: top.rating,
        topPlayer: { userId: top.userId, name: top.name },
      };
    });
  }

  private async updatePlayer(request: Request, now: number): Promise<Response> {
    interface UpdateRequest {
      userId: string;
      name: string;
      rating: PlayerRating;
      country?: unknown;
      avatar?: unknown;
    }

    const body = await request.json() as UpdateRequest;

    if (!body.userId) {
      return new Response('Missing required fields', { status: 400 });
    }

    const data = await this.loadData();
    const previous = data.entries.get(body.userId);

    // A freshly signed-in player has no display name yet — that is chosen
    // later, on the profile screen — so this cannot require one without
    // silently dropping every brand-new account from the board.
    const entry: LeaderboardEntry = {
      userId: body.userId,
      name: body.name || 'Player',
      rating: body.rating.rating,
      gamesPlayed: body.rating.gamesPlayed,
      wins: body.rating.wins,
      losses: body.rating.losses,
      draws: body.rating.draws,
      lastSeenAt: now,
      // Absent from the update means "unchanged", not "unknown": a rating
      // update from a room knows nothing about countries.
      country: body.country === undefined ? previous?.country : normaliseCountry(body.country),
      avatar: AVATARS.includes(body.avatar as AvatarKey) ? body.avatar as AvatarKey : previous?.avatar,
    };

    data.entries.set(body.userId, entry);
    data.updatedAt = now;

    await this.saveData(data);

    return Response.json({ success: true, entry });
  }

  private async loadData(): Promise<LeaderboardData> {
    const stored = await this.state.storage.get<{
      entries: [string, LeaderboardEntry][];
      updatedAt: number;
    }>(DATA_KEY);
    if (stored) {
      return { entries: new Map(stored.entries), updatedAt: stored.updatedAt };
    }
    return { entries: new Map(), updatedAt: Date.now() };
  }

  private async saveData(data: LeaderboardData): Promise<void> {
    const serializable = {
      entries: Array.from(data.entries.entries()),
      updatedAt: data.updatedAt,
    };
    await this.state.storage.put(DATA_KEY, serializable);
  }
}
