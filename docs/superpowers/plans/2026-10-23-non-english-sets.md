# Non-English Sets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record non-English copies as printings of their own regional sets (set lists from Yugipedia), track those sets on the Sets page behind a language filter that defaults to English, and price owned non-English copies from eBay asking prices through a Cloudflare Worker.

**Architecture:**
- Every printing and set gets a `language`. English rows stay owned by the YGOPRODeck sync. Non-English rows are owned by a new weekly background Yugipedia sync, which matches list rows to cards by English name.
- Schema v3 rebuilds `card_printings` and `sets` so each set's identity is (name, language), and adds an `intl_prices` table.
- A small Worker in `workers/ebay-prices/` holds the eBay key and returns a computed asking price. Main asks it for owned non-English printings only.
- Main tells the renderer to refetch through a new `data:changed` event after any background change.

**Tech Stack:** Electron, React 19 + TypeScript, Tailwind v4 + shadcn/ui, TanStack Query, better-sqlite3, Vitest + Testing Library (existing). Cloudflare Workers (plain JS ES module, `wrangler`) for the price Worker.

**Spec:** `docs/superpowers/specs/2026-10-23-non-english-sets-design.md`

## Global Constraints

- **Tests:** run `npm test` (it already passes `--maxWorkers=2`); a single file is `npm test -- <path>`. Never add a second `--maxWorkers`. Every task ends green on `npm test`, `npm run typecheck` and `npm run lint`.
- **IPC:** all data access lives in main behind typed IPC (`src/shared/ipc.ts` `Api` + `INVOKE_CHANNELS`). The renderer has no network access and loads images only through `ygo-img://`.
- **Migrations:** schema changes are migration `{ version: 3 }` appended to `MIGRATIONS`. Never edit `SCHEMA_V1` or `SCHEMA_V2`. Existing rows become `language = 'en'`, and existing printing ids and entry ids are kept.
- **Languages:** exactly the table in Task 1. English (`'en'`) is only ever written by the YGOPRODeck sync. Every other language is only ever written by the Yugipedia sync. Neither sync may delete, flag or modify the other's rows.
- **Set names:** a set shows its English name plus the language tag, never a localized name. Asian-English (`'ae'`) is its own language, not English.
- **Language filter:** defaults to English and offers "All" plus languages that have data. One shared setting, localStorage key `language.filter`, value a language code or `'all'`. It is used by the Sets page, the Add Card printing step, and the Collection page.
- **Yugipedia:**
  - API base `https://yugipedia.com/api.php`.
  - Every request sends `User-Agent: YugiohCollectionTracker/<app version> (https://github.com/darkharasho/yugioh-collection-tracker)` and `maxlag=5`.
  - Requests are sequential with at least 500 ms between them. Retries on network error, HTTP 429/5xx or a `maxlag` error: 3 retries, waiting 2 s, 4 s, 8 s, or `Retry-After` when larger.
  - At most 50 titles per content request.
- **Refresh intervals:** the Yugipedia set sync runs at most every 7 days (meta key `intl_sets_synced_at`, stamped only after a run with zero failures). eBay prices refresh at most every 7 days per printing.
- **Set images:** fetched only from `https://images.ygoprodeck.com/images/sets/…` (existing) or `https://ms.yugipedia.com/…` (new).
- **eBay credentials:**
  - They appear only as Worker secrets `EBAY_APP_ID` / `EBAY_CERT_ID`.
  - They never appear in the repo, the app, logs or error text.
  - The app knows only the Worker URL: `src/main/prices/config.ts` `PRICE_WORKER_URL`, overridable by the env var `YGO_PRICE_WORKER_URL`.
- **Price labels:** a non-English copy's price is labelled "eBay asking price" with its checked date. It never falls back to the English (`priceFor` / TCGplayer) price. With no price, it counts $0 and shows a "no price" marker.
- **Approval:** nothing is pushed, deployed, or set as a Cloudflare secret without asking the owner (Task 11).
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Add-missing from a Japanese set while the language filter is English.** The Add Card dialog opens on that Japanese printing, shown and highlighted, not filtered away. Pinned in Task 10.
2. **The same card and rarity in two codeless Japanese sets** (e.g. Dark Magician UR in *Vol.1* and in another code-less set). Both printings exist, and each fills only its own set's slot. Pinned in Tasks 1 and 4.
3. **A YGOPRODeck sync after Yugipedia data exists.** Non-English printings, their entries and their prices survive untouched, and are never flagged `missing_from_api`. Pinned in Task 1.
4. **Yugipedia failing midway** (one content batch returns 503 after retries, or one page has no `{{Set list`). Every other set updates, the failed sets keep their old rows, the stamp is not written, and the next launch runs again. Pinned in Task 4.
5. **An owned non-English printing that disappears from Yugipedia.** The entry stays, the printing is flagged missing (hidden from Add Card, still counted in its set), and nothing throws. Pinned in Task 4.

---

## File Structure

```
src/shared/languages.ts                 Language, LANGUAGES, languageTag, isLanguage, LanguageFilter (pure)
src/shared/types.ts                     + language on Printing/SetSummary; price fields on EntryView; CollectionFilters.language; Facets.languages
src/shared/ipc.ts                       sets:checklist/adjust take language; + DATA_CHANGED event, api.app.onDataChanged
src/main/db/database.ts                 migration v3 (rebuild card_printings + sets, intl_prices); foreign-keys-off migration support
src/main/sync/sync.ts                   English-only upsert conflict target and prune
src/main/sync/sets.ts                   refreshSets touches English set rows only
src/main/yugipedia/parse.ts             parseSetList, parseInfobox, parseReleaseDate, listTitleParts (pure)
src/main/yugipedia/client.ts            createYugipediaClient: listSetListTitles, fetchPages, fetchImageUrls
src/main/sync/intl.ts                   refreshIntlSets, shouldRefreshIntl, normalizeName
src/main/images/cache.ts                + Yugipedia set images (yp- keys via resolver)
src/main/repo/sets.ts                   language-aware listSets/getChecklist/adjustPrinting; unmatched counts
src/main/repo/collection.ts             language filter; non-English pricing from intl_prices
src/main/prices/config.ts               PRICE_WORKER_URL
src/main/prices/client.ts               createPriceClient (talks to the Worker)
src/main/prices/refresh.ts              refreshIntlPrices, stale-printing selection
src/main/ipc/handlers.ts                new signatures; price refresh after mutations
src/main/index.ts                       startup chain: YGOPRODeck sync → Yugipedia sync → price refresh; DATA_CHANGED broadcasts
src/renderer/src/lib/languageFilter.ts  useLanguageFilter (localStorage `language.filter`)
src/renderer/src/components/LanguageTag.tsx, LanguageSelect.tsx
src/renderer/src/features/sets/*        language filter, tags, (name, language) set identity, unmatched note
src/renderer/src/features/add-card/AddCardDialog.tsx   language filter + tags on printing step
src/renderer/src/features/collection/*  language filter, tags, eBay price display
src/renderer/src/features/settings/SettingsPage.tsx    Yugipedia credit line
workers/ebay-prices/                    Worker source, tests, wrangler.toml, README
```

---

### Task 1: Languages, schema v3, sync boundaries

**Files:**
- Create: `src/shared/languages.ts`, `tests/main/languages.test.ts`
- Modify: `src/main/db/database.ts`, `src/shared/types.ts` (`Printing`), `src/main/repo/cards.ts` (`PrintingDbRow`, `rowToPrinting`), `src/main/sync/sync.ts` (upsert + prune), `src/main/sync/sets.ts` (`refreshSets`), `tests/main/database.test.ts`, `tests/main/sync.test.ts`, `tests/main/sets-sync.test.ts`, and any test or renderer fixture that builds a `Printing` (add `language: 'en'`)

**Interfaces:**
- Produces:
  ```ts
  // src/shared/languages.ts
  export type Language = 'en' | 'ja' | 'ko' | 'de' | 'fr' | 'it' | 'es' | 'pt' | 'zh-hans' | 'zh-hant' | 'ae' | 'ja-asia'
  export interface LanguageInfo { code: Language; tag: string; label: string; yugipediaSuffix: string | null; ebayWord: string }
  export const LANGUAGES: readonly LanguageInfo[]
  export type LanguageFilter = Language | 'all'
  export function isLanguage(v: unknown): v is Language
  export function languageInfo(code: Language): LanguageInfo
  export function languageForSuffix(suffix: string): Language | null   // 'OCG-JP' -> 'ja'; 'TCG-EN' -> null
  ```
- `Printing` gains `language: Language`. The `card_printings` and `sets` tables gain a `language` column.

| code | tag | label | yugipediaSuffix | ebayWord |
|---|---|---|---|---|
| en | EN | English | null | English |
| ja | JP | Japanese | OCG-JP | Japanese |
| ko | KR | Korean | OCG-KR | Korean |
| de | DE | German | TCG-DE | German |
| fr | FR | French | TCG-FR | French |
| it | IT | Italian | TCG-IT | Italian |
| es | ES | Spanish | TCG-SP | Spanish |
| pt | PT | Portuguese | TCG-PT | Portuguese |
| zh-hans | SC | Simplified Chinese | OCG-SC | Chinese |
| zh-hant | TC | Traditional Chinese | OCG-TC | Chinese |
| ae | AE | Asian-English | OCG-AE | Asian English |
| ja-asia | JA | Japanese-Asian | OCG-JA | Japanese Asian |

`LANGUAGES` is in this order, and the order is used everywhere languages are listed.

**Schema v3.** `card_printings` must be rebuilt, because its inline `UNIQUE(card_id, set_code, set_rarity)` can't be dropped. `collection_entries` references it, so the rebuild runs with foreign keys off.
- Extend `Migration` with an optional `foreignKeysOff?: true`. `migrate()` then:
  1. runs `PRAGMA foreign_keys = OFF` before the transaction;
  2. inside the transaction, runs the SQL, then `PRAGMA foreign_key_check`, throwing if it returns any row;
  3. restores the previous `foreign_keys` value in a `finally`.
- v3 SQL:
  - `card_printings_new` has the same columns plus `language TEXT NOT NULL DEFAULT 'en'`. Copy all rows with their ids, drop the old table, rename the new one.
  - Recreate `idx_printings_set_code` and `idx_printings_set_name`.
  - Add the partial unique indexes `ux_printings_en ON card_printings(card_id, set_code, set_rarity) WHERE language = 'en'` and `ux_printings_intl ON card_printings(card_id, language, set_name, set_code, set_rarity) WHERE language <> 'en'`.
  - Rebuild `sets` as `(language TEXT NOT NULL DEFAULT 'en', set_name TEXT NOT NULL, set_code TEXT NOT NULL, tcg_date TEXT, image_url TEXT, image_key TEXT, list_rows INTEGER, unmatched_rows INTEGER, PRIMARY KEY (language, set_name))`, copying existing rows as `'en'`.
  - Create `intl_prices (printing_id INTEGER PRIMARY KEY REFERENCES card_printings(id) ON DELETE CASCADE, price REAL, listing_count INTEGER NOT NULL, checked_at TEXT NOT NULL)`.
- `tcg_date` keeps its name and now means "release date in this set's region".

**Sync boundaries:**
- `saveCards`' upsert becomes `INSERT … (…, language) VALUES (…, 'en') ON CONFLICT(card_id, set_code, set_rarity) WHERE language = 'en' DO UPDATE …`.
- `prune` for `card_printings` only considers rows `WHERE language = 'en'`.
- `refreshSets` deletes and inserts only `language = 'en'` set rows.
- `src/main/dev/fakeData.ts` picks English printings only: add `AND language = 'en'` to its printing queries. Otherwise the Japanese LOB, which shares the name, would leak into the seeded English set.

- [ ] **Step 1: Write the failing tests**
  - `languages.test.ts`:
    - `languageForSuffix('OCG-JP') === 'ja'`, `'TCG-SP' → 'es'`, `'TCG-EN' → null`, `'XYZ' → null`
    - `isLanguage('ja-asia')` is true and `isLanguage('jp')` is false
    - `LANGUAGES[0].code === 'en'`, and the codes are unique
  - `database.test.ts`:
    - `migrate sets user_version 3 and is idempotent`.
    - `migrates a v2 database with an entry to v3 keeping ids`: build a v2 db by running `SCHEMA_V1`, then the v2 SQL (export `SCHEMA_V2`), with `user_version = 2`; insert a card, printing id 7, image and entry. After `migrate`, the printing id is 7 with language `'en'`, the entry still references it, `foreign_keys` is back to 1, and `PRAGMA foreign_key_check` is empty.
    - `allows the same card, rarity and empty code in two non-English sets`: two `language='ja'` rows with `set_code=''`, rarity `'Ultra Rare'`, and set names `'Vol.1'` and `'Vol.2'` both insert, but a duplicate of the first throws.
  - `sync.test.ts`, `keeps non-English printings across a YGOPRODeck sync`:
    1. Seed via `seededDb()`.
    2. Insert a `language='ja'` printing of Dark Magician (`'LB-05'`, `'Legend of Blue Eyes White Dragon'`, `'Ultra Rare'`), an entry for it, and an `intl_prices` row.
    3. Run `runSync` again with the same fixture.
    4. The printing has `missing_from_api = 0`, and the entry and the price row exist.
    5. With an entry-less `ja` printing, the second sync doesn't delete it either.
  - `sets-sync.test.ts`, `refreshSets leaves non-English set rows alone`: a `('ja','X',…)` row survives a successful `refreshSets`.
- [ ] **Step 2: Run them; they fail.** Run `npm test -- tests/main/languages.test.ts tests/main/database.test.ts tests/main/sync.test.ts tests/main/sets-sync.test.ts`.
- [ ] **Step 3: Implement** the languages module, the migration support and v3, and the sync boundaries. Add `language` to `Printing`/`PrintingDbRow`/`rowToPrinting`, using `isLanguage(row.language) ? row.language : 'en'`.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`. All are green, and existing tests are updated only to add `language: 'en'` where they build printings.
- [ ] **Step 5: Commit:** `feat(intl): languages and schema v3 with per-language printings and sets`.

---

### Task 2: Yugipedia wikitext parsers

**Files:**
- Create: `src/main/yugipedia/parse.ts`, `tests/main/yugipedia-parse.test.ts`, `tests/fixtures/yugipedia/*.wikitext`

**Interfaces:**
- Produces:
  ```ts
  export interface SetListRow { code: string; name: string; rarities: string[] }   // code '' when the list has no codes
  export interface ParsedSetList { setPage: string | null; rows: SetListRow[] }    // setPage from {{Set page header|set=…}}
  export function parseSetList(wikitext: string): ParsedSetList | null             // null when no {{Set list template
  export function listTitleParts(title: string): { setName: string; suffix: string } | null
  //   'Set Card Lists:Legend of Blue Eyes White Dragon (OCG-JP)' -> { setName: 'Legend of Blue Eyes White Dragon', suffix: 'OCG-JP' }
  export interface Infobox { image: string | null; dates: Record<string, string> }  // dates: raw field name -> 'YYYY-MM-DD'
  export function parseInfobox(wikitext: string): Infobox | null
  export function releaseDateFor(box: Infobox, language: Language): string | null
  export function parseReleaseDate(raw: string): string | null                      // 'May 18, 2000' -> '2000-05-18'
  export function normalizeRarity(raw: string): string
  ```

**Parsing rules:**
- A `{{Set list|…|` template opens with named parameters, separated by `|`, up to the last `|` on the opening line. Rows are the following lines up to the closing `}}`. A page may hold several templates, and their rows are concatenated.
- `options=noabbr` means rows have no code column, so a row is `name[; rarities]`. Otherwise a row is `code; name[; rarities[; …ignored]]`.
- Rarities are split on `,` and trimmed. An empty list falls back to the template's `rarities=` value, and if that is empty too, to `['Common']`.
- Rows are trimmed. Blank lines and lines starting with `<!--` are skipped, and any `//` comment suffix is dropped from the name.
- `normalizeRarity` expands these abbreviations, case-sensitively, and returns anything else unchanged:

  | Abbreviation | Rarity |
  |---|---|
  | C | Common |
  | R | Rare |
  | SR | Super Rare |
  | UR | Ultra Rare |
  | ScR | Secret Rare |
  | UtR | Ultimate Rare |
  | GR | Ghost Rare |
  | HFR | Holofoil Rare |
  | PScR | Prismatic Secret Rare |
  | QCScR | Quarter Century Secret Rare |
  | CR | Collector's Rare |
  | SPR | Short Print |
  | SSP | Super Short Print |
  | NR | Normal Rare |
  | GUR | Gold Rare |
  | PlR | Platinum Rare |
  | StR | Starlight Rare |
  | 10000ScR | 10000 Secret Rare |
- `releaseDateFor` tries the fields in order and returns the first that parses:

  | Language | Fields |
  |---|---|
  | ja | `jp_release_date` |
  | ko | `kr_release_date` |
  | de, fr, it, es | `<x>_release_date` (de, fr, it, sp), then the combined `fr/de/it/sp_release_date`, then `eu_release_date` |
  | pt | `pt_release_date`, then `eu_release_date` |
  | zh-hans | `sc_release_date` |
  | zh-hant | `tc_release_date` |
  | ae | `ae_release_date` |
  | ja-asia | `ja_release_date` |
  | en | null |
- The infobox `image` value is the bare file name (`LB-BoosterJP.jpg`), or null when it's empty.

- [ ] **Step 1: Save fixtures.** Fetch the raw wikitext of these pages into `tests/fixtures/yugipedia/` with the Global Constraints User-Agent, one file per page, named by slug: `Set Card Lists:Legend of Blue Eyes White Dragon (OCG-JP)`, `Set Card Lists:Legend of Blue Eyes White Dragon (TCG-DE)`, `Set Card Lists:Phantom Nightmare (OCG-KR)`, `Set Card Lists:Vol.1 (OCG-JP)`, `Legend of Blue Eyes White Dragon (Japanese)`, `Phantom Nightmare`. Use `action=query&prop=revisions&rvprop=content&rvslots=main&format=json&titles=…`.
- [ ] **Step 2: Write the failing tests.**
  - LB JP:
    - 61 rows, setPage `'Legend of Blue Eyes White Dragon (Japanese)'`
    - row 0 is `{ code: 'LB-00', name: 'Celtic Guardian', rarities: ['Secret Rare'] }`
    - the `LB-05` row is Dark Magician `['Ultra Rare']`
  - DE LOB: 103 rows, `rows[3]` is `LOB-G003` Dark Magician, setPage null.
  - KR PHNI:
    - the `PHNI-KR002` Geistgrinder Golem row has `rarities: ['Common']` (from `rarities=`)
    - the `PHNI-KR001` row has `['Super Rare','Secret Rare','Quarter Century Secret Rare']`
  - Vol.1: every row has `code: ''`, `'Hitotsu-Me Giant'` is `['Common']`, `'Dark Magician'` is `['Ultra Rare']`, and setPage is `'Vol.1'`.
  - `parseSetList('no template')` is null.
  - Inline string cases: an `SR` abbreviation becomes `'Super Rare'`, a `<!-- x -->` line is skipped, and two templates concatenate.
  - Titles: `listTitleParts` on the LB JP title gives the expected parts, and on `'Foo'` gives null.
  - Infobox:
    - on `Legend of Blue Eyes White Dragon (Japanese)`: image `'LB-BoosterJP.jpg'`, and `releaseDateFor(box,'ja') === '2000-05-18'`
    - on `Phantom Nightmare`: `releaseDateFor(box,'ko') === '2023-12-02'`, `releaseDateFor(box,'de') === '2024-02-08'`, `releaseDateFor(box,'pt') === '2024-02-08'`, `releaseDateFor(box,'zh-hant') === null`
  - `parseReleaseDate('garbage')` is null.
- [ ] **Step 3: Run; they fail.** Run `npm test -- tests/main/yugipedia-parse.test.ts`.
- [ ] **Step 4: Implement `parse.ts`** as pure functions with no imports beyond `@shared/languages`.
- [ ] **Step 5: Run green** on all three checks.
- [ ] **Step 6: Commit:** `feat(intl): Yugipedia set list and infobox parsers`.

---

### Task 3: Yugipedia HTTP client

**Files:**
- Create: `src/main/yugipedia/client.ts`, `tests/main/yugipedia-client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class YugipediaError extends Error {}
  export interface YugipediaClient {
    /** Every title in namespace 3006 (follows apcontinue). */
    listSetListTitles(): Promise<string[]>
    /** Wikitext by requested title (redirects followed; missing pages absent). Chunks of 50. */
    fetchPages(titles: string[]): Promise<Map<string, string>>
    /** File name (no "File:") -> URL, only for URLs starting with https://ms.yugipedia.com/. Chunks of 50. */
    fetchImageUrls(files: string[]): Promise<Map<string, string>>
  }
  export function createYugipediaClient(opts: {
    version: string
    fetchFn?: typeof fetch
    sleep?: (ms: number) => Promise<void>
    now?: () => number
  }): YugipediaClient
  ```
- **Requests:**
  - every request uses `format=json&formatversion=2&maxlag=5` and the User-Agent from Global Constraints
  - `fetchPages` uses `action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1`
  - `fetchImageUrls` uses `prop=imageinfo&iiprop=url` on `File:<name>`
- **Title mapping:** `fetchPages` maps each result back to the title the caller asked for, using the response's `normalized` and `redirects` arrays.
- **Errors:**
  - A chunk that still fails after retries throws `YugipediaError` (message: HTTP status or `maxlag`, nothing else).
  - The caller decides what that chunk's failure means. `fetchPages` throws for the whole call, so callers pass one chunk at a time when they want per-chunk failure isolation (Task 4 does).
- **Pacing:** waits at least 500 ms between request starts (Global Constraints), using the injected `sleep`/`now`.

- [ ] **Step 1: Write failing tests** with a fake `fetchFn` recording URLs and headers, a no-op `sleep` recording waits, and a fake clock.
  - `follows apcontinue`: two pages of `allpages`, and the result is the concatenation.
  - `sends the User-Agent and maxlag`.
  - `fetchPages chunks at 50 and maps normalized/redirected titles back`: 120 titles make 3 requests, and a `normalized` `{from:'A_b',to:'A b'}` result is returned under `'A_b'`.
  - `retries 503 then succeeds; waits 2s,4s`.
  - `honours Retry-After when larger`.
  - `throws YugipediaError after 3 retries`, with no credentials or URL query in the message.
  - `paces requests at ≥500 ms`.
  - `fetchImageUrls drops non-ms.yugipedia.com URLs`.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green** on all three checks.
- [ ] **Step 5: Commit:** `feat(intl): Yugipedia API client with pacing and retries`.

---

### Task 4: Non-English set sync and startup wiring

**Files:**
- Create: `src/main/sync/intl.ts`, `tests/main/intl-sync.test.ts`
- Modify: `src/main/index.ts`, `src/shared/ipc.ts` (`DATA_CHANGED`, `api.app.onDataChanged`), `src/preload/index.ts`, `src/renderer/src/components/useSyncStatus.ts` (or a new `useDataChanged` hook mounted in `App.tsx`), `tests/renderer/mockApi.ts`

**Interfaces:**
- Consumes: Task 2 parsers, Task 3 `YugipediaClient`, Task 1 `languageForSuffix`.
- Produces:
  ```ts
  export const INTL_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
  export function shouldRefreshIntl(db: Database.Database, now: Date): boolean  // meta intl_sets_synced_at absent/unparseable/older than 7 days
  export function normalizeName(name: string): string
  export interface IntlSyncResult { sets: number; failedSets: number; unmatchedRows: number; ok: boolean }
  /** Never rejects. */
  export function refreshIntlSets(db: Database.Database, client: YugipediaClient, now?: Date): Promise<IntlSyncResult>
  // src/shared/ipc.ts
  export const DATA_CHANGED = 'data:changed'   // payload: void
  // Api.app.onDataChanged(cb: () => void): () => void
  ```

**`normalizeName`:**
1. NFKC
2. lowercase
3. turn `‘’´` into `'` and `“”` into `"`
4. turn `‐‑‒–—−` into `-`
5. collapse whitespace and trim

**`refreshIntlSets` algorithm:**
1. `listSetListTitles()`. If it throws, return `{ ok: false, … }` with nothing written.
2. Keep titles whose `listTitleParts(...).suffix` maps to a language via `languageForSuffix`.
3. Build `Map<normalizeName(card.name), cardId>` from `cards`. If two cards normalize equally, keep the lowest id.
4. Fetch list pages in chunks of 50 (one `fetchPages` call per chunk). A failed chunk adds its set count to `failedSets`.
5. For each parsed list (`parseSetList` returning null also counts as a failed set):
   - `setName` and `language` come from the title.
   - Matched rows produce one printing per rarity: `card_id, language, set_name, set_code = row.code, set_rarity = normalizeRarity(r), set_rarity_code = '', set_price = null, missing_from_api = 0`.
   - Unmatched rows are counted. At most 20 example names per run are logged with `console.info`.
6. Fetch each list's set page (`setPage ?? setName`) in chunks of 50. A failure here doesn't fail the set: it just has no date or image. Then `fetchImageUrls` for the infobox images.
7. Write each set in its own transaction:
   - Upsert its printings on the `ux_printings_intl` key. On conflict set `missing_from_api = 0`.
   - Rows of that (language, set_name) not seen this run are deleted when no entry references them, else flagged `missing_from_api = 1`.
   - Upsert the `sets` row: `set_code = ''`, `tcg_date = releaseDateFor`, `image_url`, `image_key = yugipediaImageKey(url)` (Task 5; write `null` until Task 5 lands), `list_rows`, `unmatched_rows`.
8. If and only if `failedSets === 0`:
   - Apply the same delete-or-flag rule to non-English printings of sets not seen this run, and delete their `sets` rows.
   - Set meta `intl_sets_synced_at = now.toISOString()`.

**Startup (`index.ts`), all in the background, after the window opens:**
1. Run `runSync` if due; otherwise run `refreshSets` if there are no English sets.
2. Then, if `shouldRefreshIntl` and the `cards` table is non-empty, run `refreshIntlSets`.
3. Then broadcast `DATA_CHANGED`. Also broadcast it after a successful background `refreshSets`; this fixes the earlier race where the Sets page didn't refresh.
4. Use `createYugipediaClient({ version: app.getVersion() })`.

**Renderer:** on `DATA_CHANGED`, invalidate every prefix in `mutationInvalidationKeys`.

- [ ] **Step 1: Write failing tests** (`intl-sync.test.ts`, using `seededDb()` and a fake `YugipediaClient` built from inline wikitext that names the fixture cards *Dark Magician* and *Pot of Greed*):
  - `imports a Japanese set as its own set`:
    - list `Set Card Lists:Legend of Blue Eyes White Dragon (OCG-JP)` with `LB-05; Dark Magician; Ultra Rare` and `LB-99; Not A Card; Common`
    - one `ja` printing, `list_rows = 2`, `unmatched_rows = 1`, `tcg_date` from the infobox
    - the English LOB printings are unchanged
    - the stamp is set
  - `one row with several rarities makes one printing per rarity`.
  - `codeless sets don't collide`: two `noabbr` lists, *Vol.1* and *Vol.2*, each with `Dark Magician; Ultra Rare`, give two printings.
  - `matches names despite case, curly quotes and dashes`: `"Pot Of Greed"` and a `’`-variant both match.
  - `skips English and unknown suffixes`: `(TCG-EN)` and `(TCG-NA)` titles are never fetched.
  - `a failed chunk keeps that chunk's old rows and does not stamp`:
    1. Run 1 succeeds.
    2. Run 2's second chunk throws `YugipediaError`, and its first chunk changes a rarity.
    3. The first chunk's change applied, the second chunk's sets are untouched, `intl_sets_synced_at` is unchanged, and `ok === false`.
  - `a page without {{Set list counts as failed and keeps old rows`.
  - `listing failure writes nothing`.
  - `an owned printing removed upstream is flagged, an unowned one deleted`.
  - `a set gone upstream is removed only after a clean run`.
  - `shouldRefreshIntl`: true when unset, false 6 days after, true 7 days after.
  - Renderer: in an existing App/shell test, firing the mock `onDataChanged` callback invalidates the `['sets']` queries. Assert `sets.list` is called again.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement** `intl.ts`, the event channel, preload, renderer hook and startup chain.
- [ ] **Step 4: Run green** on all three checks.
- [ ] **Step 5: Commit:** `feat(intl): weekly Yugipedia set sync and data-changed refresh`.

---

### Task 5: Yugipedia set images

**Files:**
- Modify: `src/main/images/cache.ts`, `src/main/sync/intl.ts` (write `image_key`), `src/main/index.ts` (pass resolver), `tests/main/images.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** 'yp-' + first 20 hex chars of sha1(url); null unless url starts with https://ms.yugipedia.com/ */
  export function yugipediaImageKey(url: string | null): string | null
  // createImageCache opts gain: resolveSetImage?: (key: string) => string | null
  ```
- **How `getSet` handles keys:**
  - For a key starting with `yp-`, it calls `resolveSetImage(key)`. It downloads only when the result starts with `https://ms.yugipedia.com/`, and saves to `images/sets/<key>.jpg`.
  - Yugipedia downloads send the Global Constraints User-Agent.
  - Other keys behave as today.
- `index.ts` passes `resolveSetImage: (key) => (db.prepare('SELECT image_url FROM sets WHERE image_key = ?').get(key) as …)?.image_url ?? null`.
- `parseSetImageUrl` already accepts `yp-…` (the charset is `[A-Za-z0-9_-]`).

- [ ] **Step 1: Write failing tests:**
  - `yugipediaImageKey` is stable, 23 chars, and null for `http://`, other hosts, and null input.
  - `getSet('yp-…')` downloads the resolved URL with the User-Agent.
  - `getSet('yp-…')` with the resolver returning `https://evil.example/x.jpg` returns null and makes no fetch.
  - With no resolver, a `yp-` key returns null.
  - In `intl-sync.test.ts`, the synced set row's `image_key` equals `yugipediaImageKey(image_url)`.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** In `repo/sets.ts` `toSummary`, `imageKey` becomes `r.image_key ?? setImageKey(r.image_url)`; select `s.image_key`.
- [ ] **Step 4: Run green** on all three checks.
- [ ] **Step 5: Commit:** `feat(intl): set art from Yugipedia through the image cache`.

---

### Task 6: Language-aware sets repository and IPC

**Files:**
- Modify: `src/main/repo/sets.ts`, `src/shared/types.ts`, `src/shared/ipc.ts`, `src/main/ipc/handlers.ts`, `tests/main/sets.test.ts`, `tests/main/handlers.test.ts`, `tests/renderer/mockApi.ts`, `tests/renderer/setFixtures.ts`

**Interfaces:**
- Produces:
  - `SetSummary` gains `language: Language`, `listRows: number | null`, `unmatchedRows: number | null`.
  - Functions:
    ```ts
    export function listSets(db): SetSummary[]                         // one row per (language, set_name)
    export function getChecklist(db, setName: string, language: Language): SetChecklist | null
    export function adjustPrinting(db, setName: string, language: Language, printingId: number, delta: 1 | -1, now?): ChecklistCard
    ```
  - IPC: `sets.checklist(setName, language)` and `sets.adjust(setName, language, printingId, delta)`.
- Every query that grouped or filtered by `p.set_name` now uses `(p.language, p.set_name)`. The join to `sets` is on both columns.
- `adjustPrinting` rejects a printing whose (set_name, language) doesn't match, with the existing `CollectionError` text pattern.

- [ ] **Step 1: Write failing tests** (`sets.test.ts`, on `seededDb()` plus inserted `ja` rows and a `('ja','Legend of Blue Eyes White Dragon',…)` set row):
  - `lists the Japanese and English LOB separately`: two summaries with the same name, languages `en`/`ja`, and their own totals.
  - `owning the Japanese copy fills only the Japanese set`.
  - `getChecklist(db, name, 'ja')` returns only `ja` printings.
  - `adjustPrinting refuses a printing from the other language`.
  - `summary carries listRows/unmatchedRows` (null for English).
  - `handlers.test.ts`: the `sets:checklist` and `sets:adjust` handlers pass `language` through.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.** Update the renderer call sites only as far as typecheck requires. Pass `'en'` temporarily where the UI doesn't know a language yet; Task 9 replaces those.
- [ ] **Step 4: Run green** on all three checks.
- [ ] **Step 5: Commit:** `feat(intl): sets keyed by name and language`.

---

### Task 7: Price Worker

**Files:**
- Create: `workers/ebay-prices/src/index.js`, `workers/ebay-prices/src/price.js`, `workers/ebay-prices/test/price.test.js`, `workers/ebay-prices/test/index.test.js`, `workers/ebay-prices/wrangler.toml`, `workers/ebay-prices/package.json`, `workers/ebay-prices/README.md`
- Modify: the root `vitest` config `include`, if needed, so `workers/**/test/*.test.js` runs under `npm test`

**Interfaces:**
- Produces the HTTP contract the app consumes (Task 8):
  ```
  GET /v1/price?code=<set code or ''>&name=<English card name>&set=<English set name>&rarity=<rarity>&lang=<Language code>
  Header: X-Client: ygo-collection-tracker
  200 { "price": number | null, "listingCount": number, "currency": "USD", "checkedAt": "<ISO>" }
  400 bad/missing params or header · 405 non-GET · 502 eBay failure (body { "error": "upstream" })
  ```
- `price.js` (pure, no I/O):
  ```js
  export function buildQuery({ code, name, set, rarity, lang })   // -> string
  export function titleMatches(title, { code, name })             // -> boolean
  export function askingPrice(prices)                             // number[] -> { price: number|null, listingCount: number }
  ```

**Rules:**
- **Query:** if `code` is non-empty: `"<code>"`, plus `<ebayWord>` when the code has no language letters after the dash (it matches `/^[A-Z0-9]+-\d+$/`, e.g. `LB-05`), plus `<rarity>`. If `code` is empty: `"<name>" <set> <ebayWord> <rarity>`.
  - `ebayWord` comes from the Task 1 table, copied into `price.js` as a frozen map; the Worker doesn't import app code.
  - If fewer than 2 listings match with the rarity, the Worker searches once more without it.
- **Titles:** case-insensitive. A title must contain the code when there is one, else the card name.
- **Price:** USD `price.value` of each matching item (the item price, no shipping).
  1. Take the median of all values.
  2. Keep values within `[median/3, median*3]` and take the median again, rounded to cents.
  3. With fewer than 2 listings remaining, the result is `{ price: null, listingCount }`.
- **eBay calls:**
  - OAuth `https://api.ebay.com/identity/v1/oauth2/token` (client-credentials, scope `https://api.ebay.com/oauth/api_scope`). The token is cached in memory until 60 s before expiry.
  - Browse `https://api.ebay.com/buy/browse/v1/item_summary/search?q=…&category_ids=31395&limit=50`, header `X-EBAY-C-MARKETPLACE-ID: EBAY_US`.
  - Retries: 0, 429 and 5xx, 3 attempts, 1 s/2 s.
  - Follow the gotchas in `~/Documents/GitHub/pokemon-card-stream-pricer/trainer/hitcheck_trainer/corpus/ebay.py`: `/v1/` in the OAuth URL, and never log credentials or the token.
- **Cache:** KV binding `PRICES`. The key is the normalized query plus the rarity-fallback flag. TTL 7 days. A cache hit returns the stored body with its original `checkedAt`.
- `wrangler.toml`: `name = "ygo-ebay-prices"`, `main = "src/index.js"`, `compatibility_date = "2026-10-01"`, and a `[[kv_namespaces]]` binding `PRICES` with a placeholder id. The README covers the owner's deploy steps (`wrangler kv namespace create PRICES`, `wrangler secret put EBAY_APP_ID`, `wrangler secret put EBAY_CERT_ID`, `wrangler deploy`).

- [ ] **Step 1: Write failing tests:**
  - `buildQuery`: `LOB-DE001` gives `"LOB-DE001" Ultra Rare`; `LB-05` + `ja` gives `"LB-05" Japanese Ultra Rare`; codeless Vol.1 gives `"Dark Magician" Vol.1 Japanese Ultra Rare`.
  - `titleMatches` is case-insensitive.
  - `askingPrice`: `[10,11,12,100]` gives `{ price: 11, listingCount: 3 }`; `[5]` gives `{ price: null, listingCount: 1 }`; `[]` gives `{ price: null, listingCount: 0 }`.
  - `index.test.js`, with fake `fetch`, fake KV and fake env:
    - a 200 response has the contract shape
    - a missing header gives 400
    - the second identical request is served from KV with no eBay fetch
    - the rarity fallback runs when fewer than 2 listings match
    - an OAuth 401 gives 502 `{error:'upstream'}`, and the body and `console` output never contain the env secret values
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green.** Lint covers `workers/` if the ESLint config includes it; otherwise leave the config unchanged.
- [ ] **Step 5: Commit:** `feat(prices): Cloudflare Worker for eBay asking prices`.

---

### Task 8: App-side eBay prices

**Files:**
- Create: `src/main/prices/config.ts`, `src/main/prices/client.ts`, `src/main/prices/refresh.ts`, `tests/main/prices.test.ts`
- Modify: `src/main/repo/collection.ts`, `src/main/repo/stats.ts` (if needed), `src/shared/types.ts` (`EntryView`), `src/main/ipc/handlers.ts`, `src/main/index.ts`, `tests/main/collection.test.ts`, `tests/main/stats.test.ts`

**Interfaces:**
- Consumes the Task 7 HTTP contract.
- Produces:
  ```ts
  // config.ts
  export const PRICE_WORKER_URL: string   // '' until Task 11
  export function priceWorkerUrl(): string | null   // env YGO_PRICE_WORKER_URL ?? PRICE_WORKER_URL; null when empty
  // client.ts
  export class PriceUnavailableError extends Error {}
  export interface PriceQuery { code: string; name: string; set: string; rarity: string; lang: Language }
  export interface PriceClient { lookup(q: PriceQuery): Promise<{ price: number | null; listingCount: number; checkedAt: string }> }
  export function createPriceClient(opts: { url: string; fetchFn?: typeof fetch }): PriceClient   // 15 s timeout; any non-200/bad shape -> PriceUnavailableError
  // refresh.ts
  export const PRICE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
  /** Owned non-English printings with no intl_prices row or checked_at older than 7 days (or only `printingIds`). Sequential. Never rejects. */
  export function refreshIntlPrices(db, client: PriceClient | null, opts?: { now?: Date; printingIds?: number[] }): Promise<{ updated: number; failed: number }>
  // EntryView gains:
  priceSource: 'ygoprodeck' | 'ebay'
  priceCheckedAt: string | null
  noPriceReason: 'no-listings' | 'pending' | 'unavailable' | null
  ```

**Behaviour:**
- **Writing rows:** `refreshIntlPrices` writes `intl_prices` rows (`price`, `listing_count`, `checked_at`) on success. It sets meta `price_service_status` to `'ok'` after any success, or to `'unavailable'` when the client is null or every lookup this run failed.
- **`toView` for a non-English printing:**
  - `priceSource` is `'ebay'`, the unit price comes from `intl_prices.price` (`LEFT JOIN`), and `priceApproximate` is false.
  - `noPriceReason`:

    | Condition | Reason |
    |---|---|
    | price row exists, price null | `'no-listings'` |
    | no row, `price_service_status === 'ok'` | `'pending'` |
    | no row otherwise | `'unavailable'` |
    | price present | null |
  - English entries are unchanged, with `priceSource: 'ygoprodeck'`, `priceCheckedAt` null and `noPriceReason` null.
- **Triggers in handlers:**
  - Applies to `collection:add`, `collection:update` (when the printing changes) and `sets:adjust` with `delta 1`.
  - When the resulting printing is non-English and has no fresh price, start `refreshIntlPrices(db, priceClient, { printingIds: [id] })` without awaiting it, then `emitDataChanged()`.
  - `HandlerDeps` gains `priceClient: PriceClient | null` and `emitDataChanged: () => void`.
- **Startup:** after the Task 4 chain, run `refreshIntlPrices(db, priceClient)`, then broadcast `DATA_CHANGED`. With no Worker URL, set `price_service_status = 'unavailable'` at startup.
- **Stats:** the dashboard total sums `totalValue` as today, so eBay prices are included and missing ones count $0. `approximateCount` doesn't count eBay entries.

- [ ] **Step 1: Write failing tests:**
  - `createPriceClient`: it sends `X-Client` and the query params; a 502 or bad JSON throws `PriceUnavailableError`; a timeout throws it too.
  - `refreshIntlPrices`:
    - only owned non-English printings are looked up
    - a 3-day-old row is skipped and an 8-day-old one refreshed
    - `printingIds` limits the run
    - a client of `null` sets the status to `unavailable` and makes no calls
    - one failure among two lookups updates the other
  - `collection.test.ts`:
    - a `ja` entry with a price row shows `unitPrice` 12.5, `priceSource 'ebay'`, `priceApproximate false`, `totalValue` qty×12.5
    - with a null-price row, `noPriceReason 'no-listings'` and `totalValue 0`
    - with no row and status `ok`, `'pending'`; with no row and status unset, `'unavailable'`
    - a `ja` printing never uses the card's `tcgplayer_price` even when it's set
  - `stats.test.ts`: the total includes the eBay price, and `approximateCount` excludes eBay entries.
  - `handlers.test.ts`: `collection:add` of a `ja` printing calls `refreshIntlPrices`' client once with that printing, then `emitDataChanged`; an English add calls neither.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green** on all three checks.
- [ ] **Step 5: Commit:** `feat(prices): eBay asking prices for owned non-English copies`.

---

### Task 9: Renderer: language filter and Sets page

**Files:**
- Create: `src/renderer/src/lib/languageFilter.ts`, `src/renderer/src/components/LanguageTag.tsx`, `src/renderer/src/components/LanguageSelect.tsx`, `tests/renderer/languageFilter.test.tsx`
- Modify: `src/renderer/src/features/sets/{SetsPage,SetsList,SetChecklist,setsView}.ts(x)`, `src/renderer/src/lib/api.ts` (`queryKeys.setChecklist(name, language)`), `tests/renderer/{sets-list,set-checklist,set-bulk,setsView}.test.ts(x)`, `tests/renderer/setFixtures.ts`

**Interfaces:**
- Produces:
  ```ts
  export function useLanguageFilter(): [LanguageFilter, (f: LanguageFilter) => void]   // localStorage 'language.filter', default 'en', invalid -> 'en'
  export function matchesLanguage(filter: LanguageFilter, language: Language): boolean
  export function LanguageTag(props: { language: Language; className?: string }): React.JSX.Element | null   // null for 'en'; badge with tag text, title = label
  export function LanguageSelect(props: { value: LanguageFilter; onChange(f: LanguageFilter): void; available: Language[] }): React.JSX.Element
  //   options: "All languages", then `available` in LANGUAGES order, labelled `${label}`; always includes the current value
  // setsView.filterSets options gain `language: LanguageFilter`
  ```
- **The open set** is `{ setName: string; language: Language } | null`, and the React key is `${language}|${setName}`.
- **Header counts** (`setsHeader`) count only the sets in the selected language.
- **Tiles and rows** show `<LanguageTag>` after the set name. The checklist header shows the name, the tag and, when `unmatchedRows > 0`, the text `{listRows - unmatchedRows} of {listRows} cards listed; {unmatchedRows} couldn't be identified`.
- **`LanguageSelect`** sits in the Sets page toolbar, with `available` = the distinct languages in `sets.list`.

- [ ] **Step 1: Write failing tests:**
  - `useLanguageFilter`: it defaults to `'en'`, persists `'ja'`, and an invalid stored `'jp'` reads as `'en'`.
  - `filterSets` with `language: 'ja'` keeps only `ja` sets, and `'all'` keeps every set.
  - The Sets list:
    - with an English and a Japanese LOB in the mock, only the English one shows by default
    - choosing Japanese shows the Japanese tile with a `JP` tag
    - opening it calls `api.sets.checklist('Legend of Blue Eyes White Dragon', 'ja')`
  - The checklist header shows `60 of 61 cards listed; 1 couldn't be identified` for `listRows 61, unmatchedRows 1`.
  - Bulk `+` calls `api.sets.adjust(name, 'ja', printingId, 1)`.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green** on all three checks.
- [ ] **Step 5: Commit:** `feat(intl): language filter and non-English sets on the Sets page`.

---

### Task 10: Renderer: Add Card, Collection, prices, credit

**Files:**
- Modify: `src/renderer/src/features/add-card/AddCardDialog.tsx`, `src/renderer/src/features/collection/{CollectionPage,FilterBar,CollectionGrid,CollectionTable,EntryDetailPanel,EntryValue}.tsx`, `src/main/repo/collection.ts` (`language` filter, `Facets.languages`), `src/shared/types.ts` (`CollectionFilters.language?: Language`, `Facets.languages: Language[]`), `src/renderer/src/features/settings/SettingsPage.tsx`, `tests/renderer/{add-card,collection,dashboard,settings}.test.tsx`, `tests/main/collection.test.ts`

**Interfaces:**
- Consumes: Task 9 `useLanguageFilter`, `LanguageTag`, `LanguageSelect`, `matchesLanguage`; Task 8 `EntryView` price fields.
- **Add Card printing step:**
  - Each printing item shows `<LanguageTag>`.
  - A `LanguageSelect` above the list (`available` = the languages among this card's non-missing printings) filters it.
  - The dialog keeps its own copy of the filter, initialised from the shared one. When the dialog opens with `initial.printingId`, its copy is initialised to that printing's language instead.
  - The filter value is included in the printing item's searchable text, so the Command filter doesn't hide items wrongly.
- **Collection:**
  - `listEntries` honours `f.language` (undefined means all). `getFacets` returns `languages` (distinct, in `LANGUAGES` order).
  - The FilterBar shows a `LanguageSelect` bound to the shared filter. It maps `'all'` to `language: undefined`.
  - Grid/table rows show `<LanguageTag>` next to the set code.
- **`EntryValue` / detail panel:**

  | Case | Display |
  |---|---|
  | `priceSource 'ebay'`, price present | `$12.50`, with the subtitle/tooltip `eBay asking price · checked <date>` (date via the existing `format.ts` date helper) |
  | `noPriceReason 'no-listings'` | `No price`, tooltip `No eBay listings found` |
  | `noPriceReason 'pending'` | `No price`, tooltip `Checking eBay…` |
  | `noPriceReason 'unavailable'` | `No price`, tooltip `Prices unavailable` |
- **Settings → About:** add the line `Non-English set lists from Yugipedia (CC BY-SA 4.0).`, with "Yugipedia" linking to `https://yugipedia.com/`. It opens through the existing external-link handling, so https links only.

- [ ] **Step 1: Write failing tests:**
  - Add Card:
    - with the filter on English and a card that has `en` and `ja` printings, only `en` shows
    - switching to Japanese shows `LB-05` with a `JP` tag
    - **opened with `initial` pointing at the `ja` printing while the shared filter is `'en'`, the `ja` printing is visible and highlighted** (Review Focus 1)
  - Collection:
    - the default filter `'en'` sends `language: 'en'` to `collection.list`, and choosing "All languages" sends `language: undefined`
    - a `ja` entry row shows `JP`
  - `EntryValue`: each of the four display cases above renders its text.
  - Main `collection.test.ts`: `listEntries({ language: 'ja', … })` returns only `ja` entries, and `getFacets().languages` is `['en','ja']` when both are owned.
  - Settings: the credit line renders.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run green** on all three checks. Then smoke-run `npm run dev:fake-data`:
  - the Yugipedia sync completes in the background
  - choosing Japanese on the Sets page shows Japanese sets with art
  - adding a Japanese copy shows "No price · Prices unavailable", since there is no Worker yet
- [ ] **Step 5: Commit:** `feat(intl): non-English printings in Add Card and Collection, eBay price display`.

---

### Task 11: Deploy the Worker (owner-approved; stop and ask first)

**Files:**
- Modify: `src/main/prices/config.ts` (`PRICE_WORKER_URL`), `workers/ebay-prices/wrangler.toml` (KV id)

- [ ] **Step 1: Ask the owner** for approval to deploy to their Cloudflare account and set secrets. Don't continue without a yes.
- [ ] **Step 2:**
  1. In `workers/ebay-prices/`, run `npx wrangler kv namespace create PRICES` and put its id in `wrangler.toml`.
  2. Run `npx wrangler secret put EBAY_APP_ID` and `npx wrangler secret put EBAY_CERT_ID`, piping the values from the owner's `PROD_APP_ID` / `PROD_EBAY_CERT_ID` without printing them, e.g. `printf %s "$PROD_APP_ID" | npx wrangler secret put EBAY_APP_ID`.
  3. Run `npx wrangler deploy`.
- [ ] **Step 3: Set `PRICE_WORKER_URL`** to the deployed `https://…workers.dev` URL.
- [ ] **Step 4: End-to-end check:** `curl -s -H 'X-Client: ygo-collection-tracker' '<url>/v1/price?code=LOB-DE001&name=Blue-Eyes%20White%20Dragon&set=Legend%20of%20Blue%20Eyes%20White%20Dragon&rarity=Ultra%20Rare&lang=de'` returns the contract shape with `listingCount ≥ 0`. Then, in `npm run dev:fake-data`, a Japanese copy gets an "eBay asking price" or "No eBay listings found" within a minute.
- [ ] **Step 5: Run green** on all three checks.
- [ ] **Step 6: Commit:** `chore(prices): point the app at the deployed price Worker`. Don't push.
