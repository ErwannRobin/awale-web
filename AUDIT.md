# Awalé — audit

State of the draft, what was fixed in this pass, and what is still missing
before this is a shippable game. Written September 2026 against commit
`a03545d`.

---

## 1. Bugs fixed in this pass

### 1.1 Seeds were sown **clockwise** on phones — fixed

This is the reported gameplay bug, and it only appeared on narrow screens.

The engine sows by walking pit indices `0 → 1 → … → 11 → 0`. Whether that reads
clockwise or counterclockwise depends entirely on where each index is drawn.

On wide screens the arrangement was right: your six pits run left→right along
the bottom, the opponent's run right→left along the top, so the walk goes right
along the bottom, up the right side, left along the top — counterclockwise.

Below 620px a CSS media query rotated the board into two columns:

```css
.pit-grid { flex-direction: row; }   /* opponent column LEFT, yours RIGHT */
.pit-row  { flex-direction: column; }
```

That is a rotation **plus a mirror**. Mirroring reverses circulation: the walk
became "down the right column, up the left" — clockwise. Same engine, opposite
apparent direction, purely from a layout rule.

**Fix.** The pit arrangement moved out of CSS media queries into
`src/lib/layout.ts`, a pure module `Board.tsx` reads for both orientations. It
also exposes `ringWinding()` — the signed area of the pit ring in screen
coordinates — so the invariant is now asserted by `test/layout.test.ts` for both
viewpoints in both orientations, including a case that proves the old mirrored
layout is detected as clockwise. The CSS keeps sizing only, with a comment
saying why it must not set `flex-direction`.

Verified in a real browser: at 390×844 the near column sits at x≈159 and the far
column at x≈231, with your pits 1→6 running top→bottom on the left.

### 1.2 Novice (level 1) played blind — fixed

`value()` carries a deliberate legacy quirk: at the horizon it evaluates the
position **before** applying the candidate move. So at depth 0 or 1, every legal
move scores identically.

The depth clamp read:

```ts
if (this.depths[this.level] > 3 * this.level) this.depths[this.level] = 3 * this.level;
```

For level 0 that is `2 > 0` → depth `0`. Novice therefore scored all moves the
same and chose purely on the `delay2` tie-break — it could not see a capture
sitting in front of it, despite the menu advertising "Greedy — grabs the biggest
capture".

**Fix.** `MIN_DEPTH = 2` floors every level (and re-clamps after the self-tuning
step, which could otherwise drift a level back down). Levels 1–3 are unchanged:
depths 3, 4, 5 as before. `test/ai.test.ts` pins the horizon quirk explicitly
(depth 1 cannot separate moves, depth 2 can) and checks Novice still takes a
free capture after 50 self-tuning rounds.

### 1.3 The AI searched past its own win — fixed

`WINNING_SCORE` (25) was hardcoded in `useGame.ts` and unknown to the search, so
negamax kept expanding lines after a side had already banked the win and could
prefer a larger final margin over winning sooner. The constant now lives in
`engine.ts` and terminates the search.

### 1.4 A dead worker froze the board — fixed

`AIClient` resolved promises only from `onmessage`. A worker that failed to
construct, threw, or was blocked by CSP left the game on "Thinking…" forever
with no recovery. `AIClient` now falls back to running the same search inline
and replays any outstanding request against it. This also makes the client
usable where `Worker` does not exist at all — see §3.

### 1.5 `test/selfplay.test.ts` could never run — fixed

Two problems: `npm test` ran only `engine.test.ts`, and the file crashed on
import anyway (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` — Node's type-stripping
rejects the `constructor(readonly level: number)` parameter property, and the
extension-less `./engine` import does not resolve under Node ESM). Both fixed;
`npm test` now runs engine, layout, AI, and self-play suites — 94 assertions
plus 30 simulated games, all green.

---

## 2. Known engine quirks — deliberately kept

The README calls the engine a faithful port and asks that quirks be preserved. I
have left these alone, but they should be *decisions*, not accidents:

| Quirk | Where | Effect |
| --- | --- | --- |
| Captures capped at 4 pits per move | `engine.ts` `distribute` | Non-standard. Real oware sweeps back as far as the 2/3 chain runs. |
| Horizon evaluates the position *before* the move | `ai.ts` `value` | Costs one ply of real depth at every level. |
| Cyclic-draw check ignores pits 5 and 11 | `engine.ts` `endGame` | `pits.slice(0,5)` / `slice(6,11)` exclude the last pit of each row, so some perpetual cycles are never detected. Self-play only terminates because of a ply cap. |
| `attacksAllSeeds` returns `true` for an empty pit | `engine.ts` | Makes an empty pit count as a "legal alternative" in the grand-slam test. |
| Blocked-player payout differs between code paths | `endGame` cond. 2 gives *everything* to the opponent; `useGame.handleBlocked` gives each side its own row | Two different rules for adjacent situations. |

The last one is the only one I would call a latent bug rather than a flavour
choice.

---

## 3. Portability to a native mobile app

The good news: the rules, the search, and the game state machine were already
free of DOM dependencies. The work in this pass was isolating the four places
that were not, so the core ports unchanged.

| Concern | Before | Now |
| --- | --- | --- |
| Layout direction | CSS media query | `lib/layout.ts` — pure, tested, framework-free |
| Screen shape | CSS media query | `lib/useOrientation.ts` — the single browser-specific file, with the React Native replacement written in its doc comment |
| Persistence | `localStorage` calls in `progress.ts` | `lib/storage.ts` — a 3-method `KeyValueStore` with a `setStore()` seam and an in-memory fallback |
| Background search | `new Worker(...)`, no fallback | `lib/aiClient.ts` — worker where available, identical inline search where not (RN has no Web Workers) |
| Timers | `window.setTimeout` | plain `setTimeout` in `useGame.ts` |

`src/lib/` now imports nothing browser-specific except `useOrientation.ts`.

Two viable paths from here:

**A. Capacitor (days).** Ship the existing React app in a native WebView.
`capacitor.config.ts` is in the repo and the README documents the four commands.
The app-shell CSS this pass added — safe-area insets, `100dvh`, no rubber-band
scroll, no tap highlight, no double-tap zoom, `@media (hover: none)` guards,
`prefers-reduced-motion` — is what makes a WebView stop feeling like a web page.
A PWA manifest and icons are in `public/`, so "Add to Home Screen" also works
today.

**B. React Native (weeks).** `src/lib/` transfers as-is; `src/components/` is
rewritten against `View`/`Pressable`. The board is CSS gradients and absolutely
positioned dots, so it is a real rewrite — but the rules, search, animation
timing and layout geometry all survive.

Recommendation: A now, B only if the store listing needs native performance the
WebView cannot give.

---

## 4. What is still missing

Ranked by how much it stands between this draft and a game people would install.

### Blocking for a release

1. **The menu is mostly promises.** Quick Match, Leaderboards, Stats, Settings,
   Ranks are all `onToast('coming soon')`. The profile chip "Player123 ★1250" is
   hardcoded. Either build them or remove them — a menu of dead buttons reads as
   broken.
2. **No online play.** The single most requested feature for any mancala app and
   the only one requiring a backend (matchmaking, move relay, accounts).
3. **No game persistence.** Refresh, or a phone call in a native shell, loses the
   game. `lib/storage.ts` now gives you the seam; the state to save is
   `{pits, scores, turn, history}`.
4. **No settings at all.** Sound, haptics, animation speed, board theme, and
   left/right-handed board are table stakes on mobile.
5. **No sound or haptics.** A seed-drop tick and a capture chime carry most of
   the feel; `@capacitor/haptics` is one call.

### Quality

6. **Challenge copy is unidiomatic English** ("For this fourth event", "the
   situation is not so bad as it looks like"). It reads like a machine
   translation of the original French. Worth a rewrite, and the strings should be
   externalised for i18n — French and likely Wolof/Bambara matter for this
   audience.
7. **Challenges 8 and 12 start from the standard opening.** Both are just "beat
   level 4", not puzzles, and 12 asks you to blank an opponent from a symmetric
   position. They do not fit the set.
8. **No accessibility beyond pit labels.** No live region announcing moves and
   captures, no keyboard play, no focus-visible styling. Pit labels were improved
   this pass (side, index, seed count, playability) but a screen-reader user
   still cannot follow a sowing.
9. **No stats.** Games played, win rate per level, best challenge streak — cheap
   to add on top of `lib/storage.ts` and it is what brings people back.
10. **Tutorial step 3 demos a South pit** right after telling the player (North)
    to "choose one of your pits". Mildly confusing.
11. **No error boundary.** A render error blanks the screen.

### Engineering

12. **No linter and no CI.** `eslint-disable` comments exist in the source but
    ESLint is not installed and nothing runs on push.
13. **`@playwright/test` is a dependency with zero tests.** The obvious first
    e2e: play a full game at each level, assert the board is never stuck.
14. **No `LICENSE`.** The README describes a port of a long-standing C engine;
    its provenance and licence should be stated.
15. **No service worker.** The manifest makes the app installable but not
    offline-capable, which an offline-by-nature board game should be.

---

## 5. Verification

```
npm run build   # tsc -b + vite build — clean
npm test        # 94 assertions + 30 self-play games — all pass
```

Board geometry was additionally checked in a real Chromium at 1100×800 and
390×844 by reading back the rendered position of every pit.
