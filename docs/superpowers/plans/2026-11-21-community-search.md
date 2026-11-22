# Community Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One search box that understands collector language: words match name, set, number and
rarity in any order, owner-approved community terms ("bubble mew") point at exact versions, and a
harvest (a backfill, then monthly) mines new terms from eBay titles through a Claude filter into an
admin review queue.

**Architecture:** A shared `search_terms` table (schema V52, desktop and portal) holds terms. Repo
code shared by desktop, phone and portal (`src/main/repo`) expands terms and field words into
printing-level hits ahead of today's unchanged search. The portal owns the full list (pending,
approved, rejected) and serves approved terms through a small change feed that the sync engine pulls.
A GitHub Actions job harvests titles through a token-guarded `ebay-prices` endpoint, mines phrases,
asks Claude to keep or drop each one, and posts proposals to the portal.

**Tech Stack:** TypeScript, better-sqlite3 / DO SQLite (FTS5, fts5vocab), React (renderer),
Cloudflare Workers (portal TS, ebay-prices JS), Vitest, `@anthropic-ai/sdk` + `zod` (job only).

**Spec:** `docs/superpowers/specs/2026-11-21-community-search-design.md`

## Global Constraints

- One search implementation for desktop SQLite, phone wasm SQLite and portal DO SQLite. In the
  portal, no compound query with ~10 or more UNION terms: one query per table.
- **Today's searches must not change.** Every current `searchCards`, `listEntries` and `browseCards`
  result stays the same, in the same order. New hits are added *before* them (term hits) or after
  the name hits (field hits), never in place of them.
- No visible per-keystroke slowdown. Measure Add Card and Collection search on Magic before and after
  (Task 16) and report the numbers.
- Nothing reaches users without owner approval (`status = 'approved'`).
- Each harvest run checks `/v1/quota` first and keeps a **1,500-call reserve**. It never writes to the
  price cache.
- Harvest and mining use **English listings only**.
- At most **100 proposals per run**, strongest evidence first.
- Claude model: `claude-opus-5-5`. Key: `ANTHROPIC_API_KEY` repo secret.
- Test data: no 100k-row fixtures in vitest. Benchmarks go in a standalone script capped at 50k rows.
- Release order: deploy the eBay Worker, then the portal, then tag the client.
- Vitest: `npm test -- --project <main|renderer|portal|workers> <file>` (the script already sets
  `--maxWorkers=2`).
- Typecheck before pushing: `npm run typecheck:node`, `npm run typecheck:web`,
  `npm run typecheck:phone`, and `npm run typecheck` in `workers/portal`.
- Work in the worktree `/var/tmp/search-wt` (branch `feat/community-search`). Other sessions commit in
  the main checkout.

## Review Focus

1. **Punctuation and accents in names and terms.** "Ash Blossom & Joyous Spring", "Blue-Eyes",
   "Pokémon", "Flabébé". A term phrase and a query normalise the same way (`&` becomes "and", hyphens
   and punctuation become spaces, accents are dropped), so "blue eyes", "blue-eyes" and "BLUE EYES" all
   match a term on "Blue-Eyes". Pinned in Task 1.
2. **A term whose target isn't in the local catalog.** The game isn't pulled, a language is missing, or
   the target printing was removed upstream. Search returns no term row for it and doesn't throw; the
   term note is left out. Pinned in Task 3.
3. **A single word that is both a set word and a card word.** "fusion", "151", "dragon". Plain name
   results stay first and unchanged; field hits only add rows after them. Pinned in Task 5.
4. **A term removed or edited after devices have it.** The feed sends a delete or the new row, and the
   device stops matching the old phrase. Pinned in Task 11.
5. **A half-typed last word.** "bubble m" must not hide results while the user is still typing, and a
   term only matches whole words ("bub" matches nothing). Pinned in Task 3.

---

### Task 1: Term types and the shared normaliser

**Files:**
- Create: `src/shared/search/terms.ts`
- Test: `tests/shared/search-terms.test.ts`

**Interfaces:**
- Produces:
  - `termKey(s: string): string`: NFKD, strip combining marks, lowercase, `&` → ` and `, any run of
    non letter/number characters → one space, trimmed.
  - `termWords(s: string): string[]`: `termKey(s).split(' ').filter(Boolean)`.
  - `type TermKind = 'nickname' | 'abbreviation' | 'subset' | 'rarity' | 'cards'`
  - `type TermTargetKind = 'printing' | 'card' | 'set' | 'rarity' | 'cards'`
  - `type TermStatus = 'pending' | 'approved' | 'rejected'`
  - `interface TermTarget { pkeys?: string[]; cardIds?: number[]; sets?: { language: string; setName: string }[]; rarities?: string[] }`
  - `interface SearchTerm { id: number; game: GameId; phrase: string; phraseKey: string; kind: TermKind; targetKind: TermTargetKind; target: TermTarget; status: TermStatus; source: 'ebay-ai' | 'owner' | 'user'; seq: number }`
  - `interface TermEvidence { titles: string[]; count: number; sellers: number; reason: string }`
  - `interface TermNote { phrase: string; label: string }` (label example: `"Mew ex · Paldean Fates 232/91"`).
  - `MAX_TERM_WORDS = 4`

- [ ] **Step 1: Write the failing test**

```ts
import { termKey, termWords } from '../../src/shared/search/terms'
it('folds case, accents and punctuation', () => {
  expect(termKey('Blue-Eyes')).toBe('blue eyes')
  expect(termKey('  BLUE   EYES ')).toBe('blue eyes')
  expect(termKey('Ash Blossom & Joyous Spring')).toBe('ash blossom and joyous spring')
  expect(termKey('Flabébé')).toBe('flabebe')
  expect(termKey('Pokémon')).toBe('pokemon')
  expect(termKey('232/091')).toBe('232 091')
  expect(termWords('Bubble Mew!')).toEqual(['bubble', 'mew'])
  expect(termKey('!!!')).toBe('')
})
```

- [ ] **Step 2:** Run `npm test -- --project main tests/shared/search-terms.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement the file (pure, no imports except `GameId` from `../games`).
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit `feat(search): term types and normaliser`.

### Task 2: `search_terms` schema (desktop V52 + portal server-51)

**Files:**
- Modify: `src/main/db/schema.ts` (add `SCHEMA_V52`, add `{ version: 52, sql: SCHEMA_V52 }` to `MIGRATIONS`)
- Modify: `workers/portal/src/migrate.ts` (add `{ name: 'server-51', sql: SCHEMA_V52 }` after server-50)
- Test: `tests/main/schema-search-terms.test.ts`, plus a case in the existing portal migration test if there is one (`grep -l "server-50" tests/portal`)

**Interfaces:**
- Produces: the table and the vocab table below, on desktop, phone (phone runs `MIGRATIONS`) and portal.

```sql
CREATE TABLE search_terms (id INTEGER PRIMARY KEY, game TEXT NOT NULL, phrase TEXT NOT NULL,
  phrase_key TEXT NOT NULL, kind TEXT NOT NULL, target_kind TEXT NOT NULL, target TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', source TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '{}',
  seq INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, decided_at TEXT,
  UNIQUE (game, phrase_key));
CREATE INDEX ix_search_terms_seq ON search_terms(seq);
CREATE INDEX ix_search_terms_game_status ON search_terms(game, status);
CREATE VIRTUAL TABLE cards_fts_vocab USING fts5vocab(cards_fts, row);
```

`target` and `evidence` are JSON text. On a device, the table holds approved rows only, and `id`/`seq`
are the portal's. The vocab table is for the typo fallback (Task 6).

- [ ] **Step 1: Write the failing test:** open a fresh desktop DB with the migrations, insert a row, read it back; `SELECT term FROM cards_fts_vocab LIMIT 1` doesn't throw.
- [ ] **Step 2:** Run it. Expected: FAIL, no such table.
- [ ] **Step 3:** Add V52 and server-51.
- [ ] **Step 4:** Run the new test and the existing schema/migration tests (`npm test -- --project main tests/main/schema` and `npm test -- --project portal tests/portal`). Expected: PASS.
- [ ] **Step 5:** Commit `feat(search): search_terms table`.

### Task 3: Term matching

**Files:**
- Create: `src/main/repo/searchTerms.ts`
- Test: `tests/main/search-terms-match.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `termWords`, `MAX_TERM_WORDS`; `Scope`/`scopeGame` from `./scope`.
- Produces:
  - `approvedTerms(db: SqlDb, game: GameId): SearchTerm[]`: cached per `db` in a `WeakMap`, keyed by
    game. Cleared by `forgetSearchTerms(db)`.
  - `forgetSearchTerms(db: SqlDb): void`: every writer calls it (Task 10 portal routes, Task 11
    pull).
  - `interface TermMatch { term: SearchTerm; start: number; end: number }` (word indexes, `end`
    exclusive).
  - `matchTerms(db: SqlDb, scope: Scope, text: string): { matches: TermMatch[]; rest: string[] }`:
    greedy longest match (up to `MAX_TERM_WORDS` words) over `termWords(text)`, whole words only.
    `rest` is the words no term covers.
  - `termPrintingIds(db: SqlDb, scope: Scope, target: TermTarget, limit: number): number[]`: local
    `card_printings.id`s for the target. `pkeys` → `pkey IN`; `cardIds` → that card's printings in the
    scope's language; `sets` → `(language, set_name)`; `rarities` → `set_rarity IN`. Combined kinds
    are ANDed. Always `contributed = 0` and the scope's game. A target with nothing local gives `[]`.

- [ ] **Step 1: Write the failing tests** (seed with the helpers the existing `tests/main/cards.test.ts` uses):
  - "bubble mew" with an approved term `bubble mew` → one match covering words 0–2, `rest = []`.
  - "bubble mew psa" → `rest = ['psa']`.
  - A `pending` or `rejected` term never matches.
  - "bub" and "bubble m" → no match (whole words only; `rest` keeps the words).
  - Longest wins: terms `tg` and `tg charizard` → "tg charizard" matches the longer one.
  - A term for game `pkm` doesn't match in a `ygo` scope.
  - `termPrintingIds` for a pkey not in the DB → `[]`, no throw.
  - After inserting a new approved row and calling `forgetSearchTerms`, it matches.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. One prepared query per call: `SELECT ... FROM search_terms WHERE game = ? AND status = 'approved'`, parse `target` JSON once per load.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(search): match approved terms`.

### Task 4: Field words (set, rarity, code, number)

**Files:**
- Create: `src/main/repo/queryFields.ts`
- Test: `tests/main/query-fields.test.ts`

**Interfaces:**
- Consumes: `termWords`, `buildFtsQuery` (`./fts`), `Scope`.
- Produces:
  - `interface FieldQuery { sets: { language: string; setName: string }[] | null; rarities: string[] | null; codePrefix: string | null; number: string | null; nameWords: string[] }`
  - `parseFields(db: SqlDb, scope: Scope, words: string[]): FieldQuery | null`: returns `null` unless
    at least one field constraint was found **and** at least one word is left over or a term already
    constrains. Rules:
    - Set words: the longest contiguous run of words that is a word-prefix match of one or more of the
      game's set names (`sets` table, cached per db+game like Task 3) → `sets`. "trainer gallery"
      matches every "… Trainer Gallery" set. A bare number like "151" counts when it's a whole word of
      a set name.
    - Rarity words: a run equal to a rarity label's `termKey`, or a known abbreviation in
      `RARITY_ABBREVIATIONS` (exported constant in this file, per game; e.g. pkm `sir` → "Special
      Illustration Rare", `ir`, `ur`, `hr`; ygo `qcse` → "Quarter Century Secret Rare", `scr`, `ur`,
      `stpr`; op `sp`, `sec`; mtg left empty) → `rarities` (labels as they appear in
      `card_printings.set_rarity` for the game; cache the distinct list).
    - A word shaped like a set code (`/^[a-z]{2,5}\d{0,3}$/` that equals a printing's set-code prefix
      for the game, case-insensitive) → `codePrefix`.
    - A number like `232`, `tg03`, `232 091` (after `termKey`) → `number`.
    - Everything else → `nameWords`.
  - `fieldPrintingIds(db: SqlDb, scope: Scope, fq: FieldQuery, limit: number): number[]`: printings
    whose card matches `nameWords` (FTS through `buildFtsQuery`, empty means any card) and that pass
    every field constraint. Ordered by set date, newest first. One query on `card_printings` joined to
    the FTS subquery; sets go in as `(language, set_name) IN (VALUES …)`.

- [ ] **Step 1: Write the failing tests** with a small seeded catalog (Charizard in LOR + "Lost Origin Trainer Gallery" TG03/30; Mew ex in PAF 216 and 232 with rarity "Special Illustration Rare"; a "Fusion Strike" set; a card named "Fusion Gate"):
  - `["trainer","gallery","charizard"]` → sets = the TG set(s), `nameWords = ['charizard']`, and `fieldPrintingIds` returns only the TG03 printing.
  - `["mew","sir"]` → rarities = SIR → PAF 232 only, not 216.
  - `["lor","tg03"]` → TG03.
  - `["fusion"]` → `null` (one word, no leftover name word, no term).
  - `["dark","magician"]` (no set or rarity words) → `null`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(search): set, rarity, code and number words`.

### Task 5: Version rows in `searchCards` (Add Card, phone, web)

**Files:**
- Modify: `src/shared/types.ts` (`CardSearchResult`)
- Modify: `src/main/repo/cards.ts` (`searchCards`)
- Test: `tests/main/cards.test.ts` (add cases), `tests/main/search-regression.test.ts` (new)

**Interfaces:**
- Consumes: `matchTerms`, `termPrintingIds` (Task 3); `parseFields`, `fieldPrintingIds` (Task 4).
- Produces: `CardSearchResult` gains optional fields (old clients ignore them):
  `printingId?: number`, `setName?: string`, `setCode?: string`, `rarity?: string`,
  `imageId?: number` (that printing's art, same rule the card panel uses for `artImageId`),
  `term?: string` (the matched phrase), `nearMiss?: true` (Task 6).

Order inside `searchCards`: (1) term rows: for each match, `termPrintingIds`, narrowed by
`parseFields(rest)`/`fieldPrintingIds` when `rest` isn't empty, one row per printing; (2) today's
code, unchanged, in today's order; (3) field rows from `parseFields(all words)` when not `null`. The
existing `seen` set dedupes by card for card rows. Version rows dedupe by `printingId`, and a version
row never removes a card row. The total stays under `limit` (term rows count first).

- [ ] **Step 1: Write the regression test first** (`search-regression.test.ts`): on a seeded catalog with **no** terms, record `searchCards` output for "dark magician", "blue-eyes", "MEP 102", "Victini 102", "fusion", "char", "LOB-001" and assert it equals a frozen snapshot taken from today's code. Run it against unchanged code and commit the snapshot.
- [ ] **Step 2: Write the failing feature tests:**
  - "trainer gallery charizard" → the first row has `printingId` = TG03, `setName` "Lost Origin Trainer Gallery", `setCode` "LOR:TG TG03/30".
  - With an approved `bubble mew` term → PAF 232 Mew ex: the first row has `term: 'bubble mew'`, `printingId` = PAF 232.
  - "bubble" with that term approved and a card "Bubbleman" → Bubbleman still appears (term rows come first, then name rows).
  - "fusion" → same rows as the snapshot.
- [ ] **Step 3:** Run. Expected: the feature tests FAIL, the snapshot PASSES.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run both files plus `tests/main/cards.test.ts`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(search): version rows for terms and field words`.

### Task 6: Typo fallback

**Files:**
- Modify: `src/main/repo/cards.ts`
- Create: `src/main/repo/nearNames.ts`
- Test: `tests/main/near-names.test.ts`

**Interfaces:**
- Produces: `nearNameWords(db: SqlDb, word: string, max = 3): string[]`: vocab terms from
  `cards_fts_vocab` with `term >= first two letters` range, length within ±2, Damerau-Levenshtein ≤ 2
  (≤ 1 for words shorter than 6), closest first. Only for words of 4+ letters.
- In `searchCards`: only when the result list is empty, rewrite each unknown word to its best
  near word and run the name search again. Mark rows `nearMiss: true`.

- [ ] **Step 1: Failing tests:** "charzard" → Charizard rows with `nearMiss: true`; "charizard" (has results) never calls the fallback (spy on `nearNameWords`); "xq" → `[]`.
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement. Check that `cards_fts_vocab` range queries work against the portal's DB in `tests/portal` (add one case calling `searchCards` through `cards:search` there).
- [ ] **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit `feat(search): did-you-mean for misspelt names`.

### Task 7: Collection and Browse use the same words

**Files:**
- Create: `src/main/repo/queryPrintings.ts`
- Modify: `src/main/repo/collection.ts` (`listEntries` text clause ~L294), `src/main/repo/browse.ts` (text clause ~L173, `browseCards`)
- Modify: `src/shared/types.ts` (`BrowseCard`)
- Test: `tests/main/collection.test.ts`, `tests/main/browse.test.ts` (add cases)

**Interfaces:**
- Produces: `queryPrintingIds(db: SqlDb, scope: Scope, text: string, limit = 2000): { ids: number[]; term: string | null } | null`:
  terms, then fields, the same steps as Task 5 (1) and (3); `null` when neither applies.
- `listEntries`: when `queryPrintingIds` gives ids, OR `e.printing_id IN (…)` into the existing text
  clause. Only those copies show, because the rest of the clause is today's.
- `BrowseCard` gains `focusPrintingId?: number` and `focusLabel?: string` ("LOR TG03/30"). When
  `queryPrintingIds` applies, `browseCards` adds one row per matched printing (its card's fields,
  `imageId` = that printing's art, `defaultPrintingId = focusPrintingId`) ahead of today's rows, and
  counts them in `total`.

- [ ] **Step 1: Failing tests:** Collection with copies of PAF 216 and 232 → "mew sir" shows only the 232 copy; "mew" still shows both. Browse "trainer gallery charizard" → first card has `focusPrintingId` = TG03; Browse "charizard" is unchanged.
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the two files. PASS.
- [ ] **Step 5:** Commit `feat(search): collection and browse understand set, rarity and terms`.

### Task 8: `cards:explain` and the term note

**Files:**
- Create: `src/main/repo/explainQuery.ts`
- Modify: the `cards:search` wiring in each place it's registered (find with `grep -rn "'cards:search'" src workers/portal/src`): main IPC data handlers, preload API, the phone `READ_CHANNELS`/channel map in `src/phone/data/store.ts`, and `workers/portal/src/rpc.ts`
- Create: `src/renderer/src/components/TermNotes.tsx`
- Modify: `src/renderer/src/features/add-card/AddCardDialog.tsx`, `src/renderer/src/features/collection/CollectionPage.tsx`, `src/renderer/src/features/browse/BrowsePage.tsx`
- Test: `tests/main/explain-query.test.ts`, `tests/renderer/term-notes.test.tsx`

**Interfaces:**
- Produces: `explainQuery(db: SqlDb, scope: Scope, text: string): TermNote[]`: one note per matched
  term whose target resolves locally. Label: one printing → `"<card name> · <set name> <number>"`; one
  card → card name; sets → first set name + `" +N more"`; rarity → the rarity label; cards → `"N cards"`.
- Channel `cards:explain(q: string) → TermNote[]`, registered wherever `cards:search` is (read-only
  channel on phone).
- `<TermNotes q={string} />`: debounced the same way the page's search already is. Renders nothing
  for `[]`, otherwise one muted line per note: `“bubble mew” — Mew ex · Paldean Fates 232/91`, using
  the page's existing muted text style.

- [ ] **Step 1: Failing tests:** `explainQuery` gives the label above for the bubble mew fixture, and `[]` when the target is missing locally. `TermNotes` renders that line with a mocked `api.cards.explain`, and nothing for `[]`.
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement, and put `<TermNotes>` above the results on the three pages.
- [ ] **Step 4:** Run the tests plus `npm run typecheck:web` and `npm run typecheck:phone`. PASS.
- [ ] **Step 5:** Commit `feat(search): show which community term matched`.

### Task 9: Version rows in the UI

**Files:**
- Modify: `src/renderer/src/features/add-card/AddCardDialog.tsx`, `src/renderer/src/features/browse/BrowsePage.tsx` (and the phone screen that lists `cards:search` results, if any: `grep -rn "cards.search" src/phone`)
- Test: `tests/renderer/add-card-versions.test.tsx`

**Interfaces:**
- Consumes: `CardSearchResult.printingId/setName/setCode/imageId/nearMiss` (Task 5), `BrowseCard.focusPrintingId/focusLabel` (Task 7).
- A result with `printingId` shows that printing's art (`imageId`) and a second line
  `"<setName> · <setCode>"`. Picking it opens the add/panel flow preselected on that printing; pass it
  as the `CardPanelSeed.defaultPrintingId` the panel already supports (`CardPanel.tsx` L107). A
  Browse card with `focusPrintingId` shows `focusLabel` under the name and opens the same way. When
  the first row has `nearMiss`, show `Showing results for “<corrected words>”` above the list.

- [ ] **Step 1: Failing test:** render Add Card with mocked results (one version row, one plain card row). The version row shows "Lost Origin Trainer Gallery · LOR:TG TG03/30", and clicking it opens with that printing selected.
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run, plus the existing Add Card and Browse renderer tests. PASS.
- [ ] **Step 5:** Commit `feat(search): show and open the matched version`.

### Task 10: Portal term routes

**Files:**
- Create: `workers/portal/src/searchTerms.ts`
- Modify: `workers/portal/src/app.ts` (routes), `workers/portal/src/sync.ts` (`search-terms` path next to `price-changes`)
- Test: `tests/portal/search-terms.test.ts` (copy the setup in `tests/portal/beta.test.ts`)

**Interfaces:**
- Produces (all JSON, every writer calls `forgetSearchTerms(db)` and gives the row `seq = (SELECT COALESCE(MAX(seq),0)+1 FROM search_terms)`):
  - `GET /api/sync/search-terms?game=<id>&since=<seq>` (signed-in, like price-changes) →
    `{ terms: WireTerm[]; deleted: number[]; cursor: number; more: boolean }`, page size 500. Terms
    approved after `since` go in `terms`; terms moved out of approved after `since` go in `deleted`.
    `WireTerm = Pick<SearchTerm, 'id'|'game'|'phrase'|'phraseKey'|'kind'|'targetKind'|'target'|'seq'>`.
    Put `WireTerm` and the response type in `src/shared/search/terms.ts`.
  - `GET /admin/terms?status=pending|approved|rejected&game=` (owner session, `isAdmin` like
    `adminBetaRoute`) → `{ terms: (SearchTerm & { evidence: TermEvidence; preview: { cardName: string; imageId: number | null; label: string } | null })[] }`.
    Pending newest first. `preview` comes from `explainQuery`-style resolution.
  - `POST /admin/terms/decide` `{ id, status: 'approved'|'rejected', phrase?, kind?, targetKind?, target? }`
    (owner session + `adminWriteAllowed`). Edits recompute `phrase_key`; a clash with another row's
    key → 409.
  - `POST /admin/terms/add` `{ game, phrase, kind, targetKind, target }` → inserted as approved, source `owner`.
  - `POST /admin/terms/propose` (admin **token**, like the catalog admin routes using
    `adminAuthorized`) `{ proposals: { game, phrase, kind, targetKind, target, evidence }[] }` →
    inserts `pending`, source `ebay-ai`, `INSERT … ON CONFLICT(game, phrase_key) DO NOTHING`. Returns
    `{ added: number }`. Rejects more than 100.
  - `GET /admin/terms/known?game=` (admin token) → `{ keys: string[] }`: every `phrase_key` in any status.

- [ ] **Step 1: Failing tests:** propose → pending (not in the feed); approve → in the feed with a new cursor; reject after approve → id in `deleted`; propose the same phrase again (any status) → `added: 0`; a non-admin gets 404 on every `/admin/terms*` route; edit to a phrase another row already has → 409; feed paging with 501 rows → `more: true`.
- [ ] **Step 2:** Run `npm test -- --project portal tests/portal/search-terms.test.ts`. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run, plus `npm run typecheck` in `workers/portal`. PASS.
- [ ] **Step 5:** Commit `feat(portal): search terms feed and admin routes`.

### Task 11: Devices pull approved terms

**Files:**
- Modify: `src/main/cloud/client.ts` (`searchTerms(since: number, game: GameId): Promise<SearchTermsResponse>` next to `priceChanges`)
- Modify: `src/main/cloud/localSync.ts` (add `pullSearchTerms`, modelled on `pullPriceChanges` ~L1114)
- Modify: `src/main/cloud/engine.ts` (~L658, call it per game after `pullPriceChanges`)
- Test: `tests/main/pull-search-terms.test.ts`

**Interfaces:**
- Produces: `pullSearchTerms(db: SqlDb, client: Pick<CloudClient, 'searchTerms'>, owner: number, game: GameId): Promise<number>`:
  cursor key `'terms'` via `gameCursor`/`saveGameCursor`. Each page upserts `terms` (status
  `approved`), deletes `deleted` ids, saves the cursor in one transaction, then `forgetSearchTerms(db)`.
  Returns rows changed. The engine sets `changed = true` when > 0.

- [ ] **Step 1: Failing tests:** two pages applied in order and the cursor saved; a `deleted` id removes the local row, and "bubble mew" stops matching (`matchTerms`) after the pull; an edited phrase replaces the old one.
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run, plus `tests/main` engine tests (`grep -l pullPriceChanges tests/main`). PASS.
- [ ] **Step 5:** Commit `feat(sync): pull approved search terms`.

### Task 12: Admin Terms tab (portal page + desktop)

**Files:**
- Modify: `workers/portal/src/adminPage.ts` (new `terms` tab section and its client script; follow the Beta tab's fetch/decide pattern ~L559)
- Modify: `src/shared/admin.ts` (`AdminTerms` types; add `'terms.yml'` to `ADMIN_WORKFLOWS`; add `'terms'` to the page tabs list in `src/renderer/src/features/admin/adminTabs.ts`)
- Modify: `src/main/ipc/adminHandlers.ts` (`admin:terms`, `admin:decideTerm`, `admin:addTerm`), the preload admin API
- Create: `src/renderer/src/features/admin/TermsTab.tsx`
- Modify: `src/renderer/src/features/admin/AdminPage.tsx`
- Test: `tests/main/admin-handlers.test.ts` (cases), `tests/renderer/terms-tab.test.tsx`, `tests/portal/admin-page.test.ts` (tab present)

**Interfaces:**
- Consumes: Task 10 routes.
- The desktop tab has a game picker, then **Pending** and **Approved** sub-lists. A pending card shows
  the phrase, kind, preview art + label, the AI reason, count/sellers, up to 5 sample titles, and
  **Approve** / **Edit** / **Reject**. Edit is an inline form for phrase, kind, target kind and target
  (pkeys/card ids/sets/rarities as comma lists). Approved rows have **Remove** (→ rejected). There's
  an **Add term** form, and a **Run harvest** link that opens
  `https://github.com/darkharasho/duel-binder/actions/workflows/terms.yml` in the browser (the same
  external-link helper other admin links use). The portal tab offers the same actions.

- [ ] **Step 1: Failing tests:** handlers call the right portal paths with validated bodies (bad status → throws `Bad status`); `TermsTab` with one pending term → clicking Approve calls `admin.decideTerm(id, 'approved')` and the card leaves the list.
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run, plus `npm run typecheck:web`. PASS.
- [ ] **Step 5:** Commit `feat(admin): Terms tab`.

### Task 13: `ebay-prices` `/v1/titles`

**Files:**
- Modify: `workers/ebay-prices/src/index.js`
- Test: `workers/ebay-prices/test/titles.test.js` (copy the fetch-mocking setup in `test/index.test.js`)

**Interfaces:**
- Produces: `GET /v1/titles?q=<query>&game=<ygo|pkm|op|mtg>` with header
  `Authorization: Bearer <env.HARVEST_TOKEN>`. It runs one `search(env, q, { limit: 200, category: GRADED_CATEGORIES[game] })`
  and returns `{ titles: { title: string; seller: string }[] }`. Missing or wrong token, or no
  `HARVEST_TOKEN` set → 404. Bad game, or `q` empty or longer than `MAX_FIELD` → 400. eBay 429 → 429.
  It never reads or writes `env.PRICES`.

- [ ] **Step 1: Failing tests:** good token → titles and sellers from the mocked eBay response; wrong token → 404; no KV calls (a mock `PRICES` that throws if touched).
- [ ] **Step 2:** Run `npm test -- --project workers workers/ebay-prices/test/titles.test.js`. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the whole ebay-prices test folder. PASS.
- [ ] **Step 5:** Commit `feat(ebay): token-guarded titles endpoint for the term harvest`.

### Task 14: Phrase mining (pure)

**Files:**
- Create: `scripts/terms/mine.ts`
- Test: `tests/main/terms-mine.test.ts`

**Interfaces:**
- Produces:
  - `interface HarvestedPrinting { game: GameId; pkey: string; cardId: number; name: string; setName: string; setCode: string; number: string; rarity: string; language: string; titles: { title: string; seller: string }[] }`
  - `STOP_WORDS: ReadonlySet<string>`: grading (psa bgs cgc tag ace sgc beckett gem mint pristine and
    1–10), condition (nm lp mp hp near mint played), selling (free ship shipping fast lot bundle new
    sealed pack fresh), finish (holo foil), language words, game names, "card", "tcg", "ccg".
  - `leftoverWords(p: HarvestedPrinting, title: string, known: ReadonlySet<string>): string[][]`:
    `termWords(title)`, minus the printing's name/set/code/number/rarity words, `STOP_WORDS` and
    known term words. The result is split into runs wherever a word was removed (a phrase never
    spans a removed word).
  - `interface Candidate { id: string; game: GameId; phrase: string; scope: 'printing' | 'set' | 'global'; count: number; sellers: number; pkeys: string[]; sets: { language: string; setName: string }[]; cardIds: number[]; rarities: string[]; sampleTitles: string[] }`
  - `findCandidates(harvest: HarvestedPrinting[], knownKeys: ReadonlySet<string>, opts = { minCount: 4, minSellers: 3 }): Candidate[]`:
    counts 1–3 word n-grams from the runs. Scope: ≥ 60 % of its titles under one pkey → `printing`;
    else ≥ 3 pkeys all in one set → `set`; else ≥ 3 sets → `global`; otherwise dropped. Drops
    `knownKeys`, numbers-only phrases and phrases under the thresholds. A phrase is dropped when a
    longer phrase containing it has ≥ 80 % of its count. Sorted by `sellers` then `count`, descending.

- [ ] **Step 1: Failing tests** (inline fixtures):
  - 6 titles from 4 sellers for PAF 232 Mew ex, like "Mew ex 232/091 Bubble Mew SIR Paldean Fates PSA 10", plus noise → a `printing` candidate "bubble" with `pkeys = [PAF 232]`; "psa", "10", "paldean fates", "mew" and "232" are not candidates.
  - "trainer gallery" style: phrase "tg" on 4 printings of one set → `set` scope.
  - 5 titles all from one seller → dropped (`minSellers`).
  - A phrase in `knownKeys` → dropped.
- [ ] **Step 2:** Run `npm test -- --project main tests/main/terms-mine.test.ts`. FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. PASS.
- [ ] **Step 5:** Commit `feat(terms): mine candidate phrases from listing titles`.

### Task 15: Harvest job (targets, Claude, post) and workflow

**Files:**
- Create: `scripts/terms/targets.ts`, `scripts/terms/classify.ts`, `scripts/terms/harvest.ts`
- Create: `.github/workflows/terms.yml`
- Modify: `scripts/catalog/vite.config.ts` (add `terms-harvest` input), `package.json` (script
  `"terms:harvest": "vite build --config scripts/catalog/vite.config.ts && cross-env ELECTRON_RUN_AS_NODE=1 electron out/catalog/terms-harvest.mjs"`;
  devDependencies `@anthropic-ai/sdk`, `zod`)
- Test: `tests/main/terms-targets.test.ts`, `tests/main/terms-classify.test.ts`

**Interfaces:**
- Consumes: `findCandidates` (Task 14); portal `/admin/terms/known` + `/admin/terms/propose` (Task 10);
  `/v1/titles` + `/v1/quota` (Task 13); `pullGame`/`openDatabase` exactly as `scripts/catalog/snapshots.ts` does.
- Produces:
  - `pickPrintings(db: SqlDb, opts: { mode: 'recent' | 'backfill'; from: number; count: number; now: Date }): PrintingRef[]`:
    English (`language = 'en'`), `contributed = 0`, `market_price IS NOT NULL`, ranked by
    `market_price` desc **within each game**, then interleaved game by game. `recent`: sets with
    `tcg_date` 21–112 days before `now`, `market_price >= 5`, the top `count`. `backfill`: ranks
    `[from, from + count)` of the interleaved list.
  - `harvestQuery(p: PrintingRef): string`: pkm `"<name> <number>"` (the number part of `set_code`);
    ygo/op `"<name> <set_code>"`; mtg `"<name> <set name>"`.
  - `classify(client: Anthropic, game: GameId, cands: Candidate[]): Promise<Proposal[]>`: batches of
    20, `client.messages.parse({ model: 'claude-opus-5-5', max_tokens: 16000, output_config: { format: zodOutputFormat(ResultSchema) }, system, messages })`.
    If the installed SDK accepts it, send `betas: ['server-side-fallback-2026-07-01']` with
    `fallbacks: 'default'` through `client.beta.messages.parse`; otherwise skip a batch whose
    `stop_reason` is `refusal` and log it. Each target the model returns is checked against that
    candidate's own `pkeys/cardIds/sets/rarities`. A target outside them, or `verdict: 'junk'`, is
    dropped.
    `ResultSchema = z.object({ results: z.array(z.object({ id: z.string(), verdict: z.enum(['term','junk']), phrase: z.string(), kind: z.enum(['nickname','abbreviation','subset','rarity','cards']), targetKind: z.enum(['printing','card','set','rarity','cards']), target: z.object({ pkeys: z.array(z.string()), cardIds: z.array(z.number()), sets: z.array(z.object({ language: z.string(), setName: z.string() })), rarities: z.array(z.string()) }), reason: z.string() })) })`.
    The system prompt says: you're reviewing phrases from eBay listing titles for <game> cards; keep
    only phrases collectors use to mean a card, version, subset or rarity; drop seller spam, condition,
    grading, shipping and generic words; write the phrase the way collectors write it; pick targets
    only from the options given; give a one-sentence reason.
  - `Proposal` = the `/admin/terms/propose` item shape; `evidence = { titles: sampleTitles.slice(0, 5), count, sellers, reason }`.
  - `harvest.ts` main: env `PORTAL_URL`, `PORTAL_ADMIN_TOKEN`, `EBAY_PRICES_URL`, `HARVEST_TOKEN`,
    `ANTHROPIC_API_KEY`; args `--mode recent|backfill --from N --count N --dry-run`. Steps: pull
    catalogs → `pickPrintings` → check `/v1/quota`, `calls = min(count, remaining - 1500)`, stop if
    ≤ 0 → harvest sequentially (stop early on a 429) → `findCandidates` with known keys →
    `classify` → sort by sellers → first 100 → post (or print them, with `--dry-run`). It prints a
    summary: calls, titles, candidates, proposals, and an estimated Claude cost from `usage`.
- `terms.yml`: `schedule: - cron: '41 8 3 * *'` (monthly; mode `recent`, count 300) and
  `workflow_dispatch` inputs `mode` (choice recent/backfill, default recent), `from` (default 0),
  `count` (default 300), `dry_run` (boolean). Secrets: `PORTAL_ADMIN_TOKEN`, `HARVEST_TOKEN`,
  `ANTHROPIC_API_KEY`; `EBAY_PRICES_URL` as a repo variable. Same Node/Electron setup steps as
  `catalog.yml`.

- [ ] **Step 1: Failing tests:** `pickPrintings` backfill interleaves games and skips non-English and contributed rows; `recent` keeps only sets 21–112 days old. `classify` with a fake client returning one term with an out-of-options pkey and one junk result → `[]`. One valid result → a proposal with evidence sliced to 5 titles.
- [ ] **Step 2:** Run. FAIL.
- [ ] **Step 3:** Implement, and add the workflow.
- [ ] **Step 4:** Run, plus `npm run typecheck:node`. PASS.
- [ ] **Step 5:** Commit `feat(terms): harvest job and monthly workflow`.

### Task 16: Speed check, docs and release prep

**Files:**
- Create: `scripts/bench-search.ts` (like `scripts/bench-binders.ts`; a capped catalog of ≤ 50k printings, or the owner's real DB opened read-only when `DB=path` is given)
- Modify: `docs/superpowers/specs/2026-11-21-community-search-design.md` (record the numbers)

- [ ] **Step 1:** Run the bench on `main` and on the branch with the owner's DB read-only (`DB=~/.config/duel-binder/collection.db`), scope `mtg` and `pkm`. Queries: "charizard", "lightning bolt", "trainer gallery charizard", "mew sir", "charzard", 10 single letters. Report the median and p95 per query for `searchCards` and `listEntries`. Expected: plain-name medians within +2 ms of `main`.
- [ ] **Step 2:** If a plain-name query got slower, cache the sets/rarity lists (Task 4) and skip `parseFields` for one-word queries, then measure again.
- [ ] **Step 3:** Run the full checks: `npm test`, `npm run typecheck:node`, `typecheck:web`, `typecheck:phone`, and `npm run typecheck` + `npm test` in `workers/portal`.
- [ ] **Step 4:** Write the release steps in the PR description. Set the secrets (`HARVEST_TOKEN` on the ebay Worker and as a repo secret; `ANTHROPIC_API_KEY` repo secret; `EBAY_PRICES_URL` repo variable), then deploy ebay-prices (`npm run deploy` there), then deploy the portal from a fresh worktree (`npm ci`, `npm run deploy`), then tag the client. Then run `terms.yml` with `dry_run` and a small `count` (30), check the printed proposals, and run the backfill (`from` 0/3000/6000, `count` 3000) on separate days.
- [ ] **Step 5:** Commit `chore(search): speed check and release notes`.
