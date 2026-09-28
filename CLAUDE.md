# Awalé

## CORS

Every public endpoint in `server/src/index.ts` must go through `corsHeaders(request, env)`
and include the result in its response headers (see `/health`, `/stats/countries` for the
pattern). Whitelist is `ALLOWED_ORIGINS` in `server/wrangler.toml` — comma-separated origins;
empty string means "allow any origin" (open CORS), used because the game itself is same-origin
and this var exists only for a separately hosted front end or admin/stats tooling.

Any new `GET`/`POST` route added to the router must:
1. Compute `cors` at the top of `fetch()` (already done once per request).
2. Include `...cors` in every `Response` it returns, including error responses.
3. Never fall through to the `ASSETS` fallback for API paths — that branch does not attach
   CORS headers, so a route that isn't matched yet (e.g. after merging code but before
   redeploying) silently serves cached SPA HTML with no CORS headers, which looks like a
   CORS bug from the browser but is actually a stale deploy.

## Deploying

A push to `main` deploys automatically: `.github/workflows/deploy.yml` runs lint, build and
tests, then `wrangler deploy` with `dist/` attached, then checks `/health`. A merge is not
live until that run is green — check `gh run list --workflow deploy.yml`. If it did not run
(e.g. Actions blocked by a GitHub billing problem, which silently skipped the deploys for
#25–#28 in Sept 2026) or failed, new endpoints 404/fall through to the SPA. Deploy by hand in that case:
`npm run build` at repo root, then `npx wrangler deploy` from `server/`, or re-run the
workflow with `gh workflow run deploy.yml`.
