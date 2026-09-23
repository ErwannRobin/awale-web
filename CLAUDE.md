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

`server/wrangler.toml` deploys the Worker; the live script does not auto-update on merge to
`main` — run the deploy manually (`npm run build` at repo root, then `wrangler deploy` from
`server/`) after merging routing changes, or new endpoints will 404/fall through to the SPA
until someone does.
