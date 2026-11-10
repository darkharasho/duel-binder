# Magic Step 1: the Empty, Hidden Game — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Magic's permanent identity (game id `'mtg'`, id range, tables, keys), hidden behind
the existing tester list, with no data and no visible change for anyone but the owner.

**Spec:** `docs/superpowers/specs/2026-11-09-magic-design.md`, sections "Identity" and "Step 1".

**The template:** One Piece did exactly this in PR #180, squashed as `d9c36b3a`. For any file
below, `git show d9c36b3a -- <path>` shows how One Piece was wired there. Its plan is
`docs/superpowers/plans/2026-11-04-one-piece-step1-hidden-game.md`. Copy the shape, not the
One Piece specifics. The tester list (`game_testers`, server-36), the `/admin` Testers panel,
`gamesFor` and `allowedGames` already exist and are game-generic; Magic only joins them.

**Architecture:**
- **Registry.** `'mtg'` joins `GameId` and `GAME_IDS` (after `'op'`). Its `GameDef` is `MAGIC` in
  `src/shared/games/magic.ts`, with `access: 'testers'`.
- **Ids.** `mtgId(sourceId)` hashes into `[2^38, 2^39)`. `gameOfId` splits at 2^40 (pkm), 2^39
  (op), 2^38 (mtg). Everything that decides game from an id goes through `gameOfId` already
  (One Piece's Task 2 did that), so only the boundary moves.
- **Card model.** A `cards` row is one oracle card per language (`mtgCardId('en', oracleId)`). A
  `card_images` row is one Scryfall object (`mtgImageId(scryfallId)`). A `card_printings` row is one
  Scryfall object × finish, `set_code` `'MH3 123'`, `set_rarity` `'Rare'` / `'Rare (Foil)'` /
  `'Mythic (Etched Foil)'`, `set_rarity_code` the Scryfall id.
- **Tables.** Desktop step V44 creates `mtg_cards` and `mtg_images` (with rollup triggers on
  desktop and phone). On the server, `server-42` creates them without rollups, adds `catalog_seq`,
  its index and the seq triggers with game `'mtg'`.

**Test commands:**
- One file: `npm test -- tests/main/games.test.ts` (the root script already passes `--maxWorkers=2`;
  its `portal` project covers `tests/portal/**` on better-sqlite3).
- Everything: `npm test`. Real DO SQLite: `npm --prefix workers/portal test`.
- Types and lint: `npm run typecheck && npm --prefix workers/portal run typecheck && npm run lint`.

## Global Constraints

- Vitest at most 2 workers (already in the scripts; don't add another flag).
- No heavy test data: fixtures are a handful of rows, never 100k+.
- DO SQLite rejects ~10-term compound UNIONs; one query per table in the Worker.
- Hot portal queries use `+game = ?` (`tests/portal/game-index-plans.test.ts`).
- Migrations are append-only. Never edit a shipped step in `MIGRATIONS` (`src/main/db/schema.ts`)
  or `SERVER_STEPS` (`workers/portal/src/migrate.ts`). The DO can't turn foreign keys off.
  The next desktop step is **44**; the next server step is **`server-42`**.
- Yu-Gi-Oh, Pokémon and One Piece don't regress: their ids, keys, wire formats, sync, prices,
  scan and fingerprint files stay byte-identical. The existing golden-id tests must pass unchanged.
- Magic doesn't leak early: only the owner and accounts on its tester list see it, enforced by the
  server. Card art at `/img` is not hidden (as for One Piece).
- `src/shared/games/` stays free of Node and Electron imports (the phone build rejects them).
- Magic values, fixed here:
  - `id: 'mtg'`, `name: 'Magic'`, `color: '#c2410c'`
  - `features: { scan: false, pokedex: false }`
  - `cardAspect: { width: 488, height: 680 }`
  - `crossLanguagePriceFallback: false`, `priceRule: 'marketOnly'`, `access: 'testers'`
- Deploy the portal before any client release. Don't deploy or release without the owner's go.

## Review Focus

- **An id below 2^39 that isn't Magic.** Yu-Gi-Oh ids (passcodes, YGOPRODeck ids, token ids) are
  all below 2^31, far under 2^38. Pin it: `gameOfId(2 ** 31)` and `gameOfId(2 ** 38 - 1)` are
  `'ygo'`, `gameOfId(2 ** 38)` is `'mtg'`, `gameOfId(2 ** 39 - 1)` is `'mtg'`, `gameOfId(2 ** 39)` is
  `'op'`.
- **A fourth game falling into a Yu-Gi-Oh or Pokémon default.** Binary `pkm ? … : ygo` and
  three-way `pkm / op / else-YGO` branches are where it happens. Task 5 lists them.
- **The image proxy fetching YGOPRODeck for a Magic id.** Until step 2 adds Scryfall, a Magic image
  id answers 404 at `/img`, never a YGOPRODeck request.
- **The catalog feed.** `catalogTables.ts` `ALL` gates which games each table's rows go to; leaving
  `'mtg'` out silently drops step 2's catalog.

---

### Task 1: Magic in the registry, ids and the access rule

**Files:**
- Create: `src/shared/games/magic.ts`
- Modify: `src/shared/games/types.ts` (`GameId`, `GAME_IDS`), `src/shared/games/ids.ts`
  (`MTG_ID_MIN`, `mtgId`, `mtgCardId`, `mtgImageId`, `gameOfId`), `src/shared/games/index.ts`
  (`GAMES`, `printingNoun`), and every `Record<GameId, …>` / `byGame` site the compiler flags.
- Test: `tests/main/games.test.ts`, `tests/main/cloud-sync-games.test.ts`

**Compiler-flagged sites** (each needs a Magic value; neutral in step 1: empty list, plain label,
grey or the game colour):
- `src/shared/binders.ts` (RULE_FIELDS, GOALS): Magic gets the generic fields only.
- `src/main/index.ts` (per-game fingerprint stores)
- `src/main/ipc/handlers.ts`
- `src/main/dev/capture.ts` (SHOTS: empty)
- `src/main/repo/browse.ts` (`sortSql`): Magic sorts that don't exist fall back to name.
- `src/main/repo/cards.ts` (game join): Magic joins `mtg_cards` once Task 2 lands; until then
  no join.
- `src/main/repo/stats.ts` (`byFrameType`): `[]` for Magic.
- `src/renderer/src/components/ArtWash.tsx` (GLOW): a burnt-orange glow from `#c2410c`.
- `src/renderer/src/components/CardPlaceholder.tsx`: a plain `MtgPlaceholder` at 488 × 680 with
  `data-game="mtg"`, modelled on `OpPlaceholder`.
- `src/renderer/src/lib/rarityColors.ts`: `MAGIC_COLORS` for Common (grey), Uncommon (silver),
  Rare (gold), Mythic (orange-red), Special (purple), Bonus (teal). Matching is on the rarity
  word before any ` (` bracket.
- `src/renderer/src/lib/filters.ts` (HIDDEN_SORTS): hide `atk`, `def`, `level`, `hp` for Magic.
- `src/renderer/src/features/sets/SetsPage.tsx` (`bySeries`), `SetChecklist.tsx` (`onlySet`):
  Magic takes the plain path.
- `workers/portal/src/scanFiles.ts` (KEYS): `scan/mtg/fingerprints.bin`, as op's form.
- Tests that pin the list: `tests/main/cloud-sync-games.test.ts`.

`src/main/db/meta.ts` MetaKeys `catalog_cursor:mtg` and `catalog_staging_cursor:mtg` belong to
Task 2.

Not flagged (`Partial<Record<GameId,…>>`): `src/shared/scan/profiles.ts` SCAN_PROFILES,
`cardBacks.ts`, `tiltFeatures.ts`, `tiltModel.ts`, `tiltRead.ts`. Leave Magic out (scan is off)
and add a one-line `// mtg: scanner step` comment by SCAN_PROFILES, as One Piece did.

**`magic.ts`:** modelled on `onePiece.ts`.
- `vocab`: card id "Card", printing code "Set & number", rarity "Rarity" (use the vocab fields
  `onePiece.ts` has; if a field is "Version", Magic's is "Finish").
- `filters`: `mtgColors` (Color), `mtgTypes` (Type), `mtgRarities` (Rarity), `mtgFinishes`
  (Finish), `mtgSetTypes` (Set type), ranges `manaValue` (Mana value), `mtgPower` (Power),
  `mtgToughness` (Toughness). Wherever filter keys are typed or handled (follow how `op*` keys are
  declared), they're accepted and ignored until step 2. If declaring them means wiring SQL now,
  declare only what compiles cleanly and leave the rest for step 2 with a comment.
- `details`: type line, mana cost, mana value, colors, rules text, power/toughness, loyalty,
  defense, artist, set & number (keys mirror `mtg_cards` columns from Task 2).
- `MTG_RARITIES = ['Common', 'Uncommon', 'Rare', 'Mythic', 'Special', 'Bonus']` exported.

**`ids.ts`:**
```ts
/** Magic ids live in [2^38, 2^39): above every Yu-Gi-Oh! id, below One Piece's. */
export const MTG_ID_MIN = 2 ** 38

/** `mtg:${sourceId}`, first 52 bits of SHA-256 (as onePieceId), mod 2^38, plus 2^38.
 *  Source ids (permanent once shipped):
 *  - a card is one oracle card per language: `mtgCardId('en', oracleId)` = `mtgId('en/<oracle_id>')`
 *  - an image is one Scryfall object: `mtgImageId(scryfallId)` = `mtgId('<scryfall id>#img')`
 *  Callers use the wrappers, never the strings. */
export function mtgId(sourceId: string): number { /* as onePieceId with 'mtg:' and lo = 2n ** 38n */ }
export const mtgCardId = (lang: string, oracleId: string): number => mtgId(`${lang}/${oracleId}`)
export const mtgImageId = (scryfallId: string): number => mtgId(`${scryfallId}#img`)

export function gameOfId(id: number): GameId {
  return id >= PKM_ID_MIN ? 'pkm' : id >= ONEPIECE_ID_MIN ? 'op' : id >= MTG_ID_MIN ? 'mtg' : 'ygo'
}
```
Lowercase the Scryfall UUIDs before hashing (Scryfall serves them lowercase; normalise anyway).

- [ ] **Step 1: Write the failing tests** in `tests/main/games.test.ts`:
  - `mtgId` lands in `[2^38, 2^39)` for 1,000 random UUID-like strings, and is a safe integer.
  - Golden values: `mtgCardId('en', 'e3285e6b-3e79-4d7c-bf96-d920f973b122')` and
    `mtgImageId('77c6fa74-5543-42ac-9ead-0e890b188e99')` (Lightning Bolt's oracle id and a Scryfall
    id). Compute them once from the implementation and pin the numbers, with a comment that they
    are permanent once shipped.
  - Existing golden values (`pokemonId('en/me05-068') = 2449488009539745` and the One Piece ones)
    pass unchanged.
  - The `gameOfId` boundaries listed in Review Focus.
  - `GAMES.mtg` has the fixed values from Global Constraints.
  - `allowedGames`: a non-owner without tester rows gets `['ygo','pkm']`; the owner gets
    `['ygo','pkm','op','mtg']`; a viewer with `testerGames: ['mtg']` gets `['ygo','pkm','mtg']`.
  - `cloud-sync-games.test.ts`: `gamesOf({ games: ['ygo','mtg','xyz'] })` is `['ygo','mtg']`.
- [ ] **Step 2: Run them and check they fail.**
- [ ] **Step 3: Implement,** then fix every typecheck error with the neutral Magic value above.
- [ ] **Step 4: Run** `npm run typecheck && npm --prefix workers/portal run typecheck && npm test -- tests/main/games.test.ts tests/main/cloud-sync-games.test.ts`. PASS.
- [ ] **Step 5: Commit.** `feat(games): Magic game id, id range and tester access`

### Task 2: The `mtg_cards` and `mtg_images` tables everywhere

**Files** (`git show d9c36b3a -- <path>` for each One Piece version):
- Modify: `src/main/db/schema.ts` (`MTG_TABLES`, `SCHEMA_V44`, `SCHEMA_V44_SERVER`, `MIGRATIONS`)
- Modify: `workers/portal/src/migrate.ts` (`server-42`: frozen SQL constants, `catalog_seq`,
  index, `seqTriggers(t, "'mtg'")`; model on `onePieceStep()`)
- Modify: `src/shared/catalogTables.ts` (`ALL` gets `'mtg'`; `mtg_cards` and `mtg_images` entries
  with `games: ['mtg']`, in the One Piece entries' position and shape). `LEGACY_CATALOG_TABLES`
  stays untouched.
- Modify: `src/main/db/meta.ts` (`catalog_cursor:mtg`, `catalog_staging_cursor:mtg`),
  `src/main/catalog/apply.ts`, `src/phone/data/store.ts` (cursor, reset of old format, PHONE_TABLES
  or its equivalent), and whatever delete/apply rules list per-game tables (follow every place
  `onepiece_images` appears: `grep -rn onepiece_images src workers scripts tests`).
- Modify: test fixtures: add `seedMagic` next to `seedOnePiece` (one card, two images, three
  printings: `'Rare'`, `'Rare (Foil)'` and a second object's `'Rare'`, and one set).
- Modify: tests that pin `user_version` 43 → 44 and `server-41` → `server-42` (e.g.
  `tests/main/database.test.ts`, `tests/portal/migrate.test.ts`, the tombstone query census).

**SQL (`MTG_TABLES`):**
```sql
CREATE TABLE mtg_cards (card_id INTEGER PRIMARY KEY REFERENCES cards(id),
  oracle_id TEXT NOT NULL, layout TEXT NOT NULL DEFAULT 'normal',
  type_line TEXT NOT NULL DEFAULT '', types TEXT NOT NULL DEFAULT '[]',
  mana_cost TEXT, mana_value REAL, colors TEXT NOT NULL DEFAULT '[]',
  color_identity TEXT NOT NULL DEFAULT '[]', oracle_text TEXT,
  power TEXT, toughness TEXT, loyalty TEXT, defense TEXT,
  keywords TEXT NOT NULL DEFAULT '[]', faces TEXT);
CREATE INDEX ix_mtg_cards_oracle ON mtg_cards(oracle_id);
CREATE TABLE mtg_images (image_id INTEGER PRIMARY KEY REFERENCES card_images(image_id),
  scryfall_id TEXT NOT NULL, illustration_id TEXT, artist TEXT,
  frame TEXT, border_color TEXT, full_art INTEGER NOT NULL DEFAULT 0,
  promo_types TEXT NOT NULL DEFAULT '[]');
CREATE INDEX ix_mtg_images_scryfall ON mtg_images(scryfall_id);
CREATE INDEX ix_mtg_images_illustration ON mtg_images(illustration_id);
```
`types` is the parsed card types (`["Creature","Artifact"]`) for the Type filter; `faces` is the
JSON array of per-face fields for two-faced cards (NULL otherwise). Power and toughness stay TEXT
(`*`, `1+*`); step 2 casts for the range filter.

`SCHEMA_V44` = `MTG_TABLES` + `rollupTriggers('mtg_cards', ['card_id','types','colors','mana_value'])`.
`SCHEMA_V44_SERVER = MTG_TABLES`. Entry: `{ version: 44, sql: SCHEMA_V44, server: SCHEMA_V44_SERVER }`
(match how V40 is declared). Server: `server-42` with frozen copies of the two CREATE TABLEs, then
`catalog_seq`, index and `seqTriggers` for both tables, as `onePieceStep()`.

- [ ] **Step 1: Write the failing tests**: migrate a fresh desktop DB and the phone DB to 44, and
  the server to `server-42`; both tables exist; the seq triggers stamp `catalog_seq` and write
  tombstones with game `'mtg'`; `seedMagic` rows flow through the catalog feed for an allowed
  viewer (`?game=mtg`) and apply on a client into `mtg_cards`/`mtg_images`; a cursor
  `catalog_cursor:mtg` is stored; a rollup is dropped by a `mtg_cards` write.
- [ ] **Step 2: Run them and check they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run typecheck && npm test && npm --prefix workers/portal test`. PASS.
- [ ] **Step 5: Commit.** `feat(db): mtg_cards and mtg_images on desktop, phone and server (V44, server-42)`

### Task 3: Images, catalog load and the dev sources treat Magic as its own game

**Files:**
- `workers/portal/src/images.ts`:
  - `cardArtKey` (~:287): Magic uses `card/{full|small}/<id>`, as op (no cropped).
  - `resolve()` card path (~:418-490): a Magic image id with no R2 object answers 404 with no
    upstream fetch. Comment: `// mtg: Scryfall source in step 2`. It must never reach YGOPRODeck.
  - Set keys (~:491-540): no Magic set-art prefix yet; make sure a Magic set key can't be built,
    or if the code path is reachable, an unknown prefix for a Magic set answers 404 (check how
    set keys are derived and decide; don't change Yu-Gi-Oh behaviour).
  - Printing photos (~:574): Magic has none (skip as op).
- `workers/portal/src/catalogLoad.ts:111`: Magic printings' versions are sticky like pkm/op
  (`missing_from_api` instead of delete). `:82` row id must match the game: covered by `gameOfId`.
- `src/main/dev/directSources.ts:51-71`: Magic returns no source (null), never the Pokémon path.
- `src/shared/imageSources.ts`: nothing yet.

- [ ] **Step 1: Failing tests:** `tests/portal/mtg-art.test.ts` (or the existing image test file):
  `/img/small/<seedMagic image id>` signed out answers 404 and fetch is never called (stub
  `fetch` and assert zero calls); an R2 object at `card/small/<id>` is served. A directSources test
  that a Magic id yields no URL. A catalogLoad test that a Magic printing missing from a reload is
  flagged, not deleted.
- [ ] **Step 2–4:** fail, implement, pass (`npm test`, `npm --prefix workers/portal test`).
- [ ] **Step 5: Commit.** `feat(portal): Magic images and catalog load never fall into another game`

### Task 4: Hidden on every route, the admin panel, the fingerprint token

**Files:**
- Test: `tests/portal/mtg-hidden.test.ts`, a copy of `tests/portal/op-hidden.test.ts` with Magic
  (`seedMagic`, a tester with one Magic entry, wishlist row, favourite and binder; a non-tester
  friend; a tester friend).
- `tests/portal/testers.test.ts`: add Magic cases where it pins game lists (~:120,167,180).
- `workers/portal/src/adminPage.ts:16` and `src/renderer/src/features/admin/ListTabs.tsx:29`:
  TESTER_GAMES derive from `GAMES` where `access === 'testers'` (or add `'mtg'` if they're
  literal). `ListTabs.tsx:148` default stays sensible.
- `src/main/index.ts:417-421`: the desktop fingerprint fetch sends the token for any game whose
  `access !== 'everyone'`, not only `'op'`. Same check in the phone if it has an op-only branch.
- `src/phone/demo.ts:29`: the dev demo account lists `'mtg'` too.

- [ ] **Step 1: Write the tests** (all the op-hidden cases with Magic: 403s on RPC/sync/catalog
  feed for a non-tester, pushes not stored, fingerprints 404, friend views by the viewer's games,
  art not 403, removed tester, old client on a tester account). Add Magic to the Testers panel
  test: it lists Magic and adding a tester for Magic works.
- [ ] **Step 2: Run them;** whatever fails is a leak or a literal list. Fix it there.
- [ ] **Step 3–4:** implement, pass.
- [ ] **Step 5: Commit.** `feat(portal): Magic hidden on every data route, and in the Testers panel`

### Task 5: Audit every string branch on game

**Files:** the sites below. Tests: `tests/main/game-branches.test.ts` (extend with Magic) and
`tests/renderer/mtg-branches.test.tsx`.

**Rules** (One Piece's table, unchanged):

| Kind | Rule |
|---|---|
| **A.** `=== 'pkm'` / `=== 'op'` guarding that game's own behaviour | No change; Magic takes the other path only if it's game-neutral. |
| **B.** `=== 'ygo'` keeping a legacy key or URL | No change: Magic gets the `:${game}` / `-${game}` form. |
| **C.** A ternary or chain where "else" means Yu-Gi-Oh or Pokémon | Explicit with `byGame` (thunks where values are computed), Magic gets its own neutral value. |
| **D.** Validation of a closed game list | `isGameId(x)`. |
| **E.** Scan-only code | Leave it; add one `// mtg: scanner step` comment only where Magic would fall into another game's path. |
| **F.** SQL literals in a game's own job | No change; check the negative forms by hand. |

**Kind C, to change** (from the inventory; line numbers approximate):
- `src/main/repo/collection.ts:279-310` and `src/main/repo/browse.ts:132-160`: the filter
  chains (`pkm` / `op` / else YGO columns). Magic gets its own branch: in step 1 it applies only
  the generic filters (name, set, rarity, language, condition…) and ignores YGO ones.
- `src/main/repo/collection.ts:392-404`, `browse.ts:315-341` (facets): Magic returns empty game
  facets (no YGO facets).
- `src/main/repo/sets.ts:84-112` rarity-rank CASE: Magic ranks Common < Uncommon < Rare < Mythic
  < Special < Bonus (on the word before ` (`), not YGO words.
- `src/main/repo/sets.ts:38-50` SET_ART/SET_JOINS: Magic gets no pack key (NULL) in step 1;
  check it doesn't pick up a YGO pack_art row by set name.
- `src/main/repo/browse.ts:248`, `src/main/repo/shownPrinting.ts:13`: `p.game = 'pkm'` /
  `<> 'pkm'` for `missing_from_api` stickiness. Magic must behave like pkm/op (sticky versions
  shown when owned). Decide and make it `p.game IN ('pkm','op','mtg')` / the negation, or
  whatever matches how op behaves today; check op first and give Magic the same.
- `src/shared/chaseRarity.ts:25-30`: Magic: Mythic and Special/Bonus are chase; not YGO regexes.
- `src/shared/catalogTables.ts:24`: done in Task 2.
- `src/shared/setTypes.ts:44-45`: Magic sets are `'booster'` until step 2 (acceptable; comment).
- `src/renderer/src/features/card/CardPanel.tsx:165,180`, `CardTypeList.tsx:196,233`:
  Magic takes the generic printing list.
- `src/renderer/src/features/binders/binderSort.ts:69-76`: Magic sorts by name/number, not YGO
  frames.
- `src/renderer/src/lib/filters.ts:74`: Magic shows the Rarity filter.
- `src/shared/scan/types.ts:75` `game?: 'pkm' | 'op'`: widen only if a type error forces it.
- `scripts/catalog/build.ts:255` (fixtures dir), `scripts/catalog/fingerprints.ts:169-171…`,
  `scripts/catalog/accuracy.ts`, `scripts/catalog/parity.ts:14` (`GAMES` list: add `'mtg'` so
  parity checks it): build/fingerprint paths for Magic don't run until the scanner; make
  `fingerprint(upload, 'mtg')` impossible (no stage) and add comments where a fall-through to
  YGOPRODeck URLs would happen.
- `src/renderer/src/features/scan/**`, `src/shared/scan/tilt.ts:28`, `tiltFeatures.ts:408`,
  `resolve.ts`: Kind E. In `resolve.ts`, where Magic would fall into YGO `resolve`, add the
  comment. In ScanHub (`setGame(...)`), make sure a Magic active game can't be coerced into YGO
  silently — the scan page is hidden for Magic (`features.scan: false`), check `pageInGame`.

Verify each Kind A/B/F site from the inventory by reading it; no change expected.

- [ ] **Step 1: Write the failing tests:**
  - `game-branches.test.ts`, on a DB with `seedMagic` and one Magic entry, `active_game = 'mtg'`:
    `getStats().byFrameType` is `[]`; `getFacets()` has empty YGO facets; a YGO filter (e.g.
    attribute) on Magic doesn't throw and doesn't filter; `browseCards({ sort: 'atk' })` sorts by
    name; set rarity ranks Mythic above Rare; nothing returns a Yu-Gi-Oh, Pokémon or One Piece row.
  - `mtg-branches.test.tsx`: `rarityColor('Mythic', 'mtg')` and `rarityColor('Rare (Foil)', 'mtg')`
    aren't the grey fallback; `CardPlaceholder game="mtg"` renders the Magic placeholder;
    `CardArt` for a Magic image id requests no printing photo; `chaseRarity` for Magic Mythic is
    true and Common false.
- [ ] **Step 2–4:** fail, change the sites, pass; `npm run typecheck && npm test`, existing
  Yu-Gi-Oh/Pokémon/One Piece tests unchanged.
- [ ] **Step 5: Commit.** `refactor(games): every string branch on game decides Magic explicitly`

### Task 6: Four games in the switch on desktop, web and phone

**Files:** `src/renderer/src/components/GameSwitch.tsx` only if the checks show a problem.
Test: `tests/renderer/game-switch.test.tsx`.

- [ ] **Step 1: Tests:** with `available` `['ygo','pkm','op','mtg']` the sidebar menu shows
  "Magic" and choosing it calls `setActive('mtg')`; `GameSegments` renders four radios with one
  checked; Magic hides Scan and Pokédex nav items; the one-game case still has no switch.
- [ ] **Step 2: Check the phone segments fit.** Four names at 320 px wide: "Yu-Gi-Oh!",
  "Pokémon", "One Piece", "Magic". If they don't fit in one row, stack dot over name
  (`flex-col`, `text-[12px]`) and `truncate`. Screenshot `npm run dev:phone` at 320 and 390 px
  with the demo account (which lists every game after Task 4), and the desktop sidebar menu.
- [ ] **Step 3–4:** fix only what's broken; tests, typecheck, lint pass.
- [ ] **Step 5: Commit.** `feat(ui): the game switch holds a fourth game`

### Task 7: Release check

- [ ] Full suite: `npm run typecheck && npm --prefix workers/portal run typecheck && npm run lint && npm test && npm --prefix workers/portal test`.
- [ ] `git diff origin/main -- src/shared/catalogTables.ts` leaves `LEGACY_CATALOG_TABLES` untouched;
  the golden-id tests for all three existing games pass unchanged.
- [ ] Open the PR. **Deploy order (needs the owner's go):** portal first (server-42 runs on
  deploy, one-way), then the client release.
