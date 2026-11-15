# Catalog snapshots and image cache limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first pull of Pokémon, One Piece or Magic imports one prebuilt SQLite file from R2 in
short worker batches, and the image folder keeps owned art plus at most 1 GB of everything else.

**Architecture:** The shared code defines a catalog "shape" hash and the R2 key layout. The portal
does three things: it lets the admin token read the feed; it serves a manifest with a signed URL
(the manifest route needs a desktop session, so it runs in the DO); and it serves and stores the
files from the Worker entry (R2 only, never the DO). The desktop gains `exportSnapshot`, a
`'snapshot'` apply-job kind for the import, and a `pullGame` that tries a snapshot before the
feed. The nightly job builds each game by running that same desktop first pull into a fresh
database, then exports, gzips and uploads it. The image cache records last use in the file's
mtime, and a separate evictor deletes the oldest files that aren't owned.

**Tech Stack:** Electron main + better-sqlite3 (worker thread from #318), Cloudflare Worker +
Durable Object + R2, GitHub Actions (`catalog.yml`, `npm run catalog:job`), vitest
(`--maxWorkers=2`), Node `zlib` gzip and `crypto` sha256, WebCrypto HMAC in the Worker.

**Spec:** `docs/superpowers/specs/2026-11-15-catalog-snapshot-and-image-cap-design.md`

## Global Constraints

- Snapshot games: `pkm`, `op`, `mtg` only. No Yu-Gi-Oh! snapshot.
- Snapshot used only when the game's cursor and staging cursor are both null and the game has no
  `cards` rows, and a manifest exists for the app's shape. Any failure falls back to the feed.
- The cursor is set only in the import's final transaction.
- Import batches of about 5,000 rows per transaction, with a pause after each batch as long as the
  batch took (same `pause` as #318). `INSERT OR IGNORE`. Copy parent tables before child tables.
  Leave `id` out of `card_printings`.
- R2 layout: `catalog-snapshots/<game>/<shape>/manifest.json` and
  `catalog-snapshots/<game>/<shape>/<cursor>.sqlite.gz`. Files the manifest doesn't name are
  deleted once they are 7 days old.
- Signed download URL valid for 1 hour. HMAC-SHA256 keyed from `ADMIN_TOKEN` with the label
  `catalog-snapshot-url`.
- The feed accepts `Authorization: Bearer <ADMIN_TOKEN>` for `changes` only, as an account with
  every game.
- Image budget: 1 GB (`1_000_000_000`) for files that aren't owned; trim to 900 MB
  (`900_000_000`). Eviction first runs 3 minutes after launch, then after every 100 MB
  (`100_000_000`) of new downloads. Last use is the mtime, refreshed when a file is served and
  its mtime is more than 24 h old.
- Owned = live `collection_entries` (`deleted_at IS NULL`, any `owner_id`): their `image_id` art
  in `small/`, `full/` and `cropped/`, and their printing's photo key in `printings/` and
  `printings-small/`.
- No vitest fixture over a few hundred rows. Benchmarks go in a standalone script of at most 50k
  rows.
- vitest always runs with `--maxWorkers=2`. Run `typecheck:node`, `typecheck:web` and
  `typecheck:phone` separately.
- Work in the worktree `/var/tmp/db-snapshot` (branch `feat/catalog-snapshot`).
- Deploy order: Worker, then the CI run, then the app release.

## Review Focus

1. **A quit or crash mid-import, then a relaunch.** The import resumes from
   `catalog_snapshot:<game>` without duplicates, and the cursor is set only at the end. Task 3
   test `resumes an import stopped partway`.
2. **A download cut off or a signed URL expiring mid-download.** The `.part` file resumes with
   `Range`, and a checksum mismatch deletes the file and falls back to the feed. Task 4 tests
   `resumes a partial download` and `falls back to the feed on a bad checksum`.
3. **The game gets a cursor some other way while the snapshot downloads**, for example a forced
   update queued behind the current one. Re-check the qualifying conditions right before the
   import starts. Task 4 test `skips the snapshot when the game was pulled meanwhile`.
4. **Owned art evicted because a printing's photo key lookup throws** (database busy). Eviction
   must skip that run, not treat the photo as unowned. Task 6 test
   `skips eviction when owned keys can't be read`.
5. **A file served during eviction.** In-flight keys and `.tmp` files are never deleted, and a
   missing file is a cache miss that downloads again. Task 6 test
   `leaves tmp and in-flight files alone`.

---

### Task 1: Shared snapshot shape and keys

**Files:**
- Create: `src/shared/catalogSnapshot.ts`
- Test: `tests/shared/catalog-snapshot.test.ts`

**Interfaces:**
- Produces:
  - `SNAPSHOT_GAMES: readonly GameId[]` = `['pkm','op','mtg']`.
  - `catalogShape(): string`: 8 hex characters, FNV-1a 32-bit over a canonical JSON of
    `CATALOG_TABLES` (`name`, `key`, `columns`, `games`) plus the printing feed's extra columns
    `['id','pkey','contributed']`. No Node imports, because the Worker uses it.
  - `snapshotManifestKey(game, shape): string`
  - `snapshotFileKey(game, shape, cursor): string`
  - `interface SnapshotManifest { game: GameId; shape: string; cursor: number; dbVersion: string | null; bytes: number; sha256: string; builtAt: string; key: string }`
  - `interface SnapshotOffer extends SnapshotManifest { url: string }`

- [ ] **Step 1: Write the failing tests**
  - `catalogShape is stable and 8 hex chars`: `expect(catalogShape()).toMatch(/^[0-9a-f]{8}$/)`,
    and the same value when called twice.
  - `keys follow the R2 layout`: `snapshotFileKey('mtg','abcd1234',42)` equals
    `'catalog-snapshots/mtg/abcd1234/42.sqlite.gz'`, and `snapshotManifestKey('mtg','abcd1234')`
    equals `'catalog-snapshots/mtg/abcd1234/manifest.json'`.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/shared/catalog-snapshot.test.ts`.
  Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `src/shared/catalogSnapshot.ts`.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(catalog): shared snapshot shape and R2 keys`.

### Task 2: Portal routes

**Files:**
- Modify: `workers/portal/src/catalogFeed.ts` (`catalogRoute`: admin token for `changes`; new
  path `snapshot/<game>`)
- Create: `workers/portal/src/catalogSnapshot.ts` (signing, file serving, admin upload)
- Modify: `workers/portal/src/index.ts` (call `catalogSnapshotRoute` before the
  `thumbsRoute`/`edgeImage` chain)
- Modify: `workers/portal/src/app.ts` (`AppDeps` already has `images` and `ADMIN_TOKEN`; pass
  through what the route needs)
- Test: `tests/portal/catalog-snapshot.test.ts`, and extend `tests/portal/catalog-feed.test.ts`

**Interfaces:**
- Consumes: Task 1, `adminAuthorized` (`workers/portal/src/thumbs.ts:39`), `currentUser` and
  `gamesFor` (`auth.ts`).
- Produces:
  - `signSnapshotUrl(origin, key, adminToken, now): Promise<string>`, which builds
    `${origin}/api/catalog/snapshot-file/<key>?exp=<unix s>&sig=<base64url HMAC of "key\nexp">`.
  - `catalogSnapshotRoute(req, bucket, adminToken, now = Date.now): Promise<Response | null>`
    handles:
    - `GET /api/catalog/snapshot-file/<key>?exp&sig`: checks the signature and expiry (403 when
      either is bad), supports `Range` (206 with `content-range`), and sends `content-length` and
      `content-type: application/gzip`.
    - `POST /api/admin/catalog-snapshot/upload?key=<key>`: admin only; starts a multipart upload
      and returns `{uploadId}`.
    - `PUT /api/admin/catalog-snapshot/upload?key&uploadId&part=<n>`: admin only; the body is one
      part (CI sends 50 MB parts); returns `{etag}`.
    - `POST /api/admin/catalog-snapshot/complete?key&uploadId`: admin only; the body is
      `{parts:[{partNumber,etag}]}`.
    - `PUT /api/admin/catalog-snapshot/manifest`: admin only; the body is a `SnapshotManifest`.
      It checks that the object at `key` exists with that size, writes the manifest, then deletes
      files under `catalog-snapshots/<game>/<shape>/` that aren't `key` and were uploaded more
      than 7 days ago.
    - Anything else: `null`.
  - `GET /api/catalog/snapshot/<game>?shape=<s>` (in `catalogRoute`): needs a desktop session
    or the admin token. Returns 404 `{error:'none'}` when there is no manifest for that shape;
    otherwise the `SnapshotOffer` JSON.

- [ ] **Step 1: Write the failing tests** (use the in-memory bucket fake already used by
  `thumbs.test.ts`, extended with `createMultipartUpload`, `resumeMultipartUpload`, `head`,
  `list` and `delete` as needed):
  - `the feed answers the admin token`: `GET /api/catalog/changes?since=0&game=mtg` with the
    admin bearer returns 200, and the same request with a wrong token returns 401.
  - `the admin token cannot contribute`: `POST /api/catalog/contribute` with the admin bearer
    returns 401.
  - `offers the manifest for the shape with a signed url`: returns 200, `url` starts with
    `${origin}/api/catalog/snapshot-file/catalog-snapshots/mtg/`, and `cursor` matches the
    manifest.
  - `404 when no manifest for that shape`.
  - `signed file: 200 whole, 206 with Range, 403 when expired or tampered`: a request one second
    after `exp` gets 403; changing one character of `sig` gets 403; `Range: bytes=10-` returns
    206 and the body from byte 10.
  - `admin upload in parts then publish`: the file stored equals the concatenated parts and the
    manifest is readable. Without the admin token, every admin path returns 401.
  - `publishing prunes files older than 7 days that the manifest does not name`: a key uploaded 8
    days ago is deleted, one uploaded 1 day ago is kept, and the published file is kept.
- [ ] **Step 2:** Run
  `npx vitest run --maxWorkers=2 tests/portal/catalog-snapshot.test.ts tests/portal/catalog-feed.test.ts`.
  Expected: the new tests FAIL.
- [ ] **Step 3:** Implement. For the admin feed reader, `gamesFor` is replaced by every
  `GameId`.
- [ ] **Step 4:** Run the tests again. Expected: PASS. Then run the whole `tests/portal` folder.
  Expected: PASS.
- [ ] **Step 5:** Commit: `feat(portal): catalog snapshot manifest, signed file route, admin upload; admin token reads the feed`.

### Task 3: Snapshot export and the worker import job

**Files:**
- Create: `src/main/catalog/snapshot.ts`
- Modify: `src/main/catalog/applyJob.ts` (job kind `'snapshot'`)
- Modify: `src/main/db/meta.ts` (`MetaKey` += `` `catalog_snapshot:${'pkm'|'op'|'mtg'}` ``)
- Test: `tests/main/catalog-snapshot.test.ts`

**Interfaces:**
- Consumes: Task 1 `catalogShape`; #318's `runApplyJob`, `ApplyJobOptions` (`chunk`, `pause`,
  `immediate`), `withoutForeignKeys` and `noteUnannounced`.
- Produces:
  - `snapshotTables(game): CatalogTable[]`: the `CATALOG_TABLES` rows listing `game`, ordered
    parent first (`cards` first, `card_printings` before tables that reference it, anything else
    after).
  - `exportSnapshot(db, game, file, info: {cursor: number; dbVersion: string | null}): Record<string, number>`.
    It writes a new file with each table's non-generated columns (`PRAGMA table_xinfo`, hidden =
    0), filtered by `game = ?` where a `game` column exists (otherwise every row, since CI builds
    each game in its own database). `card_printings` leaves out `id`. It adds a `snapshot_meta`
    table with one row (`game`, `cursor`, `db_version`, `shape`, `built_at`, `counts` JSON),
    then runs `VACUUM`. It returns the row count per table.
  - `snapshotKey(game): MetaKey` gives `catalog_snapshot:<game>`, whose value is the JSON
    `{cursor, file, dbVersion, table, after}`.
  - `CatalogApplyJob` gains `{ kind: 'snapshot'; game: GameId; file: string; cursor: number; dbVersion: string | null }`.
  - In `runApplyJob`, a `'snapshot'` job:
    1. Throws if foreign keys are on (as `'apply'` does).
    2. `ATTACH`es `file` as `snap`, read-only (`file:<path>?mode=ro` URI).
    3. Checks that `snap.snapshot_meta` has the job's `game` and `catalogShape()`, otherwise
       throws `Snapshot is for another game or catalog shape`.
    4. Writes `catalog_snapshot:<game>` if it is absent, or resumes from its `table`/`after`.
    5. For each table, copies `INSERT OR IGNORE INTO main.t (cols) SELECT cols FROM snap.t WHERE rowid > ? ORDER BY rowid LIMIT chunk`,
       where `cols` is the snapshot's columns that also exist in main (non-generated). It updates
       the progress meta in the same transaction and calls `pause` between transactions.
    6. Final transaction: sets the game's cursor key to `cursor`, sets `db_version` when non-null,
       deletes `catalog_snapshot:<game>` and the staging key, and calls
       `noteUnannounced(db, {cardsChanged:true, imagesChanged:true, needsFinish:true})`.
    7. Always `DETACH`es (in `finally`).
  - Default chunk for a snapshot job: `SNAPSHOT_CHUNK = 5000`.

- [ ] **Step 1: Write the failing tests.** Build a tiny source database with `seededDb()`, add a
  few `mtg` cards, printings, `mtg_cards` and `mtg_images` rows, and export it. Import into a
  second `seededDb()` with `withoutForeignKeys` + `runApplyJob(..., {chunk: 2})`.
  - `exports only the game's tables with snapshot_meta`: `snapshot_meta.shape === catalogShape()`;
    the file has no `cards_fts` table; `card_printings` has no `id` column; the counts match.
  - `imports every row and sets the cursor last`: the counts in main match; the cursor key
    `catalog_cursor:mtg` equals the snapshot cursor; `catalog_snapshot:mtg` is null; the printings
    keep `remote_id`; after `runApplyJob(db,{kind:'finish'})`, a `cards_fts MATCH` on an
    imported name finds it.
  - `resumes an import stopped partway`: make the `pause` callback throw after the second batch,
    then check the cursor is still null and `catalog_snapshot:mtg` is set. Run again with no
    throwing pause; the counts equal the source with no duplicates, and the cursor is set.
  - `refuses a snapshot of another shape`: `UPDATE snap.snapshot_meta SET shape='x'` on the
    file, then expect a throw matching `catalog shape`, the cursor still null and no rows
    imported.
  - `does not touch other games' rows`: the counts of `ygo` cards are unchanged.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/main/catalog-snapshot.test.ts`.
  Expected: FAIL.
- [ ] **Step 3:** Implement `snapshot.ts` and the `'snapshot'` kind.
- [ ] **Step 4:** Run it again, plus `tests/main/catalog-apply-job.test.ts`. Expected: PASS.
- [ ] **Step 5:** Write the standalone benchmark `scripts/bench-snapshot.ts` (not vitest), modeled
  on `/tmp/cw-bench` from #318: 10k cards + 40k printings, export, then import on a worker-style
  second connection while the main connection writes every 20 ms. It prints the import time and
  the longest main write wait. Run it once with
  `ELECTRON_RUN_AS_NODE=1 npx electron` on the built script, and record the numbers in the PR.
  Expected: longest wait under 150 ms.
- [ ] **Step 6:** Commit: `feat(catalog): export a game's catalog to a snapshot file and import it on the worker in batches`.

### Task 4: Desktop first pull from a snapshot

**Files:**
- Create: `src/main/catalog/pull.ts` (`pullGame`, which holds `pullDeltas` moved out of
  `service.ts`, plus the snapshot attempt)
- Create: `src/main/catalog/snapshotDownload.ts`
- Modify: `src/main/catalog/service.ts` (uses `pullGame`; `catalogGames` also counts
  `catalog_snapshot:<game>`; new dep `snapshotDir?: string`)
- Modify: `src/main/cloud/client.ts` (`catalogSnapshot`, `download`)
- Modify: `src/main/index.ts` (passes `snapshotDir: join(userData, 'catalog-snapshot')`)
- Test: `tests/main/catalog-snapshot-pull.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 3; `CatalogApplier.run`.
- Produces:
  - `CloudClient.catalogSnapshot(game, shape): Promise<SnapshotOffer | null>`: calls
    `GET /api/catalog/snapshot/<game>?shape=`; returns null on 404.
  - `CloudClient.download(url, init?: {headers?}): Promise<Response>`: a plain GET through the
    client's fetch, including its network fallback, with no bearer token (the URL is signed).
  - `downloadSnapshot(client, offer, dir, onBytes?): Promise<string>`:
    1. Streams to `<dir>/<game>-<cursor>.sqlite.gz.part`, sending `Range: bytes=<size>-` when the
       part exists. A 200 reply to a Range request restarts the file.
    2. Checks that `bytes` and `sha256` match the offer. On a mismatch it deletes the part and
       throws `Snapshot download didn't match`.
    3. Gunzips to `<dir>/<game>-<cursor>.sqlite`, deletes the `.gz` and returns the path.
    4. Deletes other `<game>-*` files in `dir` first.
  - `pullGame(deps: {db, client, game, applier, set: (s) => void, snapshotDir?: string}): Promise<void>`:
    1. If `catalog_snapshot:<game>` exists and its file exists, resume the import job.
    2. Otherwise, if `snapshotDir` is set and the game qualifies (both cursors null, no `cards`
       row with `game = ?`, and `SNAPSHOT_GAMES` includes it): `set('downloading')`, get the offer,
       and download.
    3. Re-check the conditions; if they no longer hold, skip the import.
    4. `set('saving')`, then run the `'snapshot'` job and delete the file afterwards.
    5. Any error in steps 2–4 is caught: log
       `console.warn('Catalog <game>: snapshot skipped', e)`, clear `catalog_snapshot:<game>` if
       nothing was imported yet, and continue.
    6. Then run today's `pullDeltas` body unchanged from the game's (possibly new) cursor.

- [ ] **Step 1: Write the failing tests.** Use a fake `CloudClient` whose `catalogSnapshot`
  serves an offer for a file made with Task 3's `exportSnapshot`, gzipped. `download` serves its
  bytes (honouring `Range`), and `catalogChanges` serves one later page.
  - `a first pull imports the snapshot then reads the feed from its cursor`: the first
    `catalogChanges` call has `since === offer.cursor`; the rows from both the snapshot and the
    feed page are present; the snapshot dir is empty afterwards.
  - `resumes a partial download`: a `.part` holding the first 100 bytes is already there, so the
    `download` call carries `Range: bytes=100-`, and the result imports fine.
  - `falls back to the feed on a bad checksum`: the offer's `sha256` is wrong, so the feed is read
    from 0, the cursor ends at the feed's cursor, and no `.part` file is left.
  - `falls back when there is no snapshot for this shape`: `catalogSnapshot` returns null, and the
    feed is read from 0.
  - `does not use a snapshot for a game already pulled`: the cursor is set, so `catalogSnapshot`
    is never called.
  - `skips the snapshot when the game was pulled meanwhile`: the fake's `download` sets
    `catalog_cursor:mtg` before resolving, so no `'snapshot'` job runs.
  - `resumes an import left by a quit`: `catalog_snapshot:mtg` points at an existing file, so the
    import runs with no `catalogSnapshot` call.
  - `catalogGames keeps a game whose snapshot import is under way`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep `service.ts`'s state emissions the same as today for games that
  don't use a snapshot (the existing `catalog-service` tests must pass unchanged).
- [ ] **Step 4:** Run `npx vitest run --maxWorkers=2 tests/main/catalog-snapshot-pull.test.ts tests/main/catalog-service*.test.ts tests/main/catalog-apply-job.test.ts`.
  Expected: PASS. Run `npm run typecheck:node`. Expected: no errors.
- [ ] **Step 5:** Commit: `feat(catalog): a game's first pull imports its snapshot, then the feed from its cursor`.

### Task 5: The nightly job builds and uploads snapshots

**Files:**
- Create: `scripts/catalog/snapshots.ts` (the stage)
- Create: `scripts/catalog/snapshotUpload.ts` (multipart upload plus publish, against
  `PORTAL_URL` with `PORTAL_ADMIN_TOKEN`)
- Modify: `scripts/catalog/build.ts` (`STAGES` += `'snapshots'`; dispatch)
- Modify: `.github/workflows/catalog.yml` (step after `Upload catalog`)
- Test: `tests/main/catalog-snapshot-upload.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 (`pullGame` with `inProcessApplier` and `snapshotDir`, `exportSnapshot`,
  `createCloudClient({ token: PORTAL_ADMIN_TOKEN, ... })`).
- Produces:
  - `uploadSnapshot(opts: {portalUrl, token, file, manifest: Omit<SnapshotManifest,'key'|'bytes'|'sha256'>, fetchFn?, partBytes?: number}): Promise<SnapshotManifest>`.
    `partBytes` defaults to `50 * 1024 * 1024`.
  - Stage `snapshots`, for each of `SNAPSHOT_GAMES`:
    1. Delete and re-create `catalog-work/snap-<game>.sqlite` with `openDatabase`.
    2. Run `pullGame` (snapshot dir `catalog-work/snap-dl`), then the `finish` job.
    3. `exportSnapshot` to `catalog-work/snap-<game>.out.sqlite`, then gzip at level 9.
    4. Skip the upload when the manifest's cursor equals the new cursor (nothing changed).
       Otherwise `uploadSnapshot`.
    5. Log the counts, bytes and time per game.
    6. A failing game logs and moves on; the stage exits 1 at the end if any game failed.
  - The workflow step `Catalog snapshots` runs
    `npm run catalog:job -- --stage snapshots`, with `if: steps.upload.outcome == 'success'`,
    `timeout-minutes: 90` and `continue-on-error: true`. A follow-up step sets
    `CATALOG_PROBLEMS=1` on failure, matching the Magic stage's pattern.

- [ ] **Step 1: Write the failing tests** for `uploadSnapshot` with a fake `fetchFn` recording
  the calls:
  - `uploads in parts then publishes the manifest`: a 25-byte file with `partBytes: 10` makes the
    calls `upload` POST, 3 PUTs (parts 1–3), `complete`, then `manifest` PUT. The manifest's
    `sha256` matches `createHash('sha256')` of the file, and `bytes` is 25.
  - `stops before publishing when a part fails`: a part answering 500 means the call rejects and
    no `manifest` call is made.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement `snapshotUpload.ts`, the stage and the workflow step.
- [ ] **Step 4:** Run the test. Expected: PASS. Then build the job with
  `npx vite build --config scripts/catalog/vite.config.ts`. Expected: it builds.
- [ ] **Step 5:** Commit: `feat(catalog-job): build each game's snapshot through the desktop first pull and upload it`.

### Task 6: Image cache limit

**Files:**
- Modify: `src/main/images/cache.ts` (touch on serve; count downloaded bytes; expose in-flight
  keys)
- Create: `src/main/images/evict.ts`
- Modify: `src/main/index.ts` (scheduling and the owned-keys query)
- Test: `tests/main/image-evict.test.ts`, and extend `tests/main/image-cache*.test.ts`

**Interfaces:**
- Produces:
  - `createImageCache` options gain `onDownloaded?: (bytes: number) => void`. `ImageCache` gains
    `busy(): ReadonlySet<string>`, the relative paths without extension being written now (for
    example `full/123`, `printings/tp-abc`).
  - A served file whose mtime is more than `TOUCH_AFTER_MS = 24 * 60 * 60 * 1000` old gets
    `fs.utimes(file, now, now)`, fire and forget.
  - `ownedImageKeys(db, printingKey: (printingId) => Promise<string | null>): Promise<Set<string>>`
    returns relative paths without extension: `small/<image_id>`, `full/<image_id>`,
    `cropped/<image_id>`, `printings/<key>` and `printings-small/<key>`. It throws if any lookup
    throws.
  - `evictImages(opts: {dir, keep: Set<string>, busy: ReadonlySet<string>, budget = 1_000_000_000, target = 900_000_000}): Promise<{deleted: number; freed: number}>`:
    1. Walks the folder. A file's identity is its relative path minus the last extension.
    2. Skips `.tmp`. Counts `.brief` and `.none` with no size; they are deleted with their image.
    3. Sums the files that aren't in `keep`. If the sum is over `budget`, deletes the oldest by
       mtime until it is at or under `target`, skipping `busy`.
  - In `index.ts`: `scheduleImageEviction()` runs 3 minutes after the cache is created, then
    whenever the downloaded bytes since the last run exceed `100_000_000`. One run at a time. If
    `ownedImageKeys` throws, it logs and skips that run.

- [ ] **Step 1: Write the failing tests** (a temp dir with small files; budget and target scaled
  down to bytes):
  - `keeps owned files and trims the rest oldest first to the target`: owned files survive even
    when they are the oldest; the remaining unowned bytes are at or under `target`; the newest
    unowned files survive.
  - `does nothing under budget`.
  - `deletes an image's .brief and .none markers with it`.
  - `leaves tmp and in-flight files alone`.
  - `ownedImageKeys lists art by image_id and printing photo keys for live entries only`: a
    tombstoned entry's image is not in the set.
  - `skips eviction when owned keys can't be read`: tested through the scheduler function
    exported from `evict.ts` (`runEviction(deps)`) with a throwing `printingKey`, which deletes
    nothing.
  - In the cache tests: `touches a served file older than a day` (the mtime moves forward) and
    `reports downloaded bytes` (`onDownloaded` is called with the file size).
- [ ] **Step 2:** Run
  `npx vitest run --maxWorkers=2 tests/main/image-evict.test.ts tests/main/image-cache*.test.ts`.
  Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests again. Expected: PASS. Run `npm run typecheck:node`. Expected: no
  errors.
- [ ] **Step 5:** Commit: `feat(images): keep owned art, cap the rest of the image cache at 1 GB`.

### Task 7: Verify, PR, roll out

- [ ] **Step 1:** Run the whole suite:
  `npx vitest run --maxWorkers=2 tests/main tests/shared tests/portal`. Expected: PASS except
  `phone-build.test.ts`, which fails in worktrees for an unrelated reason. Then run
  `npm run typecheck:node`, `typecheck:web`, `typecheck:phone` and `npm run lint`. Expected:
  clean.
- [ ] **Step 2:** Push and open a PR with the benchmark numbers. Wait for CI to pass, then merge.
- [ ] **Step 3:** Deploy the Worker (`cd workers/portal && npm run deploy`).
- [ ] **Step 4:** Dispatch `catalog.yml`, or the snapshots stage alone if the run allows it.
  Check that each game's manifest is published and its file downloads through a signed URL.
  Check the file size and counts against the portal.
- [ ] **Step 5:** Check the desktop against the real portal: in a fresh profile, open Magic and
  time it from showing the game to idle. Make sure the app stays responsive throughout.
- [ ] **Step 6:** Release (`npm version <next minor> --no-git-tag-version`, a
  `chore: release` commit, then tag and push). Watch Release, Android and iOS.
