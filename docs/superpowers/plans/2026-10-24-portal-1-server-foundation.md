# Duel Binder Portal Plan 1 — Server Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed Cloudflare Worker where a person signs in with Discord, backed by one SQLite Durable Object that holds the full card catalog (kept fresh nightly by GitHub Actions) and answers the app's catalog/collection read calls using the desktop's own repo code.

**Architecture:** The desktop repo layer (`src/main/repo/*`) is narrowed to a tiny `SqlDb` interface that better-sqlite3 already satisfies and a Durable Object adapter also satisfies, and gains an owner `Scope` so the same queries serve one user's rows on the server. All server logic is plain TypeScript over `SqlDb` (unit-tested in Node with better-sqlite3); the Worker just forwards requests to the single `Store` Durable Object. A nightly Action runs the desktop's catalog refresh headlessly into a cached SQLite file and uploads only changed rows.

**Tech Stack:** TypeScript, better-sqlite3 (tests + job), Cloudflare Workers + SQLite Durable Objects (`ctx.storage.sql`), wrangler, `@cloudflare/vitest-pool-workers` (adapter test only), vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-24-web-portal-sync-friends-design.md`

This is plan 1 of 4. Later plans (written after this one lands, against the real interfaces): **2** web build (HTTP `Api`, collection writes, images in R2, on-demand printing photos/eBay prices, per-user stats), **3** desktop sync (desktop sign-in, uids/tombstones, account switching), **4** friends.

## Global Constraints

- Desktop behaviour is unchanged by this plan; the whole existing suite stays green: `npm test` (already `--maxWorkers=2`; never run vitest without a ≤2 worker limit) and `npm run typecheck`.
- Desktop migrations are append-only: add steps to the end of `MIGRATIONS`, never edit a shipped one.
- Code under `src/main/repo/`, `src/main/db/meta.ts`, `src/main/db/schema.ts`, `src/main/db/sql.ts`, `src/shared/` must not import `electron`, `better-sqlite3` (value imports), or `node:*` — the Worker bundles it.
- Cloudflare Workers Paid plan; portal lives in the same account as `ygo-ebay-prices`.
- Secrets (Discord client secret, `ADMIN_TOKEN`, Cloudflare API token) live only in Worker secrets / GitHub secrets.
- Discord OAuth scope: `identify` only.
- Session cookie: `HttpOnly; Secure; SameSite=Lax; Path=/`, 30 days.

## Review Focus

- **Nested transactions on the Durable Object** — `adjustPrinting` calls `addEntry` inside its own transaction; on DO this must still commit/rollback as one unit (Task 4 test).
- **Catalog upload dies halfway** — the next nightly run must resend everything not confirmed; the baseline snapshot advances only after a fully successful upload (Task 7 test).
- **An owned printing vanishes from the catalog** — it is kept and flagged `missing_from_api = 1`, never deleted (Task 6 test).
- **User cancels Discord sign-in or the state doesn't match** — redirect to `/?signin=failed`, no user or session created (Task 5 test).
- **Expired or deleted session** — API answers 401 JSON, not 500; cookie is cleared (Task 5 test).

---

## File Structure

```
src/main/db/sql.ts            NEW  SqlDb interface (subset of better-sqlite3 the repo uses)
src/main/db/schema.ts         NEW  SCHEMA_V* strings, MIGRATIONS, RARITY_LABEL (moved out of database.ts)
src/main/db/database.ts       MOD  openDatabase/migrate only; imports schema.ts
src/main/db/meta.ts           MOD  typed on SqlDb
src/main/repo/scope.ts        NEW  Scope type + LOCAL scope
src/main/repo/*.ts            MOD  typed on SqlDb; collection-touching functions take optional Scope
src/shared/setImages.ts       NEW  setImageKey (moved from images/cache.ts, re-exported there)
src/main/sync/catalog.ts      NEW  refreshCatalog(): the headless catalog refresh desktop startup runs
src/main/index.ts             MOD  startupSync uses refreshCatalog
workers/portal/               NEW  the portal Worker package
  package.json, wrangler.toml, tsconfig.json, vitest.config.mts (workerd tests only)
  src/index.ts                Worker entry + Store Durable Object (thin)
  src/doSql.ts                SqlDb adapter over ctx.storage.sql
  src/migrate.ts              server migration runner + server-only steps
  src/app.ts                  handle(request, deps): router
  src/auth.ts                 Discord OAuth, sessions, /api/me
  src/catalogLoad.ts          /admin/catalog/* upsert/delete/finish
  src/rpc.ts                  POST /api/rpc/:channel for read channels
  test/do.test.ts             workerd test of adapter + migrations (vitest-pool-workers)
tests/portal/*.test.ts        NEW  Node tests of server logic over better-sqlite3 (root vitest, project "portal")
scripts/catalog/              NEW  nightly job: build.ts, diff.ts, upload.ts, vite.config.ts
tests/main/catalog-job.test.ts NEW
.github/workflows/catalog.yml NEW
```

---

### Task 1: `SqlDb` seam — repo runs on any synchronous SQLite

Pure refactor; no behaviour change.

**Files:**
- Create: `src/main/db/sql.ts`, `src/main/db/schema.ts`, `src/shared/setImages.ts`
- Modify: `src/main/db/database.ts`, `src/main/db/meta.ts`, `src/main/repo/{cards,collection,browse,sets,stats}.ts`, `src/main/images/cache.ts`
- Test: `tests/main/sql-seam.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/main/db/sql.ts
  export interface SqlStatement {
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  }
  export interface SqlDb {
    prepare(sql: string): SqlStatement
    exec(sql: string): void
    transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R
  }
  ```
  `src/main/db/schema.ts` exports `SCHEMA_V1…V9`, `RARITY_LABEL`, `MIGRATIONS: Migration[]`, `type Migration = { version: number; sql: string; foreignKeysOff?: true; server?: string | false }` (`server`: SQL the portal runs instead, or `false` to skip there; absent = same SQL).
  `src/shared/setImages.ts` exports `setImageKey(sourceUrl: string | null): string | null` (moved verbatim with its regex).
  Every exported repo/meta function's `db` parameter is `SqlDb`.

- [ ] **Step 1: Write the failing test** `tests/main/sql-seam.test.ts`:
  - `it('better-sqlite3 satisfies SqlDb')`: `const db: SqlDb = openDatabase(':memory:')` compiles and `listSets(db)` returns `[]`.
  - `it('repo modules import nothing platform-bound')`: read each file in `src/main/repo/`, `src/main/db/{meta,schema,sql}.ts`, `src/shared/setImages.ts` as text; assert none matches `/from '(electron|node:[^']+|better-sqlite3)'/` except `import type`.
  - `it('findSetImageUrl uses positional parameters')`: file text of `src/main/repo/sets.ts` does not match `/@key/`.
- [ ] **Step 2: Run** `npx cross-env ELECTRON_RUN_AS_NODE=1 electron ./node_modules/vitest/vitest.mjs run tests/main/sql-seam.test.ts --maxWorkers=2` — Expected: FAIL (module `src/main/db/sql` not found).
- [ ] **Step 3: Implement.** Create `sql.ts`; move schema constants/`MIGRATIONS`/`RARITY_LABEL` to `schema.ts` (database.ts re-exports `SCHEMA_V1`/`SCHEMA_V2`/`SCHEMA_V4`… for existing test imports); move `setImageKey` to `src/shared/setImages.ts` and re-export from `images/cache.ts`; replace `Database.Database` with `SqlDb` in repo + meta; rewrite `findSetImageUrl`'s `@key` query with four `?` and pass `key` four times.
- [ ] **Step 4: Run** `npm test && npm run typecheck` — Expected: all pass.
- [ ] **Step 5: Commit** `refactor(db): repo layer runs on a minimal SqlDb interface`

---

### Task 2: Pkey for printings + server migration runner

**Files:**
- Modify: `src/main/db/schema.ts` (append V10)
- Create: `workers/portal/package.json`, `workers/portal/tsconfig.json`, `workers/portal/src/migrate.ts`
- Modify: `vitest.config.mts` (add project `portal`: node env, include `tests/portal/**/*.test.ts`, same alias), `tsconfig.node.json` (include `workers/portal/src/**/*`, `tests/portal/**/*`)
- Test: `tests/main/database.test.ts` (add case), `tests/portal/migrate.test.ts`

**Interfaces:**
- Produces:
  - Desktop/server migration **V10**: `ALTER TABLE card_printings ADD COLUMN pkey TEXT GENERATED ALWAYS AS (CASE WHEN language = 'en' THEN 'en|' || card_id || '|' || set_code || '|' || set_rarity ELSE language || '|' || card_id || '|' || set_name || '|' || set_code || '|' || set_rarity END) VIRTUAL;` + `CREATE UNIQUE INDEX ux_printings_pkey ON card_printings(pkey);` (mirrors the two partial unique indexes from V3, so it can't collide on existing data).
  - `export function migrateServer(db: SqlDb): void` — runs every `MIGRATIONS` step (using `step.server` when set, skipping when `false`), then `SERVER_STEPS`, each in `db.transaction`, recording done steps in `CREATE TABLE IF NOT EXISTS server_migrations (name TEXT PRIMARY KEY)` as `desktop-<version>` / `server-<n>`. Never issues `PRAGMA`.
  - `SERVER_STEPS[0]` (`server-1`):
    ```sql
    CREATE TABLE users (id INTEGER PRIMARY KEY, discord_id TEXT NOT NULL UNIQUE, username TEXT NOT NULL,
      display_name TEXT, avatar TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX ux_users_username ON users(username COLLATE NOCASE);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'web', created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
    -- collection_entries rebuilt per user, tombstone-ready
    DROP TABLE collection_entries;
    CREATE TABLE collection_entries (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      uid TEXT NOT NULL UNIQUE, printing_id INTEGER NOT NULL REFERENCES card_printings(id),
      image_id INTEGER NOT NULL REFERENCES card_images(image_id), quantity INTEGER NOT NULL CHECK (quantity >= 1),
      notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
    CREATE UNIQUE INDEX ux_entries_live ON collection_entries(user_id, printing_id, image_id) WHERE deleted_at IS NULL;
    DROP TABLE value_snapshots;
    CREATE TABLE value_snapshots (user_id INTEGER NOT NULL REFERENCES users(id), date TEXT NOT NULL,
      total_value REAL NOT NULL, total_cards INTEGER NOT NULL, PRIMARY KEY (user_id, date));
    ```
  - `tests/portal/helpers.ts`: `export async function seededServerDb(): Promise<Database.Database>` — `new Database(':memory:')`, `foreign_keys = ON`, `migrateServer`, then `runSync` with the sample fixture (as `tests/main/helpers.ts` does), plus `addUser(db, discordId, username): number`.
  - `workers/portal/package.json`: `"name": "duel-binder-portal"`, private, `"type": "module"`, scripts `deploy: wrangler deploy`, `dev: wrangler dev`, `test: vitest run --maxWorkers=2`; devDeps `wrangler`, `@cloudflare/workers-types`, `@cloudflare/vitest-pool-workers` (pin a vitest version it supports in this package only).

- [ ] **Step 1: Write failing tests.**
  - `tests/main/database.test.ts` → `it('V10 gives every printing a unique pkey')`: seeded db; `SELECT pkey FROM card_printings WHERE language='en' LIMIT 1` matches `/^en\|\d+\|.+\|.+$/`; `count(DISTINCT pkey) = count(*)`.
  - `tests/portal/migrate.test.ts`: `new Database(':memory:')` with `foreign_keys = ON` → `migrateServer(db)`; assert tables `users`, `sessions`, `collection_entries` (has columns `user_id, uid, deleted_at`), `cards_fts` exist; `server_migrations` has `desktop-1…desktop-10` and `server-1`; calling `migrateServer` again is a no-op (row count unchanged, no throw).
  - `it('a desktop step marked server: false is skipped')`: call an exported `runSteps(db, steps)` helper with a fake `{ version: 99, sql: 'CREATE TABLE nope(x)', server: false }`; table `nope` absent, `desktop-99` recorded.
- [ ] **Step 2: Run** `npm test -- tests/main/database.test.ts tests/portal/migrate.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** V10 in `schema.ts`, `migrateServer`/`runSteps`/`SERVER_STEPS` in `workers/portal/src/migrate.ts`, package scaffolding, vitest project.
- [ ] **Step 4: Run** `npm test && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): printing pkey and server schema`

---

### Task 3: Owner scope — one set of queries, per-user rows

**Files:**
- Create: `src/main/repo/scope.ts`, `workers/portal/src/scope.ts`
- Modify: `src/main/repo/{collection,sets,browse,stats}.ts`
- Test: `tests/portal/scope.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/main/repo/scope.ts
  export interface EntryInsert { printingId: number; imageId: number; quantity: number; notes: string; ts: string }
  export interface Scope {
    /** SQL predicate limiting `alias` (a collection_entries alias) to this owner's live rows. */
    where(alias: string): string
    insertEntry(db: SqlDb, row: EntryInsert): number   // returns new entry id
    deleteEntry(db: SqlDb, id: number, ts: string): void
    snapshotTable: { where: string; insertCols: string; insertVals: string } // value_snapshots scoping
  }
  export const LOCAL: Scope  // where → '1', plain INSERT, DELETE, snapshots unscoped
  // workers/portal/src/scope.ts
  export function userScope(userId: number): Scope
  // where → `${alias}.user_id = ${userId} AND ${alias}.deleted_at IS NULL` (userId asserted Number.isSafeInteger)
  // insertEntry adds user_id and uid = crypto.randomUUID(); deleteEntry sets deleted_at = ts, updated_at = ts
  ```
  Every repo function that reads or writes `collection_entries` or `value_snapshots` takes a trailing optional `scope: Scope = LOCAL` (`listEntries`, `entriesForCard`, `getEntry`, `getFacets`, `addEntry`, `updateEntry`, `removeEntry`, `listSets`, `getChecklist`, `adjustPrinting`, `browseCards`, `getStats`, `recordSnapshot`, and any other function whose SQL names either table). Every read of `collection_entries` adds `${scope.where(alias)}`, including `findExisting` and the subqueries in `sets.ts`/`browse.ts`; every INSERT goes through `scope.insertEntry`; every DELETE (`removeEntry`, `updateEntry`'s merge, `adjustPrinting` at quantity 0) goes through `scope.deleteEntry`.

- [ ] **Step 1: Write failing tests** `tests/portal/scope.test.ts` (db = `seededServerDb()`; users from `addUser`):
  - `it('each user sees only their own entries')`: `addEntry(db, input, now, userScope(1))` ×1, same printing for user 2 qty 3; `listEntries(db, {}, userScope(1))` → one entry qty 1; user 2 → qty 3.
  - `it('adding the same printing twice sums within one user only')`.
  - `it('remove tombstones on the server')`: `removeEntry(db, id, userScope(1))`; `listEntries` empty; raw row has `deleted_at` set; re-adding the same printing+art creates a new live row (unique index is live-only).
  - `it('set checklist ownership is per user')`: `getChecklist(db, set, 'en', userScope(2))` shows owned only for user 2's card.
  - `it('stats and snapshots are per user')`: `recordSnapshot(db, now, userScope(1))` writes `user_id = 1`; `getStats(db, userScope(2))` totals 0.
  - `it('userScope rejects a non-integer id')`: `expect(() => userScope(1.5)).toThrow()`.
- [ ] **Step 2: Run** `npm test -- tests/portal/scope.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `scope.ts` files and thread `scope` through the repo. `recordSnapshot`'s `now` stays the second parameter (signature `recordSnapshot(db, now = new Date(), scope = LOCAL)`); same pattern for `addEntry`/`updateEntry` (`now` before `scope`).
- [ ] **Step 4: Run** `npm test && npm run typecheck` — Expected: all PASS, desktop tests untouched.
- [ ] **Step 5: Commit** `feat(repo): owner scope so the server can serve per-user collections`

---

### Task 4: Durable Object adapter + Worker shell

**Files:**
- Create: `workers/portal/src/doSql.ts`, `workers/portal/src/index.ts`, `workers/portal/src/app.ts` (stub router), `workers/portal/wrangler.toml`, `workers/portal/vitest.config.mts`, `workers/portal/test/do.test.ts`

**Interfaces:**
- Consumes: `SqlDb`, `migrateServer`, `userScope`, repo functions.
- Produces:
  - `export function doSql(storage: DurableObjectStorage): SqlDb` — `prepare(sql)` → `all` = `storage.sql.exec(sql, ...p).toArray()`, `get` = first row or `undefined`, `run` = `{ changes: cursor.rowsWritten, lastInsertRowid: <SELECT last_insert_rowid()> }`; `exec(sql)` = `storage.sql.exec(sql)`; `transaction(fn)` = `(...a) => storage.transactionSync(() => fn(...a))`.
  - `export class Store extends DurableObject` — constructor runs `migrateServer(doSql(ctx.storage))` inside `ctx.blockConcurrencyWhile`; `fetch(req)` → `handle(req, deps)` from `app.ts`.
  - `export interface AppDeps { db: SqlDb; env: Env; now: () => Date; fetch: typeof fetch }` and `export function handle(req: Request, deps: AppDeps): Promise<Response>` (stub: `GET /api/health` → `{ ok: true }`, else 404 JSON).
  - Worker default export: every request → `env.STORE.get(env.STORE.idFromName('main')).fetch(req)`.
  - `wrangler.toml`: `name = "duel-binder-portal"`, `main = "src/index.ts"`, `compatibility_date = "2026-10-01"`, DO binding `STORE` → class `Store`, `[[migrations]] tag = "v1" new_sqlite_classes = ["Store"]`, `[vars] PUBLIC_URL`, `DISCORD_CLIENT_ID`.

- [ ] **Step 1: Write failing workerd test** `workers/portal/test/do.test.ts` (runs inside workerd via vitest-pool-workers, using `runInDurableObject`):
  - `it('all desktop + server migrations apply on DO SQLite')` — `server_migrations` contains `desktop-10` and `server-1`.
  - `it('FTS5 works')` — insert a card row, `INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`, `searchCards(db, 'blue')` finds it.
  - `it('nested transaction rolls back as one unit')` — `db.transaction(() => { insert A; db.transaction(() => insert B)(); throw new Error('x') })` → neither A nor B present.
  - `it('lastInsertRowid is the inserted id')`.
- [ ] **Step 2: Run** `cd workers/portal && npm install && npm test` — Expected: FAIL (no `doSql`).
- [ ] **Step 3: Implement.** If nested `transactionSync` is rejected by workerd, make `transaction` track depth and run inner calls inline (outer transaction already wraps them) — the test decides.
- [ ] **Step 4: Run** `npm test` in `workers/portal`, then `npx wrangler dev` and `curl -s localhost:8787/api/health` — Expected: tests PASS; `{"ok":true}`.
- [ ] **Step 5: Commit** `feat(portal): Durable Object store running the shared repo`

---

### Task 5: Discord sign-in and sessions

**Files:**
- Create: `workers/portal/src/auth.ts`
- Modify: `workers/portal/src/app.ts`
- Test: `tests/portal/auth.test.ts`

**Interfaces:**
- Consumes: `AppDeps`, `handle`.
- Produces:
  - Routes: `GET /auth/discord/start` → 302 to `https://discord.com/oauth2/authorize?response_type=code&client_id=…&scope=identify&redirect_uri=${PUBLIC_URL}/auth/discord/callback&state=…`, setting cookie `oauth_state` (HttpOnly, Secure, SameSite=Lax, Max-Age=600).
    `GET /auth/discord/callback` → on success: exchange code at `https://discord.com/api/oauth2/token`, read `https://discord.com/api/users/@me`, upsert `users` by `discord_id` (username/display_name/avatar refreshed every sign-in), create session, set `session` cookie, clear `oauth_state`, 302 to `/`. On any failure (`error` param, missing/mismatched state, Discord non-2xx): 302 to `/?signin=failed`, nothing written.
    `POST /auth/logout` → deletes session, clears cookie, 204.
    `GET /api/me` → `{ id, username, displayName, avatarUrl }` (avatarUrl `https://cdn.discordapp.com/avatars/<discord_id>/<avatar>.png` or `null`), or 401 `{ error: 'signed-out' }` with the cookie cleared.
  - `export function currentUser(req: Request, deps: AppDeps): { id: number } | null` — session token from cookie `session` (Plan 3 adds `Authorization: Bearer`); looks up `sessions.token_hash = sha256hex(token)` with `expires_at > now`.
  - Session token: 32 random bytes base64url; stored only as SHA-256 hex. Lifetime 30 days.
  - Secrets/vars read: `env.DISCORD_CLIENT_ID`, `env.DISCORD_CLIENT_SECRET`, `env.PUBLIC_URL`.

- [ ] **Step 1: Write failing tests** `tests/portal/auth.test.ts` (better-sqlite3 db + `migrateServer`; `deps.fetch` is a `vi.fn` faking Discord):
  - `it('start redirects to Discord with state cookie')` — Location contains `scope=identify` and the same `state` as the `oauth_state` cookie.
  - `it('callback creates user and session, then /api/me returns them')`.
  - `it('signing in again updates the username, keeps the user id')`.
  - `it('state mismatch → /?signin=failed and no user')`; `it('error=access_denied → /?signin=failed')`; `it('Discord token exchange 500 → /?signin=failed')`.
  - `it('expired session → 401 and Set-Cookie clears session')`; `it('logout deletes the session row')`.
  - `it('session token is not stored in plaintext')` — `sessions.token_hash` ≠ cookie value.
- [ ] **Step 2: Run** `npm test -- tests/portal/auth.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `auth.ts` with Web Crypto (`crypto.getRandomValues`, `crypto.subtle.digest`) so it runs in Node and Workers alike.
- [ ] **Step 4: Run** `npm test -- tests/portal` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): Discord sign-in with server-side sessions`

---

### Task 6: Catalog loader endpoints

**Files:**
- Create: `workers/portal/src/catalogLoad.ts`, `src/shared/catalogTables.ts`
- Modify: `workers/portal/src/app.ts`
- Test: `tests/portal/catalog-load.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/shared/catalogTables.ts — shared by loader and the nightly job (Task 7)
  export interface CatalogTable { name: string; key: string[]; columns: string[] }
  export const CATALOG_TABLES: CatalogTable[]   // upload order
  ```
  Order and keys: `cards [id]`, `card_images [image_id]`, `card_printings [pkey]` (columns exclude `id` and `pkey`), `sets [language, set_name]`, `pack_art [set_name]`, `set_logos [set_name]`, `konami_logos [set_name]`, `tcgplayer_groups [group_id]`, `tcgplayer_products [product_id]`. Columns = every column of the desktop table except noted.
  - All `/admin/*` routes require `Authorization: Bearer ${env.ADMIN_TOKEN}` (constant-time compare) else 401.
  - `POST /admin/catalog/rows` body `{ table: string; rows: Record<string, unknown>[] }` → upsert in one transaction; unknown table/column → 400. `card_printings`: match by computed pkey (`SELECT id FROM card_printings WHERE pkey = ?`), UPDATE (also `missing_from_api = 0`) or INSERT — existing ids never change.
  - `POST /admin/catalog/delete` body `{ table: string; keys: unknown[][] }` → `card_printings`: rows referenced by any `collection_entries` get `missing_from_api = 1`, others deleted; `cards`/`card_images`: ignored; other tables: deleted.
  - `POST /admin/catalog/finish` body `{ meta: { db_version?: string; last_sync_at?: string } }` → `INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`, `setMeta` for given keys.
  - `GET /admin/catalog/status` → `{ counts: Record<table, number> }`.

- [ ] **Step 1: Write failing tests** `tests/portal/catalog-load.test.ts`:
  - `it('rejects without the admin token')`.
  - `it('loads cards and printings, and search finds them after finish')` — rows from the sample fixture shape; `searchCards` after `finish`.
  - `it('re-uploading a printing keeps its id')` — upload, read id, upload same pkey with new `set_price`; id unchanged, price updated.
  - `it('deleting an owned printing flags it missing instead')` — user entry on printing P; delete P → row present, `missing_from_api = 1`; the entry still lists. Unowned printing Q → gone.
  - `it('rejects unknown tables and columns')` → 400.
- [ ] **Step 2: Run** `npm test -- tests/portal/catalog-load.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** (build SQL only from `CATALOG_TABLES` names, never from request strings).
- [ ] **Step 4: Run** `npm test -- tests/portal` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): admin catalog loader`

---

### Task 7: Nightly catalog job

**Files:**
- Create: `src/main/sync/catalog.ts`, `scripts/catalog/build.ts`, `scripts/catalog/diff.ts`, `scripts/catalog/upload.ts`, `scripts/catalog/vite.config.ts`, `.github/workflows/catalog.yml`
- Modify: `src/main/index.ts` (startupSync → `refreshCatalog` + price refresh), `package.json` (script `catalog:job`)
- Test: `tests/main/catalog-job.test.ts`

**Interfaces:**
- Consumes: `CATALOG_TABLES`, admin endpoints (Task 6).
- Produces:
  - `export async function refreshCatalog(db: Database.Database, deps: { client: YgoClient; yugipedia: YugipediaClient; version: string; now?: () => Date; onSyncProgress?: (s: SyncStatus) => void; onChanged?: () => void }): Promise<{ changed: boolean }>` — exactly the catalog part of today's `startupSync` (sync, sets, TCGplayer, pack art, set logos, Konami logos, intl sets) with the same `should*` gates. Desktop keeps the `recordSnapshot`/price/emit calls around it.
  - `export function diffTable(work: Database.Database, base: Database.Database | null, t: CatalogTable): { upserts: Record<string, unknown>[]; deletes: unknown[][] }` — rows of `work` not identical in `base` (all `t.columns` + key compared); keys in `base` absent from `work`. `base === null` → everything is an upsert. Implement with `ATTACH` + `EXCEPT`.
  - `export async function uploadCatalog(opts: { url: string; token: string; work: Database.Database; base: Database.Database | null; fetch?: typeof fetch; batch?: number }): Promise<{ upserted: number; deleted: number }>` — tables in `CATALOG_TABLES` order, batches of 2000 rows, retries each request 3× (1 s, 2 s), throws on final failure; ends with `/admin/catalog/finish` carrying `db_version`/`last_sync_at` from work `meta`.
  - `scripts/catalog/build.ts` (CLI): opens `catalog-work/work.sqlite` via `openDatabase`, runs `refreshCatalog`, opens `catalog-work/base.sqlite` if present, `uploadCatalog`, then on success `VACUUM INTO` a temp file and renames it to `base.sqlite`. Env: `PORTAL_URL`, `PORTAL_ADMIN_TOKEN`. Flag `--full` ignores base; `--dry-run` builds and prints per-table upsert/delete counts without uploading or touching base. Exports `runJob(opts)` for tests.
  - Built with `vite build --config scripts/catalog/vite.config.ts` (SSR/library build → `out/catalog/build.mjs`, better-sqlite3 external) and run as `ELECTRON_RUN_AS_NODE=1 electron out/catalog/build.mjs` (the repo's better-sqlite3 is compiled for Electron). `npm run catalog:job` does both.
  - `.github/workflows/catalog.yml`: `schedule: cron '17 6 * * *'` + `workflow_dispatch` (input `full: boolean`); ubuntu, node 22, `npm ci`; `actions/cache/restore` + `actions/cache/save` (`if: always()`) for `catalog-work/work.sqlite` under key `catalog-work-${{ github.run_id }}` with restore-keys `catalog-work-`; same for `base.sqlite` under `catalog-base-…` but saved **only on success**; env `PORTAL_URL: ${{ vars.PORTAL_URL }}`, `PORTAL_ADMIN_TOKEN: ${{ secrets.PORTAL_ADMIN_TOKEN }}`; `timeout-minutes: 340`.

- [ ] **Step 1: Write failing tests** `tests/main/catalog-job.test.ts`:
  - `it('refreshCatalog runs the same steps desktop startup ran')` — fake clients; seeded result has cards and sets; second call with `now` inside the intervals makes no client calls.
  - `it('diff with no base uploads everything')`; `it('diff sends only changed rows and deletions')` — copy work → base, change one printing's price, delete one set: 1 printing upsert keyed by pkey with no `id` field, 1 set delete.
  - `it('upload batches, retries a 503 then succeeds')` — fake fetch: 2001 cards → 2 `/rows` calls for `cards`, one 503 retried; finish called last.
  - `it('failed upload leaves base untouched')` — fetch always 500: `uploadCatalog` rejects; the CLI's `runJob` (export it from build.ts for testing) does not write `base.sqlite`.
- [ ] **Step 2: Run** `npm test -- tests/main/catalog-job.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the four modules, swap desktop `startupSync` onto `refreshCatalog`, add the workflow.
- [ ] **Step 4: Run** `npm test && npm run typecheck`, then `npm run catalog:job -- --dry-run` (dry run: build + diff counts, no upload) — Expected: PASS; prints per-table upsert counts.
- [ ] **Step 5: Commit** `feat(catalog): nightly job uploads catalog changes to the portal`

---

### Task 8: Read API over RPC

**Files:**
- Create: `workers/portal/src/rpc.ts`
- Modify: `workers/portal/src/app.ts`
- Test: `tests/portal/rpc.test.ts`

**Interfaces:**
- Consumes: `currentUser`, `userScope`, repo functions, `INVOKE_CHANNELS` from `src/shared/ipc.ts`.
- Produces: `POST /api/rpc/:channel` with JSON body `{ args: unknown[] }` → `200 { result }`, `401` signed out, `404 { error: 'unknown-channel' }` for channels not yet served, `400 { error }` on `CollectionError`/bad args, `415` unless `content-type: application/json` (CSRF guard). Plan 1 serves exactly: `cards:search`, `cards:get`, `cards:browse`, `cards:browseFacets`, `sets:list`, `sets:checklist`, `collection:list`, `collection:forCard`, `collection:facets` — each calling the repo with `userScope(user.id)`. `sets:checklist` validates the language with `isLanguage`. Channel → handler map is typed against `Api` so Plan 2 adds writes in the same table.

- [ ] **Step 1: Write failing tests** `tests/portal/rpc.test.ts`: signed-in request to `cards:search` with `['blue']` returns results; `collection:list` returns only the caller's entries; signed-out → 401; `text/plain` body → 415; `collection:add` → 404 (not served yet); `sets:checklist` with language `'xx'` → 400.
- [ ] **Step 2: Run** `npm test -- tests/portal/rpc.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `rpc.ts`.
- [ ] **Step 4: Run** `npm test && npm run typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): read-only RPC for catalog and collection`

---

### Task 9: Deploy and first catalog load

Needs the owner for the Discord app and secrets; pause and ask when you reach Step 1.

**Files:**
- Create: `workers/portal/README.md` (setup: Discord app, secrets, vars, first load)
- Modify: `CLAUDE.md` (remove "Cloud sync or user accounts" from Out of scope; add a line under Goals: web portal, sync and friends via the `workers/portal` Worker)

- [ ] **Step 1: Owner setup** (ask the owner): buy `duelbinder.com` (Cloudflare Registrar is simplest) and attach it to the Worker as a custom domain; create a Discord application named Duel Binder, add redirects `https://duelbinder.com/auth/discord/callback` and `https://duel-binder-portal.project96.workers.dev/auth/discord/callback`; provide client id/secret.
- [ ] **Step 2: Configure:** set `PUBLIC_URL`/`DISCORD_CLIENT_ID` in `wrangler.toml`; `npx wrangler secret put DISCORD_CLIENT_SECRET` and `ADMIN_TOKEN` (generate with `openssl rand -base64 32`, never echo); `gh secret set PORTAL_ADMIN_TOKEN` (pipe, don't print) and `gh variable set PORTAL_URL`; Cloudflare API token secret is not needed for this plan (no R2 yet).
- [ ] **Step 3: Deploy** `cd workers/portal && npx wrangler deploy` — Expected: URL printed; `curl -s $URL/api/health` → `{"ok":true}`.
- [ ] **Step 4: First load:** merge this branch to `main` first (GitHub only runs manual or scheduled workflows whose file is on the default branch), then `gh workflow run catalog.yml -f full=true`, watch it — Expected: success; `curl -H "Authorization: Bearer …" $URL/admin/catalog/status` shows ~15k cards and tens of thousands of printings.
- [ ] **Step 5: Smoke sign-in:** open `$PUBLIC_URL/auth/discord/start` in a browser, sign in, then `$PUBLIC_URL/api/me` shows the owner's Discord name (use the `PUBLIC_URL` origin, not the workers.dev URL: the session cookie lives on that host).
- [ ] **Step 6: Commit** `docs(portal): setup README; cloud sync now in scope`
