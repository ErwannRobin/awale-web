# The server

One Cloudflare Worker serves the whole of Awalé: the game itself, and the rooms
people play it in. It holds games in progress and a handful of counters — no
accounts, no database of players, no history of games. A room lives for as long
as two people are in it.

```
GET  /room/:code       WebSocket upgrade into that room
POST /queue            quick match — a code to sit in, or one to walk into
GET  /geo              which country this request came from
POST /stats/game       count one finished game: a level and a country
GET  /stats/countries  the world table
GET  /health           is anybody home
everything else        the built web app, from the ASSETS binding
```

## Countries, without an IP address

Cloudflare resolves the country while it is handling the request, so
`request.cf.country` is the whole of the geolocation here: no third-party
lookup, and the IP is never read, stored, or forwarded. `/geo` hands the browser
those two letters and nothing else; `XX` and `T1` (proxy, Tor) come back as
`ZZ`, "country unknown", which is a bucket rather than a dropped game.

`/stats/game` takes `{ level, country }`. The country in the body wins when it
is a real code — a player may say where they are from — and the request's own
country is the fallback. Both are clamped and validated; nothing else in the
body is read.

What the `Stats` object keeps is counters: a world total, and `{ games, byLevel }`
per country. There is no row per game and no identifier, which is also why a
player who changes country leaves their old games behind: the counter they went
into has no idea who they were, and nothing ever goes back to move them.

The endpoint is open, and nothing stops somebody calling it in a loop — the
price of an anonymous counter is that it can be padded. That is a trade this
game can afford (the number is a curiosity, not a prize); the thing worth
protecting, and what is actually protected, is that there is nothing personal in
there to leak.

**One Worker, not two.** That is not about saving money; it is what makes the
two halves agree. Same origin means the browser finds the match server without
being told where it is (`VITE_ONLINE_URL=same-origin`), there is no CORS to
configure, and a deploy cannot leave a new front end talking to an old server.
`run_worker_first` puts the router ahead of the static assets, so `/room/:code`
reaches a room instead of being served the index page.

## Why Durable Objects

Cloudflare guarantees **one instance per room name, worldwide**, and runs its
handlers one at a time. That removes the two hardest problems in a small
multiplayer service: finding the process that holds a given game, and deciding
what happens when both players act at the same instant. `idFromName(code)` is
the whole of the routing, and single-threading is the whole of the locking.

WebSocket **hibernation** (`state.acceptWebSocket`) lets the runtime evict a
room from memory while its sockets stay open, and wake it on the next message.
That is why the room writes its state to storage rather than keeping it in a
field, and why each socket carries its own identity in `serializeAttachment`.

## The code

| File | What it is |
| --- | --- |
| `src/index.ts` | The router, the matchmaker, and the fall-through to the app |
| `src/room.ts` | One room: sockets in, sockets out, storage, the walkout alarm |
| `src/lobby.ts` | Quick match — one waiting code at a time |
| `src/stats.ts` | The world table: games per country, per difficulty |
| `dev-server.ts` | The same rooms over `ws`, on a laptop |

None of them contain a rule of awalé, and none of them count anything by hand.
The rules live in [`../src/lib/roomCore.ts`](../src/lib/roomCore.ts) and
[`../src/lib/rules.ts`](../src/lib/rules.ts), and the counters in
[`../src/lib/countryStats.ts`](../src/lib/countryStats.ts) — all pure, and all
shared with the browser — so the client and the server cannot disagree about what a move does,
and `../test/online.test.ts` can play whole matches with no cloud account.

## Deploying

**Automatically.** `.github/workflows/deploy.yml` runs on a push to the default
branch: it checks, builds the app with `VITE_ONLINE_URL=same-origin`, deploys
the Worker with `dist/` attached, and then asks `/health` whether the thing it
just shipped answers. Two repository **secrets** are all it needs:

| Secret | Where it comes from |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Workers & Pages overview, right-hand column |

Optionally set a repository **variable** `SITE_URL` to the deployed address
(e.g. `https://awale.<your-subdomain>.workers.dev`). It turns on the post-deploy
health check and makes every run link to the live game.

**By hand**, the first time or to check something:

```bash
npm install
npm run typecheck  # tsc against @cloudflare/workers-types
npm run dev        # wrangler dev — the game and the rooms, on :8787

cd .. && VITE_ONLINE_URL=same-origin npm run build   # the app it will serve
cd server && npm run deploy
npm run tail       # live logs from the deployed Worker
```

`wrangler dev` serves whatever is in `../dist`, so build the app first or you
will get a polite 404 instead of a game.

### Working on the game without deploying

The web app can point at a separate match server instead:

```bash
npm run dev:server                                 # from the repository root
VITE_ONLINE_URL=ws://127.0.0.1:8787 npm run dev    # Vite, with online on
```

A build with **no** `VITE_ONLINE_URL` has no online play at all — no menu entry,
no screens — which is the shape CI builds, and a perfectly good shape to ship if
you would rather not run a server. The native shell needs a real URL rather than
`same-origin`: it loads from `capacitor:`, so there is no origin to borrow.

### Before making it public

`ALLOWED_ORIGINS` in `wrangler.toml` only matters if you also host the front end
somewhere else; a same-origin deploy needs nothing. If you do, name the sites
allowed to use your matchmaker:

```toml
ALLOWED_ORIGINS = "https://awale.example,https://www.awale.example"
```

WebSocket upgrades are not subject to CORS, so this bounds the matchmaker, not
the rooms. Room codes are the only key a room has — see *What this does not
do*, below.

## What the server decides

Everything that matters:

- **Who sits where.** The first two tokens through the door take the two seats.
  A third is refused. A returning token gets its own seat back, which is the
  entire reconnect story.
- **Whether a move is legal.** Every move is replayed through the same engine
  the browser uses. A client that lies is answered with an error, not a board.
- **Whose turn it is**, and whether a message is a real move or a duplicate that
  crossed the opponent's reply (`ply`).
- **When the game is over** — on the board, by resignation, or because someone
  stopped existing.

Each confirmed move carries a fingerprint of the position it produced. Both
sides replay the move on their own engine and compare; a mismatch means one of
them has drifted, and the answer is `resync`, not an argument.

## What this does not do

Worth knowing before it is public:

- **A room code is the whole authorisation model.** Anyone holding the code can
  take a free seat. That is the right security for a game you share by link, and
  it is not more than that. Codes are 5 characters from a 31-letter alphabet
  (~28.6M combinations) and a room only exists while it is being played in.
- **Quick match is one queue, and it is first-come.** No skill matching, no
  regions, no waiting list — the next two people to ask are paired. A code is
  checked against its room before it is handed out, so someone who asks for a
  match and then leaves does not strand the next player; but if nobody else is
  looking for a game, you wait.
- **Nothing is rated, and nothing is stored.** Results do not go anywhere. A
  ladder would need accounts, which would need a real database and a privacy
  policy that says more than "nothing leaves the device".
- **There is no clock.** A player can think for as long as they like. The only
  timer is the 90-second grace period for someone who has disconnected.
