# Plan 4: Everything Through Our Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop app gets its catalog, images and prices only from the portal (a paged change feed plus `/img`), requires sign-in, keeps every collection entry through the switch, and lets desktops contribute printings the server lacks.

**Architecture:** The portal's Durable Object stamps every catalog row with a global `catalog_seq` via SQLite triggers (deletes leave tombstones), and serves `GET /api/catalog/changes?since=` — `since=0` is the snapshot, exported straight from the DO's live tables. The desktop stages a full snapshot, applies it in one transaction upserting by `pkey` (local row ids never change), checks the collection is identical, then follows deltas on the account sync scheduler. Images go through the portal's `/img` routes with the desktop token. The nightly GitHub Actions catalog job stays the only thing that talks to YGOPRODeck/Yugipedia/TCGCSV/Konami.

**Tech Stack:** Electron + TypeScript, better-sqlite3 (desktop) / Durable Object SQLite (portal), React + TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-server-catalog-design.md`

## Global Constraints

- Tests: `npm test` (runs vitest under Electron with `--maxWorkers=2`); a single file with `npm test -- <file>`. Never run vitest without the worker limit.
- Repo-wide `npm run lint` already fails on main; add no new errors in touched files. `npm run typecheck` must pass.
- Migrations: append only, never edit a shipped step. Desktop steps run on the server too unless `server` overrides; server-only steps go in `SERVER_STEPS`.
- Printings are matched across stores by `pkey` only; server and desktop row ids are never assumed equal.
- Catalog, contribute and image-upstream endpoints require a signed-in user; `/api/catalog/*` takes desktop tokens only (like `/api/sync/*`).
- The desktop never falls back to direct source calls in packaged builds. App updates still come from GitHub.
- Deploy the portal Worker before any desktop release; server migrations are fix-forward.
- Older desktop versions must keep working against the updated portal.
- No collection entry may be lost or re-pointed during the switch.

## Review Focus

1. **Server unreachable on the first launch of the new version, with an existing collection** → app opens on its old catalog, banner says card data can't update, nothing changes on disk except the backup; the next run retries. (Task 11 test `keeps the old catalog when the snapshot can't download`.)
2. **App quit halfway through the snapshot download** → next launch resumes from the staged cursor and never applies a partial snapshot. (Task 10 test `resumes a staged snapshot and applies only when complete`.)
3. **Nightly upload running while a client pages the feed** → a row changed between two pages arrives on a later page; the cursor never skips a change. (Task 3 test `a row changed between pages comes back on a later page`.)
4. **Server tombstones a printing a local entry (live or tombstoned-but-unpushed) still uses** → the printing stays, flagged `missing_from_api = 1`. (Task 9 test `keeps a deleted printing that an entry still uses`.)
5. **Contributed printing** → hidden from search, Browse facets, Sets list/checklist and Scan pickers, yet the owning entry still lists with its set and rarity. (Task 7 test `contributed printings show only through entries`.)

---

## File structure

**Portal (server)**
- `src/main/db/schema.ts` — V15 (desktop: `contributed`, `remote_id`, `catalog_staging`, `sync_issues`; server: `contributed` only).
- `workers/portal/src/migrate.ts` — `server-6`: clock, `catalog_seq` columns, triggers, tombstones, `printing_contributions`.
- `src/main/catalog/upsert.ts` (new, shared) — the by-key catalog upsert both the admin loader and the desktop use.
- `workers/portal/src/catalogLoad.ts` — uses the shared upsert; contributed rules; `GET /admin/catalog/pkeys`.
- `src/shared/catalogFeed.ts` (new) — wire types and limits.
- `workers/portal/src/catalogFeed.ts` (new) — `catalogChanges`, `catalogRoute`.
- `workers/portal/src/contribute.ts` (new) — `contributePrintings`.
- `workers/portal/src/images.ts` — `konami/<key>` kind; per-user upstream quota.
- `workers/portal/src/app.ts`, `workers/portal/src/index.ts` — routing, quota wiring.
- `scripts/catalog/parity.ts` (new) + `.github/workflows/catalog.yml` — parity gate.
- `src/main/repo/{cards,browse,sets,scan}.ts` — hide contributed printings.

**Desktop**
- `src/main/cloud/client.ts` — `catalogChanges`, `contribute`.
- `src/main/catalog/apply.ts` (new) — apply feed changes.
- `src/main/catalog/switch.ts` (new) — staged snapshot, backup, count check.
- `src/main/catalog/service.ts` (new) — status, throttle, blocked state, deltas.
- `src/main/cloud/engine.ts`, `src/main/cloud/localSync.ts`, `src/main/cloud/account.ts` — catalog before sync, contribution, sync issues.
- `src/main/images/cache.ts` — fetches through an `ImageSources` strategy; `src/main/images/portalSources.ts` (new); `src/main/dev/directSources.ts` (new, dev-only).
- `src/main/index.ts`, `src/main/ipc/handlers.ts`, `src/shared/ipc.ts`, `src/shared/types.ts`, `src/preload/*`, `src/renderer/src/lib/api.ts`, `src/renderer/src/web/httpApi.ts`, `tests/renderer/mockApi.ts` — rewiring.
- `src/renderer/src/features/account/SignInScreen.tsx` (new), `src/renderer/src/lib/account.ts` (new), `src/renderer/src/App.tsx`, `src/renderer/src/components/SyncBanner.tsx`, `src/renderer/src/features/settings/{AccountSection,SettingsPage}.tsx`.

---

## Phase A — Portal

### Task 1: Schema V15 and server-6 change feed

**Files:**
- Modify: `src/main/db/schema.ts` (add `SCHEMA_V15`, append `{ version: 15, sql: SCHEMA_V15, server: SCHEMA_V15_SERVER }`)
- Modify: `workers/portal/src/migrate.ts` (append `server-6`)
- Test: `tests/portal/catalog-seq.test.ts` (new), `tests/main/database.test.ts`

**Interfaces:**
- Produces (desktop tables): `card_printings.contributed INTEGER NOT NULL DEFAULT 0`, `card_printings.remote_id INTEGER` (+ index `ix_printings_remote`), `catalog_staging(seq INTEGER PRIMARY KEY, tbl TEXT NOT NULL, row TEXT NOT NULL)`, `sync_issues(owner_id INTEGER NOT NULL, uid TEXT NOT NULL, pkey TEXT NOT NULL, reason TEXT NOT NULL, since TEXT NOT NULL, PRIMARY KEY (owner_id, uid))`.
- Produces (server tables): `card_printings.contributed` (same column, via the V15 server SQL); `catalog_clock(id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL)`; `catalog_seq INTEGER NOT NULL DEFAULT 0` + index on each of `cards, card_images, card_printings, sets, pack_art, set_logos, konami_logos, tcgplayer_groups, tcgplayer_products`; `catalog_tombstones(seq INTEGER PRIMARY KEY, tbl TEXT NOT NULL, key TEXT NOT NULL)` (key = JSON array; printings use `[pkey]`); `printing_contributions(printing_id INTEGER PRIMARY KEY REFERENCES card_printings(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL)` + index `(user_id, created_at)`.

- [ ] **Step 1: Write the failing tests** in `tests/portal/catalog-seq.test.ts` (use `seededServerDb()` — its rows are written by `runSync` after migrations, so they exercise the triggers):

```ts
it('gives every seeded catalog row a distinct seq and moves the clock to the max', ...)
  // union of catalog_seq over the 9 tables: all > 0, no duplicates; catalog_clock.seq === max
it('stamps a new seq when a row really changes', ...)
  // UPDATE cards SET name = 'X' WHERE id = <id> → catalog_seq > previous clock
it('keeps the seq when an update changes nothing', ...)
  // UPDATE cards SET name = name → catalog_seq unchanged, clock unchanged
it('writes a tombstone on delete', ...)
  // DELETE FROM sets WHERE ... → catalog_tombstones row { tbl: 'sets', key: '["en","<name>"]' }, seq = clock
  // DELETE a card_printings row → key '["<pkey>"]'
it('backfills rows that existed before server-6', ...)
  // runSteps(db, [...MIGRATIONS]) only, insert 3 cards, then runSteps(db, SERVER_STEPS) → seqs 1..n distinct
```

And in `tests/main/database.test.ts`: `it('V15 adds remote_id, contributed, catalog_staging and sync_issues on the desktop')` asserting the columns/tables exist via `PRAGMA table_info` / `sqlite_master`.

- [ ] **Step 2: Run them, verify they fail** — `npm test -- tests/portal/catalog-seq.test.ts tests/main/database.test.ts` → FAIL (no such column catalog_seq / remote_id).

- [ ] **Step 3: Implement V15 and server-6.**
  - The server-6 SQL is generated once at module load by `catalogFeedSql(tables: FrozenTable[])` in `migrate.ts` from a **frozen literal copy** of today's table → key/column list (copy `CATALOG_TABLES` as of now into a `const SERVER_6_TABLES`; never read `CATALOG_TABLES` here, so the shipped step can't change).
  - Order inside server-6: create clock (seq 0) → add columns → backfill (each table in list order gets `catalog_seq = clock + rowid`-style distinct values; clock ends at the overall max) → indexes → tombstones/contributions tables → triggers.
  - Per table, three triggers: `AFTER INSERT` (bump clock, set `catalog_seq` on `NEW.rowid`); `AFTER UPDATE … WHEN` any frozen column (plus `contributed` and `missing_from_api` for printings) `IS NOT` its old value (same body); `AFTER DELETE` (bump clock, insert tombstone with the key as `json_array(OLD.<key cols>)`, printings `json_array(OLD.pkey)`). The inner `UPDATE … SET catalog_seq` doesn't match the WHEN, so it doesn't re-fire.
  - Add a comment to `migrate.ts` warning that a future desktop step rebuilding a catalog table on the server would tombstone and re-stamp every row.

- [ ] **Step 4: Run tests, verify pass** — same command, plus `npm test -- tests/portal/migrate.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(portal): catalog change sequence and tombstones (server-6, V15)"`

### Task 2: Shared catalog upsert; loader keeps contributed rows

**Files:**
- Create: `src/main/catalog/upsert.ts`
- Modify: `workers/portal/src/catalogLoad.ts` (`upsertRows`, `deleteKeys`; add `GET /admin/catalog/pkeys`)
- Test: `tests/portal/catalog-load.test.ts`

**Interfaces:**
- Produces: `type Scalar = string | number | null`; `upsertCatalogRow(db: SqlDb, table: CatalogTable, row: Record<string, Scalar>, extra?: Record<string, Scalar>): void` — the loader's current per-row logic moved verbatim (printings found by `PKEY_SQL`, update sets `missing_from_api = 0`; unique-column holders dropped first; other tables `INSERT … ON CONFLICT DO UPDATE`). `extra` columns (e.g. `remote_id`, `contributed`) are written on both insert and update. Also export `PKEY_SQL`.
- Produces: `GET /admin/catalog/pkeys?after=<pkey>&limit=<n ≤ 5000>` → `{ pkeys: string[]; more: boolean }`, ordered by pkey, admin token required.

- [ ] **Step 1: Write failing tests** in `catalog-load.test.ts`:

```ts
it('a source upsert of a contributed pkey makes it a normal row', ...)
  // insert printing with contributed = 1; POST /admin/catalog/rows with the same key columns → contributed === 0
it('delete never removes a contributed printing', ...)
  // contributed = 1, unowned; POST /admin/catalog/delete [[pkey]] → row still there
it('lists pkeys in order, paged', ...)
  // GET /admin/catalog/pkeys?limit=2 → 2 sorted pkeys, more: true; after=<last> continues; no token → 401
```

- [ ] **Step 2: Run, verify fail** — `npm test -- tests/portal/catalog-load.test.ts`.
- [ ] **Step 3: Implement.** Loader calls `upsertCatalogRow(db, table, row, table.name === 'card_printings' ? { contributed: 0 } : undefined)`; `deleteKeys` for printings adds `AND contributed = 0` to both statements.
- [ ] **Step 4: Run, verify pass** (whole file, existing tests included).
- [ ] **Step 5: Commit** — `feat(portal): shared catalog upsert; loader keeps contributed printings`

### Task 3: Change feed endpoint

**Files:**
- Create: `src/shared/catalogFeed.ts`, `workers/portal/src/catalogFeed.ts`
- Modify: `workers/portal/src/app.ts` (route `/api/catalog/` → `catalogRoute(req, deps, rest)`)
- Test: `tests/portal/catalog-feed.test.ts` (new)

**Interfaces:**
- Produces in `src/shared/catalogFeed.ts`:

```ts
export const MAX_CHANGES = 5000          // page size cap (and default)
export const MAX_CONTRIBUTE = 500        // printings per contribute request
export const CONTRIBUTE_DAILY_CAP = 2000 // per user per rolling 24 h
export type CatalogTableName = 'cards' | 'card_images' | 'card_printings' | 'sets' | 'pack_art'
  | 'set_logos' | 'konami_logos' | 'tcgplayer_groups' | 'tcgplayer_products'
export type CatalogChange =
  | { seq: number; table: CatalogTableName; row: Record<string, string | number | null> }
  | { seq: number; table: CatalogTableName; deleted: (string | number | null)[] }
export interface CatalogChangesResponse { changes: CatalogChange[]; cursor: number; more: boolean; dbVersion: string | null }
export type ContributedPrinting = { card_id: number; set_name: string; set_code: string; set_rarity: string;
  set_rarity_code: string | null; language: string; variant: string | null; tcg_product_id: number | null }
export type ContributeResult = { pkey: string; status: 'added' | 'exists' | 'rejected'; reason?: string }
```

- Rows carry the table's `CATALOG_TABLES` columns; `card_printings` rows also carry `pkey`, `id` (server id → desktop `remote_id`) and `contributed`.
- Produces in `workers/portal/src/catalogFeed.ts`: `catalogChanges(db: SqlDb, since: number, limit: number): CatalogChangesResponse` — rows with `catalog_seq > since` from every table plus (only when `since > 0`) tombstones with `seq > since`, merged by seq, first `limit`; `cursor` = last seq returned (or `since` when empty); `dbVersion` = meta `db_version`. `catalogRoute(req, deps, path)`: `GET changes?since=&limit=` and `POST contribute` (Task 4); desktop tokens only (401 `signed-out` otherwise), bad `since` → 400.

- [ ] **Step 1: Write failing tests** (`inProcessPortal()`-style deps, desktop token from `tests/main/cloudHelpers.ts` pattern):

```ts
it('since=0 returns every live row once, in seq order, across pages', ...)
  // page with limit=500 until more=false; count per table === COUNT(*) per table; seqs strictly increasing
it('since=0 carries no tombstones', ...)
it('returns only what changed after the cursor, tombstones included', ...)
  // update one card, delete one set → exactly [row(cards), deleted(sets,[lang,name])]
it('a row changed between pages comes back on a later page', ...)
  // page 1 (limit 10); update a row from page 1; following pages include it again with a higher seq
it('printing rows carry pkey, server id and contributed', ...)
it('rejects web sessions and missing tokens', ...)   // 401
it('rejects a non-numeric since', ...)               // 400
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** (one `SELECT … WHERE catalog_seq > ? ORDER BY catalog_seq LIMIT ?` per table, merge, slice; selecting only the shared columns, never `catalog_seq`).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(portal): GET /api/catalog/changes`

### Task 4: Contribute endpoint

**Files:**
- Create: `workers/portal/src/contribute.ts`
- Modify: `workers/portal/src/catalogFeed.ts` (`POST contribute`)
- Test: `tests/portal/contribute.test.ts` (new)

**Interfaces:**
- Consumes: `ContributedPrinting`, `ContributeResult`, limits from Task 3; `upsertCatalogRow` is **not** used (contributions insert only).
- Produces: `contributePrintings(db: SqlDb, userId: number, rows: unknown[], now: Date): ContributeResult[]`. Body `{ printings: ContributedPrinting[] }` → `{ results: ContributeResult[] }`; more than `MAX_CONTRIBUTE` → 413 `too-many`.

Rules: pkey is computed server-side (`PKEY_SQL`). `exists` when that pkey is already present. `rejected` with reason `unknown-card` (no `cards` row), `bad-language` (not in `LANGUAGES`), `bad-field` (set_name/set_code/set_rarity not a 1–200 char string; other fields wrong type), `daily-limit` (≥ `CONTRIBUTE_DAILY_CAP` rows in `printing_contributions` for the user in the last 24 h). `added`: insert with `contributed = 1`, `missing_from_api = 0`, prices NULL (client prices are never accepted), plus a `printing_contributions` row.

- [ ] **Step 1: Write failing tests:**

```ts
it('adds an unknown printing as contributed and a push for it then applies', ...)
  // push entry with that pkey → 'unknown-printing'; contribute → 'added'; push again → 'applied'
it('answers exists for a pkey the catalog has', ...)
it('rejects an unknown card, a bad language and oversized fields', ...)
it('stops at the daily cap', ...)   // seed 2000 contribution rows at now-1h → 'daily-limit'
it('ignores client prices', ...)    // body with set_price/market_price → stored NULL
it('shows the contributed printing in the change feed', ...)
```

- [ ] **Step 2: Run, verify fail.** **Step 3: Implement.** **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(portal): POST /api/catalog/contribute`

### Task 5: Images — Konami logos and a per-user upstream quota

**Files:**
- Modify: `workers/portal/src/images.ts`, `workers/portal/src/app.ts` (`AppDeps.imageQuota?`), `workers/portal/src/index.ts` (create one quota per Store)
- Test: `tests/portal/images.test.ts`

**Interfaces:**
- Produces: `/img/konami/<km-key>` — source from `findSetImageUrl`, must start with `KONAMI_LOGO_PREFIX`, R2 key `konami/<key>`, served raw (the desktop cuts out the white). `/img/set/km-*` stays refused, so the web never shows the raw logo.
- Produces: `interface ImageQuota { take(userId: number): boolean }`; `createImageQuota(now: () => number, opts = { limit: 1000, windowMs: 3_600_000 }): ImageQuota` (in-memory fixed window per user). Checked only on an R2 miss, after the signed-in check; over quota → `429` with `retry-after` seconds to window end. `AppDeps.imageQuota` is optional (absent = unlimited) so existing test deps stay valid; `Store` always passes one.

- [ ] **Step 1: Write failing tests:**

```ts
it('mirrors a Konami logo under konami/<key>', ...)
it('still refuses km- keys under /img/set', ...)
it('limits upstream fetches per user but never R2 hits', ...)
  // quota limit 2: 3rd miss → 429; a stored image → 200 regardless
```

- [ ] **Step 2–4:** fail → implement → pass (`npm test -- tests/portal/images.test.ts`).
- [ ] **Step 5: Commit** — `feat(portal): Konami logos via /img and a per-user upstream image quota`

### Task 6: Parity gate in the nightly job

**Files:**
- Create: `scripts/catalog/parity.ts`
- Modify: `scripts/catalog/vite.config.ts` (second entry if needed), `package.json` (`"catalog:parity"` script mirroring `catalog:job`), `.github/workflows/catalog.yml` (step after upload)
- Test: `tests/main/catalog-parity.test.ts` (new)

**Interfaces:**
- Produces: `missingPkeys(local: SqlDb, fetchPage: (after: string | null) => Promise<{ pkeys: string[]; more: boolean }>): Promise<string[]>` — local pkeys absent from the server's list. CLI: reads `catalog-work/work.sqlite`, pages `GET /admin/catalog/pkeys` with `PORTAL_ADMIN_TOKEN`, prints the first 50 missing and exits 1 when any are missing.

- [ ] **Step 1: Failing test:** `it('reports local pkeys the server lacks')` with an in-memory local db and a fake `fetchPage` over two pages.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(catalog): nightly parity check against the portal`

### Task 7: Hide contributed printings outside entries

**Files:**
- Modify: `src/main/repo/cards.ts` (search ~line 93, detail printings ~line 139), `src/main/repo/browse.ts` (set/rarity filters and facets, lines ~66, 81, 115, 166, 169), `src/main/repo/sets.ts` (list ~67, checklist ~192), `src/main/repo/scan.ts` (`SELECT` ~line 21)
- Test: `tests/main/contributed.test.ts` (new)

Add `p.contributed = 0` (or `AND contributed = 0`) to each listed query. Collection queries (`collection.ts`) and `sets.ts:199/309` (entry-driven) are left alone.

- [ ] **Step 1: Failing test** `contributed printings show only through entries`: seededDb, insert a contributed printing for a seeded card with a unique set code, add an entry for it; assert absent from `searchCards`, `getCardDetail(..).printings`, `browseFacets`, `listSets`, `getChecklist`, `printingsByCode`; present in `listEntries` with its set name and rarity.
- [ ] **Step 2–4:** fail → implement → pass; then `npm test -- tests/main/browse.test.ts tests/main/sets.test.ts tests/main/scan-repo.test.ts tests/main/cards.test.ts`.
- [ ] **Step 5: Commit** — `feat: keep contributed printings out of search, Sets and Scan`

**Phase A checkpoint:** `npm test` and `npm run typecheck` pass. The portal can be deployed now (old desktops unaffected).

---

## Phase B — Desktop

### Task 8: Cloud client — catalog calls

**Files:** Modify `src/main/cloud/client.ts`; Test `tests/main/cloud-sync.test.ts` (or new `tests/main/cloud-catalog-client.test.ts`)

**Interfaces:**
- Produces on `CloudClient`: `catalogChanges(since: number, limit?: number): Promise<CatalogChangesResponse>` (`GET /api/catalog/changes?since=&limit=`); `contribute(printings: ContributedPrinting[]): Promise<ContributeResult[]>` (`POST /api/catalog/contribute`, returns `.results`). Same error mapping as the other calls. Default timeout for `catalogChanges` is 120 s (pages are large); pass it per call.

- [ ] Steps: failing test against `inProcessPortal()` (`catalogChanges(0)` returns rows; `contribute([])` → `[]`) → implement → pass → commit `feat(desktop): catalog feed client calls`.

### Task 9: Apply feed changes locally

**Files:** Create `src/main/catalog/apply.ts`; Test `tests/main/catalog-apply.test.ts`

**Interfaces:**
- Consumes: `upsertCatalogRow` (Task 2), `CatalogChange` (Task 3).
- Produces: `interface ApplyResult { applied: number; cardsChanged: boolean; imagesChanged: boolean }`; `applyChanges(db: SqlDb, changes: CatalogChange[]): ApplyResult` (caller owns the transaction); `finishApply(db: SqlDb, r: ApplyResult): void` (rebuilds `cards_fts` when `cardsChanged`).

Rules: printing rows upsert by pkey with `extra = { remote_id: row.id, contributed: row.contributed }` (drop `id`/`pkey` from the column set). A printing tombstone deletes the local row unless any `collection_entries` row (any owner, live or tombstoned) references it — then `missing_from_api = 1`. Tombstones for other tables delete by key. Unknown table names are skipped.

- [ ] **Step 1: Failing tests:**

```ts
it('upserts printings by pkey and keeps local ids', ...)        // entry's printing_id unchanged, remote_id set
it('keeps a deleted printing that an entry still uses', ...)     // live entry and a tombstoned dirty entry
it('deletes an unused printing on tombstone', ...)
it('rebuilds search after card changes', ...)                    // searchCards finds a renamed card
```

- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(desktop): apply catalog feed changes by pkey`

### Task 10: The switch — staged snapshot, backup, count check

**Files:** Create `src/main/catalog/switch.ts`; Modify `src/main/db/meta.ts` (MetaKeys); Test `tests/main/catalog-switch.test.ts`

**Interfaces:**
- Produces MetaKeys: `'catalog_cursor'`, `'catalog_staging_cursor'`, `'catalog_switched_at'`, `'catalog_switch_backup'`, `'catalog_switch_failed'` (JSON `{ reason: string; at: string; retry: 'next-run' | 'next-launch' }`).
- Produces: `collectionCensus(db: SqlDb): string` — a canonical string of, per owner, live entry count, total quantity and sorted `(pkey, image_id, quantity)` triples.
- Produces: `type SwitchOutcome = { state: 'done' } | { state: 'pending'; reason: string }`; `runSwitch(db: Database.Database, deps: { client: CloudClient; backupPath: string; now: () => Date; onProgress?: (phase: 'downloading' | 'saving') => void; afterApply?: (db: SqlDb) => void }): Promise<SwitchOutcome>` — `afterApply` is a test seam called inside the transaction just before the census after.

Algorithm (each numbered point is a requirement):
1. If `catalog_switched_at` is set, return done.
2. Download: page `catalogChanges(stagingCursor)` until `more` is false, inserting each change into `catalog_staging` and advancing `catalog_staging_cursor` in the same transaction as its page. Offline/5xx mid-way → `pending` (`retry: 'next-run'`), staging kept.
3. Backup once: if `catalog_switch_backup` is unset or its file is missing, `await db.backup(backupPath)`; failure → `pending` (`next-run`), nothing applied. Record the path.
4. One transaction: census before → apply all staged changes in seq order (Task 9) → printings still with `remote_id IS NULL` are deleted if unreferenced, else flagged `missing_from_api = 1` → rows of `sets, pack_art, set_logos, konami_logos, tcgplayer_groups, tcgplayer_products` whose key isn't in staging are deleted (cards and card_images are never deleted) → `finishApply` → census after. Different census → throw, rolling back; record `catalog_switch_failed` with `retry: 'next-launch'` and return `pending` with the reason `"Your collection didn't match after updating card data"`; log both census strings.
5. On success in the same transaction: `catalog_cursor` = staging cursor, `catalog_switched_at` = now, `last_sync_at` = now, `db_version` from the last page, clear `catalog_staging`, `catalog_staging_cursor` and `catalog_switch_failed`.

- [ ] **Step 1: Failing tests** (desktop `seededDb()` with entries for two owners as the "old catalog"; `inProcessPortal()` as server, with one extra server-only printing and one desktop-only printing used by an entry):

```ts
it('switches and leaves every entry pointing at the same pkey', ...)   // census equal, remote_ids set
it('keeps a desktop-only printing an entry uses, flagged', ...)
it('drops desktop-only printings nobody uses', ...)
it('writes the backup before changing anything', ...)                  // file exists, opens, has the old entries
it('resumes a staged snapshot and applies only when complete', ...)    // client throws CloudOfflineError on page 3; nothing applied; second run continues from the staged cursor
it('rolls back and waits for next launch when the census differs', ...) // afterApply deletes one live entry → pending (retry next-launch), catalog and entries untouched
it('a fresh install with no entries switches too', ...)
```

- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(desktop): one-time switch to the server catalog with backup and census check`

### Task 11: Catalog service and account integration

**Files:** Create `src/main/catalog/service.ts`; Modify `src/main/cloud/account.ts`, `src/shared/types.ts` (`SyncStatus.blocked`); Test `tests/main/catalog-service.test.ts`, `tests/main/cloud-account.test.ts`

**Interfaces:**
- Produces: `SyncStatus` gains `blocked: string | null` (the switch's pending reason; null otherwise).
- Produces: `interface CatalogService { status(): SyncStatus; update(client: CloudClient, opts?: { force?: boolean }): Promise<{ changed: boolean; imagesChanged: boolean }> }`; `createCatalogService(deps: { db: Database.Database; backupPath: (now: Date) => string; emit: (s: SyncStatus) => void; now?: () => Date; launchedAt: Date }): CatalogService`.
- `backupPath` in production: `<userData>/backups/<YYYY-MM-DD>-pre-server-catalog.sqlite`.
- Produces on `AccountService`: `refreshCatalog(): Promise<SyncStatus>` (forced update through the current client; returns status; signed out → status unchanged); `AccountDeps.catalog: CatalogService`; `AccountDeps.onCatalogChanged: (r: { imagesChanged: boolean }) => void`.

Rules: `update` runs the switch until done, then pages deltas from `catalog_cursor` (one transaction per page, cursor saved with its page) and calls `finishApply`. Not forced → skips when `last_sync_at` is under 60 min old. A switch failure with `retry: 'next-launch'` recorded at or after `launchedAt` isn't retried this launch. States emitted: `checking` → `downloading` → `saving` → `idle`; non-network errors → `error` (with message), swallowed; `CloudAuthError`/`CloudOfflineError` re-thrown. In `account.run()`, `await catalog.update(client, { force: firstRunThisSession })` runs before `syncOnce`; when it reports `changed`, call `applyPending`, `emitDataChanged`, and `onCatalogChanged`.

- [ ] **Step 1: Failing tests:**

```ts
// catalog-service.test.ts
it('keeps the old catalog when the snapshot can’t download', ...)  // offline client; status.blocked set; cards unchanged; second update retries
it('pulls only deltas after the switch', ...)                       // server renames a card; update → changed; local name updated
it('skips an unforced update within the hour', ...)
it('does not retry a census failure until the next launch', ...)
// cloud-account.test.ts
it('updates the catalog before pushing', ...)                       // entry on a server-only printing becomes pushable in the same run
it('a 401 during the catalog pull signs out and keeps the catalog', ...)
```

- [ ] **Step 2–4:** fail → implement → pass (`npm test -- tests/main/catalog-service.test.ts tests/main/cloud-account.test.ts`).
- [ ] **Step 5: Commit** — `feat(desktop): catalog service on the account sync scheduler`

### Task 12: Contribution and visible sync issues

**Files:** Modify `src/main/cloud/engine.ts`, `src/main/cloud/localSync.ts`, `src/main/cloud/account.ts`, `src/shared/types.ts`, `src/shared/ipc.ts`, `src/main/ipc/handlers.ts`, preload + `src/renderer/src/lib/api.ts` + `src/renderer/src/web/httpApi.ts` (web: `unavailable`) + `tests/renderer/mockApi.ts`; Test `tests/main/cloud-sync.test.ts`

**Interfaces:**
- Produces in `localSync.ts`: `printingsToContribute(db, owner, uids: string[]): ContributedPrinting[]`; `recordSyncIssue(db, owner, uid, pkey, reason, now)`; `clearSyncIssue(db, owner, uid)` (also called from `markPushed`); `syncIssueCount(db, owner): number`; `listSyncIssues(db, owner): UnsyncedEntry[]`.
- Produces in `types.ts`: `interface UnsyncedEntry { uid: string; name: string; setCode: string; setName: string; rarity: string; language: Language; quantity: number; reason: string }`; `AccountStatus.unsyncedCount: number`.
- Produces IPC: `'account:unsynced'` → `UnsyncedEntry[]` for the active owner.
- Produces: `SyncOutcome.unsynced: number`.

Rules in `syncOnce`: after the push loop, the uids answered `unknown-printing` are contributed (batches of `MAX_CONTRIBUTE`); entries whose pkey came back `added` or `exists` are pushed once more in the same run; whatever is still `unknown-printing` gets `recordSyncIssue` with the contribute reason (or `'unknown-printing'`). A `contribute` failure other than auth/offline leaves them recorded and doesn't fail the run.

- [ ] **Step 1: Failing tests:**

```ts
it('contributes a printing the server lacks and pushes the entry in the same run', ...)
it('records an entry the server rejects and clears it once it syncs', ...)  // unknown card → issue listed with reason; later fixed → cleared
it('lists sync issues with name, set and rarity', ...)
```

- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(desktop): contribute missing printings; list entries that can't sync`

### Task 13: Images through the portal

**Files:** Modify `src/main/images/cache.ts`; Create `src/main/images/portalSources.ts`, `src/main/dev/directSources.ts`; Test `tests/main/images.test.ts`

**Interfaces:**
- Produces in `cache.ts`: `interface ImageSource { url: string; headers?: Record<string, string> }`; `interface ImageSources { card(size: ImageSize, id: number): ImageSource | null; set(key: string): ImageSource | null; konami(key: string): ImageSource | null; printing(printingId: number): Promise<ImageSource | null> }`. `createImageCache({ dir, sources: ImageSources, fetchFn?, limit?, prepareLogo? })`. `km-` keys go through `sources.konami` and `prepareLogo` (no `prepareLogo` → null, as today). Printing files are `printings/srv-<printingId-or-source-key>.<ext>` with ext from the response `content-type` (`png|jpg|webp|gif`). A non-OK answer (401, 404, 429) returns null and isn't cached.
- Produces: `portalImageSources(opts: { portal: string; token: () => string | null; remoteId: (printingId: number) => number | null }): ImageSources` — `/img/<size>/<id>`, `/img/set/<key>`, `/img/konami/<key>`, `/img/printing/<remoteId>`, each with `authorization: Bearer <token>`; null when there's no token (or no remote id).
- Produces: `directImageSources(opts: { db; version: string }): ImageSources` in `src/main/dev/directSources.ts` — today's URLs (YGOPRODeck `imageUrl`/`setImageUrl`, `findSetImageUrl`, the Yugipedia/TCGplayer printing art resolver); dev fake-data profile only.

- [ ] **Step 1: Failing tests** (fake `fetchFn` recording requests):

```ts
it('fetches card art from the portal with the desktop token', ...)
it('asks nothing when signed out', ...)
it('maps a printing to its server id', ...)          // remote_id 77 → /img/printing/77; no remote id → null, no request
it('cuts the white out of Konami logos from /img/konami', ...)
it('does not cache a 429', ...)                      // second call fetches again
```

Update the existing image tests to pass `sources`.

- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(desktop): load all images through the portal`

### Task 14: Rewire the main process; drop direct source calls

**Files:** Modify `src/main/index.ts`, `src/main/ipc/handlers.ts`, `src/shared/ipc.ts`, preload, `src/renderer/src/lib/api.ts`, `src/renderer/src/web/httpApi.ts`, `tests/renderer/mockApi.ts`, `src/shared/types.ts`; Create `tests/main/no-direct-sources.test.ts`; Update `tests/main/handlers.test.ts`

Requirements:
- `index.ts`: remove `createYgoClient`, `refreshCatalog`, `startupSync`, `createYugipediaClient`, `createPrintingArtResolver`, `createTcgplayerLookup`, `createPriceService`, `refreshIntlPrices`. Create the catalog service (Task 11) and pass it to the account service; image cache uses `portalImageSources` with `remoteId` = `SELECT remote_id FROM card_printings WHERE id = ?` and `token` from the account's token store. `onCatalogChanged`: `recordSnapshot(db)`, and `fingerprints.refresh({ force: true })` when `imagesChanged`.
- Fake-data/capture profile (`fakeData`, never packaged): keeps today's direct path through `src/main/dev/directSources.ts` (a `startDirectCatalog(db, …)` wrapping `refreshCatalog`, and `directImageSources`), and sets `signInRequired: false`.
- Add a dev-only `DUEL_BINDER_USER_DATA` env override for the userData folder (ignored when packaged), used by Task 17's dry run.
- `handlers.ts`: drop `client: YgoClient` and `prices` deps and `priceNewCopy`; `'sync:status'` → `catalog.status()`; `'sync:run'` → `account.refreshCatalog()`. Remove the `'prices:settings'`/`'prices:setUrl'` channels everywhere (IPC list, preload, `api.ts`, `httpApi.ts`, `mockApi.ts`, `queryKeys.priceSettings`).
- `AccountStatus.signInRequired: boolean` (true unless fake-data).

- [ ] **Step 1: Failing test** `tests/main/no-direct-sources.test.ts`: walks relative imports from `src/main/index.ts` (regex over `import … from '…'`, resolving `.ts`), not following into `src/main/dev/`, and asserts none of these are reached: `ygo/client`, `sync/catalog`, `sync/sync`, `sync/intl`, `sync/sets`, `yugipedia/client`, `yugipedia/artResolver`, `yugipedia/setLogos`, `tcgplayer/catalog`, `tcgplayer/prices`, `konami/packArt`, `konami/logos`, `prices/client`, `prices/service`, `prices/refresh`.
- [ ] **Step 2: Run, verify fail** (index.ts still imports them).
- [ ] **Step 3: Implement the rewiring**; update `handlers.test.ts` for the new deps and channels.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(desktop): talk only to the portal for catalog, images and prices`

### Task 15: Sign-in screen

**Files:** Create `src/renderer/src/lib/account.ts`, `src/renderer/src/features/account/SignInScreen.tsx`; Modify `src/renderer/src/App.tsx`, `src/renderer/src/features/settings/AccountSection.tsx` (use the hook); Test `tests/renderer/sign-in-gate.test.tsx`

**Interfaces:**
- Produces: `useAccountStatus(): AccountStatus | undefined` (the query + `onChange` subscription now inline in `DesktopAccount`).
- `App` (desktop only) renders `<SignInScreen status={s} />` instead of the shell when `s.signInRequired && (s.state === 'signed-out' || s.state === 'signing-in')`. Offline or error states with a user never show it.

Copy: heading "Sign in to Duel Binder"; body "Duel Binder keeps your collection and card data in your account. Sign in with Discord to continue."; button "Sign in with Discord"; while signing in: "Finish signing in in your browser…" + "Cancel"; `s.error` shown under the button. Styling matches the app (TitleBar stays so the window can be moved/closed).

- [ ] **Step 1: Failing tests:** gate shows when signed out; button calls `api.account.signIn`; signing-in shows Cancel → `signOut`; offline with a user shows the app; `signInRequired: false` shows the app; web never shows it.
- [ ] **Step 2–4:** fail → implement → pass (`npm test -- tests/renderer/sign-in-gate.test.tsx tests/renderer/account-desktop.test.tsx`).
- [ ] **Step 5: Commit** — `feat(desktop): require sign-in`

### Task 16: Catalog warning, unsynced list, Settings cleanup

**Files:** Modify `src/renderer/src/components/SyncBanner.tsx`, `src/renderer/src/features/settings/AccountSection.tsx`, `src/renderer/src/features/settings/SettingsPage.tsx`; Test `tests/renderer/shell.test.tsx`, `tests/renderer/settings.test.tsx`

Requirements:
- `SyncBanner`: when `status.blocked` is set, a persistent warning "Card data can't update right now: {blocked}. Duel Binder will try again." with Retry (→ `api.sync.run`). Takes priority over the other messages except downloading.
- `AccountSection`: when `unsyncedCount > 0`, "{n} cards can't reach your account yet." with a "Show" button opening a dialog listing `api.account.unsynced()` rows (name, set code, set name, rarity, language tag, quantity, reason).
- `SettingsPage`: the eBay section loses the address form and shows only "Prices come from your Duel Binder account."

- [ ] **Step 1: Failing tests** for each of the three.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Commit** — `feat(desktop): show catalog warnings and entries that can't sync`

### Task 17: Release verification (no code; confirm each outward step with the owner)

- [ ] **Step 1:** `npm test` and `npm run typecheck` → all pass; `npx eslint <touched files>` adds no new errors.
- [ ] **Step 2: Ask the owner, then deploy the portal** (`cd workers/portal && npx wrangler deploy`). Check `GET /api/catalog/changes?since=0&limit=1` with a desktop token returns a row.
- [ ] **Step 3: Parity gate:** run the Catalog workflow (`gh workflow run catalog.yml`), watch it; the parity step must report 0 missing pkeys.
- [ ] **Step 4: Dry run on the owner's real data:** copy `~/.config/duel-binder` to `~/.config/duel-binder-switch-test`; `DUEL_BINDER_USER_DATA=~/.config/duel-binder-switch-test npm run dev`. Before: record `collectionCensus` via `sqlite3` (entry count, sum quantity per owner). After the switch: counts match, the backup file exists, and Settings › Account shows 0 cards that can't reach the account (after one sync run). Open Collection, Sets, a printing photo and a Konami logo to confirm images load.
- [ ] **Step 5:** Offline check in the same profile: disconnect, relaunch → the app opens with the cached catalog and no sign-in screen.
- [ ] **Step 6: Ask the owner before tagging the desktop release.**
