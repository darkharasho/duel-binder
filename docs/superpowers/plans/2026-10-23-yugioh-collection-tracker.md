# Yu-Gi-Oh! Collection Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An offline-first Electron desktop app for cataloging a Yu-Gi-Oh! collection, with card data, art, and prices cached locally from YGOPRODeck, and auto-update via GitHub Releases.

**Architecture:** The main process owns SQLite (better-sqlite3), every YGOPRODeck call, the image cache (served through a `ygo-img://` protocol), and the updater. The React renderer reaches it only through one typed `Api` object exposed by the preload script. Domain logic lives in small main-process modules that take a `Database` as their first argument, so they can be tested against `:memory:` databases.

**Tech Stack:** Electron, electron-vite, React 19 + TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui, TanStack Query, TanStack Table, better-sqlite3, electron-updater, electron-builder, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-23-yugioh-collection-tracker-design.md`

## Global Constraints

- Vitest always runs with `--maxWorkers=2`.
- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The renderer never imports Node/Electron modules.
- YGOPRODeck: card data from `https://db.ygoprodeck.com/api/v7/cardinfo.php` and `https://db.ygoprodeck.com/api/v7/checkDBVer.php`; images from `https://images.ygoprodeck.com/images/cards/{id}.jpg` (full) and `https://images.ygoprodeck.com/images/cards_small/{id}.jpg` (small). Never hotlink: the renderer loads images only via `ygo-img://`. Stay under 20 requests/second (limiter: 4 concurrent, ≥50 ms between request starts).
- Sync threshold: 24 h since `last_sync_at`.
- Entry identity: (printing_id, image_id), where a printing = (card_id, set_code, set_rarity). No condition, edition, or language fields anywhere.
- Value: `set_price` (USD) × quantity; fall back to `card_prices[0].tcgplayer_price` and mark it approximate; with no price at all, unit price is `null` and value is 0 (still marked approximate).
- Dashboard: total cards = sum of quantities; unique cards = distinct card ids; top 10 entries by unit price × quantity.
- Prices-updated time is shown on the Dashboard and the Collection view.
- Updates: check on startup and every 4 h. Never restart without the user confirming.
- Releases: `v*` tags publish to GitHub Releases on `darkharasho/yugioh-collection-tracker`. Linux AppImage, Windows NSIS, macOS universal dmg + zip.
- Product name `Yugioh Collection Tracker`; appId `com.darkharasho.yugiohcollectiontracker`.
- Theme follows the OS (light/dark).

## Review Focus

1. **Search text with FTS5 syntax characters** (`Harpie's`, `"`, `-`, `*`, `(`, `NOT`): search returns sensible matches and never throws. Pinned in Task 6.
2. **Sync failing partway** (offline, HTTP 500, truncated JSON): existing cards, printings, and entries are untouched, status is `error` with a message, and a retry works. Pinned in Task 5.
3. **Odd price strings** (`"0.00"`, `""`, missing, `"N/A"`, empty `card_prices`): never NaN in a value or total; the fallback and the approximate flag apply. Pinned in Tasks 2 and 8.
4. **Edit or re-link onto a combination that already exists** (changing art or printing to match another entry): quantities merge into one entry instead of hitting a unique-constraint error. Pinned in Task 7.
5. **Image download fails or is interrupted**: no partial or broken file is cached, the renderer shows a placeholder, and the image is retried next time. Pinned in Task 9.

---

## File Structure

```
package.json, electron.vite.config.ts, electron-builder.yml, vitest.config.ts,
tsconfig.json, tsconfig.node.json, tsconfig.web.json, components.json
.github/workflows/release.yml
src/shared/types.ts          domain types shared by main + renderer
src/shared/ipc.ts            Api interface, method list, event channel names
src/shared/pricing.ts        parsePrice, priceFor (pure)
src/main/index.ts            bootstrap: db, protocol, IPC, window, startup sync, updater
src/main/db/database.ts      openDatabase, migrate, schema v1
src/main/db/meta.ts          getMeta / setMeta
src/main/ygo/client.ts       YGOPRODeck HTTP client (fetch injected)
src/main/ygo/mapCard.ts      API JSON → rows
src/main/sync/sync.ts        shouldSync, runSync
src/main/repo/cards.ts       searchCards, getCardDetail, buildFtsQuery
src/main/repo/collection.ts  entry CRUD, list/filter/sort, facets
src/main/repo/stats.ts       getStats, recordSnapshot
src/main/images/limiter.ts   createLimiter
src/main/images/cache.ts     createImageCache
src/main/images/protocol.ts  registerImageScheme, handleImageProtocol
src/main/ipc/handlers.ts     createHandlers, registerIpc
src/main/updater.ts          updateMode, createUpdater
src/preload/index.ts         exposes window.api
src/renderer/index.html
src/renderer/src/main.tsx, App.tsx, index.css
src/renderer/src/lib/api.ts       typed window.api accessor + query keys
src/renderer/src/lib/format.ts    formatUsd, formatRelative
src/renderer/src/components/ui/*  shadcn components
src/renderer/src/components/AppShell.tsx, SyncBanner.tsx, CardArt.tsx
src/renderer/src/features/add-card/AddCardDialog.tsx
src/renderer/src/features/collection/{CollectionPage,FilterBar,CollectionGrid,CollectionTable,EntryDetailPanel}.tsx
src/renderer/src/features/dashboard/DashboardPage.tsx
src/renderer/src/features/settings/SettingsPage.tsx
tests/main/*.test.ts, tests/renderer/*.test.tsx, tests/fixtures/cardinfo.sample.json
```

---

### Task 1: Scaffold and test harness

**Files:**
- Create: everything under the project root listed above as config, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/*` (template), `tests/main/smoke.test.ts`, `tests/renderer/smoke.test.tsx`
- Modify: `.gitignore` (add `out/`, `dist/`, `node_modules/`)

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `typecheck`, `test`, `build:linux`, `build:win`, `build:mac`; path alias `@/` → `src/renderer/src`, `@shared/` → `src/shared` (both in the renderer and main configs, plus vitest).

- [ ] **Step 1: Scaffold electron-vite react-ts** in the repo root, using `npm create @quick-start/electron@latest` with the `react-ts` template (generate in a temp dir and move the files in if the CLI refuses a non-empty dir). Keep `CLAUDE.md`, `README.md`, and `docs/`.
- [ ] **Step 2: Add dependencies:** `better-sqlite3`, `electron-updater`, `@tanstack/react-query`, `@tanstack/react-table`; dev: `@types/better-sqlite3`, `tailwindcss`, `@tailwindcss/vite`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `cross-env`. Make `postinstall` run `electron-builder install-app-deps`, so better-sqlite3 is built for Electron's ABI.
- [ ] **Step 3: Tailwind v4 + shadcn:** add the `@tailwindcss/vite` plugin to the renderer config, `@import "tailwindcss";` in `index.css`, and run `npx shadcn@latest init` (neutral base color, CSS variables, aliases pointing at `src/renderer/src`). Add the components `button input dialog command table badge card select checkbox sheet tabs toggle-group sonner separator scroll-area tooltip dropdown-menu`. Dark mode: a `dark` class on `<html>`, driven by `matchMedia('(prefers-color-scheme: dark)')` with a change listener in `main.tsx`.
- [ ] **Step 4: Test harness.** `vitest.config.ts` declares two `test.projects`: `main` (environment `node`, `tests/main/**`) and `renderer` (environment `jsdom`, `tests/renderer/**`, setup file importing `@testing-library/jest-dom/vitest`). Script: `"test": "cross-env ELECTRON_RUN_AS_NODE=1 electron ./node_modules/vitest/vitest.mjs run --maxWorkers=2"`. Tests run under Electron's Node, so the single Electron-ABI build of better-sqlite3 serves both the app and the tests.
- [ ] **Step 5: Write the smoke tests**

```ts
// tests/main/smoke.test.ts
import Database from 'better-sqlite3'
test('better-sqlite3 loads under the test runtime', () => {
  const db = new Database(':memory:')
  expect(db.prepare('select 1 as x').get()).toEqual({ x: 1 })
})
// tests/renderer/smoke.test.tsx
test('jsdom + testing-library work', () => {
  render(<button>hi</button>)
  expect(screen.getByRole('button', { name: 'hi' })).toBeInTheDocument()
})
```

- [ ] **Step 6: Run** `npm test`. Expected: 2 passed. If the main project fails with a NODE_MODULE_VERSION mismatch, the harness is wrong. Fix it here; do not add a second native build.
- [ ] **Step 7: Run** `npm run typecheck` and `npm run dev`. Expected: typecheck clean; a window opens showing the template page.
- [ ] **Step 8: Commit** `chore: scaffold electron-vite app with tailwind, shadcn, vitest`

---

### Task 2: Shared types and pricing

**Files:**
- Create: `src/shared/types.ts`, `src/shared/pricing.ts`, `src/shared/ipc.ts`
- Test: `tests/main/pricing.test.ts`

**Interfaces:**
- Produces (`types.ts`):

```ts
export interface CardRow { id: number; name: string; type: string; frameType: string; race: string
  attribute: string | null; level: number | null; linkval: number | null; atk: number | null; def: number | null
  archetype: string | null; desc: string; tcgplayerPrice: number | null }
export interface Printing { id: number; cardId: number; setName: string; setCode: string; setRarity: string
  setRarityCode: string; setPrice: number | null; missingFromApi: boolean }
export interface CardImage { imageId: number; cardId: number; sortOrder: number }   // sortOrder 0 = original art
export interface CardSearchResult { id: number; name: string; type: string; defaultImageId: number; matchedSetCode: string | null }
export interface CardDetail { card: CardRow; printings: Printing[]; images: CardImage[] }
export interface EntryView { id: number; quantity: number; notes: string; createdAt: string; updatedAt: string
  card: CardRow; printing: Printing; imageId: number; unitPrice: number | null; priceApproximate: boolean; totalValue: number }
export interface AddEntryInput { printingId: number; imageId: number; quantity: number }
export interface UpdateEntryInput { quantity?: number; notes?: string; printingId?: number; imageId?: number }
export type SortKey = 'name' | 'value' | 'quantity' | 'added'
export interface CollectionFilters { q?: string; cardTypes?: string[]; attributes?: string[]; levelMin?: number; levelMax?: number
  archetypes?: string[]; setNames?: string[]; rarities?: string[]; sort: SortKey; dir: 'asc' | 'desc' }
export interface Facets { cardTypes: string[]; attributes: string[]; archetypes: string[]; setNames: string[]; rarities: string[] }
export interface CollectionStats { totalCards: number; uniqueCards: number; totalValue: number; approximateCount: number
  byRarity: { rarity: string; count: number; value: number }[]; byFrameType: { frameType: string; count: number }[]
  topEntries: EntryView[]; pricesUpdatedAt: string | null }
export interface SyncStatus { state: 'idle' | 'checking' | 'downloading' | 'saving' | 'error'
  lastSyncAt: string | null; dbVersion: string | null; cardCount: number; error: string | null }
export interface UpdateStatus { state: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  mode: 'auto' | 'notify'; version: string | null; error: string | null }
```

- Produces (`pricing.ts`): `parsePrice(raw: string | number | null | undefined): number | null` (non-finite or ≤ 0 → `null`); `priceFor(setPrice: number | null, tcgplayerPrice: number | null): { unitPrice: number | null; approximate: boolean }`.
- Produces (`ipc.ts`): the `Api` interface (namespaced methods, all returning Promises), `INVOKE_CHANNELS` (a `const` array of `'ns:method'` strings, one per invoke method), and event channels `SYNC_PROGRESS = 'sync:progress'` and `UPDATE_STATUS = 'update:status'`:

```ts
export interface Api {
  cards: { search(q: string): Promise<CardSearchResult[]>; get(cardId: number): Promise<CardDetail | null> }
  collection: { list(f: CollectionFilters): Promise<EntryView[]>; forCard(cardId: number): Promise<EntryView[]>
    add(input: AddEntryInput): Promise<EntryView>; update(id: number, patch: UpdateEntryInput): Promise<EntryView>
    remove(id: number): Promise<void>; facets(): Promise<Facets> }
  stats: { get(): Promise<CollectionStats> }
  sync: { status(): Promise<SyncStatus>; run(): Promise<SyncStatus>; onProgress(cb: (s: SyncStatus) => void): () => void }
  images: { cacheSize(): Promise<number>; clearCache(): Promise<void> }
  app: { version(): Promise<string>; openDataFolder(): Promise<void>; backupDatabase(): Promise<string | null>
    checkForUpdates(): Promise<UpdateStatus>; applyUpdate(): Promise<void>; onUpdateStatus(cb: (s: UpdateStatus) => void): () => void }
}
```

- [ ] **Step 1: Write failing tests**

```ts
test('parsePrice', () => {
  expect(parsePrice('5.12')).toBe(5.12)
  for (const bad of ['0.00', '', 'N/A', undefined, null, '-1', 'NaN']) expect(parsePrice(bad)).toBeNull()
})
test('priceFor prefers set price', () => expect(priceFor(5.12, 7.5)).toEqual({ unitPrice: 5.12, approximate: false }))
test('priceFor falls back to tcgplayer', () => expect(priceFor(null, 7.5)).toEqual({ unitPrice: 7.5, approximate: true }))
test('priceFor with nothing', () => expect(priceFor(null, null)).toEqual({ unitPrice: null, approximate: true }))
```

- [ ] **Step 2: Run** `npm test -- tests/main/pricing.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `types.ts`, `pricing.ts`, `ipc.ts` as above.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `npm run typecheck`: clean.
- [ ] **Step 5: Commit** `feat: shared domain types, pricing rules, IPC contract`

---

### Task 3: Database and migrations

**Files:**
- Create: `src/main/db/database.ts`, `src/main/db/meta.ts`
- Test: `tests/main/database.test.ts`

**Interfaces:**
- Produces: `openDatabase(file: string): Database.Database` (sets `journal_mode = WAL`, `foreign_keys = ON`, then runs `migrate`); `migrate(db): void` (tracks the version in `PRAGMA user_version`; v1 below); `getMeta(db, key: MetaKey): string | null`; `setMeta(db, key: MetaKey, value: string): void`, with `type MetaKey = 'last_sync_at' | 'db_version'`.

Schema v1:

```sql
CREATE TABLE cards (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, frame_type TEXT NOT NULL,
  race TEXT NOT NULL, attribute TEXT, level INTEGER, linkval INTEGER, atk INTEGER, def INTEGER, archetype TEXT,
  "desc" TEXT NOT NULL, tcgplayer_price REAL, updated_at TEXT NOT NULL);
CREATE VIRTUAL TABLE cards_fts USING fts5(name, content='cards', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TABLE card_printings (id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES cards(id),
  set_name TEXT NOT NULL, set_code TEXT NOT NULL, set_rarity TEXT NOT NULL, set_rarity_code TEXT NOT NULL DEFAULT '',
  set_price REAL, missing_from_api INTEGER NOT NULL DEFAULT 0, UNIQUE (card_id, set_code, set_rarity));
CREATE INDEX idx_printings_set_code ON card_printings(set_code COLLATE NOCASE);
CREATE TABLE card_images (image_id INTEGER PRIMARY KEY, card_id INTEGER NOT NULL REFERENCES cards(id),
  sort_order INTEGER NOT NULL, missing_from_api INTEGER NOT NULL DEFAULT 0);
CREATE TABLE collection_entries (id INTEGER PRIMARY KEY, printing_id INTEGER NOT NULL REFERENCES card_printings(id),
  image_id INTEGER NOT NULL REFERENCES card_images(image_id), quantity INTEGER NOT NULL CHECK (quantity >= 1),
  notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (printing_id, image_id));
CREATE TABLE value_snapshots (date TEXT PRIMARY KEY, total_value REAL NOT NULL, total_cards INTEGER NOT NULL);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

- [ ] **Step 1: Write failing tests:** `migrate sets user_version 1 and is idempotent` (run twice, no throw, `user_version === 1`); `foreign keys are enforced` (inserting an entry with an unknown printing_id throws); `quantity check rejects 0`; `meta round-trips` (`setMeta(db,'last_sync_at','2026-10-23T00:00:00Z')` then `getMeta` returns it, and an unknown key returns `null`). Use `openDatabase(':memory:')`.
- [ ] **Step 2: Run** `npm test -- tests/main/database.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `database.ts` and `meta.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: sqlite schema v1 with migrations`

---

### Task 4: YGOPRODeck client and mapper

**Files:**
- Create: `src/main/ygo/client.ts`, `src/main/ygo/mapCard.ts`, `tests/fixtures/cardinfo.sample.json`
- Test: `tests/main/ygo.test.ts`

**Interfaces:**
- Produces: `ApiCard` (the raw API shape: `id, name, type, frameType, desc, race, atk?, def?, level?, linkval?, attribute?, archetype?, card_sets?: {set_name,set_code,set_rarity,set_rarity_code?,set_price?}[], card_images: {id}[], card_prices?: {tcgplayer_price?}[]`); `interface YgoClient { fetchCardInfo(): Promise<ApiCard[]>; fetchDbVersion(): Promise<{ databaseVersion: string; lastUpdate: string }> }`; `createYgoClient(fetchFn: typeof fetch = fetch): YgoClient`; `mapApiCard(c: ApiCard, now: string): { card: CardRow; printings: Omit<Printing, 'id' | 'missingFromApi'>[]; images: CardImage[] }`.
- The client throws `YgoApiError` (with a message that includes the HTTP status) on a non-2xx response, on JSON that fails to parse, or on a payload whose `data` isn't an array.

Fixture (synthetic values, 3 cards): Dark Magician `46986414` (images `46986414`, `46986415`; printings `LOB-EN005` Ultra Rare `"5.12"` and `SDY-006` Ultra Rare `"0.00"`; tcgplayer `"7.50"`); Pot of Greed `55144522` (one image; `LOB-EN119` Rare `"3.50"`); Harpie's Feather Duster `18144506` (one image; no `card_sets`; empty `card_prices`).

- [ ] **Step 1: Write failing tests**

```ts
test('mapApiCard maps printings, prices and art order', () => {
  const dm = mapApiCard(fixture.data[0], NOW)
  expect(dm.card).toMatchObject({ id: 46986414, name: 'Dark Magician', tcgplayerPrice: 7.5 })
  expect(dm.printings).toEqual([
    expect.objectContaining({ setCode: 'LOB-EN005', setRarity: 'Ultra Rare', setPrice: 5.12 }),
    expect.objectContaining({ setCode: 'SDY-006', setPrice: null })])
  expect(dm.images.map(i => [i.imageId, i.sortOrder])).toEqual([[46986414, 0], [46986415, 1]])
})
test('card without sets or prices maps cleanly', () => {
  const h = mapApiCard(fixture.data[2], NOW)
  expect(h.printings).toEqual([]); expect(h.card.tcgplayerPrice).toBeNull()
})
test('client parses data array', async () => { /* fetchFn returns fixture → 3 cards */ })
test('client throws YgoApiError on 500', async () => { /* status 500 → rejects /500/ */ })
test('client throws YgoApiError on truncated JSON', async () => { /* body '{"data":[' → rejects */ })
test('fetchDbVersion reads first element', async () => { /* [{database_version:'1.5',last_update:'2026-10-22 10:00:00'}] */ })
```

- [ ] **Step 2: Run** `npm test -- tests/main/ygo.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** using `parsePrice` from Task 2 for `set_price` and `tcgplayer_price`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: YGOPRODeck client and card mapper`

---

### Task 5: Sync service

**Files:**
- Create: `src/main/sync/sync.ts`
- Test: `tests/main/sync.test.ts`

**Interfaces:**
- Consumes: `YgoClient`, `mapApiCard`, `getMeta`/`setMeta`.
- Produces: `SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000`; `shouldSync(lastSyncAt: string | null, now: Date): boolean`; `getSyncStatus(db): SyncStatus` (state `idle`, values read from meta and `count(*)` of cards); `runSync(db, client: YgoClient, onProgress: (s: SyncStatus) => void, now?: Date): Promise<SyncStatus>`. `runSync` never throws: on failure it returns, and emits, `state: 'error'` with `error` set. Concurrent calls share one in-flight promise.

Behavior: emit `checking` → `fetchDbVersion` → `downloading` → `fetchCardInfo` → `saving`, then write everything in **one transaction**:
- upsert cards (`INSERT ... ON CONFLICT(id) DO UPDATE`);
- upsert printings with `ON CONFLICT(card_id, set_code, set_rarity) DO UPDATE` (never `INSERT OR REPLACE`, which would change ids that entries point at), setting `missing_from_api = 0`;
- upsert images the same way;
- printings and images absent from the payload: delete if no entry references them, otherwise set `missing_from_api = 1`;
- rebuild FTS (`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`);
- set `last_sync_at` (ISO) and `db_version`.

Then emit and return `idle`. The spec's checkDBVer step reduces to the 24 h rule (prices are always stale by the time it would run), so `db_version` is recorded for display only.

- [ ] **Step 1: Write failing tests:**
  - `shouldSync`: `null` → true; 23 h ago → false; 25 h ago → true.
  - `first sync loads fixture` (3 cards, 3 printings, 4 images; `last_sync_at` = `now.toISOString()`; status `idle`, `cardCount` 3).
  - `resync keeps printing ids stable` (ids identical after a second run).
  - `vanished printing referenced by an entry is flagged, unreferenced one deleted` (second payload drops `SDY-006` and `LOB-EN119`; one entry on `LOB-EN119`. Result: `LOB-EN119` remains with `missing_from_api = 1`, `SDY-006` gone).
  - `failure leaves data intact` (seed with the fixture, then a client whose `fetchCardInfo` rejects. Returns `state: 'error'` and a non-empty `error`; card count is still 3; `last_sync_at` unchanged; a following run with a good client succeeds).
  - `progress order` (the states emitted equal `['checking','downloading','saving','idle']`).
  - `FTS finds synced names` (`SELECT rowid FROM cards_fts WHERE cards_fts MATCH 'magician'` → `[46986414]`).
- [ ] **Step 2: Run** `npm test -- tests/main/sync.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: transactional card database sync`

---

### Task 6: Card search and detail

**Files:**
- Create: `src/main/repo/cards.ts`
- Test: `tests/main/cards.test.ts`

**Interfaces:**
- Produces: `buildFtsQuery(q: string): string | null` (split on anything that isn't a Unicode letter or digit, drop empty tokens, wrap each as `"tok"*`, join with spaces; returns `null` when no tokens remain); `searchCards(db, q: string, limit = 20): CardSearchResult[]`; `getCardDetail(db, cardId: number): CardDetail | null` (printings ordered by set_code; images by sort_order).
- Search: if the trimmed query contains `-` and no whitespace, set-code matches come first (`set_code LIKE ? ESCAPE '\'` prefix, case-insensitive, with `%`/`_` escaped; `matchedSetCode` set). Then come FTS name matches ranked by `bm25`, deduped by card id. `defaultImageId` = the image with sort_order 0.

- [ ] **Step 1: Write failing tests** (DB seeded through `runSync` with the fixture):

```ts
test('name prefix search', () => expect(searchCards(db, 'dark mag').map(r => r.id)).toEqual([46986414]))
test('apostrophes and FTS syntax never throw', () => {
  expect(searchCards(db, "Harpie's").map(r => r.id)).toEqual([18144506])
  for (const q of ['"', '*', '-', '(', 'NOT', 'a AND', '  ', "pot\"of"]) expect(() => searchCards(db, q)).not.toThrow()
  expect(searchCards(db, '   ')).toEqual([])
})
test('set code search', () => expect(searchCards(db, 'lob-en1')[0]).toMatchObject({ id: 55144522, matchedSetCode: 'LOB-EN119' }))
test('LIKE wildcards are literal', () => expect(searchCards(db, 'LOB-%')).toEqual([]))
test('getCardDetail', () => {
  const d = getCardDetail(db, 46986414)!
  expect(d.printings.map(p => p.setCode)).toEqual(['LOB-EN005', 'SDY-006'])
  expect(d.images).toHaveLength(2); expect(getCardDetail(db, 1)).toBeNull()
})
```

- [ ] **Step 2: Run** `npm test -- tests/main/cards.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: card search by name and set code`

---

### Task 7: Collection repository

**Files:**
- Create: `src/main/repo/collection.ts`
- Test: `tests/main/collection.test.ts`

**Interfaces:**
- Consumes: `priceFor`.
- Produces: `getEntry(db, id): EntryView | null`; `addEntry(db, input: AddEntryInput, now = new Date()): EntryView`; `updateEntry(db, id, patch: UpdateEntryInput, now = new Date()): EntryView`; `removeEntry(db, id): void`; `listEntries(db, f: CollectionFilters): EntryView[]`; `entriesForCard(db, cardId): EntryView[]`; `getFacets(db): Facets` (distinct values among *owned* entries only, sorted). Throws `CollectionError` for invalid input.
- Rules:
  - `quantity` must be an integer ≥ 1.
  - `imageId` must belong to the printing's card.
  - Adding an existing (printing, image) increments its quantity.
  - An update that moves an entry onto an existing (printing, image) merges: the target's quantity += this one's; notes are joined with `\n` when both are non-empty; this entry is deleted; the merged target is returned.
  - Value sort uses `totalValue`; ties break by name, then id.
  - `q` filters by FTS name (`buildFtsQuery`) OR set-code prefix.
  - `levelMin`/`levelMax` apply to `level` (link monsters use `linkval`).

- [ ] **Step 1: Write failing tests** (fixture synced; ids looked up by set code):
  - `add then add again increments` (qty 2 + 3 → one entry with qty 5).
  - `rejects quantity 0, -1, 1.5` (`CollectionError`).
  - `rejects image from another card` (Pot of Greed printing + Dark Magician art → `CollectionError`).
  - `entry value uses set price` (LOB-EN005 ×2 → `unitPrice` 5.12, `totalValue` 10.24, `priceApproximate` false).
  - `entry value falls back` (SDY-006 → `unitPrice` 7.5, `priceApproximate` true).
  - `entry with no price at all` (insert a synthetic printing with `set_price NULL` for Harpie's Feather Duster, whose `tcgplayer_price` is NULL → `unitPrice` null, `totalValue` 0, no NaN).
  - `changing art onto an existing combination merges` (entries A=(LOB-EN005, 46986414, qty 1, notes 'a'), B=(LOB-EN005, 46986415, qty 2, notes 'b'); `updateEntry(B, {imageId: 46986414})` → returns A with qty 3 and notes `'a\nb'`; B no longer exists).
  - `re-link printing onto an existing combination merges` (same idea with `printingId`).
  - `filters`: by `rarities: ['Rare']` → only Pot of Greed; `q: 'magician'` → both DM entries; `sort: 'value', dir: 'desc'` → highest first.
  - `facets list owned values only` (only owned sets appear).
  - `remove deletes`.
- [ ] **Step 2: Run** `npm test -- tests/main/collection.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** (merge inside a transaction).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: collection entries with merge-on-collision`

---

### Task 8: Stats and value snapshots

**Files:**
- Create: `src/main/repo/stats.ts`
- Test: `tests/main/stats.test.ts`

**Interfaces:**
- Consumes: `listEntries`, `getMeta`.
- Produces: `getStats(db): CollectionStats` (`pricesUpdatedAt` = `last_sync_at`; `approximateCount` = entries with `priceApproximate`; `topEntries` = the top 10 by `totalValue` desc; `byRarity` sorted by value desc; `byFrameType` sorted by count desc); `recordSnapshot(db, now = new Date()): void` (upsert keyed on the local date `YYYY-MM-DD`).

- [ ] **Step 1: Write failing tests:** `empty collection` (all zeros, empty arrays, nothing NaN); `totals` (LOB-EN005 ×2, SDY-006 ×1, LOB-EN119 ×4 → `totalCards` 7, `uniqueCards` 2, `totalValue` ≈ 10.24 + 7.5 + 14 = 31.74 using `toBeCloseTo`, `approximateCount` 1); `topEntries capped at 10` (12 entries → 10); `snapshot is one row per day` (two calls on the same day → 1 row holding the latest value; next day → 2 rows).
- [ ] **Step 2: Run** `npm test -- tests/main/stats.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: collection stats and daily value snapshots`

---

### Task 9: Image cache and protocol

**Files:**
- Create: `src/main/images/limiter.ts`, `src/main/images/cache.ts`, `src/main/images/protocol.ts`
- Test: `tests/main/images.test.ts`

**Interfaces:**
- Produces: `createLimiter(opts: { concurrency: number; minIntervalMs: number }): <T>(fn: () => Promise<T>) => Promise<T>`; `imageUrl(size: 'small' | 'full', id: number): string`; `createImageCache(opts: { dir: string; fetchFn?: typeof fetch; limit?: ReturnType<typeof createLimiter> }): { get(size, id): Promise<string | null>; sizeBytes(): Promise<number>; clear(): Promise<void> }`. `get` returns the cached file path, or `null` when the download fails. Files live at `<dir>/<size>/<id>.jpg`; downloads write `<id>.jpg.tmp` and then rename. Concurrent `get`s for the same key share one download.
- `registerImageScheme()` calls `protocol.registerSchemesAsPrivileged([{ scheme: 'ygo-img', privileges: { standard: true, secure: true, supportFetchAPI: true } }])` and must run before `app.whenReady`. `handleImageProtocol(cache)` calls `protocol.handle('ygo-img', ...)`, parsing `ygo-img://small/46986414` and responding with `net.fetch(pathToFileURL(path))`, or a 404 when the result is `null` or the URL is malformed (non-numeric id, unknown size).
- Default limiter for production: `{ concurrency: 4, minIntervalMs: 50 }`.

- [ ] **Step 1: Write failing tests** (temp dir via `fs.mkdtemp`):
  - `downloads once then serves from disk` (a fetch spy is called once for two `get('small', 1)` calls, including two concurrent ones).
  - `failed download returns null and caches nothing` (500 → `null`; no `.jpg` or `.tmp` left; a later `get` with a good fetch succeeds).
  - `interrupted body leaves no file` (the body stream errors → `null`, directory empty).
  - `limiter caps concurrency` (10 tasks with `{concurrency: 4, minIntervalMs: 0}` → max in-flight 4).
  - `limiter spaces starts` (fake timers; with `minIntervalMs: 50`, start times are ≥ 50 ms apart).
  - `sizeBytes and clear`.
  - `imageUrl` returns the two URLs from Global Constraints.
- [ ] **Step 2: Run** `npm test -- tests/main/images.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** (`protocol.ts` is thin and not unit-tested; it's covered by Task 10's manual check).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: rate-limited local image cache and ygo-img protocol`

---

### Task 10: IPC wiring, preload, and main bootstrap

**Files:**
- Create: `src/main/ipc/handlers.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html` (CSP `img-src 'self' ygo-img: data:`)
- Test: `tests/main/handlers.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–9; `createUpdater` from Task 15 (wire it in that task; leave a `TODO(Task 15)` call site here).
- Produces: `createHandlers(deps: { db; client: YgoClient; images; emitSync: (s: SyncStatus) => void; app: AppDeps }): Record<(typeof INVOKE_CHANNELS)[number], (...args: any[]) => Promise<unknown>>`; `registerIpc(handlers)` (calls `ipcMain.handle` for each channel); `AppDeps = { version(): string; openDataFolder(): Promise<void>; backupDatabase(): Promise<string | null>; checkForUpdates(): Promise<UpdateStatus>; applyUpdate(): Promise<void> }`. The preload builds `window.api: Api` from `INVOKE_CHANNELS` via `ipcRenderer.invoke`. `onProgress`/`onUpdateStatus` subscribe to the event channels and return an unsubscribe function. A `src/renderer/src/env.d.ts` declares `window.api: Api`.
- Bootstrap order in `index.ts`:
  1. `registerImageScheme()`
  2. on ready: `openDatabase(join(app.getPath('userData'), 'collection.db'))`
  3. `handleImageProtocol(createImageCache({ dir: join(userData, 'images') }))`
  4. `registerIpc`
  5. create the window (min 1100×700; `webPreferences` per Global Constraints)
  6. `recordSnapshot`
  7. if `shouldSync(last_sync_at)`: `runSync` in the background, broadcasting progress to all windows, then `recordSnapshot` again
- `backupDatabase`: `dialog.showSaveDialog` with default name `yugioh-collection-YYYY-MM-DD.db` → `db.backup(path)` → returns the path, or `null` on cancel.

- [ ] **Step 1: Write the failing test** `every Api method has a handler`: `Object.keys(createHandlers(fakeDeps)).sort()` equals `[...INVOKE_CHANNELS].sort()`. Also `collection:add round-trips through handlers` against an in-memory DB seeded with the fixture.
- [ ] **Step 2: Run** `npm test -- tests/main/handlers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** handlers, preload, and bootstrap.
- [ ] **Step 4: Run** the tests (expected: PASS) and `npm run typecheck` (expected: clean).
- [ ] **Step 5: Manual check:** delete `~/.config/<app>/collection.db` and run `npm run dev`. Expected: the first sync runs (main log shows the progress states), and in the renderer devtools `await window.api.cards.search('dark magician')` returns results. A temporary `<img src="ygo-img://small/46986414">` renders, and the file appears under `userData/images/small/`.
- [ ] **Step 6: Commit** `feat: wire IPC, preload api, startup sync`

---

### Task 11: Renderer shell

**Files:**
- Create: `src/renderer/src/lib/api.ts`, `lib/format.ts`, `components/AppShell.tsx`, `components/SyncBanner.tsx`, `components/CardArt.tsx`
- Modify: `src/renderer/src/App.tsx`, `main.tsx`
- Test: `tests/renderer/shell.test.tsx`, `tests/renderer/format.test.ts`

**Interfaces:**
- Produces:
  - `api: Api` (= `window.api`).
  - `queryKeys = { entries: (f) => ['entries', f], facets: ['facets'], stats: ['stats'], sync: ['sync'], search: (q) => ['search', q], card: (id) => ['card', id], forCard: (id) => ['forCard', id], update: ['update'] }`. Every mutation invalidates `entries`, `facets`, `stats`, and `forCard`.
  - `formatUsd(n: number | null): string` (`null` → `'—'`, otherwise `$1,234.56`).
  - `formatRelative(iso: string | null, now = new Date()): string` (`null` → `'never'`; `'just now'` under 1 min; then `'5 min ago'`, `'3 h ago'`, `'2 days ago'`).
  - `<CardArt imageId size="small" | "full" alt className />`: an `<img src="ygo-img://…">` with `loading="lazy"`; `onError` swaps to a neutral card-back placeholder (inline SVG).
  - `<AppShell page onNavigate>`: a left sidebar with Dashboard / Collection / Settings and an "Add card" button. `Page = 'dashboard' | 'collection' | 'settings'`; navigation is plain React state, no router.
  - `useSyncStatus()`: queries `sync.status` and subscribes to `onProgress`.
  - `<SyncBanner>`: shows "Downloading card database…" while syncing; when `cardCount === 0` and the state isn't syncing, shows a first-run message with a Retry button; on `error`, shows "Couldn't update card data: <error>" with Retry.
  - `Ctrl/Cmd+K` opens the Add dialog (wired in Task 12).
- Visual direction (from the spec: modern, clean, card art forward): neutral surfaces, art as the colour. Use the `frontend-design` skill for this task.

- [ ] **Step 1: Write failing tests:** `format.test.ts` covers every case above. `shell.test.tsx` (with `window.api` mocked): nav switches pages; the banner shows the first-run message when `cardCount: 0`, and Retry calls `api.sync.run`; the banner shows the error text for `state: 'error'`; `CardArt` swaps to the placeholder after `fireEvent.error`.
- [ ] **Step 2: Run** `npm test -- tests/renderer`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Manual check:** `npm run dev`. The sidebar works and the theme follows the OS (toggle the OS dark mode).
- [ ] **Step 6: Commit** `feat: app shell, sync banner, card art`

---

### Task 12: Add Card dialog

**Files:**
- Create: `src/renderer/src/features/add-card/AddCardDialog.tsx`
- Modify: `AppShell.tsx` (button + Ctrl/Cmd+K)
- Test: `tests/renderer/add-card.test.tsx`

**Interfaces:**
- Consumes: `api.cards.search`, `api.cards.get`, `api.collection.add`, `queryKeys`.
- Produces: `<AddCardDialog open onOpenChange />`.
- Flow:
  1. **Search:** shadcn `Command`, 200 ms debounce, showing a thumbnail, name, type, and the matched set code.
  2. **Printing:** a list of set name · code · rarity · `formatUsd(setPrice)`; printings with `missingFromApi` are hidden.
  3. **Art:** only if `images.length > 1`; a thumbnail grid with sort_order 0 preselected.
  4. **Quantity:** number input, default 1, min 1, integers only.
  5. **Save** → toast "Added N × <name> (<setCode>)" and the dialog resets to step 1 (focus back in search) for fast repeat entry.

  The whole flow is keyboard-operable (arrow keys + Enter moves forward, Backspace on an empty step goes back). While `cardCount === 0`, the dialog shows "Card database is still downloading" instead of search.

- [ ] **Step 1: Write failing tests** (mocked api returning fixture-shaped data):
  - `single-art card skips art step`: search "pot" → pick → pick LOB-EN119 → quantity 3 → Save; `add` called with `{ printingId, imageId: 55144522, quantity: 3 }`.
  - `multi-art card shows art step with original preselected` (DM → 2 thumbnails; choosing the second sends `imageId: 46986415`).
  - `quantity 0 disables Save`.
  - `stays open and resets after save`.
  - `shows downloading message when card db empty`.
- [ ] **Step 2: Run** `npm test -- tests/renderer/add-card.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Manual check** in `npm run dev`: add 3 different cards using only the keyboard.
- [ ] **Step 6: Commit** `feat: add card dialog with printing and art selection`

---

### Task 13: Collection page

**Files:**
- Create: `src/renderer/src/features/collection/CollectionPage.tsx`, `FilterBar.tsx`, `CollectionGrid.tsx`, `CollectionTable.tsx`, `EntryDetailPanel.tsx`
- Test: `tests/renderer/collection.test.tsx`

**Interfaces:**
- Consumes: `api.collection.list/facets/forCard/update/remove`, `api.cards.get`, `api.stats.get` (for `pricesUpdatedAt`), `CardArt`, `formatUsd`, `formatRelative`.
- Produces:
  - **Page:** a header showing "N entries · Prices updated <relative>", and a grid/table toggle (remembered in `localStorage` key `collection.view`).
  - **`FilterBar`:** search (debounced 200 ms); multi-select facets for card type, attribute, archetype, set, and rarity; level min/max; sort select (Name, Value, Quantity, Date added) with a direction toggle; "Clear filters". Filter state lives in the page. Default sort is `added` `desc`.
  - **Grid:** a card-art tile with a quantity badge, name, set code · rarity, and value.
  - **Table:** TanStack Table with columns Art (thumb), Name, Set code, Set, Rarity, Qty, Unit price, Total. Column-header clicks drive the same sort state.
  - **Values:** an approximate value shows a `≈` prefix plus a tooltip "Set price unavailable — using the card's general TCGplayer price". A `missingFromApi` printing shows the badge "No longer in database — price may be stale".
  - **Empty state:** "No cards yet" with an Add card button. When filters exclude everything: "No cards match these filters" with Clear filters.
  - **`EntryDetailPanel`** (shadcn `Sheet`, opened by clicking an entry): the full art, name, type line, ATK/DEF/level, card text; "Your copies" listing every entry for this card (`forCard`); for the selected entry, editable quantity and notes, an art picker (when there are several images), a printing picker (re-link; current printings of the same card), and Remove with a confirm. Saves go through `update`; if the server returns a different id (merge), the panel selects the returned entry and toasts "Merged with an existing entry".

- [ ] **Step 1: Write failing tests** (mocked api):
  - `renders entries in grid and table`.
  - `changing rarity facet calls list with rarities`.
  - `sort by value desc calls list with { sort: 'value', dir: 'desc' }`.
  - `approximate value shows ≈`.
  - `missing printing shows stale badge`.
  - `editing quantity calls update`.
  - `merge result reselects returned entry and toasts`.
  - `remove asks for confirmation then calls remove`.
  - `empty and no-match states`.
- [ ] **Step 2: Run** `npm test -- tests/renderer/collection.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Manual check:** with ~10 cards added, filter, sort, switch views, edit, re-link, and remove in `npm run dev`. Then go offline (disable networking) and restart: browsing and search still work, and cached art shows.
- [ ] **Step 6: Commit** `feat: collection page with filters, grid/table, detail panel`

---

### Task 14: Dashboard

**Files:**
- Create: `src/renderer/src/features/dashboard/DashboardPage.tsx`
- Test: `tests/renderer/dashboard.test.tsx`

**Interfaces:**
- Consumes: `api.stats.get`, `CardArt`, `formatUsd`, `formatRelative`.
- Produces:
  - **Stat tiles:** Total cards, Unique cards, Estimated value (with "≈ includes N approximate prices" when `approximateCount > 0`), Prices updated.
  - **"By rarity":** horizontal bars of value with count labels.
  - **"By card type":** horizontal bars of count by frame type.
  - **"Most valuable":** the top 10 rows (art thumb, name, set code · rarity, qty, total). Clicking a row navigates to Collection with that entry's detail open (pass `{ page: 'collection', entryId }` through `onNavigate`).
  - **Empty collection:** an "Add your first card" call to action.
  - **Charts:** plain CSS bars (no chart library). Follow the `dataviz` skill for colour and labelling.

- [ ] **Step 1: Write failing tests:** `tiles show formatted stats` (`totalValue: 31.74` → `$31.74`); `approximate note appears only when approximateCount > 0`; `top entry click navigates`; `empty state`.
- [ ] **Step 2: Run** `npm test -- tests/renderer/dashboard.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: dashboard with stats, breakdowns, top cards`

---

### Task 15: Auto-update and Settings

**Files:**
- Create: `src/main/updater.ts`, `src/renderer/src/features/settings/SettingsPage.tsx`
- Modify: `src/main/index.ts` (replace the `TODO(Task 15)`), `electron.vite.config.ts` (main `define: { __MAC_SIGNED__: JSON.stringify(Boolean(process.env.CSC_LINK)) }`, declared in a `.d.ts`)
- Test: `tests/main/updater.test.ts`, `tests/renderer/settings.test.tsx`

**Interfaces:**
- Produces:
  - `updateMode(platform: NodeJS.Platform, macSigned: boolean): 'auto' | 'notify'` (`darwin` && !signed → `notify`, otherwise `auto`).
  - `RELEASES_URL = 'https://github.com/darkharasho/yugioh-collection-tracker/releases'`.
  - `createUpdater(deps: { autoUpdater: AppUpdater; mode; emit: (s: UpdateStatus) => void; openExternal: (url: string) => Promise<void>; enabled: boolean }): { check(): Promise<UpdateStatus>; apply(): Promise<void>; start(): void; stop(): void }`.
  - `start()` checks immediately, then every `4 * 60 * 60 * 1000` ms.
  - `auto` mode: `autoDownload = true`; events map to `available` → `downloading` → `ready`; `apply()` calls `quitAndInstall()` (only after the user clicks).
  - `notify` mode: `autoDownload = false`; `available` carries `version`; `apply()` calls `openExternal(\`${RELEASES_URL}/tag/v${version}\`)`.
  - `enabled` is `app.isPackaged`. When false, `check()` returns `{ state: 'none' }` without contacting GitHub.
  - Errors become `state: 'error'` and never throw.
- **Renderer:**
  - A toast "Update <version> ready — Restart now / Later" when `ready`, or "Update <version> available — Download" in notify mode.
  - **Settings page:** an "App" section (version, "Check for updates" button, status text); a "Card data" section (last sync relative + absolute time, card count, database version, "Refresh card data" button disabled while syncing, last error); "Image cache" (size in MB, "Clear image cache"); "Data" ("Open data folder", "Back up collection…" → toast with the saved path).

- [ ] **Step 1: Write failing tests:**
  - `updateMode` covers all four combinations of darwin/linux × signed/unsigned.
  - Fake `AppUpdater` (an EventEmitter with `checkForUpdates`, `quitAndInstall`, `autoDownload`):
    - `auto mode reaches ready and apply calls quitAndInstall`.
    - `notify mode never downloads and apply opens the release tag URL` (`version '1.2.0'` → `.../releases/tag/v1.2.0`).
    - `disabled updater does not check`.
    - `error event becomes error status`.
    - `start schedules a 4 h interval` (fake timers).
  - Settings: `refresh button calls sync.run and is disabled while syncing`; `backup shows saved path`; `check for updates shows status`.
- [ ] **Step 2: Run** `npm test -- tests/main/updater.test.ts tests/renderer/settings.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**, and wire `createUpdater` into `index.ts` (`emit` broadcasts on `UPDATE_STATUS`; `start()` after the window is created).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: auto-update with macOS notify fallback, settings page`

---

### Task 16: Packaging and release workflow

**Files:**
- Create: `electron-builder.yml`, `.github/workflows/release.yml`, `build/icon.png` (1024×1024 placeholder: card-back motif)
- Modify: `README.md` (run, test, release instructions), `package.json` (`version: 0.1.0`, `build:*` scripts)

**Interfaces:**
- `electron-builder.yml`:
  - `appId`/`productName` per Global Constraints; `asarUnpack: ['**/*.node']`.
  - `linux.target: AppImage`; `win.target: nsis`.
  - `mac.target: [dmg, zip]` with `arch: universal`, `hardenedRuntime: true`, `notarize: true` (it only takes effect when the Apple env vars exist).
  - `publish: { provider: github, owner: darkharasho, repo: yugioh-collection-tracker, releaseType: release }`.
- **Workflow** on `push: tags: ['v*']`, `permissions: contents: write`:
  - **Job `test`** (ubuntu-latest, Node 22): `npm ci`, `npm run typecheck`, `npm test`.
  - **Job `release`** (needs `test`; matrix `ubuntu-latest`, `windows-latest`, `macos-latest`):
    - `npm ci`.
    - A step failing unless `refs/tags/v<package.json version>` equals `github.ref`.
    - `npx electron-vite build`, then `npx electron-builder --publish always`.
    - env: `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`; on macOS also `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` from secrets (they may be empty).
    - When `CSC_LINK` is empty on macOS, set `CSC_IDENTITY_AUTO_DISCOVERY=false` and pass `-c.mac.identity=-` (ad-hoc signing) and `-c.mac.notarize=false`.

- [ ] **Step 1: Write the config and workflow.**
- [ ] **Step 2: Run** `npm run build:linux`. Expected: `dist/*.AppImage` and `dist/latest-linux.yml` exist. Launch the AppImage: the app opens, syncs, and better-sqlite3 loads (no native-module error).
- [ ] **Step 3: Validate the workflow** with `actionlint` if it's installed (otherwise review it by eye). Expected: no errors.
- [ ] **Step 4: Commit** `ci: electron-builder config and tag-triggered release workflow`
- [ ] **Step 5: Stop and ask the owner** before pushing a `v0.1.0` tag: a tag push publishes a public release. After they approve, push the tag, watch the run, and confirm the release has the AppImage, the `.exe`, the `.dmg` and `.zip`, and the `latest*.yml` files. Then check that the macOS build's `codesign -dv` reports an ad-hoc signature (or Developer ID if the secrets are set).
