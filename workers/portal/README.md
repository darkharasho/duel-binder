# duel-binder-portal

One Cloudflare Worker serves three hosts:

- `duelbinder.com`: the marketing page, rendered in `src/site/` from the latest GitHub release, plus the static files in `site/`.
- `www.duelbinder.com`: a 301 redirect to the apex, keeping the path and query.
- `app.duelbinder.com`: the API and sign-in. These run in the `Store` Durable Object, which holds the catalog and every user's collection. A signed-in visitor to `/` gets the web app (the built renderer), and `/app/*` serves its files straight from assets. Card images are served by `/img/...` routes, backed by the `IMAGES` R2 bucket (`duel-binder-images`, which must exist before deploying).

## Configuration

Vars live in `wrangler.toml`: `SITE_URL`, `PUBLIC_URL`, `DISCORD_CLIENT_ID` and `PRICE_WORKER_URL`.

`PRICE_WORKER_URL` is the eBay price Worker (`https://ygo-ebay-prices.project96.workers.dev`) the price alarm asks. Set it to `""` to turn server pricing off. The calls go through the `PRICES` service binding (`[[services]]`, service `ygo-ebay-prices`). A plain `fetch` from one Worker to another Worker's `workers.dev` URL on the same account can fail with Cloudflare error 1042. The binding ignores the host, so `PRICE_WORKER_URL` is still used as the URL base. The `ygo-ebay-prices` Worker must already be deployed before this Worker deploys. Tests replace it with a stub, set up in `vitest.config.mts`.

Secrets are set with `npx wrangler secret put <NAME>`. Pipe the value in so it is never echoed.

| Secret | Purpose |
| --- | --- |
| `DISCORD_CLIENT_SECRET` | Discord OAuth. Redirects: `https://app.duelbinder.com/auth/discord/callback` and `https://duel-binder-portal.project96.workers.dev/auth/discord/callback` |
| `ADMIN_TOKEN` | Bearer token for `/admin/*`. The same value is stored as the GitHub secret `PORTAL_ADMIN_TOKEN` and locally as `PORTAL_ADMIN_TOKEN` in `.env` |
| `GITHUB_TOKEN` (optional) | Fine-grained PAT with read-only access to public repositories. It raises the GitHub API limit for the download links from 60 to 5,000 an hour |

The GitHub repo variable `PORTAL_URL` (`https://app.duelbinder.com`) tells `.github/workflows/catalog.yml` where to post the catalog.

## Commands

```bash
npm test && npm run typecheck   # from workers/portal
npx wrangler dev --var SITE_URL:http://localhost:8787 --local-upstream localhost:8787
npm run deploy                  # builds the web app (npm run build:web at the repo root) into site/app/, then wrangler deploy
```

The web build goes to `site/app/`, which is git-ignored. Build it before `wrangler dev` too, or the signed-in front page falls back to the placeholder.

`wrangler dev` sends every request to the first custom domain. `--local-upstream` makes `localhost` serve the marketing page instead.

## Desktop sign-in and sync

The desktop app signs in through the browser. It stores a long-lived desktop token (365 days) and syncs the collection with it. Web sessions can't call the sync routes.

| Route | What it does |
| --- | --- |
| `GET /auth/desktop/start?port&state&challenge` | Begins the sign-in. The app opens this in the browser with its loopback port (1024 to 65535), a `state` value and a PKCE S256 `challenge`. A bad link gets a 400 page. Otherwise the parameters go into a short-lived `desktop_auth` cookie (10 minutes) and the browser is sent to Discord. |
| `GET /auth/discord/callback` | With a `desktop_auth` cookie, it ends at the app: a redirect to `http://127.0.0.1:<port>/callback?code&state` with a one-time code that lasts 2 minutes. On any failure it redirects to `…/callback?error=signin-failed&state` and never passes Discord's details on. Without the cookie it is the normal web sign-in. |
| `POST /auth/desktop/token` `{ code, verifier }` | Trades the code and PKCE verifier for `{ token, user }`. The code is used up whether the exchange works or not. A bad, expired or mismatched code gets `400 { error: 'invalid-code' }`. |
| `POST /auth/desktop/revoke` | Takes a desktop Bearer token and deletes that one session (204). Answers 401 if the token is not a live desktop token. |
| `POST /api/sync/push` `{ entries }` | Sends up to 500 changed entries (tombstones included). Each gets one of `applied`, `stale` (with the server's `current` row), `merged` (with the `winner` on the same printing and art), `unknown-printing` or `rejected`. More than 500 gets 413 and bad payloads get 400. Timestamps more than 10 minutes in the future are clamped to server time. |
| `GET /api/sync/pull?cursor=N` | The caller's rows changed after `cursor`, tombstones included, in `server_seq` order. Returns `{ entries, cursor, more }`, at most 1,000 entries per page. |
| `POST /api/sync/wishlist-push` `{ entries }` | Sends up to 500 wishlist rows (one per printing, tombstones included). Each gets `applied`, `stale` (with the server's `current` row) or `skipped` (a game the account can't use yet). More than 500 gets 413 and bad payloads get 400. |
| `GET /api/sync/wishlist-pull?cursor=N&game=G` | The caller's wishlist rows of `game` changed after `cursor`, tombstones included. Returns `{ entries, cursor, more }`, at most 1,000 per page. |
| `POST /api/sync/prices` `{ pkeys }` | Server eBay prices for up to 1,000 printing keys (more gets 413). A key longer than 300 characters gets 400. Unknown keys are left out. Returns `{ prices, status }`. |

All sync routes need `Authorization: Bearer <desktop token>`. Without one they answer `401 { error: 'signed-out' }`.

### Server eBay prices

The `Store` Durable Object's alarm keeps eBay prices fresh for every printing any user owns. Each run looks up to 25 printings through the `PRICES` binding and then sets the next run. If more are waiting and the service answered, the next run is in 60 seconds. If every lookup failed, it is in 1 hour. Otherwise it is in 6 hours. A web edit that can add a printing, or a sync push that writes a live entry, brings the alarm forward to 5 seconds. The alarm also starts on the Durable Object's first start, or whenever no alarm is set. Signed-in desktops get these prices from `/api/sync/prices` and never call the eBay Worker themselves.

The same alarm also runs the weekly set sweep (`src/sweep.ts`), and after it the Chinese Pokémon sweep (`src/pokemonSweep.ts`), which is off until `POKEMON_SWEEP_DAILY_CALLS` in `wrangler.toml` is above `"0"`. To turn it on: deploy the `ygo-ebay-prices` Worker first (it has the `/v1/pokemon-listings` route), check a few sets' listings by hand, set the value to `"100"` and deploy this Worker. To turn it off again, set `"0"` and deploy; prices already written stay. Rows in `price_sweeps` have `pkm:` keys, so the sweep needs no migration.

### Developing against a local portal

Development builds of the desktop app use the portal set in `DUEL_BINDER_PORTAL_URL` (for example `DUEL_BINDER_PORTAL_URL=http://localhost:8787 npm run dev` at the repo root). Packaged builds always use `https://app.duelbinder.com`.

### Migration server-2: this deploy is one-way

Migration `server-2` adds `collection_entries.server_seq INTEGER NOT NULL` with a unique index (`ux_entries_seq`), plus the `desktop_codes` table and new indexes. It runs when the Durable Object starts with the new code.

**Do not roll the Worker back to a build from before server-2.** The older code inserts entries without `server_seq`, so every new row gets the default 0. After the first one, the unique index rejects the rest, and web adds break. If something goes wrong after deploying, fix it with a new deploy rather than a rollback.

## Catalog

The nightly `catalog.yml` workflow loads YGOPRODeck data into the Store. For a first or full reload, run `gh workflow run catalog.yml -f full=true`. To check progress, call `GET /admin/catalog/status` with `Authorization: Bearer $PORTAL_ADMIN_TOKEN`.
