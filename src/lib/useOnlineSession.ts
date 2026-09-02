// The React side of an online match: one session, one room, for as long as the
// screen is on the screen.
//
// Its job is to be the meeting point between two things that cannot import each
// other — the session, which knows the server, and `useGame`, which knows the
// board. The board registers itself through `bind` once it exists, and confirmed
// moves reach it from there.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OnlineSession, type OnlineView } from './online.ts';
import type { OverReason, RoomSnapshot } from './protocol.ts';
import type { Seat, Winner } from './rules.ts';
import type { TransportFactory } from './transport.ts';
import { webSocketTransport } from './wsTransport.ts';
import { roomSocketUrl } from './onlineConfig.ts';

/** The parts of `useGame` an online match drives. */
export interface GameBridge {
  applyRemoteMove(pit: number): { pits: number[]; scores: number[]; turn: Seat };
  resetTo(position: { pits: number[]; scores: number[]; turn: Seat }): void;
  endWith(winner: Winner): void;
}

export interface OnlineHandle {
  view: OnlineView;
  /** Passed to `useGame`; a local tap becomes a request, not a move. */
  remote: { sendMove(pit: number): void };
  /** The board registers itself here once it is mounted. */
  bind(api: GameBridge | null): void;
  resign(): void;
  rematch(): void;
}

export interface OnlineOptions {
  room: string;
  name: string;
  token: string;
  /** A signed session token when signed in; absent when playing anonymously. */
  auth?: string;
  /** Injectable for tests; defaults to a real WebSocket. */
  factory?: TransportFactory;
}

const startingView: OnlineView = {
  connection: 'connecting',
  seat: null,
  snapshot: null,
  error: null,
  rematchOffered: false,
  rematchSent: false,
};

export function useOnlineSession(
  { room, name, token, auth, factory }: OnlineOptions,
): OnlineHandle {
  const [view, setView] = useState<OnlineView>(startingView);
  const sessionRef = useRef<OnlineSession | null>(null);
  const bridgeRef = useRef<GameBridge | null>(null);

  // The name is read when a connection opens, not on every keystroke, so it
  // sits in a ref rather than re-creating the session mid-game.
  const nameRef = useRef(name);
  nameRef.current = name;

  useEffect(() => {
    const make = factory ?? webSocketTransport(roomSocketUrl(room));
    const session = new OnlineSession({
      factory: make,
      token,
      auth,
      name: nameRef.current,
      callbacks: {
        change: next => setView(next),

        reset: (snapshot: RoomSnapshot) => {
          bridgeRef.current?.resetTo({
            pits: snapshot.pits,
            scores: snapshot.scores,
            turn: snapshot.turn,
          });
        },

        move: (pit, _by, ply, hash) => {
          const bridge = bridgeRef.current;
          if (!bridge) {
            // The board is not on screen yet — better to ask for the position
            // than to silently miss a move and drift.
            session.reportDesync();
            return;
          }
          const after = bridge.applyRemoteMove(pit);
          if (!session.checkHash(hash, after.pits, after.scores, after.turn)) return;
          session.confirmMove(ply, after.pits, after.scores, after.turn);
        },

        over: (winner: Winner, reason: OverReason) => {
          // A game that ended on the board has already ended locally, at the
          // end of its own animation. Only the endings the board cannot see
          // need telling.
          if (reason === 'resign' || reason === 'abandoned') {
            bridgeRef.current?.endWith(winner);
          }
        },
      },
    });
    sessionRef.current = session;

    return () => {
      session.close();
      sessionRef.current = null;
      bridgeRef.current = null;
      setView(startingView);
    };
  }, [room, token, auth, factory]);

  const remote = useMemo(() => ({
    sendMove: (pit: number) => sessionRef.current?.sendMove(pit),
  }), []);

  const bind = useCallback((api: GameBridge | null) => { bridgeRef.current = api; }, []);
  const resign = useCallback(() => sessionRef.current?.resign(), []);
  const rematch = useCallback(() => sessionRef.current?.rematch(), []);

  return { view, remote, bind, resign, rematch };
}
