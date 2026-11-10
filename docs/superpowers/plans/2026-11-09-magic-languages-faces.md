# Magic step 2b: non-English printings and back faces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Magic's catalog gains every paper printing in ten more languages (Russian new to the app), each printing shows its own art, and two-faced cards can be flipped in details.

**Architecture:** The nightly Magic stage switches from Scryfall's `default_cards` to `all_cards`, slims objects while streaming, and the row builder and writer become per-language (one card per language per oracle card, as `mtgCardId(lang, …)` already allows). Four new columns carry the printed name, the card's language, the back-face image id and placeholder art redirection; the Worker's `/img` Magic branch serves backs and redirected art; the shared `CardPanel` gets a flip control.

**Tech Stack:** TypeScript, better-sqlite3 (desktop + catalog job), Durable Object SQLite (Worker), React (renderer shared by desktop, web and phone), vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-magic-languages-faces-design.md` (and its parent `docs/superpowers/specs/2026-11-09-magic-design.md`, whose anti-goals and Terms bind).

## Global Constraints

- Work in `/var/tmp/mtg-wt` on `feat/mtg-step2b`. Never touch the main checkout.
- vitest always with `--maxWorkers=2`. No test data over a few hundred rows (never 100k+ synthetic rows).
- Never reach live Scryfall in tests: fake `ScryfallSource` / fake `fetch` only.
- Never commit `.eslintcache`.
- Yu-Gi-Oh!, Pokémon and One Piece rows, ids, filters, sweeps, prices and scan paths must not change.
- English Magic ids, `pkey`s, `set_code`/`set_rarity` texts and prices must not change.
- Scryfall `lang` → app language: `en`→`en`, `ja`→`ja`, `ko`→`ko`, `de`→`de`, `fr`→`fr`, `it`→`it`, `es`→`es`, `pt`→`pt`, `zhs`→`zh-hans`, `zht`→`zh-hant`, `ru`→`ru`. Every other `lang` is dropped silently.
- New app language: `{ code: 'ru', tag: 'RU', label: 'Russian', yugipediaSuffix: null, ebayWord: 'Russian' }`, listed after `pt`.
- `crossLanguagePriceFallback` stays `false` for Magic; a non-English printing's price is only Scryfall's own.
- Back image id: `mtgBackImageId(scryfallId)` = `mtgId(\`${scryfallId.toLowerCase()}#back\`)`.
- `art_from` values: `null` (own image), a lowercase Scryfall UUID (that object's image), or `'none'` (no art; the Worker answers 404).
- Card art is never cropped, stretched, recoloured or watermarked.

## Review Focus

1. **Magic `zh-hans`/`zh-hant` printings and the swept-language price rule:** `src/main/repo/priceRule.ts` treats `zh-hans`/`zh-hant` as eBay-swept for every game; a Magic Chinese printing must still show only its own `market_price` (marketOnly), never a sweep or `set_price`. Test in Task 1.
2. **Adding `ru` to `LANGUAGES` changing another game:** language rank in scan (`src/main/repo/scan.ts:44`), binders' known codes, Worker contribute validation, sweeps. A Yu-Gi-Oh!/Pokémon/One Piece user sees no `RU` chip and no behaviour change. Test in Task 1.
3. **A second night over an all-language catalog** must diff to nothing (no row rewritten), including the new columns. Test in Task 5.
4. **A non-English printing whose card already exists in English with the same set + number** keeps its own `pkey` (language differs) and never takes over the English row (the takeover path keys by card id + code + rarity). Test in Task 5.
5. **Flip state leaking:** flipping one card's art and stepping to the next card (or re-opening) must show the front. Test in Task 8.

---

### Task 1: The `ru` language, Magic's language map, and the price-rule guard

**Files:**
- Modify: `src/shared/languages.ts` (union + `LANGUAGES` entry after `pt`)
- Modify: `src/shared/games/magic.ts` (language map)
- Test: `tests/main/languages.test.ts`, `tests/main/magic-languages.test.ts` (create), plus the price-rule test file that covers `priceRule.ts` (find it with `grep -rl priceRule tests`)

**Interfaces:**
- Produces: `MTG_LANGUAGES: Readonly<Record<string, Language>>` (Scryfall code → app code, the eleven in Global Constraints) and `mtgLanguageOf(scryLang: string): Language | null` in `src/shared/games/magic.ts`.

- [ ] **Step 1: Write the failing tests**
  - `languages.test.ts`: `languageInfo('ru')` is `{ code: 'ru', tag: 'RU', label: 'Russian', yugipediaSuffix: null, ebayWord: 'Russian' }`; `LANGUAGES.map(l => l.code)` equals `['en','ja','ko','de','fr','it','es','pt','ru','zh-hans','zh-hant','ae','ja-asia']`; `languageForSuffix` still maps every existing suffix and nothing to `ru`.
  - `magic-languages.test.ts`: `mtgLanguageOf('zhs') === 'zh-hans'`, `mtgLanguageOf('zht') === 'zh-hant'`, `mtgLanguageOf('ru') === 'ru'`, `mtgLanguageOf('en') === 'en'`, `mtgLanguageOf('ph') === null`, `mtgLanguageOf('qya') === null`, `Object.keys(MTG_LANGUAGES).length === 11`.
  - Price rule (Review Focus 1): a Magic printing with `language = 'zh-hans'`, `market_price = null` and a non-null `set_price` reads as unpriced; with `market_price = 2.5` reads 2.5. Write it against the function in `priceRule.ts` that picks a printing's price expression.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run --maxWorkers=2 tests/main/languages.test.ts tests/main/magic-languages.test.ts <price-rule test file>`
Expected: FAIL (`ru` unknown, `mtgLanguageOf` not defined; the price test fails only if the guard is missing — if it passes already, keep it as a regression test and note that in the report).

- [ ] **Step 3: Implement**
  - Add `ru` to the `Language` union and `LANGUAGES`.
  - Add `MTG_LANGUAGES` / `mtgLanguageOf` to `magic.ts`.
  - If the price test failed: make the swept-language branch in `priceRule.ts` apply only to games whose `priceRule` isn't `'marketOnly'`, leaving Yu-Gi-Oh!/Pokémon/One Piece output identical.
  - Audit every `LANGUAGES` / `Language` reader listed by `grep -rln "LANGUAGES\|isLanguage" src workers/portal/src scripts` and confirm adding `ru` changes no other game's behaviour (Review Focus 2). Language chips already only show languages with data. Record each file checked in the report.

- [ ] **Step 4: Run the tests, plus the language, scan-language, binder and sweep suites**

Run: `npx vitest run --maxWorkers=2 tests/main/languages.test.ts tests/main/magic-languages.test.ts tests/main/scan-language.test.ts tests/main/binderSchema.test.ts <price-rule test file>` and `cd workers/portal && npx vitest run --maxWorkers=2 test/` filtered to files matching `sweep|contribute`.
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(magic): Russian, and Magic's Scryfall language map`

---

### Task 2: New columns (desktop migration 45, server step) and `mtgBackImageId`

**Files:**
- Modify: `src/main/db/schema.ts` (`SCHEMA_V45`, `SCHEMA_V45_SERVER`, `MIGRATIONS` entry `{ version: 45, … }`)
- Modify: `src/shared/catalogTables.ts` (`mtg_cards` columns + `lang`, `local_name`; `mtg_images` columns + `back_image_id`, `art_from`)
- Modify: `workers/portal/src/migrate.ts` (a `server-43` step after `server-42`, following `dexNumberStep` / server-40: `SCHEMA_V45` SQL, drop and re-create both tables' seq triggers over frozen column lists `SERVER_43_MTG_CARDS` / `SERVER_43_MTG_IMAGES` that extend the server-42 ones)
- Modify: `src/shared/games/ids.ts` (`mtgBackImageId`, and the source-id comment)
- Check: the phone's store (`src/phone/data/store.ts`) and `src/main/catalog/apply.ts` pick up the columns from `catalogTables.ts` without edits; change them only if they list columns themselves.
- Test: `tests/main/migration-v45.test.ts` (create, modelled on `migration-v44.test.ts`), the Worker migration test that covers server-42, `tests/main/ids.test.ts` or wherever `mtgImageId` is tested.

**Interfaces:**
- Produces columns: `mtg_cards.lang TEXT NOT NULL DEFAULT 'en'`, `mtg_cards.local_name TEXT`, `mtg_images.back_image_id INTEGER`, `mtg_images.art_from TEXT`; indexes `ix_mtg_cards_local_name ON mtg_cards(local_name COLLATE NOCASE)` and `ix_mtg_images_back ON mtg_images(back_image_id)`.
- Produces: `mtgBackImageId(scryfallId: string): number` in `src/shared/games/ids.ts`.

- [ ] **Step 1: Write the failing tests**
  - Migration 45 on a v44 database holding one `mtg_cards` and one `mtg_images` row: the rows keep their values, `lang = 'en'`, `local_name`, `back_image_id`, `art_from` are null; both indexes exist; the `mtg_cards` rollup triggers still fire.
  - Worker: after `server-43`, updating `mtg_images.back_image_id` or `mtg_cards.local_name` bumps that row's `catalog_seq` (the same assertion the server-40 test makes for `dex_no`).
  - `mtgBackImageId('ABC…uuid')` equals `mtgId('abc…uuid#back')`, lies in [2^38, 2^39), and differs from `mtgImageId` of the same id.

- [ ] **Step 2: Run them to see them fail** — `npx vitest run --maxWorkers=2 tests/main/migration-v45.test.ts` (and the Worker test from `workers/portal`). Expected: FAIL.

- [ ] **Step 3: Implement** the migration, server step, catalog table columns and `mtgBackImageId`.

- [ ] **Step 4: Run them, plus `migration-v44.test.ts` and the catalog-feed / apply tests** (`grep -rl "catalogTables\|CATALOG_TABLES" tests`). Expected: PASS.

- [ ] **Step 5: Commit** — `feat(magic): columns for languages, printed names, back faces and borrowed art`

---

### Task 3: Read `all_cards`, slimmed while streaming

**Files:**
- Modify: `scripts/catalog/magic/types.ts`, `scripts/catalog/magic/scryfall.ts`
- Test: `tests/main/magic-scryfall.test.ts`

**Interfaces:**
- `ScryCard` gains `printed_name?: string`, `image_status?: string`; `ScryFace` gains `printed_name?: string`. Fields the job never reads are dropped by `slimCard`.
- Produces: `slimCard(c: ScryCard): ScryCard` (keeps exactly the fields `rows.ts` reads, and of `image_uris` only whether it exists: `image_uris: {}` when present on the object or a face), `isKept(c)` now `mtgLanguageOf(c.lang) !== null && c.games.includes('paper') && c.digital !== true`. `bulkInfo()` reads the `all_cards` entry.
- `ScryfallSource.cards(uri)` yields slimmed objects.

- [ ] **Step 1: Write the failing tests**
  - `bulkInfo` picks the `all_cards` entry from a fake bulk-data list that has both `default_cards` and `all_cards`, and throws `Scryfall bulk-data has no all_cards entry` without it.
  - `isKept`: `lang: 'ja'` paper kept; `lang: 'zhs'` kept; `lang: 'ph'` dropped; digital `ru` dropped.
  - `slimCard` on a full object (with `legalities`, `purchase_uris`, `related_uris`, `prices.eur`, full `image_uris`) returns no `legalities`/`purchase_uris`/`related_uris`, keeps `prices.usd`/`usd_foil`/`usd_etched`, `printed_name`, `image_status`, faces' `printed_name`, and `image_uris` as `{}` on the object/face that had them.
  - `cards()` over a fake gzipped JSONL body yields slimmed objects.

- [ ] **Step 2: Run them to see them fail** — `npx vitest run --maxWorkers=2 tests/main/magic-scryfall.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** `cards()` maps every parsed line through `slimCard` before yielding.

- [ ] **Step 4: Run them.** Expected: PASS.

- [ ] **Step 5: Commit** — `feat(magic): read Scryfall's all_cards file, slimmed as it streams`

---

### Task 4: Rows per language, back faces and borrowed art

**Files:**
- Modify: `scripts/catalog/magic/rows.ts`
- Test: `tests/main/magic-rows.test.ts`

**Interfaces:**
- Consumes: `mtgLanguageOf` (Task 1), `mtgBackImageId` (Task 2), slimmed `ScryCard` (Task 3).
- Produces (changes to existing row types):
  - `MtgCardRow` gains `lang: Language`, `localName: string | null`; `id` = `mtgCardId(lang, oracleId)`.
  - `MtgImageRow` gains `backImageId: number | null`, `artFrom: string | null`.
  - `MtgPrintingRow` gains `language: Language`.
  - `MtgSetRow` gains `language: Language`; `MagicRows.sets` is keyed `` `${language}|${code}` ``.
  - The duplicate-printing check keys by language too.

Rules (from the spec):
- Card: game text (name, types, text, stats, faces JSON) comes from the English oracle card when the file has one (any English object with that oracle id), else from the object itself. `localName` = `printed_name`, or face `printed_name`s joined with `' // '`; null when absent or equal to the English name; always null for English.
- `backImageId` = `mtgBackImageId(o.id)` when `card_faces` has length ≥ 2 and every face has `image_uris`; else null.
- `artFrom`: when `image_status` is `'placeholder'` or `'missing'`: the id of the English object with the same set + collector number whose own `image_status` is neither, else `'none'`. Otherwise null. (English objects with those statuses get `'none'`.)

- [ ] **Step 1: Write the failing tests** (small hand-built objects, a few per test)
  - A `ja` object of an oracle id that also has an English object → card id `mtgCardId('ja', oracle)`, `name` the English name, `localName` the `printed_name`, `lang: 'ja'`; printings `language: 'ja'`; set row keyed `ja|MH3`.
  - A `ja` object listed **before** its English object in the file still gets the English game text.
  - A `ru` object whose oracle id has no English object keeps its own name and text.
  - A transform object whose two faces have `image_uris` → `backImageId === mtgBackImageId(id)`; an adventure object (no face images) → null.
  - A `de` placeholder object with an English twin (same set and number, `highres_scan`) → `artFrom` the English id; with no twin → `'none'`; an English `missing` object → `'none'`; a `lowres` object → null.
  - The same `set` + collector number + finish in `en` and `fr` gives two printings, no duplicate note.
  - Existing English expectations in the file still pass unchanged (English ids, codes and rarity texts identical).

- [ ] **Step 2: Run them to see them fail** — `npx vitest run --maxWorkers=2 tests/main/magic-rows.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Two passes over the objects (the first indexes English oracle cards and English set + number → id/status), or one pass that defers the non-English card text; the builder's choice, as long as the input is read only once from the stream (Task 6 collects the slimmed objects in an array).

- [ ] **Step 4: Run them.** Expected: PASS.

- [ ] **Step 5: Commit** — `feat(magic): rows for every language, back faces and borrowed art`

---

### Task 5: Write every language

**Files:**
- Modify: `scripts/catalog/magic/write.ts`
- Test: `tests/main/magic-write.test.ts`

**Interfaces:**
- Consumes: Task 4's row types; Task 2's columns.
- `MagicReport` gains `byLanguage: Record<string, { cards: number; printings: number; priced: number }>`. `perSet` stays English-only (the priced-share check is meaningful only there).
- `WriteMagicOpts.idOf.card` becomes `(lang: Language, oracleId: string) => number`.

Changes:
- Every `'en'` literal in statements becomes the row's language (sets, printings, the existing-printings load, `perSet`'s join keeps `p.language = 'en'`).
- Collision check: card pairs keyed `` `${lang}/${oracleId}` `` (read back from `mtg_cards.lang`, `oracle_id`); image pairs also include each non-null `backImageId` keyed `` `${scryfallId}#back` ``.
- `mtg_cards` upsert gains `lang`, `local_name`; `mtg_images` upsert gains `back_image_id`, `art_from` (both in the "only when changed" `WHERE`).
- The short-file guard counts all languages (unchanged formula).

- [ ] **Step 1: Write the failing tests**
  - A night with an English and a Japanese object of one oracle card: two `cards` rows, two `mtg_cards` rows with `lang` `en`/`ja` and `local_name` null/printed; `sets` has `('mtg','en','Modern Horizons 3')` and `('mtg','ja','Modern Horizons 3')`; Japanese printings have `language = 'ja'` and keep `set_code = 'MH3 123'`.
  - **Review Focus 4:** the Japanese printing of the same set + number + finish is inserted as its own row; the English row's id, `set_rarity_code` and price don't change; no "key taken" note.
  - **Review Focus 3:** running the same rows twice changes nothing on the second night (`total_changes()` delta 0, or every table's `catalog_seq`-free row count and contents equal).
  - `back_image_id` and `art_from` are written and a later night that clears `art_from` (twin got a real image) updates it.
  - A back-image id colliding with another image id (via `idOf`) throws `Magic id collision`.
  - `report.byLanguage.ja.printings` counts the Japanese rows; `report.perSet` lists English sets only.
  - The existing English tests still pass unchanged.

- [ ] **Step 2: Run them to see them fail** — `npx vitest run --maxWorkers=2 tests/main/magic-write.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run them.** Expected: PASS.

- [ ] **Step 5: Commit** — `feat(magic): write every language`

---

### Task 6: The stage, its log and the workflow

**Files:**
- Modify: `scripts/catalog/magic/index.ts`, `.github/workflows/catalog.yml`
- Test: `tests/main/magic-step.test.ts`

Changes:
- `runMagicStep` keeps slimmed objects (Task 3 already slims them).
- `logMagic`: the summary line becomes `Magic (<updatedAt>): <sets> sets, <cards> cards, <images> images, <printings> printings (<priced> priced), <missing> missing, <notes> notes`, then one line per language in `MTG_LANGUAGES` order: `Magic <lang>: <cards> cards, <printings> printings (<priced> priced)`, then the existing low-share lines (English sets) and notes.
- `catalog.yml`: the `Refresh Magic` step's `timeout-minutes` from 60 to 90 (a 400 MB download plus five times the rows). The upload step has no timeout of its own and stays so; the job's 340 minutes is the ceiling.

- [ ] **Step 1: Write the failing tests** — a fake source with English + Japanese + Russian objects: the log has the summary line and `Magic ja: 1 cards, …` / `Magic ru: …` lines in map order; priced-share problems are computed from English sets only.
- [ ] **Step 2: Run them to see them fail** — `npx vitest run --maxWorkers=2 tests/main/magic-step.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** — `feat(magic): the stage reports every language`

---

### Task 7: The Worker serves backs and borrowed art

**Files:**
- Modify: `src/shared/imageSources.ts` (`scryfallArtUrl(scryfallId, size, face: 'front' | 'back' = 'front')`)
- Modify: `workers/portal/src/images.ts` (the `game === 'mtg'` branch of `resolve`)
- Test: `tests/main/scryfall-art.test.ts`, the Worker images test (find with `grep -rl "scryfall" workers/portal/test`)

Rules:
- `SELECT scryfall_id, art_from FROM mtg_images WHERE image_id = ?` → front. If no row: `SELECT scryfall_id, art_from FROM mtg_images WHERE back_image_id = ?` → back. No row either → `null` (404).
- `art_from = 'none'` → `null`. A UUID `art_from` → that id's image (same face). Else the row's own `scryfall_id`.
- R2 key stays `cardArtKey(kind, n)` for the requested id `n`.

- [ ] **Step 1: Write the failing tests**
  - `scryfallArtUrl(id, 'small', 'back')` → `https://cards.scryfall.io/normal/back/<a>/<b>/<id>.jpg`; default face is front (existing assertions unchanged).
  - Worker: a back id fetches the `/back/` URL from upstream (fake fetch records it) and stores under `card/small/<backId>`; an `art_from` UUID fetches that UUID's URL; `art_from = 'none'` → 404 with no upstream fetch; an unknown Magic id → 404.
- [ ] **Step 2: Run them to see them fail** (desktop test from the repo root; Worker test from `workers/portal`, both `--maxWorkers=2`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** — `feat(portal): Magic back faces and borrowed art`

---

### Task 8: The app: each printing's own art, the printed name, search, and the flip

**Files:**
- Modify: `src/main/repo/cards.ts` (`printingArtImageId`, `getCardDetail` images, `MTG_COLS`/`magicFacts` for `local_name`, name search)
- Modify: `src/shared/types.ts` (`CardImage.backImageId?: number`; `MagicFacts.localName`)
- Modify: `src/shared/games/magic.ts` (details entry `{ key: 'localName', label: 'Printed name' }` right after `typeLine`)
- Modify: `src/main/repo/mtgFilters.ts` if its text search reads card names (mirror `pkmFilters.ts`' `local_name` match)
- Modify: `src/renderer/src/features/card/CardPanel.tsx` (flip control)
- Test: `tests/main/cards*.test.ts` covering `printingArtImageId` / `getCardDetail` (find with grep), `tests/main/mtg-filters.test.ts`, and the CardPanel test (find with `grep -rl CardPanel tests`; create `tests/renderer/card-panel-flip.test.tsx` if none fits).

Rules:
- `printingArtImageId`: for a Magic, non-contributed row → `mtgImageId(set_rarity_code)`; One Piece unchanged; other games null. (`cardImage` already checks the image belongs to the card.)
- `getCardDetail` images: for Magic, `LEFT JOIN mtg_images` and set `backImageId` when `back_image_id` is not null; other games' `CardImage` objects stay exactly `{ imageId, cardId, sortOrder }`.
- Search: a Magic query matches `mtg_cards.local_name` (`LIKE %q%`, as Pokémon's block in `searchCards` does).
- Flip: when the shown art's image (looked up in `detail.data.images` by `imageId`) has `backImageId`, `CardPanel` shows a "Flip" button (an icon button with `aria-label="Show back face"` / `"Show front face"`) on the art; pressing it swaps the shown image id to the back and back again. The flip state resets to front whenever the shown card or printing changes (Review Focus 5). The art keeps its 488 × 680 aspect and is never cropped.

- [ ] **Step 1: Write the failing tests**
  - Two English printings of one Magic card from different Scryfall objects → `rowToPrinting(...).artImageId` is each one's own `mtgImageId`; a Yu-Gi-Oh! and a Pokémon printing → `undefined`/null as today.
  - `getCardDetail` on a Magic card whose image has `back_image_id` → that `CardImage.backImageId`; a Yu-Gi-Oh! card's images deep-equal the old shape.
  - Details: a Japanese Magic card's `magic.localName` is its printed name; searching its printed name finds it; searching an English name finds both the English and Japanese cards.
  - CardPanel: with a back image, the button shows; clicking it swaps the `img` src to the back id's URL and its label to "Show front face"; selecting another printing (or re-rendering with another card) shows the front again; without a back image there is no button.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them, then the full suite once:** `npx vitest run --maxWorkers=2` and `npm run typecheck` (or the repo's equivalent in `package.json`) and `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat(magic): each printing's own art, printed names, and flipping two-faced cards`

---

### Task 9 (controller, not a subagent): the real-file run

Not code: the measurement the spec requires before the PR merges.

- [ ] Run the Magic stage locally against `/var/tmp/scry/all-cards.jsonl.gz` (the 2026-11-09 file) into a copy of a work database seeded from the current catalog, via a throwaway script in `/var/tmp` that passes a `ScryfallSource` reading the local file (no network; `bulkInfo` returns a file URL, `sets()` from a saved `sets.json` fetched once by hand). Report: rows per table and language, the database's growth, peak RSS (`/usr/bin/time -v`), stage time, notes.
- [ ] Stop and report instead of opening the PR if desktop growth > 1 GB or peak memory > 3 GB.
- [ ] Spot-check in the real app (desktop dev build pointed at the local database): a Japanese and a Russian card in Browse with the language chips, a placeholder card showing English art, a transform card flipping, two printings of one card showing different art.
