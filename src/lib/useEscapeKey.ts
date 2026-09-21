import { useEffect, useRef } from 'react';

/**
 * Escape, the desktop habit for "close this panel".
 *
 * Only wired where closing is harmless — Settings, Help, sign-in. A stray key
 * press must never walk out of a game.
 */
export function useEscapeKey(active: boolean, handler: () => void): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      // `defaultPrevented` leaves room for a control that wants Escape for
      // itself — closing an autocomplete, say — to keep the panel open.
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      ref.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}
