# Prices for Every Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every card shows a sensible US price.
- European printings show the English TCGplayer price as an "≈" estimate.
- Asian printings get a weekly eBay US set sweep.
- Every client holds the server's prices before anyone looks at a card, including the scan stream view.

**Architecture:**
- **English fallback.** One shared SQL fragment looks up the English twin through the existing
  `ux_printings_en` unique partial index. Every price site uses it; no stored mapping or migration
  is needed.
- **Set sweep.** The `ygo-ebay-prices` Worker gains `GET /v1/set` (one search per set prefix, titles
  parsed into code + rarity) and `GET /v1/quota`.
- **Sweep scheduling.** The portal's existing Durable Object price alarm also runs a budgeted sweep
  queue (`price_sweeps`). It writes `intl_prices`, which gets a change seq.
- **Delivery.** Desktop and phone pull a new `GET /api/sync/price-changes` delta feed on every sync.
  The web app already reads the portal's tables directly.

**Tech Stack:**
- TypeScript, Electron + better-sqlite3 (`src/main`), React (`src/renderer`)
- Cloudflare Workers + Durable Object SQLite (`workers/portal`)
- Plain-JS Worker (`workers/ebay-prices`)
- vitest

**Spec:** `docs/superpowers/specs/2026-10-28-asian-prices-sweep-design.md`

## Global Constraints

- **"Sensible" means the eBay US price.** The `EBAY_US` marketplace, category 31395, median after
  trimming outliers (`askingPrice`). No Japanese shop prices, sold prices or PriceCharting.
- **A wrong-rarity price is worse than none.** When a listing's rarity is ambiguous on a code that
  has several rarities, that listing prices nothing.
- **The sweep never erases a price.** Finding nothing leaves existing rows untouched.
- **The fallback applies to European printings only:** `de, fr, it, es, pt` (codes DE/FR/IT/SP/PT,
  old G/F/I/S/P). It is the English printing's `market_price` for the same `card_id`, `set_rarity`
  and region-swapped `set_code`, flagged approximate. Asian printings never use it.
- **The sweep covers Asian languages only:** `ja, ko, zh-hans, zh-hant, ae`.
- **Sweep budget:**
  - At most `SWEEP_DAILY_CALLS = 2000` eBay calls a UTC day.
  - It sweeps only while eBay reports more than `SWEEP_RESERVE = 2000` Browse calls remaining.
  - It stops for the day on a 429.
  - Each prefix is re-swept about every 7 days (`PRICE_INTERVAL_MS`).
- **Sweep order:** prefixes with a printing someone owns first, then newest `tcg_date`, then the
  rest.
- **No new full scans on desktop.** Every new query on the synchronous main process uses indexes.
  Test the plan with `EXPLAIN QUERY PLAN`, as `tests/main/prices.test.ts` does.
- **Durable Object SQLite:** no long compound UNIONs; one query per table. Spread writes so
  free-plan row-write and row-read limits (100k writes and 5M reads a day) stay far off.
- **Deploys are one-way.**
  - Portal: `npm run deploy` in `workers/portal`.
  - eBay Worker: `npx wrangler deploy` in `workers/ebay-prices`.
  - Server migrations are append-only `SERVER_STEPS` (`server-11` is next). The desktop
    `user_version` stays 18; no desktop migration in this plan.
- **Checks:**
  - `npm test` (vitest, `--maxWorkers=2`) and `npm run typecheck`
  - `npm test` in `workers/portal`
  - Lint only changed files: `npx eslint <files>`, and never `--fix` across the repo.
- **No 100k+ row synthetic test data.**

## Review Focus

1. **Codes with several rarities where listings name no rarity** (e.g. `CORI-JP001`: UR, SE and QCSE).
   - Expected: none of the three gets a price from those listings.
   - Test: Task 3 `setPrices leaves rarity-less listings off multi-rarity codes`, and Task 5
     `assignSweep prices only the named rarity`.
2. **A per-card price checked after the prefix's previous sweep.**
   - Expected: the sweep keeps it, even if its own price differs.
   - Test: Task 5 `assignSweep keeps a per-card price newer than the last sweep`.
3. **A European printing with its own eBay price.**
   - Expected: the eBay price wins over the English estimate and isn't marked approximate.
   - Test: Task 1 `own eBay price beats the English estimate`.
4. **Old single-letter European codes** (`LOB-G001` → `LOB-E001`) and codes with no English twin.
   - Expected: the single-letter code maps to its English twin; a code with no twin shows no price
     (today's behaviour).
   - Test: Task 1 `maps single-letter regions` and `no twin, no price`.
5. **A desktop that has never pulled prices** (cursor 0, about 100k rows).
   - Expected: it pages in batches without one huge transaction, and a page whose pkey the desktop
     doesn't know is skipped.
   - Test: Task 6 `pullPriceChanges pages to the end and skips unknown pkeys`.

---

### Task 1: English price estimate for European printings

**Files:**
- Create: `src/main/repo/enTwin.ts`
- Modify: `src/main/repo/collection.ts:40-85` (SELECT + `toView`)
- Modify: `src/main/repo/sets.ts:166-172` (`PRINTING_PRICE` + its doc comment)
- Modify: `src/main/repo/scan.ts:20-25` (SELECT `rawPrice`), plus wherever it reports approximate, if anywhere
- Test: `tests/main/en-twin.test.ts`
- Test: `tests/main/tombstones.test.ts` (only if a `collection_entries` reference count changes)

**Interfaces:**
- Produces: `EN_TWIN_PRICE: string`, an SQL scalar subquery over alias `p` that returns the English
  twin's `market_price`, or NULL.
- Produces: `EU_LANGUAGES: readonly Language[] = ['de','fr','it','es','pt']`.
- Produces: `enTwinCode(code: string): string | null`, a JS mirror for tests and the spike.
  - `LOB-DE001` → `LOB-EN001`
  - `LOB-G001` → `LOB-E001`
  - `LOB-SP001` → `LOB-EN001`
  - Codes without a European region → null

  Region map: DE/FR/IT/SP/PT → EN, and G/F/I/S/P → E.
- The SQL uses `ux_printings_en (card_id, set_code, set_rarity) WHERE language='en'`, so it is a
  point lookup.

- [ ] **Step 1: Write the failing tests** in `tests/main/en-twin.test.ts`. Use the existing in-memory
  DB helpers that `tests/main/prices.test.ts` uses. Seed one card with `LOB-EN001` Ultra Rare
  (`market_price` 12.5), `LOB-DE001` Ultra Rare, `LOB-DE001` Secret Rare, `LOB-G001` Ultra Rare
  (English twin `LOB-E001` Ultra Rare at 9) and `CORI-JP001` Ultra Rare.
  - `enTwinCode maps two-letter and single-letter regions`:
    - `LOB-DE001` → `LOB-EN001`
    - `LOB-G001` → `LOB-E001`
    - `CORI-JP001` → null
    - `LOB-EN001` → null
  - `listEntries shows the English price as approximate`: a `LOB-DE001` Ultra Rare entry gives
    `unitPrice 12.5`, `priceApproximate true`, `priceSource 'tcgplayer'` and `noPriceReason null`.
  - `own eBay price beats the English estimate`: with `intl_prices` 4.0 on the DE printing, it gives
    `unitPrice 4`, `priceApproximate false` and `priceSource 'ebay'`.
  - `rarity must match`: the DE Secret Rare (no English Secret Rare) gives `unitPrice null`.
  - `maps single-letter regions`: the `LOB-G001` entry gives 9.
  - `no twin, no price`, plus `Asian printings never fall back`: the `CORI-JP001` entry gives
    `unitPrice null`.
  - `checklist and scan use the estimate`:
    - `printingsForSet` / the checklist price for `LOB-DE001` Ultra Rare is 12.5.
    - The scan `printingsByCode('LOB-DE001')` option price is 12.5.
  - `twin lookup uses the index`: `EXPLAIN QUERY PLAN` of the collection SELECT contains
    `ux_printings_en` and no `SCAN en`.

- [ ] **Step 2: Run them to confirm they fail.** Run `npx vitest run tests/main/en-twin.test.ts --maxWorkers=2`.
  Expected: FAIL (`enTwin` module missing).

- [ ] **Step 3: Implement `src/main/repo/enTwin.ts`** with `EU_LANGUAGES`, `enTwinCode` and `EN_TWIN_PRICE`.
  The swap only touches the region letters right after the first dash.
  - For a two-letter region, the SQL expression is
    `substr(p.set_code, 1, instr(p.set_code, '-')) || 'EN' || substr(p.set_code, instr(p.set_code, '-') + 3)`.
  - For a single-letter region it is `... || 'E' || substr(..., + 2)`.
  - Pick the form with a `CASE` on `p.language` and `substr(p.set_code, instr(p.set_code,'-')+1, 2)`.

  Wrap the result as
  `(SELECT en.market_price FROM card_printings en WHERE en.language = 'en' AND en.card_id = p.card_id AND en.set_rarity = p.set_rarity AND en.set_code = <expr>)`,
  guarded by `p.language IN ('de','fr','it','es','pt')`.

- [ ] **Step 4: Use it at every price site.**
  - **`collection.ts`:** select `${EN_TWIN_PRICE} AS en_twin_price`. In `toView`, for non-English
    with no `ip.price` (no row, or a row with null price), use `en_twin_price` when it's non-null:
    `approximate = true`, `priceSource = 'tcgplayer'`, `noPriceReason = null`. Replace the "never
    falls back" comment with one line saying European printings fall back to the English twin as
    an estimate.
  - **`sets.ts` `PRINTING_PRICE`:** `... ELSE COALESCE(ip.price, ${EN_TWIN_PRICE}) END`, and update
    the doc comment the same way.
  - **`scan.ts` `rawPrice`:** the same `COALESCE`. Stats follow automatically through `listEntries`.

- [ ] **Step 5: Run the tests to confirm they pass.** Run `npx vitest run tests/main --maxWorkers=2`,
  then `npm run typecheck`. Expected: all PASS.
  - If `tests/main/tombstones.test.ts` fails on reference counts, update the pin for the file whose
    count changed.
  - Check the renderer still renders approximate prices with its existing "≈"/approximate style.
    Search for `priceApproximate` in `src/renderer`. If the checklist or scan path has no
    approximate flag, leave the UI alone; a price is shown either way.

- [ ] **Step 6: Commit.**
  ```bash
  git add src/main/repo/enTwin.ts src/main/repo/collection.ts src/main/repo/sets.ts src/main/repo/scan.ts tests/main/en-twin.test.ts tests/main/tombstones.test.ts
  git commit -m "feat(prices): estimate European printings from their English twin"
  ```

### Task 2: Scan window picks up new prices

**Files:**
- Modify: `src/renderer/src/features/scan/window/ScanWindowApp.tsx:48-54`
- Test: `tests/renderer/scan-window-prices.test.tsx`, or the existing ScanWindowApp test file if
  there is one (search `tests/renderer` for `ScanWindowApp`)

**Interfaces:**
- Consumes: `window.api.app.onDataChanged(cb): () => void` (preload, already broadcast to every window).

- [ ] **Step 1: Write the failing test.** Name: `refetches set printings when data changes`.
  - Render `ScanWindowApp` with a mocked `api.scan.printingsForSet` and a picked set.
  - Fire the captured `onDataChanged` callback.
  - Assert that `printingsForSet` was called twice.

- [ ] **Step 2: Run the test to confirm it fails.** Run `npx vitest run tests/renderer/scan-window-prices.test.tsx --maxWorkers=2`.
  Expected: FAIL (called once).

- [ ] **Step 3: Add the subscription.** In `ScanWindowApp`, add a `useEffect` that subscribes to
  `api.app.onDataChanged` and calls `queryClient.invalidateQueries({ queryKey: ['scan'] })`.
  Keep `staleTime: Infinity`, so it refetches only on real changes.

  The 4-second pull overlay is not live-updated (my call: it's gone before a lookup could land).
  Repeat scans read fresh prices.

- [ ] **Step 4: Run the test to confirm it passes.** Run the same command. Expected: PASS.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/renderer/src/features/scan/window/ScanWindowApp.tsx tests/renderer/scan-window-prices.test.tsx
  git commit -m "fix(scan): show prices that arrive after a card was first scanned"
  ```

### Task 3: eBay Worker set search and quota endpoints

**Files:**
- Create: `workers/ebay-prices/src/set.js` (pure)
- Modify: `workers/ebay-prices/src/index.js` (routes `/v1/set` and `/v1/quota`; `search` gains `offset` and `limit`)
- Test: `workers/ebay-prices/test/set.test.js`
- Test: `workers/ebay-prices/test/index.test.js`

**Interfaces:**
- Produces, in `set.js`:
  - `sweepKey(code: string): string`: the code minus its trailing number. `CORI-JP025` →
    `CORI-JP`; `LOB-K001` → `LOB-K`.
  - `RARITY_ALIASES: Record<string, string>`: maps title tokens to the catalog's `set_rarity`
    names. It must cover the rarities above about 200 printings that appear in the local catalog
    for ja/ko/zh/ae:

    | Catalog rarity | Title tokens |
    |---|---|
    | Common | `N`, `Normal`, `Common` |
    | Rare | `R` |
    | Super Rare | `SR` |
    | Ultra Rare | `UR` |
    | Secret Rare | `SE`, `SCR` |
    | Prismatic Secret Rare | `PSE`, `PSER` |
    | Quarter Century Secret Rare | `QCSE`, `QCSCR`, `25th` |
    | Ultimate Rare | `UL`, `Relief` |
    | Collector's Rare | `CR` |
    | Normal Parallel Rare | `NP`, `N-P`, `Parallel` |
    | Ultra Parallel Rare | `UPR` |
    | Gold Rare | `GR` |
    | Millennium Rare | `M` |
    | Normal Rare | `NR` |

    Long names match case-insensitively; short tokens match only as whole words.
  - `parseListing(title: string, key: string): { code: string | null; rarity: string | null }`. The
    code is the first `key` + digits found (case-insensitive, normalized to upper case). The
    rarity is `null` when no token matches, or when tokens for two different rarities both appear.
  - `setPrices(items, key): { codes: Record<string, { all: Price; byRarity: Record<string, Price> }> }`,
    where `Price = { price: number | null; listingCount: number }` comes from `askingPrice`.
    - Apply `isSingleCard` and the USD currency filter.
    - `all` uses every matched listing for the code.
    - `byRarity` uses only listings with that parsed rarity.
- Produces, in `index.js`:
  - `GET /v1/set?key=CORI-JP&lang=ja` returns `{ ...setPrices, calls: number, checkedAt }`.
    - The query is `buildQuery({ code: key, lang })` without quotes and without rarity.
    - It pages `limit=200` up to `SET_MAX_PAGES = 3`, stopping when a page returns fewer than 200.
    - It needs the `X-Client` header. `lang` must be one of ja/ko/zh-hans/zh-hant/ae.
    - It is not cached in KV.
    - It returns 429 `{ error: 'rate limited' }` when eBay answers 429 after retries.
  - `GET /v1/quota` returns `{ remaining: number | null, resetAt: string | null }`. It reads
    `https://api.ebay.com/developer/analytics/v1_beta/rate_limit/?api_context=buy&api_name=browse`
    with the app token and takes the `buy.browse` resource's `remaining` and `reset`; it returns
    null fields on any failure.

- [ ] **Step 1: Write the failing pure tests** in `set.test.js`.
  - `sweepKey strips the number`: `CORI-JP025` → `CORI-JP`, `LOB-K001` → `LOB-K`.
  - `parseListing reads code and short rarity`:
    `"Yugioh CORI-JP025 Rayrage UR Japanese"` → `{ code: 'CORI-JP025', rarity: 'Ultra Rare' }`.
  - `parseListing prefers the longest rarity`: `"CORI-JP001 QCSE Quarter Century Secret"` →
    `Quarter Century Secret Rare`, not `Secret Rare`.
  - `parseListing gives null on conflicting rarities`: `"CORI-JP001 UR SE"` → rarity null.
  - `parseListing does not read R inside words`: `"CORI-JP010 Rescue Rabbit"` → rarity null.
  - `setPrices leaves rarity-less listings off multi-rarity codes`. Five listings for `CORI-JP001`:
    UR at 10 and 12, SE at 30 and 34, one with no rarity at 20.
    - `byRarity['Ultra Rare'].price` is 11 and `byRarity['Secret Rare'].price` is 32.
    - Neither includes the 20.
    - `all.listingCount` is 5.
  - `setPrices drops lots and non-USD`.

- [ ] **Step 2: Run the tests to confirm they fail.** Run `npx vitest run workers/ebay-prices --maxWorkers=2`.
  Expected: FAIL (module missing).

- [ ] **Step 3: Implement `set.js`.**

- [ ] **Step 4: Write the failing route tests** in `index.test.js`, following its existing fetch mocks.
  - `/v1/set pages until a short page`: the mock returns 200, then 37 items. Expect `calls` to be 2.
  - `/v1/set rejects English`: `lang=en` gives 400.
  - `/v1/set passes through 429`.
  - `/v1/quota reads browse remaining`: the mock analytics body
    `{ rateLimits: [{ apiContext: 'buy', apiName: 'browse', resources: [{ name: 'buy.browse', rates: [{ remaining: 4321, reset: '2026-10-29T00:00:00.000Z' }] }] }] }`
    gives `{ remaining: 4321, resetAt: '2026-10-29T00:00:00.000Z' }`.
  - `/v1/quota is null on failure`.

- [ ] **Step 5: Implement the routes.** Run `npx vitest run workers/ebay-prices --maxWorkers=2`.
  Expected: PASS.

- [ ] **Step 6: Commit, and deploy the eBay Worker.** The change is additive; `/v1/price` is
  unchanged.
  ```bash
  git add workers/ebay-prices
  git commit -m "feat(ebay): set-wide price search and quota endpoints"
  cd workers/ebay-prices && npx wrangler deploy
  ```
  Check: `curl -s -H 'X-Client: duel-binder' 'https://ygo-ebay-prices.project96.workers.dev/v1/quota'`
  returns a number.

### Task 4: Spike (throwaway gate)

**Files:**
- Create: `scripts/prices/sweep-spike.ts`. It is throwaway: no tests, and it is not imported
  anywhere. Delete it after the report, or keep it under `scripts/prices/` as a manual tool;
  decide at the report.

- [ ] **Step 1: Write the script.** It reads the local catalog read-only
  (`~/.config/duel-binder/collection.db`). For each of `CORI-JP` (recent booster), `LODT-JP` (an
  older booster), `RC04-JP` (Rarity Collection, many multi-rarity codes) and one Korean prefix
  (pick a recent `-KR` set from the catalog):
  - Call the deployed `/v1/set`.
  - Map the results onto that prefix's printings with the same rules Task 5 will use: a
    single-rarity code takes `all`, a multi-rarity code takes only `byRarity[rarity]`.
  - Call `/v1/price` for 15 random printings per set.
  - Print for each set:
    - calls used
    - printings in the set, and how many got a price
    - for the 15 printings, the sweep price next to the per-card price
    - every case where the sweep's price is more than 2× or less than 0.5× the per-card price

- [ ] **Step 2: Run it.** Run `npx tsx scripts/prices/sweep-spike.ts` and save the output.

- [ ] **Step 3: Gate. Report to the owner and stop.**
  - Coverage, and the 2× disagreements by rarity.
  - If rarity mix-ups are more than rare (more than about 1 in 20 priced multi-rarity printings),
    propose the fallback: the sweep prices single-rarity codes only.
  - Don't start Task 5 until the owner answers. Tune `RARITY_ALIASES` from what the spike shows,
    and redeploy if it changes.

### Task 5: Portal sweep queue and assignment

**Files:**
- Modify: `workers/portal/src/migrate.ts` (append `server-11`)
- Create: `workers/portal/src/sweep.ts`
- Modify: `workers/portal/src/prices.ts` (`runPriceAlarm` also runs the sweep; re-arm rules)
- Modify: `workers/portal/src/index.ts` (pass the sweep client into the alarm)
- Test: `tests/portal/sweep.test.ts`
- Test: `tests/portal/prices.test.ts`
- Test: `tests/portal/migrate.test.ts`

**Interfaces:**
- `server-11` SQL:
  - `CREATE TABLE price_sweeps (key TEXT NOT NULL, language TEXT NOT NULL, owned INTEGER NOT NULL DEFAULT 0, released TEXT, swept_at TEXT, calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, language)) WITHOUT ROWID;`
  - `CREATE INDEX ix_price_sweeps_due ON price_sweeps(owned DESC, swept_at, released DESC);`
  - `ALTER TABLE intl_prices ADD COLUMN price_seq INTEGER NOT NULL DEFAULT 0;`
  - `CREATE INDEX ix_intl_prices_seq ON intl_prices(price_seq);`
  - Triggers stamp `price_seq` from `catalog_clock`: `UPDATE catalog_clock SET seq = seq + 1` and
    then set `price_seq`, the same pattern as `server-6` triggers.
    - `trg_intl_prices_seq_ins`: after insert.
    - `trg_intl_prices_seq_upd`: after update, only `WHEN NEW.price IS NOT OLD.price OR NEW.listing_count IS NOT OLD.listing_count`.

    A checked_at-only refresh therefore never re-sends a row.
  - A backfill sets `price_seq` on existing rows: `catalog_clock` base + `row_number()`, as
    `server-6` does.
- Produces, in `sweep.ts`:
  - Constants: `SWEEP_DAILY_CALLS = 2000`, `SWEEP_RESERVE = 2000`, `SWEEP_BATCH = 10` (prefixes per
    alarm run), `SWEEP_LANGUAGES = ['ja','ko','zh-hans','zh-hant','ae']`.
  - `interface SweepClient { set(key: string, lang: string): Promise<SetResult>; quota(): Promise<{ remaining: number | null }> }`.
    - `SetResult` matches Task 3's `/v1/set` body.
    - It throws `SweepRateLimited` on 429.
  - `sweepClientFor(env: PriceEnv): SweepClient | null`, built like `priceClientFor`.
  - `refreshSweepQueue(db: SqlDb, now: Date): number`
    - Runs at most once a UTC day; meta `price_sweeps_listed_at`.
    - Reads distinct `(sweepKey(set_code), language)` for the Asian languages: one query per
      language, using `idx_printings_lang_set`.
    - Sets `owned` from a live `collection_entries` join (`ix_entries_printing_live`), and
      `released` from `MAX(sets.tcg_date)` by `set_name`.
    - Upserts without touching `swept_at`, and returns the number of rows upserted.
    - Put `sweepKey` in `src/shared/prices/sweepKey.ts` so the portal and tests share it; the
      Worker keeps its own JS copy. The test pins both against the same cases.
  - `assignSweep(db: SqlDb, key: string, language: string, result: SetResult, now: Date): { priced: number; skipped: number }`
    - Printings are `language = ? AND set_code LIKE key || '%'`, via `idx_printings_set_code`.
    - A code with one printing takes `result.codes[code].all`. A code with several printings takes
      `byRarity[set_rarity]` or nothing.
    - It writes only when the price is non-null and `listingCount >= 2`.
    - It skips a printing whose existing `checked_at` is after the prefix's previous `swept_at`;
      that row is a fresher per-card price.
    - It upserts `price, listing_count, checked_at = result.checkedAt`. When the price is
      unchanged, only `checked_at` moves, and the trigger does not fire.
    - It then sets `price_sweeps.swept_at = now` and adds the calls to `calls`.
  - `runSweep(db, client: SweepClient | null, now: Date): Promise<{ swept: number; calls: number; more: boolean }>`
    - Checks the day's calls (meta `sweep_calls_day` holding `YYYY-MM-DD:N`) against
      `SWEEP_DAILY_CALLS`.
    - Calls `client.quota()` once; if it returns non-null `remaining <= SWEEP_RESERVE`, it stops.
    - Takes up to `SWEEP_BATCH` due prefixes: `swept_at IS NULL OR swept_at < now - 7d`, in index
      order.
    - Runs `client.set` then `assignSweep` for each, one at a time.
    - On `SweepRateLimited`, it sets the day's count to the cap and stops.
    - `more` is true when due prefixes and budget remain.
  - `runPriceAlarm` (prices.ts) gains a `sweep: SweepClient | null` parameter. After
    `refreshIntlPrices` it calls `refreshSweepQueue`, then `runSweep`. A run with
    `sweep.more && sweep.swept > 0` re-arms at `PRICE_MORE_MS` (the shortest wins).

- [ ] **Step 1: Write the failing tests** in `tests/portal/sweep.test.ts`, using `tests/portal/helpers.ts`
  to get a migrated server DB. Seed `CORI-JP001` UR and SE, `CORI-JP002` Common only, a German
  printing, an owned `LODT-JP005`, and `sets.tcg_date` values.
  - `refreshSweepQueue lists Asian prefixes once a day, owned first`:
    - It contains `CORI-JP|ja` and `LODT-JP|ja` with `owned` 1, and no German row.
    - A second call on the same day returns 0.
  - `assignSweep prices only the named rarity`:
    - `byRarity` has only Ultra Rare.
    - JP001 UR is priced, JP001 SE has no row, and JP002 (single rarity) takes `all`.
  - `assignSweep keeps a per-card price newer than the last sweep`: a JP002 row with
    `checked_at` after the previous `swept_at` is unchanged.
  - `assignSweep never erases`: an empty result leaves the existing rows.
  - `unchanged price does not bump price_seq`, and `a changed price does`.
  - `runSweep stops at the reserve`: with quota `remaining` 1500, nothing is swept.
  - `runSweep stops for the day on 429`: the next call on the same day sweeps 0.
  - `runSweep respects the daily cap`.
  - In `migrate.test.ts`: `server-11 backfills price_seq` (existing rows have distinct nonzero
    seqs).

- [ ] **Step 2: Run the tests to confirm they fail.** Run `npx vitest run tests/portal/sweep.test.ts --maxWorkers=2`.
  Expected: FAIL.

- [ ] **Step 3: Implement `server-11`, `sweep.ts` and the alarm wiring.** Then extend
  `tests/portal/prices.test.ts` with `alarm re-arms in 60 s while the sweep has work`.

- [ ] **Step 4: Run the tests to confirm they pass.**
  - Run `npx vitest run tests/portal --maxWorkers=2`, then `npm test` in `workers/portal` (which
    covers real Durable Object SQLite, e.g. the compound-query limit), then `npm run typecheck`.
  - Expected: all PASS.

- [ ] **Step 5: Commit.**
  ```bash
  git add workers/portal/src/migrate.ts workers/portal/src/sweep.ts workers/portal/src/prices.ts workers/portal/src/index.ts src/shared/prices/sweepKey.ts tests/portal/sweep.test.ts tests/portal/prices.test.ts tests/portal/migrate.test.ts
  git commit -m "feat(portal): weekly eBay set sweep for Asian printings"
  ```

### Task 6: Price change feed to desktop and phone

**Files:**
- Modify: `src/shared/cloud.ts` (wire types)
- Modify: `workers/portal/src/sync.ts` (route + `priceChanges`)
- Modify: `src/main/cloud/client.ts` (`priceChanges` method)
- Modify: `src/main/cloud/localSync.ts` (`pullPriceChanges`)
- Modify: `src/main/cloud/engine.ts:193-199` (call it in step 3)
- Test: `tests/portal/sync.test.ts`
- Test: `tests/main/price-feed.test.ts`
- Check: the phone path (`src/phone/data/store.ts`). It uses the same engine `syncOnce`, so it
  should need no change; confirm that its client implements `CloudClient`, and add the method
  there if it has its own.

**Interfaces:**
- `interface PriceChange extends WirePrice { seq: number }`
- `interface PriceChangesResponse { prices: PriceChange[]; cursor: number; more: boolean }`
- `MAX_PRICE_CHANGES = 2000`, in `src/shared/cloud.ts`.
- Portal: `priceChanges(db: SqlDb, since: number, limit = MAX_PRICE_CHANGES): PriceChangesResponse`.
  - It does `WHERE ip.price_seq > ? ORDER BY ip.price_seq LIMIT limit+1`, joined to
    `card_printings` for `pkey`.
  - Route: `GET /api/sync/price-changes?since=N`, authenticated like the other `/api/sync/*`
    routes.
- Desktop client: `priceChanges(since: number): Promise<PriceChangesResponse>`.
- `pullPriceChanges(db: SqlDb, client: Pick<CloudClient, 'priceChanges'>): Promise<number>`
  - It loops pages from meta `price_feed_cursor` (default 0).
  - It applies each page with the existing `applyPrices`, which already skips unknown pkeys and
    older rows.
  - It saves the cursor in the same transaction as the page.
  - It returns the rows applied.
- In `engine.ts` step 3, call `pullPriceChanges` before the existing `client.prices(...)` call
  (kept for status and stale owned rows). Set `changed` when the result is above 0.

- [ ] **Step 1: Write the failing tests.**
  - `sync.test.ts`: `price-changes pages by seq`. Seed 3 rows; `limit` 2 gives 2 rows and
    `more: true`; `since=cursor` gives 1 row and `more: false`.
  - `sync.test.ts`: `price-changes needs a session` (401).
  - `price-feed.test.ts`: `pullPriceChanges pages to the end and skips unknown pkeys`. A fake
    client serves 3 pages, one row with an unknown pkey. The known rows land in `intl_prices`, and
    `price_feed_cursor` equals the last cursor.
  - `price-feed.test.ts`: `resumes from the saved cursor` (the second call asks `since` = saved).

- [ ] **Step 2: Run the tests to confirm they fail.** Run
  `npx vitest run tests/portal/sync.test.ts tests/main/price-feed.test.ts --maxWorkers=2`.
  Expected: FAIL.

- [ ] **Step 3: Implement the wire types, portal function and route, client method,
  `pullPriceChanges` and the engine call.**

- [ ] **Step 4: Run all checks.** Run `npm test` and `npm run typecheck`, and `npm test` in
  `workers/portal`. Expected: PASS.

- [ ] **Step 5: Commit.**
  ```bash
  git add src/shared/cloud.ts workers/portal/src/sync.ts src/main/cloud tests/portal/sync.test.ts tests/main/price-feed.test.ts
  git commit -m "feat(sync): pull every server price as a delta feed"
  ```

### Task 7: Sweep numbers on the admin dashboard

**Files:**
- Modify: `workers/portal/src/stats.ts` (add `sweep` to the stats)
- Modify: `workers/portal/src/adminPage.ts:110-113` ("Scanner and prices" panel)
- Test: `tests/portal/admin-stats.test.ts`

**Interfaces:**
- `stats.sweep: { callsToday: number; sweptLast7d: number; prefixes: number }`.
  - `callsToday` is read from meta `sweep_calls_day`, as 0 when that is for another day.
  - The other two are counts on `price_sweeps`.

- [ ] **Step 1: Write the failing test.** `stats include sweep counts` seeds `price_sweeps` and the
  meta value, then asserts the three numbers.
- [ ] **Step 2: Run it to confirm it fails.** Run `npx vitest run tests/portal/admin-stats.test.ts --maxWorkers=2`.
  Expected: FAIL.
- [ ] **Step 3: Implement it.** Add the panel rows `eBay sweep calls today`, `Sets swept in 7 days`
  and `Sets in sweep queue`.
- [ ] **Step 4: Run the test to confirm it passes.** Run the same command, and pin the
  `stats.ts` reference count in `tests/main/tombstones.test.ts` only if it changes. Expected:
  PASS.
- [ ] **Step 5: Commit.**
  ```bash
  git add workers/portal/src/stats.ts workers/portal/src/adminPage.ts tests/portal/admin-stats.test.ts
  git commit -m "feat(admin): show eBay sweep progress"
  ```

### Task 8: Ship

- [ ] **Step 1: Push and open the PR.** Push the branch, open a PR to `main` and watch CI with
  `sai_watch_github_run`. Merge once it is green.
- [ ] **Step 2: Deploy the portal.** Run `npm run deploy` in `workers/portal`. `server-11` runs on
  the first request.
  - Check `/admin/stats` shows the sweep panel.
  - Over the next hour, `Sets swept in 7 days` rises and `eBay sweep calls today` stays at or
    below 2000.
- [ ] **Step 3: Release the desktop app.** Bump with `npm version minor --no-git-tag-version`,
  commit `chore: release X`, tag `vX` and push the tag, then watch `release.yml`.
- [ ] **Step 4: Update memory.** Add a pointer to `MEMORY.md` for this work (what shipped, and
  watching the eBay quota).
