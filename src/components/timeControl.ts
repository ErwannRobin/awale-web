// How a time control is written on screen: "Blitz 3+2", or "Untimed".
import { TIME_CONTROLS, type TimeControlId } from '../lib/protocol.ts';
import type { StringKey } from '../i18n/index.ts';
import type { Translate } from '../i18n/index.ts';

/** Minutes + seconds of increment, the way players say it: `3+2`. */
export function timeControlShort(id: TimeControlId): string {
  const tc = TIME_CONTROLS[id];
  return tc ? `${tc.base / 60_000}+${tc.inc / 1000}` : '∞';
}

export function timeControlLabel(t: Translate, id: TimeControlId): string {
  const name = t(`tc.${id}` as StringKey);
  return id === 'none' ? name : `${name} ${timeControlShort(id)}`;
}
