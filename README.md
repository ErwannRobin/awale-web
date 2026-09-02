# Awalé

A polished web build of **Awalé** — the classic African seed-sowing strategy game
of the oware / mancala family.

## Play

- **Quick Match** — one tap, straight into a game against the AI level closest to
  your rating.
- **Play vs AI** — four difficulty levels (Novice → Master), backed by a negamax
  search that runs in a Web Worker so the board never blocks.
- **Two players** — pass-and-play on one device; the board flips so the player to
  move always sits nearest the viewer.
- **Continue** — an in-progress game survives a refresh, a closed tab, or a
  backgrounded app.
- **Hint** — asks the strongest engine for the best move and pulses that pit.
- **Undo** (vs AI) — restores your previous position.
- **Challenges** — 12 fixed puzzle positions, every one machine-verified as
  winnable. You play North and move first; win one to unlock the next.
- **Tutorial** — a guided 13-step walkthrough with demo moves, a hands-on turn,
  and a short free-play finish.

### Progress and settings

- **Rating and ranks** — a local Elo against the four AI levels, with six rank
  bands. Rated free play only; challenges and pass-and-play do not count.
- **Stats and Records** — win rate, streaks, seeds captured, a per-difficulty
  breakdown, your best wins and recent games.
- **Settings** — sound, vibration, animation speed (including *instant*), three
  board themes, seed-count badges, a left-handed layout, and language.
- **English and French**, auto-detected and overridable.
- **Offline** — a service worker caches the whole game; it is installable from
  the browser.

There is **no online play**. That needs a server this build does not have, so the
menu does not pretend otherwise: the trophy screen is *Records — your best
games*, not a global leaderboard.

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
npm run dev                # dev server, exposed on the LAN so a phone can load it
npm run build              # typecheck + production build
npm run lint               # ESLint
npm test                   # engine, layout, AI, state and self-play suites
npm run test:e2e           # Playwright, desktop + phone viewports
npm run verify:challenges  # seed conservation + solvability of the 12 puzzles
```

CI runs all of these on every push (`.github/workflows/ci.yml`).

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
| `src/lib/platform.ts` | Web or native shell — the question every seam asks |
| `src/lib/native.ts` | Native bootstrap: Preferences, status bar, lifecycle |
| `src/lib/notifications.ts` | The local play reminder |
| `src/lib/review.ts` | When to ask for a store rating |
| `src/lib/useBackButton.ts` | Android's back button |
| `src/lib/progress.ts` | Challenge unlock progress |
| `src/lib/settings.ts` | User settings + change subscription |
| `src/lib/stats.ts` | Elo rating, streaks, per-level tallies, ranks |
| `src/lib/profile.ts` | Display name and avatar |
| `src/lib/saveGame.ts` | The resumable in-progress game |
| `src/lib/sound.ts` | Web Audio effects — synthesised, no asset files |
| `src/lib/haptics.ts` | Vibration feedback |
| `src/lib/challenges.ts` | Challenge data + goal-text keys |
| `src/i18n/` | English and French tables, typed so a gap is a build error |
| `src/content/challenges.json` | The 12 fixed challenge positions |
| `src/components/` | Every screen |
| `scripts/verify-challenges.ts` | Proves each puzzle conserves seeds and is winnable |

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

The game logic is platform-free: `src/lib/` has no DOM dependencies except
`useOrientation.ts`, persistence goes through a swappable `KeyValueStore`, and
the AI runs inline when Web Workers are unavailable.

**Progressive web app** — works today. `public/manifest.webmanifest` plus icons
make the built site installable from the browser ("Add to Home Screen"), and
`public/sw.js` caches the app shell and every hashed asset, so the game runs
with no network at all. An e2e test proves it: load, go offline, reload, play.

**Capacitor (iOS + Android)** — the `ios/` and `android/` projects are in the
repo, and `src/lib/native.ts` is the runtime half.

```bash
npm install
npm run build && npx cap sync   # rebuild the web app and copy it into both shells
npx cap open android            # Android Studio
npx cap open ios                # Xcode, on a Mac
```

`npx cap run android -l --external` gives live reload against the Vite dev
server while the app runs on a device.

### What the shell adds

| Concern | On the web | In the shell |
| --- | --- | --- |
| Offline | service worker caches the app shell | every asset ships in the bundle; the worker is skipped |
| Persistence | `localStorage`, which iOS may evict | Preferences (UserDefaults / SharedPreferences) |
| Haptics | Vibration API — Android only | `@capacitor/haptics`, real on both platforms |
| Reminders | — | one local notification, off by default |
| Store rating | — | the in-app review sheet after a win |
| Back button | — | one screen back, and only the menu exits |
| Status bar | `theme-color` | styled to the board's own dark |

`lib/platform.ts` answers "are we native?"; every plugin is behind a dynamic
`import()` in a native-only branch, so a browser build never loads native code.

### Reminders, not push

The reminder is a **local** notification: scheduled on the device, delivered by
the device, working with the network off. Real remote push would need FCM,
APNs, *and a server to send from* — the same thing missing for online play.

- Off by default. Turning the setting on is what triggers the OS permission
  prompt; a refusal leaves the toggle off rather than lying about it.
- Exactly one is ever pending, re-armed whenever the app is opened, closed or
  a game is left, so it always means "you have not played in three days".
- Scheduled inexactly, and `SCHEDULE_EXACT_ALARM` is removed from the merged
  Android manifest — Play restricts that permission to alarm and calendar apps.

### The review prompt

`lib/review.ts` asks for the system rating sheet after a **win** — never a
loss — once the player has won at least three games, at most three times ever
and at least 90 days apart. The stores throttle it further on top of that and
never report whether anything was shown.

There is deliberately no "Rate us" button: on iOS a button that promises a
rating form and then silently does nothing (because the OS throttled it) is a
review rejection. A store deep link is the right control there, and it needs an
App Store id this project does not have yet.

### Before submitting to a store

Code-side work that is done is listed above. These are the parts that need an
account, a Mac, or a decision:

1. **Icons and splash screens.** Both projects still carry the default
   Capacitor artwork. `npx @capacitor/assets generate` builds every size from a
   1024×1024 source; `public/icon.svg` is the design to start from.
2. **`ios/App/App/PrivacyInfo.xcprivacy`** is written but not yet a member of
   the App target — Xcode does not adopt a file it did not create. Drag it into
   the App group and tick the target. It declares no tracking, no collected
   data, and UserDefaults under reason CA92.1.
3. **Bundle id and signing.** `com.awale.game` is a placeholder; a real Apple
   team and a Play upload key are needed.
4. **Store listings** — screenshots, an age rating, and a privacy policy URL.
   The policy is short here: nothing leaves the device.
5. **Guideline 4.2 ("minimum functionality")** rejects thin web wrappers. The
   defence is real — a full offline game, native haptics, no browser chrome —
   but it is worth knowing before the first submission.
6. **The licence.** `engine.ts` and `ai.ts` are a port of a long-standing C
   implementation. If that original carries its own licence it governs a
   published binary too. See `AUDIT.md` §5.4.

**React Native** — `src/lib/` transfers unchanged; only `src/components/` needs
rewriting against `View`/`Pressable`. `useOrientation.ts` carries the swap it
needs (`useWindowDimensions` instead of `matchMedia`) in its doc comment.
