# Contributing to Awalé

Thanks for taking an interest. Bug reports, rule questions, translations and
pull requests are all welcome.

## Getting started

```bash
npm install
npm run dev                # the game, on the LAN so a phone can load it
npm run dev:server         # optional: the match server, for online play
```

Node 22 is what CI uses. See the [README](README.md) for the architecture.

## Before opening a pull request

CI runs these on every push, so run them locally first:

```bash
npm run lint
npm run build              # typecheck + production build
npm test
npm run test:e2e           # Playwright; spawns the dev match server
npm run verify:challenges  # only if you touched the challenges or the engine
cd server && npm run typecheck   # only if you touched server/
```

Keep pull requests focused on one change, and describe what you checked by hand
(the board, a phone viewport, online play) as well as what the tests cover.

## Things not to break

- **The rules.** `src/lib/engine.ts` and `src/lib/ai.ts` are a faithful port of
  an older C implementation, and some of its quirks are kept on purpose. Read
  [`AUDIT.md`](AUDIT.md) before "fixing" one of them.
- **Counterclockwise sowing.** The pit layout lives in `src/lib/layout.ts` and
  is asserted by `test/layout.test.ts`. Never set `flex-direction` on `.board`,
  `.pit-grid` or `.pit-row` from CSS.
- **Shared rules.** `src/lib/rules.ts` and `src/lib/roomCore.ts` are imported
  by both the browser and the Worker. Keep them pure and platform-free.
- **Translations.** Every string goes in both `src/i18n/` tables. A missing key
  is a build error, and that is intended.
- **Server routes.** Every public endpoint in `server/src/index.ts` must return
  `corsHeaders(request, env)`, error responses included. See
  [`CLAUDE.md`](CLAUDE.md).
- **Durable Object migrations.** In `server/wrangler.toml`, add a new tag and
  never edit or renumber an existing one.
- **Sound packs.** Never replace a clip's bytes in `public/sounds/v1/`. Add a
  `v2` instead (see the README's Sound section).

## Secrets

Never commit keys. `.env` is gitignored; `.env.example` shows what goes in it.
Server secrets are set with `wrangler secret put`, never in `wrangler.toml`.

## Licence

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
