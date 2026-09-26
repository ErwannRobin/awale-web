// Durations, written the way the screens show them. Pure, and free of any
// locale: digits, `h`, `m` and a colon read the same in every table we ship.

/** A wait of hours or minutes: `5h 12m`, `12m`, `<1m`. */
export function formatWait(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return '<1m';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/**
 * A chess clock: `4:59`, `12:00`, and tenths once it is under ten seconds
 * (`9.4`), because that is when a player starts counting them.
 */
export function formatClock(ms: number): string {
  const left = Math.max(0, ms);
  if (left < 10_000) return (Math.floor(left / 100) / 10).toFixed(1);
  const total = Math.ceil(left / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
