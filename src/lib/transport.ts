// A two-way string pipe, and nothing more.
//
// The online session does not know what carries its messages. That is
// deliberate: `test/online.test.ts` runs whole matches through in-memory pipes
// with no sockets and no server process, and a different transport later (a
// relay inside the native shell, say) drops in without the session noticing.
export type TransportStatus = 'connecting' | 'open' | 'closed';

export interface TransportHandlers {
  message(data: string): void;
  status(status: TransportStatus): void;
}

export interface Transport {
  send(data: string): void;
  /** A deliberate shutdown. Nothing reconnects after this. */
  close(): void;
  readonly status: TransportStatus;
}

/**
 * Builds a transport around the handlers the session gives it.
 *
 * A factory rather than an instance because the session reconnects: when a
 * socket dies it asks for another one, and the old handlers stay valid.
 */
export type TransportFactory = (handlers: TransportHandlers) => Transport;
