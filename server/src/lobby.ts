// Quick match: the smallest matchmaker that actually works.
//
// One Durable Object holds at most one waiting room code. The first player to
// ask gets a fresh code and sits in it; the second is handed that same code and
// walks into an occupied room. Because a Durable Object handles one request at
// a time, there is no race here to lose.
//
// The known weakness: a player who asks for a quick match and then closes the
// tab leaves their code waiting, and the next player joins an empty room and
// waits for someone who is never coming. The TTL below bounds how long that
// stale code can be handed out; a queue that verified the room was still
// occupied would need the lobby to talk to each room, which is a bigger change
// than this feature has earned yet.
import { makeRoomCode } from '../../src/lib/protocol.ts';

const WAITING_KEY = 'waiting';

/** How long a waiting code may be handed to a second player. */
export const WAIT_TTL_MS = 120_000;

interface Waiting {
  code: string;
  at: number;
}

export interface QueueReply {
  code: string;
  /** `created` means you are the one waiting; `joined` means go straight in. */
  role: 'created' | 'joined';
}

export class Lobby implements DurableObject {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('use POST', { status: 405 });
    }

    const now = Date.now();
    const waiting = await this.state.storage.get<Waiting>(WAITING_KEY);

    if (waiting && now - waiting.at < WAIT_TTL_MS) {
      await this.state.storage.delete(WAITING_KEY);
      return reply({ code: waiting.code, role: 'joined' });
    }

    const code = makeRoomCode();
    await this.state.storage.put(WAITING_KEY, { code, at: now } satisfies Waiting);
    return reply({ code, role: 'created' });
  }
}

const reply = (body: QueueReply) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
