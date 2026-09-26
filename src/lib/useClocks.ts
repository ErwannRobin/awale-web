// The two clocks as they should read right now.
//
// The server sends numbers, not a running clock: how much time each side had
// when it spoke, and whose was running. This hook counts the running one down
// from there, ten times a second, and stops ticking the moment neither runs.
// If the device's own clock drifts, nothing is lost — the next message from
// the server replaces the numbers, and it is the server that calls the flag.
import { useEffect, useState } from 'react';
import type { ClockView } from './protocol.ts';

export interface ClockReading {
  left: [number, number];
  running: 0 | 1 | null;
}

export function readClocks(clock: ClockView, at: number, now: number): ClockReading {
  const left: [number, number] = [clock.left[0], clock.left[1]];
  if (clock.running !== null) {
    left[clock.running] = Math.max(0, left[clock.running] - Math.max(0, now - at));
  }
  return { left, running: clock.running };
}

export function useClocks(clock: ClockView | undefined, at: number): ClockReading | null {
  const [now, setNow] = useState(() => Date.now());
  const running = clock?.running ?? null;
  useEffect(() => {
    if (running === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [running, at]);
  return clock ? readClocks(clock, at, now) : null;
}
