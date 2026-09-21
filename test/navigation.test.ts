// The screen stack that makes the browser's Back gesture mean "one screen
// back" (src/lib/navigation.ts).
//
// `ScreenNav` talks to `window.history` through a tiny interface for exactly
// this reason: a fake one here behaves like the real thing — entries, a cursor,
// a forward tail that a push discards — without a browser. The one liberty
// taken is that `back()` delivers its popstate synchronously.
import assert from 'node:assert/strict';
import {
  ScreenNav,
  navState,
  readNavEntry,
  type HistoryLike,
} from '../src/lib/navigation.ts';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

type Screen = { name: string; n?: number };

class FakeHistory implements HistoryLike {
  entries: unknown[] = [null];   // the entry the document loaded on
  index = 0;
  /** Set when Back was asked for with nothing of ours left — a real one leaves. */
  left = false;
  onPop: (state: unknown) => void = () => {};

  get state(): unknown { return this.entries[this.index]; }

  pushState(data: unknown): void {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(data);
    this.index += 1;
  }

  replaceState(data: unknown): void { this.entries[this.index] = data; }

  back(): void {
    if (this.index === 0) { this.left = true; return; }
    this.index -= 1;
    this.onPop(this.state);
  }

  forward(): void {
    if (this.index >= this.entries.length - 1) return;
    this.index += 1;
    this.onPop(this.state);
  }
}

/** A started nav over a fresh fake history, with the screen it last showed. */
function setup(root: Screen = { name: 'menu' }, hydrate?: (s: Screen) => Screen) {
  const history = new FakeHistory();
  const seen: Screen[] = [];
  const nav = new ScreenNav<Screen>({
    history,
    root,
    onScreen: s => seen.push(s),
    hydrate,
  });
  history.onPop = state => nav.onPop(state);
  nav.start();
  return { history, nav, seen, at: () => nav.screen };
}

console.log('history entries');

check('the opening screen claims the entry it loaded on', () => {
  const { history, nav } = setup();
  assert.equal(nav.depth, 0);
  assert.equal(history.entries.length, 1, 'opening a screen must not add an entry');
  assert.deepEqual(readNavEntry<Screen>(history.state), { screen: { name: 'menu' }, depth: 0 });
});

check('going forward pushes one entry per screen', () => {
  const { history, nav } = setup();
  nav.go({ name: 'game' });
  nav.go({ name: 'settings' });
  assert.equal(history.entries.length, 3);
  assert.equal(nav.depth, 2);
  assert.equal(nav.atRoot, false);
});

check('replace swaps the screen without deepening the stack', () => {
  const { history, nav } = setup();
  nav.go({ name: 'challenge', n: 1 });
  nav.replace({ name: 'challenge', n: 2 });
  assert.equal(history.entries.length, 2);
  assert.equal(nav.depth, 1);
  history.back();
  assert.deepEqual(nav.screen, { name: 'menu' }, 'a replaced screen is not a stop on the way back');
});

console.log('going back');

check('the browser Back walks the screens it came through', () => {
  const { history, nav } = setup();
  nav.go({ name: 'game' });
  nav.go({ name: 'settings' });
  history.back();
  assert.deepEqual(nav.screen, { name: 'game' });
  assert.equal(nav.depth, 1);
  history.back();
  assert.deepEqual(nav.screen, { name: 'menu' });
  assert.equal(nav.atRoot, true);
});

check('the app asking to go back is the same move as the gesture', () => {
  const { history, nav } = setup();
  nav.go({ name: 'game' });
  nav.go({ name: 'settings' });
  nav.back({ name: 'menu' });       // the ← on the settings screen
  assert.deepEqual(nav.screen, { name: 'game' });
  assert.equal(history.index, 1, 'back must pop the entry, not push another');
});

check('Forward returns to the screen Back left', () => {
  const { history, nav } = setup();
  nav.go({ name: 'game' });
  history.back();
  history.forward();
  assert.deepEqual(nav.screen, { name: 'game' });
  assert.equal(nav.depth, 1);
});

check('back from the first screen falls back instead of leaving', () => {
  // What a `?join=CODE` link does: it opens on the game, not on the menu.
  const { history, nav } = setup({ name: 'onlineGame' });
  nav.back({ name: 'menu' });
  assert.deepEqual(nav.screen, { name: 'menu' });
  assert.equal(history.left, false, 'the player asked to leave the game, not the site');
  assert.equal(history.entries.length, 1, 'the fallback takes over the entry');
  assert.equal(nav.atRoot, true);
});

console.log('restoring a screen');

check('a screen coming back is hydrated, and the entry updated', () => {
  const hydrate = (s: Screen): Screen => (s.name === 'game' ? { name: 'game', n: 7 } : s);
  const { history, nav } = setup({ name: 'menu' }, hydrate);
  nav.go({ name: 'game', n: 1 });
  nav.go({ name: 'settings' });
  history.back();
  assert.deepEqual(nav.screen, { name: 'game', n: 7 }, 'stale snapshot must be refreshed');
  assert.deepEqual(readNavEntry<Screen>(history.state)?.screen, { name: 'game', n: 7 });
});

check('hydration may send the player elsewhere entirely', () => {
  // The saved game is gone: the board it points at no longer exists.
  const hydrate = (s: Screen): Screen => (s.name === 'game' ? { name: 'menu' } : s);
  const { history, nav } = setup({ name: 'menu' }, hydrate);
  nav.go({ name: 'game' });
  nav.go({ name: 'settings' });
  history.back();
  assert.deepEqual(nav.screen, { name: 'menu' });
  // Rewritten, so Forward-then-Back cannot resurrect the dead game.
  assert.deepEqual(readNavEntry<Screen>(history.state)?.screen, { name: 'menu' });
});

check('a foreign entry is the bottom of the stack', () => {
  const { nav } = setup();
  nav.go({ name: 'game' });
  nav.onPop(null);
  assert.deepEqual(nav.screen, { name: 'menu' });
  assert.equal(nav.atRoot, true);
});

check('a reload keeps the depth of the entry it lands on', () => {
  const { history, nav } = setup();
  nav.go({ name: 'game' });
  nav.go({ name: 'settings' });

  // Same session history, new document: state survives, the nav does not.
  const fresh = new ScreenNav<Screen>({ history, root: { name: 'menu' }, onScreen: () => {} });
  history.onPop = state => fresh.onPop(state);
  fresh.start();
  assert.equal(fresh.depth, 2, 'the entries below are still there to go back to');
  history.back();
  assert.deepEqual(fresh.screen, { name: 'game' });
});

console.log('entry state');

check('our keys ride alongside whatever else the entry holds', () => {
  // `clearJoinCode()` rewrites the address and hands the old state straight
  // back; anything it kept has to survive our writing over it.
  const state = navState({ name: 'menu' }, 0, { someoneElse: true });
  assert.equal(state.someoneElse, true);
  assert.deepEqual(readNavEntry<Screen>(state), { screen: { name: 'menu' }, depth: 0 });
});

check('state that is not ours reads as nothing', () => {
  assert.equal(readNavEntry(null), null);
  assert.equal(readNavEntry('scroll-position'), null);
  assert.equal(readNavEntry({ other: 1 }), null);
});

console.log(`\n${passed} checks passed`);
