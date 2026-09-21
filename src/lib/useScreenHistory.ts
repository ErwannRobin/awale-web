import { useCallback, useEffect, useRef, useState } from 'react';
import { ScreenNav } from './navigation.ts';

/** What `useScreenHistory` hands back — the screen, and the three ways to move. */
export interface ScreenHistory<S> {
  screen: S;
  /** Open a screen on top of this one; Back returns here. */
  go: (next: S) => void;
  /** Swap this screen for another; Back skips the one being left. */
  replace: (next: S) => void;
  /** One screen back, or to `fallback` when there is nothing behind us. */
  back: (fallback: S) => void;
  /** True when Back would leave the app — what Android's button asks. */
  atRoot: () => boolean;
}

/**
 * Screen state, with the browser's Back gesture wired to it.
 *
 * Behaves like `useState` for reading, but every move goes through `go`,
 * `replace` or `back` so that `window.history` and the screen showing stay the
 * same story. See `lib/navigation.ts` for why history and not URLs.
 *
 * `hydrate` is applied to screens coming *back* rather than opening — see
 * `ScreenNavOptions`.
 */
export function useScreenHistory<S>(init: () => S, hydrate?: (screen: S) => S): ScreenHistory<S> {
  const [screen, setScreen] = useState<S>(init);

  // The hook is called from a component that re-renders constantly; the stack
  // must outlive that, and must not be rebuilt when `hydrate` changes identity.
  const hydrateRef = useRef(hydrate);
  hydrateRef.current = hydrate;

  const navRef = useRef<ScreenNav<S> | null>(null);
  if (!navRef.current) {
    navRef.current = new ScreenNav<S>({
      history: typeof window === 'undefined' ? null : window.history,
      root: screen,
      onScreen: setScreen,
      hydrate: s => hydrateRef.current?.(s) ?? s,
    });
  }

  useEffect(() => {
    const nav = navRef.current!;
    nav.start();
    const onPop = (e: PopStateEvent) => nav.onPop(e.state);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return {
    screen,
    go: useCallback((next: S) => navRef.current!.go(next), []),
    replace: useCallback((next: S) => navRef.current!.replace(next), []),
    back: useCallback((fallback: S) => navRef.current!.back(fallback), []),
    atRoot: useCallback(() => navRef.current!.atRoot, []),
  };
}
