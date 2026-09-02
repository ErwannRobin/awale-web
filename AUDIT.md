# Awalé — audit

What was broken, what got built, and what is still genuinely missing. Written
September 2026, starting from commit `a03545d`.

---

## 1. Bugs found and fixed

### 1.1 Seeds were sown **clockwise** on phones

The reported gameplay bug, and it only appeared on narrow screens.

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
exposes `ringWinding()` — the signed area of the pit ring in screen coordinates
— so the invariant is asserted by `test/layout.test.ts` for both viewpoints in
both orientations, including a case proving the old mirrored layout reads
clockwise. An e2e test measures the same winding from the *rendered* board in a
real browser, at both viewport sizes. CSS keeps sizing only, with a comment
saying why it must not set `flex-direction`.

The new "left-handed layout" setting swaps the **stores** and nothing else, for
exactly this reason — it is documented in the code and in the setting's own help
text.

### 1.2 Novice (level 1) played blind

`value()` carries a legacy quirk: at the horizon it evaluates the position
**before** applying the candidate move. So at depth 0 or 1, every legal move
scores identically.

The depth clamp read:

```ts
if (this.depths[this.level] > 3 * this.level) this.depths[this.level] = 3 * this.level;
```

For level 0 that is `2 > 0` → depth `0`. Novice scored all moves the same and
chose purely on the `delay2` tie-break — it could not see a capture in front of
it, despite the menu advertising "Greedy — grabs the biggest capture".

**Fix.** `MIN_DEPTH = 2` floors every level, re-applied after the self-tuning
step. Levels 2–4 unchanged. `test/ai.test.ts` pins the horizon quirk explicitly
(depth 1 cannot separate moves, depth 2 can) and checks Novice still takes a free
capture after 50 self-tuning rounds.

### 1.3 The AI searched past its own win

`WINNING_SCORE` (25) was hardcoded in `useGame.ts` and unknown to the search, so
negamax kept expanding lines after a side had banked the win and could prefer a
larger final margin over winning sooner. The constant now lives in `engine.ts`
and terminates the search.

### 1.4 A dead worker froze the board

`AIClient` resolved promises only from `onmessage`. A worker that failed to
construct, threw, or was blocked by CSP left the game on "Thinking…" forever.
`AIClient` now replays outstanding requests against an inline search, which also
makes it work where `Worker` does not exist at all (React Native).

### 1.5 Four challenge positions did not conserve seeds

Found while building the verifier, not in the first read-through. The board holds
48 seeds; pits + both stores must total 48. They did not:

| Challenge | Seeds | Fix |
| --- | --- | --- |
| 1 | 45 | South's banked score 0 → 3 |
| 2 | 47 | South's banked score 8 → 9 |
| 4 | 42 | South's banked score 0 → 6 |
| 12 | **71** | position replaced entirely |

Challenge 12 had all twelve pits at 4 (48 seeds) *plus* 23 already banked. That
is 23 seeds that do not exist. `npm run verify:challenges` now fails the build on
any position that does not add up.

### 1.6 `test/selfplay.test.ts` could never run

`npm test` ran only `engine.test.ts`, and the file crashed on import anyway
(`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` — Node's type-stripping rejects a `readonly`
constructor parameter property, and the extension-less `./engine` import does not
resolve under Node ESM).

---

## 2. What was built

Everything that was a `coming soon` toast, plus the rest of the "missing" list.

### Player identity, rating and progress

- **Profile** — editable display name and one of six avatars, replacing the
  hardcoded `Player123 / ★1250`.
- **Rating** — a real Elo, computed locally against fixed strength estimates for
  the four AI levels (900 / 1150 / 1400 / 1650, K = 24). Only free play against
  the AI is rated; challenges and pass-and-play are not.
- **Ranks** — six bands from Seedling to Master, with a progress bar to the next.
- **Stats** — games, win rate, streaks, best streak, seeds captured, best margin,
  a per-difficulty breakdown, and challenge progress.
- **Records** — your five best wins (by margin, then by level beaten) plus the
  last fifteen games with their rating deltas.

There is no server, so "Leaderboard — compete for the top" would have been a lie.
It is **Records — your best games**, and the screen says in as many words that a
global ladder needs an online service this build does not have.

### Play

- **Quick Match** — starts immediately against the AI level closest to your
  rating (`suggestedLevel`).
- **Continue** — an in-progress game (board, scores, turn, and the undo stack) is
  saved on every committed move, so a refresh, a phone call, or a backgrounded
  WebView resumes exactly where you left off. The save is validated on load: a
  blob that does not total 48 seeds is corrupt, not a game, and is discarded.
- Opening Help or Settings mid-game returns to the same board rather than
  dropping it.

### Settings

Sound, vibration, animation speed (slow / normal / fast / **instant**), board
theme (wood / night / sand), seed-count badges, left-handed layout, language,
and three scoped reset actions. Everything persists.

- **Sound** is synthesised with the Web Audio API — a filtered noise burst for a
  seed hitting wood, decaying partials for captures and the endgame. No audio
  files, so nothing to package and nothing to download.
- **Vibration** uses the Vibration API where it exists (Android; iOS Safari has
  none), with the Capacitor Haptics swap written into the file.
- **Themes** are pure CSS token overrides on `[data-theme]`. Every colour in the
  stylesheet is a token; the light "sand" theme flushed out nine hardcoded ivory
  values that were invisible on a light background.

### Reach

- **French**, alongside English, with auto-detection from the browser and a
  manual override. Every UI string is in `src/i18n/`, typed so a missing
  translation is a **build error**, not a runtime blank.
- The challenge copy was rewritten in both languages. The originals read as
  unedited machine translation ("For this fourth event", "the situation is not so
  bad as it looks like").
- **Accessibility** — a polite live region narrates moves, captures, turn changes
  and the result in the player's language; pit labels name the side, index, seed
  count and whether the pit is playable; `:focus-visible` rings for keyboard
  users. An e2e test plays a move with the keyboard alone and asserts the
  announcement.
- **Offline** — a service worker caches the app shell and every hashed asset. An
  e2e test loads the game, goes offline, reloads, and starts a game.

### Engineering

- **ESLint 9** flat config (typescript-eslint + react-hooks), clean.
- **CI** — three GitHub Actions jobs: lint/build/unit, challenge verification,
  and Playwright e2e.
- **9 e2e tests × 2 viewports**, including the counterclockwise winding measured
  from the rendered DOM.
- **`npm run verify:challenges`** — seed conservation and solvability for all
  twelve positions.
- **Error boundary**, so a render bug shows a recovery card instead of a blank page.
- **LICENSE** (see §5).

### Challenges 8 and 12

Both used to start from the standard opening — they were "beat level 4", not
puzzles, and 12 asked you to blank an opponent from a symmetric position with 71
seeds on the board.

Both are now real positions, found by searching for ones the verifier can *prove*
the player wins while not every first move does:

- **8** (level 2) — nineteen seeds behind, the opponent two from victory;
  2 of 5 first moves survive.
- **12** (level 3) — one seed behind, eleven left on the board, against the
  strongest engine; exactly 1 of 4 first moves wins.

**A trap worth recording.** "How many first moves win" is *not* stable under
search budget. A `true` verdict is a proof, so a bigger budget only ever finds
MORE winning moves — a position that looks like a sharp 1-of-5 puzzle at 120k
nodes can be a flat 5-of-5 at 400k. The first candidate for challenge 12 was
exactly that, and the first draft of challenge 8's goal text ("exactly one first
move survives") was wrong for the same reason. Every discrimination claim in the
challenge copy is now checked at two budgets and only kept if it does not move.
The asymmetry between the two verdicts is documented in `scripts/challenges.ts`.

---

## 3. Known engine quirks — deliberately kept

The README calls the engine a faithful port and asks that quirks be preserved.
These are left alone, but they should be *decisions*, not accidents:

| Quirk | Where | Effect |
| --- | --- | --- |
| Captures capped at 4 pits per move | `engine.ts` `distribute` | Non-standard. Real oware sweeps back as far as the 2/3 chain runs. |
| Horizon evaluates the position *before* the move | `ai.ts` `value` | Costs one ply of real depth at every level. |
| Cyclic-draw check ignores pits 5 and 11 | `engine.ts` `endGame` | `slice(0,5)` / `slice(6,11)` exclude the last pit of each row, so some perpetual cycles are never detected. |
| `attacksAllSeeds` returns `true` for an empty pit | `engine.ts` | Makes an empty pit count as a "legal alternative" in the grand-slam test. |
| Blocked-player payout differs between code paths | `endGame` cond. 2 gives *everything* to the opponent; `useGame.handleBlocked` gives each side its own row | Two different rules for adjacent situations. |

The last one is the only one I would call a latent bug rather than a flavour
choice. `scripts/challenges.ts` deliberately mirrors `useGame`'s version, with a
comment, so the verifier and the game agree.

---

## 4. Native mobile

The rules, search and game state machine are free of DOM dependencies. The four
places that were not are now behind seams:

| Concern | Before | Now |
| --- | --- | --- |
| Layout direction | CSS media query | `lib/layout.ts` — pure, tested |
| Screen shape | CSS media query | `lib/useOrientation.ts` — the one browser-specific file, RN replacement in its doc comment |
| Persistence | `localStorage` calls | `lib/storage.ts` — swappable `KeyValueStore`, Capacitor Preferences example in the file |
| Background search | `new Worker(...)`, no fallback | `lib/aiClient.ts` — inline search where workers do not exist |
| Sound / haptics | — | `lib/sound.ts`, `lib/haptics.ts`, each a four-function surface with the native swap documented |
| Timers | `window.setTimeout` | plain `setTimeout` |

Plus app-shell CSS (safe-area insets, `100dvh`, no rubber-band scroll, no tap
highlight, no double-tap zoom, `@media (hover: none)` guards,
`prefers-reduced-motion`), a PWA manifest with icons, and `capacitor.config.ts`.

Recommendation: **Capacitor** (days). React Native only if a store listing needs
performance a WebView cannot give — `src/lib/` would transfer unchanged, but
`src/components/` is a real rewrite.

---

## 5. What is still missing

Short list now, and honest about why.

1. **Online multiplayer.** Not built, and not buildable in this repo: it needs a
   server for matchmaking, move relay and accounts. Everything else on the
   original list is client-side and is done. The menu no longer promises it.
2. **Challenge 4 is unverified.** Its position leaves 36 seeds on the player's
   row, so the solver cannot exhaust the tree within a sane budget. The verifier
   reports it as *inconclusive* — a warning, not a failure — because a "no win
   found" under a node cap is not proof of unwinnability (see the asymmetry note
   in `scripts/challenges.ts`). The other eleven are proved solvable.
3. **The rating is local and self-referential.** It measures you against four
   fixed AI levels on one device. That is what the Stats screen says.
4. **The `LICENSE` is a guess.** MIT, copyright Erwann Robin. The README
   describes the engine as a port of a long-standing C implementation; if that
   original carries its own licence, it governs `engine.ts` and `ai.ts` and the
   file should be amended. **This is the one item that needs your decision.**
5. **No analytics or crash reporting.** Deliberate — there is no backend and
   nothing leaves the device. The error boundary logs to the console.
6. **Sound is synthesised, not sampled.** It reads as a game, not as a recording
   of a real board. Real samples would sound better at the cost of bundle size.

---

## 6. Verification

```
npm run lint               # ESLint 9 — clean
npm run build              # tsc -b + vite build — clean
npm test                   # 135 assertions across 5 suites + 30 self-play games
npm run verify:challenges   # 12 positions: 0 failures, 1 inconclusive (see §5.2)
npm run test:e2e           # 9 tests × 2 viewports (desktop + phone)
```

Board geometry, themes and the new screens were also checked by hand in a real
Chromium at 1100×800 and 390×844.
