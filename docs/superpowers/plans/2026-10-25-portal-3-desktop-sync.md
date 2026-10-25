# Portal 3: Desktop Sign-in, Sync and Server Prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- A desktop user signs in with Discord from Settings, and the app keeps that account's collection in step with app.duelbinder.com. No card is lost, duplicated or brought back after deletion.
- Switching accounts is lossless.
- eBay prices come from the server for everyone signed in.
- The desktop app still works fully offline and signed out.

**Architecture:**
- *Desktop migration 12* gives local entries a `uid`, an `owner_id`, tombstones and a `dirty` flag. It also makes value snapshots per owner.
- *`LOCAL` scope* now means "the active owner's live rows": the signed-in account, or the last account after sign-out. A new `Scope.touch` SQL fragment marks local writes dirty and gives server writes a fresh `server_seq`.
- *The Worker* gains three things. A Durable Object alarm keeps eBay prices fresh for every printing anyone owns, reusing `refreshIntlPrices`. Desktop bearer tokens are issued through a loopback-redirect sign-in with a PKCE-bound one-time code. `/api/sync/{push,pull,prices}` routes use the merge rule in `src/shared/cloud.ts`.
- *In the Electron main process*, `src/main/cloud/*` holds the encrypted token file, the per-owner sync engine, a scheduler and an account service.
- *The renderer* only ever sees an `AccountStatus`.

**Tech Stack:** Electron 44 (`safeStorage`, `net`, `shell`), better-sqlite3, Cloudflare Workers + Durable Object SQLite and alarms, React 19 + TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-web-portal-sync-friends-design.md`. The sections that apply are Accounts & auth, Desktop local changes, Sync protocol, Shared catalog (prices), Decisions and Constraints. The owner revised the account-switching decision for this plan; see Decisions below. Plans 1 and 2 (`docs/superpowers/plans/2026-10-24-portal-1-server-foundation.md` and `docs/superpowers/plans/2026-10-25-portal-2-web-app.md`) built the server, `Scope`/`userScope`, the write RPC and the web `AccountSection` that this plan extends.

**Scope:** Plan 4 is next. It moves the catalog, international sets and printing art to the server instead of each client scraping YGOPRODeck and Yugipedia. Friends move to Plan 5.

## Global Constraints

- Run vitest only with `--maxWorkers=2`. Root `npm test` and `workers/portal` `npm test` already pass it. Never run vitest without a limit of 2 or fewer workers.
- **Signed out and never signed in**, the desktop behaves exactly as it does today, including fetching eBay prices directly. The only visible differences are the new Settings Account section and the 2000-character notes cap. The whole existing suite stays green, after the test edits each task names.
- Desktop migrations are append-only: add steps to the end of `MIGRATIONS` and never edit a shipped one. The live server has run `desktop-1`…`desktop-11` and `server-1`.
- Code under `src/main/repo/`, `src/main/db/{meta,schema,sql}.ts`, `src/main/prices/{client,refresh}.ts` and `src/shared/` must not import `electron`, `better-sqlite3` (value imports) or `node:*`, because the Worker bundles it. `@shared/*` may only be imported with `import type` in those files. `src/main/cloud/*` is desktop-only.
- The desktop token never reaches the renderer: no IPC channel, event payload or `AccountStatus` field carries it.
  - It is stored only in `<userData>/account.json`, encrypted by the injected `Cipher` (Electron `safeStorage` in production; basic_text on a Linux system with no keyring is accepted). It is never stored in `collection.db`.
  - On the server it is stored only as a SHA-256 hex in `sessions`, with `kind = 'desktop'`.
- Secrets live only in Worker secrets or `.env`. Never print or commit them. The desktop binary embeds no secret.
- Limits, all in `src/shared/cloud.ts`:
  - `MAX_PUSH = 500` entries per push;
  - `MAX_PULL = 1000` rows per pull page and pkeys per price request;
  - `MAX_NOTES = 2000` characters;
  - `FUTURE_SKEW_MS = 600_000`: an edit time more than 10 minutes ahead of server time is clamped to server time.
- Commit after each task on branch `portal-3-desktop-sync`. Push, merge, deploy and any desktop release wait for the owner (Task 11). Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions

Owner-decided (revising the spec's merge-or-start-fresh prompt):
- **Every local entry and snapshot has an owner.** `owner_id = 0` means never-signed-in data. The **first** account to sign in adopts it, including its value history, and it is merged on the server by the normal sync rules. After that there is never a prompt.
- **Switching is lossless.** Signing in as B leaves A's rows, including unpushed edits, tagged A and untouched, and pulls B. Signing back in as A shows A's rows again and pushes A's signed-out edits.
- **Before a deliberate sign-out**, the app makes one best-effort push for the current account. If it fails, the rows stay dirty for that owner.
- **The token persists whether or not there's a keyring**, using the pattern from the owner's axiroster `secrets.ts`.
- **The server is the source of truth for eBay prices.** A signed-in desktop gets prices from the server and never calls the eBay Worker.

Builder's choice:
- **Sign-in return path:** a loopback redirect to `http://127.0.0.1:<random port>/callback`. It needs no OS protocol registration, so it works the same in dev, AppImage, Windows and macOS (RFC 8252). The browser only carries a one-time code bound by PKCE to a verifier that stays in the app.
- **`owner_id` is `INTEGER NOT NULL DEFAULT 0`, not NULL.** SQLite treats NULLs as distinct in unique indexes. With NULL for local data, the live-row index and the snapshot upsert would stop working for that data.
- **The active owner lives in meta `cloud_active_owner`.** `LOCAL` reads it inside its SQL, so no repo call site changes.
- **Tombstones always.** Clean, pushed tombstones are purged per owner after that owner syncs. Pulled entries whose printing or art is missing locally wait in `sync_pending`, keyed by owner. They are retried on every sync and after every catalog refresh, and never dropped.
- **Server prices run from a Durable Object alarm, not a cron.**
  - Why: the price table lives in the DO, so an alarm needs no extra hop. It can be pulled earlier the moment someone adds a card. Each alarm run is its own invocation with its own subrequest budget.
  - Batches are `PRICE_BATCH = 25` lookups per run. That is 25 subrequests, far below the Workers Paid limit. At most 25 × the 15 s client timeout ≈ 6 min of wall time, inside the alarm's 15 min limit.
  - Re-arm 60 s later while work remains, 1 h after a run where every lookup failed, otherwise 6 h later.
- **Desktop prices:** each sync, a signed-in desktop sends the pkeys of its owned printings whose local price is missing or older than 7 days (`MAX_PULL` at most). It stores any fresher server rows. After a push that added live entries, it syncs once more 20 s later to pick up their new prices.
- **Migration ordering:** any desktop step from 12 on that touches `collection_entries` or `value_snapshots` must set `server: false` and put the server's version in a new `SERVER_STEPS` entry. A test compares an upgraded server's schema with a fresh one.
- **Timings:** a 5 s debounce after edits, a sync every 5 min while open, a network check every 30 s, and backoff of 30 s, 1, 2, 5 and 15 min. Desktop tokens last 365 days, sliding forward on use (at most daily). One-time codes last 120 s. The final push before sign-out is capped at 10 s.

## Review Focus

1. **Switching A → B → A**: A's collection reappears intact, including an edit A made while signed out, which is then pushed to A's account. B never sees A's cards. (Task 9 test `switching A→B→A restores A, including A's signed-out edit`.)
2. **An edit made while a push is in flight**: the entry stays dirty and goes up on the next push. (Task 6 test `an edit made during a push stays dirty`.)
3. **One device's clock is a year ahead**: the server clamps its edit times to server time. (Task 5 test `far-future times are clamped to server time`.)
4. **The app quits or the network drops between push and pull**: the next sync finishes with no duplicate entries and no lost cursor. (Task 7 test `a sync cut off after push resumes without duplicates`.)
5. **The token is revoked elsewhere or expires**: the desktop shows signed out, keeps every card and its owner, and stops retrying against a 401. (Task 9 test `a 401 during sync signs out without losing data`.)

---

### Task 1: Migrations and the owner-aware LOCAL scope

**Files:**
- Modify:
  - `src/main/db/schema.ts` (append `SCHEMA_V12` and its MIGRATIONS entry);
  - `src/main/db/meta.ts`;
  - `workers/portal/src/migrate.ts`;
  - `src/main/repo/scope.ts`;
  - `src/main/dev/fakeData.ts` (its INSERT supplies `uid`; `owner_id` defaults to 0).
- Test: `tests/main/database.test.ts`, `tests/portal/migrate.test.ts`, `workers/portal/test/do.test.ts`, `tests/main/owner-scope.test.ts` (create). Also update the direct `INSERT INTO collection_entries` in `tests/main/sync.test.ts`, `tests/main/intl-sync.test.ts` and `tests/main/database.test.ts` (those on a v12 database) to supply a `uid`.

**Interfaces:**
- Produces: desktop migration `{ version: 12, sql: SCHEMA_V12, server: false }`:
  ```sql
  CREATE TABLE collection_entries_new (id INTEGER PRIMARY KEY, uid TEXT NOT NULL UNIQUE, owner_id INTEGER NOT NULL DEFAULT 0,
    printing_id INTEGER NOT NULL REFERENCES card_printings(id), image_id INTEGER NOT NULL REFERENCES card_images(image_id),
    quantity INTEGER NOT NULL CHECK (quantity >= 1), notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, deleted_at TEXT, dirty INTEGER NOT NULL DEFAULT 1);
  INSERT INTO collection_entries_new (id, uid, printing_id, image_id, quantity, notes, created_at, updated_at)
    SELECT id, lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
      || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
      printing_id, image_id, quantity, notes, created_at, updated_at FROM collection_entries;
  DROP TABLE collection_entries;
  ALTER TABLE collection_entries_new RENAME TO collection_entries;
  CREATE UNIQUE INDEX ux_entries_live ON collection_entries(owner_id, printing_id, image_id) WHERE deleted_at IS NULL;
  CREATE INDEX ix_entries_dirty ON collection_entries(owner_id) WHERE dirty = 1;
  CREATE TABLE value_snapshots_new (owner_id INTEGER NOT NULL DEFAULT 0, date TEXT NOT NULL, total_value REAL NOT NULL,
    total_cards INTEGER NOT NULL, PRIMARY KEY (owner_id, date));
  INSERT INTO value_snapshots_new (date, total_value, total_cards) SELECT date, total_value, total_cards FROM value_snapshots;
  DROP TABLE value_snapshots;
  ALTER TABLE value_snapshots_new RENAME TO value_snapshots;
  CREATE TABLE sync_pending (owner_id INTEGER NOT NULL, uid TEXT NOT NULL, pkey TEXT NOT NULL, entry TEXT NOT NULL,
    received_at TEXT NOT NULL, PRIMARY KEY (owner_id, uid));
  CREATE TABLE cloud_accounts (owner_id INTEGER PRIMARY KEY, name TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, synced_at TEXT);
  ```
  No table references `collection_entries` or `value_snapshots`, so the step does not need `foreignKeysOff`.
- Produces: `SERVER_STEPS[1]` (`server-2`):
  ```sql
  ALTER TABLE collection_entries ADD COLUMN server_seq INTEGER NOT NULL DEFAULT 0;
  UPDATE collection_entries SET server_seq = id;
  CREATE UNIQUE INDEX ux_entries_seq ON collection_entries(server_seq);
  CREATE INDEX ix_entries_user_seq ON collection_entries(user_id, server_seq);
  CREATE INDEX ix_entries_printing_live ON collection_entries(printing_id) WHERE deleted_at IS NULL;
  CREATE TABLE desktop_codes (code_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge TEXT NOT NULL, expires_at TEXT NOT NULL);
  CREATE INDEX ix_sessions_expires ON sessions(expires_at);
  ```
  The doc comment on `SERVER_STEPS` states the ordering rule from Decisions.
- Produces: `MetaKey` gains `'cloud_active_owner'` (the owner id as an integer string; absent means 0) and `'cloud_user'` (the signed-in user's `Me` as JSON; absent when signed out).
- Produces in `src/main/repo/scope.ts`:
  - `export const ACTIVE_OWNER = "(SELECT COALESCE((SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'cloud_active_owner'), 0))"`.
  - `LOCAL.where(alias)` returns `` `${alias}.owner_id = ${ACTIVE_OWNER}` ``. Task 2 adds the tombstone filter.
  - `LOCAL.insertEntry` writes `uid = crypto.randomUUID()` and `owner_id = ${ACTIVE_OWNER}`.
  - `LOCAL.snapshotTable = { insertCols: 'owner_id, ', insertVals: \`${ACTIVE_OWNER}, \` }`, so the upsert conflict target becomes `owner_id, date`.

- [ ] **Step 1: Write the failing tests.**
  - `database.test.ts` `V12 gives every entry a uuid, owner 0 and dirty`: a v11 database with two entries and one snapshot migrates to `user_version` 12. Each `uid` matches `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`, the uids are distinct, and `owner_id = 0`, `dirty = 1`. Quantities, notes, timestamps and the snapshot (now `owner_id = 0`) are unchanged.
  - `database.test.ts` `V12 allows a tombstone beside a live entry and one live entry per owner`: for one printing+art, a live row for owner 0 plus a tombstone for owner 0 plus a live row for owner 7 → ok. A second live row for owner 0 throws `UNIQUE`.
  - Update the existing `user_version` assertions from 11 to 12.
  - `owner-scope.test.ts` (`seededDb()`):
    - `entries and snapshots follow the active owner`: add entry X with no active owner. Set `cloud_active_owner = '7'`, then `listEntries` is empty, `addEntry` creates a row with `owner_id = 7`, `recordSnapshot` writes an owner-7 row, and `getStats` counts only that row. Delete the meta key and X is listed again.
  - `migrate.test.ts` `desktop-12 is skipped and server-2 numbers entries`: run `runSteps(db, [...MIGRATIONS.slice(0, 11), SERVER_STEPS[0]])`, insert two entries, then `migrateServer` → `server_migrations` has `desktop-12` and `server-2`, `server_seq` equals `id`, there are no `owner_id`/`dirty` columns, and `desktop_codes` exists.
  - `migrate.test.ts` `upgraded and fresh servers end with the same schema`: `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name` is equal for both.
  - `migrate.test.ts` `late desktop steps touching collection data have a server override`: every `MIGRATIONS` step with `version >= 12` whose `sql` matches `/collection_entries|value_snapshots/` has `server !== undefined`.
  - `do.test.ts`: the migrations test expects `desktop-12` and `server-2`. A new test `next-seq update runs on DO` runs `UPDATE … SET server_seq = (SELECT COALESCE(MAX(server_seq), 0) + 1 FROM collection_entries) WHERE id = ?`, and `server_seq` grows by 1.
- [ ] **Step 2: Run** `npm test -- tests/main/database.test.ts tests/main/owner-scope.test.ts tests/portal/migrate.test.ts` and expect failures.
- [ ] **Step 3: Implement** the migrations, the MetaKeys, the `LOCAL` changes and the `fakeData` uid. Fix the named test INSERTs. `LOCAL.deleteEntry` still hard-deletes until Task 2.
- [ ] **Step 4: Run** `npm test`, root `npm run typecheck`, and `cd workers/portal && npm test && npm run typecheck`. Everything must pass.
- [ ] **Step 5: Commit** `feat(db): entry uids, owners, tombstone columns and server_seq`.

---

### Task 2: Tombstones and change tracking in the repo

**Files:**
- Modify: `src/main/repo/scope.ts`, `workers/portal/src/scope.ts`, `src/main/repo/collection.ts`, `src/main/repo/sets.ts`, `src/main/repo/args.ts`, `src/main/prices/refresh.ts`, `src/main/dev/fakeData.ts`, `src/main/index.ts:157`, `src/main/ipc/handlers.ts`, `workers/portal/src/rpc.ts`
- Create: `src/shared/cloud.ts` (constants only; Tasks 4 and 5 add the rest), `tests/main/tombstones.test.ts`
- Test: `tests/portal/scope.test.ts`, `tests/main/handlers.test.ts`, and any `tests/main/collection.test.ts` case that asserts a hard delete (change it to assert a tombstone)

**Interfaces:**
- Produces: `Scope.touch: string`, an SQL assignment that every `UPDATE collection_entries SET …` in `src/main/repo/` appends (`…, updated_at = ?, ${scope.touch} WHERE id = ?`).
  - `LOCAL.touch = 'dirty = 1'`.
  - `userScope(id).touch = \`server_seq = ${NEXT_SEQ}\``, with `export const NEXT_SEQ = '(SELECT COALESCE(MAX(server_seq), 0) + 1 FROM collection_entries)'` in `workers/portal/src/scope.ts`.
- Produces: `LOCAL.where(alias)` returns `` `${alias}.owner_id = ${ACTIVE_OWNER} AND ${alias}.deleted_at IS NULL` ``.
  - `LOCAL.deleteEntry(db, id, ts)` runs `UPDATE collection_entries SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ? AND deleted_at IS NULL`.
  - `userScope.insertEntry` and `userScope.deleteEntry` also set `server_seq = NEXT_SEQ`.
- Produces: `src/shared/cloud.ts` exports `MAX_PUSH = 500`, `MAX_PULL = 1000`, `MAX_NOTES = 2000` and `FUTURE_SKEW_MS = 600_000`.
- Produces: `checkNotesLength(v: unknown): void` moves from `rpc.ts` to `src/main/repo/args.ts`, using `MAX_NOTES` and throwing `CollectionError('notes must be at most 2000 characters')`. Desktop handlers `collection:add` and `collection:update` call it too.
- Queries outside `scope.where` that must exclude tombstones:
  - the `prices/refresh.ts` owned-printing `EXISTS` adds `AND e.deleted_at IS NULL`, for any owner or user, so the same SQL means "owned by anyone" on desktop and server;
  - the `fakeData.ts` and `index.ts:157` seed checks add `WHERE deleted_at IS NULL`.
- Deliberately unchanged: the catalog delete-or-flag checks in `sync/sync.ts`, `sync/intl.ts`, `tcgplayer/catalog.ts` and `workers/portal/src/catalogLoad.ts`. A tombstone still references its printing through the foreign key, so the printing is flagged until the tombstone is purged.

- [ ] **Step 1: Write the failing tests.**
  - `tombstones.test.ts` (`seededDb()`; entries A and B on different printings; `removeEntry(db, A.id)`):
    - `removing an entry keeps a dirty tombstone`.
    - `tombstones are invisible to every reader`: `listEntries`, `getEntry` (null), `entriesForCard`, `getFacets`, `getStats`, `browseCards` owned count, `listSets` owned count and `getChecklist` all ignore A. `adjustPrinting(-1)` on A's printing leaves the tombstone alone.
    - `re-adding a removed printing makes a new live entry`: a new id and uid, and the tombstone is unchanged.
    - `every local write marks the entry dirty`: set `dirty = 0` on every row before each action. Then check: add new; add-sum; update; an update that merges (survivor dirty, absorbed row tombstoned and dirty); `adjustPrinting` +1 and -1 to zero; remove. Each marks only the affected rows.
    - `the price refresh ignores removed copies`.
    - `every collection_entries query is accounted for`: count the occurrences of `collection_entries` per file under `src/main` and `workers/portal/src`. They must equal a pinned map, each file commented "scoped" or "catalog FK check, tombstones intentionally count".
    - `every repo UPDATE of collection_entries applies scope.touch`: every `/UPDATE collection_entries SET[^`']*/` match in `src/main/repo/*.ts` contains `${scope.touch}`.
  - `scope.test.ts` `every server write takes a new server_seq`: add new, add-sum, update, update-merge (both rows), `adjustPrinting` -1 and remove each leave the touched rows with a higher `server_seq` than any before.
  - `handlers.test.ts` `desktop notes are capped at 2000`.
- [ ] **Step 2: Run** `npm test -- tests/main/tombstones.test.ts tests/portal/scope.test.ts tests/main/handlers.test.ts` and expect failures.
- [ ] **Step 3: Implement.** The four repo UPDATEs that take `touch` are the `addEntry` sum, both `updateEntry` updates and the `adjustPrinting` decrement.
- [ ] **Step 4: Run** `npm test`, root `npm run typecheck`, and `cd workers/portal && npm test && npm run typecheck`. All must pass.
- [ ] **Step 5: Commit** `feat(repo): tombstones, dirty tracking and server_seq on every write`.

---

### Task 3: eBay prices on the server

**Files:**
- Modify:
  - `src/main/prices/refresh.ts` (typed on `SqlDb`; `limit`; missing-first order);
  - `src/main/ipc/handlers.ts` and `src/main/index.ts` (type-only fallout);
  - `workers/portal/src/{app.ts,rpc.ts,index.ts}`;
  - `workers/portal/wrangler.toml` (`[vars] PRICE_WORKER_URL = "https://ygo-ebay-prices.project96.workers.dev"`);
  - `tests/main/sql-seam.test.ts` (add `src/main/prices/{client,refresh}.ts` to the platform-free file list);
  - existing portal test fixtures (new `AppDeps.prices`).
- Create: `workers/portal/src/prices.ts`, `tests/portal/prices.test.ts`

**Interfaces:**
- Produces: `refreshIntlPrices(db: SqlDb, client: PriceClient | null, opts?: { now?: Date; printingIds?: number[]; limit?: number }): Promise<{ updated: number; failed: number; remaining: number }>`.
  - Candidates are ordered `ip.printing_id IS NULL DESC, ip.checked_at, p.id` (never-priced first).
  - `remaining` is the number of candidates left past `limit`.
  - Behaviour is otherwise unchanged: it never rejects and sets `price_service_status`.
- Produces: `needsPrice(db: SqlDb, printingId: number, now?: Date): boolean` and `export function priceCandidates(db: SqlDb, now: Date, opts?: { printingIds?: number[]; limit?: number }): { id: number; pkey: string; code: string; name: string; set: string; rarity: string; lang: Language }[]` (the former private `candidates`, plus `pkey`).
- Produces: `workers/portal/src/prices.ts`:
  ```ts
  export const PRICE_BATCH = 25
  export const PRICE_SOON_MS = 5_000, PRICE_MORE_MS = 60_000, PRICE_FAILED_MS = 3_600_000, PRICE_IDLE_MS = 21_600_000
  export interface AlarmStorage { getAlarm(): Promise<number | null>; setAlarm(t: number): Promise<void> }
  export interface PriceQueue { soon(): Promise<void> }  // arm the alarm PRICE_SOON_MS ahead unless one is already due sooner
  export function alarmQueue(storage: AlarmStorage, now: () => number): PriceQueue
  /** One alarm run: refresh up to PRICE_BATCH, then re-arm (more left and something updated → +60 s; all failed → +1 h; else +6 h). Never throws. */
  export async function runPriceAlarm(db: SqlDb, client: PriceClient | null, storage: AlarmStorage, now: () => Date): Promise<void>
  ```
- `AppDeps` gains `prices: PriceQueue`.
  - `Store` passes `alarmQueue(ctx.storage, Date.now)`.
  - `Store` implements `async alarm()` → `runPriceAlarm(db, createPriceClient({ url: env.PRICE_WORKER_URL }), ctx.storage, () => new Date())`.
  - After migrating, `Store` calls `prices.soon()` if `getAlarm()` is null.
  - `Env` gains `PRICE_WORKER_URL: string`.
- `rpcRoute` awaits `deps.prices.soon()` after a successful `collection:add`, `collection:update` or `sets:adjust`. Task 5's push route does the same when any live entry was applied.
- The web picks up server prices with no further change, because `listEntries` already reads `intl_prices` and `price_service_status`.

- [ ] **Step 1: Write the failing tests** in `tests/portal/prices.test.ts`, with a fake `PriceClient`, a fake `AlarmStorage` and `seededServerDb()` holding users Alice and Bob:
  - `the alarm prices printings owned by any user, never-priced first, in batches`: Alice owns P1 and Bob owns P2. With `PRICE_BATCH` overridden to 1 through `limit`:
    - the first run prices one and arms +60 s;
    - the second run prices the other and arms +6 h.
  - `printings owned by nobody, or only by tombstones, are skipped`.
  - `prices older than 7 days are refreshed and fresher ones are left alone`.
  - `a failing price Worker re-arms in an hour and never throws`.
  - `soon() never pushes an earlier alarm later`.
  - `a web add queues a lookup; reads don't`: spy `prices.soon` is called once for `collection:add`, and not for `collection:list`.
  - `the web shows the server price`: after a run, `collection:list` returns the entry with `unitPrice` equal to the fake price and `priceSource: 'ebay'`.
  - `sql-seam.test.ts`: the prices files import nothing platform-bound.
- [ ] **Step 2: Run** `npm test -- tests/portal/prices.test.ts tests/main/sql-seam.test.ts tests/main/prices.test.ts` and expect failures.
- [ ] **Step 3: Implement.** The desktop's behaviour is unchanged, and the existing `tests/main/prices.test.ts` must still pass.
- [ ] **Step 4: Run** `npm test`, both typechecks, and `cd workers/portal && npm test`. All must pass.
- [ ] **Step 5: Commit** `feat(portal): server keeps eBay prices fresh for every owned printing`.

---

### Task 4: Desktop tokens on the server

**Files:**
- Modify: `workers/portal/src/auth.ts`, `workers/portal/src/app.ts`, `workers/portal/src/rpc.ts`, `workers/portal/src/home.ts` (callers of `currentUser`), `src/shared/cloud.ts` (add `Me`), `src/renderer/src/web/account.ts` (re-export `Me` from `@shared/cloud`)
- Create: `tests/portal/desktop-auth.test.ts`

**Interfaces:**
- Produces: `Me` in `src/shared/cloud.ts`: `{ id: number; username: string; displayName: string | null; avatarUrl: string | null }`.
- Produces: `export interface SessionUser { id: number; kind: 'web' | 'desktop' }` and `currentUser(req, deps): Promise<SessionUser | null>`.
  - If an `Authorization: Bearer <token>` header is present, only that token is used, and it only matches `kind = 'desktop'` rows.
  - Otherwise the `session` cookie is used, and it only matches `kind = 'web'` rows.
  - A desktop match whose `expires_at` is less than `now + 364 days` is moved to `now + 365 days`.
- Routes:
  - `GET /auth/desktop/start?port=&state=&challenge=` validates its parameters:
    - `port` is an integer from 1024 to 65535;
    - `state` matches `/^[A-Za-z0-9_-]{16,128}$/`;
    - `challenge` matches `/^[A-Za-z0-9_-]{43}$/`.

    Bad values get a 400 text page. Like `startSignIn`, it bounces to `PUBLIC_URL` first. Then it sets cookie `desktop_auth=<port>.<state>.<challenge>` (HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=600), plus `oauth_state`, and sends a 302 to Discord authorize with `prompt=consent`.
  - `GET /auth/discord/start` (the web flow) clears `desktop_auth`.
  - `GET /auth/discord/callback` with a valid `desktop_auth` cookie:
    - on success: upserts the user, inserts `desktop_codes` (sha256 of a 32-byte base64url code, the challenge, `expires_at = now + 120 s`), creates **no** web session, clears both cookies and sends a 302 to `http://127.0.0.1:<port>/callback?code=<code>&state=<state>`;
    - on any failure: a 302 to `http://127.0.0.1:<port>/callback?error=signin-failed&state=<state>`.
  - `POST /auth/desktop/token` takes JSON `{ code: string; verifier: string }`. It deletes the code row **whatever the outcome**.
    - An unexpired code with `base64url(sha256(verifier)) === challenge` → insert a `sessions` row (`kind = 'desktop'`, `expires_at = now + 365 days`) and answer `200 { token: string; user: Me }`.
    - Otherwise answer `400 { error: 'invalid-code' }`.
  - `POST /auth/desktop/revoke` with a desktop Bearer deletes that session and answers 204. Without one it answers 401.
- Carry-overs from the earlier plans: `finishSignIn` and the token exchange first run `DELETE FROM sessions WHERE expires_at <= ?` and `DELETE FROM desktop_codes WHERE expires_at <= ?`. The user upsert and the session or code insert share one transaction.

- [ ] **Step 1: Write the failing tests** in `tests/portal/desktop-auth.test.ts`, using the fake-Discord pattern of `tests/portal/auth.test.ts`:
  - `desktop start validates its parameters`: port `80`, `abc`, a missing challenge or a 42-character challenge → 400.
  - `desktop start sets the desktop cookie and asks Discord for consent`.
  - `desktop callback hands a one-time code to the loopback address`: no `session` cookie, and the stored `code_hash` is not the code.
  - `failed Discord callback in the desktop flow tells the app`: Location has `error=signin-failed`.
  - `token exchange returns a desktop token for the right verifier only`:
    - a wrong verifier → 400, and then the right verifier with the same code → 400 (consumed);
    - a fresh code → 200, with `kind = 'desktop'` expiring 365 days ahead.
  - `an expired code is refused`: 121 s later.
  - `bearer tokens and cookies don't cross over`: the desktop Bearer → `/api/me` 200 and `/api/rpc/collection:list` 200; the desktop token as a cookie → 401; a web token as a Bearer → 401.
  - `revoke deletes only that desktop session`.
  - `desktop expiry slides on use`.
  - `web sign-in clears a stale desktop cookie`.
  - `expired sessions are pruned at sign-in`.
- [ ] **Step 2: Run** `npm test -- tests/portal/desktop-auth.test.ts` and expect failures.
- [ ] **Step 3: Implement** with Web Crypto only.
- [ ] **Step 4: Run** `npm test -- tests/portal` and `cd workers/portal && npm run typecheck`. Both must pass.
- [ ] **Step 5: Commit** `feat(portal): desktop sign-in with revocable bearer tokens`.

---

### Task 5: Sync push, pull and prices on the server

**Files:**
- Modify: `src/shared/cloud.ts`, `workers/portal/src/app.ts`
- Create: `workers/portal/src/sync.ts`, `tests/portal/sync.test.ts`

**Interfaces:**
- Consumes: `currentUser`/`SessionUser` (Task 4), `NEXT_SEQ` and `userScope` (Task 2), `PriceQueue` (Task 3), `recordSnapshot`.
- Produces: in `src/shared/cloud.ts`:
  ```ts
  export interface WireEntry {
    uid: string; pkey: string; imageId: number; quantity: number; notes: string
    createdAt: string; updatedAt: string; deletedAt: string | null   // ISO 8601, toISOString form
  }
  export type PulledEntry = WireEntry & { seq: number }
  export type PushResult =
    | { uid: string; status: 'applied' }
    | { uid: string; status: 'stale'; current: WireEntry }      // server kept its newer row for this uid
    | { uid: string; status: 'merged'; winner: WireEntry }      // another uid holds this printing+art and won; this uid is now a tombstone
    | { uid: string; status: 'unknown-printing' }               // server catalog lacks the pkey or image; client retries later
    | { uid: string; status: 'rejected' }                       // uid belongs to another account
  export interface PushResponse { results: PushResult[] }
  export interface PullResponse { entries: PulledEntry[]; cursor: number; more: boolean }
  export interface WirePrice { pkey: string; price: number | null; listingCount: number; checkedAt: string }
  export interface PricesResponse { prices: WirePrice[]; status: string | null }  // status = server price_service_status
  export function editTime(e: Pick<WireEntry, 'updatedAt' | 'deletedAt'>): string  // later of the two
  /** Same uid: a replaces b when its edit time is later, or equal with a a tombstone and b live. */
  export function replaces(a: WireEntry, b: WireEntry): boolean
  /** Different uids on one printing+art: true when a is kept. Later edit time wins; on a tie the smaller uid wins. */
  export function keepsKey(a: WireEntry, b: WireEntry): boolean
  ```
- Produces: `workers/portal/src/sync.ts`:
  - `checkPush(body: unknown, now: Date): WireEntry[]`. It throws `CollectionError` (→ 400) unless:
    - `entries` is an array of objects;
    - `uid` matches the UUID shape;
    - `pkey` is a string of 1 to 300 characters;
    - `imageId` is a positive safe integer;
    - `quantity` is an integer of at least 1;
    - `notes` is a string within `MAX_NOTES`;
    - each time parses as a date, and `deletedAt` may be null.

    It normalises times with `toISOString()` and clamps any time beyond `now + FUTURE_SKEW_MS` to `now`.
  - `applyPush(db: SqlDb, userId: number, entries: WireEntry[], now: Date): PushResult[]` runs in one transaction with `recordSnapshot(db, now, userScope(userId))`.
    1. Resolve `pkey` and check that the image belongs to its card. If not → `unknown-printing`.
    2. A uid owned by another user → `rejected`, with nothing read or written. The caller's uid with `replaces(incoming, row)` → write every field plus `server_seq = NEXT_SEQ` → `applied`. Identical → `applied` with no write. Otherwise → `stale` with `current`.
    3. Unknown uid and a tombstone → `applied`, with nothing stored.
    4. Writing a live entry onto a (printing, image) where another live row of the caller exists:
       - if `keepsKey(incoming, other)`: tombstone `other` first (its seq comes before the winner's), then write `incoming`;
       - otherwise: store `incoming` as a tombstone → `merged` with `winner`.
  - `pullSince(db: SqlDb, userId: number, cursor: number, limit = MAX_PULL): PullResponse` returns the caller's rows with `server_seq > cursor`, tombstones included, in seq order. `more` is set when rows remain, and `cursor` is the last seq returned (or the input cursor when there are none).
  - `pricesFor(db: SqlDb, pkeys: string[]): PricesResponse` returns `intl_prices` rows joined by `card_printings.pkey` (prices are catalog data, not per-user), plus `getMeta(db, 'price_service_status')`.
  - Routes:
    - `POST /api/sync/push` (more than `MAX_PUSH` entries → 413 `{ error: 'too-many' }`) → `PushResponse`. It awaits `deps.prices.soon()` when any live entry was applied.
    - `GET /api/sync/pull?cursor=<int ≥ 0>` → `PullResponse`.
    - `POST /api/sync/prices` with `{ pkeys: string[] }` (more than `MAX_PULL` → 413) → `PricesResponse`.

    All three need `kind === 'desktop'`; anything else gets 401. Bad input gets 400 `{ error }`, never 500.

- [ ] **Step 1: Write the failing tests** in `tests/portal/sync.test.ts`. Alice and Bob hold desktop tokens; `entry(overrides)` builds a valid `WireEntry`.
  - `push inserts and pull returns entries with a cursor`.
  - `pushing the same payload twice changes nothing`: the same `server_seq` after the second push.
  - `newer edit wins; an older edit is stale and gets the server row back`.
  - `a tombstone beats an older live edit and the entry never comes back`.
  - `two uids on one printing+art converge to the newer`: both orders and an equal-time tie (the smaller uid is kept). The loser's seq is lower than the winner's, and there is exactly one live row.
  - `a tombstone for an unknown uid stores nothing`.
  - `an unknown pkey or another card's image answers unknown-printing`.
  - `a uid owned by another user is rejected and untouched`.
  - `pull returns only the caller's rows, tombstones included, in seq order, paged`.
  - `far-future times are clamped to server time`: one year ahead → `updated_at === NOW.toISOString()`.
  - `bad payloads answer 400`:
    - `entries` not an array; `uid: 5`; quantity `0`, `1.5` or `'2'`; `pkey: 1`; `updatedAt: 'yesterday'`; 2001-character notes;
    - `cursor=-1` or `cursor=x`;
    - `pkeys: [1]`.

    501 entries → 413.
  - `sync routes need a desktop token`.
  - `web writes reach a desktop pull`: after each of `collection:add`, `collection:update`, `collection:remove` and `sets:adjust` through `/api/rpc`, a pull from the previous cursor returns the uid.
  - `push records the caller's value snapshot and queues prices`.
  - `prices returns server rows by pkey and the service status`: unknown pkeys are simply absent.
- [ ] **Step 2: Run** `npm test -- tests/portal/sync.test.ts` and expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -- tests/portal` and `cd workers/portal && npm run typecheck`. Both must pass.
- [ ] **Step 5: Commit** `feat(portal): sync push, pull and prices with latest-edit-wins merge`.

---

### Task 6: Local sync operations on the desktop

**Files:**
- Create: `src/main/cloud/localSync.ts`, `tests/main/cloud-local.test.ts`

**Interfaces:**
- Consumes: the `src/shared/cloud.ts` types and helpers, `priceCandidates` (Task 3), and the V12 tables.
- Produces (`db: Database.Database` throughout; `owner` is a server user id ≥ 1):
  - `activeOwner(db): number` and `setActiveOwner(db, owner: number): void` (meta `cloud_active_owner`).
  - `ensureAccount(db, owner: number, name: string): void` upserts the name in `cloud_accounts`. `accountName(db, owner): string | null`.
  - `accountState(db, owner): { cursor: number; syncedAt: string | null }`, and `saveAccountState(db, owner, s: { cursor?: number; syncedAt?: string }): void`.
  - `adoptLocalData(db, owner): number` (in one transaction):
    - every `owner_id = 0` entry moves to `owner`, with `dirty = 1`;
    - owner-0 snapshots move to `owner` with `UPDATE OR IGNORE`, and any leftovers are deleted;
    - it returns the count of entries moved.
  - `dirtyEntries(db, owner, limit: number, skip?: ReadonlySet<string>): WireEntry[]` returns that owner's dirty rows, live and tombstones, joined to `card_printings.pkey`. Notes are cut to `MAX_NOTES`.
  - `markPushed(db, e: WireEntry): void` runs `UPDATE … SET dirty = 0 WHERE uid = ? AND updated_at = ? AND deleted_at IS ?`.
  - `applyRemote(db, owner, e: WireEntry): 'applied' | 'kept-local' | 'pending' | 'ignored'`:
    - If `pkey` or `imageId` doesn't resolve locally, it upserts `sync_pending (owner, uid)` (only if newer) → `pending`.
    - A local dirty row where `!replaces(e, local)` → `kept-local`.
    - Otherwise it writes the fields with `dirty = 0` and `owner_id = owner`, and deletes the pending row.
    - Live-key collisions within `owner` follow `keepsKey`: a losing local row is tombstoned and stays dirty; a losing remote → `ignored`.
    - A remote tombstone for an unknown uid → `ignored`.
  - `applyPending(db): { applied: number; remaining: number }` covers all owners, each into its own owner. `pendingCount(db, owner): number`.
  - `rekey(db, uid: string): string`, `dropEntry(db, uid: string): void`, and `purgeCleanTombstones(db, owner): number`.
  - `stalePricePkeys(db, now: Date, limit: number): string[]` = `priceCandidates(db, now, { limit }).map(c => c.pkey)`.
  - `applyPrices(db, prices: WirePrice[]): number` upserts `intl_prices` by local printing id, and only where `checkedAt` is newer than the local row.
  - None of these call repo write functions, so remote writes never mark rows dirty.

- [ ] **Step 1: Write the failing tests** in `tests/main/cloud-local.test.ts` (`seededDb()`; owners 7 and 8):
  - `dirty entries are per owner, carry the pkey and cap notes`.
  - `an edit made during a push stays dirty`: take `dirtyEntries`, then `updateEntry`, then `markPushed(old wire)` → still dirty. `markPushed(fresh wire)` → clean.
  - `remote edits apply clean, to the given owner, never dirty`.
  - `a newer local unpushed edit beats an older remote one`.
  - `a remote tombstone removes the local entry for good`.
  - `a remote entry on a printing+art the owner already holds converges to the newer`: both orders. Owner 8's live row on the same key is untouched.
  - `an unknown printing waits in sync_pending and applies once the catalog has it`: `pkey` `'en|999|NEW-001|Rare'` → `pending`. Insert the printing, run `applyPending` → `{ applied: 1, remaining: 0 }`, and the row has the right owner.
  - `adopting moves never-signed-in entries and snapshots to the first owner`.
  - `purge removes only that owner's clean tombstones`.
  - `fresher server prices replace older local ones only`.
- [ ] **Step 2: Run** `npm test -- tests/main/cloud-local.test.ts` and expect failures.
- [ ] **Step 3: Implement** `localSync.ts`.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Both must pass.
- [ ] **Step 5: Commit** `feat(cloud): per-owner local operations for sync`.

---

### Task 7: Cloud client and sync engine

**Files:**
- Create: `src/main/cloud/client.ts`, `src/main/cloud/engine.ts`, `tests/main/cloudHelpers.ts`, `tests/main/cloud-sync.test.ts`

**Interfaces:**
- Produces: `client.ts`:
  ```ts
  export class CloudAuthError extends Error {}     // 401
  export class CloudOfflineError extends Error {}  // fetch threw, timed out, or 5xx
  export interface CloudClient {
    me(): Promise<Me>
    push(entries: WireEntry[]): Promise<PushResult[]>
    pull(cursor: number): Promise<PullResponse>
    prices(pkeys: string[]): Promise<PricesResponse>
    revoke(): Promise<void>
  }
  export function createCloudClient(opts: { baseUrl: string; token: string; fetch?: typeof fetch; timeoutMs?: number }): CloudClient
  ```
  - Every request sends `authorization: Bearer <token>`, and JSON bodies send `content-type: application/json`. The default timeout is 30 s.
  - A 4xx other than 401 throws `Error(body.error ?? 'Request failed (<status>)')`.
- Produces: `engine.ts`:
  ```ts
  export interface SyncOutcome { pushed: number; pushedLive: number; pulled: number; pending: number; changed: boolean }
  export async function syncOnce(db: Database.Database, owner: number, client: CloudClient, now: () => Date): Promise<SyncOutcome>
  ```
  1. `applyPending`.
  2. Push `dirtyEntries(db, owner, MAX_PUSH, skip)` until none are left. Handle each result:
     - `applied` → `markPushed`;
     - `stale` → `applyRemote(owner, current)`;
     - `merged` → `applyRemote(owner, winner)`, then tombstone the local uid clean;
     - `unknown-printing` → add it to `skip`;
     - `rejected` → for a tombstone, `dropEntry`; otherwise `rekey`, after which the entry is pushed again this run.
  3. Pull from `accountState(owner).cursor` and apply each page in one transaction that also saves the cursor. Repeat while `more` is set.
  4. `prices(stalePricePkeys(db, now(), MAX_PULL))` → `applyPrices`. Set `price_service_status` from `status` when it is non-null.
  5. `purgeCleanTombstones(owner)` and save `syncedAt`. If anything changed, run `recordSnapshot(db, now())`; `LOCAL` already scopes it to the active owner.
- Produces: `tests/main/cloudHelpers.ts` exports `inProcessPortal(): Promise<{ serverDb; fetch: typeof fetch; desktopToken(userId: number): Promise<string>; addUser(name: string): number; priceQueue: { soon: Mock } }>`. Its `fetch` routes `https://portal.test/*` into `handle()` over `seededServerDb()`.

- [ ] **Step 1: Write the failing tests** in `tests/main/cloud-sync.test.ts`. Desktops A and B are separate `seededDb()`s with an active owner set, and the server is real.
  - `first sync uploads the whole local collection`.
  - `web edits reach the desktop and desktop edits reach the web`.
  - `a delete on one desktop never comes back`.
  - `the same card added on two desktops converges to one entry with the latest quantity`.
  - `a printing the desktop doesn't know waits and arrives after the catalog gains it`.
  - `an entry on a printing the server lacks stays dirty and is retried`.
  - `a sync cut off after push resumes without duplicates`: `fetch` throws on the first pull → `CloudOfflineError`. The next `syncOnce` succeeds with one row on each side.
  - `server prices reach the desktop without calling the eBay Worker`: seed a server `intl_prices` row, run sync, and the local entry has that `unitPrice`. Any request to a non-portal host fails the test.
  - `a 401 throws CloudAuthError and changes nothing locally`.
- [ ] **Step 2: Run** `npm test -- tests/main/cloud-sync.test.ts` and expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Both must pass.
- [ ] **Step 5: Commit** `feat(cloud): sync engine over the portal API`.

---

### Task 8: Token file and browser sign-in

**Files:**
- Create: `src/main/cloud/tokenStore.ts`, `src/main/cloud/signIn.ts`, `src/main/cloud/config.ts`, `tests/main/cloud-signin.test.ts`

**Interfaces:**
- Produces: `config.ts` exports `portalUrl(env: Record<string, string | undefined>, packaged: boolean): string`. It returns `'https://app.duelbinder.com'`, unless the build is unpackaged and `DUEL_BINDER_PORTAL_URL` is set.
- Produces: `tokenStore.ts`, following `axiroster/src/main/secrets.ts`:
  ```ts
  export interface Cipher { encrypt(plain: string): Buffer; decrypt(encrypted: Buffer): string }
  /** safeStorage imported lazily; encryptString/decryptString called unconditionally (basic_text on keyring-less Linux is accepted). */
  export async function electronCipher(): Promise<Cipher>
  export class TokenStore {
    constructor(path: string, cipher: Cipher)   // path = <userData>/account.json
    get(): string | null; set(token: string): void; clear(): void
    pendingRevokes(): string[]; addPendingRevoke(token: string): void; removePendingRevoke(token: string): void
  }
  ```
  - The file shape is `{ token?: string; revoke?: string[] }`, each value base64 of the cipher bytes.
  - Writes create the parent directory, use `writeFileSync(path, json, { mode: 0o600 })` and then `chmodSync(path, 0o600)`.
  - Corrupt JSON reads as `{}`. A value that fails to decrypt reads as null or is skipped, never throws.
- Produces: `signIn.ts`:
  ```ts
  export class SignInError extends Error {}  // 'Sign-in timed out' | 'Sign-in was cancelled' | "Sign-in didn't go through"
  export function signInWithBrowser(deps: { portalUrl: string; openExternal(url: string): Promise<void>; fetch?: typeof fetch; timeoutMs?: number; signal?: AbortSignal }): Promise<{ token: string; user: Me }>
  ```
  1. Generate a 32-byte base64url `verifier`, set `challenge = base64url(sha256(verifier))` and generate a 32-byte base64url `state`.
  2. Listen with `node:http` on `127.0.0.1`, port 0, and open `${portalUrl}/auth/desktop/start?port&state&challenge`.
  3. On `GET /callback`:
     - a mismatched `state` (constant-time compare) or an `error` → `SignInError("Sign-in didn't go through")`;
     - otherwise POST `/auth/desktop/token` with `{ code, verifier }`.

     Answer the browser with "You're signed in. You can close this tab and return to Duel Binder." or "Sign-in didn't go through. Return to Duel Binder and try again." Any other path gets a 404.
  4. Default `timeoutMs` is 300 000. The server is closed on every outcome.

- [ ] **Step 1: Write the failing tests** in `tests/main/cloud-signin.test.ts`. The fake cipher reverses and prefixes the string; a temp dir holds the file.
  - `token round-trips and the file holds no plain text and is 0600`.
  - `a corrupt file reads as signed out`, and `a value that won't decrypt reads as signed out`: the cipher `decrypt` throws.
  - `pending revokes are kept until removed`.
  - `sign-in returns the token and user from the code exchange`: the exchange `verifier` hashes to the start URL's `challenge`.
  - `a wrong state is refused without exchanging the code`.
  - `an error from the portal rejects`.
  - `sign-in times out and frees the port`.
  - `aborting cancels sign-in`.
  - `portalUrl ignores the override in packaged builds`.
- [ ] **Step 2: Run** `npm test -- tests/main/cloud-signin.test.ts` and expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Both must pass.
- [ ] **Step 5: Commit** `feat(cloud): loopback browser sign-in and encrypted token file`.

---

### Task 9: Account service, scheduler and app wiring

**Files:**
- Create: `src/main/cloud/scheduler.ts`, `src/main/cloud/account.ts`, `tests/main/cloud-scheduler.test.ts`, `tests/main/cloud-account.test.ts`
- Modify: `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc/handlers.ts`, `src/main/index.ts`, `src/renderer/src/web/httpApi.ts`, `tests/renderer/mockApi.ts`, `tests/renderer/http-api.test.ts`, `tests/main/handlers.test.ts`

**Interfaces:**
- Produces: in `src/shared/types.ts`:
  ```ts
  export interface AccountStatus {
    state: 'signed-out' | 'signing-in' | 'idle' | 'syncing' | 'offline' | 'error'
    user: Me | null                 // signed-in account
    localOwner: string | null       // name of the account whose cards this computer shows (kept after sign-out)
    lastSyncedAt: string | null
    error: string | null
    pendingCount: number
  }
  ```
- Produces: `Api.account`:
  ```ts
  account: {
    status(): Promise<AccountStatus>
    signIn(): Promise<AccountStatus>     // resolves when sign-in finishes or fails
    signOut(): Promise<AccountStatus>    // also cancels a sign-in in progress
    syncNow(): Promise<AccountStatus>
    onChange(cb: (s: AccountStatus) => void): () => void
  }
  ```
  - `INVOKE_CHANNELS` gains `'account:status'`, `'account:signIn'`, `'account:signOut'` and `'account:syncNow'`.
  - Event `ACCOUNT_CHANGED = 'account:changed'`.
  - The web `createHttpApi` rejects all `account.*` with `Not available on the web`, and its `onChange` is a no-op.
- Produces: `scheduler.ts`:
  ```ts
  export interface SyncScheduler { start(): void; stop(): void; poke(delayMs?: number): void; runNow(): Promise<void> }
  export function createSyncScheduler(opts: { run: () => Promise<void>; isOnline: () => boolean; debounceMs?: number; periodMs?: number; onlinePollMs?: number; backoffMs?: number[] }): SyncScheduler
  ```
  - Defaults: 5000 / 300 000 / 30 000 / `[30_000, 60_000, 120_000, 300_000, 900_000]`.
  - `start` runs once immediately, and `poke()` uses `debounceMs`.
  - Only one run happens at a time; a request during a run queues exactly one more.
  - It skips runs while offline and runs when a poll sees the network come back.
  - A failure follows the backoff, and a success resets it.
- Produces: `account.ts`:
  ```ts
  export interface AccountDeps {
    db: Database.Database; tokens: TokenStore
    client(token: string): CloudClient
    signIn(signal: AbortSignal): Promise<{ token: string; user: Me }>
    emit(s: AccountStatus): void; emitDataChanged(): void
    isOnline(): boolean; now?: () => Date
  }
  export interface AccountService {
    status(): AccountStatus; signIn(): Promise<AccountStatus>; signOut(): Promise<AccountStatus>; syncNow(): Promise<AccountStatus>
    isSignedIn(): boolean; noteLocalEdit(): void; catalogRefreshed(): void; start(): void; stop(): void
  }
  export function createAccountService(deps: AccountDeps): AccountService
  ```
  Rules:
  - **Sign-in as U:**
    1. `ensureAccount(U.id, displayName ?? username)`.
    2. If owner-0 entries exist, `adoptLocalData(U.id)`, with no prompt.
    3. `setActiveOwner(U.id)`, store the token, set `cloud_user`, run `emitDataChanged()` if the active owner changed, then sync now.

    The previous owner's rows are never touched.
  - **signOut:**
    1. Abort any sign-in in progress.
    2. If signed in and online, run `syncOnce` once, capped at 10 s, ignoring failure.
    3. `revoke()`; on `CloudOfflineError`, call `addPendingRevoke`.
    4. Clear the token and `cloud_user`.

    The active owner, its rows and its cursor stay, so signed-out edits are tracked for that owner. `start()` retries pending revokes first.
  - **Errors during a run:**
    - `CloudAuthError` → signed out (no revoke), with `error: 'Signed out by the server. Sign in again to keep syncing.'` and no further runs;
    - `CloudOfflineError` → `offline`;
    - anything else → `error` with its message.
  - The first successful run of each app session refreshes `cloud_user` and the account name from `client.me()`.
  - A run with `pushedLive > 0` calls `scheduler.poke(20_000)` once, to pick up the new prices.
  - `noteLocalEdit` → `poke()`. `catalogRefreshed` → `applyPending`, then `poke()` (`emitDataChanged` if anything applied).
  - Every state change calls `emit`. `status()` never includes the token.
- Produces: handler wiring.
  - `HandlerDeps.account: AccountService`. The `account:*` handlers delegate to it.
  - `collection:add`, `collection:update`, `collection:remove` and `sets:adjust` call `account.noteLocalEdit()` after success.
  - `sync:run` calls `account.catalogRefreshed()` when it ends idle.
  - **Direct eBay lookups run only while signed out:** `priceNewCopy`, the `prices:setUrl` refresh and `startupSync`'s `refreshIntlPrices` are skipped when `account.isSignedIn()`.
- Wiring in `src/main/index.ts`:
  - `new TokenStore(join(userData, 'account.json'), await electronCipher())`;
  - create the account service with:
    - `signIn` → `signInWithBrowser({ portalUrl: portalUrl(process.env, app.isPackaged), openExternal: shell.openExternal, signal })`;
    - `isOnline` → `net.isOnline()`;
    - `emit` → `broadcast(ACCOUNT_CHANGED, s)`;
  - call `account.start()` after `createWindow()` and `account.stop()` on `before-quit`;
  - `startupSync` calls `account.catalogRefreshed()` after `refreshCatalog`.

- [ ] **Step 1: Write the failing tests.**
  - `cloud-scheduler.test.ts` (fake timers):
    - `runs once at start`;
    - `debounces edits into one run 5 s after the last`;
    - `poke with a delay runs then`;
    - `runs every 5 minutes`;
    - `runs when the network comes back`;
    - `one run at a time; a request during a run queues one more`;
    - `backs off after failures and resets after a success`;
    - `stop clears every timer`.
  - `cloud-account.test.ts` (in-process portal; fake `signIn` returning `desktopToken`s; temp-file `TokenStore` with the fake cipher):
    - `first sign-in adopts never-signed-in cards without asking`: the server holds them and `owner_id` is now Alice's.
    - `switching A→B→A restores A, including A's signed-out edit`:
      1. Alice signs in, syncs and signs out, then edits an entry while signed out (it stays dirty for Alice).
      2. Bob signs in: `listEntries` shows only Bob's server collection, Alice's rows are untouched, and the Bob token pushes nothing of Alice's.
      3. Bob signs out and Alice signs in: `listEntries` shows Alice's cards with the edit, and the server row for Alice has it.
    - `sign-out pushes first, then revokes and keeps the cards and owner`: a dirty edit made before sign-out is on the server, and the token gets 401 afterwards.
    - `sign-out offline still signs out; revoke is retried on next start`, and the failed final push leaves rows dirty.
    - `a 401 during sync signs out without losing data`: `signed-out` with the server message, entries kept, no further `push` calls.
    - `the token never appears in status or events`.
    - `while signed in no request goes to the eBay Worker`: through handlers with a spy price client, `collection:add` doesn't call it while signed in, and calls it once when signed out.
    - `a catalog refresh applies pending entries`.
  - `handlers.test.ts` `writes tell the account service`: `noteLocalEdit` is called for add, update, remove and adjust only.
  - `http-api.test.ts`: `account.status()` rejects `Not available on the web` without fetching.
- [ ] **Step 2: Run** `npm test -- tests/main/cloud-scheduler.test.ts tests/main/cloud-account.test.ts tests/main/handlers.test.ts tests/renderer/http-api.test.ts` and expect failures.
- [ ] **Step 3: Implement** the scheduler, the service, the Api/IPC/preload additions, the web stubs, the mock-API defaults (signed-out status) and the wiring.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Both must pass. Then run `npm run dev` with `DUEL_BINDER_PORTAL_URL=http://localhost:8787` against `cd workers/portal && npx wrangler dev`: the app starts, and signed-out Settings loads with no console errors.
- [ ] **Step 5: Commit** `feat(cloud): account service with background sync`.

---

### Task 10: Desktop Account section

**Files:**
- Modify:
  - `src/renderer/src/features/settings/AccountSection.tsx`;
  - `src/renderer/src/features/settings/SettingsPage.tsx` (Account section first in `DesktopSettings`; one line in `PriceServiceSection`);
  - `src/renderer/src/lib/api.ts` (`queryKeys.account`);
  - `src/renderer/index.html` (CSP `img-src` adds `https://cdn.discordapp.com`);
  - `tests/renderer/web-shell.test.tsx` (the desktop case now expects the Account section).
- Create: `tests/renderer/account-desktop.test.tsx`

**Interfaces:**
- Consumes: `api.account.*` and `AccountStatus` (Task 9).
- Produces: `AccountSection` renders `WebAccount` (today's markup, unchanged) when `isWeb()`, else `DesktopAccount`. Both share `Identity({ user }: { user: Me })` (avatar with the load-failure fallback, plus "Signed in as {displayName ?? username}"). `DesktopAccount` reads `useQuery(queryKeys.account, api.account.status)` and stays live through `api.account.onChange` → `setQueryData`.
- Copy:
  - `signed-out`:
    - "Sign in with Discord to keep this computer's collection in step with the web app and your other computers." Button **Sign in with Discord**.
    - When `localOwner` is set, also: "Showing {localOwner}'s cards. Changes are kept and sync when {localOwner} signs in again."
    - Shows `error` when set.
  - `signing-in`: "Finish signing in in your browser…" Button **Cancel** (→ `signOut`).
  - signed in (`idle` / `syncing` / `offline` / `error`):
    - `Identity`, with the row **Last synced**: `formatRelative(lastSyncedAt)` or "never";
    - **Sync now** (disabled while `syncing`) and **Sign out**, with the note "Signing out keeps your cards on this computer.";
    - `offline`: "Offline. Changes will sync when you're back online.";
    - `error`: "Sync failed: {error}".
  - `pendingCount > 0`: "{n} cards from your account are waiting for newer card data. Refresh card data to bring them in."
  - `PriceServiceSection`, while signed in: hide the custom eBay address field and show only "While you're signed in, prices come from your Duel Binder account." Signed out, the field shows again with its saved value (owner decision).

- [ ] **Step 1: Write the failing tests** in `tests/renderer/account-desktop.test.tsx`, with a mock API on platform `'linux'`:
  - `signed out shows Sign in with Discord`: clicking calls `signIn`.
  - `signed out after an account names whose cards are shown`.
  - `signed in shows identity, last synced and Sync now`: clicking **Sync now** calls `syncNow`.
  - `signing in shows a Cancel that signs out`.
  - `waiting entries are explained`.
  - `signed in hides the custom eBay address field`: signed in, the field is absent and the account-prices line shows; signed out, the field is back.
  - `status pushed from main updates the section`.
  - `web-shell.test.tsx` `desktop settings shows the account section`.
- [ ] **Step 2: Run** `npm test -- tests/renderer/account-desktop.test.tsx tests/renderer/web-shell.test.tsx` and expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Both must pass.
- [ ] **Step 5: Commit** `feat(settings): desktop account section with sync status`.

---

### Task 11: Deploy (owner go-ahead)

Ask the owner before each outward step.

**Files:**
- Modify: `workers/portal/README.md` (the desktop sign-in routes, `/api/sync/*`, the price alarm and `PRICE_WORKER_URL`, server-2, and `DUEL_BINDER_PORTAL_URL` for dev)

- [ ] **Step 1:** Update the README and commit `docs(portal): desktop sign-in, sync and server prices`.
- [ ] **Step 2:** The owner reviews the branch. Merge to `main` and push (the owner's call).
- [ ] **Step 3:** `cd workers/portal && npm run deploy`, run before any desktop release. The Store runs `server-2` on its next start and arms the price alarm. `curl -s https://app.duelbinder.com/api/health` → `{"ok":true}`.
- [ ] **Step 4: Smoke test with the owner,** using a dev build against production:
  - Sign in from Settings: the browser shows "You're signed in", and Settings shows the owner and a Last synced time.
  - The web app shows the desktop collection, and within minutes it shows eBay prices for international cards.
  - A web edit appears on desktop after **Sync now**, and a desktop delete disappears from the web.
  - Sign out: the cards stay, and `/api/me` with the old token → 401.
- [ ] **Step 5:** A desktop release (version bump, tag, publish) happens only when the owner asks.
