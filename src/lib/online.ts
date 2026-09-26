// The client half of a match: one room, one seat, one opponent.
//
// It owns the conversation with the server and nothing else. It does not draw,
// animate, or keep a board — the board stays in `useGame`, which replays the
// moves the server confirms. The two talk through the callbacks below.
import { isCountryCode, type CountryCode } from './country.ts';
import {
  PROTOCOL_VERSION, parseServerMsg, stateHash,
  type ClientMsg, type ErrorCode, type OverReason, type RoomSnapshot, type TimeControlId,
} from './protocol.ts';
import type { Seat, Winner } from './rules.ts';
import type { Transport, TransportFactory, TransportStatus } from './transport.ts';

export type Connection = 'connecting' | 'online' | 'offline';

/** Protocol errors, plus the one condition only the client can notice. */
export type SessionError = ErrorCode | 'desync';

export interface OnlineView {
  connection: Connection;
  seat: Seat | null;
  snapshot: RoomSnapshot | null;
  error: SessionError | null;
  /** They asked for a rematch and are waiting on you. */
  rematchOffered: boolean;
  /** You asked; you are waiting on them. */
  rematchSent: boolean;
  /**
   * When `snapshot.clock` arrived, on this device's clock. The countdown on
   * screen is the server's numbers minus the time since — never a clock this
   * device keeps on its own.
   */
  clockAt: number;
  /** Here to watch: no seat, and the room has said so. */
  watching: boolean;
  /** How many people are watching this room. */
  audience: number;
}

export interface SessionCallbacks {
  /** Play this move on the local board. */
  move(pit: number, by: Seat, ply: number, hash: string): void;
  /** Throw the local board away and rebuild it from this position. */
  reset(snapshot: RoomSnapshot): void;
  over(winner: Winner, reason: OverReason, scores: number[]): void;
  change(view: OnlineView): void;
  /** Someone at the board sent one of `REACTIONS`. Optional: a test may not care. */
  react?(by: Seat, e: number): void;
}

/** A country worth sending, or null: `ZZ` is simply left out of the hello. */
const countryOf = (raw: string | undefined): CountryCode | null =>
  (isCountryCode(raw) ? raw.toUpperCase() as CountryCode : null);

export interface SessionOptions {
  factory: TransportFactory;
  /** Proves which seat is yours across a reconnect. Persisted by the caller. */
  token: string;
  /**
   * A signed session token, when the player is signed in.
   *
   * The server verifies it and seats the account behind it, which is what makes
   * a seat survive a new device — and what stops someone who learned `token`
   * from taking it. Absent means an anonymous seat, exactly as before.
   */
  auth?: string;
  name: string;
  /** Where the player says they play from; sent so the other side sees the flag. */
  country?: string;
  /** The clock this player came for; the room keeps the first one it hears. */
  control?: TimeControlId;
  /** Come as a spectator rather than a player. */
  watch?: boolean;
  /** Ask for the game to be in the public live list (quick match does). */
  listed?: boolean;
  callbacks: SessionCallbacks;
}

export class OnlineSession {
  private transport: Transport | null = null;
  private closed = false;
  private view: OnlineView = {
    connection: 'connecting',
    seat: null,
    snapshot: null,
    error: null,
    rematchOffered: false,
    rematchSent: false,
    clockAt: 0,
    watching: false,
    audience: 0,
  };

  private readonly opts: SessionOptions;

  // A plain field, not a constructor parameter property: Node's type stripping
  // rejects those, and `test/online.test.ts` runs this file under it.
  constructor(opts: SessionOptions) {
    this.opts = opts;
    this.transport = opts.factory({
      message: data => this.receive(data),
      status: status => this.onStatus(status),
    });
  }

  get current(): OnlineView { return this.view; }

  /** The ply the next move will answer. */
  get ply(): number { return this.view.snapshot?.ply ?? 0; }

  get myTurn(): boolean {
    const s = this.view.snapshot;
    return !!s && s.status === 'playing' && this.view.seat !== null && s.turn === this.view.seat;
  }

  sendMove(pit: number): void {
    this.send({ t: 'move', pit, ply: this.ply });
  }

  resign(): void { this.send({ t: 'resign' }); }

  /** One of `REACTIONS`, by index. The server rate-limits; so does the UI. */
  react(e: number): void { this.send({ t: 'react', e }); }

  rematch(): void {
    this.patch({ rematchSent: true });
    this.send({ t: 'rematch' });
  }

  /**
   * The local board and the server's have drifted apart. Rather than guess
   * which is right — the server always is — ask for the position back.
   */
  reportDesync(): void {
    this.patch({ error: 'desync' });
    this.send({ t: 'resync' });
  }

  close(): void {
    this.closed = true;
    this.transport?.close();
    this.transport = null;
  }

  private send(msg: ClientMsg): void {
    if (this.closed) return;
    // A transport that reports "open" from inside its own constructor would
    // reach here before the field below is assigned. Real sockets never do;
    // a test double easily can, and losing the `hello` would hang the session.
    if (!this.transport) {
      queueMicrotask(() => this.send(msg));
      return;
    }
    this.transport.send(JSON.stringify(msg));
  }

  private onStatus(status: TransportStatus): void {
    if (this.closed) return;
    if (status === 'open') {
      // Every connection starts by saying who it is, new or returning. The
      // server answers with `welcome`, which is what actually seats us.
      this.send({
        t: 'hello',
        v: PROTOCOL_VERSION,
        token: this.opts.token,
        name: this.opts.name,
        ...(this.opts.auth ? { auth: this.opts.auth } : {}),
        ...(countryOf(this.opts.country) ? { country: countryOf(this.opts.country)! } : {}),
        ...(this.opts.control && this.opts.control !== 'none' ? { tc: this.opts.control } : {}),
        ...(this.opts.watch ? { watch: true } : {}),
        ...(this.opts.listed ? { listed: true } : {}),
      });
      // Stay "connecting" until the welcome lands: an open socket that has not
      // been seated (or shown the room, for a spectator) yet is not a game.
      this.patch({
        connection: this.view.seat === null && !this.view.watching ? 'connecting' : 'online',
      });
      return;
    }
    this.patch({ connection: status === 'connecting' ? 'connecting' : 'offline' });
  }

  private patch(next: Partial<OnlineView>): void {
    this.view = { ...this.view, ...next };
    this.opts.callbacks.change(this.view);
  }

  private receive(data: string): void {
    const msg = parseServerMsg(data);
    if (!msg) return;

    switch (msg.t) {
      case 'welcome':
        this.patch({
          seat: msg.seat,
          snapshot: msg.snapshot,
          connection: 'online',
          error: null,
          rematchOffered: false,
          rematchSent: false,
          clockAt: Date.now(),
        });
        this.opts.callbacks.reset(msg.snapshot);
        return;

      case 'watching':
        this.patch({
          watching: true,
          snapshot: msg.snapshot,
          connection: 'online',
          error: null,
          clockAt: Date.now(),
        });
        this.opts.callbacks.reset(msg.snapshot);
        return;

      case 'audience':
        this.patch({ audience: msg.n });
        return;

      case 'sync':
        this.patch({
          snapshot: msg.snapshot,
          error: null,
          rematchOffered: false,
          rematchSent: false,
          clockAt: Date.now(),
        });
        this.opts.callbacks.reset(msg.snapshot);
        return;

      case 'move': {
        const snap = this.view.snapshot;
        // A move for a ply we have already played is a duplicate, not news.
        if (snap && msg.ply <= snap.ply) return;
        // The clocks change hands the moment the move is made, not when this
        // board has finished animating it.
        if (snap?.clock && msg.clock) {
          this.patch({
            snapshot: { ...snap, clock: { ...snap.clock, left: msg.clock, running: msg.by === 0 ? 1 : 0 } },
            clockAt: Date.now(),
          });
        }
        this.opts.callbacks.move(msg.pit, msg.by, msg.ply, msg.hash);
        return;
      }

      case 'over': {
        const snap = this.view.snapshot;
        if (snap) {
          this.patch({
            snapshot: {
              ...snap,
              status: 'over',
              scores: msg.scores,
              winner: msg.winner,
              reason: msg.reason,
              rematch: [false, false],
              ...(snap.clock
                ? { clock: { ...snap.clock, left: msg.clock ?? snap.clock.left, running: null } }
                : {}),
            },
            rematchOffered: false,
            rematchSent: false,
            clockAt: Date.now(),
          });
        }
        this.opts.callbacks.over(msg.winner, msg.reason, msg.scores);
        return;
      }

      case 'peer': {
        const snap = this.view.snapshot;
        if (!snap) return;
        const players = [...snap.players] as RoomSnapshot['players'];
        players[msg.seat] = msg.player;
        this.patch({ snapshot: { ...snap, players } });
        return;
      }

      case 'rematch':
        this.patch({ rematchOffered: true });
        return;

      case 'react':
        this.opts.callbacks.react?.(msg.by, msg.e);
        return;

      case 'err':
        this.patch({ error: msg.code });
        // A refused move leaves the board waiting for a confirmation that is
        // never coming. Ask for the position back so the game unfreezes.
        if (msg.code === 'illegal-move' || msg.code === 'not-your-turn'
            || msg.code === 'stale-ply' || msg.code === 'not-playing') {
          this.send({ t: 'resync' });
        }
        return;

      case 'pong':
        return;
    }
  }

  /**
   * Book-keeping after the local board has replayed a confirmed move.
   *
   * The caller passes the position it arrived at; if it does not match the
   * fingerprint the server sent, the two have drifted and we resync rather
   * than play on from a board only one of us can see.
   */
  confirmMove(ply: number, pits: number[], scores: number[], turn: Seat): void {
    const snap = this.view.snapshot;
    if (!snap) return;
    this.patch({ snapshot: { ...snap, pits, scores, turn, ply } });
  }

  checkHash(expected: string, pits: number[], scores: number[], turn: Seat): boolean {
    const ok = stateHash(pits, scores, turn) === expected;
    if (!ok) this.reportDesync();
    return ok;
  }
}
