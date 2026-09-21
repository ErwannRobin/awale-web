# Awalé

A polished web build of **Awalé** — the classic African seed-sowing strategy game
of the oware / mancala family.

## Play

- **Quick Match** — one tap, straight into a game against the AI level closest to
  your rating.
- **Play vs AI** — four difficulty levels (Novice → Master), backed by a negamax
  search that runs in a Web Worker so the board never blocks.
- **Play online** — a real opponent, by invite link or quick match. Needs the
  match server in [`server/`](server/); a build without it has no online play
  and says so by simply not offering it.
- **Two players** — pass-and-play on one device; the board flips so the player to
  move always sits nearest the viewer.
- **Continue** — an in-progress game survives a refresh, a closed tab, or a
  backgrounded app.
- **Move preview** — hover a pit (mouse) or hold one (touch) and the board
  marks the hole that move's last seed would land in. Just that hole: drawing
  the whole sowing would make a glance into arithmetic. Both rows answer —
  reading the opponent's threats is half of awalé — though their row is still
  not yours to play. Holding and sliding walks the preview from pit to pit;
  lifting your finger plays nothing.
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

There is **no leaderboard**. Online games are unrated: your rating measures you
against the four AI levels on this device, and a stranger cannot move it. A
global ladder needs accounts and a database, which this server deliberately does
not have — so the trophy screen is *Records — your best games*.

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
npm test                   # engine, layout, AI, state, online and self-play suites
npm run test:e2e           # Playwright, desktop + phone viewports (spawns the
                           # dev match server, and plays a game in two browsers)
npm run verify:challenges  # seed conservation + solvability of the 12 puzzles

npm run sounds:generate    # regenerate the seed sample pack — needs an
                           # ELEVENLABS_API_KEY in .env, see the Sound section
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
| `src/lib/rules.ts` | One move start to finish — shared by the board and the server |
| `src/lib/preview.ts` | Where a move's last seed lands — the hover/hold preview |
| `src/lib/useOrientation.ts` | The one browser-specific piece of the layout |
| `src/lib/storage.ts` | Pluggable key/value persistence |
| `src/lib/platform.ts` | Web or native shell — the question every seam asks |
| `src/lib/native.ts` | Native bootstrap: Preferences, status bar, lifecycle |
| `src/lib/notifications.ts` | The local play reminder |
| `src/lib/review.ts` | When to ask for a store rating |
| `src/lib/useBackButton.ts` | Android's back button |
| `src/lib/progress.ts` | Challenge unlock progress |
| `src/lib/protocol.ts` | The wire format, and every message validated on arrival |
| `src/lib/roomCore.ts` | A match as pure functions — the server's rules |
| `src/lib/transport.ts` | The two-way string pipe an online session talks through |
| `src/lib/wsTransport.ts` | The browser WebSocket, and its reconnect backoff |
| `src/lib/online.ts` | One seat in one room: the client conversation |
| `src/lib/useOnlineSession.ts` | Where the match meets the board |
| `src/lib/onlineConfig.ts` | Server URL, seat token, invite links |
| `src/lib/settings.ts` | User settings + change subscription |
| `src/lib/stats.ts` | Elo rating, streaks, per-level tallies, ranks |
| `src/lib/profile.ts` | Display name and avatar |
| `src/lib/saveGame.ts` | The resumable in-progress game |
| `src/lib/sound.ts` | Web Audio effects — recorded seed samples, synthesised fallback |
| `src/lib/haptics.ts` | Vibration feedback |
| `src/lib/challenges.ts` | Challenge data + goal-text keys |
| `src/i18n/` | English and French tables, typed so a gap is a build error |
| `src/content/challenges.json` | The 12 fixed challenge positions |
| `src/components/` | Every screen |
| `server/` | The Cloudflare Worker — see [`server/README.md`](server/README.md) |
| `scripts/verify-challenges.ts` | Proves each puzzle conserves seeds and is winnable |
| `scripts/gen-sounds.ts` | Generates the seed sample pack (ElevenLabs) |
| `public/sounds/v1/` | The sample pack itself — versioned, see below |

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

### Sound

Two layers, in `src/lib/sound.ts`:

1. **A recorded sample pack** in `public/sounds/v1/` — six single-seed drops,
   four drops onto seeds already in the pit, two capture scoops, one tap. Which
   clip plays depends on how full the destination pit is, and each is given a
   small random gain and playback-rate shift so no two drops are identical.
2. **Synthesis**, used whenever a clip is not available: before the pack has
   finished decoding, in a build shipped without one, or for a clip that failed
   to load. A drop is modelled as a shell click, a wood contact and two damped
   modes of the pit body, all randomised.

Everything runs through one bus — gain, compressor, soft limiter — which is
what lets the levels be loud without clipping when sounds overlap.

To regenerate the pack you need an [ElevenLabs](https://elevenlabs.io) key.
Copy `.env.example` to `.env` and put it in `ELEVENLABS_API_KEY=` there — `.env`
is gitignored, and `npm run sounds:generate` loads it automatically (Node's
`--env-file-if-exists`, no dependency). Or pass it inline instead:

```bash
cp .env.example .env && $EDITOR .env      # once — key lives here from now on

npm run sounds:generate                                   # all clips
npm run sounds:generate -- scoop-1                        # just one

ELEVENLABS_API_KEY=... npm run sounds:generate             # or skip .env entirely
```

The prompts, durations and normalisation live in `scripts/gen-sounds.ts`, so a
pack is reproducible rather than a pile of files nobody can regenerate. Check
the licence terms of your ElevenLabs plan before shipping generated audio.

**A new pack is a new version.** The clip names are fixed and the service worker
caches by URL, so replacing the bytes at `/sounds/v1/drop-1.wav` would serve
stale audio to anyone who already has it. Add `v2` instead, and update
`PACK_DIR` in `sound.ts` and `SOUNDS` in `public/sw.js` together.

There are two layers of caching to know about here, and only one of them a
version bump fixes:

- **The service worker's own Cache Storage** — once a browser has installed it,
  cache-first means a hit is served without ever looking at the network again,
  headers or no headers. Only a new URL (i.e. bumping the version) reaches an
  existing install. This is what the rule above is for.
- **The CDN edge** (`vercel.json` / `public/_headers`) — both set
  `must-revalidate` on `/sounds/*`, so replacing a clip's bytes at the *same*
  URL reaches every visitor who hasn't cached it yet, including a fresh
  browser with no service worker installed. Without this, a fresh browser can
  still hear a stale clip, because it's the CDN's copy that's stale, not
  anything client-side — clearing cache or opening a private window doesn't
  help, since the browser was never the one holding it.

## Online play

Two people, one board, over a WebSocket. **One** Cloudflare Worker in
[`server/`](server/) serves both the game and the rooms — one Durable Object per
room. Same origin, so the browser finds the match server without being told
where it is, and a deploy cannot leave a new front end talking to an old server.

```bash
npm run dev:server                                 # the match server, on :8787
VITE_ONLINE_URL=ws://127.0.0.1:8787 npm run dev    # the game, pointed at it
```

Online play is **off unless `VITE_ONLINE_URL` is set at build time**. Without it
the menu entry never appears, nothing in the online stack is reachable, and the
rest of the game is untouched — which is how CI builds it. A deploy sets it to
the literal `same-origin`.

### How a game happens

- **Invite a friend** gives you a five-character room code and a link. The room
  comes into being when the first player connects to it; there is no "create"
  request to fail.
- **Quick match** asks the lobby for a code — either a fresh one to wait in, or
  one someone else is already waiting in.
- A `?join=CODE` link opens straight into that room rather than the menu.

### The server is the judge

Both players run the same engine, so a client *could* referee itself. It does
not. Every move is replayed on the server, which decides whether it was legal,
whether it was your turn, and whether it was a real move or a duplicate that
crossed the opponent's reply. A move is confirmed with a fingerprint of the
position it produced; if a client's own board does not match, it asks for the
position back instead of playing on from a board only it can see.

The rules live in [`src/lib/rules.ts`](src/lib/rules.ts) and
[`src/lib/roomCore.ts`](src/lib/roomCore.ts) — pure, platform-free, and imported
by the browser, the Worker and the tests alike, so the two sides cannot drift
apart on what a move means.

### The things that go wrong

- **A dropped connection** reconnects with backoff and walks back into its own
  seat: the board is rebuilt from the server's position, not restarted.
- **A player who does not come back** loses the game after 90 seconds. Somebody
  has to tell the person still watching the board.
- **Resigning** asks once, because it is one tap from ending the game.
- **A rematch** needs both players, and the other side opens — moving first is a
  real edge in awalé.

### What it is not

No ratings, no stored history, no clock, and no ladder. A room code is still the
whole authorisation model for a room: anyone holding it can take a free seat,
which is right for a game shared by link and is not more than that. The
trade-offs are written down in [`server/README.md`](server/README.md).

## Signing in

Optional, and it buys one thing: an identity that is not this browser. Signed
in, your display name and your seat follow you to another device, and a seat is
proved by a token nobody else can forge. Signed out, everything works exactly as
it did before there were accounts — which is also what happens when no API key
is deployed.

Identity comes from [phone-verif.com](https://phone-verif.com/integration-guide):
the player answers a pre-written WhatsApp message, and the service returns a
stable `user_id` for that number, registering it the first time it sees it
(`flow=login`). The game never sees the phone number and never stores one.

**Nothing of phone-verif's runs in the page.** There is no embed, no frame and
no script of theirs; the sign-in screen is the game's own. The Worker calls the
API with the key, hands the browser a `wa.me` link and a session id, and the
browser opens the one and polls on the other.

```
POST /auth/start    begin a sign-in; returns the WhatsApp link and the embed URL
GET  /auth/status   has it happened yet; returns our own signed session token
POST /auth/webhook  phone-verif saying it has; HMAC-SHA256 verified before it is read
GET  /auth/me       who this token is
POST /auth/name     change the display name
```

**The API key never leaves the Worker**, and neither does the decision about who
somebody is. The browser starts a sign-in, is shown the WhatsApp step, and then
asks *us* whether it worked; we ask phone-verif. The page is never in a position
to declare its own sign-in successful — the most it can do is keep asking — and
the only thing that seats a player is a token signed with a key it has never
seen.

Session tokens are HMAC-SHA256 over a small JSON payload, valid for 30 days. The
signing key is derived from the API key with HKDF, so there is one secret to
deploy rather than two — and rotating the API key signs everybody out, which is
what a rotation is for. Set `AUTH_SESSION_SECRET` instead when sessions should
outlive a rotation.

### Turning it on

```bash
cd server && npx wrangler secret put PHONE_VERIF_API_KEY
```

That is the whole of it when the Worker also serves the game. Hosting the front
end somewhere else needs one more thing, so that WhatsApp sends players back to
the right place:

```toml
# server/wrangler.toml
PUBLIC_APP_URL = "https://awale-web.vercel.app"
```

In production, point phone-verif's webhook at `/auth/webhook`; the polling path
works with or without it, and the two agree in either order.

`PHONE_VERIF_API_BASE` overrides the API address, for a sandbox or for a stub
under test.

### How often we ask

The browser polls `/auth/status` while it waits, backing off from two seconds to
twelve and giving up after ten minutes. The Worker does **not** pass those polls
on: the session's Durable Object hands out a turn at most every three seconds,
and every poll in between is answered from the record it already holds.

That matters because a rate-limited 429 and a sign-in that has not happened yet
look identical from the browser. Without the throttle, a screen left open turns
into a request every two seconds, earns a rate limit, and then waits forever on
an answer that is never coming.

## Deploying

A push to the default branch ships the game.
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs the checks,
builds the app, deploys the Worker with `dist/` attached, and then asks
`/health` whether what it just shipped answers. One deploy, because the game and
the match server are one Worker — there is no window in which the two halves
disagree.

Set two repository secrets and it runs itself:

| Secret | Where it comes from |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → **Edit Cloudflare Workers** |
| `CLOUDFLARE_ACCOUNT_ID` | Workers & Pages overview, right-hand column |

Optionally add a repository *variable* `SITE_URL` pointing at the deployed
address: it enables the post-deploy health check and links each run to the live
game. The first deploy can also be done by hand — see
[`server/README.md`](server/README.md).

### The Vercel mirror

The game is also published at <https://awale-web.vercel.app> by Vercel's own Git
integration — a push deploys it, with no workflow of ours involved. That copy is
the front end only: there is no Worker runtime behind it, so
[`vercel.json`](vercel.json) points the build at the deployed Worker rather than
at its own origin.

```json
"build": { "env": { "VITE_ONLINE_URL": "https://awale.erwann-robin.workers.dev" } }
```

Same-origin is still the shape the Cloudflare deploy uses, and it is still the
safer one — see [`src/lib/onlineConfig.ts`](src/lib/onlineConfig.ts). A separate
host means a front end can outlive the server it was built against, so the URL
above has to be kept true by hand. The Worker accepts the cross-origin call:
`ALLOWED_ORIGINS` in [`server/wrangler.toml`](server/wrangler.toml) is empty,
which allows any origin, and `PUBLIC_APP_URL` already names the Vercel address so
sign-in lands back there.

Two settings live in the Vercel dashboard and not in this repository, and both
will serve a stale site while still reporting every deploy as a success:
**Settings → Git → Production Branch** must be `main`, and **Settings → Domains**
must have `awale-web.vercel.app` assigned to production. A production branch that
was set to a feature branch, then deleted, leaves every later push deploying as a
*preview* — green ticks on GitHub, an unchanged site.

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

Online play needs no native work beyond one setting: the shell already has a
WebSocket and the whole stack sits in `src/lib/`, but a native build cannot use
`VITE_ONLINE_URL=same-origin` — it loads from `capacitor:`, so there is no
origin to borrow. Build the shell with the deployed URL instead:

```bash
VITE_ONLINE_URL=wss://awale.<your-subdomain>.workers.dev npm run build && npx cap sync
```

**React Native** — `src/lib/` transfers unchanged; only `src/components/` needs
rewriting against `View`/`Pressable`. `useOrientation.ts` carries the swap it
needs (`useWindowDimensions` instead of `matchMedia`) in its doc comment.
