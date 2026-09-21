// Browser history as the app's screen stack.
//
// The game is one page: a screen is React state, not a URL. So a browser Back —
// the desktop arrow, the phone's back gesture, Safari's edge swipe — used to
// leave the site from wherever the player happened to be, mid-game included.
// This module gives every screen change a history entry of its own, so the
// platform's own Back walks exactly the stack the on-screen ← walks, and the
// Android shell's back button (see `useBackButton`) walks it too.
//
// The URL never changes: entries are told apart by their state, not their
// address. Screens are not addressable — a `?join=CODE` invite aside — and
// inventing a path for each one would mean teaching the static host, the
// service worker and the native shell about all of them for nothing the player
// can see.

/** The slice of `window.history` this module uses — so tests can supply one. */
export interface HistoryLike {
  readonly state: unknown;
  pushState(data: unknown, unused: string, url?: string | null): void;
  replaceState(data: unknown, unused: string, url?: string | null): void;
  back(): void;
}

// Namespaced, because `history.state` belongs to the page, not to us: anything
// else that writes it (see `clearJoinCode`) has to be able to keep our keys.
const SCREEN_KEY = 'awaleScreen';
const DEPTH_KEY = 'awaleDepth';

/** What one of our history entries holds. */
export interface NavEntry<S> {
  screen: S;
  /** How many entries we pushed to get here. 0 is the entry the app opened on. */
  depth: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

/** Our keys written onto (a copy of) whatever state the entry already had. */
export function navState<S>(screen: S, depth: number, base?: unknown): Record<string, unknown> {
  return { ...(isRecord(base) ? base : {}), [SCREEN_KEY]: screen, [DEPTH_KEY]: depth };
}

/** Reads one of our entries back, or null for an entry that is not ours. */
export function readNavEntry<S>(state: unknown): NavEntry<S> | null {
  if (!isRecord(state)) return null;
  const screen = state[SCREEN_KEY];
  if (screen === undefined || screen === null) return null;
  const depth = state[DEPTH_KEY];
  return {
    screen: screen as S,
    depth: typeof depth === 'number' && depth > 0 ? Math.floor(depth) : 0,
  };
}

export interface ScreenNavOptions<S> {
  /** `window.history`, or null where there is none (a test, an old WebView). */
  history: HistoryLike | null;
  /** The screen the app opens on — also what a stray entry falls back to. */
  root: S;
  /** Called with every screen change, whichever direction it came from. */
  onScreen: (screen: S) => void;
  /**
   * Last chance to fix up a screen that is being *restored* rather than opened.
   * A game screen, for instance, re-reads the save slot so the board comes back
   * where it was left — the object stored in the entry is a snapshot from when
   * the game started, and by now it is stale.
   */
  hydrate?: (screen: S) => S;
}

/**
 * The screen stack, kept in `window.history`.
 *
 * Forward moves push; back moves ask the browser to go back and let the
 * resulting `popstate` set the screen, so app-driven and gesture-driven Back
 * are the same code path and cannot disagree about where the player is.
 */
export class ScreenNav<S> {
  private readonly history: HistoryLike | null;
  private readonly root: S;
  private readonly onScreen: (screen: S) => void;
  private readonly hydrate: (screen: S) => S;
  private current: S;
  private position = 0;

  constructor(opts: ScreenNavOptions<S>) {
    this.history = opts.history;
    this.root = opts.root;
    this.onScreen = opts.onScreen;
    this.hydrate = opts.hydrate ?? (s => s);
    this.current = opts.root;
  }

  /** The screen showing now. */
  get screen(): S { return this.current; }

  /** How deep into our own stack we are. */
  get depth(): number { return this.position; }

  /** True when there is no entry of ours below this one. */
  get atRoot(): boolean { return this.position === 0; }

  /**
   * Stamps the entry the app opened on, so a Back landing here is recognised
   * as ours. Safe to call twice (React 18 mounts effects twice in dev).
   *
   * A reload keeps both the session history and `history.state`, so the depth
   * of the entry we land on is adopted rather than reset: the entries below are
   * still there, and claiming to be at the root would make our Back and the
   * browser's disagree about how much is behind us.
   */
  start(): void {
    const existing = readNavEntry<S>(this.history?.state);
    if (existing) this.position = existing.depth;
    this.stamp(this.current);
  }

  /** Forward: a new entry, so Back returns to the screen being left. */
  go(next: S): void {
    this.position += 1;
    this.history?.pushState(navState(next, this.position), '');
    this.set(next);
  }

  /** Sideways: same entry, so Back skips the screen being left. */
  replace(next: S): void {
    this.stamp(next);
    this.set(next);
  }

  /**
   * Back: hands over to the browser when there is an entry of ours to return
   * to, so one gesture and one tap do the very same thing.
   *
   * `fallback` covers the case where there is not — a `?join=` link that opened
   * straight into a game, or a reload — where leaving would mean leaving the
   * site. It takes over the current entry instead of adding one, so Back keeps
   * meaning "out", never "round in circles".
   */
  back(fallback: S): void {
    if (this.history && this.position > 0) { this.history.back(); return; }
    this.replace(this.hydrate(fallback));
  }

  /**
   * A `popstate`: the player used Back or Forward. The entry says where they
   * are; an entry that is not ours means they walked out past our first one.
   */
  onPop(state: unknown): void {
    const entry = readNavEntry<S>(state);
    if (!entry) {
      this.position = 0;
      this.replace(this.hydrate(this.root));
      return;
    }
    this.position = entry.depth;
    const screen = this.hydrate(entry.screen);
    // Hydration can answer with a different screen entirely (a saved game that
    // is gone). Write that back, or Forward-then-Back would resurrect it.
    if (screen !== entry.screen) this.stamp(screen);
    this.set(screen);
  }

  private stamp(screen: S): void {
    this.history?.replaceState(navState(screen, this.position, this.history.state), '');
  }

  private set(screen: S): void {
    this.current = screen;
    this.onScreen(screen);
  }
}
