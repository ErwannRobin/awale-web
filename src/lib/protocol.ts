// The wire format between a browser and the match server.
//
// Both ends import this file, so a change that breaks one breaks the other at
// build time rather than in production. Messages are JSON, one per WebSocket
// frame, and every one is validated on arrival: the client does not trust the
// server's shape any more than the server trusts the client's.
import type { EndReason, Seat, Winner } from './rules.ts';
import { normaliseCountry, UNKNOWN_COUNTRY, type CountryKey } from './country.ts';

/** Bumped when a message shape changes incompatibly. */
export const PROTOCOL_VERSION = 1;

/** Room codes a person has to read out loud, so no 0/O and no 1/I/L. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

export type RoomStatus = 'waiting' | 'playing' | 'over';

/** Why a game stopped, including the reasons only online play has. */
export type OverReason = EndReason | 'resign' | 'abandoned' | 'timeout';

/**
 * How much thinking time each player gets: a budget for the whole game, plus
 * an increment added back after every move (so "3+2" is three minutes, two
 * seconds a move). `none` is the untimed game online play has always been.
 */
export type TimeControlId = 'none' | 'blitz' | 'rapid' | 'classic';

export const TIME_CONTROLS: Record<TimeControlId, { base: number; inc: number } | null> = {
  none: null,
  blitz: { base: 3 * 60_000, inc: 2_000 },
  rapid: { base: 5 * 60_000, inc: 5_000 },
  classic: { base: 10 * 60_000, inc: 10_000 },
};

export const TIME_CONTROL_IDS = Object.keys(TIME_CONTROLS) as TimeControlId[];

export const isTimeControl = (v: unknown): v is TimeControlId =>
  typeof v === 'string' && v in TIME_CONTROLS;

/** A running game's clocks, as the server had them when it sent this. */
export interface ClockView {
  control: TimeControlId;
  /** Milliseconds left per seat. */
  left: [number, number];
  /** The seat whose clock is running, or null when both are stopped. */
  running: Seat | null;
}

export interface PlayerView {
  name: string;
  online: boolean;
  /**
   * Where the player says they play from, for the flag beside their name and
   * the rivalry it starts. Optional on the wire, so an older peer that never
   * sends one simply reads as unknown.
   */
  country?: CountryKey;
}

/** A player view from anywhere, validated. */
function parsePlayer(p: unknown, fallback: string): PlayerView | null {
  if (!p || typeof p !== 'object') return null;
  const r = p as Record<string, unknown>;
  const country = normaliseCountry(r.country);
  return {
    name: cleanName(r.name, fallback),
    online: r.online === true,
    ...(country === UNKNOWN_COUNTRY ? {} : { country }),
  };
}

/** Everything needed to draw the room from scratch. Sent on join and resync. */
export interface RoomSnapshot {
  room: string;
  status: RoomStatus;
  pits: number[];
  scores: number[];
  turn: Seat;
  /** Moves played so far. Doubles as the anti-replay counter. */
  ply: number;
  /** Which seat opened this game; it alternates on a rematch. */
  startSeat: Seat;
  players: [PlayerView | null, PlayerView | null];
  winner: Winner | null;
  reason: OverReason | null;
  /** Seats that have asked for a rematch. */
  rematch: [boolean, boolean];
  /** Absent for an untimed game. */
  clock?: ClockView;
}

export type ClientMsg =
  /**
   * First message on every connection, new or reconnecting.
   *
   * `auth` is a signed session token from `/auth/*`, and is optional: online
   * play works signed out exactly as it always has. When it is present and
   * valid the server uses the account behind it as the seat identity, so the
   * seat cannot be taken by someone who learned the anonymous `token`.
   */
  | {
    t: 'hello'; v: number; token: string; name: string; auth?: string; country?: CountryKey;
    /**
     * The time control this player came for. The first player into a room who
     * names one sets it for the room; everyone after plays at whatever is set.
     */
    tc?: TimeControlId;
  }
  | { t: 'move'; pit: number; ply: number }
  | { t: 'resign' }
  | { t: 'rematch' }
  /** "My board and yours disagree — send me yours." */
  | { t: 'resync' }
  | { t: 'ping' };

export type ErrorCode =
  | 'bad-message'
  | 'bad-version'
  | 'room-full'
  | 'not-seated'
  | 'not-your-turn'
  | 'illegal-move'
  | 'stale-ply'
  | 'not-playing';

export type ServerMsg =
  | { t: 'welcome'; seat: Seat; snapshot: RoomSnapshot }
  | { t: 'sync'; snapshot: RoomSnapshot }
  /**
   * Apply this move locally; `hash` is what your board should look like after.
   * A timed game also sends both clocks as they stand after the move, with the
   * mover's increment added; the other side's clock is the one now running.
   */
  | { t: 'move'; pit: number; by: Seat; ply: number; hash: string; clock?: [number, number] }
  | { t: 'over'; winner: Winner; reason: OverReason; scores: number[]; clock?: [number, number] }
  | { t: 'peer'; seat: Seat; player: PlayerView | null }
  | { t: 'rematch'; from: Seat }
  | { t: 'err'; code: ErrorCode }
  | { t: 'pong' };

/**
 * A cheap deterministic fingerprint of a position (FNV-1a).
 *
 * Both sides replay the same moves through the same engine, so their boards
 * must match. Sending the fingerprint with every move turns "they silently
 * drifted apart" into "they noticed and resynced" — the difference between a
 * confusing game and a recoverable one.
 */
export function stateHash(pits: number[], scores: number[], turn: Seat): string {
  const text = `${pits.join(',')}|${scores.join(',')}|${turn}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function makeRoomCode(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Accepts what a person typed — lowercase, spaces, stray dashes. */
export function normaliseRoomCode(raw: string): string | null {
  const up = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (up.length !== CODE_LENGTH) return null;
  for (const ch of up) if (!CODE_ALPHABET.includes(ch)) return null;
  return up;
}

/** Names are shown to a stranger, so they are stripped and length-capped. */
export function cleanName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const trimmed = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 20);
  return trimmed || fallback;
}

const isBoard = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length === 12
  && v.every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0);

const isScores = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length === 2
  && v.every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0);

const isSeat = (v: unknown): v is Seat => v === 0 || v === 1;

const isClockPair = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2
  && v.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0);

function parseClock(v: unknown): ClockView | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (!isTimeControl(o.control) || o.control === 'none' || !isClockPair(o.left)) return undefined;
  const running = isSeat(o.running) ? o.running : null;
  return { control: o.control, left: [o.left[0], o.left[1]], running };
}

export function parseClientMsg(raw: string): ClientMsg | null {
  let o: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    o = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (o.t) {
    case 'hello': {
      if (typeof o.v !== 'number' || typeof o.token !== 'string') return null;
      if (o.token.length < 8 || o.token.length > 64) return null;
      // Capped rather than parsed: this file cannot verify a signature, so the
      // most it can say is "short enough to be worth showing the verifier".
      const auth = typeof o.auth === 'string' && o.auth.length > 0 && o.auth.length <= 1024
        ? { auth: o.auth }
        : {};
      const country = normaliseCountry(o.country);
      return {
        t: 'hello', v: o.v, token: o.token, name: cleanName(o.name, ''), ...auth,
        ...(country === UNKNOWN_COUNTRY ? {} : { country }),
        ...(isTimeControl(o.tc) ? { tc: o.tc } : {}),
      };
    }
    case 'move':
      if (typeof o.pit !== 'number' || !Number.isInteger(o.pit)) return null;
      if (typeof o.ply !== 'number' || !Number.isInteger(o.ply)) return null;
      return { t: 'move', pit: o.pit, ply: o.ply };
    case 'resign': return { t: 'resign' };
    case 'rematch': return { t: 'rematch' };
    case 'resync': return { t: 'resync' };
    case 'ping': return { t: 'ping' };
    default: return null;
  }
}

function parseSnapshot(v: unknown): RoomSnapshot | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.room !== 'string') return null;
  if (o.status !== 'waiting' && o.status !== 'playing' && o.status !== 'over') return null;
  if (!isBoard(o.pits) || !isScores(o.scores)) return null;
  if (!isSeat(o.turn) || !isSeat(o.startSeat)) return null;
  if (typeof o.ply !== 'number' || !Number.isInteger(o.ply) || o.ply < 0) return null;
  if (!Array.isArray(o.players) || o.players.length !== 2) return null;
  const players = o.players.map(p => parsePlayer(p, '?')) as [PlayerView | null, PlayerView | null];
  const rematch: [boolean, boolean] = Array.isArray(o.rematch) && o.rematch.length === 2
    ? [o.rematch[0] === true, o.rematch[1] === true]
    : [false, false];
  const winner = isSeat(o.winner) || o.winner === 'draw' ? o.winner : null;
  const clock = parseClock(o.clock);
  return {
    room: o.room,
    status: o.status,
    pits: o.pits,
    scores: o.scores,
    turn: o.turn,
    ply: o.ply,
    startSeat: o.startSeat,
    players,
    winner,
    reason: typeof o.reason === 'string' ? (o.reason as OverReason) : null,
    rematch,
    ...(clock ? { clock } : {}),
  };
}

export function parseServerMsg(raw: string): ServerMsg | null {
  let o: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    o = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (o.t) {
    case 'welcome': {
      const snapshot = parseSnapshot(o.snapshot);
      if (!isSeat(o.seat) || !snapshot) return null;
      return { t: 'welcome', seat: o.seat, snapshot };
    }
    case 'sync': {
      const snapshot = parseSnapshot(o.snapshot);
      return snapshot ? { t: 'sync', snapshot } : null;
    }
    case 'move':
      if (typeof o.pit !== 'number' || !isSeat(o.by)) return null;
      if (typeof o.ply !== 'number' || typeof o.hash !== 'string') return null;
      return {
        t: 'move', pit: o.pit, by: o.by, ply: o.ply, hash: o.hash,
        ...(isClockPair(o.clock) ? { clock: [o.clock[0], o.clock[1]] as [number, number] } : {}),
      };
    case 'over': {
      if (!isSeat(o.winner) && o.winner !== 'draw') return null;
      if (typeof o.reason !== 'string' || !isScores(o.scores)) return null;
      return {
        t: 'over', winner: o.winner, reason: o.reason as OverReason, scores: o.scores,
        ...(isClockPair(o.clock) ? { clock: [o.clock[0], o.clock[1]] as [number, number] } : {}),
      };
    }
    case 'peer': {
      if (!isSeat(o.seat)) return null;
      return { t: 'peer', seat: o.seat, player: parsePlayer(o.player, '?') };
    }
    case 'rematch':
      return isSeat(o.from) ? { t: 'rematch', from: o.from } : null;
    case 'err':
      return typeof o.code === 'string' ? { t: 'err', code: o.code as ErrorCode } : null;
    case 'pong':
      return { t: 'pong' };
    default:
      return null;
  }
}
