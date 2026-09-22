// Leaderboard Durable Object for tracking ELO ratings globally.
//
// Maintains a sorted list of players by their ELO rating.
// Uses a single DO for the entire leaderboard to ensure consistency.
import { sortByRating, type PlayerRating } from '../../src/lib/elo.ts';

interface LeaderboardEntry {
  userId: string;
  name: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  lastSeenAt: number;
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
          return await this.getLeaderboard();
        }
        return new Response('Method not allowed', { status: 405 });
      }

      case '/leaderboard/player': {
        if (request.method === 'GET') {
          const userId = url.searchParams.get('userId');
          if (!userId) {
            return new Response('Missing userId', { status: 400 });
          }
          return await this.getPlayerRank(userId);
        }
        return new Response('Method not allowed', { status: 405 });
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

  private async getLeaderboard(): Promise<Response> {
    const data = await this.loadData();
    const entries = Array.from(data.entries.values());
    const sorted = sortByRating(
      entries.map(e => ({
        userId: e.userId,
        name: e.name,
        rating: e.rating,
        gamesPlayed: e.gamesPlayed,
      })),
      false,
    );

    const players: LeaderboardPlayer[] = sorted.map((e, index) => ({
      userId: e.userId,
      name: e.name,
      rating: e.rating,
      gamesPlayed: e.gamesPlayed,
      wins: entries.find(x => x.userId === e.userId)?.wins ?? 0,
      losses: entries.find(x => x.userId === e.userId)?.losses ?? 0,
      draws: entries.find(x => x.userId === e.userId)?.draws ?? 0,
      position: index + 1,
    }));

    const response: LeaderboardResponse = {
      players,
      total: players.length,
      updatedAt: data.updatedAt,
    };

    return Response.json(response);
  }

  private async getPlayerRank(userId: string): Promise<Response> {
    const data = await this.loadData();
    const entry = data.entries.get(userId);

    if (!entry) {
      return new Response('Player not found', { status: 404 });
    }

    const entries = Array.from(data.entries.values());
    const sorted = sortByRating(
      entries.map(e => ({
        userId: e.userId,
        name: e.name,
        rating: e.rating,
        gamesPlayed: e.gamesPlayed,
      })),
      false,
    );

    const position = sorted.findIndex(e => e.userId === userId) + 1;

    const player: LeaderboardPlayer = {
      userId: entry.userId,
      name: entry.name,
      rating: entry.rating,
      gamesPlayed: entry.gamesPlayed,
      wins: entry.wins,
      losses: entry.losses,
      draws: entry.draws,
      position: position > 0 ? position : entries.length + 1,
    };

    return Response.json(player);
  }

  private async updatePlayer(request: Request, now: number): Promise<Response> {
    interface UpdateRequest {
      userId: string;
      name: string;
      rating: PlayerRating;
    }

    const body = await request.json() as UpdateRequest;

    if (!body.userId || !body.name) {
      return new Response('Missing required fields', { status: 400 });
    }

    const data = await this.loadData();

    const entry: LeaderboardEntry = {
      userId: body.userId,
      name: body.name,
      rating: body.rating.rating,
      gamesPlayed: body.rating.gamesPlayed,
      wins: body.rating.wins,
      losses: body.rating.losses,
      draws: body.rating.draws,
      lastSeenAt: now,
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
