# Duel Binder on the Phone, Phase 1 (Home-Screen Web App) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Duel Binder as a home-screen web app at `https://app.duelbinder.com/scan/`. It is the full app (dashboard, collection, browse, sets, friends, settings) plus the camera scanner, running from the phone's own copy of the data, so everything except friends works with no signal. Reviewed scans and edits sync to the user's account.

**Architecture:** The phone runs a **data worker** (a Web Worker). It holds a SQLite WASM database on OPFS that has the *desktop's own schema* (`MIGRATIONS`). That worker runs the desktop's existing pure modules unchanged on top of it:
- the data actions the desktop's IPC handlers run (cards, collection, sets, stats, scan queries), moved into a shared `createDataHandlers`
- the sync engine (`cloud/engine.ts syncOnce`)
- the catalog feed upsert (`catalog/apply.ts`)

The main thread installs a phone `window.api`, backed by the worker plus a browser tesseract.js. A phone shell with a bottom tab bar hosts the desktop's own pages (`DashboardPage`, `CollectionPage`, `BrowsePage`, `SetsPage`, `FriendsPage`, `AddCardDialog`) and the desktop scanner pieces (`ScanHubProvider`, `useScanSession`, `useScanLoop`, `SessionList`, `ScanRowItem`, the vision worker). The pages get phone layouts below the `md` breakpoint (768 px); the desktop window's minimum width is 1100 px, so the desktop app looks the same. The portal gains:
- a table filter on the catalog feed
- a session-to-token exchange
- the `/scan/` page and service worker routes
- account deletion
- a privacy page

**Tech Stack:** TypeScript, React, Vite (new `vite.phone.config.ts`), `@sqlite.org/sqlite-wasm` (OPFS SAH-pool VFS), tesseract.js 7 browser workers, OpenCV.js (existing vision worker), Cloudflare Worker portal, vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-mobile-scanner-design.md` (phase 1 only; the store apps get their own plan).

## Global Constraints

- vitest always runs with `--maxWorkers=2` (`npm test -- <path>` already passes it). Never build 100k+ row synthetic data in tests.
- Desktop behaviour and its existing tests stay the same. Shared-code moves keep every existing test passing unmodified, except for import paths.
- The phone imports desktop modules only from this allow-list:
  - `src/main/repo/*`
  - `src/main/ipc/dataHandlers.ts`
  - `src/main/db/{meta,schema,sql,migrateSql}.ts`
  - `src/main/catalog/{apply,upsert}.ts`
  - `src/main/cloud/{engine,client,localSync}.ts`
  - `src/main/prices/candidates.ts`
  - `src/shared/**`

  None of them may import `electron`, `better-sqlite3` (other than `import type`) or `node:*`. The phone build fails if anything resolves a Node builtin.
- Page URL `https://app.duelbinder.com/scan/`. Build base `/app/scan/`, output `workers/portal/site/app/scan/`. Service worker at `/scan/sw.js` with scope `/scan/`. Manifest at `/scan/manifest.webmanifest`, `start_url` `/scan/`, `scope` `/scan/`, `display` `standalone`, name "Duel Binder", short_name "Duel Binder".
- `PHONE_CSP` = `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://cdn.discordapp.com; connect-src 'self'`. It is sent as a header on the `/scan/` page only; the desktop web app's `WEB_CSP` is unchanged.
- Phone catalog tables: `PHONE_TABLES = ['cards', 'card_images', 'card_printings', 'sets', 'pack_art', 'set_logos', 'konami_logos']`. The last three are a few thousand small rows for set images; the TCGplayer tables stay off the phone.
- Platform: the phone's `window.api.window.platform` is `'phone'`. In `src/renderer/src/lib/platform.ts`, `isWeb()` becomes true for `'web'` **and** `'phone'` (so pages take their web paths, and images use `/img/`), and the new `isPhone()` is true only for `'phone'`. On the phone, `printingImageSrc` returns `null` and `CardArt` skips the printing scan (the phone's printing ids aren't the server's; see the spec's non-goals).
- Phone layouts use only `max-md:` Tailwind variants or `isPhone()` branches. At 1100 px and wider, every desktop page renders exactly as before; existing renderer tests pass unmodified.
- Every portal change is additive. Existing request and response shapes keep working for installed desktop apps.
- Measured 2026-10-27 from the owner's desktop database:
  - The feed for `PHONE_TABLES` is 378,923 rows in 76 pages: 155 MB of JSON, **about 10 MB gzipped** on the wire.
  - With fingerprints (0.5 MB) and the English OCR model (2.9 MB), the first-run data download is **about 14 MB**. The app code comes on top of that.
  - Stored on the phone it takes about 150 MB.
  - The first-run screen says "About 15 MB".
- Copy rules: plain words, no jargon. These exact strings are used:
  - Sign-in: "Sign in with Discord to scan cards into your collection."
  - First run: "Downloading card data" + "About 15 MB. Use Wi-Fi if you can." On a cellular connection (`navigator.connection.type === 'cellular'`, where the browser exposes it) it says instead: "You're on mobile data. This download is about 15 MB."
  - Status line:
    - "Offline · N waiting to sync"
    - "Syncing…"
    - "N waiting to sync"
    - "All synced"
    - "N can't sync" (tapping it opens the problem list)
  - Card data age: "Card data from <Mon D>".
  - Storage warning: "Your browser may clear this app's data. Sync before closing it for long."
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The app is killed mid-download or mid-sync.** The first-run download resumes from the last finished page (`catalog_cursor`). A queued add is never lost or doubled; it stays dirty until the server acknowledges it. *Test:* Task 7, `resumes a fill after a failed page`; `an add made before a failed push syncs once on the next run`.
2. **The same card is added offline while the server already has an entry for it** (added on desktop). The phone raises that entry's quantity, so after sync there is one entry with the copies added up. Sync only keeps the later of two *different* entries for one printing and art, so the phone must have pulled the collection before its first scan. *Test:* Task 7, `an offline add of a card the server already holds merges on sync` and `first run is not done until the first sync has pulled the collection`.
3. **Signing out or deleting the account while adds are waiting.** Sign-out keeps the owner's rows (they sync if the same user signs back in) and warns with the count first. Delete removes them. *Test:* Task 7, `sign out keeps waiting adds for the same user`; Task 9, `sign out warns when adds are waiting`.
4. **The browser blocks something the page needs** (CSP, wasm, workers, OPFS missing on an old iOS). The app shows a clear message instead of a blank screen. *Test:* Task 9, `shows the unsupported screen when the data worker fails to open`; Task 13 browser check.
5. **The web session cookie has expired but the stored token still works,** or the other way round. Card images (`/img/`, cookie) may not load, but scanning and syncing (Bearer) keep working. A 401 on Bearer calls goes back to the sign-in screen without dropping waiting adds. *Test:* Task 7, `a 401 on sync reports signed-out and keeps dirty rows`.

---

## File map

**Shared refactors (desktop keeps working the same):**
- Create `src/main/ipc/dataHandlers.ts` (the data channels, moved out of `handlers.ts`).
- Modify the desktop pages for phone widths (Tasks 10 and 11) using `max-md:` and `isPhone()` only.
- Create `src/shared/scan/ocr.ts`. It holds the `Ocr` interface, the `OcrModel` type, `checkOcrBands`, `toPgm(band): Uint8Array`, and `createOcrQueue(opts)`, which is the slot, queue and timeout logic moved out of `src/main/scan/ocr.ts`.
- Move `src/main/scan/cardLanguage.ts` to `src/shared/scan/cardLanguage.ts`.
- Create `src/main/db/migrateSql.ts` with `migrateSql(db: SqlDb)`; `database.ts migrate()` calls it.
- Modify `src/main/cloud/engine.ts`: `syncOnce(db: SqlDb, …)`. Only the type changes.
- Modify `src/shared/catalogFeed.ts`: add `latest?: number` to the response and `PHONE_TABLES`.
- Modify `src/main/cloud/client.ts`: `catalogChanges(since, limit?, tables?)`.
- Modify `src/renderer/src/features/scan/useCamera.ts`: an optional `facing` argument.

**Phone (`src/phone/`):**
- `index.html`: the entry page.
- `main.tsx`: installs `window.api`, then renders.
- `data/wasmSql.ts`: the SqlDb adapter over the sqlite-wasm oo1 database.
- `data/phoneSchema.ts`: the phone-only tables and `PHONE_FORMAT`.
- `data/store.ts`: the worker-side logic (sign-in state, fill, sync, add, scan queries, fingerprints, delete).
- `data/protocol.ts`: the message types, `exposeStore`, `connectStore`.
- `data/worker.ts`: opens OPFS, creates the store, exposes it.
- `ocr.ts`: browser tesseract via `createOcrQueue`.
- `api.ts`: `createPhoneApi(deps): Api`.
- `syncTriggers.ts`: when to run sync and catalog updates.
- `App.tsx`, `PhoneShell.tsx`, `SignIn.tsx`, `FirstRun.tsx`, `ScannerScreen.tsx`, `PhoneCamera.tsx`, `StatusLine.tsx`, `Settings.tsx`: the UI.
- `sw.ts`: the service worker.
- `public/manifest.webmanifest`, `public/icon-192.png`, `public/icon-512.png`.
- `vite.phone.config.ts`, `tsconfig.phone.json` (repo root).

**Portal:**
- Modify `workers/portal/src/catalogFeed.ts` (tables, latest), `auth.ts` (phone token, `next`), `app.ts` (routes).
- Create `workers/portal/src/account.ts` (delete), `workers/portal/src/phonePage.ts` (`/scan/` routes, `PHONE_CSP`), `workers/portal/src/site/privacy.ts`.
- Modify `workers/portal/src/site/handler.ts` (`/privacy`).

**Web portal UI:** modify `src/shared/ipc.ts` (`account.deleteAccount`), `src/renderer/src/web/httpApi.ts`, `src/main/ipc/handlers.ts` and the preload channel list (desktop rejects), and `src/renderer/src/features/settings/AccountSection.tsx` (web only).

---

### Task 1: Shared OCR queue and card-language check

**Files:**
- Create: `src/shared/scan/ocr.ts`
- Move: `src/main/scan/cardLanguage.ts` → `src/shared/scan/cardLanguage.ts`
- Modify: `src/main/scan/ocr.ts`, `src/main/ipc/handlers.ts` (import path), and any other importer of `cardLanguage`, `Ocr` or `OcrModel` (find them with grep)
- Test: `tests/main/scan-ocr.test.ts` and `tests/main/scan-language.test.ts` (import paths only), plus a new `tests/main/ocr-queue.test.ts`

**Interfaces:**
- Produces:
  - `type OcrModel = 'eng' | 'jpn' | 'kor' | 'chi_sim'`.
  - `interface Ocr` (unchanged members).
  - `checkOcrBands(bands: unknown): asserts bands is OcrBand[]`.
  - `toPgm(band: OcrBand): Uint8Array`.
  - `interface OcrWorker { recognize(image: Uint8Array): Promise<{ data: { text: string; confidence: number } }>; setParameters(p: Record<string, string>): Promise<unknown>; terminate(): Promise<unknown> }`.
  - `createOcrQueue(opts: { start(model: OcrModel, onDead: () => void): Promise<OcrWorker>; timeoutMs?: number }): Ocr`.
  - `cardLanguage(ocr: Ocr, bands: OcrBand[]): Promise<CardLanguage | null>`, now in `src/shared/scan/cardLanguage.ts`.
- `src/main/scan/ocr.ts` keeps exporting `createOcr`, `langPath`, `engLangPath`, plus `checkOcrBands` re-exported for existing importers. `createOcr` becomes `createOcrQueue` with a Node `start` that does what today's `start` does: langPath, `cacheMethod: 'none'`, `gzip`, `errorHandler`, and the thread `error`/`exit` → `onDead`.

- [ ] **Step 1: Write `tests/main/ocr-queue.test.ts`** against a fake `start`:
  - `reads run one at a time`: two `read` calls overlap; the fake worker's `recognize` sees them in order.
  - `sets parameters only when the kind changes`: `read(…, 'code')` twice, then `'name'`; `setParameters` is called 2 times, and the first call has `tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'`.
  - `a read past timeoutMs rejects and the next read starts a fresh worker`: `start` is called twice.
  - `onDead drops the worker`: call the captured `onDead`; the next read calls `start` again.
  - `empty bands read as '' without recognizing`.
  - `toPgm writes a P5 header then the pixels`: a 2×1 band [7, 9] gives bytes of `"P5\n2 1\n255\n"` followed by 7, 9.
- [ ] **Step 2: Run** `npm test -- tests/main/ocr-queue.test.ts`. Expected: FAIL, the module doesn't exist.
- [ ] **Step 3: Create `src/shared/scan/ocr.ts`** by moving the logic out of `src/main/scan/ocr.ts`. `PSM` values are plain strings (`'7'` for a single line, `'6'` for a single block), so the shared file doesn't import tesseract.js. Rewrite `createOcr` on top of it. `git mv` the `cardLanguage` file and fix its imports to `./ocr`, `./language`, `./types`.
- [ ] **Step 4: Run** `npm test -- tests/main/ocr-queue.test.ts tests/main/scan-ocr.test.ts tests/main/scan-language.test.ts` and `npm run typecheck`. Expected: PASS. The only changes to `scan-ocr` and `scan-language` are their import paths.
- [ ] **Step 5: Commit** `refactor(scan): OCR queue and card language check move to shared`.

### Task 2: SQLite WASM database with the desktop schema

**Files:**
- Create: `src/main/db/migrateSql.ts`, `src/phone/data/wasmSql.ts`, `src/phone/data/phoneSchema.ts`
- Modify: `src/main/db/database.ts` (`migrate` calls `migrateSql`), `src/main/cloud/engine.ts` (`db: SqlDb`), `tests/main/sql-seam.test.ts` (add `migrateSql.ts`, `catalog/apply.ts`, `catalog/upsert.ts`, `cloud/engine.ts`, `cloud/client.ts`, `cloud/localSync.ts` and `prices/candidates.ts` to the files that must import nothing platform-bound), `package.json` (dependency `@sqlite.org/sqlite-wasm` at the version `npm view` reports, pinned exactly)
- Test: `tests/main/wasm-sql.test.ts` (node environment; sqlite-wasm runs in Node with an in-memory database)

**Interfaces:**
- Produces:
  - `migrateSql(db: SqlDb): void`. It applies every `MIGRATIONS` step above `PRAGMA user_version`, each in its own transaction. `foreignKeysOff` steps toggle `PRAGMA foreign_keys` around their transaction and run `PRAGMA foreign_key_check` before commit. This is the same behaviour as today's `migrate`.
  - `wasmSql(db: Sqlite3Database): SqlDb`:
    - `prepare(sql)` returns `all`/`get`/`run`, binding positional parameters.
    - `run` returns `{ changes, lastInsertRowid }` read from `changes()` and `last_insert_rowid()`.
    - `get` returns `undefined` when there's no row.
    - `transaction(fn)` nests the way better-sqlite3 does: BEGIN/COMMIT at the outermost level, `SAVEPOINT`/`RELEASE` inside, and rollback (to the savepoint) on a throw, which is then rethrown.
  - `openWasmDb(sqlite3: Sqlite3Static, opts: { file?: string; poolUtil?: SAHPoolUtil }): SqlDb`. With `poolUtil` it opens `new poolUtil.OpfsSAHPoolDb(file)`; otherwise `:memory:` (used by tests). It turns on `PRAGMA foreign_keys = ON`, runs `migrateSql`, then `applyPhoneSchema`.
  - `PHONE_FORMAT = 1`, and `applyPhoneSchema(db: SqlDb): void`, which creates:
    - `phone_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
    - `phone_files (name TEXT PRIMARY KEY, etag TEXT, checked_at TEXT NOT NULL, bytes BLOB NOT NULL)`

    It uses `IF NOT EXISTS`. Then it sets `phone_state.format` when missing.
- `cards_fts` (FTS5) must work: the official sqlite-wasm build includes FTS5.

- [ ] **Step 1: Write `tests/main/wasm-sql.test.ts`:**
  - `migrates to the latest desktop version`: `PRAGMA user_version` equals the last `MIGRATIONS` version, and `phone_state.format` is `'1'`.
  - `nested transactions roll back only the inner part`: an outer insert stays, and an inner insert inside a throwing nested transaction is gone.
  - `run reports changes and lastInsertRowid`.
  - `the scan queries run unchanged`: load the `tests/fixtures/cardinfo.sample.json` cards through `applyChanges` (build `CatalogChange` rows from the fixture the way `tests/main/catalog-apply.test.ts` does). Then `printingsByCode`, `matchName` and `cardsForImages` return the same values as on a better-sqlite3 database loaded the same way.
  - `addEntry merges into the live entry`: two `addEntry` calls on the same printing and image give one row with quantity 2 and `dirty = 1`.
  - `searchCards finds a fixture card through cards_fts` after `finishApply`.
- [ ] **Step 2: Run** `npm test -- tests/main/wasm-sql.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `migrateSql`, rewrite `migrate` to call it, change `syncOnce`'s parameter type, then `wasmSql`, `openWasmDb` and `applyPhoneSchema`.
- [ ] **Step 4: Run** `npm test -- tests/main/wasm-sql.test.ts tests/main/database.test.ts tests/main/sql-seam.test.ts tests/main/cloud-sync.test.ts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(phone): SQLite WASM database with the desktop schema`.

### Task 3: Catalog feed table filter and progress

**Files:**
- Modify: `workers/portal/src/catalogFeed.ts`, `src/shared/catalogFeed.ts`, `src/main/cloud/client.ts`
- Test: `tests/portal/catalog-feed.test.ts`, `tests/main/cloud-catalog-client.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/catalog/changes?since=N[&limit=L][&tables=a,b]`. `tables` is a comma list of `CatalogTableName`; an unknown name, an empty item or a repeated name is a 400 `{ error }`. Absent means every table, as today.
  - Rows and tombstones of other tables are left out. `cursor` and `more` are computed over the requested tables only.
  - The response gains `latest: number`, the `catalog_clock` seq.
  - `catalogChanges(db, since, limit, tables?: readonly CatalogTableName[])`.
  - `CloudClient.catalogChanges(since: number, limit?: number, tables?: readonly CatalogTableName[])`.
  - `export const PHONE_TABLES: readonly CatalogTableName[]` in `src/shared/catalogFeed.ts`, with the exact list in Global Constraints.

- [ ] **Step 1: Write the tests:**
  - `tables limits rows and tombstones to the named tables`.
  - `paging with tables reaches every requested row exactly once`: page with `limit=2` until `more` is false; the collected keys equal a single unpaged request.
  - `unknown table is a 400`.
  - `latest is the catalog clock`.
  - Client: `catalogChanges(0, undefined, ['cards'])` sends `tables=cards`.
- [ ] **Step 2: Run** `npm test -- tests/portal/catalog-feed.test.ts tests/main/cloud-catalog-client.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The per-table seq scan already loops over sources, so restrict `sources` and the row loop to the requested tables, and filter tombstones by `tbl IN (…)`.
- [ ] **Step 4: Run** the same tests plus `tests/main/catalog-service.test.ts tests/main/catalog-switch.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): catalog feed can be limited to some tables and reports its latest seq`.

### Task 4: Phone sign-in on the portal and the `/scan/` routes

**Files:**
- Modify: `workers/portal/src/auth.ts`, `workers/portal/src/app.ts`
- Create: `workers/portal/src/phonePage.ts`
- Test: `tests/portal/phone-auth.test.ts`, `tests/portal/phone-page.test.ts`

**Interfaces:**
- Produces:
  - `POST /auth/phone/token`, which needs a valid **web** session cookie, `Origin` equal to `PUBLIC_URL`'s origin, and `content-type: application/json`. It inserts a `'desktop'`-kind session (365-day TTL, as desktop tokens have) and answers `200 { token, user: Me }`. With no or a bad cookie it answers `401 { error: 'signed-out' }`; with the wrong or a missing Origin, `403 { error: 'bad-origin' }`.
  - `GET /auth/discord/start?next=scan` sets the cookie `signin_next=scan` (HttpOnly, Secure, Lax, 600 s). `finishSignIn` (the web branch) then redirects to `/scan/` instead of `/` and clears the cookie. Any other `next` value is ignored. The failed branch with `next` redirects to `/scan/?signin=failed`.
  - `phonePage.ts` exports:
    - `PHONE_CSP` (the exact Global Constraints value).
    - `phoneRoute(req, deps): Promise<Response> | null`. It handles:
      - `GET /scan` → 301 to `/scan/`.
      - `GET /scan/`: the asset `/app/scan/index.html`, with `content-security-policy: PHONE_CSP` and `cache-control: no-cache`.
      - `GET /scan/sw.js`: the asset `/app/scan/sw.js`, with `service-worker-allowed: /scan/`, `content-type: text/javascript` and `cache-control: no-cache`.
      - `GET /scan/manifest.webmanifest`: the asset, with `content-type: application/manifest+json`.

      It returns null for any other path, so `/scan/fingerprints` keeps its handler.
  - `app.ts` calls `phoneRoute` before its other routes.

- [ ] **Step 1: Write the tests** (use `seededServerDb`, `addUser`, and a web session row inserted the way `tests/portal/auth.test.ts` does):
  - `exchanges a web session for a Bearer token that sync accepts`: the token is then accepted by `GET /api/sync/pull`.
  - `rejects a missing cookie (401) and a foreign Origin (403)`.
  - `next=scan returns to /scan/ after Discord` (fake `deps.fetch` for Discord, as the existing auth tests do).
  - `ignores other next values`.
  - `/scan/ is served with PHONE_CSP`.
  - `/scan/sw.js carries service-worker-allowed`.
  - `/scan/fingerprints still serves fingerprints`.
- [ ] **Step 2: Run** `npm test -- tests/portal/phone-auth.test.ts tests/portal/phone-page.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same tests plus `tests/portal/auth.test.ts tests/portal/desktop-auth.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): phone sign-in token and the /scan/ page routes`.

### Task 5: Account deletion and the privacy page

**Files:**
- Create: `workers/portal/src/account.ts`, `workers/portal/src/site/privacy.ts`
- Modify: `workers/portal/src/app.ts`, `workers/portal/src/site/handler.ts`, `src/shared/ipc.ts`, `src/renderer/src/web/httpApi.ts`, `src/main/ipc/handlers.ts`, the preload or `INVOKE_CHANNELS` list, `src/renderer/src/features/settings/AccountSection.tsx`, `tests/renderer/mockApi.ts`
- Test: `tests/portal/account-delete.test.ts`, `tests/portal/site-page.test.ts` (privacy), `tests/renderer/settings.test.tsx` (web delete), `tests/renderer/http-api.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/account/delete` with body `{ "confirm": "delete" }`. It accepts a Bearer token or a web cookie; for a cookie, `Origin` must equal `PUBLIC_URL`'s origin. In one transaction it deletes the user's `collection_entries` and `value_snapshots` rows, then the `users` row. The cascade removes sessions, desktop_codes, friendships, friend_request_log, friend_blocks and printing_contributions. It answers `204` and clears the `session` cookie. Other responses:
    - signed out: `401`
    - wrong body: `400 { error: 'confirm' }`
    - foreign Origin on a cookie request: `403`
  - `Api.account.deleteAccount(): Promise<void>`:
    - Web: POST with the cookie, then `location.assign('/')`.
    - Desktop: rejects with `Error('Delete your account from app.duelbinder.com')`.
    - Phone: Task 8.
  - `WebAccount` gets a "Delete account" button. It opens a dialog: "Delete your Duel Binder account? This removes your synced collection, friends and sign-ins on every device. Desktop apps keep their own copy and are signed out." The buttons are "Delete account" (destructive) and "Cancel".
  - `GET https://duelbinder.com/privacy` serves `renderPrivacy()`. The page uses the site styles and says:
    - what is stored: Discord id, username, display name and avatar; your collection, notes and value history; friends and blocks; sign-in sessions
    - why: to sync and show your binder
    - that nothing is sold or used for ads
    - that there are no third-party trackers
    - that card images are fetched through the portal
    - how to delete (Settings → Delete account, on the web or in the phone app)
    - a contact link to the GitHub repository's issues

    It is marked in a comment as a draft for the owner to read.

- [ ] **Step 1: Write the tests:**
  - `delete removes the user's rows and every session`: a user with entries, snapshots, a friendship and two sessions. Afterwards a count of each table for that user is 0, and another user's rows are untouched.
  - `a deleted user's Bearer token gets 401 on sync`.
  - `wrong confirm is a 400`; `foreign Origin with a cookie is a 403`.
  - `privacy page renders and links home`.
  - Web Settings: `delete asks first, then calls deleteAccount`.
  - Desktop handler: `account:deleteAccount rejects`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -- tests/portal tests/renderer/settings.test.tsx tests/renderer/http-api.test.ts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): account deletion and a privacy page`.

### Task 6: Shared data handlers

**Files:**
- Create: `src/main/ipc/dataHandlers.ts`
- Modify: `src/main/ipc/handlers.ts` (spreads the data handlers), `tests/main/sql-seam.test.ts` (add `dataHandlers.ts` to the platform-free files)
- Test: `tests/main/handlers.test.ts` (unchanged and still passing), new `tests/main/data-handlers.test.ts`

**Interfaces:**
- Produces:
  - `DATA_CHANNELS`: a readonly list of these channels:
    - `cards:search`, `cards:get`, `cards:browse`, `cards:browseFacets`
    - `collection:list`, `collection:forCard`, `collection:add`, `collection:update`, `collection:remove`, `collection:facets`
    - `scan:printingsByCode`, `scan:printingsForSet`, `scan:printingsForCards`, `scan:matchName`, `scan:cardsForImages`
    - `stats:get`
    - `sets:list`, `sets:checklist`, `sets:adjust`
    - `account:unsynced`
  - `type DataChannel = (typeof DATA_CHANNELS)[number]`.
  - `createDataHandlers(deps: { db: SqlDb; onEdit(): void }): Record<DataChannel, (...args: any[]) => Promise<unknown>>`. These are the exact bodies `createHandlers` has today, including the argument checks, `snapshotAfter` on writes, and `onEdit` where it calls `edited`.
- `createHandlers` spreads `createDataHandlers({ db, onEdit: () => account.noteLocalEdit() })` and keeps the remaining channels itself.

- [ ] **Step 1: Write `tests/main/data-handlers.test.ts`:**
  - `covers exactly DATA_CHANNELS`: the keys equal the list.
  - `every data channel is an INVOKE_CHANNELS member`.
  - `collection:add calls onEdit once and records a snapshot`.
  - `scan:cardsForImages rejects non-integer ids`.
- [ ] **Step 2: Run** `npm test -- tests/main/data-handlers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Move** the bodies out of `handlers.ts` into `dataHandlers.ts`.
- [ ] **Step 4: Run** `npm test -- tests/main/data-handlers.test.ts tests/main/handlers.test.ts tests/main/sql-seam.test.ts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(ipc): data handlers move to a platform-free module`.

### Task 7: The phone's data store

**Files:**
- Create: `src/phone/data/store.ts`
- Test: `tests/main/phone-store.test.ts`. It runs in Node over `openWasmDb` (in-memory) against `inProcessPortal()` from `tests/main/cloudHelpers.ts`.

**Interfaces:**
- Consumes:
  - `openWasmDb` and `PHONE_FORMAT` (Task 2)
  - `catalogChanges(…, tables)`, `PHONE_TABLES` and `latest` (Task 3)
  - `createDataHandlers` and `DataChannel` (Task 6)
  - `createCloudClient`, `syncOnce`, `applyChanges`, `finishApply`, `setActiveOwner`, `ensureAccount`, `pendingCount`, `listSyncIssues`, `getMeta` and `setMeta`.
- Produces: `createPhoneStore(deps: { db: SqlDb; portal: string; fetch: typeof fetch; now?: () => Date }): PhoneStore`, where every method is async. **All methods run through one serial queue**, so a catalog fill, a sync and an add never interleave.

  ```ts
  interface PhoneStore {
    account(): Promise<PhoneAccount>          // { state: 'signed-out' } | { state: 'signed-in'; user: Me }
    signIn(token: string, user: Me): Promise<void>   // stores token+user in phone_state, setActiveOwner, ensureAccount
    signOut(): Promise<{ waiting: number }>   // revokes the token (best effort), forgets it; keeps rows
    deleteAccount(): Promise<void>            // POST /api/account/delete with Bearer, then deletes this owner's entries, sync state and token
    catalog(): Promise<CatalogState>          // { filled: boolean; cursor: number; latest: number | null; lastSyncAt: string | null; dbVersion: string | null }
    fillCatalog(onProgress: (p: { cursor: number; latest: number }) => void): Promise<void>
    updateCatalog(opts?: { force?: boolean }): Promise<boolean>  // false when fresh (<24 h) and not forced
    sync(): Promise<PhoneSyncState>           // runs syncOnce; returns the state below
    syncState(): Promise<PhoneSyncState>      // { waiting: number; problems: number; lastSyncedAt: string | null; signedOut: boolean }
    syncProblems(): Promise<UnsyncedEntry[]>
    invoke(channel: DataChannel, args: unknown[]): Promise<unknown>   // runs createDataHandlers; onEdit marks "edited" for syncState
    portal<T>(channel: PortalChannel, args: unknown[]): Promise<T>     // client.rpc with the Bearer token (friends:*)
    fingerprints(): Promise<ArrayBuffer | null>
    refreshFingerprints(): Promise<FingerprintStatus>  // GET /scan/fingerprints with If-None-Match; stored in phone_files 'fingerprints'; at most once a day unless forced
  }
  ```

  `invoke` rejects a channel that isn't in `DATA_CHANNELS`. `portal` throws `CloudOfflineError` offline; the friends page then shows its existing offline message (`OFFLINE_MESSAGE`).

- How it fills and updates the catalog:
  - `fillCatalog` and `updateCatalog` share one page loop: `client.catalogChanges(cursor, undefined, PHONE_TABLES)`.
  - The loop sets `PRAGMA foreign_keys = OFF` before it starts and restores ON in `finally`, so a page whose rows point at a later page commits (see the `pullDeltas` comment in `catalog/service.ts` for why).
  - Each page runs in its own transaction: `applyChanges`, then `setMeta('catalog_cursor')`.
  - After the last page it runs `finishApply` (with cardsChanged when any page changed cards) and sets `db_version` and `last_sync_at`. Then `fillCatalog` runs one `syncOnce`, so the user's existing entries are on the phone before the first scan. Only when that sync succeeds does it set `phone_state.catalog_filled = '1'`. Offline at that point, it throws `CloudOfflineError`, and the first-run screen offers Retry.
  - Before filling, if `phone_state.format` is older than `PHONE_FORMAT`, it deletes the rows of the catalog tables that no collection entry uses, resets `catalog_cursor` to 0, and writes the new format. Collection rows are never touched.
- Sync and the session:
  - `sync` turns `CloudAuthError` into `signedOut: true` and keeps every row; the UI returns to sign-in. `CloudOfflineError` returns the current state unchanged.
  - The Bearer token is read from `phone_state.token` on each call.

- [ ] **Step 1: Write the tests** (fixture-sized data only):
  - `fill downloads the phone tables page by page and reports progress` (`limit` small via a fetch wrapper that adds `&limit=50`). Afterwards `invoke('scan:printingsByCode', [code])` finds a fixture code, and progress calls are increasing.
  - `collection:update and collection:remove through invoke sync to the server`: a quantity change and a removal (tombstone) reach `serverDb`.
  - `portal('friends:overview') sends the Bearer token`.
  - `resumes a fill after a failed page`: a fetch that throws on page 3. The cursor stays at page 2's value, and a second fill finishes and asks from that cursor.
  - `update applies a later server change and a tombstone`.
  - `add then sync puts the entry on the server`: `serverDb` has the entry with that uid.
  - `an add made before a failed push syncs once on the next run`: an offline fetch first, then a real one. The server has quantity 1, not 2.
  - `an offline add of a card the server already holds merges on sync`: the server has entry uid B, quantity 2, for the same printing and image (seeded through another token's push). The phone syncs once, then adds 1 offline, then syncs. Afterwards there is one live entry, uid B, with quantity 3, both on the phone and on the server. This holds because the add raised the pulled entry: today's sync rules keep only the later of two *different* uids on one printing and art, they don't add them up. That's why first run does an initial sync (below).
  - `first run is not done until the first sync has pulled the collection`: `catalog().filled` stays false until `sync()` has succeeded once after the fill.
  - `a 401 on sync reports signed-out and keeps dirty rows`.
  - `sign out keeps waiting adds for the same user`: after signing back in as the same user, sync pushes them.
  - `delete account removes this owner's rows and the token` (the server side is covered in Task 5).
  - `fingerprints are downloaded once and then revalidated with If-None-Match`, with a 304 path.
  - `an older format resets the catalog but keeps collection entries`.
- [ ] **Step 2: Run** `npm test -- tests/main/phone-store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `createPhoneStore`.
- [ ] **Step 4: Run** `npm test -- tests/main/phone-store.test.ts tests/main/sql-seam.test.ts` and `npm run typecheck`. Expected: PASS. Add `tests/main/phone-store.test.ts`'s imports of `src/phone/data/*` to `tsconfig.node.json`'s include list if typecheck needs it.
- [ ] **Step 5: Commit** `feat(phone): data store for the card catalog, adds and sync`.

### Task 8: Worker protocol, browser OCR and the phone `Api`

**Files:**
- Create: `src/phone/data/protocol.ts`, `src/phone/data/worker.ts`, `src/phone/ocr.ts`, `src/phone/api.ts`, `src/phone/syncTriggers.ts`
- Modify: `src/renderer/src/lib/platform.ts` (`isWeb` covers `'phone'`, new `isPhone`), `src/renderer/src/lib/images.ts` (`printingImageSrc` returns `string | null`, and `null` on the phone), `src/renderer/src/components/CardArt.tsx` (no printing scan when the src is null); add cases to `tests/renderer/images.test.ts` and `tests/renderer/card-art.test.tsx`
- Test: `tests/renderer/phone-api.test.ts`, `tests/renderer/phone-protocol.test.ts`, `tests/renderer/phone-sync-triggers.test.ts`

**Interfaces:**
- Consumes: `PhoneStore` (Task 7), `createOcrQueue`, `checkOcrBands` and `cardLanguage` (Task 1).
- Produces:
  - `exposeStore(store: PhoneStore, port: MessagePortLike): void` and `connectStore(port: MessagePortLike): PhoneStore`. Requests are `{ id, method, args }`; replies are `{ id, ok: true, value } | { id, ok: false, error: { name, message } }`. The error `name` is preserved, so `CloudAuthError` survives. An `ArrayBuffer` value is transferred. `fillCatalog`'s progress callback is sent as `{ id, progress }` messages.
  - `worker.ts`: `sqlite3InitModule()`, then `installOpfsSAHPoolVfs({ name: 'duel-binder' })`, then `openWasmDb(sqlite3, { file: '/duel-binder.db', poolUtil })`, then `createPhoneStore({ portal: self.location.origin, fetch })`, then `exposeStore`. If opening fails, it posts `{ fatal: message }`.
  - `createBrowserOcr(base: string): Ocr`. It uses `createOcrQueue` with tesseract.js `createWorker(model, OEM.LSTM_ONLY, { workerPath: base + 'ocr/worker.min.js', corePath: base + 'ocr/core/', langPath: base + 'ocr/lang/', workerBlobURL: false, gzip: true, cacheMethod: 'write' })`. The browser caches the language data in IndexedDB, so non-English models download on first use only.
  - `createPhoneApi(deps: { store: PhoneStore; ocr: Ocr; triggers: { afterAdd(): void }; events: PhoneEvents }): Api`, where `PhoneEvents` is a small emitter with `dataChanged`, `syncStatus` and `account` events, raised by the sync triggers and the catalog update:
    - Every `DATA_CHANNELS` method goes to `store.invoke(channel, args)`, built from the list, so a channel added there is wired automatically.
    - `scan.ocr` runs `checkOcrBands`, then `ocr.read`. `scan.language` runs `cardLanguage(ocr, bands)`. `scan.fingerprints` and `scan.refreshFingerprints` go to the store.
    - `friends.*` goes to `store.portal`. `friends.collection` maps entries to `originalArt: false`, as the desktop handler does.
    - `stats`, `sets` and `collection` writes call `triggers.afterAdd()` once they resolve (the name stays; it means "after a local edit").
    - `sync.status` returns a `SyncStatus` built from `store.catalog()`; `sync.run` calls `updateCatalog({ force: true })`; `sync.onProgress` and `app.onDataChanged` are fed by the phone's own events (`dataChanged` after a sync or update that changed something).
    - `account.status` returns an `AccountStatus` built from `store.account()` and `syncState()`, with `signInRequired: true`. `account.unsynced` goes to `syncProblems`. `account.syncNow` runs a sync. `account.deleteAccount` goes to `store.deleteAccount`.
    - `app.version` returns the build's `__APP_VERSION__` (from `package.json`, via `define`).
    - `scanWindow`: `isOpen` resolves false; `open`, `toggleFullScreen` and `send` do nothing; `onMessage` and `onOpenChange` return an unsubscribe that does nothing.
    - `window.platform` is `'phone'`; the window controls do nothing.
    - `images.cacheSize` resolves 0 and `images.clearCache` does nothing.
    - `app.openDataFolder`, `app.backupDatabase`, `app.checkForUpdates` and `app.applyUpdate` reject with `Error('Not in the phone app')`; `app.updateStatus` returns the idle status `httpApi` uses.
  - `createSyncTriggers(deps: { sync(): Promise<unknown>; online(): boolean; on(event: 'online' | 'visible', cb: () => void): () => void; setTimer: typeof setTimeout; clearTimer: typeof clearTimeout }): { afterAdd(): void; dispose(): void }`. It syncs:
    - 2 s after the last `afterAdd`
    - on `online`
    - on becoming visible
    - every 5 minutes while visible

    One sync runs at a time, and a trigger during a sync schedules one more run.

- [ ] **Step 1: Write the tests:**
  - Api: `every DATA_CHANNELS method calls store.invoke with its channel`; `friends.collection clears originalArt`; `collection.update triggers one sync`.
  - Protocol, over a `MessageChannel` with a fake store: values round-trip, `CloudAuthError`'s name survives, and progress callbacks arrive in order.
  - Api: `scan.ocr rejects malformed bands`; `scan.language uses cardLanguage`; `scanWindow.isOpen is false`; `collection.add calls store.invoke('collection:add')`; `collection.list rejects`.
  - Triggers (fake timers): `two adds within 2 s give one sync`; `online triggers a sync`; `a trigger during a sync gives exactly one more`.
- [ ] **Step 2: Run** `npm test -- tests/renderer/phone-api.test.ts tests/renderer/phone-protocol.test.ts tests/renderer/phone-sync-triggers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(phone): worker protocol, browser OCR and the phone api`.

### Task 9: Phone shell, sign-in, first run and the scanner

**Files:**
- Create: `src/phone/PhoneShell.tsx`, `src/phone/App.tsx`, `src/phone/SignIn.tsx`, `src/phone/FirstRun.tsx`, `src/phone/ScannerScreen.tsx`, `src/phone/PhoneCamera.tsx`, `src/phone/StatusLine.tsx`, `src/phone/Settings.tsx`
- Modify: `src/renderer/src/features/scan/useCamera.ts` (add `facing?: 'environment'`; when set and no deviceId, add `facingMode: { ideal: 'environment' }`; desktop callers pass nothing)
- Test: `tests/renderer/phone-app.test.tsx`, `tests/renderer/phone-scanner.test.tsx`, plus `use-camera` cases added to the existing scan page tests or a new `tests/renderer/use-camera.test.ts`

**Interfaces:**
- Consumes: `PhoneStore` via `connectStore`, the phone `Api`, `ScanHubProvider`/`useScanHub`, `SessionList`, `SearchPicker`, `useScanLoop`, `statusText`, `NO_FINGERPRINTS`, `defaultEngine`, and `createSyncTriggers`.
- Produces: `App({ store, onFatal })`. It is a state machine:
  1. **loading**
  2. **unsupported**: the data worker reported `fatal`. Text: "This browser can't run Duel Binder. On iPhone, update to iOS 17 or later; otherwise use Chrome or Safari."
  3. **signed-out**: `SignIn`. On mount it calls `fetch('/api/me')` with the cookie. On 200 it posts `/auth/phone/token` (same origin, JSON), then `store.signIn`. Otherwise it shows the copy and a "Sign in with Discord" link to `/auth/discord/start?next=scan`. `?signin=failed` shows "Sign-in didn't go through. Try again."
  4. **first-run**: `FirstRun` while `catalog().filled` is false. It shows the size copy, then a progress bar driven by `cursor / latest`. On failure it shows "Download stopped. It will pick up where it left off." with a Retry button. It also refreshes fingerprints.
  5. **ready**: `PhoneShell` inside `ScanHubProvider`, `QueryClientProvider` and the `Toaster`.
- `PhoneShell({ page, onNavigate })`:
  - It renders the desktop pages by `Page` exactly the way `SignedInApp` in `src/renderer/src/App.tsx` does (same props, the same `AddCardDialog` state, `useDataChanged`), plus `ScannerScreen` for `'scan'`.
  - At the bottom is a fixed tab bar with `env(safe-area-inset-bottom)` padding: Home (`dashboard`), Collection, Scan (raised, in the middle), Sets, More.
  - More opens a sheet with Browse, Friends and Settings.
  - The phone opens on Scan.
  - `Settings` here is the phone's `Settings` below, not the desktop `SettingsPage`.
  - `StatusLine` sits under the top edge of every page, not only Scan.
  - Moving the shared page switch into `src/renderer/src/components/pageSwitch.tsx` so both shells use it is fine, as long as the desktop `App` renders the same.
- `ScannerScreen` layout:
  - `PhoneCamera` at the top: the video plus the outline overlay and the status from `useScanLoop`, sized to the screen width at 3:4. It is the same rendering as `InPageScanner` without its desktop sizing, using `useCamera(settings.deviceId, 'environment')`.
  - A bottom sheet holding `SessionList`. It is collapsed to a "N scanned · Review" bar and drags or taps up to about 85% of the height.
  - A torch button on the camera, shown only when `track.getCapabilities().torch` is true (Android Chrome). It toggles `track.applyConstraints({ advanced: [{ torch }] })`. iPhone shows no button.
  - A compact row with the "Set" and "New scans as" pickers, using the same `SearchPicker` options the desktop `ScanPage` builds. Moving those option builders into `src/renderer/src/features/scan/pickerOptions.ts` is fine, as long as `ScanPage` keeps rendering the same thing.
  - `StatusLine` under the camera.
  - A gear icon that opens `Settings`.
- `StatusLine` uses `syncState()` (polled every 5 s and after each sync) plus `navigator.onLine`, and the exact strings from Global Constraints. It also shows the storage warning when `navigator.storage.persisted()` is false and `waiting > 0`. On first ready it calls `navigator.storage.persist()` once.
- `Settings` (a full-screen panel) offers:
  - The signed-in name, and "Sign out". When adds are waiting it first asks: "N cards haven't synced yet. They'll sync if you sign back in as <name>."
  - "Refresh card data", which runs `updateCatalog({ force: true })` and `refreshFingerprints` with progress.
  - "Sync problems (N)", which lists the `syncProblems()` names and reasons.
  - "Delete account", which uses the same confirmation text as Task 5. Afterwards it shows the signed-out screen.
  - A "Privacy" link to `https://duelbinder.com/privacy`.
  - The card data date and app version.
- Sign-out also POSTs `/auth/logout`, so the cookie doesn't sign the user straight back in.
- `SessionList`'s commit calls `api.collection.add` per row; the 2 s debounce in the sync triggers turns a whole commit into one sync.

- [ ] **Step 1: Write the tests** (with a fake `PhoneStore`; mock `fetch` for `/api/me` and `/auth/phone/token`):
  - `shows the unsupported screen when the data worker fails to open`.
  - `every tab opens its page`: Home, Collection, Sets, and Browse, Friends and Settings through More, each render with a fake store holding fixture data, and without errors.
  - `opens on Scan`.
  - `signs in from an existing web session without a click`.
  - `signed out shows the Discord link with next=scan`.
  - `first run shows progress then the scanner`.
  - `first run failure offers Retry and resumes`.
  - `status line shows Offline · 2 waiting to sync`.
  - `sign out warns when adds are waiting`.
  - `delete account asks first and returns to sign-in`.
  - `Add to collection adds each row through the store and triggers one sync`.
  - `useCamera with 'environment' asks for the rear camera; without it, constraints are unchanged`.
  - `torch button shows only when the track reports torch`.
- [ ] **Step 2: Run** `npm test -- tests/renderer/phone-app.test.tsx tests/renderer/phone-scanner.test.tsx tests/renderer/use-camera.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use the existing Tailwind/shadcn components and the desktop's dark theme from `src/renderer/src/index.css`.
- [ ] **Step 4: Run** those tests plus `tests/renderer/scan-page.test.tsx tests/renderer/scan-session.test.ts`. Expected: PASS, and the desktop scan tests are unchanged.
- [ ] **Step 5: Commit** `feat(phone): sign-in, first run, scanner and settings screens`.

### Task 10: Phone layouts: Home, Collection and adding cards

**Files:**
- Modify (only `max-md:` variants or `isPhone()` branches): `src/renderer/src/features/dashboard/DashboardPage.tsx`, `src/renderer/src/features/collection/*` (page, grid, table, `EntryDetailPanel`), `src/renderer/src/features/add-card/AddCardDialog.tsx`, `src/renderer/src/components/PageHeader.tsx`, `src/renderer/src/components/CardSheet.tsx`, and any shared component they need
- Test: `tests/renderer/phone-layout.test.tsx` (new), plus the existing page tests unchanged

**What each page does under 768 px:**
- **Home:** the stat tiles go into a 2-column grid, the value chart takes the full width, and recent cards scroll horizontally.
- **Collection:**
  - The grid is the default view, at 3 columns. The table view is hidden; the view toggle goes, since the table needs desktop width.
  - Filters and the facet menu open from one "Filters" button as a bottom sheet.
  - Tapping a card opens `EntryDetailPanel` as a full-screen sheet with a back button, instead of the side panel.
  - Quantity, printing and notes editing work there as on desktop.
- **Adding cards:** `AddCardDialog` goes full-screen, with the search field at the top and the keyboard-safe bottom inset.
- `PageHeader` actions wrap under the title, and buttons that only make sense with a keyboard (Ctrl+K hints) are hidden.

- [ ] **Step 1: Write `tests/renderer/phone-layout.test.tsx`.** It sets platform `'phone'` through the mock api and checks the `isPhone()` branches; the CSS-only `max-md:` parts are checked by eye in Task 13:
  - `collection opens an entry in a full-screen sheet with a back button`.
  - `collection hides the table view toggle on the phone`.
  - `add card dialog is full-screen on the phone`.
- [ ] **Step 2: Run** `npm test -- tests/renderer/phone-layout.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -- tests/renderer`. Expected: PASS, with every existing renderer test unmodified.
- [ ] **Step 5: Commit** `feat(phone): phone layouts for home, collection and adding cards`.

### Task 11: Phone layouts: Sets, Browse, Friends

**Files:**
- Modify (same rule): `src/renderer/src/features/sets/*` (list, checklist, `SetCardPanel`, filter panel, bulk tools), `src/renderer/src/features/browse/*`, `src/renderer/src/features/friends/*` (list, `FriendEntryPanel`)
- Test: add cases to `tests/renderer/phone-layout.test.tsx`

**What each page does under 768 px:**
- **Sets:**
  - The set list is a single column, and its filter panel opens as a bottom sheet.
  - A checklist shows its cards in 3 columns.
  - `SetCardPanel` opens as a full-screen sheet, and the +/− adjust buttons stay reachable.
  - The bulk tools stay available from a "⋯" menu.
- **Browse:** the facet filters open as a bottom sheet; results show in 3 columns; card details open full-screen.
- **Friends:** the friend list and requests come first, a friend's binder uses the Collection phone grid, and `FriendEntryPanel` opens full-screen. When offline it shows the page's existing offline message.

- [ ] **Step 1: Write the tests:**
  - `set card panel opens full-screen on the phone`.
  - `browse filters open as a sheet on the phone`.
  - `friend entry opens full-screen on the phone`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -- tests/renderer`. Expected: PASS, existing tests unmodified.
- [ ] **Step 5: Commit** `feat(phone): phone layouts for sets, browse and friends`.

### Task 12: Build, service worker and install

**Files:**
- Create: `vite.phone.config.ts`, `tsconfig.phone.json`, `src/phone/index.html`, `src/phone/main.tsx`, `src/phone/sw.ts`, `src/phone/public/manifest.webmanifest`, `src/phone/public/icon-192.png`, `src/phone/public/icon-512.png` (generated from `resources/icon.png` with the same tool `scripts/site/` uses, or ImageMagick)
- Modify:
  - `package.json`: add `"build:phone": "vite build --config vite.phone.config.ts"` and `"typecheck:phone": "tsc --noEmit -p tsconfig.phone.json --composite false"`; `typecheck` also runs `typecheck:phone`.
  - `workers/portal/package.json`: `deploy` runs `build:web` and `build:phone` before `wrangler deploy`.
  - `CLAUDE.md`: drop "Mobile version" from Out of scope, and add a Goals line: "Phone scanner at app.duelbinder.com/scan/ (home-screen web app; store apps later)".
- Test: `tests/main/phone-build.test.ts`

**Interfaces:**
- `vite.phone.config.ts` sets:
  - `root: src/phone`, `base: '/app/scan/'`, `outDir: workers/portal/site/app/scan`, `emptyOutDir: true`.
  - The aliases `@` and `@shared`.
  - `worker.format: 'es'`.
  - `optimizeDeps.exclude: ['@sqlite.org/sqlite-wasm']`.
  - Two plugins:
    - **`no-node-builtins`**: `resolveId` throws for `node:*`, the Node builtin names, `electron` and `better-sqlite3`, naming the importer.
    - **`ocr-assets`**: `generateBundle` emits:
      - `ocr/worker.min.js` from `tesseract.js/dist/worker.min.js`
      - `ocr/core/` ← `tesseract-core-lstm.wasm.js`, `tesseract-core-simd-lstm.wasm.js`, `tesseract-core-relaxedsimd-lstm.wasm.js`
      - `ocr/lang/<model>.traineddata.gz` from each `@tesseract.js-data/<model>/4.0.0_best_int`, for eng, jpn, kor and chi_sim
  - The service worker is a second input built to `sw.js` at the output root, not hashed.
- `index.html` has no CSP meta tag (the header from Task 4 is the only CSP), has the manifest link and `apple-mobile-web-app-capable`, uses viewport `width=device-width, initial-scale=1, viewport-fit=cover`, and registers `/scan/sw.js` with scope `/scan/`.
- `sw.ts` works like this:
  - At build time it gets a precache list of every emitted file except `ocr/lang/{jpn,kor,chi_sim}*`. Inject it with a `define` from the bundle in a final `writeBundle` step, or write `precache.json` and fetch it at install. Pick one and test it.
  - Install opens the cache `scan-<build hash>` and adds the list plus `/scan/`. Activate deletes old `scan-*` caches.
  - Fetch:
    - navigation to `/scan/`: network first, falling back to the cached `/scan/`
    - `/app/scan/*`: cache first
    - `/img/small/*`: cache first into `scan-img`, kept to at most 2000 entries
    - `/api/*`, `/auth/*`, `/scan/fingerprints`: network only (the store handles offline)

- [ ] **Step 1: Write `tests/main/phone-build.test.ts`.** It runs `npm run build:phone` once in `beforeAll`, with a 180 s timeout:
  - `output has index.html, sw.js, manifest and the OCR assets`.
  - `no file references cdn.jsdelivr.net`.
  - `the manifest has start_url and scope /scan/`.
  - `a Node builtin import fails the build`: run vite's `build()` on a temporary entry that imports `node:fs` through the config's plugins, and expect a rejection naming `node:fs`.
- [ ] **Step 2: Run** `npm test -- tests/main/phone-build.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -- tests/main/phone-build.test.ts`, `npm run typecheck` and `npm run lint`. Expected: PASS. Then run `npm test` (the whole suite, `--maxWorkers=2`). Expected: PASS.
- [ ] **Step 5: Commit** `build(phone): phone build, service worker and home-screen manifest`.

### Task 13: Browser check, then the owner's phone check (ask the owner)

**Files:** none, unless the checks find something; fixes are committed as `fix(phone): …`.

- [ ] **Step 1: Local browser check.** Build both web builds, then run `cd workers/portal && npx wrangler dev`. Open `http://localhost:8787/scan/` in Chrome through the chrome-devtools MCP, with phone emulation. Expected:
  - The signed-out screen renders.
  - `list_console_messages` shows no CSP violations.
  - The service worker registers with scope `/scan/`.
  - Evaluating `navigator.storage.getDirectory()` resolves.
  - The data worker opened (no `fatal`).
  - Loading the OCR worker and OpenCV from the page shows no CSP error. To check this, temporarily evaluate `import('/app/scan/…')` for the engine chunk, or expose a `?check` query that starts `defaultEngine()` and one `createBrowserOcr` read of a blank band and prints "check ok".
- [ ] **Step 1b: Layout check.** In the same session at 390×844, take a screenshot of every page (Home, Collection with an entry open, Scan, Sets with a checklist and the card panel, Browse, Friends, Settings) with the phone api's demo data. To get that data, run `?demo` in dev builds only: it fills the in-memory database from `tests/fixtures/cardinfo.sample.json` and adds a few entries, and it is stripped from production by `import.meta.env.DEV`. Fix anything cut off or overlapping. Show the screenshots to the owner before Step 2.
- [ ] **Step 2: Ask the owner** to approve deploying the portal (`cd workers/portal && npm run deploy`). Say:
  - It adds the unlinked `/scan/` page, the token exchange, the feed filter, account deletion and the privacy page.
  - There are no server migrations.
  - The privacy page text is a draft for them to read.

  Do not deploy without a yes.
- [ ] **Step 3: After the deploy,** ask the owner to try it on their iPhone:
  1. Open `app.duelbinder.com/scan/` in Safari, sign in, add it to the home screen, and open it from there.
  2. Let the first run finish. Note how long it took.
  3. Scan a few cards and add them. Check that they appear in the desktop app after it syncs.
  4. Turn on airplane mode, scan and add one card, see "Offline · 1 waiting to sync", turn airplane mode off, and see "All synced".
  5. Check Settings: sign out (and the warning if anything is waiting), sign back in, and look at the privacy link.
  6. Go through Home, Collection (open a card, change its quantity), Sets (open a checklist), Browse and Friends. Change a quantity in airplane mode and see it sync afterwards.

  Record their findings in the ledger. Anything that breaks gets a fix task before this plan is called done.
- [ ] **Step 4: Commit** any fixes; no release tag (the web app ships with the portal deploy).
