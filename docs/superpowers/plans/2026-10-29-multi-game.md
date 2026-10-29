# Multi-game App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Duel Binder internally multi-game, with a whole-app game switch and an empty,
owner-only Pokémon game. Yu-Gi-Oh keeps working byte-for-byte, including for clients that haven't
updated.

**Architecture:**
- **Game registry.** A per-game registry lives in `src/shared/games/`.
- **Where the game is stored.** Every shared catalog and collection row carries a `game` column
  (default `'ygo'`).
- **Pokémon ids.** Pokémon card and image ids are integers in their own range (≥ 2^40). This keeps
  every existing key format (`pkey`, `imageId`, R2 keys, fingerprints) collision-free without
  changing it.
- **Scoping queries.** The repo layer's `Scope` gains the active game, the same way it carries the
  active owner today. Desktop and phone read it from `meta`. The server reads it from the request.
- **Sync and catalog feeds.** Each feed gains a `game` parameter. A request without one is the
  **legacy feed**: Yu-Gi-Oh rows only, today's columns and keys. Old clients therefore see exactly
  what they see now.
- **Who sees Pokémon.** The server decides which games each user may see, and Pokémon is the
  owner's alone until step 5.

**Tech Stack:** TypeScript, better-sqlite3 (desktop), sqlite-wasm (phone), Durable Object SQLite
(portal), React + Tailwind, Vitest (`--maxWorkers=2`), @cloudflare/vitest-plugin.

**Spec:** `docs/superpowers/specs/2026-10-29-multi-game-pokemon-design.md` (Step 2). Plan 1
(`docs/superpowers/plans/2026-10-29-org-move-workspaces.md`) lands first.

## Global Constraints

- **Yu-Gi-Oh stays byte-for-byte the same.** Every existing Yu-Gi-Oh key stays identical:
  - `pkey` (`en|card_id|set_code|set_rarity` / `lang|card_id|set_name|set_code|set_rarity`)
  - `imageId`, card ids
  - `WireEntry` and `WirePrice` fields
  - feed rows, columns and tombstone keys on the legacy feed

  Anything without a game is Yu-Gi-Oh.
- **Game ids:** `'ygo'` and `'pkm'`. The display names are "Yu-Gi-Oh!" and "Pokémon".
- **Pokémon ids are integers in `[2^40, 2^53)`.** That covers card ids and image ids. Yu-Gi-Oh ids
  are below 2^40.
- **Pokémon access is `'owner'`** (the `ADMIN_DISCORD_ID` account) until step 5, when it becomes
  `'everyone'`. The server enforces it on every route (sync, catalog feed, prices, RPC, `/api/me`).
  The UI hides the switch as well, but hiding is not the gate.
- **Migrations:**
  - Append-only in `MIGRATIONS` (`src/main/db/schema.ts`). Never edit a shipped step.
  - Server-only steps go in `workers/portal/src/migrate.ts`.
  - Durable Objects can't turn foreign keys off, so referenced tables (`cards`, `card_images`,
    `card_printings`) only get `ALTER TABLE … ADD COLUMN`, never a rebuild.
  - The portal deploy is one-way.
- **Prices are always USD.** Pokémon gets no cross-language fallback: `enTwin` never applies to
  `game = 'pkm'`.
- **Remembering the game:**
  - The last game used is remembered per device: desktop and phone in `meta` (`active_game`), the
    web app in `localStorage` (`duel-binder.game`).
  - An active game the user may not see falls back to `'ygo'`.
- **The switch stays hidden** whenever the user's allowed games are just `['ygo']`. With Pokémon
  owner-only, that's everyone but the owner.
- **Per-game features:** Rip is `ygo` only. Scan is `ygo` only until step 5. Both are hidden for a
  game without them.
- **No combined totals across games.**
- **Graded slabs** are not built. Nothing here may stop a slab later being a property of a
  collection entry.
- Never build 100k+ row synthetic data in tests (fixtures stay small).

## Review Focus

- **An old client syncs while the same account has Pokémon entries.** This means a v0.20 desktop or
  phone with no `game` parameter. It must keep pulling and pushing Yu-Gi-Oh normally, and never see,
  drop or tombstone a Pokémon entry. Task 7's legacy-client test pins this, and Task 11's end-to-end
  test pins it again.
- **A client updates after Pokémon rows already exist on the server.** Its Pokémon catalog and entry
  cursors start at 0, not at the Yu-Gi-Oh cursor. Otherwise it would silently miss rows. Tasks 7
  and 8 test this.
- **The owner switches to Pokémon, signs out, and someone else signs in on that device.** The
  active game falls back to `'ygo'`, and no Pokémon rows show. Task 9 tests this.
- **A Pokémon set has the same name as a Yu-Gi-Oh set in the same language.** Both set rows coexist,
  and no join crosses games. Tasks 2 and 3 test this with a fixture set named after a real
  Yu-Gi-Oh set.
- **A Pokémon Japanese printing has an English counterpart with a price.** The Japanese one shows no
  price. Task 5 tests this.

---

### Task 1: Game registry and Pokémon ids

**Files:**
- Create: `src/shared/games/types.ts`, `src/shared/games/ygo.ts`, `src/shared/games/pokemon.ts`,
  `src/shared/games/index.ts`, `src/shared/games/ids.ts`
- Test: `tests/main/games.test.ts`

**Interfaces:**
- Produces:
  - `type GameId = 'ygo' | 'pkm'`, `GAME_IDS: readonly GameId[] = ['ygo', 'pkm']`
  - `interface GameDef { id: GameId; name: string; features: { scan: boolean; rip: boolean };
    crossLanguagePriceFallback: boolean; access: 'everyone' | 'owner'; vocab: GameVocab;
    filters: FilterDef[] }`
  - `GameVocab` holds the UI words that differ per game:
    `{ cardId: string; printingCode: string; rarity: string; regionLabel(lang): string }`. For
    Yu-Gi-Oh these are "Passcode", "Set code" and "Rarity", plus the existing OCG/TCG label. For
    Pokémon they are "Card", "Number" and "Version", plus the language name.
  - `FilterDef` is `{ key: string; label: string; kind: 'multi' | 'range' }`. Yu-Gi-Oh's list
    mirrors today's `CollectionFilters`/`BrowseFilters` keys (cardTypes, attributes, races,
    archetypes, level). Pokémon's is `pkmCategories` (Pokémon/Trainer/Energy), `pkmTypes`,
    `pkmStages` and `hp` (range).
  - `GAMES: Record<GameId, GameDef>`, `gameDef(id: GameId): GameDef`, and
    `isGameId(x: unknown): x is GameId`
  - `allowedGames(isOwner: boolean): GameId[]` returns every game whose `access` is `'everyone'`,
    plus the owner-only games when `isOwner`, in `GAME_IDS` order.
  - `PKM_ID_MIN = 2 ** 40` and `pokemonId(sourceId: string): number` (deterministic: the first 52
    bits of SHA-256 of `pkm:${sourceId}`, folded into `[2^40, 2^53)`)
  - `gameOfId(id: number): GameId`

- [ ] **Step 1: Write the failing tests**

```ts
test('pokemonId is stable, in range, and distinct for distinct ids', () => {
  expect(pokemonId('sv02-045')).toBe(pokemonId('sv02-045'))
  for (const id of ['sv02-045', 'SV1S-001', 'base1-4', 'csv8c-001']) {
    const n = pokemonId(id)
    expect(Number.isSafeInteger(n)).toBe(true)
    expect(n).toBeGreaterThanOrEqual(2 ** 40)
    expect(gameOfId(n)).toBe('pkm')
  }
  expect(pokemonId('sv02-045')).not.toBe(pokemonId('sv02-046'))
})
test('Yu-Gi-Oh ids are ygo', () => expect(gameOfId(89631139)).toBe('ygo'))
test('Pokémon is owner-only', () => {
  expect(allowedGames(false)).toEqual(['ygo'])
  expect(allowedGames(true)).toEqual(['ygo', 'pkm'])
})
test('features', () => {
  expect(gameDef('ygo').features).toEqual({ scan: true, rip: true })
  expect(gameDef('pkm').features).toEqual({ scan: false, rip: false })
  expect(gameDef('pkm').crossLanguagePriceFallback).toBe(false)
})
```

- [ ] **Step 2: Run them to see them fail.** Run `npm test -- tests/main/games.test.ts`. They
  should FAIL because the module doesn't exist yet.
- [ ] **Step 3: Implement the five files.** Keep `src/shared/games/` free of Node and Electron
  imports, because the phone build fails on them (`noNodeBuiltins` in `vite.phone.config.ts`). Use
  `@noble/hashes` if it's already a dependency, otherwise a small sync SHA-256. Don't use
  `node:crypto`.
- [ ] **Step 4: Run the tests to see them pass.** Run `npm test -- tests/main/games.test.ts`. They
  should PASS.
- [ ] **Step 5: Commit.** `feat(games): game registry and Pokémon id range`

### Task 2: Schema V19, game columns and Pokémon card fields

**Files:**
- Modify: `src/main/db/schema.ts` (add `SCHEMA_V19`, `SCHEMA_V19_SERVER`, and
  `{ version: 19, … }`)
- Modify: `workers/portal/src/migrate.ts` (add `server-12`)
- Modify: `src/shared/catalogTables.ts`
- Create: `tests/fixtures/pokemon.ts`
- Test: `tests/main/migration-v19.test.ts`, `tests/portal/migrate.test.ts`

**Interfaces:**
- Produces:
  - **Schema, desktop, phone and server:**
    - `game TEXT NOT NULL DEFAULT 'ygo'` on `cards`, `card_images`, `card_printings`, `sets` and
      `collection_entries`
    - `sets` rebuilt with `PRIMARY KEY (game, language, set_name)`. It is not referenced by any
      foreign key, so a rebuild is allowed.
    - `value_snapshots` rebuilt with `game` in its key: `(owner_id, game, date)` on desktop and
      `(user_id, game, date)` on the server.
    - a new catalog table `pokemon_cards (card_id INTEGER PRIMARY KEY REFERENCES cards(id),
      category TEXT NOT NULL, hp INTEGER, types TEXT NOT NULL DEFAULT '[]', stage TEXT,
      rarity TEXT, illustrator TEXT, source_id TEXT NOT NULL UNIQUE)`
  - **Desktop only:** `cloud_game_cursors (owner_id INTEGER NOT NULL, game TEXT NOT NULL, stream
    TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (owner_id, game, stream))`.
    Streams are `'entries'` and `'prices'`. Yu-Gi-Oh keeps using `cloud_accounts.cursor` and the
    existing price cursor, so those don't change.
  - **Server-only (`server-12`):**
    - `game` on `catalog_tombstones` (default `'ygo'`)
    - `ix_<table>_game_seq ON <table>(game, catalog_seq)` for each game-bearing catalog table
    - catalog seq triggers recreated for `sets` (new key) and `pokemon_cards`
    - delete triggers write `OLD.game` into the tombstone. Tombstones for `sets` store the
      three-part key `[game, language, set_name]`.
  - **`CATALOG_TABLES`:**
    - `game` added to the columns of cards, card_images, card_printings and sets
    - the `sets` key becomes `['game', 'language', 'set_name']`
    - `pokemon_cards` appended, with key `['card_id']`
    - Each table gains `games: GameId[]`: `pokemon_cards` → `['pkm']`, the four shared tables →
      `['ygo', 'pkm']`, and every other table → `['ygo']`.
  - **`LEGACY_CATALOG_TABLES`:** a frozen copy of today's list (with no `game` column and today's
    `sets` key). It is exported from `src/shared/catalogTables.ts` for the legacy feed.
  - **`tests/fixtures/pokemon.ts`:** `seedPokemon(db: SqlDb): { cardIds: number[];
    printingIds: number[] }`. It inserts two Pokémon cards, one English and one Japanese, using
    `pokemonId()`. Each gets Normal and Reverse Holo versions in `set_rarity`, set codes like
    `PAL 045/193`, and `pokemon_cards` rows. One Pokémon set is named exactly after an English
    Yu-Gi-Oh set already in the test fixtures.

- [ ] **Step 1: Write the failing tests.** Start from a v18 database seeded with today's
  Yu-Gi-Oh fixtures (use the existing helper in `tests/main/helpers.ts`), migrate it, and check:
  - every pre-existing row has `game = 'ygo'`
  - `SELECT pkey FROM card_printings ORDER BY id` is identical before and after
  - the `sets` row count is unchanged
  - `seedPokemon` succeeds alongside the same-named Yu-Gi-Oh set
  - `PRAGMA foreign_key_check` is empty

  In `tests/portal/migrate.test.ts`, add the server equivalent, plus a test that deleting a
  Pokémon `sets` row writes a tombstone with `game = 'pkm'` and key `["pkm","en","<name>"]`.
- [ ] **Step 2: Run them to see them fail.** Run
  `npm test -- tests/main/migration-v19.test.ts tests/portal/migrate.test.ts`. They should FAIL.
- [ ] **Step 3: Write `SCHEMA_V19`, `SCHEMA_V19_SERVER` and `server-12`.** Also cover the phone:
  `src/phone/data/phoneSchema.ts` runs `MIGRATIONS`, so check that it needs no change.
- [ ] **Step 4: Run them to see them pass.** Then run the whole suite:
  `npm run typecheck && npm test && npm run test:portal`. Existing tests should pass unchanged.
- [ ] **Step 5: Commit.** `feat(db): game columns, Pokémon card fields (V19, server-12)`

### Task 3: Game-scoped repo queries

**Files:**
- Modify: `src/main/repo/scope.ts`, `workers/portal/src/scope.ts`
- Modify:
  - every repo module that reads catalog or entries: `src/main/repo/{collection,cards,browse,sets,stats,scan,rip}.ts`
  - the price join helpers in `src/main/repo/collection.ts:45-85`, `sets.ts` (`PRINTING_PRICE`),
    `scan.ts` and `stats.ts`
- Test: `tests/main/game-scope.test.ts`, `tests/portal/scope.test.ts`

**Interfaces:**
- Consumes: the Task 2 schema, and `seedPokemon`.
- Produces:
  - **`Scope` gains `game: string`.** It's a SQL expression for the active game. `LOCAL.game` is
    `ACTIVE_GAME`, and `userScope(userId, game: GameId)` uses a quoted literal (checked with
    `isGameId`).
  - `ACTIVE_GAME = "(SELECT COALESCE((SELECT value FROM meta WHERE key = 'active_game'), 'ygo'))"`
  - `Scope.where(alias)` also requires `alias.game = <game>`.
  - `insertEntry` writes `game`. `snapshotTable` includes `game` in `insertCols` and `where`.
  - Every query over `cards`, `card_printings`, `sets` or `card_images` filters on `<table>.game =
    scope.game`. Joins between `card_printings` and `sets` match on `game` as well as language and
    name. Rip queries also require `game = 'ygo'`.

- [ ] **Step 1: Write the failing tests.** Seed Yu-Gi-Oh fixtures and `seedPokemon`, add one entry
  of each game, then check:
  - With `active_game` unset, the repo functions behind `collection.list`, `collection.facets`,
    `cards.search`, `cards.browse`, `cards.browseFacets`, `sets.list`, `sets.checklist`,
    `stats.get` and `scan.printingsByCode` (find them through `src/main/ipc/dataHandlers.ts`)
    return only Yu-Gi-Oh, with the same results as the existing tests expect.
  - With `active_game = 'pkm'`, they return only the Pokémon rows.
  - `getStats().totalCards` counts only the active game.
  - Value snapshots are written and read per game.
  - The same-named set lists once under each game, and its checklist never mixes cards.

  Add the server version for `userScope(id, 'pkm')` in `tests/portal/scope.test.ts`.
- [ ] **Step 2: Run them to see them fail.** Run
  `npm test -- tests/main/game-scope.test.ts tests/portal/scope.test.ts`. They should FAIL.
- [ ] **Step 3: Thread `scope.game` through each query.** Repo functions that take no scope today
  (`browse`, `cards`, `sets` reads) take one now, defaulting to `LOCAL`.
- [ ] **Step 4: Run the whole suite to see it pass.** Run `npm test && npm run test:portal`. All
  existing tests should pass unchanged.
- [ ] **Step 5: Commit.** `feat(repo): every query is scoped to the active game`

### Task 4: Per-game filters and facets

**Files:**
- Modify: `src/shared/types.ts` (`CollectionFilters`, `BrowseFilters`, `Facets`, `BrowseFacets`,
  `CollectionStats`)
- Modify: `src/main/repo/collection.ts`, `src/main/repo/browse.ts`, `src/main/repo/stats.ts`
- Test: `tests/main/game-filters.test.ts`

**Interfaces:**
- Produces:
  - `CollectionFilters` and `BrowseFilters` gain optional `pkmCategories?: string[]`,
    `pkmTypes?: string[]`, `pkmStages?: string[]`, `hpMin?: number` and `hpMax?: number`. On
    Pokémon, the Yu-Gi-Oh-only fields are ignored, and the reverse.
  - `Facets` and `BrowseFacets` gain optional `pkmCategories`, `pkmTypes` and `pkmStages`. These are
    filled only on Pokémon, and the Yu-Gi-Oh facets are empty arrays there.
  - `CollectionStats.byFrameType` is Yu-Gi-Oh's breakdown. For Pokémon it holds the category
    (Pokémon/Trainer/Energy). Same field, so old web clients still parse it.
  - `BrowseSort` `'atk' | 'def' | 'level'` falls back to `'name'` on Pokémon. `'hp'` is added for
    Pokémon.

- [ ] **Step 1: Write the failing tests.** On Pokémon:
  - `pkmTypes: ['Fire']` returns only Fire cards.
  - `hpMin: 100` excludes lower-HP cards.
  - Facets list the seeded categories, types and stages.
  - `attributes: ['DARK']` is ignored.

  On Yu-Gi-Oh, the `pkm*` filters are ignored.
- [ ] **Step 2: Run the test to see it fail.** Run `npm test -- tests/main/game-filters.test.ts`.
  It should FAIL.
- [ ] **Step 3: Implement.** Pokémon fields come from `pokemon_cards`, joined on `card_id`.
  `types` is a JSON array: filter it with `json_each`.
- [ ] **Step 4: Run it to see it pass.** Then run `npm test`.
- [ ] **Step 5: Commit.** `feat(repo): Pokémon filters and facets`

### Task 5: Per-game pricing rules

**Files:**
- Modify:
  - `src/shared/pricing.ts` (`priceFor`)
  - `src/main/repo/enTwin.ts` and its callers
  - `src/main/prices/candidates.ts`
  - `workers/portal/src/prices.ts` and `workers/portal/src/sweep.ts`
  - `src/main/tcgplayer/prices.ts`
- Test: `tests/main/game-pricing.test.ts`, `tests/portal/sweep.test.ts`

**Interfaces:**
- Produces:
  - **The English-twin price fallback is gated per game.** It applies only when
    `gameDef(game).crossLanguagePriceFallback` is true. Each price SQL helper takes the game
    expression from the scope.
  - **eBay pricing is Yu-Gi-Oh only for now.** Price candidates and the set sweep add
    `card_printings.game = 'ygo'`, because the eBay query builder is Yu-Gi-Oh-specific. Step 3
    opens these up for Pokémon.
  - **TCGplayer matching is Yu-Gi-Oh only.** The TCGCSV price refresh writes `market_price` only to
    `game = 'ygo'` printings.

- [ ] **Step 1: Write the failing tests.**
  - Give a Pokémon English Normal printing a `market_price`, and give its Japanese counterpart (same
    name and number) none. With `active_game = 'pkm'`, the Japanese entry's price must be `null`,
    and stats must count it as unpriced.
  - The Pokémon Reverse Holo printing never shows the Normal's price.
  - `candidates` and the sweep never pick a `pkm` printing.
  - The existing `en-twin.test.ts` expectations for Yu-Gi-Oh still hold.
- [ ] **Step 2: Run them to see them fail.** Run
  `npm test -- tests/main/game-pricing.test.ts tests/portal/sweep.test.ts`. They should FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to see them pass.** Then run `npm test && npm run test:portal`.
- [ ] **Step 5: Commit.** `feat(prices): no cross-language fallback for Pokémon; eBay and TCGplayer stay Yu-Gi-Oh`

### Task 6: Server access: allowed games, `/api/me` and RPC

**Files:**
- Modify: `src/shared/cloud.ts` (`Me`), `workers/portal/src/auth.ts` (`me`, plus a new
  `gamesFor(deps, userId): GameId[]`), and `workers/portal/src/rpc.ts`
- Test: `tests/portal/games-access.test.ts`

**Interfaces:**
- Consumes: `allowedGames`, `isAdminUser(deps, userId)` (existing), and `userScope(userId, game)`.
- Produces:
  - **`Me.games?: GameId[]`.** It's absent from old servers, and clients treat that as `['ygo']`.
  - **RPC calls name their game.** Each call reads the `x-duel-game` request header (missing means
    `'ygo'`). A game the user isn't allowed gets `403 {"error":"game-not-allowed"}`. Otherwise the
    call runs with `userScope(user.id, game)`.
  - **Friends RPC follows the header too.** `friends:collection` and `friends:facets` use it, so a
    friend's binder shows the caller's active game. The friend's own access doesn't matter: a
    friend with no Pokémon simply has no rows.
  - `GAME_HEADER = 'x-duel-game'` is exported from `src/shared/cloud.ts`.

- [ ] **Step 1: Write the failing tests.**
  - `/api/me` returns `games: ['ygo','pkm']` for the `ADMIN_DISCORD_ID` user and `['ygo']` for
    anyone else.
  - A non-owner's RPC call with `x-duel-game: pkm` returns 403.
  - The owner's `collection:list` with `pkm` returns only Pokémon entries.
  - A call with no header returns the same as today.
  - Update the CORS allow-list for the new header in `workers/portal/src/appCors.ts`, and test it.
- [ ] **Step 2: Run it to see it fail.** Run `npm test -- tests/portal/games-access.test.ts`. It
  should FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it to see it pass.** Then run `npm test && npm run test:portal`.
- [ ] **Step 5: Commit.** `feat(portal): per-user game access, enforced on /api/me and RPC`

### Task 7: Per-game entry and price sync

**Files:**
- Modify: `workers/portal/src/sync.ts` (`pullSince`, `priceChanges`, `pricesFor`, `applyPush`,
  `syncRoute`)
- Modify: `src/main/cloud/client.ts`, `src/main/cloud/engine.ts`, `src/main/cloud/localSync.ts`
- Test: `tests/portal/sync-games.test.ts`, `tests/main/cloud-sync-games.test.ts`

**Interfaces:**
- Consumes: `gamesFor`, `cloud_game_cursors`.
- Produces:
  - **Server reads.**
    - `GET /api/sync/pull` and `GET /api/sync/price-changes` take an optional `game` parameter.
      Without one, they return Yu-Gi-Oh rows only, exactly as today.
    - A game the user isn't allowed gets 403 `game-not-allowed`.
    - `pricesFor` ignores pkeys of games the user isn't allowed.
  - **Server push.**
    - `applyPush` derives each entry's game from the printing its pkey resolves to, and stores it.
    - An entry whose game the user isn't allowed gets `{ status: 'unknown-printing' }`. The client
      retries it later and never deletes it. Never `'rejected'`, because that one makes clients drop
      the uid.
  - **Client.**
    - `syncOnce` pulls entries and price changes once per game in `me.games`.
    - Yu-Gi-Oh uses the existing cursors and sends `game=ygo`. Every other game uses
      `cloud_game_cursors`, starting at 0 the first time the game is allowed.
    - Push is unchanged: dirty entries of every game, in one push.

- [ ] **Step 1: Write the failing tests.** On the server, seed one user with a Yu-Gi-Oh entry and a
  Pokémon entry, then check:
  - A pull with no `game` returns only the Yu-Gi-Oh entry, and its cursor moves past the Pokémon
    entry's seq without returning it.
  - A pull with `game=pkm` from 0 returns only the Pokémon entry.
  - A non-owner's `game=pkm` pull returns 403.
  - A push of a Pokémon entry by a non-owner returns `unknown-printing`, and the server row doesn't
    change.
  - A legacy push (no game anywhere) of a Yu-Gi-Oh entry still works.

  On the client, `syncOnce` against a fake server with `me.games = ['ygo','pkm']` keeps separate
  cursors. When `pkm` first appears in `me.games`, it pulls Pokémon from 0, even though the
  Yu-Gi-Oh cursor is high.
- [ ] **Step 2: Run them to see them fail.** Run
  `npm test -- tests/portal/sync-games.test.ts tests/main/cloud-sync-games.test.ts`. They should
  FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to see them pass.** Then run `npm test && npm run test:portal`. The
  existing `sync.test.ts` and `cloud-sync.test.ts` should pass unchanged.
- [ ] **Step 5: Commit.** `feat(sync): per-game pull cursors; legacy pulls stay Yu-Gi-Oh only`

### Task 8: Per-game catalog feed

**Files:**
- Modify: `workers/portal/src/catalogFeed.ts`, `src/shared/catalogFeed.ts` (`PHONE_TABLES` adds
  `pokemon_cards`)
- Modify: `workers/portal/src/catalogLoad.ts`, `src/main/catalog/service.ts`,
  `src/main/catalog/apply.ts` and `src/main/catalog/switch.ts`
- Test: `tests/portal/catalog-feed.test.ts`, `tests/main/catalog-service.test.ts`

**Interfaces:**
- Consumes: the Task 2 `CATALOG_TABLES` (with `games`), `LEGACY_CATALOG_TABLES`, and
  `ix_<table>_game_seq`.
- Produces:
  - **Function signature:** `catalogChanges(db, since, limit, tables?, game?: GameId)`.
  - **Request with `game`:**
    - covers tables whose `games` includes it, with rows filtered `game = ?`, tombstones filtered
      `game = ?`, and `CATALOG_TABLES` columns and keys
    - the user must be allowed the game, or the request gets 403
  - **Request without `game` (legacy):**
    - `LEGACY_CATALOG_TABLES` only, with rows filtered `game = 'ygo'` and legacy columns (no
      `game`)
    - `sets` tombstones are sent with the legacy two-part key `[language, set_name]`
  - **Seq queries** stay one query per table, never a UNION (the Durable Object's limit on terms in
    a compound SELECT), using the `(game, catalog_seq)` index.
  - **Loader:** `catalogLoad` accepts `game` on rows. Missing means `'ygo'`.
  - **Client cursors:**
    - The client keeps `catalog_cursor` for Yu-Gi-Oh and `catalog_cursor:pkm` for Pokémon (new
      `MetaKey`s), and runs one feed pass per game in `me.games`.
    - Staging (`catalog_staging`) records the game for each row.
    - A first Pokémon pass starts from 0.

- [ ] **Step 1: Write the failing tests.** Load Yu-Gi-Oh fixtures plus `seedPokemon` rows through
  the loader, then check:
  - The legacy feed from 0 contains no Pokémon row, no `game` column and no `pokemon_cards` table.
  - The legacy feed is otherwise identical to the feed this commit replaces: snapshot it before
    changing the code.
  - `game=pkm` from 0 returns exactly the Pokémon rows.
  - Deleting a Pokémon set shows up only in the `pkm` feed.
  - A non-owner asking for `game=pkm` gets 403.
  - Client side: a desktop whose Yu-Gi-Oh cursor is at the latest seq still gets every Pokémon row
    on its first `pkm` pass.
- [ ] **Step 2: Run them to see them fail.** Run
  `npm test -- tests/portal/catalog-feed.test.ts tests/main/catalog-service.test.ts`. They should
  FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to see them pass.** Then run `npm test && npm run test:portal`, including
  the `catalog-seq`, `catalog-load`, `catalog-apply` and `catalog-switch` tests.
- [ ] **Step 5: Commit.** `feat(catalog): per-game change feed; legacy feed unchanged`

### Task 9: Active game on each device

**Files:**
- Modify:
  - `src/shared/ipc.ts`, adding to `Api` and `INVOKE_CHANNELS`:
    `games: { available(): Promise<GameId[]>; active(): Promise<GameId>; setActive(g: GameId):
    Promise<void> }`
  - `src/main/ipc/dataHandlers.ts` and `src/main/db/meta.ts` (`'active_game'` key)
  - `src/main/cloud/account.ts` (keeps the last `me.games`)
  - `src/renderer/src/web/httpApi.ts` (stores the game in `localStorage` and sends `GAME_HEADER` on
    every RPC)
  - `src/renderer/src/lib/api.ts` (or wherever the phone builds its `Api`)
- Test: `tests/main/data-handlers.test.ts`, `tests/renderer/http-api.test.ts`,
  `tests/renderer/phone-api.test.ts`

**Interfaces:**
- Produces:
  - **`available()`.** Returns the signed-in account's `me.games`, cached for offline use. Signed
    out or unknown means `['ygo']`.
  - **`active()`.** Returns the stored game if it's in `available()`, otherwise `'ygo'`. It also
    writes `'ygo'` back.
  - **`setActive(g)`.** Rejects a game not in `available()`, stores the game, and fires
    `DATA_CHANGED` so every page reloads.
  - **Account changes.** Signing out or switching accounts re-checks `active()`.

- [ ] **Step 1: Write the failing tests.**
  - `setActive('pkm')` with `available = ['ygo']` rejects.
  - With the owner signed in, `setActive('pkm')`, then `collection.list()`, returns only Pokémon.
  - After signing out and signing in as a non-owner, `active()` is `'ygo'`, and `collection.list()`
    returns no Pokémon rows.
  - Web: `httpApi` sends `x-duel-game: pkm` after `setActive('pkm')`, and the choice survives a
    reload (it's in `localStorage`).
  - Phone: the same behavior through `phone-api`.
- [ ] **Step 2: Run them to see them fail.** Run
  `npm test -- tests/main/data-handlers.test.ts tests/renderer/http-api.test.ts tests/renderer/phone-api.test.ts`.
  They should FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them to see them pass.** Then run `npm run typecheck && npm test`.
- [ ] **Step 5: Commit.** `feat(app): remembered active game on desktop, phone and web`

### Task 10: The switch and per-game UI

**Files:**
- Create: `src/renderer/src/lib/game.tsx`, providing `GameProvider` and
  `useGame(): { game: GameId; def: GameDef; available: GameId[]; setGame(g: GameId): Promise<void> }`
- Create: `src/renderer/src/components/GameSwitch.tsx`
- Modify, in the renderer:
  - `src/renderer/src/components/AppShell.tsx` (holds the switch and hides the Rip and Scan nav per
    `def.features`)
  - `src/renderer/src/features/collection/FilterBar.tsx` and
    `src/renderer/src/features/browse/BrowsePage.tsx` (build their filters from `def.filters`)
  - `src/renderer/src/components/CardDetails.tsx`, `src/renderer/src/features/rip/cardFacts.ts`
    and `src/renderer/src/lib/rarityColors.ts`
- Modify, in the renderer: `src/renderer/src/lib/setLabels.ts` and the OCG/TCG labels in
  `EntryValue.tsx`, `SetChecklist.tsx` and `AddCardDialog.tsx`, which change to
  `def.vocab.regionLabel`.
- Modify, on the phone: `src/phone/PhoneShell.tsx` (holds the switch), `src/phone/PickerSheet.tsx`
  and `src/phone/PhoneCamera.tsx`.
- Modify, shared: `src/shared/setTypes.ts`, so the Yu-Gi-Oh set-name rules apply only to
  Yu-Gi-Oh.
- Test: `tests/renderer/game-switch.test.tsx`, plus the existing renderer and phone tests unchanged

**Interfaces:**
- Consumes: `Api.games`, `GAMES`.

- [ ] **Step 1: Mock up the switch for the owner before building it.** Render it in-app with the
  `render_html` tool, using the app's real styles, on the desktop sidebar or title bar and on the
  phone shell. It must be reachable from every screen and make the current game obvious at a
  glance. **Stop until the owner approves a design.**
- [ ] **Step 2: Write the failing tests.**
  - With `available = ['ygo']`, there's no switch in the DOM, and every existing renderer test
    passes unchanged.
  - With `['ygo','pkm']`, the switch shows both games, and choosing Pokémon calls
    `games.setActive('pkm')`.
  - On Pokémon, the Rip and Scan nav items are absent.
  - On Pokémon, the filter bar shows Category, Type, Stage and HP, and no Attribute or Level.
  - On Pokémon, the card details label the printing code "Number" and the rarity "Version".
- [ ] **Step 3: Run them to see them fail.** Run `npm test -- tests/renderer/game-switch.test.tsx`.
  They should FAIL.
- [ ] **Step 4: Implement it to the approved mockup.** The Yu-Gi-Oh UI must look identical to
  today. Check it with the `run` skill or `site:shots` before and after.
- [ ] **Step 5: Run the checks to see them pass.** Run `npm run typecheck && npm test`.
- [ ] **Step 6: Commit.** `feat(ui): game switch and per-game vocabulary and filters`

### Task 11: Old-client compatibility check and release

**Files:**
- Test: `tests/portal/legacy-client.test.ts`

- [ ] **Step 1: Write the end-to-end legacy test.** It drives the portal the way a v0.20 client
  does: no `game` parameters and no `x-duel-game` header. The account is the owner's, with Yu-Gi-Oh
  and Pokémon entries, and the catalog has Pokémon rows. Check:
  - Pull, push (an edit to a Yu-Gi-Oh entry), price changes and the catalog feed return only
    Yu-Gi-Oh, with today's fields.
  - Afterwards, the Pokémon entries on the server are unchanged (same `server_seq`, not deleted).
- [ ] **Step 2: Run it to see it pass.** Run `npm test -- tests/portal/legacy-client.test.ts`. If
  it fails, fix the owning task before continuing.
- [ ] **Step 3: Run a manual check against a local portal.** Run it with `wrangler dev`, with a
  v0.20.0 desktop build pointed at it through its portal URL override (`src/main/cloud/config.ts`).
  Sign in as the owner, sync, and confirm that the Yu-Gi-Oh collection and dashboard match the
  current release.
- [ ] **Step 4: Release.** The order matters:
  1. Deploy the portal first. It's one-way: the migrations run on deploy.
  2. Then publish the desktop release and the phone build. All Yu-Gi-Oh only to everyone, because
     no Pokémon data exists yet and only the owner can see the switch.
  3. Commit: `chore: release <next minor>`.
