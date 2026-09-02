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

## 4. Native mobile — shipped

The rules, search and game state machine are free of DOM dependencies. The
places that were not are behind seams:

| Concern | Before | Now |
| --- | --- | --- |
| Layout direction | CSS media query | `lib/layout.ts` — pure, tested |
| Screen shape | CSS media query | `lib/useOrientation.ts` — the one browser-specific file |
| Persistence | `localStorage` calls | `lib/storage.ts` — swappable `KeyValueStore` |
| Background search | `new Worker(...)`, no fallback | `lib/aiClient.ts` — inline search where workers do not exist |
| Sound / haptics | — | `lib/sound.ts`, `lib/haptics.ts` |
| Timers | `window.setTimeout` | plain `setTimeout` |

Capacitor was the recommendation, and it is now the build. `ios/` and
`android/` are in the repo; `lib/platform.ts` answers "are we native?" and
every plugin sits behind a dynamic `import()` in a native-only branch, so a
browser build never loads a byte of native code.

What the shell adds on top of the PWA:

- **Persistence** moves to Preferences (UserDefaults / SharedPreferences).
  WKWebView storage is evictable — iOS can clear it under disk pressure — and
  losing a rating and twelve unlocked challenges to a disk cleanup is not a
  bug a player would forgive. `initNative()` hydrates every key into a Map
  before the first render, because the store interface is synchronous and
  screens read progress while rendering.
- **Offline** stops needing the service worker: the shell already has every
  asset on disk, so `registerServiceWorker()` returns early rather than
  installing a second copy of the game.
- **Haptics** become real on iOS. The web Vibration API does not exist in
  Safari, so `hapticWin()` was a no-op on iPhone; it is now a Taptic
  notification.
- **Reminders** — one local notification, off until the player turns it on,
  re-armed for three days out whenever the app is opened, closed or a game is
  left. Local, not push: remote push needs FCM, APNs and a server to send
  from, which is the same thing online play needs and this repo does not have.
- **The review prompt** — the system rating sheet after a win, never a loss,
  gated to at most three asks, 90 days apart, after three wins. No "Rate us"
  button: on iOS that promises a form the OS may silently refuse to show.
- **The Android back button** means one screen back. Left alone it closes the
  app from anywhere, mid-game included — which store reviewers do flag.

Two things worth knowing about the generated projects. `SCHEDULE_EXACT_ALARM`
is merged in by the notifications plugin and is **removed** again in the app
manifest: Play restricts it to alarm and calendar apps, and a three-day nudge
does not need alarm precision. And `ios/App/App/PrivacyInfo.xcprivacy` is
written but not yet a member of the App target — Xcode adopts no file it did
not create itself, so that is one drag in the project navigator.

`test/native.test.ts` pins the two pieces that are pure: when the reminder
fires, and when the review gate opens.

## 5. What is still missing

Short list now, and honest about why.

1. ~~**Online multiplayer.**~~ Built — see §7. What is still missing from it is
   a ladder, and that is the part that genuinely needs accounts and a database.
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
7. **Store artwork.** Both native projects still carry the default Capacitor
   icon and splash. `npx @capacitor/assets generate` builds every size from one
   1024×1024 source; nobody has drawn that source yet.
8. **Remote push.** Only local notifications are wired up. There is a server
   now, but a push server is a different thing: FCM credentials, APNs keys, and
   a store of device tokens that would be the first personal data this project
   has ever kept. "Your opponent moved" is the notification that would justify
   it, and it is not built.

---

---

## 7. Online play

Built after the audit above, against the Cloudflare recommendation in §5.1.

### The choice

WebRTC with PeerJS was considered first and rejected. The usual reason to reach
for it — "no server" — is not true: PeerJS needs a signalling server, and a
share of connections (commonly quoted as 10–20%, worse behind mobile carrier
NAT) need a TURN relay, which is a bandwidth-billed server of its own. Awalé
sends one integer a few times a minute, so WebRTC's actual advantages — latency
and offloaded bandwidth — are worth nothing here, while its costs are real.

A WebSocket relay is the same client work and gives what P2P cannot: it connects
everywhere, it can match strangers, and it can referee. A Durable Object makes
it small — Cloudflare guarantees one instance per room name worldwide and runs
its handlers one at a time, so routing and locking both disappear.

### The shape

```
browser                         Cloudflare
  useGame ── board                 Worker ── /room/:code ── Room (Durable Object)
  online.ts ── one seat              │                        └── roomCore
  wsTransport ── one socket ─────────┘        /queue ──────── Lobby
```

`src/lib/rules.ts` and `src/lib/roomCore.ts` are pure and platform-free, and are
imported by the browser, the Worker, the Node dev server and the tests alike.
That is the point: **the client and the server cannot disagree about what a move
does**, because there is only one implementation of it.

Extracting `rules.ts` also fixed a latent duplication in the client. `useGame`
used to carry its own copy of two end-of-game rules (the 25-seed majority and
the blocked-player payout) alongside `engine.ts`'s. They now live in one place.
The blocked-player disagreement recorded in §3 survives on purpose — the server
follows the rule the game has always shown players, with a comment saying so —
but it is now one rule in one file rather than the same rule written twice.

### The server decides

Both sides run the same engine, so the client *could* referee itself. It does
not. Every move is replayed on the server: legality, turn, and whether the
message is a real move or a duplicate that crossed the opponent's reply (`ply`).
Each confirmation carries an FNV-1a fingerprint of the position it produced; a
client whose own board disagrees asks for the position back rather than playing
on from a board only it can see.

The board waits for that confirmation rather than moving optimistically. One
round trip is shorter than the first seed's hop, and it buys a single source of
truth with no rollback code anywhere.

### What is tested

- `test/online.test.ts` — 29 assertions. Seating, reconnection, turn order,
  illegal and out-of-board moves, double taps, late duplicates, resignation,
  the walkout timer, rematches, and a full greedy game with seeds conserved at
  every ply. Then two real `OnlineSession`s over in-memory pipes playing whole
  games through the actual protocol, plus a deliberately corrupted fingerprint
  to prove drift is noticed and repaired.
- `e2e/online.spec.ts` — two browsers, a real WebSocket to the dev match server,
  a room code travelling by link, the turn passing both ways, and a third
  player turned away from a full room.
- The Worker itself typechecks against `@cloudflare/workers-types` in CI, and
  was run under `wrangler dev` (workerd): two clients seated, moves relayed with
  matching fingerprints, an out-of-turn move refused, a third player refused,
  and a resignation broadcast to both.

One bug the browser test found that no unit test would have: `Game.tsx` decided
"is this a challenge?" by asking whether a `setup` was present. An online game
brings one too — the seat and opening position come from the server — so an
online win announced itself as *"Challenge complete!"*.

### What is deliberately not there

No accounts, no ratings, no stored history, no clock, no ladder. A room code is
the whole authorisation model: anyone holding it can take a free seat, which is
the right security for a game shared by link and is not more than that.

Two known rough edges, both written down in `server/README.md`: a quick-match
code can outlive the player who asked for it, leaving the next player alone in
an empty room for up to two minutes; and there is no reconnect *notification*,
so a player whose opponent drops sees a banner rather than a countdown.

## 6. Verification

```
npm run lint               # ESLint 9 — clean
npm run build              # tsc -b + vite build — clean
npm test                   # 171 assertions across 7 suites + 30 self-play games
npm run verify:challenges  # 12 positions: 0 failures, 1 inconclusive (see §5.2)
npm run test:e2e           # 11 tests × 2 viewports (desktop + phone)
cd server && npm run typecheck   # the Worker, against @cloudflare/workers-types
```

Board geometry, themes and the new screens were also checked by hand in a real
Chromium at 1100×800 and 390×844.
