# The match server

A Cloudflare Worker with two Durable Objects. It is the only server this game
has, and it holds nothing but games in progress: no accounts, no database, no
history. A room lives for as long as two people are playing in it.

```
GET  /room/:code   WebSocket upgrade into that room
POST /queue        quick match — a code to sit in, or one to walk into
GET  /health       is anybody home
```

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
| `src/index.ts` | The router, and the CORS policy for `/queue` |
| `src/room.ts` | One room: sockets in, sockets out, storage, the walkout alarm |
| `src/lobby.ts` | Quick match — one waiting code at a time |
| `dev-server.ts` | The same rooms over `ws`, on a laptop |

None of them contain a rule of awalé. The rules live in
[`../src/lib/roomCore.ts`](../src/lib/roomCore.ts) and
[`../src/lib/rules.ts`](../src/lib/rules.ts), which are pure and shared with the
browser — so the client and the server cannot disagree about what a move does,
and `../test/online.test.ts` can play whole matches with no cloud account.

## Running it

```bash
npm install
npm run dev        # wrangler dev, on http://127.0.0.1:8787
npm run typecheck  # tsc against @cloudflare/workers-types
npm run deploy     # wrangler deploy
npm run tail       # live logs from the deployed Worker
```

The web app needs to be told where the server is, at **build** time:

```bash
# from the repository root
VITE_ONLINE_URL=ws://127.0.0.1:8787 npm run dev
VITE_ONLINE_URL=wss://awale-match.<your-subdomain>.workers.dev npm run build
```

A build without that variable has no online play at all — no menu entry, no
screens — which is the shape CI builds, and a perfectly good shape to ship if
you would rather not run a server.

### Before making it public

Set `ALLOWED_ORIGINS` in `wrangler.toml` to your own site, so a stranger's page
cannot use your matchmaker:

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
- **Quick match can leave you waiting alone.** If the player who asked first
  closes their tab, their code stays in the queue for up to two minutes and the
  next player joins an empty room. Fixing it properly means the lobby asking each
  room whether it is still occupied.
- **Nothing is rated, and nothing is stored.** Results do not go anywhere. A
  ladder would need accounts, which would need a real database and a privacy
  policy that says more than "nothing leaves the device".
- **There is no clock.** A player can think for as long as they like. The only
  timer is the 90-second grace period for someone who has disconnected.
