# Marketing Site and Logo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the new Eye of Horus logo across the desktop app, site and Discord, and serve a marketing page at `duelbinder.com` from the existing portal Worker, with the signed-in app at `app.duelbinder.com`.

**Architecture:** The Worker's outer `fetch` routes by host before touching the Durable Object: the site host renders one server-side HTML page (download links from the latest GitHub release, hero button from the User-Agent) and serves static files from a Workers static-assets binding; `www` redirects; every other host goes to the DO as today. Brand artwork lives as SVG sources and a render script produces every PNG/ICO. Screenshots come from a dev-only capture mode that drives the fake-data profile.

**Tech Stack:** Cloudflare Workers (wrangler 4, static assets), TypeScript, vitest, Electron, `rsvg-convert` + ImageMagick (`magick`) for image output.

**Spec:** `docs/superpowers/specs/2026-10-24-marketing-site-and-logo-design.md`. The approved page mockup is `docs/superpowers/specs/assets/2026-10-24-marketing-mockup.html` (its screenshot frames are HTML stand-ins; real WebPs replace them).

## Global Constraints

- vitest always runs with `--maxWorkers=2` (root: `npm test -- <filter>`; Worker: `cd workers/portal && npm test`).
- No secrets in the repo; `.env` stays untracked and is never printed.
- Deploying, pushing, merging and the Discord icon upload need the owner's go-ahead.
- Theme values: background `#111113`, text `#ecebe8`, muted `#8f8d88`, hairlines `rgb(255 255 255 / 6%)`, outline buttons `rgb(255 255 255 / 14%)`, radius 6–10 px, IBM Plex Sans + IBM Plex Mono with tabular numbers.
- Anti-goals (a reviewer rejects any of these): glowing radial gradients or gradient headline text on the page, uppercase eyebrow labels, centered CTA bands, emoji/icon-studded buttons, placeholder or illustrated screenshots.
- The logo SVG in the spec is exact copy; change it only to fix rendering bugs.
- Text contrast meets WCAG AA on `#111113`; the page works at 360 px wide (feature rows stack, screenshot after its text).
- Every HTML page sets `<meta charset="utf-8">`.
- Hosts: site `https://duelbinder.com`, app `https://app.duelbinder.com`, GitHub `https://github.com/darkharasho/duel-binder`, fallback `https://github.com/darkharasho/duel-binder/releases/latest`.
- Nothing is hotlinked from YGOPRODeck at runtime.

## Review Focus

- GitHub answers 403 (rate limit), 5xx, non-JSON, or a release with none of the three assets → the page still renders 200; every download button links to the releases fallback; the meta line drops the version only when there is no release at all. (Task 2 tests.)
- A phone or Chromebook User-Agent (Android contains "Linux") or no User-Agent → hero reads "Download" and points to `#download`, never "Download for Linux". (Task 4 tests.)
- `https://duelbinder.com/?ref=discord` and `HEAD /` → the page, not a 404. (Task 5 tests.)
- `https://www.duelbinder.com/some/path?x=1` → 301 to `https://duelbinder.com/some/path?x=1`, path and query kept. (Task 5 tests.)
- A release asset name containing `<`, `"` or `&` → escaped in the HTML, never markup. (Task 4 tests.)

---

### Task 1: Brand artwork and desktop logo

**Files:**
- Create: `resources/brand/square.svg`, `resources/brand/circle.svg`, `resources/brand/small.svg`, `resources/brand/og.svg`
- Create: `scripts/brand/render.sh`
- Create (generated, committed): `build/icon.png`, `resources/icon.png`, `resources/brand/discord-icon.png`, `src/renderer/src/assets/logo.svg`, `workers/portal/site/favicon.svg`, `workers/portal/site/favicon.ico`, `workers/portal/site/apple-touch-icon.png`, `workers/portal/site/og.png`
- Delete: `src/renderer/src/assets/logo.png`
- Modify: `src/renderer/src/components/AppShell.tsx:2,57`
- Test: `tests/main/brand.test.ts`

**Interfaces:**
- Produces: the site files above at the root of `workers/portal/site/` (Task 4 links `/favicon.svg`, `/favicon.ico`, `/apple-touch-icon.png`, `/og.png`).

- [ ] **Step 1: Write the failing test** `tests/main/brand.test.ts`. Read PNG width/height from the IHDR chunk (bytes 16–23, big-endian) and the ICO directory (count at byte 4; each 16-byte entry's first byte is the width, 0 meaning 256).

```ts
const cases: [string, number, number][] = [
  ['build/icon.png', 1024, 1024],
  ['resources/icon.png', 512, 512],
  ['resources/brand/discord-icon.png', 1024, 1024],
  ['workers/portal/site/apple-touch-icon.png', 180, 180],
  ['workers/portal/site/og.png', 1200, 630]
]
it.each(cases)('%s is %ix%i', (file, w, h) => expect(pngSize(file)).toEqual([w, h]))
it('favicon.ico holds 16, 32 and 48', () => expect(icoSizes('workers/portal/site/favicon.ico')).toEqual([16, 32, 48]))
it('svg sources are self-contained', () => {
  for (const f of ['square', 'circle', 'small'])
    expect(readFileSync(`resources/brand/${f}.svg`, 'utf8')).toMatch(/<linearGradient id="au"/)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/main/brand.test.ts`
Expected: FAIL (missing files, wrong sizes).

- [ ] **Step 3: Write the SVG sources.** Each of `square`/`circle`/`small` is a standalone `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` with the spec's `<defs>` gradients and frame/transform for that variant. Inline the eye group's paths in each file instead of `<use href="#eye">` (older `rsvg-convert` builds mishandle SVG2 `href`). `og.svg` is 1200×630 on `#111113`: the square mark (about 220 px) left of "Duel Binder" in IBM Plex Sans weight 600, `#ecebe8`, on one line, the pair centred.

- [ ] **Step 4: Write `scripts/brand/render.sh`** (`set -euo pipefail`, run from the repo root). It checks that `rsvg-convert` and `magick` exist, and that `fc-match "IBM Plex Sans:semibold"` names IBM Plex Sans (otherwise exits non-zero telling the user to install the IBM Plex Sans TTF into `~/.local/share/fonts`). Then it writes every generated file listed above: square → 1024 and 512 PNGs and 180 apple-touch; circle → 1024 Discord PNG; small → 16/32/48 PNGs combined by `magick` into `favicon.ico`; `small.svg` copied to `site/favicon.svg`; `square.svg` copied to `src/renderer/src/assets/logo.svg`; `og.svg` → `og.png`.

- [ ] **Step 5: Run the script, then point the sidebar at the SVG.** In `AppShell.tsx` import `logo from '@/assets/logo.svg'`, size the `<img>` `h-9 w-9`, delete `logo.png`. Look at the generated PNGs (open them) and check the eye renders with the gold gradient, not flat.

Run: `bash scripts/brand/render.sh && npm test -- tests/main/brand.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Run the renderer tests** (they render `AppShell`).

Run: `npm test -- --project renderer`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add resources/brand scripts/brand build/icon.png resources/icon.png src/renderer/src/assets src/renderer/src/components/AppShell.tsx workers/portal/site tests/main/brand.test.ts
git commit -m "feat(brand): Eye of Horus logo, icons and favicon set"
```

---

### Task 2: Latest-release downloads

**Files:**
- Create: `workers/portal/src/site/releases.ts`
- Test: `tests/portal/site-releases.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Asset { name: string; size: number; url: string }
  export interface Downloads { version: string | null; windows: Asset | null; mac: Asset | null; linux: Asset | null }
  export const RELEASES_FALLBACK = 'https://github.com/darkharasho/duel-binder/releases/latest'
  export function pickDownloads(release: unknown): Downloads
  export function createReleaseSource(deps: { fetch: typeof fetch; now: () => Date }): () => Promise<Downloads>
  ```

- [ ] **Step 1: Write the failing tests.** Use the real v0.2.1 asset list as the fixture: `latest-linux.yml`, `latest-mac.yml`, `latest.yml`, `yugioh-collection-tracker-0.2.1-setup.exe` (137045557), `…-setup.exe.blockmap`, `…-universal-mac.zip`, `…-universal-mac.zip.blockmap`, `yugioh-collection-tracker-0.2.1.AppImage` (146881414), `yugioh-collection-tracker-0.2.1.dmg` (252235523), `…dmg.blockmap`, each with `browser_download_url`, and `tag_name: 'v0.2.1'`.
  - `pickDownloads(fixture)` → version `'0.2.1'`, windows/mac/linux are the `-setup.exe`, `.dmg`, `.AppImage` assets with their sizes and URLs (blockmaps, zip and yml ignored).
  - `duel-binder-0.3.0-setup.exe`-style names match the same way.
  - a release with only yml files → version set, all three assets `null`.
  - `pickDownloads(null)`, `pickDownloads({})`, `pickDownloads('x')` → `{ version: null, windows: null, mac: null, linux: null }`.
  - `createReleaseSource`: requests `https://api.github.com/repos/darkharasho/duel-binder/releases/latest` with `accept: application/vnd.github+json` and a `user-agent` header; a second call within 60 min makes no new request; after 61 min it fetches again.
  - 403, 500, network throw and non-JSON bodies each resolve to the all-null `Downloads` (never reject); a failure is retried after 5 min, not 60.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/portal/site-releases.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `releases.ts`.** Suffix matching is case-sensitive on `-setup.exe`, `.dmg`, `.AppImage` (first match wins); `version` strips one leading `v` from `tag_name`. Cache in the closure: success for 60 min, failure for 5 min.

- [ ] **Step 4: Run them to verify they pass**

Run: `npm test -- tests/portal/site-releases.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workers/portal/src/site/releases.ts tests/portal/site-releases.test.ts
git commit -m "feat(site): pick download assets from the latest GitHub release"
```

---

### Task 3: Screenshots and art wash

**Files:**
- Create: `src/main/dev/capture.ts`
- Modify: `src/main/index.ts` (capture mode wiring, near the `fakeData` lines 28–30 and the seeding at 130–133)
- Create: `scripts/site/shots.sh`, `scripts/site/wash.sh`
- Modify: `package.json` (script `"site:shots": "bash scripts/site/shots.sh"`)
- Create (generated, committed): `workers/portal/site/shots/collection.webp`, `dashboard.webp`, `sets.webp`, `workers/portal/site/img/wash.webp`
- Test: `tests/main/capture.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Shot { file: string; clicks: string[] }
  export const SHOTS: Shot[] // collection.png ['Collection'], dashboard.png ['Dashboard'], sets.png ['Sets', 'Legend of Blue Eyes White Dragon']
  export async function captureShots(win: Pick<BrowserWindow, 'webContents'>, dir: string, shots?: Shot[]): Promise<string[]>
  ```
  Task 4 references `/shots/collection.webp`, `/shots/dashboard.webp`, `/shots/sets.webp` (2560×1600) and `/img/wash.webp`.

- [ ] **Step 1: Write the failing test.** Fake `webContents` with `executeJavaScript` (records scripts, resolves `true`) and `capturePage` (resolves an object whose `toPNG()` returns `Buffer.from('png')`). Assert `captureShots(fake, tmpDir, [{ file: 'a.png', clicks: ['Sets', 'LOB'] }])` clicks in order (each recorded script contains the JSON-encoded button text), writes `tmpDir/a.png`, and returns `[join(tmpDir, 'a.png')]`. A click on text that matches no button rejects with an error naming the text.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/main/capture.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `capture.ts` and wire it.** `capture.ts` imports Electron types only (`import type`), so the test runs without Electron. Each click runs a script that finds the first visible `button`, `a` or `[role=button]` whose trimmed text equals the label, clicks it and returns whether it found one. After the clicks, wait until every `img` on the page is `complete` (poll, give up after 20 s) plus 500 ms for transitions, then `capturePage()` → PNG. In `index.ts`: capture mode is `!app.isPackaged && process.env['YGO_CAPTURE_DIR']`; it implies fake data, calls `app.commandLine.appendSwitch('force-device-scale-factor', '2')` before ready, and once the window has shown and the sync status reaches `idle` (seeded), runs `captureShots` then `app.quit()`. Packaged builds never enter it.

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/main/capture.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Write the scripts and generate the assets.** `shots.sh` runs `cross-env YGO_FAKE_DATA=1 YGO_CAPTURE_DIR=out/shots electron-vite dev`, then `magick out/shots/<name>.png -quality 82 workers/portal/site/shots/<name>.webp` for each. `wash.sh` downloads `https://images.ygoprodeck.com/images/cards_cropped/46986414.jpg` (Dark Magician art) into a fresh `mktemp -d`, then `magick <in> -resize 480x -blur 0x24 -quality 70 workers/portal/site/img/wash.webp`. The first fake-profile run syncs the catalog and can take several minutes. Open each WebP and check it: the sample collection (Blue-Eyes, Dark Magician, Red-Eyes, Exodia pieces and other LOB/MRD classics) with images loaded, no empty tiles, no owner data, the LOB checklist visible in `sets.webp`.

Run: `npm run site:shots && bash scripts/site/wash.sh && magick identify workers/portal/site/shots/*.webp workers/portal/site/img/wash.webp`
Expected: three 2560×1600 WebPs and one 480-wide WebP.

- [ ] **Step 6: Commit**

```bash
git add src/main/dev/capture.ts src/main/index.ts scripts/site package.json workers/portal/site/shots workers/portal/site/img tests/main/capture.test.ts
git commit -m "feat(site): capture screenshots from the fake-data profile; art wash"
```

---

### Task 4: The page

**Files:**
- Create: `workers/portal/src/site/os.ts`, `workers/portal/src/site/page.ts`
- Create: `workers/portal/site/site.css`, `workers/portal/site/fonts/` (copies of `ibm-plex-sans-latin-{400,500,600}-normal.woff2` and `ibm-plex-mono-latin-400-normal.woff2` from root `node_modules/@fontsource/*/files/`)
- Test: `tests/portal/site-page.test.ts`

**Interfaces:**
- Consumes: `Downloads`, `Asset`, `RELEASES_FALLBACK` from Task 2; site files from Tasks 1 and 3.
- Produces:
  ```ts
  export type Os = 'windows' | 'mac' | 'linux'
  export function detectOs(userAgent: string | null): Os | null
  export interface PageView { downloads: Downloads; os: Os | null; appUrl: string }
  export function renderPage(view: PageView): string
  export function formatSize(bytes: number): string
  ```

- [ ] **Step 1: Write the failing tests.**
  - `detectOs`: a Windows Chrome UA → `'windows'`; a Mac Safari UA → `'mac'`; an X11 Linux Firefox UA → `'linux'`; Android Chrome, iPhone Safari, iPad, ChromeOS (`CrOS`), `''` and `null` → `null`.
  - `formatSize(137045557)` → `'137 MB'`; `formatSize(252235523)` → `'252 MB'` (decimal megabytes, rounded).
  - `renderPage` with the Task 2 fixture's downloads, `appUrl: 'https://app.duelbinder.com'`:
    - contains `<meta charset="utf-8">`, the exact headline `A binder for your Yu-Gi-Oh! collection.` and the exact lead from the spec ("Log what you own by set, rarity and condition. Prices update on their own. …");
    - `os: 'windows'` → hero link `Download for Windows` with the `.exe` URL; `'mac'` → `Download for macOS`; `'linux'` → `Download for Linux`;
    - `os: null` → hero link text `Download`, `href="#download"`;
    - `os: 'mac'` with `mac: null` → `Download for macOS` linking to `RELEASES_FALLBACK`;
    - meta line `v0.2.1 · Windows, macOS, Linux · free`; with `version: null` → `Windows, macOS, Linux · free` and no `v` prefix;
    - download table (`id="download"`) shows `yugioh-collection-tracker-0.2.1-setup.exe` and `137 MB`; a missing asset's row links to `RELEASES_FALLBACK` and shows no size;
    - "Sign in" and "Open the web app" link to `appUrl`; GitHub link to the repo; footer contains `Duel Binder is not affiliated with Konami. Card data and images from YGOPRODeck.`;
    - feature headings `What it's worth`, `Finish your sets`, `Friends`; the Friends row has no `<img>`;
    - no `<script` anywhere; an asset named `a<b"&.exe` appears only escaped.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/portal/site-page.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `os.ts` and `page.ts`.** `detectOs` checks phones/tablets/ChromeOS first (`/Android|iPhone|iPad|iPod|CrOS/` → `null`), then `Windows`, `Macintosh|Mac OS X`, `Linux|X11`. `renderPage` returns the full document built from the mockup's structure, with every interpolated value HTML-escaped. Copy: hero headline, lead, buttons and meta line from the spec (spec wins over the mockup's lead, which wrongly names TCGplayer); feature-row and download copy from the mockup. Images: hero `/shots/collection.webp`, rows `/shots/dashboard.webp` and `/shots/sets.webp`, each with `width="2560" height="1600"`, real `alt` text, `loading="lazy"` except the hero. Head: title `Duel Binder — a binder for your Yu-Gi-Oh! collection`, a one-sentence description, icon links to `/favicon.ico`, `/favicon.svg`, `/apple-touch-icon.png`, Open Graph title/description/`og:image` `https://duelbinder.com/og.png`, `/site.css`. The nav mark is an inline copy of `resources/brand/square.svg` at 28 px.

- [ ] **Step 4: Write `site.css`** from the mockup's styles, with `@font-face` pointing at `/fonts/*.woff2` (`font-display: swap`), the art wash as a positioned layer using `/img/wash.webp` at opacity .3 with the mask fading to transparent (no CSS blur needed, it's pre-blurred), the nav on `rgb(17 17 19 / 60%)` with `backdrop-filter: blur(24px)`, and a ≤720 px breakpoint where feature and download rows stack.

- [ ] **Step 5: Run the tests**

Run: `npm test -- tests/portal/site-page.test.ts`
Expected: PASS.

- [ ] **Step 6: Look at it.** Write `renderPage` output for `os: 'linux'` with the fixture to `out/site-preview/index.html`, copy `workers/portal/site/*` beside it, and view it at 1280 px and 360 px (in-app renderer or a browser). Check it against the mockup and the anti-goals; check muted text contrast is AA.

- [ ] **Step 7: Commit**

```bash
git add workers/portal/src/site/os.ts workers/portal/src/site/page.ts workers/portal/site/site.css workers/portal/site/fonts tests/portal/site-page.test.ts
git commit -m "feat(site): marketing page in the app's theme"
```

---

### Task 5: Host routing

**Files:**
- Create: `workers/portal/src/site/host.ts`, `workers/portal/src/site/handler.ts`
- Modify: `workers/portal/src/index.ts` (default `fetch`; `WorkerEnv` gains `SITE_URL: string` and `ASSETS: Fetcher`)
- Modify: `workers/portal/wrangler.toml`
- Modify: `docs/superpowers/plans/2026-10-24-portal-1-server-foundation.md` (Task 9 text)
- Test: `tests/portal/site-host.test.ts`

**Interfaces:**
- Consumes: `renderPage`, `detectOs` (Task 4); `createReleaseSource`, `Downloads` (Task 2).
- Produces:
  ```ts
  export type HostRoute = { kind: 'site' } | { kind: 'redirect'; location: string } | { kind: 'app' }
  export function routeHost(url: URL, siteUrl: string): HostRoute
  export interface SiteDeps { appUrl: string; assets: { fetch(req: Request): Promise<Response> }; downloads: () => Promise<Downloads> }
  export async function handleSite(req: Request, deps: SiteDeps): Promise<Response>
  ```

- [ ] **Step 1: Write the failing tests.**
  - `routeHost` with `siteUrl 'https://duelbinder.com'`: `https://duelbinder.com/` → site; `https://www.duelbinder.com/some/path?x=1` → redirect `https://duelbinder.com/some/path?x=1`; `https://app.duelbinder.com/api/health` → app; `https://duel-binder-portal.project96.workers.dev/` → app; `http://localhost:8787/` → app.
  - `handleSite`: `GET /` and `GET /?ref=discord` → 200, `content-type: text/html; charset=utf-8`, body contains `A binder for your Yu-Gi-Oh! collection.`; a request with a Windows UA gets `Download for Windows`; `HEAD /` → 200 with an empty body; `POST /` → 405; `GET /site.css` → whatever the fake `assets.fetch` returns, and `downloads` is not called for it.
  - A `downloads` that resolves all-null still yields 200 with the fallback links.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- tests/portal/site-host.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `host.ts`, `handler.ts` and the new `fetch`.** `index.ts` creates one module-level `createReleaseSource({ fetch: (i, n) => fetch(i, n), now: () => new Date() })`; site → `handleSite` with `appUrl: env.PUBLIC_URL`, `assets: env.ASSETS`; redirect → `Response.redirect(location, 301)`; app → the DO stub as today. Page responses carry `cache-control: public, max-age=300`.

- [ ] **Step 4: Update `wrangler.toml`.** Add:

```toml
routes = [
  { pattern = "duelbinder.com", custom_domain = true },
  { pattern = "www.duelbinder.com", custom_domain = true },
  { pattern = "app.duelbinder.com", custom_domain = true }
]

[assets]
directory = "./site"
binding = "ASSETS"
run_worker_first = true
```

  and `SITE_URL = "https://duelbinder.com"` under `[vars]`. Leave `PUBLIC_URL` alone (Task 6 sets it). `run_worker_first` keeps site files off the app host.

- [ ] **Step 5: Update Plan 1 Task 9.** In its Step 1, the Discord redirect becomes `https://app.duelbinder.com/auth/discord/callback` and the custom domain becomes `app.duelbinder.com` (the routes now live in `wrangler.toml`); in Step 2, `PUBLIC_URL` is `https://app.duelbinder.com`. Add a line pointing to this plan's Task 6 for the site checks.

- [ ] **Step 6: Run every portal test, Worker test and typecheck**

Run: `npm test -- --project portal && (cd workers/portal && npm test && npm run typecheck)`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Preview locally.** `cd workers/portal && npx wrangler dev --var SITE_URL:http://localhost:8787`, open `http://localhost:8787/`: the page renders with fonts, screenshots, icons and live download links from GitHub. Stop it.

- [ ] **Step 8: Commit**

```bash
git add workers/portal/src workers/portal/wrangler.toml docs/superpowers/plans/2026-10-24-portal-1-server-foundation.md tests/portal/site-host.test.ts
git commit -m "feat(site): route duelbinder.com to the page, www to apex, app host to the Store"
```

---

### Task 6: Deploy (owner go-ahead)

This runs together with Plan 1 Task 9. Stop and ask the owner before Step 2.

**Files:**
- Modify: `workers/portal/wrangler.toml` (`PUBLIC_URL`, `DISCORD_CLIENT_ID`)

- [ ] **Step 1: Check the zone.** Confirm `duelbinder.com` is an active zone on the Cloudflare account wrangler is logged into (`npx wrangler whoami`, then the Cloudflare API zones list filtered to `duelbinder.com`). If it isn't there, stop and tell the owner to add the domain to Cloudflare first.

- [ ] **Step 2: Ask the owner** to confirm the Discord redirect `https://app.duelbinder.com/auth/discord/callback` is added, and for the go-ahead to deploy.

- [ ] **Step 3: Configure and deploy.** Set `PUBLIC_URL = "https://app.duelbinder.com"` and `DISCORD_CLIENT_ID` (read from `.env` without printing the secret), then run Plan 1 Task 9 Steps 2–3 (secrets, `npx wrangler deploy`).

- [ ] **Step 4: Verify**

Run:
```bash
curl -s https://app.duelbinder.com/api/health
curl -sI 'https://www.duelbinder.com/some/path?x=1' | grep -i -E '^(HTTP|location)'
curl -s https://duelbinder.com/ | grep -c 'A binder for your Yu-Gi-Oh! collection.'
curl -sI https://duelbinder.com/og.png | head -1
curl -sI https://app.duelbinder.com/site.css | head -1
```
Expected: `{"ok":true}`; `301` with `location: https://duelbinder.com/some/path?x=1`; `1`; `200`; `404`.

- [ ] **Step 5: Hand the owner** `resources/brand/discord-icon.png` to upload as the Discord application icon, then continue with Plan 1 Task 9 Steps 4–6.

- [ ] **Step 6: Commit**

```bash
git add workers/portal/wrangler.toml
git commit -m "chore(portal): point PUBLIC_URL at app.duelbinder.com"
```
