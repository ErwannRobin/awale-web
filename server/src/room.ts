// One Durable Object per room: two sockets, one board, one judge.
//
// A Durable Object is the right shape for this. Cloudflare guarantees exactly
// one instance per room name, worldwide, and runs its handlers one at a time —
// so "did both players move at once?" is a question this code never has to ask.
//
// The rules live in `src/lib/roomCore.ts` and are pure. Everything here is
// plumbing: sockets in, sockets out, state to storage, an alarm for the player
// who walked away.
import {
  ABANDON_MS,
  command, createRoom, disconnect, isExpired, join, seatOf, sweep,
  type Effect, type RoomState,
} from '../../src/lib/roomCore.ts';
import {
  PROTOCOL_VERSION, parseClientMsg,
  type ServerMsg,
} from '../../src/lib/protocol.ts';
import type { Seat } from '../../src/lib/rules.ts';

const STATE_KEY = 'room';

/** `WebSocket.OPEN`, spelled out: the Workers runtime and the DOM disagree on
 *  the name of this constant but not on its value. */
const OPEN = 1;

/** What each socket remembers about itself across a hibernation. */
interface SocketTag {
  token: string;
  seat: Seat | null;
}

export class Room implements DurableObject {
  private cached: RoomState | null = null;

  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a websocket upgrade', { status: 426 });
    }

    const code = new URL(request.url).searchParams.get('code') ?? 'ROOM';
    await this.load(code);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernation: the runtime may evict this object from memory while the
    // sockets stay open, and wake it on the next message. That is the whole
    // reason room state is written to storage rather than kept in a field.
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ token: '', seat: null } satisfies SocketTag);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== 'string') return;
    const msg = parseClientMsg(data);
    if (!msg) {
      this.sendTo(ws, { t: 'err', code: 'bad-message' });
      return;
    }

    const room = await this.load();
    const now = Date.now();

    if (msg.t === 'hello') {
      if (msg.v !== PROTOCOL_VERSION) {
        this.sendTo(ws, { t: 'err', code: 'bad-version' });
        ws.close(1002, 'protocol version');
        return;
      }
      const result = join(room, msg.token, msg.name, now);
      if (result.error) {
        this.sendTo(ws, { t: 'err', code: result.error });
        ws.close(1000, result.error);
        return;
      }
      ws.serializeAttachment({ token: msg.token, seat: result.seat } satisfies SocketTag);
      await this.commit(result.state);
      this.dispatch(result.effects);
      await this.scheduleSweep();
      return;
    }

    const tag = this.tagOf(ws);
    if (!tag.token || seatOf(room, tag.token) === null) {
      this.sendTo(ws, { t: 'err', code: 'not-seated' });
      return;
    }

    const step = command(room, tag.token, msg, now);
    await this.commit(step.state);
    this.dispatch(step.effects);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.dropped(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropped(ws);
  }

  /**
   * The clock's turn to speak.
   *
   * Nothing else can end a game whose opponent simply stopped existing: no
   * message arrives to trigger it. Without this alarm the player still watching
   * the board waits forever.
   */
  async alarm(): Promise<void> {
    const room = await this.load();
    const now = Date.now();

    if (isExpired(room, now)) {
      await this.state.storage.deleteAll();
      this.cached = null;
      for (const ws of this.state.getWebSockets()) {
        try { ws.close(1000, 'room closed'); } catch { /* already gone */ }
      }
      return;
    }

    const step = sweep(room, now);
    await this.commit(step.state);
    this.dispatch(step.effects);
    await this.scheduleSweep();
  }

  // ---- plumbing ----------------------------------------------------------

  private async load(code?: string): Promise<RoomState> {
    if (this.cached) return this.cached;
    const stored = await this.state.storage.get<RoomState>(STATE_KEY);
    this.cached = stored ?? createRoom(code ?? 'ROOM', Date.now());
    if (!stored) await this.state.storage.put(STATE_KEY, this.cached);
    return this.cached;
  }

  private async commit(next: RoomState): Promise<void> {
    this.cached = next;
    await this.state.storage.put(STATE_KEY, next);
  }

  private tagOf(ws: WebSocket): SocketTag {
    const raw = ws.deserializeAttachment() as SocketTag | null;
    return raw ?? { token: '', seat: null };
  }

  private async dropped(ws: WebSocket): Promise<void> {
    const tag = this.tagOf(ws);
    if (!tag.token) return;
    // A player with a second tab open has not left; only the last socket for a
    // seat counts as a disconnect.
    const stillHere = this.state.getWebSockets().some(other => {
      if (other === ws) return false;
      if (other.readyState !== OPEN) return false;
      return this.tagOf(other).token === tag.token;
    });
    if (stillHere) return;

    const room = await this.load();
    const step = disconnect(room, tag.token, Date.now());
    await this.commit(step.state);
    this.dispatch(step.effects);
    await this.scheduleSweep();
  }

  private sendTo(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch { /* the socket died between the check and the send */ }
  }

  private dispatch(effects: Effect[]): void {
    if (effects.length === 0) return;
    const sockets = this.state.getWebSockets();
    for (const effect of effects) {
      const body = JSON.stringify(effect.msg);
      for (const ws of sockets) {
        if (ws.readyState !== OPEN) continue;
        if (effect.to !== 'all' && this.tagOf(ws).seat !== effect.to) continue;
        try { ws.send(body); } catch { /* dropped mid-broadcast */ }
      }
    }
  }

  /**
   * One alarm, always the next thing that could need doing. Cloudflare keeps a
   * single alarm per object, so this overwrites rather than accumulates.
   */
  private async scheduleSweep(): Promise<void> {
    const room = this.cached;
    if (!room) return;
    const offline = room.players
      .map(p => p?.offlineSince ?? null)
      .filter((t): t is number => t !== null);
    const next = offline.length > 0
      ? Math.min(...offline) + ABANDON_MS
      : Date.now() + 10 * 60_000;   // otherwise just a tidy-up pass
    await this.state.storage.setAlarm(next);
  }
}
