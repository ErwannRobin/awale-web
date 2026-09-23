// The only thing this game stores about a person.
//
// One Durable Object class, two key spaces, because they want the same
// guarantee and neither is big enough to deserve its own class:
//
//   sess:<session_id>  a sign-in still in flight
//   user:<user_id>     an account: a display name, a country, an avatar, the
//                      online rating, and the record against the AI that the
//                      public profile shows
//
// `idFromName` gives exactly one instance per key worldwide, which is what
// makes a webhook and a poll about the same sign-in agree without a lock.
import {
  cleanDisplayName, isStale, markPolled, newVerification, settle, shouldPollUpstream,
  type VerificationRecord, type VerificationStatus,
} from '../../src/lib/authCore.ts';
import { initialRating, updatePlayerRating, type PlayerRating } from '../../src/lib/elo.ts';
import { normaliseCountry, UNKNOWN_COUNTRY, type CountryKey } from '../../src/lib/country.ts';
import {
  applyResult, coerceStats, emptyStats, publicStats, type PublicStats, type Stats,
} from '../../src/lib/stats.ts';
import { sanitiseLevel, sanitiseOutcome } from '../../src/lib/countryStats.ts';
import { AVATARS, type AvatarKey } from '../../src/lib/profile.ts';

const RECORD_KEY = 'record';
const USER_KEY = 'user';

export interface UserRecord {
  userId: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  rating: PlayerRating;
  /** Where the player says they play from. Absent on an account made before. */
  country?: CountryKey;
  avatar?: AvatarKey;
  /** The record against the AI, as the public profile shows it. */
  ai?: Stats;
}

/** What anybody may read about an account: no phone, no token, no history. */
export interface PublicPlayer {
  userId: string;
  name: string;
  country: CountryKey;
  avatar: AvatarKey;
  createdAt: number;
  lastSeenAt: number;
  rating: PlayerRating;
  ai: PublicStats;
}

export function toPublic(record: UserRecord): PublicPlayer {
  return {
    userId: record.userId,
    name: record.name,
    country: record.country ?? UNKNOWN_COUNTRY,
    avatar: record.avatar ?? 'clay',
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
    rating: record.rating,
    ai: publicStats(record.ai ?? emptyStats()),
  };
}

/** What `/auth/status` needs to answer the browser. */
export interface VerificationView {
  status: VerificationStatus;
  userId: string | null;
  isNewUser: boolean;
  /**
   * Whether the caller should ask phone-verif, having been given the turn.
   *
   * Answered here rather than by the router because this object is the only
   * thing that sees every poll for this session — several tabs, or a retry
   * storm, still produce one upstream call per window.
   */
  shouldPoll: boolean;
}

interface SettlePayload {
  status: VerificationStatus;
  userId?: string | null;
  isNewUser?: boolean;
}

export class Identity implements DurableObject {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();

    switch (url.pathname) {
      // --- a sign-in in flight ---------------------------------------------
      case '/session/open': {
        const sessionId = url.searchParams.get('id') ?? '';
        const record = newVerification(sessionId, now);
        await this.state.storage.put(RECORD_KEY, record);
        return Response.json(view(record, false));
      }

      case '/session/read': {
        const record = await this.record();
        if (!record) return Response.json(null);
        // An abandoned sign-in is reported as expired rather than swept on a
        // timer: nobody is waiting on it, so there is nothing to wake up for.
        if (isStale(record, now)) {
          const done = settle(record, { status: 'expired' }, now);
          await this.state.storage.put(RECORD_KEY, done);
          return Response.json(view(done, false));
        }
        // The turn is claimed here, before the call rather than after it, so a
        // slow or failing upstream cannot let a second caller through behind it.
        const mine = shouldPollUpstream(record, now);
        if (mine) await this.state.storage.put(RECORD_KEY, markPolled(record, now));
        return Response.json(view(record, mine));
      }

      case '/session/settle': {
        const payload = await request.json() as SettlePayload;
        const record = (await this.record()) ?? newVerification(
          url.searchParams.get('id') ?? '', now,
        );
        const next = settle(record, payload, now);
        await this.state.storage.put(RECORD_KEY, next);
        return Response.json(view(next, false));
      }

      // --- an account -------------------------------------------------------
      case '/user/seen': {
        const body = await request.json() as { userId: string; name?: string };
        const existing = await this.state.storage.get<UserRecord>(USER_KEY);
        const named = cleanDisplayName(body.name, existing?.name ?? '');
        const record: UserRecord = {
          ...existing,
          userId: body.userId,
          name: named,
          createdAt: existing?.createdAt ?? now,
          lastSeenAt: now,
          rating: existing?.rating ?? initialRating(),
        };
        await this.state.storage.put(USER_KEY, record);
        return Response.json(record);
      }

      case '/user/read': {
        const record = await this.state.storage.get<UserRecord>(USER_KEY);
        return Response.json(record ?? null);
      }

      /**
       * What the player says about themselves: a name, a country, an avatar.
       * Each field is optional and only overwrites when present and valid.
       *
       * `ai` is a one-time seed: the record a player built on this device
       * before signing in. Taken only while the account has none of its own,
       * so it cannot be used to rewrite a record the server already keeps.
       */
      case '/user/profile': {
        const body = await request.json() as Record<string, unknown>;
        const existing = await this.state.storage.get<UserRecord>(USER_KEY);
        if (!existing) return new Response('no such user', { status: 404 });
        const country = body.country === undefined ? existing.country : normaliseCountry(body.country);
        const avatar = AVATARS.includes(body.avatar as AvatarKey)
          ? body.avatar as AvatarKey
          : existing.avatar;
        const seeded = !existing.ai || existing.ai.games === 0;
        const record: UserRecord = {
          ...existing,
          name: cleanDisplayName(body.name, existing.name),
          ...(country ? { country } : {}),
          ...(avatar ? { avatar } : {}),
          ...(seeded && body.ai ? { ai: coerceStats(body.ai) } : {}),
          lastSeenAt: now,
        };
        await this.state.storage.put(USER_KEY, record);
        return Response.json(record);
      }

      /** One finished AI game, folded into the account's public record. */
      case '/user/aiGame': {
        const body = await request.json() as Record<string, unknown>;
        const existing = await this.state.storage.get<UserRecord>(USER_KEY);
        if (!existing) return new Response('no such user', { status: 404 });
        const outcome = sanitiseOutcome(body.outcome);
        if (!outcome) return new Response('bad outcome', { status: 400 });
        const seeds = (v: unknown) => (typeof v === 'number' && Number.isFinite(v)
          ? Math.min(48, Math.max(0, Math.round(v)))
          : 0);
        const ai = applyResult(coerceStats(existing.ai ?? null), {
          level: sanitiseLevel(body.level),
          outcome,
          you: seeds(body.you),
          them: seeds(body.them),
          country: typeof body.country === 'string' ? body.country : existing.country,
          at: now,
        });
        // The public profile never shows the history; a short one is kept so
        // the record stays the same shape as the device's.
        const record: UserRecord = { ...existing, ai: { ...ai, history: ai.history.slice(0, 10) }, lastSeenAt: now };
        await this.state.storage.put(USER_KEY, record);
        return Response.json(record);
      }

      case '/user/public': {
        const record = await this.state.storage.get<UserRecord>(USER_KEY);
        return Response.json(record ? toPublic(record) : null);
      }

      case '/user/leaderboard': {
        const allUsers = await this.getAllUsers();
        return Response.json(allUsers);
      }

      case '/user/rename': {
        const body = await request.json() as { name: string };
        const existing = await this.state.storage.get<UserRecord>(USER_KEY);
        if (!existing) return new Response('no such user', { status: 404 });
        const record: UserRecord = {
          ...existing,
          name: cleanDisplayName(body.name, existing.name),
          lastSeenAt: now,
        };
        await this.state.storage.put(USER_KEY, record);
        return Response.json(record);
      }

      case '/user/updateRating': {
        const body = await request.json() as { 
          userId: string; 
          opponentRating: number;
          result: 'win' | 'loss' | 'draw';
        };
        const existing = await this.state.storage.get<UserRecord>(USER_KEY);
        if (!existing) return new Response('no such user', { status: 404 });
        
        // Only allow updating the user that owns this DO
        if (existing.userId !== body.userId) {
          return new Response('forbidden', { status: 403 });
        }

        const updatedRating = updatePlayerRating(
          existing.rating,
          body.opponentRating,
          body.result,
        );
        
        const record: UserRecord = {
          ...existing,
          rating: updatedRating,
          lastSeenAt: now,
        };
        await this.state.storage.put(USER_KEY, record);
        return Response.json(record);
      }

      default:
        return new Response('not found', { status: 404 });
    }
  }

  private async record(): Promise<VerificationRecord | null> {
    return (await this.state.storage.get<VerificationRecord>(RECORD_KEY)) ?? null;
  }

  /**
   * Get all users for leaderboard.
   * This is a simple implementation that scans all user DOs.
   * In production, you might want a separate leaderboard storage.
   */
  private async getAllUsers(): Promise<UserRecord[]> {
    // Note: This is a simplified approach. In Cloudflare Workers,
    // you would need to maintain a separate leaderboard or use a different
    // approach to aggregate data across multiple DOs.
    // For now, we return the current user if this is a user DO.
    const record = await this.state.storage.get<UserRecord>(USER_KEY);
    return record ? [record] : [];
  }
}

function view(record: VerificationRecord, shouldPoll: boolean): VerificationView {
  return {
    status: record.status,
    userId: record.userId,
    isNewUser: record.isNewUser,
    shouldPoll,
  };
}
