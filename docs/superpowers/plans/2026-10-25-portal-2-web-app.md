# Portal 2: Web App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in visitor to app.duelbinder.com gets the Duel Binder app itself (Dashboard, Collection, Browse, Sets, Add Card, editing included) running in the browser against their server collection.

**Architecture:** The existing React renderer is built a second time for the browser, with an HTTP-backed `Api` (`window.api`) that posts to the Worker's `/api/rpc/:channel`. The Worker gains the write channels, an `/img/*` route that mirrors catalog artwork into R2, and serves the built SPA to signed-in visitors on `/`. Desktop-only UI (title bar, updater, catalog refresh, image cache, data folder) is hidden on the web.

**Tech Stack:** Cloudflare Workers + Durable Object SQLite + R2, React 19 + Vite 8, TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-web-portal-sync-friends-design.md` (sections "Web build", "Shared catalog", "Accounts & auth"). Plan 1 (`docs/superpowers/plans/2026-10-24-portal-1-server-foundation.md`) built the server, sign-in, catalog and read RPC this plan extends.

## Global Constraints

- Run vitest with `--maxWorkers=2` (root `npm test` already does; `workers/portal` `npm test` too).
- The desktop app behaves exactly as before: every existing test stays green and desktop renders the same UI.
- Desktop DB migrations are append-only; this plan adds none.
- No hotlinking YGOPRODeck images from the web: every image the web build shows comes from `app.duelbinder.com/img/*`.
- Secrets live in Worker secrets / `.env`; never print or commit them.
- Commit after each task on the feature branch; push, merge, R2 bucket creation and deploy wait for the owner's go-ahead (Task 8).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Deferred (rulings, flagged to the owner)

- **International (eBay) prices on the server** are not resolved in this plan; non-English printings show the existing "no price" reason on the web. The spec's on-demand price resolution becomes its own plan. Cost if wrong: web value totals miss non-English cards until then.
- **Konami logos (`km-` set images)** need the desktop's background cut-out (Electron `nativeImage`); `/img/set/km-*` answers 404 and `SetArt` falls back to pack art / set image as it already does on load failure.
- Friends, desktop sync, auth carry-overs (session pruning, user-upsert transaction) and the migration-ordering carry-over are later plans.

## Review Focus

1. **Session expires while the app is open** → the next request lands the visitor on the sign-in page, not a broken screen or endless spinner. (Task 5 test `401 sends the visitor to the sign-in page`.)
2. **A request names another user's entry id** in update/remove/adjust → 400, and the other user's row is untouched. (Task 1 tests.)
3. **A browser sends wrong argument types** (string id, missing quantity, non-object patch) → 400 with a message, never 500. (Task 1 test `bad argument types answer 400`.)
4. **An image id not in the catalog, or an upstream 404/non-image** → 404 and nothing is written to R2. (Task 2 tests.)
5. **Adding the same printing twice** (double click, two tabs) → one live entry whose quantity is the sum. (Task 1 test `adding the same printing twice sums into one entry`.)

---

### Task 1: Write RPC and argument checks

**Files:**
- Create: `src/main/repo/args.ts`, `src/shared/portal.ts`, `tests/portal/rpc-write.test.ts`
- Modify: `workers/portal/src/rpc.ts`, `workers/portal/src/app.ts`, `workers/portal/src/scope.ts`, `src/main/repo/scope.ts`, `src/main/repo/collection.ts` (`removeEntry`), `src/main/ipc/handlers.ts` (use `checkLanguage` from args, new `removeEntry` order), any test calling `removeEntry`

**Interfaces:**
- Produces: `PORTAL_CHANNELS` in `src/shared/portal.ts`, a `const` tuple of the `InvokeChannel`s the portal serves:
  `cards:search, cards:get, cards:browse, cards:browseFacets, collection:list, collection:forCard, collection:add, collection:update, collection:remove, collection:facets, stats:get, sets:list, sets:checklist, sets:adjust`; `export type PortalChannel = (typeof PORTAL_CHANNELS)[number]`. `rpc.ts`'s `Served` becomes `PortalChannel`; Task 5 imports the tuple.
- Produces: `src/main/repo/args.ts`, every function throwing `CollectionError` (so the RPC answers 400): `checkLanguage(v: unknown): Language`, `checkId(v: unknown, what: string): number` (positive safe integer), `checkString(v: unknown, what: string): string`, `checkObject(v: unknown, what: string): Record<string, unknown>`, `checkDelta(v: unknown): 1 | -1`, `checkAddInput(v: unknown): AddEntryInput`, `checkUpdatePatch(v: unknown): UpdateEntryInput` (each field optional; present fields type-checked; `notes` string).
- Produces: `removeEntry(db: SqlDb, id: number, now = new Date(), scope: Scope = LOCAL): void` (same parameter order as `addEntry`/`updateEntry`).
- `Scope.snapshotTable` loses its unused `where` field.

- [ ] **Step 1: Write the failing tests** in `tests/portal/rpc-write.test.ts`, reusing the session/rpc helpers pattern of `tests/portal/rpc.test.ts` (alice and bob, seeded catalog):
  - `add creates an entry and records today's snapshot`: `collection:add` `[{printingId, imageId, quantity: 2}]` → 200, `result.quantity === 2`; a `value_snapshots` row exists for alice only.
  - `adding the same printing twice sums into one entry`: two adds of quantity 1 → one live row for alice, quantity 2.
  - `update and remove change only the caller's entries`: bob's entry id via alice's session → `collection:update` 400, `collection:remove` 400 or no-op (assert bob's row unchanged and not tombstoned in both cases).
  - `remove tombstones and a second remove leaves deleted_at as it was`.
  - `sets:adjust adds and removes one copy for the caller only`.
  - `stats:get counts only the caller's live entries`.
  - `bad argument types answer 400`: `collection:add` `['x']`, `[{printingId: '1', imageId: 1, quantity: 1}]`; `collection:update` `[1, 'nope']`; `collection:remove` `['1']`; `sets:adjust` `['S', 'en', 1, 2]`; `cards:get` `['1']` → each 400 with a string `error`.
  - `a malformed channel escape answers 400`: POST `/api/rpc/%E0%A4%A` → 400.
- [ ] **Step 2: Run** `npm test -- tests/portal/rpc-write.test.ts` — expect failures (`unknown-channel` 404s, 500 on bad escape).
- [ ] **Step 3: Implement.** Add `args.ts` and `portal.ts`; register the five write/stat handlers in `rpc.ts`, each validating its args with `args.ts` and passing `deps.now()` and the user scope; writes call `recordSnapshot(db, deps.now(), scope)` after succeeding. Validate read-channel args too (`q` string, `cardId` id, filter objects via `checkObject`). Remove the local `checkLanguage` from `rpc.ts` and `handlers.ts`. In `app.ts`, a `decodeURIComponent` throw answers `400 { error: 'bad-channel' }`. In `userScope.deleteEntry`, add `AND deleted_at IS NULL`. Reorder `removeEntry` and update callers.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` (root) and `cd workers/portal && npm run typecheck` — all pass.
- [ ] **Step 5: Commit** `feat(portal): write RPC with argument checks`.

### Task 2: Image route backed by R2

**Files:**
- Create: `src/shared/imageSources.ts`, `workers/portal/src/images.ts`, `tests/portal/images.test.ts`
- Modify: `src/main/images/cache.ts`, `src/main/konami/packArt.ts`, `src/main/konami/logos.ts` (import moved constants), `workers/portal/src/app.ts`, `workers/portal/src/index.ts`, `workers/portal/wrangler.toml`, existing portal test fixtures (new `AppDeps` field)

**Interfaces:**
- Produces: `src/shared/imageSources.ts` with `ImageSize = 'small' | 'full' | 'cropped'`, `imageUrl(size, id)`, `setImageUrl(key)`, `YUGIPEDIA_IMAGE_PREFIX`, `PACK_ART_PREFIX`, `KONAMI_LOGO_PREFIX`, `SET_KEY_RE` (moved verbatim from `cache.ts` / konami modules, which now import them; no node imports in this file).
- Produces: `ImageBucket` in `workers/portal/src/images.ts` — the slice of R2 used:
  `get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>` and `put(key: string, value: ArrayBuffer, opts: { httpMetadata: { contentType: string } }): Promise<unknown>`.
- Produces: `imageRoute(req: Request, deps: AppDeps, path: string): Promise<Response>` where `path` is the part after `/img/`. `AppDeps` gains `images: ImageBucket`; `Store` passes `env.IMAGES`.
- Routes (GET and HEAD; no session needed):
  - `small|full|cropped/<id>`: `id` must be a positive integer present in `card_images`; R2 key `card/<size>/<id>`; upstream `imageUrl(size, id)`; `cache-control: public, max-age=31536000, immutable`.
  - `set/<key>`: `key` must match `SET_KEY_RE`; `km-*` → 404; `yp-`/`yc-` → `findSetImageUrl(db, key)` and the URL must start with `YUGIPEDIA_IMAGE_PREFIX` / `PACK_ART_PREFIX`; other keys → `setImageUrl(key)`; R2 key `set/<key>`; `cache-control: public, max-age=86400`.
  - `printing/<id>`: Task 3; answers 404 until then.
- Upstream rules (as desktop `download`): 30 s timeout; `res.ok` and `content-type` starting `image/`, else 404 and no `put`; Yugipedia/official requests send `User-Agent: DuelBinder/portal (https://github.com/darkharasho/duel-binder)`.
- `wrangler.toml`: `[[r2_buckets]] binding = "IMAGES"`, `bucket_name = "duel-binder-images"`; `WorkerEnv` gains `IMAGES: R2Bucket`.

- [ ] **Step 1: Write the failing tests** in `tests/portal/images.test.ts` with an in-memory `ImageBucket` (a `Map`) and a mocked `fetch`:
  - `serves a card image from upstream once, then from R2`: first GET `/img/small/<seeded image id>` → 200, `content-type: image/jpeg`, upstream called with `https://images.ygoprodeck.com/images/cards_small/<id>.jpg`; second GET → 200, upstream not called again.
  - `unknown image id answers 404 without fetching`.
  - `upstream 404 or non-image answers 404 and stores nothing`.
  - `set image keys`: plain key → YGOPRODeck sets URL; `yp-` key seeded in `sets.image_url` → that URL; `km-anything` → 404; `../x` → 404.
  - `HEAD answers with no body`; `POST answers 405`.
- [ ] **Step 2: Run** `npm test -- tests/portal/images.test.ts` — fails.
- [ ] **Step 3: Implement** `imageSources.ts` (moving constants; desktop `tests/main` image tests must still pass), `images.ts`, and route `/img/` in `handle` before the 404.
- [ ] **Step 4: Run** `npm test`, root `npm run typecheck`, `cd workers/portal && npm run typecheck` — pass.
- [ ] **Step 5: Commit** `feat(portal): mirror catalog artwork into R2 under /img`.

### Task 3: Printing photos on the server

**Files:**
- Modify: `src/main/yugipedia/artResolver.ts`, `src/main/tcgplayer/catalog.ts` (or split `createTcgplayerLookup` into `src/main/tcgplayer/lookup.ts` if `catalog.ts` pulls Node-only code into the Worker), `workers/portal/src/images.ts`, `workers/portal/src/app.ts`, `workers/portal/src/index.ts`
- Test: `tests/portal/images.test.ts`

**Interfaces:**
- Consumes: `imageRoute`, `ImageBucket` (Task 2).
- `createPrintingArtResolver` and `createTcgplayerLookup` take `db: SqlDb` instead of `Database.Database` (desktop callers unchanged).
- `AppDeps` gains `printingArt: PrintingArtResolver`; `Store` builds one per instance from `createYugipediaClient({ version: 'portal' })` and `createTcgplayerLookup(db)` as `quickUrl`.
- `printing/<id>`: R2 key `printing/<id>`; on a miss, `deps.printingArt.url(id)`; null → 404; the URL must start with `TCGPLAYER_IMAGE_PREFIX` or `YUGIPEDIA_IMAGE_PREFIX`, else 404; fetched with the Task 2 upstream rules; `cache-control: public, max-age=86400`.

- [ ] **Step 1: Write the failing tests** (stub `printingArt`):
  - `printing photo comes from the resolver URL and is stored`: resolver returns a `https://tcgplayer-cdn.tcgplayer.com/product/1_in_1000x1000.jpg` URL → 200, R2 has `printing/<id>`.
  - `printing with no photo answers 404`: resolver returns null → 404, nothing stored.
  - `resolver URL on another host answers 404 without fetching`.
- [ ] **Step 2: Run** — fails (route answers 404 for all).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, both typechecks — pass.
- [ ] **Step 5: Commit** `feat(portal): serve printing photos`.

### Task 4: Platform and image-URL helpers in the renderer

**Files:**
- Create: `src/renderer/src/lib/platform.ts`, `src/renderer/src/lib/images.ts`, `tests/renderer/images.test.ts`
- Modify: `src/renderer/src/components/CardArt.tsx`, `src/renderer/src/components/artWashContext.ts`, `src/renderer/src/features/sets/SetArt.tsx`, `src/renderer/src/components/AppShell.tsx`, `src/renderer/src/components/TitleBar.tsx` (platform checks)

**Interfaces:**
- Produces: `isWeb(): boolean` (`api.window.platform === 'web'`) and `isMac(): boolean` (`platform === 'darwin'`, or web with `/Mac|iPhone|iPad/` in `navigator.userAgent`). Functions, not constants, so test mocks installed later apply.
- Produces: `cardImageSrc(size: 'small' | 'full' | 'cropped', imageId: number): string`, `printingImageSrc(printingId: number): string`, `setImageSrc(key: string): string` — desktop `ygo-img://<path>`, web `/img/<path>` (paths `small/12`, `printing/5`, `set/LOB`). These are the only place image URLs are built; `artWashContext`'s `cardArtUrl`/`coverArtUrl`/`setArtUrl` delegate to them.
- The Add-card shortcut label uses `isMac()`.

- [ ] **Step 1: Write the failing tests**: with the mock API's platform `'linux'`, `cardImageSrc('small', 12) === 'ygo-img://small/12'`; with `'web'`, `'/img/small/12'`, `printingImageSrc(5) === '/img/printing/5'`, `setImageSrc('LOB') === '/img/set/LOB'`; a `CardArt` rendered under `'web'` has `src="/img/small/12"`.
- [ ] **Step 2: Run** `npm test -- tests/renderer/images.test.ts` — fails.
- [ ] **Step 3: Implement**; `grep -rn "ygo-img://" src/renderer/src` afterwards finds only `lib/images.ts` (and the desktop `index.html` CSP).
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — pass (existing `card-art` tests unchanged).
- [ ] **Step 5: Commit** `refactor(renderer): one helper for image URLs and platform`.

### Task 5: HTTP-backed Api

**Files:**
- Create: `src/renderer/src/web/httpApi.ts`, `tests/renderer/http-api.test.ts`

**Interfaces:**
- Consumes: `PORTAL_CHANNELS` (Task 1).
- Produces: `createHttpApi(opts?: { fetch?: typeof fetch; onSignedOut?: () => void }): Api`.
  - Each `PORTAL_CHANNELS` method: `POST /api/rpc/<channel>`, `content-type: application/json`, body `{"args":[...]}`, `credentials: 'same-origin'`; 200 → resolves `result`; 401 → calls `onSignedOut` (default `() => location.assign('/')`) and rejects `Error('Signed out')`; other statuses reject `Error(body.error)` when it is a string, else `Error('Request failed (<status>)')`.
  - Everything else is local: `window.platform = 'web'`, window methods resolve, `isMaximized` resolves false; `sync.status`/`sync.run` resolve `{ state: 'idle', lastSyncAt: null, dbVersion: null, cardCount: 1, error: null }`; `app.updateStatus`/`checkForUpdates` resolve `{ state: 'idle', mode: 'auto', version: null, error: null }`; `app.version` resolves `'web'`; `prices.*`, `images.*`, `app.openDataFolder`, `app.backupDatabase`, `app.applyUpdate` reject `Error('Not available on the web')`; every `on*` subscription returns a no-op unsubscribe.

- [ ] **Step 1: Write the failing tests** (mocked `fetch`):
  - `posts args and resolves result`: `collection.update(3, { quantity: 2 })` → fetch called with `/api/rpc/collection:update`, method POST, JSON body `{"args":[3,{"quantity":2}]}`; resolves the mocked `result`.
  - `401 sends the visitor to the sign-in page`: `onSignedOut` called once; promise rejects `Signed out`.
  - `400 rejects with the server message`: body `{ error: 'Quantity must be a whole number of at least 1' }` → rejects with that message.
  - `500 without a message rejects generically`: `Request failed (500)`.
  - `desktop-only calls never hit the network`: `app.updateStatus()`, `sync.status()`, `window.isMaximized()` resolve; `images.cacheSize()` rejects `Not available on the web`; fetch not called.
  - `every Api invoke method exists`: for each `INVOKE_CHANNELS` entry, `typeof api[ns][method] === 'function'`.
- [ ] **Step 2: Run** — fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` — pass.
- [ ] **Step 5: Commit** `feat(web): HTTP-backed Api`.

### Task 6: Web shell and Account settings

**Files:**
- Create: `src/renderer/src/web/account.ts`, `src/renderer/src/features/settings/AccountSection.tsx`, `tests/renderer/web-shell.test.tsx`
- Modify: `src/renderer/src/components/AppShell.tsx`, `src/renderer/src/components/SyncBanner.tsx`, `src/renderer/src/App.tsx` (`useUpdateToasts` off on web), `src/renderer/src/features/settings/SettingsPage.tsx`

**Interfaces:**
- Consumes: `isWeb()` (Task 4).
- Produces: `fetchMe(fetchFn?: typeof fetch): Promise<Me | null>` — `GET /api/me` (same-origin); 401 → null; `Me = { id: number; username: string; displayName: string | null; avatarUrl: string | null }` (the server's `/api/me` body).
- On web: no `TitleBar` and no glass strip above it; `SyncBanner` renders nothing; `useUpdateToasts` not called. Settings shows only an **Account** section ("Signed in as {displayName ?? username}", avatar if present, a `<form method="post" action="/auth/logout">` with a "Sign out" button — the server answers 303 to `/`) and the existing **About** section. Desktop Settings is unchanged and has no Account section (desktop accounts come with sync).

- [ ] **Step 1: Write the failing tests** with the mock API platform set to `'web'` and `fetch` stubbed for `/api/me`:
  - `web shell has no window controls`: no `Minimize`/`Close` buttons.
  - `web settings shows the account and sign-out`: text `Signed in as Seto`; a form with `action="/auth/logout"` and method post; no `Check for updates`, `Clear image cache`, `Refresh card data`, `Open data folder` buttons.
  - `desktop settings has no account section`: platform `'linux'` → no `Signed in as`.
- [ ] **Step 2: Run** — fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run typecheck` — pass.
- [ ] **Step 5: Commit** `feat(web): hide desktop-only UI; account settings`.

### Task 7: Build the web app and serve it from the Worker

**Files:**
- Create: `vite.web.config.ts`, `src/renderer/web.html`, `src/renderer/src/web.tsx`, `src/renderer/src/web/install.ts`
- Modify: `package.json` (script), `workers/portal/package.json` (deploy script), `.gitignore`, `workers/portal/src/home.ts`, `workers/portal/src/app.ts` (`AppDeps.assets`), `workers/portal/src/index.ts`, `workers/portal/src/site/host.ts`, `workers/portal/src/site/handler.ts`, `workers/portal/README.md`, `tests/portal/auth.test.ts`, `tests/portal/site-host.test.ts`

**Interfaces:**
- Consumes: `createHttpApi` (Task 5).
- `vite.web.config.ts`: root `src/renderer`, `base: '/app/'`, input `src/renderer/web.html`, `outDir` `workers/portal/site/app` (emptied each build), the renderer's aliases and plugins (react, tailwind). Root script `"build:web": "vite build --config vite.web.config.ts"`. `workers/portal` `"deploy": "npm --prefix ../.. run build:web && wrangler deploy"`. `.gitignore` adds `workers/portal/site/app/`.
- `web.html` is `index.html` with CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:` and script `/src/web.tsx`. `web.tsx` imports `./web/install` (sets `window.api = createHttpApi()`) before `./main`.
- `routeHost` returns `{ kind: 'app-asset' }` for app-host paths starting `/app/`; `index.ts` sends those straight to `env.ASSETS` (no Durable Object). The site host answers 404 for `/app/*`.
- `AppDeps` gains `assets: { fetch(req: Request): Promise<Response> }` (`Store` passes `env.ASSETS`). `home()` for a signed-in visitor fetches `/app/web.html` from assets and returns it with `content-type: text/html; charset=utf-8`, `cache-control: no-store` and the CSP above as a header; if that asset is not OK, it falls back to the current placeholder page. Signed-out `/` is unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `auth.test.ts` `front page serves the web app to a signed-in user`: mock assets return `<!doctype html><div id="root">` for `/app/web.html` → body contains `id="root"`, `cache-control: no-store`, header `content-security-policy` contains `img-src 'self' data:`.
  - `auth.test.ts` `front page falls back to the placeholder when the app isn't built`: assets 404 → body contains `Signed in as`.
  - `site-host.test.ts`: `routeHost(app.duelbinder.com/app/assets/x.js)` → `app-asset`; `app.duelbinder.com/` → `app`; site host `/app/web.html` → 404 from `handleSite`.
- [ ] **Step 2: Run** — fails.
- [ ] **Step 3: Implement**; README gains the build step, the `IMAGES` R2 bucket and `/img` routes.
- [ ] **Step 4: Verify:** `npm run build:web` writes `workers/portal/site/app/web.html` and `assets/*`; `git status` shows none of them; `npm test`, root `npm run typecheck`, `cd workers/portal && npm test && npm run typecheck` pass.
- [ ] **Step 5: Commit** `feat(portal): serve the web app on app.duelbinder.com`.

### Task 8: Deploy (owner go-ahead)

Ask the owner before each outward step.

- [ ] **Step 1:** `cd workers/portal && npx wrangler r2 bucket create duel-binder-images`.
- [ ] **Step 2:** Merge the branch to `main` and push (owner's call), then `npm run deploy` from `workers/portal`.
- [ ] **Step 3: Smoke test:** signed-out `https://app.duelbinder.com/` still shows the sign-in page; `curl -sI https://app.duelbinder.com/img/small/<a known image id>` → 200 `image/jpeg` (and again, served from R2); the owner signs in and sees the Dashboard; Browse shows card art; adding, editing and removing a card works; Settings → Sign out returns to the sign-in page.
