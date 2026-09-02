# Awalé

A polished web build of **Awalé** — the classic African seed-sowing strategy game
of the oware / mancala family.

## Play

- **Play vs AI** — four difficulty levels (Novice → Master), backed by a negamax
  search that runs in a Web Worker so the board never blocks.
- **Two players** — pass-and-play on one device; the board flips so the player to
  move always sits at the bottom.
- **Hint** — asks the strongest engine for the best move and pulses that pit.
- **Undo** (vs AI) — restores your previous position.
- **Challenges** — 12 fixed puzzle positions. You play North and move first;
  win one to unlock the next (progress saved in `localStorage`).
- **Tutorial** — a guided 13-step walkthrough with demo moves, a hands-on turn,
  and a short free-play finish.

## Rules

Twelve pits in a circle, six per player, four seeds each (48 total). On your turn
you lift all the seeds from one of your non-empty pits and sow them one by one
counterclockwise, skipping the pit you started from. If your last seed lands in an
opponent pit that then holds 2 or 3 seeds you capture it, sweeping backward through
adjacent 2/3 pits up to four in a row. You must feed a starving opponent when you
can, and you may not capture *every* one of their seeds if another move exists
(the grand-slam rule). First to 25 seeds wins.

## Develop

```bash
npm install
npm run dev       # dev server, exposed on the LAN so a phone can load it
npm run build     # typecheck + production build
npm test          # engine, layout, AI and self-play suites
```

### Structure

| Path | Purpose |
| --- | --- |
| `src/lib/engine.ts` | Board model, move validation, sowing, capture, end-game |
| `src/lib/ai.ts` | Negamax search + difficulty levels |
| `src/lib/ai.worker.ts` | Runs the AI off the main thread |
| `src/lib/aiClient.ts` | Worker wrapper, with an inline fallback where workers don't exist |
| `src/lib/useGame.ts` | Game state machine + seed-by-seed animation |
| `src/lib/layout.ts` | Pit arrangement + the counterclockwise invariant |
| `src/lib/useOrientation.ts` | The one browser-specific piece of the layout |
| `src/lib/storage.ts` | Pluggable key/value persistence |
| `src/lib/progress.ts` | Challenge unlock progress |
| `src/content/challenges.json` | The 12 fixed challenge positions |
| `src/components/` | Menu, Game, Board, Seeds, Learn, Challenges, Tutorial UI |

The engine and AI are a faithful port of a long-standing C implementation; their
rules (including historical quirks) are intentionally preserved verbatim. The
quirks that survive on purpose, and the ones that turned out to be bugs, are
listed in [`AUDIT.md`](AUDIT.md).

### The counterclockwise invariant

Seeds are sown by walking pit indices `0 → 1 → … → 11 → 0`, and that walk **must
read counterclockwise on screen**. Whether it does is decided entirely by where
each index is drawn, so the arrangement lives in `src/lib/layout.ts` and is
asserted by `test/layout.test.ts` — for both viewpoints and both orientations.

A layout that rotates the board *and mirrors it* silently reverses the sowing
direction; that bug shipped once. Never set `flex-direction` on `.board`,
`.pit-grid` or `.pit-row` from CSS — `Board.tsx` sets it from the layout module.

## Native mobile app

The game logic is deliberately platform-free: `src/lib/` has no DOM
dependencies except `useOrientation.ts`, persistence goes through a swappable
`KeyValueStore`, and the AI runs inline when Web Workers are unavailable.

**Progressive web app** — works today. `public/manifest.webmanifest` plus icons
make the built site installable from the browser ("Add to Home Screen"). There
is no service worker yet, so it is not offline-capable.

**Capacitor (iOS + Android)** — `capacitor.config.ts` is already in the repo:

```bash
npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npm run build
npx cap add ios && npx cap add android
npx cap sync
npx cap open ios      # or: npx cap open android
```

The app-shell CSS (safe-area insets, `100dvh`, no rubber-band scroll, no tap
highlight, no double-tap zoom, touch-only hover rules) is already in place, so
the WebView build should not read as a web page in a frame.

**React Native** — `src/lib/` transfers unchanged; only `src/components/` needs
rewriting against `View`/`Pressable`. `useOrientation.ts` carries the swap it
needs (`useWindowDimensions` instead of `matchMedia`) in its doc comment, and
`storage.ts` carries the `@capacitor/preferences` / `AsyncStorage` example.
