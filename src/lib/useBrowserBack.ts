import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * The browser's Back button — and, on a phone, the back swipe.
 *
 * The app has no router: `App.tsx` keeps the current screen in state, so
 * nothing is written to the address bar and Back would otherwise leave the
 * site from anywhere, including mid-game. We therefore keep exactly ONE spare
 * history entry on the stack while a screen other than the menu is showing.
 * Back consumes it, `handler` steps one screen back, and the effect lays a
 * fresh entry down unless we have reached the menu — where no entry is held,
 * so Back leaves the site on the first press, as a player expects.
 *
 * `active` is "there is somewhere to go back to".
 */
export function useBrowserBack(active: boolean, handler: () => void): void {
  // Kept in a ref so the listener is registered once, not on every render.
  const ref = useRef(handler);
  ref.current = handler;
  /** True while our spare entry is on the stack. */
  const ours = useRef(false);
  /** Set when WE call `back()` to tidy up, so that pop is not read as a press. */
  const tidying = useRef(false);

  useEffect(() => {
    const onPop = () => {
      if (tidying.current) { tidying.current = false; return; }
      // Not our entry: something else put it there, so let the browser have it.
      if (!ours.current) return;
      ours.current = false;
      ref.current();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Deliberately on every render rather than on a change of `active`: a Back
  // press that lands on another inner screen leaves `active` true while the
  // entry it just consumed is gone, and that spare has to be laid down again.
  // The refs make the work a comparison in every other case.
  //
  // Layout, not effect, so the entry is back on the stack before the new
  // screen is painted. A plain effect runs after the paint, which leaves a
  // frame in which the screen is showing with nothing behind it to go back to.
  useLayoutEffect(() => {
    if (active && !ours.current) {
      ours.current = true;
      history.pushState({ awaleBack: true }, '');
    } else if (!active && ours.current) {
      // Left by another route — the ← button, a finished game. Hand the spare
      // entry back, or Back at the menu would do nothing on its first press.
      ours.current = false;
      tidying.current = true;
      history.back();
    }
  });
}
