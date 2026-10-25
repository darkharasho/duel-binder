# duel-binder-portal

One Cloudflare Worker serves three hosts:

- `duelbinder.com`: the marketing page, rendered in `src/site/` from the latest GitHub release, plus the static files in `site/`.
- `www.duelbinder.com`: a 301 redirect to the apex, keeping the path and query.
- `app.duelbinder.com`: the API and sign-in. These run in the `Store` Durable Object, which holds the catalog and every user's collection. A signed-in visitor to `/` gets the web app (the built renderer), and `/app/*` serves its files straight from assets. Card images are served by `/img/...` routes, backed by the `IMAGES` R2 bucket (`duel-binder-images`, which must exist before deploying).

## Configuration

Vars live in `wrangler.toml`: `SITE_URL`, `PUBLIC_URL` and `DISCORD_CLIENT_ID`.

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

## Catalog

The nightly `catalog.yml` workflow loads YGOPRODeck data into the Store. For a first or full reload, run `gh workflow run catalog.yml -f full=true`. To check progress, call `GET /admin/catalog/status` with `Authorization: Bearer $PORTAL_ADMIN_TOKEN`.
