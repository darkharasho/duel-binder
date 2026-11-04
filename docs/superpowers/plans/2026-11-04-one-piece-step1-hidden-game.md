# One Piece Step 1: the Empty, Hidden Game — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship One Piece's permanent identity (game id `'op'`, id range, tables, keys) and a
server-enforced tester list, with no data and no visible change for anyone who isn't the owner
or a tester.

**Architecture:**
- **Registry.** `'op'` joins `GameId`. Its `GameDef` lives in `src/shared/games/onePiece.ts`, with
  `access: 'testers'`. `allowedGames` becomes a pure function of the viewer's facts
  (`{ isOwner, testerGames }`). `byGame()` is a new exhaustive switch helper for per-game values.
- **Ids.** One Piece ids are hashed into `[2^39, 2^40)` (`onePieceId`). `gameOfId` splits at 2^40
  (pkm) and 2^39 (op). Everything that decides game from an id goes through `gameOfId`.
- **Card model (Yu-Gi-Oh-like).**
  - A `cards` row is one number per region, with id `onePieceId('en/OP05-119')`. Alternate arts
    share it.
  - A `card_images` row is one Bandai entry, with id `onePieceId('en/OP05-119_p1#img')`. The base
    entry is `'en/OP05-119#img'`.
  - A `card_printings` row is one set appearance × version. Collection entries pair `printing_id`
    with `image_id`, as Yu-Gi-Oh entries do.
- **Tables.** Desktop step V40 creates `onepiece_cards` (game text) and `onepiece_images`
  (`image_id → bandai_id`, for the `/img` proxy). V40 also runs on the DO and in the phone's wasm
  SQLite. On the server, `server-35` adds their `catalog_seq`, indexes and seq triggers.
  `server-36` adds `game_testers`, seeded with the owner's friend.
- **Access.** `gamesFor(deps, userId)` reads `game_testers`. Every route that already gates on
  `gamesFor` (RPC header, sync `?game`, catalog feed, push `games` lists) hides One Piece through
  that. The fingerprint download gains the same gate. Cross-user views already take the game
  from the viewer's RPC header, so they filter by the viewer's list.

**Tech Stack:** TypeScript, better-sqlite3 (desktop), sqlite-wasm (phone), Durable Object SQLite
(portal), React + Tailwind, Vitest, @cloudflare/vitest-plugin (Miniflare).

**Spec:** `docs/superpowers/specs/2026-11-04-one-piece-design.md`, section "Step 1: the empty game".
The pattern it copies is `docs/superpowers/plans/2026-10-29-multi-game.md`.

**Test commands (the real ones):**
- One file or a few: `npm test -- tests/main/games.test.ts`. The root `test` script already
  passes `--maxWorkers=2`, and its `portal` project covers `tests/portal/**` on better-sqlite3.
- Everything: `npm test`.
- Real DO SQLite (Miniflare): `npm --prefix workers/portal test`, covering
  `workers/portal/test/*.test.ts`. It also runs with `--maxWorkers=2`.
- Types: `npm run typecheck && npm --prefix workers/portal run typecheck`. Then `npm run lint`.
- There is no `npm run test:portal`, though the multi-game plan names one.

## Global Constraints

- Vitest runs with at most 2 workers: `--maxWorkers=2`. The `npm test` script already passes it,
  so don't add another.
- Nothing heavy in tests: no synthetic data of 100k rows or more in vitest or Miniflare. Any
  benchmark goes in a capped standalone script of 50,000 rows at most. Fixtures here are a
  handful of rows.
- DO SQLite rejects large compound queries (about 10-term UNIONs) that pass in better-sqlite3.
  Use one query per table in the Worker.
- Hot portal queries use `+game = ?`, so the DO planner doesn't pick the `ix_*_game_seq` index
  (`tests/portal/game-index-plans.test.ts`). New One Piece queries follow the same rule.
- Deploy the portal before any client release that depends on it. Server migrations come first
  and are one-way.
- Migrations are append-only. Never edit a shipped step in `MIGRATIONS`
  (`src/main/db/schema.ts`) or `SERVER_STEPS` (`workers/portal/src/migrate.ts`). Durable Objects
  can't turn foreign keys off, so referenced tables only get `ADD COLUMN`.
- Yu-Gi-Oh and Pokémon do not regress. Their ids, keys, wire formats, sync, prices, scan and
  fingerprint files stay byte-identical, with no action from any user.
- One Piece doesn't leak early. Only the owner (`ADMIN_DISCORD_ID`) and the accounts on its tester
  list see it, and the server enforces that, not just the UI.
- One Piece values, fixed here:
  - `id: 'op'`, `name: 'One Piece'`
  - `features: { scan: false, rip: false }`
  - `cardAspect: { width: 600, height: 838 }`
  - `crossLanguagePriceFallback: false`, `priceRule: 'marketOnly'`, `access: 'testers'`
- Card art at `/img` is not hidden.
- `src/shared/games/` stays free of Node and Electron imports, because the phone build rejects
  them.

## Review Focus

- **The friend already has an account, or signs in by email or Apple, so the seeded Discord
  username never binds.** The owner must be able to add him by app username from `/admin`, and the
  panel must show a Discord row as "pending" until it binds. Pinned in Task 4
  (`add by app username binds at once`) and Task 5 (pending shown).
- **A tester is removed while their device shows One Piece.** The next `/api/me` drops `'op'`. The
  device falls back to Yu-Gi-Oh. On the server, their One Piece entries are untouched: not
  tombstoned, `server_seq` unchanged. Pinned in Task 6 (`removed tester`).
- **An old client (one that doesn't know `'op'`) on a tester's account.** `/api/me` lists `'op'`,
  and `gamesOf` drops it. Legacy pulls and the legacy catalog feed carry no One Piece row. Pinned
  in Task 6 (`old client on a tester account`).
- **Discord usernames differ only in case** (`DubGrumble` against the seeded `dubgrumble`). The
  row still binds, and only to an unbound row. Pinned in Task 4.
- **The tester's account is merged into another one.** The survivor keeps the tester access.
  Pinned in Task 4 (`merge moves tester rows`).

---

### Task 1: One Piece in the registry, ids and the access rule

**Files:**
- Create: `src/shared/games/onePiece.ts`
- Modify:
  - `src/shared/games/types.ts`: `GameId`, `GAME_IDS`, the `access` union
  - `src/shared/games/index.ts`: `GAMES`, `allowedGames`, `byGame`
  - `src/shared/games/ids.ts`
- Modify (the `Record<GameId, …>` maps the compiler flags, rules in Step 3):
  - `src/shared/binders.ts`
  - `src/renderer/src/components/ArtWash.tsx`
  - `src/main/dev/capture.ts`
  - `src/main/index.ts:341`
  - `src/main/ipc/handlers.ts:65`
  - `src/shared/scan/profiles.ts`
  - `src/shared/scan/tiltFeatures.ts`
  - `workers/portal/src/scanFiles.ts`
- Modify (the shape of the filters): `src/shared/types.ts`, `src/renderer/src/lib/filters.ts`,
  `src/renderer/src/lib/rangeFilters.ts`
- Test: `tests/main/games.test.ts`

**Interfaces:**
- Produces:
  - `type GameId = 'ygo' | 'pkm' | 'op'`, `GAME_IDS = ['ygo', 'pkm', 'op']`
  - `GameDef.access: 'everyone' | 'owner' | 'testers'`
  - `interface ViewerFacts { isOwner: boolean; testerGames: readonly GameId[] }`
  - `allowedGames(viewer: ViewerFacts): GameId[]`, in `GAME_IDS` order. It returns `'everyone'`
    games, all games when `isOwner`, and `'testers'` games listed in `testerGames`. An `'owner'`
    game goes to the owner only.
  - `byGame<T>(game: GameId, values: Record<GameId, T>): T`: the exhaustive per-game value
    helper for Task 7.
  - `ONEPIECE_ID_MIN = 2 ** 39`
  - `onePieceId(sourceId: string): number`: the first 52 bits of SHA-256 of `op:${sourceId}`
    (read 7 bytes, `>> 4`), taken mod 2^39 and added to 2^39. Same reading as `pokemonId`, only
    the fold differs.
  - `gameOfId(id)`: `'pkm'` at or above 2^40, `'op'` at or above 2^39, `'ygo'` below.
  - **The source-id convention, in a doc comment on `onePieceId` (permanent once shipped):**
    - A card is one number per region. Its id is `onePieceId('<region>/<number>')`, as in
      `onePieceId('en/OP05-119')`. Alternate arts, manga, SP and TR share the card, so they share
      its number and game text.
    - An image is one Bandai entry. Its id is `onePieceId('<region>/<bandai id>#img')`: the base
      entry is `'en/OP05-119#img'`, a parallel is `'en/OP05-119_p1#img'`. The `#img` suffix
      follows `scripts/catalog/pokemon/write.ts:501`.
    - Export two thin wrappers so no caller builds the strings by hand:
      `onePieceCardId(region: string, number: string)` and
      `onePieceImageId(region: string, bandaiId: string)`.
  - `ONE_PIECE: GameDef` in `onePiece.ts`:
    - `color: '#3b82c4'` (the owner may change it)
    - `vocab`: `cardId: 'Card'`, `printingCode: 'Card number'`, `rarity: 'Rarity'`, and
      `regionLabel: (l) => languageInfo(l).label`
    - `filters`: multi filters `opColors` (Color), `opCardTypes` (Card type), `opAttributes`
      (Attribute), `opTraits` (Trait), `opRarities` (Rarity) and `opBlocks` (Block); range
      filters `cost` (Cost), `power` (Power) and `counter` (Counter)
    - `details`: `cardType` (Card type), `colors` (Color), `cost` (Cost), `life` (Life), `power`
      (Power), `counter` (Counter), `attribute` (Attribute), `traits` (Traits), `effect`
      (Effect), `trigger` (Trigger), `blockIcon` (Block) and `number` (Card number)
  - **Filter shape (stubs that step 2 fills):**
    - `CollectionFilters` and `BrowseFilters` gain optional `opColors`, `opCardTypes`,
      `opAttributes`, `opTraits`, `opRarities` and `opBlocks` (`string[]`), plus `costMin/Max`,
      `powerMin/Max` and `counterMin/Max` (`number`).
    - `Facets` and `BrowseFacets` gain the same six lists, all optional.
    - `GameKey` and `GAME_KEYS` (filters.ts) gain the six. `RANGE_FIELDS` gains
      `cost: { min: 'costMin', max: 'costMax' }` and the same for power and counter.
    - Repos ignore all of them in step 1.
  - Card types, rarities and attributes are exported as constants for step 2 and the
    placeholders:
    - `OP_CARD_TYPES = ['Leader', 'Character', 'Event', 'Stage', 'DON!!']`
    - `OP_RARITIES = ['L', 'C', 'UC', 'R', 'SR', 'SEC', 'SP', 'TR', 'P']`
    - `OP_ATTRIBUTES = ['Strike', 'Slash', 'Ranged', 'Special', 'Wisdom']`

- [ ] **Step 1: Write the failing tests** in `tests/main/games.test.ts`. Replace the
  `allowedGames(false)` test and keep every other existing assertion.

```ts
test('onePieceId golden values', () => {
  // cards: one number per region
  expect(onePieceCardId('en', 'OP05-119')).toBe(668695884659)
  expect(onePieceCardId('en', 'OP01-001')).toBe(570006248710)
  expect(onePieceCardId('en', 'ST10-003')).toBe(745026503623)
  // images: one Bandai entry each
  expect(onePieceImageId('en', 'OP05-119')).toBe(664718050776)
  expect(onePieceImageId('en', 'OP05-119_p1')).toBe(1051636995080)
  expect(onePieceImageId('en', 'OP01-001')).toBe(996841831959)
  expect(onePieceImageId('en', 'OP01-001_p1')).toBe(847381541175)
  expect(onePieceImageId('en', 'OP05-119_p1')).toBe(onePieceId('en/OP05-119_p1#img'))
  for (const s of ['en/OP05-119', 'en/OP01-001', 'en/P-084', 'en/OP05-119_p1#img']) {
    const n = onePieceId(s)
    expect(n).toBeGreaterThanOrEqual(2 ** 39)
    expect(n).toBeLessThan(2 ** 40)
    expect(gameOfId(n)).toBe('op')
  }
})
test('gameOfId boundaries', () => {
  expect(gameOfId(2 ** 39 - 1)).toBe('ygo')
  expect(gameOfId(2 ** 39)).toBe('op')
  expect(gameOfId(2 ** 40 - 1)).toBe('op')
  expect(gameOfId(2 ** 40)).toBe('pkm')
  expect(gameOfId(2 ** 31 - 1)).toBe('ygo') // top of the token range
  expect(gameOfId(pokemonId('sv02-045'))).toBe('pkm') // Pokémon unchanged
})
test('pokemonId is byte-identical', () => {
  // Computed from today's pokemonId (sha256 of 'pkm:en/me05-068', folded into [2^40, 2^53)).
  expect(pokemonId('en/me05-068')).toBe(2449488009539745)
})
test('access: testers see a testers game, the owner sees all', () => {
  expect(allowedGames({ isOwner: false, testerGames: [] })).toEqual(['ygo', 'pkm'])
  expect(allowedGames({ isOwner: false, testerGames: ['op'] })).toEqual(['ygo', 'pkm', 'op'])
  expect(allowedGames({ isOwner: true, testerGames: [] })).toEqual(['ygo', 'pkm', 'op'])
})
test('One Piece definition', () => {
  const op = gameDef('op')
  expect(op.name).toBe('One Piece')
  expect(op.features).toEqual({ scan: false, rip: false })
  expect(op.cardAspect).toEqual({ width: 600, height: 838 })
  expect([op.access, op.priceRule, op.crossLanguagePriceFallback]).toEqual(['testers', 'marketOnly', false])
  expect(isGameId('op')).toBe(true)
  expect(new Set(Object.values(GAMES).map((g) => g.color)).size).toBe(3)
})
test('byGame picks the game value', () => expect(byGame('op', { ygo: 1, pkm: 2, op: 3 })).toBe(3))
```

- [ ] **Step 2: Run them and check they fail.** Run `npm test -- tests/main/games.test.ts`. They
  should FAIL because `onePieceId`, `byGame` and `'op'` don't exist yet.
- [ ] **Step 3: Implement.** Use `typecheck` to find each `Record<GameId, …>`. The rule for each:
  - `RULE_FIELDS.op = ['name', 'set', 'rarity']` and `GOALS.op = ['none', 'card', 'printing']`.
    Step 2 adds color, card type and the other fields.
  - `GLOW.op`: two radial gradients in One Piece's colour and a warm gold, in the same form as the
    others.
  - `SHOTS.op = []`.
  - The fingerprint stores (`index.ts`, `handlers.ts`): create an `op` store like the others.
    `refreshFingerprints` skips games where `!GAMES[g].features.scan`.
  - `KEYS.op = { current: 'scan/op/fingerprints.bin', previous: 'scan/op/fingerprints.prev.bin' }`
    (the R2 key step 4 uses).
  - `SCAN_PROFILES` and tiltFeatures `REGIONS` become `Partial<Record<GameId, …>>`.
    `scanProfile(game)` throws `No scan profile for ${game}`. Call sites already run only for
    games with `features.scan`, so leave them alone unless typecheck complains.
  - The `allowedGames` caller in `workers/portal/src/auth.ts:191` passes
    `{ isOwner, testerGames: [] }` for now. Task 4 fills it in.
- [ ] **Step 4: Run them and check they pass.** Run
  `npm test -- tests/main/games.test.ts && npm run typecheck && npm --prefix workers/portal run typecheck`.
  The tests PASS and both typechecks are clean.
- [ ] **Step 5: Commit.** `feat(games): One Piece game id, id range and tester access rule`

### Task 2: Every game-by-id check goes through gameOfId

**Files:**
- Modify:
  - `workers/portal/src/images.ts:388`, where `n >= PKM_ID_MIN` becomes
    `gameOfId(n) === 'pkm'`.
  - `src/main/dev/directSources.ts:48`
  - `workers/portal/src/catalogLoad.ts:78`, where the side table's game comes from its
    `games` when it has exactly one, so `onepiece_cards` and `onepiece_images` mean `'op'`.
- Test: `tests/portal/images.test.ts`, `tests/main/direct-sources.test.ts` (create it if no test
  covers `directSources`), `tests/portal/catalog-load.test.ts`

**Interfaces:**
- Consumes: `gameOfId`, `onePieceImageId` (Task 1).

The production uses of `PKM_ID_MIN` are these two. The other four are in tests:
`token-sync.test.ts`, `catalog-feed.test.ts` and `card-art.test.tsx`, and they stay. A One Piece
id must never reach the Yu-Gi-Oh path (YGOPRODeck URLs or the `card_images` lookup for passcodes).

- [ ] **Step 1: Write the failing tests.**
  - `images.test.ts`, `an op id never takes the Yu-Gi-Oh path`: `GET /img/small/<onePieceImageId('en', 'OP01-001')>`
    with no catalog row answers 404. The fake fetch records no call to `images.ygoprodeck.com`.
  - `direct-sources`, `op ids get no YGOPRODeck url`: `card('small', onePieceImageId('en', 'OP01-001'))`
    is `null`, and a passcode still gets a YGOPRODeck URL.
  - `catalog-load.test.ts`, `onepiece rows must carry op ids`: an `onepiece_cards` row whose
    `card_id`, or an `onepiece_images` row whose `image_id`, is a
    Pokémon id gets 400 `is not a op id`. This runs after Task 3 creates the table, so mark it
    `.todo` here and turn it on in Task 3.
- [ ] **Step 2: Run them and check they fail.** Run
  `npm test -- tests/portal/images.test.ts tests/main/direct-sources.test.ts`. They should FAIL.
- [ ] **Step 3: Implement.** Use `gameOfId(n)` at each site, with a branch for each game.
  `'op'` returns `null`. Step 2 adds One Piece art sources.
- [ ] **Step 4: Run them and check they pass.** Run
  `npm test -- tests/portal/images.test.ts tests/main/direct-sources.test.ts`, then
  `grep -rn "PKM_ID_MIN" src workers/portal/src scripts`. The tests PASS, and the grep shows only
  `ids.ts`.
- [ ] **Step 5: Commit.** `refactor(games): decide game by id only through gameOfId`

### Task 3: The `onepiece_cards` and `onepiece_images` tables everywhere

**Files:**
- Modify:
  - `src/main/db/schema.ts`: `SCHEMA_V40`, `SCHEMA_V40_SERVER`, and
    `{ version: 40, sql: SCHEMA_V40, server: SCHEMA_V40_SERVER }`
  - `workers/portal/src/migrate.ts`: `server-35`
  - `src/shared/catalogTables.ts`
  - `src/shared/catalogFeed.ts`: `CatalogTableName`, `PHONE_TABLES`
  - `src/main/db/meta.ts`: the `catalog_cursor:op` and `catalog_staging_cursor:op` keys
  - `src/main/catalog/apply.ts:105-115`
  - `src/phone/data/store.ts:385`
- Create: `tests/fixtures/onePiece.ts`
- Test: `tests/main/migration-v40.test.ts`, `tests/portal/migrate.test.ts`,
  `tests/portal/catalog-feed.test.ts`, `tests/main/catalog-service.test.ts`,
  `workers/portal/test/do.test.ts` (existing: "all desktop + server migrations apply on DO SQLite")

**Interfaces:**
- Consumes: `onePieceCardId` and `onePieceImageId` (Task 1).
- Produces:
  - **How One Piece fills the shared tables.** This is the Yu-Gi-Oh-like model, written into
    the `SCHEMA_V40` doc comment:
    - **`cards`:** one row per number per region. The id is `onePieceCardId('en', 'OP05-119')`,
      and `name` is the card's name. Alternate arts never get a card row of their own.
    - **`card_images`:** one row per Bandai entry, with `card_id` pointing at the number's card.
      `OP05-119` is the base art, and `OP05-119_p1` and `_p2` are the parallels.
    - **`card_printings`:** one row per set appearance × version.
      - The version goes in **`set_rarity`**, as Pokémon stores its versions ("Normal",
        "Reverse Holofoil").
      - The form is the rarity code, plus the version label in parentheses when the printing
        isn't the base art: `'SR'`, `'SR (Alternate Art)'`, `'SEC (Manga)'`, `'SP'`, `'TR'`.
      - `variant` stays NULL. Yu-Gi-Oh uses `variant` for TCGplayer art variants, and it is not
        part of `pkey`.
      - Why `set_rarity`: the English `pkey` is `en|card_id|set_code|set_rarity` (V10, without the
        set name), so `set_rarity` is the only column that keeps two versions under one
        `set_code` apart.
      - Step 2 must therefore keep `set_rarity` unique per card × `set_code`, for example by
        numbering a second same-kind version (`'SR (Alternate Art 2)'`). An SP reprint listed
        under a newer series keeps its own `set_name`, but it still needs its own `set_rarity`.
    - **`collection_entries`:** each entry pairs `printing_id` with `image_id`, as Yu-Gi-Oh's do.
      Which image a printing shows by default is step 2's to decide, from the Bandai entry and
      the TCGplayer match. Step 1 adds no link from printing to image.
  - **The tables, on desktop, phone and server (`SCHEMA_V40` and `SCHEMA_V40_SERVER`).** Only
    game text goes in `onepiece_cards`. Art hashes live in the step 2 job's source cache, never
    here.

    ```sql
    CREATE TABLE onepiece_cards (card_id INTEGER PRIMARY KEY REFERENCES cards(id),
      number TEXT NOT NULL, colors TEXT NOT NULL DEFAULT '[]', card_type TEXT NOT NULL,
      cost INTEGER, power INTEGER, counter INTEGER, life INTEGER,
      attribute TEXT NOT NULL DEFAULT '[]', traits TEXT NOT NULL DEFAULT '[]',
      effect TEXT, trigger TEXT, block_icon INTEGER);
    CREATE INDEX ix_onepiece_cards_number ON onepiece_cards(number);
    CREATE TABLE onepiece_images (image_id INTEGER PRIMARY KEY REFERENCES card_images(image_id),
      bandai_id TEXT NOT NULL);
    ```

    - `colors`, `attribute` and `traits` are JSON arrays, for multicolor cards and the few cards
      with two attributes.
    - `number` is the printed base number (`OP05-119`). It isn't unique: Japanese, later, has its
      own card per number.
    - `onepiece_images.bandai_id` (`OP05-119_p1`) is what the `/img` proxy needs to build
      Bandai's image URL (`/images/cardlist/card/<bandai_id>.png`). Step 2 wires that up, and step
      1's `/img` branch for `'op'` still answers null.
  - **Desktop and phone only:** `SCHEMA_V40` also adds
    `${rollupTriggers('onepiece_cards', ['card_id', 'colors', 'card_type', 'attribute', 'traits'])}`.
    The server override (`SCHEMA_V40_SERVER`) leaves rollups out, as V24 does. The phone runs
    `MIGRATIONS` through `migrateSql` (`src/phone/data/wasmSql.ts:123`), so it needs no step of its
    own.
  - **`server-35`:** two frozen tables, `SERVER_35_ONEPIECE_CARDS` (key `['card_id']`) and
    `SERVER_35_ONEPIECE_IMAGES` (key `['image_id']`), each with the column list above. For each
    table, the step adds `catalog_seq INTEGER NOT NULL DEFAULT 0`,
    `ix_<table>_catalog_seq`, and `seqTriggers(t, "'op'")`, modelled on `pokemonSetArtStep`
    (server-14). Both tables start empty, so there is no backfill.
  - **`CATALOG_TABLES`:**
    - append `{ name: 'onepiece_cards', key: ['card_id'], columns: <all but catalog_seq>, games: ['op'] }`
    - append `{ name: 'onepiece_images', key: ['image_id'], columns: ['image_id', 'bandai_id'], games: ['op'] }`
    - the four shared tables (cards, card_images, card_printings, sets) go from `BOTH` to
      `['ygo', 'pkm', 'op']`
    - `LEGACY_CATALOG_TABLES` is untouched
  - **`PHONE_TABLES` and `CatalogTableName`** gain `'onepiece_cards'` and `'onepiece_images'`,
    after `pokemon_set_art`.
  - **`apply.ts`** skips two deletes:
    - an `onepiece_cards` delete for an owned card, the same rule as for `pokemon_cards`
    - an `onepiece_images` delete for an image an entry uses, the same rule as for
      `card_images`
  - **Phone `resetOldFormat`:** it deletes `catalog_cursor:${g}` for every non-ygo game in
    `GAME_IDS`, not just `:pkm`.
  - **`tests/fixtures/onePiece.ts`:** `seedOnePiece(db: SqlDb): { cardIds: number[]; printingIds: number[]; imageIds: number[] }`.
    Every row it inserts has `game = 'op'`:
    - **cards:** one card, `onePieceCardId('en', 'OP01-001')` (Leader), with its
      `onepiece_cards` row
    - **images:** two, `onePieceImageId('en', 'OP01-001')` and `onePieceImageId('en', 'OP01-001_p1')`,
      each with its `onepiece_images` row
    - **printings:** two in set `ROMANCE DAWN [OP-01]`, both with code `OP01-001`. One has
      `set_rarity` `'L'` and the other `'L (Alternate Art)'`.
    - **sets:** one row named exactly like an English Yu-Gi-Oh fixture set

- [ ] **Step 1: Write the failing tests.**
  - `migration-v40.test.ts`: migrate a database seeded with the Yu-Gi-Oh fixtures and
    `seedPokemon`, then check:
    - `onepiece_cards` and `onepiece_images` exist, and `seedOnePiece` succeeds
    - the two versions have distinct `pkey`s under one `set_code`
      (`en|<card>|OP01-001|L` and `en|<card>|OP01-001|L (Alternate Art)`)
    - `SELECT pkey FROM card_printings ORDER BY id` is the same before and after
    - `PRAGMA foreign_key_check` is empty
    - updating `onepiece_cards.card_type` clears `catalog_rollups`
  - `migrate.test.ts`, `server-35 feeds onepiece_cards`:
    - after `migrateServer` and `seedOnePiece`, the `onepiece_cards` and `onepiece_images` rows
      have `catalog_seq > 0`
    - deleting either writes a tombstone with its `tbl` and `game = 'op'`
  - `catalog-feed.test.ts`:
    - `catalogChanges(db, 0, 5000, undefined, 'op')` returns exactly the seeded One Piece rows
      across cards, card_images, card_printings, sets, onepiece_cards and onepiece_images
    - the `'pkm'` feed and the legacy feed (no game) contain no `'op'` row and no
      `onepiece_*` table
    - `catalog-feed-legacy.test.ts`'s legacy snapshot still passes unchanged
  - `catalog-service.test.ts`, `first op pass starts from 0`: with `me.games` set to
    `['ygo','pkm','op']` and Yu-Gi-Oh's cursor at the latest seq, the client pulls every One Piece
    row under `catalog_cursor:op`.
  - `catalog-load.test.ts`: turn on Task 2's `.todo`.
- [ ] **Step 2: Run them and check they fail.** Run
  `npm test -- tests/main/migration-v40.test.ts tests/portal/migrate.test.ts tests/portal/catalog-feed.test.ts tests/main/catalog-service.test.ts tests/portal/catalog-load.test.ts`.
  They should FAIL.
- [ ] **Step 3: Implement** the files listed above.
- [ ] **Step 4: Run them and check they pass.** Run the same command, then
  `npm --prefix workers/portal test` (the DO migration test runs V40 and server-35 on real DO
  SQLite), then `npm test`. Everything should PASS, including the `game-index-plans` tests.
- [ ] **Step 5: Commit.** `feat(db): onepiece_cards and onepiece_images on desktop, phone and server (V40, server-35)`

### Task 4: The tester list on the server

**Files:**
- Create: `workers/portal/src/testers.ts`
- Modify:
  - `workers/portal/src/migrate.ts`: `server-36`
  - `workers/portal/src/auth.ts`: `gamesFor`, `discordSignIn`
  - `workers/portal/src/link.ts`: the Discord attach at about line 143
  - `workers/portal/src/emailClaim.ts`: where an accepted claim attaches its Discord sign-in
  - `workers/portal/src/merge.ts`
  - `workers/portal/src/app.ts`: routes `/admin/testers*` before the generic `/admin/` route, as
    `/admin/merges` is routed
- Test: `tests/portal/testers.test.ts`, `tests/portal/games-access.test.ts`

**Interfaces:**
- Consumes: `allowedGames({ isOwner, testerGames })`, `isAdminUser` (auth.ts:179), `isAdmin`,
  `fromPublicOrigin` (as `adminMergeRoute` in merge.ts:582 uses them).
- Produces:
  - **`server-36`:**

    ```sql
    CREATE TABLE game_testers (id INTEGER PRIMARY KEY, game TEXT NOT NULL,
      discord_username TEXT, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      CHECK (discord_username IS NOT NULL OR user_id IS NOT NULL));
    CREATE UNIQUE INDEX ux_game_testers_user ON game_testers(game, user_id) WHERE user_id IS NOT NULL;
    CREATE UNIQUE INDEX ux_game_testers_pending ON game_testers(game, discord_username COLLATE NOCASE) WHERE user_id IS NULL;
    CREATE INDEX ix_game_testers_user_id ON game_testers(user_id);
    INSERT INTO game_testers (game, discord_username, user_id) VALUES ('op', 'dubgrumble', NULL);
    ```

  - **In `testers.ts`:**
    - `testerGames(db: SqlDb, userId: number): GameId[]`: `SELECT game … WHERE user_id = ?`,
      filtered with `isGameId`.
    - `bindTesterInvites(db: SqlDb, userId: number, discordUsername: string): void`: runs
      `UPDATE OR IGNORE game_testers SET user_id = ? WHERE user_id IS NULL AND discord_username = ? COLLATE NOCASE`.
      Afterwards it deletes the pending rows still matching that username for games the user
      already holds.
    - `adminTestersRoute(req: Request, deps: AppDeps): Promise<Response>`:
      - **`GET /admin/testers`** →
        `{ testers: { id: number; game: GameId; discordUsername: string | null; userId: number | null; username: string | null }[] }`,
        ordered by game, then username. A row with `userId === null` is pending.
      - **`POST /admin/testers`** with `{ game, discordUsername }` or `{ game, username }`:
        - `username` is an existing app username, matched case-insensitively. It binds at once
          (`user_id`). An unknown username gets 404 `no-such-user`.
        - `discordUsername` adds a pending row.
        - A game whose `access` isn't `'testers'` gets 400 `not-a-tester-game`.
        - A duplicate gets 200 with the existing row.
      - **`POST /admin/testers/remove`** with `{ id }` → `{ ok: true }`.
      - **Guards, as on `/admin/merges/undo`:** every method requires `isAdmin`, or the answer is
        404. A POST also requires `fromPublicOrigin` and an `application/json` body (415
        otherwise).
  - **`gamesFor(deps, userId)`** becomes
    `allowedGames({ isOwner: isAdminUser(deps, userId), testerGames: testerGames(deps.db, userId) })`.
  - **Binding.** `bindTesterInvites` runs inside the existing transaction wherever a Discord
    identity attaches to an account, with the Discord username in hand:
    - `discordSignIn` (`du.username`), which covers the desktop and web sign-in paths
    - the link attach in `link.ts` (`extra.profile.username`)
    - claim acceptance in `emailClaim.ts` (`profile.username`), when its provider is
      `'discord'`
  - **Merge.** `mergeAccounts` runs
    `UPDATE OR IGNORE game_testers SET user_id = survivor WHERE user_id = closed` next to the
    sign-ins move at merge.ts:277. Undoing a merge doesn't move them back: the owner re-adds by
    hand, and this is noted in a comment.

- [ ] **Step 1: Write the failing tests** in `tests/portal/testers.test.ts`, using the
  `merge-undo.test.ts` deps and session setup:
  - `seeded row binds on Discord sign-in`: drive `finishSignIn` with a fake Discord fetch
    returning `{ id: '555', username: 'DubGrumble' }`. The new account's `/api/me` then has
    `games: ['ygo','pkm','op']`, and `game_testers` has one `'op'` row with that `user_id`.
  - `a second account with the same name doesn't take a bound row`: with the row bound, a
    `testerGames` call for another user returns `[]`.
  - `add by app username binds at once`: POST `{ game: 'op', username: 'Kaiba' }` as the owner.
    User `kaiba`'s `gamesFor` then includes `'op'`.
  - `pending Discord row is listed as pending`: POST `{ game: 'op', discordUsername: 'luffy' }`.
    The GET then lists it with `userId: null`.
  - `remove takes the game away`: remove kaiba's row, and his `gamesFor` is `['ygo','pkm']`.
  - `only the owner`:
    - GET and POST as kaiba answer 404
    - a POST with a foreign `Origin` answers 404
    - a POST with `text/plain` answers 415
    - POST `{ game: 'pkm', … }` answers 400 `not-a-tester-game`
  - `merge moves tester rows`: kaiba is a tester. After `mergeAccounts` merges kaiba into me,
    `gamesFor(me)` includes `'op'`.
  - In `games-access.test.ts`, `/api/me` gives the owner `['ygo','pkm','op']` and anyone else
    `['ygo','pkm']`. The existing `withOwnerOnlyPokemon` tests stay as they are.
- [ ] **Step 2: Run them and check they fail.** Run
  `npm test -- tests/portal/testers.test.ts tests/portal/games-access.test.ts`. They should FAIL.
- [ ] **Step 3: Implement** the files listed above.
- [ ] **Step 4: Run them and check they pass.** Run the same command, then
  `npm test -- tests/portal` and `npm --prefix workers/portal test` (server-36 on real DO SQLite).
  Everything should PASS.
- [ ] **Step 5: Commit.** `feat(portal): game tester list, bound by Discord username on sign-in`

### Task 5: The Testers panel on /admin

**Files:**
- Modify: `workers/portal/src/adminPage.ts` (a new `testers` tab: `TABS`, nav link, section,
  `loadTesters()`)
- Test: `tests/portal/admin-stats.test.ts` (it already fetches `/admin`), or a new
  `tests/portal/admin-page.test.ts`

**Interfaces:**
- Consumes: Task 4's three `/admin/testers` endpoints and their JSON shapes.

**The panel:**
- A table per tester game (`GAMES` entries with `access === 'testers'`), with columns "Account",
  "Discord" and "Status" (Bound / Pending), and a Remove button that asks `confirm()` first.
- Under it, an add form: a game `<select>`, one text input, and a choice of "App username" or
  "Discord username". It posts the matching body and shows the server's error text when the POST
  fails.
- It is built with the page's existing `el()` helper and styles, and loads with the other panels
  on first load and on Refresh.
- The page's script runs under the nonce CSP, so there are no inline handlers.

- [ ] **Step 1: Write the failing test.** `admin page has a Testers tab`: the owner's `GET /admin`
  body contains `href="#testers"`, `id="testers"` and `fetch('/admin/testers'`.
- [ ] **Step 2: Run it and check it fails.** Run `npm test -- tests/portal/admin-page.test.ts`. It
  should FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Check it passes, then check by hand.** Run the test again. Then run
  `npm --prefix workers/portal run dev`, sign in as the owner, open `/admin#testers`, and check:
  - the seeded `dubgrumble` row shows as Pending
  - adding and removing an app username works
  - a bad username shows "no-such-user"
- [ ] **Step 5: Commit.** `feat(admin): Testers panel`

### Task 6: Hidden on every route, and cross-user views

**Files:**
- Modify: `workers/portal/src/scanFiles.ts` (`getFingerprints`)
- Modify, if the tests find a leak: any route below that returns rows of a game other than the
  checked one
- Test: `tests/portal/op-hidden.test.ts`, `tests/portal/legacy-client.test.ts`,
  `tests/main/cloud-sync-games.test.ts`

**Interfaces:**
- Consumes:
  - `seedOnePiece` (Task 3)
  - `game_testers` and `gamesFor` (Task 4)
  - `GAME_HEADER`
  - `addEntry` and `userScope(userId, 'op')` to give the tester One Piece entries

**What already holds, and only needs these tests:**
- RPC `x-duel-game` (rpc.ts:332)
- sync `?game` (sync.ts:387)
- catalog feed `?game` (catalogFeed.ts:204)
- per-row `games` checks on push (`applyPush`, `applyWishPush`, `applyFavouritePush`,
  `applyBinderPush` and `applyBinderEditPush`)
- the friend views, which take `game` from the viewer's checked header

**The one gap:**
- `GET /scan/fingerprints?game=<g>` is public. For a game whose `access` isn't `'everyone'`, it
  now requires `currentUser` with `g` in `gamesFor`, and answers 404 `No fingerprints yet`
  otherwise, so it gives nothing away.
- Step 4 has to make clients send credentials on that fetch. Leave a comment saying so.

- [ ] **Step 1: Write the failing tests** in `tests/portal/op-hidden.test.ts`.
  - **Setup:**
    - Seed the Yu-Gi-Oh fixtures and `seedOnePiece`.
    - `luffy` is a tester with one One Piece entry, one wishlist row, one favourite, and one
      friends-visible binder of game `'op'`.
    - `zoro` is a non-tester friend of `luffy`. `nami` is a tester friend of `luffy`.
  - `non-tester gets 403 everywhere`: zoro gets 403 `game-not-allowed` on:
    - RPC `collection:list` with `x-duel-game: op`
    - `GET /api/sync/pull?game=op`, `wishlist-pull`, `favourites-pull` and `binders-pull` with
      `game=op`
    - `GET /api/catalog/changes?game=op`
  - `non-tester pushes are not stored`: zoro's pushes of a One Piece pkey and image get:
    - `unknown-printing` on push
    - `skipped` on wishlist, favourites and binders push
    - and his server rows don't change
  - `fingerprints are hidden`: `GET /scan/fingerprints?game=op` answers 404 for anyone signed
    out, and for zoro, even with an object stored under `scan/op/fingerprints.bin`. For the owner
    it answers 200. `?game=pkm` and no `game` still answer 200 anonymously.
  - `friend views use the viewer's games`:
    - With `x-duel-game: ygo`, zoro's `friends:collection`, `friends:stats`, `friends:sets`,
      `friends:binders`, `friends:wishlist` and `friends:forCard` on luffy contain no One Piece
      row.
    - With `x-duel-game: op`, zoro gets 403.
    - With `x-duel-game: op`, nami's `friends:collection` on luffy returns the One Piece entry.
  - `art is not hidden`: `GET /img/small/<seeded op image id>` is not rejected for game reasons
    when signed out. Until step 2 adds an art source, a 404 because there is no source is fine;
    assert the response isn't 403.
  - `removed tester`: remove luffy's row. Then:
    - `/api/me` lacks `'op'`
    - `pull?game=op` answers 403
    - luffy's One Piece entry on the server keeps its `server_seq` and `deleted_at IS NULL`
  - In `legacy-client.test.ts`, `old client on a tester account`: luffy runs the legacy pull, push,
    price-changes and catalog feed (no `game`, no header). Each returns only Yu-Gi-Oh, and the One
    Piece entry is unchanged afterwards.
  - In `cloud-sync-games.test.ts`, `a me with op is read by gamesOf`: `gamesOf({ games: ['ygo','op','xyz'] })`
    is `['ygo','op']`. With `op` dropped from `me.games`, `activeGame` falls back to `'ygo'`.
- [ ] **Step 2: Run them and check they fail.** Run
  `npm test -- tests/portal/op-hidden.test.ts tests/portal/legacy-client.test.ts tests/main/cloud-sync-games.test.ts`.
  Only `fingerprints are hidden` should FAIL. Anything else that fails is a leak: fix it in the
  route it names.
- [ ] **Step 3: Gate `getFingerprints`.** Add any route fixes the tests found.
- [ ] **Step 4: Run them and check they pass.** Run the same command, then `npm test`. Everything
  should PASS.
- [ ] **Step 5: Commit.** `feat(portal): One Piece hidden on every data route and the fingerprint file`

### Task 7: Audit every string branch on game

**Files:** the sites below. Tests are `tests/main/game-branches.test.ts` (main and shared) and
`tests/renderer/op-branches.test.tsx` (renderer and phone).

**Interfaces:**
- Consumes: `byGame` (Task 1).

**The rules, one per kind of site:**

| Kind | Rule |
|---|---|
| **A.** `=== 'pkm'` guarding Pokémon-only behaviour (backfills, TCGdex art, borrowed art, twins, Pokémon OCR or versions) | Stays Pokémon-only. No change, and `'op'` takes the other path only if that path is game-neutral. |
| **B.** `=== 'ygo'` / `!== 'ygo'` keeping a Yu-Gi-Oh legacy key or URL (cursor names, fingerprint stems, `?game=`, setting keys) | No change: `'op'` gets the `:${game}` / `-${game}` form, which is what we want. |
| **C.** A two-way ternary where "not pkm" means Yu-Gi-Oh, or "not ygo" means Pokémon | Make it explicit with `byGame` (or a `switch` with `assertNever`), giving `'op'` its own value. In step 1 that is a neutral value (empty list, generic label, grey colour). |
| **D.** Validation of a closed game list (`r.game !== 'ygo' && r.game !== 'pkm'`) | Becomes `isGameId(x)`. |
| **E.** Scan-only code (`src/renderer/src/features/scan/**`, `src/shared/scan/**`, `scripts/scan/**`, `scripts/catalog/{fingerprints,accuracy,build}.ts`) | Can't run for `'op'` while `features.scan` is false. Leave it, and add one `// op: step 4` comment only where a binary branch would send `'op'` down the Pokémon path. |
| **F.** SQL literals (`game = 'ygo'` in Yu-Gi-Oh sync, TCGplayer, eBay and Rip; `game = 'pkm'` in the Pokémon sweep, dexImport and set art) | Game-specific jobs, no change. Check the two negative forms by hand: `shownPrinting.ts:13` and `sets.ts:200` (`p.game <> 'pkm' OR missing_from_api = 0`) are correct for `'op'`. |

**The sites, by file (from `grep -rnE "[!=]==? ?'(pkm|ygo)'|'(pkm|ygo)' ?[!=]==?|'ygo' \| 'pkm'"`, 86 hits):**

Kind C, to change:
- `src/main/repo/stats.ts:57`: `byFrameType` on `'op'` is `[]`. Step 2 puts card types there.
- `src/main/repo/browse.ts:99`, `src/renderer/src/features/browse/BrowsePage.tsx:64` and
  `src/renderer/src/features/sets/setsView.ts:36`: the sort fallback. On `'op'`, `atk`, `def`,
  `level` and `hp` all fall back to `name`.
- `src/main/repo/collection.ts:87`: `const ygo = r.p_game === 'ygo'`. Check what it gates, and
  keep Yu-Gi-Oh-only pricing Yu-Gi-Oh-only.
- `src/renderer/src/lib/rarityColors.ts:34,46`: a `ONE_PIECE_COLORS` map for `OP_RARITIES`
  (L, SEC, SP and TR take distinct colours; C, UC and R are greys and blues). `rarityColor` picks
  it with `byGame`.
- `src/renderer/src/components/CardPlaceholder.tsx:143`: `'op'` gets a plain placeholder at the
  One Piece aspect, not the Yu-Gi-Oh card frame. That's a new small `OpPlaceholder`.
- `src/renderer/src/components/CardDetails.tsx:25,40`: Yu-Gi-Oh's facts block, else the
  game-facts list from `def.details`. Check that `'op'` takes the `def.details` path.
- `src/renderer/src/features/card/CardTypeList.tsx:196,233` and `CardPanel.tsx:161,176`: the
  Pokémon version picker stays Pokémon-only, and `'op'` takes the generic printing list.
- `src/renderer/src/features/scan/owned.ts:69`, `ScanRowItem.tsx:194`, `src/phone/ReviewSheet.tsx:90,103`
  and `src/phone/ScannerScreen.tsx:121` ("version"/"printing" wording): `'op'` says "version",
  per the spec's vocabulary. Do it through `byGame`, though the scan screens stay hidden.
- `src/main/index.ts:75`: `YGO_CAPTURE_GAME` accepts any `isGameId` value.
- `src/renderer/src/features/sets/SetsPage.tsx:170` (`bySeries`) and `SetChecklist.tsx:467,698`:
  Pokémon-only today, and `'op'` takes the plain path. Decide it explicitly through `byGame`.

Kind D:
- `src/phone/stream/record.ts:58`
- `scripts/scan/make-fixtures.ts:36`. It keeps rejecting `'op'` until step 4, with a message that
  says so.

Kind A, no change (check each):
- `src/main/catalog/service.ts:214` and `src/phone/data/store.ts:436` (the Pokémon backfill)
- `src/main/repo/{collection.ts:258,360, sets.ts:325, browse.ts:121,285, cards.ts:132,194}`
  (Pokémon joins on `pokemon_cards`). For `'op'`, check that the else-branch reads no Yu-Gi-Oh-only
  columns into wrong facets: `getFacets` and `browseFacets` on `'op'` return empty Yu-Gi-Oh lists.
- `src/renderer/src/components/CardArt.tsx:171`, `src/renderer/src/lib/artPrefetch.ts:54` and
  `src/renderer/src/lib/borrowedArt.ts:83`. `'op'` printings have no Yugipedia printing photos:
  CardArt and artPrefetch must skip printing photos for `'op'` too. That makes these two Kind C:
  change them to `gameOfId(id) === 'ygo'`.
- `workers/portal/src/catalogLoad.ts:111`

Kind B, no change:
- `src/main/catalog/apply.ts:25,29`
- `src/main/scan/fingerprints.ts:56,58,63`
- `src/main/cloud/localSync.ts:82`
- `src/phone/data/store.ts:143,423,427,442,534,845`
- `src/renderer/src/features/sets/SetsPage.tsx:42`
- `src/renderer/src/features/scan/ScanHub.tsx:22`
- `src/renderer/src/web/httpApi.ts:63`
- `src/main/cloud/client.ts:193,225`

Kind E, scan only:
- `ScanHub.tsx:158`. `setGame(g === 'pkm' ? 'pkm' : 'ygo')` would turn `'op'` into Yu-Gi-Oh:
  make it `isGameId(g) ? g : 'ygo'`.
- `pickerOptions.ts:44,69`, `useHubScan.ts:90,91`, `ScanWindowApp.tsx:146,147`, `scanLook.ts:12`,
  `session.ts:21`, `resolve.ts:334,445,462,489`, `engine.ts:462,471`, `vision/analyze.ts:151`,
  `useScanLoop.ts:398`, `ScanRowItem.tsx:37,74`
- `src/shared/scan/{fingerprint.ts:109, tilt.ts:28, tiltFeatures.ts:408}`, `src/shared/setTypes.ts:36`
  (`'op'` sets are `'booster'` until step 2)
- `scripts/catalog/{build.ts:211,215, accuracy.ts:103,116,209,213, fingerprints.ts:143,318}`
  and `scripts/scan/rarity/fit-tilt.ts:122`

- [ ] **Step 1: Write the failing tests.**
  - `tests/main/game-branches.test.ts`, on a database with `seedOnePiece` and one `'op'` entry, with
    `active_game = 'op'`:
    - `getStats().byFrameType` is `[]`
    - `getFacets()` has empty `cardTypes`, `attributes` and `archetypes`
    - `browseCards({ sort: 'atk' })` sorts by name
    - nothing returns a Yu-Gi-Oh or Pokémon row
  - `tests/renderer/op-branches.test.tsx`:
    - `rarityColor('SEC', 'op')` is not the grey fallback
    - `CardPlaceholder` with `game="op"` renders without the Yu-Gi-Oh frame (its test id or class)
    - `parseRecord` (record.ts) keeps a record with `game: 'op'`
    - `CardArt` for an `'op'` image id requests no printing photo
- [ ] **Step 2: Run them and check they fail.** Run
  `npm test -- tests/main/game-branches.test.ts tests/renderer/op-branches.test.tsx`. They should
  FAIL.
- [ ] **Step 3: Change the Kind C and D sites,** and put a short comment on the Kind A ones that
  needed a decision.
- [ ] **Step 4: Run them and check they pass.** Run the same command, then
  `npm run typecheck && npm test`. Everything should PASS, and the existing Yu-Gi-Oh and Pokémon
  tests pass unchanged.
- [ ] **Step 5: Commit.** `refactor(games): every string branch on game decides One Piece explicitly`

### Task 8: Three games in the switch on desktop, web and phone

**Files:**
- Modify, only if the checks below show a problem: `src/renderer/src/components/GameSwitch.tsx`
  - The menus (`SidebarGameSwitch`, `GameChip`) already list N games.
  - `GameSegments` (phone More sheet) is a `grid-flow-col auto-cols-fr` row. Three names at
    `text-sm` may not fit on a 320–360 px phone. If they don't, stack the dot over the name
    (`flex-col`, `text-[12px]`), keep `h-10` → `h-12`, and `truncate` the name.
- Test: `tests/renderer/game-switch.test.tsx`

**Interfaces:**
- Consumes: `GAMES.op` and `useGame()` with `available` (unchanged).

- [ ] **Step 1: Write the failing tests** in `game-switch.test.tsx`:
  - `three games in the sidebar menu`: with `available` set to `['ygo','pkm','op']`, opening the
    switch shows "Yu-Gi-Oh!", "Pokémon" and "One Piece", and choosing One Piece calls
    `games.setActive('op')`.
  - `three phone segments`: `GameSegments` renders three `role="radio"` buttons, and only the
    active one is `aria-checked`.
  - `no switch for one game`: with `['ygo']`, there is no switch. This test already exists; keep it.
  - `op hides Rip and Scan`: with `op` active, the Rip and Scan nav items are absent.
- [ ] **Step 2: Run them and check they fail.** Run `npm test -- tests/renderer/game-switch.test.tsx`.
  They should FAIL (no `'op'` before Tasks 1 and 7, or the layout changes).
- [ ] **Step 3: Fix only what the screenshot check finds.** Take the screenshots:
  - Run the portal locally (`npm --prefix workers/portal run dev`), then `npm run dev` with the
    portal URL override (`src/main/cloud/config.ts`) pointed at it. Sign in as the owner, and
    capture the sidebar menu open with the `run` skill.
  - Run `npm run dev:phone` in a browser at 320 px and 390 px wide, signed in as the owner, and
    capture the More sheet. Also capture the web app, served at `/` by the local portal.
  - The three names must fit without overlapping or wrapping mid-word, and the active one must be
    obvious.
  - Show the owner the screenshots. Yu-Gi-Oh-only accounts must look exactly as before, with no
    switch.
- [ ] **Step 4: Run them and check they pass.** Run
  `npm test -- tests/renderer/game-switch.test.tsx`, then `npm run typecheck && npm run lint`.
  Everything should PASS.
- [ ] **Step 5: Commit.** `feat(ui): the game switch holds a third game`

### Task 9: Release check and order

**Files:** none new.

- [ ] **Step 1: Run the full suite.**
  - `npm run typecheck && npm --prefix workers/portal run typecheck && npm run lint && npm test && npm --prefix workers/portal test`.
    Everything should PASS.
  - Run `git diff main -- src/shared/catalogTables.ts` and check that `LEGACY_CATALOG_TABLES` is
    untouched.
  - The `pokemonId` golden test (Task 1) passes.
- [ ] **Step 2: Check Yu-Gi-Oh and Pokémon by hand** against the local portal, as a non-owner
  account:
  - there is no switch to a third game
  - the collection, dashboard and sync look as in the current release
- [ ] **Step 3: Deploy the portal first,** since it's one-way and server-35 and server-36 run on
  deploy. Run `npm --prefix workers/portal run deploy`. Then:
  - Open `/admin#testers` and check that `dubgrumble` is listed as Pending.
  - If the friend already has an account, add him by app username there.
  - Record the Worker version id in memory.
- [ ] **Step 4: Release the clients:** desktop, web (already deployed with the portal) and phone,
  as the next minor. Commit: `chore: release <next minor>`.
