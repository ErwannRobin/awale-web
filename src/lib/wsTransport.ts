// The browser half of the pipe: one WebSocket, reopened when it dies.
//
// The only browser-specific file in the online stack. Everything above it —
// the session, the protocol, the room rules — is plain TypeScript.
import type { Transport, TransportFactory, TransportHandlers, TransportStatus } from './transport.ts';

/** Backoff between reconnect attempts. Capped, so a long outage keeps trying. */
const RETRY_MS = [500, 1000, 2000, 4000, 8000, 15_000];

/**
 * A move takes a moment of thought, so a quiet socket is normal. Middleboxes
 * and mobile networks disagree, and cut anything idle — hence the keepalive.
 */
export const KEEPALIVE_MS = 25_000;

export function webSocketTransport(url: string): TransportFactory {
  return (handlers: TransportHandlers): Transport => {
    let socket: WebSocket | null = null;
    let status: TransportStatus = 'connecting';
    let closed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let keepalive: ReturnType<typeof setInterval> | undefined;
    // Sends made while the socket is down wait here rather than vanishing.
    let pending: string[] = [];

    const setStatus = (next: TransportStatus) => {
      if (status === next) return;
      status = next;
      handlers.status(next);
    };

    const open = () => {
      if (closed) return;
      setStatus('connecting');
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        retry();
        return;
      }
      socket = ws;

      ws.onopen = () => {
        if (closed) { ws.close(); return; }
        attempt = 0;
        setStatus('open');
        const queued = pending;
        pending = [];
        for (const item of queued) ws.send(item);
        clearInterval(keepalive);
        keepalive = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ping' }));
        }, KEEPALIVE_MS);
      };

      ws.onmessage = event => {
        if (typeof event.data === 'string') handlers.message(event.data);
      };

      // A socket that errors also closes, so recovery lives in one place.
      ws.onerror = () => {};

      ws.onclose = () => {
        clearInterval(keepalive);
        if (socket === ws) socket = null;
        if (closed) { setStatus('closed'); return; }
        retry();
      };
    };

    const retry = () => {
      setStatus('connecting');
      const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)];
      attempt++;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(open, wait);
    };

    open();

    return {
      get status(): TransportStatus { return status; },
      send(data: string) {
        if (closed) return;
        if (socket && socket.readyState === WebSocket.OPEN) socket.send(data);
        // 32 is far more than a turn-based game can legitimately queue; beyond
        // that the backlog is a bug, and replaying it would be worse than
        // dropping it.
        else if (pending.length < 32) pending.push(data);
      },
      close() {
        closed = true;
        clearTimeout(retryTimer);
        clearInterval(keepalive);
        pending = [];
        try { socket?.close(); } catch { /* already gone */ }
        socket = null;
        setStatus('closed');
      },
    };
  };
}
