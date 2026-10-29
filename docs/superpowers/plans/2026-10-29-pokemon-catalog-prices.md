# Pokémon Catalog and Prices (EN+JA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The nightly catalog job builds and prices the English and Japanese Pokémon catalog from
TCGdex and TCGCSV and uploads it through the existing per-game feed. The portal serves its art.
Desktop and phone search, add, show and value Pokémon cards.

**Architecture:**

- A new job-only module `scripts/catalog/pokemon/` fetches the sources into a job-local cache
  (`catalog-work/pokemon-src.sqlite`).
  - A matcher made of pure functions maps sets to groups, cards to products, and versions to
    labels and prices.
  - A writer turns that into `game = 'pkm'` rows in `work.sqlite` in one transaction.
- The job's diff, shrink guard and upload become game-aware over `CATALOG_TABLES`.
- The portal resolves Pokémon art and set logos from stored URLs.
- Clients get a per-game price rule from `GameDef` and Pokémon details fields.

**Tech Stack:** TypeScript, better-sqlite3 (job and desktop), Cloudflare Worker with Durable Object
SQLite (portal), React (desktop renderer and `src/phone`), vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-pokemon-catalog-prices-design.md` (parent:
`docs/superpowers/specs/2026-10-29-multi-game-pokemon-design.md`).

## Global Constraints

- Run vitest through `npm test -- <files>`. It already passes `--maxWorkers=2`; never raise that.
- No heavy synthetic test data: no 100k+ row fixtures in vitest or Miniflare. Fixtures are small,
  trimmed real JSON in `tests/fixtures/pokemon/`.
- Yu-Gi-Oh keys, rows, wire format and the legacy feed (`LEGACY_CATALOG_TABLES`, frozen) stay
  byte-for-byte the same. No shipped migration step is ever edited. The new ones are appended.
- Pokémon price rule: `market_price` only, for any language. Never `set_price`, never the English
  twin, never eBay or `intl_prices`. No fallback to low or mid prices, to another subtype, to
  another product or to another language.
- Every Pokémon card gets exactly one `card_images` row
  (`image_id = pokemonId(source_id + '#img')`), even without art.
- `pokemon_cards.source_id` is `{lang}/{tcgdexId}`. `cards.id = pokemonId(source_id)`.
- Language codes are `en` and `ja`.
- HTTP calls to TCGdex and TCGCSV send `User-Agent: DuelBinder/{version} (https://github.com/darkharasho/duel-binder)`,
  run at concurrency 4, and retry 3 times with backoff on network errors, 429 and 5xx.
- Allowed art hosts: `https://assets.tcgdex.net/` and `https://tcgplayer-cdn.tcgplayer.com/`.
- Portal hot queries keep the `+game = ?` form (tests/portal/game-index-plans.test.ts). DO SQLite
  rejects UNIONs of about 10 terms, so use one query per table.
- Pokémon stays owner-only (`access: 'owner'`). Do not touch the gate.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **A version must not change key between nights.** A card first written unmatched and later
  matched, or a set whose abbreviation appears later, must keep the same pkeys. The test is in
  Task 5 (`keeps set_code and set_name of written cards`).
- **A Pokémon source outage must not stop Yu-Gi-Oh.** With a TCGCSV 500 the job still uploads
  Yu-Gi-Oh and keeps the last Pokémon rows. The test is in Task 6.
- **A Japanese Pokémon card must never get an English price.** Every reader applies the per-game
  rule, including scan, sets and value totals. The tests are in Task 8.
- **Art can change to the wrong host.** A stored `image_url` on another host is never fetched.
  The test is in Task 7.
- **Collisions get no price.** Two (product, subtype) pairs mapping to one label leave that
  version with no price. The test is in Task 4.

---

### Task 1: Schema: V20 and server-13

**Files:**
- Modify: `src/main/db/schema.ts`
  - Add `SCHEMA_V20`.
  - Append `{ version: 20, sql: SCHEMA_V20, server: false }` to `MIGRATIONS`.
- Modify: `workers/portal/src/migrate.ts`
  - Append `server-13` to `SERVER_STEPS`.
- Modify: `src/shared/catalogTables.ts`
  - Add `'image_url', 'local_name'` to the `pokemon_cards` columns in `CATALOG_TABLES` only.
- Test: `tests/main/migration-v20.test.ts`, `tests/portal/migrate.test.ts` (extend)

**Interfaces:**
- Produces:
  - `pokemon_cards.image_url TEXT` and `pokemon_cards.local_name TEXT`, on desktop, phone and
    portal.
  - The feed serves both columns for `game=pkm`.

`SCHEMA_V20` is:

```sql
ALTER TABLE pokemon_cards ADD COLUMN image_url TEXT;
ALTER TABLE pokemon_cards ADD COLUMN local_name TEXT;
```

V20 is `server: false`. A fresh server runs desktop steps before `server-12` creates
`pokemon_cards`, so the server needs its own step.

`server-13` must:

1. Run the same two `ALTER`s.
2. Drop `trg_pokemon_cards_seq_ins`, `trg_pokemon_cards_seq_upd` and `trg_pokemon_cards_seq_del`.
3. Recreate them with `seqTriggers` and `game = 'pkm'` over a new frozen
   `SERVER_13_POKEMON_CARDS: FrozenTable`. This is server-12's `pokemon_cards` entry plus the two
   columns.

Without step 3, an update that only changes `image_url` would never bump `catalog_seq`.

- [ ] **Step 1: Write the failing tests**
  - `migration-v20.test.ts` opens a fresh database and asserts that `pokemon_cards` has both
    columns.
  - It also migrates a database at V19 that holds a `pokemon_cards` row, and asserts that the row
    survives with nulls in both columns.
  - In `migrate.test.ts`:
    - A fresh server and a server upgraded from server-12 both end with both columns.
    - `UPDATE pokemon_cards SET image_url='x'` raises the row's `catalog_seq`.
    - Deleting a row writes a tombstone with `game = 'pkm'`.
  - Extend the existing feed test (`tests/portal/catalog-feed.test.ts`):
    - The `pokemon_cards` rows in `?game=pkm` carry `image_url` and `local_name`.
    - The legacy feed has no `pokemon_cards`.
- [ ] **Step 2:** Run `npm test -- tests/main/migration-v20.test.ts tests/portal/migrate.test.ts tests/portal/catalog-feed.test.ts`.
  Expected: FAIL.
- [ ] **Step 3:** Implement as above.
- [ ] **Step 4:** Run the same command plus `tests/portal/catalog-feed-legacy.test.ts tests/main/catalog-apply.test.ts`.
  Expected: PASS.
- [ ] **Step 5:** Commit with `feat(db): pokemon_cards image_url and local_name (V20, server-13)`.

### Task 2: Game-aware job diff, shrink guard, upload and parity

**Files:**
- Modify: `scripts/catalog/build.ts`, `scripts/catalog/upload.ts`, `scripts/catalog/diff.ts` (if
  needed) and `scripts/catalog/parity.ts`
- Test: `tests/main/catalog-job.test.ts` and `tests/main/catalog-parity.test.ts` (extend)

**Interfaces:**
- Produces:
  - `findShrinks(work, base): string[]` keeps its signature. It now checks each `CATALOG_TABLES`
    table once per game in `t.games`, counting `base` rows `WHERE game = ?`. For tables with a
    `game` column, deletes are counted by the game of the deleted base row. Messages read
    `"{table} ({game}) would lose N of M rows"`.
  - The dry-run `counts` keys become `"{table}"` for single-game tables and `"{table}:{game}"` for
    tables in both games.
  - `uploadCatalog` diffs and uploads over `CATALOG_TABLES`. Rows carry `game`. The upload order
    and the delete order stay the same as today.

These are job-side only. The portal loader already accepts `game` and the `pokemon_cards` table.

- [ ] **Step 1: Write the failing tests** in `catalog-job.test.ts`. They use the file's existing
  fake portal and refresh helpers.
  - A `pkm` card, printing, image, set and `pokemon_cards` row in work, with an empty base, are
    uploaded with `game: 'pkm'`.
  - Yu-Gi-Oh-only work produces the same upload bodies as before. Snapshot the request bodies of
    the existing happy-path test before the change and assert they are unchanged, except that
    each row gains `game: 'ygo'`.
  - A base with 3,000 `ygo` and 100 `pkm` printings, where work keeps all 3,000 `ygo` and only
    40 `pkm`, is refused. The message names `card_printings (pkm)`. Counted over the whole table,
    the same 60 deletes would pass, since the limit is max(50, 3,100 × 2%) = 62.
  - 40 `ygo` deletes from that same base pass, since the limit is max(50, 3,000 × 2%) = 60.
  - A first `pkm` upload, with none in the base, is never a shrink.
  - Extend parity so it compares per game. The parity test asserts a `pkm` count mismatch is
    reported.
- [ ] **Step 2:** Run `npm test -- tests/main/catalog-job.test.ts tests/main/catalog-parity.test.ts`.
  Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(catalog): game-aware job diff, shrink guard and upload`.

### Task 3: Source clients and cache (TCGdex, TCGCSV)

**Files:**
- Create: `scripts/catalog/pokemon/http.ts`, `scripts/catalog/pokemon/tcgdex.ts`,
  `scripts/catalog/pokemon/tcgcsv.ts` and `scripts/catalog/pokemon/cache.ts`
- Create fixtures in `tests/fixtures/pokemon/`. Fetch them once from the live APIs with curl and a
  UA, then trim them:
  - TCGdex en: `sets.json` (list) and `set-sv01.json` (with `cards` trimmed to 001–003), plus the
    cards `sv01-001` to `003` and `base1-4`, with the base1 set trimmed to card 4.
  - TCGdex ja: the set list, `SV1S` (cards 001–003), `M4` (card 001), `PMCG1` (card 001) and
    `M1L` (card 001), with their full cards.
  - TCGCSV, cat 3: group lists trimmed to groups 22873, 604 and 1663. Cat 85: groups 23605,
    24653, 24399 and 23721. Then the products and prices of those groups, trimmed to the products
    the cards above reach plus one sealed product per group.
- Test: `tests/main/pokemon-sources.test.ts`

**Interfaces:**
- Produces (types in `scripts/catalog/pokemon/types.ts`):

```ts
export type PkmLang = 'en' | 'ja'
export interface TdVariant { type: string; subtype?: string; stamp?: string[]; thirdParty?: { tcgplayer?: number } }
export interface TdCard {
  id: string; localId: string; name: string; category?: string; rarity?: string | null; hp?: number
  types?: string[]; stage?: string; illustrator?: string; image?: string
  abilities?: { type?: string; name: string; effect?: string }[]
  attacks?: { cost?: string[]; name: string; damage?: string | number; effect?: string }[]
  variants_detailed?: TdVariant[]; thirdParty?: { tcgplayer?: number }
  set: { id: string; name: string }
}
export interface TdSet {
  id: string; name: string; releaseDate?: string; logo?: string
  abbreviation?: { official?: string }; cardCount?: { official?: number }
  cards: { id: string; localId: string; name: string }[]
}
export interface TcGroup { groupId: number; name: string; abbreviation: string | null }
export interface TcProduct { productId: number; groupId: number; name: string; imageUrl?: string; number: string | null }
export interface TcPrice { productId: number; subTypeName: string; marketPrice: number | null }
export interface PokemonSources {
  sets(lang: PkmLang): Promise<TdSet[]>            // full sets, cards brief
  cards(lang: PkmLang, ids: string[]): Promise<TdCard[]> // cached per the refetch rule
  groups(lang: PkmLang): Promise<TcGroup[]>        // en → cat 3, ja → cat 85
  products(lang: PkmLang, groupId: number): Promise<TcProduct[]>
  prices(lang: PkmLang, groupId: number): Promise<TcPrice[]>
}
export function createPokemonSources(opts: { cachePath: string; fetch?: typeof fetch; version: string; now?: () => Date; log?: (l: string) => void }): PokemonSources & { close(): void }
```

How the sources behave:

- `number` is `extendedData` `Number`, or null.
- The card cache rule: fetch when a card isn't cached, or was fetched more than 7 days ago, or has
  no `image`, or has no TCGplayer id on the card or on any variant.
- `http.ts` exports `getJson(url, opts)`, with the UA, the retries, and a concurrency limiter
  shared by the instance (4).
- A non-retryable or final failure throws. The caller abandons Pokémon for the night.

- [ ] **Step 1: Write the failing tests.** They use a fake `fetch` that serves the fixtures by URL
  and counts calls.
  - `cards` fetches a new id once. A second call within 7 days doesn't refetch. At day 8 it
    refetches. M4-001 (no image) refetches on every call.
  - Every request carries the UA header.
  - A 503 then 200 succeeds after one retry. Three 503s throw.
  - `groups('ja')` hits `/tcgplayer/85/groups`.
  - `products` maps `Number` into `number`, and gives null for the sealed product.
  - No more than 4 requests are in flight at once. Use a fake fetch that tracks concurrent calls.
- [ ] **Step 2:** Run `npm test -- tests/main/pokemon-sources.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(pokemon): TCGdex and TCGCSV clients with job cache`.

### Task 4: Matcher and versions (pure)

**Files:**
- Create: `scripts/catalog/pokemon/match.ts` and `scripts/catalog/pokemon/versions.ts`
- Modify: `src/main/tcgplayer/prices.ts`. Export
  `movedEnough(old: number | null, next: number | null): boolean`, built from
  `MIN_MOVE_USD` / `MIN_MOVE_SHARE`, and use it in `applyTcgPrices`. Yu-Gi-Oh's behaviour must not
  change.
- Test: `tests/main/pokemon-match.test.ts` and `tests/main/tcgplayer-prices.test.ts` (must stay
  green)

**Interfaces:**
- Consumes: the types from Task 3.
- Produces:

```ts
export function matchGroup(set: TdSet, cards: TdCard[], groups: TcGroup[], productGroup: Map<number, number>): number | null
export function matchProducts(card: TdCard, groupId: number | null, products: TcProduct[], productById: Map<number, TcProduct>): { products: { product: TcProduct; variantSubtype: string | null }[]; problems: string[] }
export interface PkmVersion { label: string; productId: number | null; subTypeName: string | null; price: number | null }
export function cardVersions(card: TdCard, matched: { product: TcProduct; variantSubtype: string | null }[], prices: Map<number, TcPrice[]>): { versions: PkmVersion[]; problems: string[] }
export function canonicalLabel(subTypeName: string): string
export function variantLabel(v: TdVariant): string
```

The rules are the spec's, under "Matching each set", "Matching each card", "Version labels" and
"Prices":

- `matchGroup` tries these in order:
  1. Vote: the group holding most of the set's product ids wins, if it holds at least half of
     them.
  2. The official abbreviation, case insensitive, if it is a unique hit.
  3. The normalized name, with punctuation and a leading `"{code}: "` stripped, if it is a unique
     hit.
  4. Otherwise null.
- `matchProducts`:
  - Use variant ids first, then the card id.
  - With no ids, fill by number: the card's `localId` against `number.split('/')[0]`, compared as
    integers when both are numeric and as exact strings otherwise. Accept only when exactly one
    product has that number.
  - Reject a product whose non-null number disagrees with `localId`, and add a problem.
- `cardVersions`:
  - Build the union of the TCGdex variants and the TCGplayer subtypes, by canonical label.
  - A product reached from a variant with a `subtype` prefixes title-cased subtype words
    ("shadowless" becomes "Shadowless "; "no-rarity" becomes "No Rarity ").
  - Two (product, subtype) pairs on one label are kept as one version with `price: null`, and a
    problem is added.
  - The price is a positive finite `marketPrice`, else null.
  - With no variants and no products, the result is `[{label:'Normal', productId:null, subTypeName:null, price:null}]`.

- [ ] **Step 1: Write the failing tests** against the fixtures:
  - `matchGroup(sv01)` is 22873 (vote).
  - `matchGroup(M4)` is 24653 (abbreviation). TCGdex gives M4 no ids.
  - `matchGroup(PMCG1)` is 23721 (vote, via 575571).
  - A set with neither returns null.
  - `matchProducts(M4-001)` is the Weedle product. It is filled by number `001/083` → 1.
  - Two products with the same number give no match.
  - A product id whose Number says `005/083` for card `001` is rejected, with a problem.
  - `cardVersions(sv01-001)` is `[{Normal, 487828, 'Normal', 0.12}, {Reverse Holofoil, 487828, 'Reverse Holofoil', 0.22}]`.
    Sort by label.
  - `cardVersions(SV1S-xxx with a Holofoil price)` includes Holofoil even though TCGdex lists
    only normal.
  - `canonicalLabel('Unlimited Holofoil')` is `'Holofoil'`, and `canonicalLabel('Unlimited')` is
    `'Normal'`.
  - base1-4 includes `Shadowless 1st Edition Holofoil` priced from product 106999, and `Holofoil`
    from 42382.
  - A collision fixture (two products both giving `Holofoil` with no subtype) yields one Holofoil
    with `price: null` and one problem.
  - An unmatched card with a TCGdex `reverse` variant yields Reverse Holofoil with `price: null`.
  - `movedEnough(1.00, 1.03)` is false and `movedEnough(1.00, 1.10)` is true. Use the existing
    constants' semantics.
- [ ] **Step 2:** Run `npm test -- tests/main/pokemon-match.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -- tests/main/pokemon-match.test.ts tests/main/tcgplayer-prices.test.ts`.
  Expected: PASS.
- [ ] **Step 5:** Commit with `feat(pokemon): set, card and version matching`.

### Task 5: Writer

**Files:**
- Create: `scripts/catalog/pokemon/write.ts` and `scripts/catalog/pokemon/index.ts`
- Test: `tests/main/pokemon-write.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4, `pokemonId` from `src/shared/games/ids.ts`, `movedEnough`, and
  `openDatabase`.
- Produces:

```ts
export interface PokemonReport { lang: PkmLang; sets: number; cards: number; versions: number; priced: number; images: number; unmatchedSets: string[]; unmatchedCards: number; problems: string[] }
export async function refreshPokemon(work: Database.Database, sources: PokemonSources, opts?: { langs?: PkmLang[]; log?: (l: string) => void }): Promise<PokemonReport[]>
```

`refreshPokemon` fetches and matches everything for both languages first. Only then does it write,
in one transaction:

- **`cards`:** `id`, `name`, `type` (the category), `desc`, `game = 'pkm'`, `updated_at`. For a
  Japanese card, `name` is the matched product's name with a trailing ` - {number}` stripped, else
  the TCGdex name.
- **`pokemon_cards`:** `category`, `hp`, `types` (JSON), `stage`, `rarity`, `illustrator`,
  `source_id`, `image_url`, and `local_name` (the TCGdex name for `ja` when `name` differs, else
  null).
- **`card_images`:** one row per card (`sort_order` 0, `missing_from_api` 0).
- **`sets`:** `game = 'pkm'`, the language, `set_name`, `set_code` (the abbreviation, else the
  TCGdex id in upper case), `tcg_date`, `image_url` (logo), and
  `image_key = td-{lang}-{tcgdexSetId}`. A Japanese `set_name` is the matched group's name, with a
  leading `"{code}: "` stripped, else the TCGdex name.
- **`card_printings`:** one per version.
  - `set_code` is `{abbrev} {localId}/{official}`, or `{abbrev} {localId}` when there is no
    official count.
  - `set_rarity` is the label. `set_rarity_code` and `variant` are `''`.
  - `tcg_product_id` and `market_price` are written only when `movedEnough(old, new)`, else the
    old value is kept.
  - `game = 'pkm'`.
- **The `desc` format** is one line per ability, `"{type}: {name} — {effect}"`, then one line per
  attack, `"{cost joined by ' '} {name} {damage}: {effect}"`, with empty parts omitted.

The writer also enforces these rules:

- **Frozen identity.** For a card that already has rows, reuse its existing printings'
  `set_name` and `set_code`, and its set's `set_name`, instead of computing new ones.
- **Sticky versions.** An existing `pkm` printing whose card still exists but whose label is no
  longer produced gets `missing_from_api = 1` and keeps its row. A card absent from TCGdex
  altogether gets `missing_from_api = 1` on its printings and image, and nothing is deleted.
- **Sticky art.** An existing non-null `image_url` is never replaced.
- **Never touch Yu-Gi-Oh.** Every write and every lookup is scoped to `game = 'pkm'`.

`index.ts` exports `runPokemonStep(work, opts: { cachePath; fetch?; version; log }) => Promise<{ reports: PokemonReport[]; error: string | null }>`.
It catches any error and returns it as `error`, without writing.

- [ ] **Step 1: Write the failing tests.** Use a fake `PokemonSources` built from the fixtures and
  a fresh `openDatabase(':memory:')` or a temp file.
  - After one run:
    - `en/sv01-001` exists with `game = 'pkm'` and `name = 'Pineco'`. Its printings are
      `SVI 001/198` Normal $0.12 and Reverse Holofoil $0.22.
    - One `card_images` row per card, including M4-001 (`image_url` is the TCGplayer product
      image) and PMCG1-001.
    - The Japanese M4 card is named in English and has `local_name` set. The M4 set row is named
      `Ninja Spinner`.
    - Every pkey is unique, and no Yu-Gi-Oh row changed. Seed one Yu-Gi-Oh card first and compare
      it afterwards.
  - **`keeps set_code and set_name of written cards`:** run 1 with an unmatched card (sources
    without its TCGCSV data and without an abbreviation). Run 2 with full data keeps the same
    `set_code` and `set_name`, adds the price on the same pkey, and leaves no duplicate Normal.
  - **Sticky:** run 2 without the Reverse Holofoil subtype keeps that row with
    `missing_from_api = 1`.
  - **Churn:** run 2 with Normal at $0.121 leaves `market_price` at 0.12.
  - **Error:** a sources object whose `prices` throws makes `runPokemonStep` return `error`, and
    leaves the tables unchanged from before the call.
- [ ] **Step 2:** Run `npm test -- tests/main/pokemon-write.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(pokemon): write the Pokémon catalog into the work database`.

### Task 6: Wire the Pokémon step into the nightly job

**Files:**
- Modify: `scripts/catalog/build.ts` and `.github/workflows/catalog.yml` (only if the cache path
  needs `pokemon-src.sqlite`. The whole `catalog-work` directory is cached already; verify and
  leave it if so.)
- Test: `tests/main/catalog-job.test.ts` (extend)

**Interfaces:**
- Consumes: `runPokemonStep` (Task 5).
- Produces: `JobOptions.pokemon?: (work: Database.Database) => Promise<{ reports: PokemonReport[]; error: string | null }>`.
  It defaults to `runPokemonStep` with `cachePath: join(dir, 'pokemon-src.sqlite')`. Also add the
  flag `--no-pokemon`, which skips the step.

The step runs after `refresh` and before the diff. A non-null `error` becomes
`problem('Pokémon refresh skipped: …')`, and the job continues with Yu-Gi-Oh. The job logs every
report line per language: counts, unmatched sets, unmatched cards, and versions priced and
unpriced. Each report problem is logged, but only the first 20 are listed as job problems, plus a
count of the rest. Only `error` fails the run.

- [ ] **Step 1: Write the failing tests**:
  - With a `pokemon` option returning `error: 'boom'`, Yu-Gi-Oh still uploads, `problems`
    contains `Pokémon refresh skipped: boom`, and the earlier `pkm` rows are still in work and are
    not deleted on the portal.
  - With a successful fake step, the dry-run counts include `card_printings:pkm`.
- [ ] **Step 2:** Run `npm test -- tests/main/catalog-job.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(catalog): build Pokémon in the nightly job`.

### Task 7: Portal art and set logos

**Files:**
- Modify: `workers/portal/src/images.ts` (`resolve`)
- Test: `tests/portal/images.test.ts` (extend)

**Interfaces:**
- Consumes: `PKM_ID_MIN` and `pokemon_cards.image_url`.
- Produces:
  - **Card art.** `/img/{small|full}/{id}` with `id >= PKM_ID_MIN` looks up
    `SELECT pc.image_url FROM card_images ci JOIN pokemon_cards pc ON pc.card_id = ci.card_id WHERE ci.image_id = ?`.
    - The R2 key is `card/{size}/{id}`, `anonymous: true`, and the cache is `CARD_CACHE`.
    - The upstream is `{url}/low.webp` (small) or `{url}/high.webp` (full) for
      `https://assets.tcgdex.net/`.
    - For `https://tcgplayer-cdn.tcgplayer.com/`, a trailing `_200w.jpg` is replaced with
      `_200w.jpg` (small) or `_in_1000x1000.jpg` (full).
    - A null URL, another host, or `cropped` returns `null` (404). Ids below `PKM_ID_MIN` behave
      exactly as today.
  - **Set logos.** `/img/set/td-…` looks up `SELECT image_url FROM sets WHERE image_key = ? AND +game = 'pkm'`.
    It must start with `https://assets.tcgdex.net/`, and the upstream is `{url}.webp`. Check that
    `SET_KEY_RE` admits `td-en-sv01`. A `td-` key that misses returns 404 and never falls through
    to YGOPRODeck's `setImageUrl`.

- [ ] **Step 1: Write the failing tests** with the file's existing fake R2 and fetch:
  - A TCGdex Pokémon id fetches `…/high.webp` for full.
  - A TCGplayer one fetches `…_in_1000x1000.jpg`.
  - `image_url = 'https://evil.example/x'` returns 404 with no upstream call.
  - A null `image_url` returns 404.
  - `cropped` returns 404.
  - `td-en-sv01` fetches `https://assets.tcgdex.net/en/sv/sv01/logo.webp`.
  - An unknown `td-` key returns 404 with no fetch.
  - The existing Yu-Gi-Oh image tests still pass.
- [ ] **Step 2:** Run `npm test -- tests/portal/images.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(portal): serve Pokémon card art and set logos`.

### Task 8: Per-game price rule in every reader

**Files:**
- Modify: `src/shared/games/types.ts`, `src/shared/games/ygo.ts` and `src/shared/games/pokemon.ts`
  to add `priceRule`.
- Modify the readers:
  - `src/main/repo/collection.ts` (`toView`)
  - `src/main/repo/sets.ts:177`
  - `src/main/repo/scan.ts:25`
  - `src/main/repo/cards.ts:63`
  - `src/main/prices/refresh.ts:16`
  - any other price-computing site found by `grep -rn "market_price\|set_price" src/main/repo src/main/prices src/phone`
- Test: `tests/main/game-pricing.test.ts` (extend)

**Interfaces:**
- Produces: `GameDef.priceRule: 'ygo' | 'marketOnly'`.
  - `YGO` keeps `'ygo'`: today's behaviour exactly.
  - `PKM` is `'marketOnly'`.
  - SQL sites branch on the printing's game. Keep `+p.game` forms, and build the CASE from
    `GAMES` the way `enTwin.ts` builds `FALLBACK_GAMES`, so no reader writes the literal `'pkm'`.
  - For `marketOnly` games, the price is `p.market_price` for every language, with no
    `set_price`, no `ip.price` and no twin. The entry view gives `approximate: false` and, with no
    price, `noPriceReason` the same as an unpriced non-Yu-Gi-Oh copy has today.

- [ ] **Step 1: Write the failing tests**. Seed one `pkm` card with an `en` printing
  (market 1.00) and a `ja` printing (market 2.00), plus an `intl_prices` row of 9.99 on the `ja`
  printing and a `set_price` of 5 on the `en` printing. Then:
  - The collection entry for `ja` gives 2.00, not approximate. For `en` it gives 1.00.
  - The sets total, the scan `rawPrice` and the card search `setPrice` use 2.00 and 1.00.
  - A `ja` printing with a null market gives no price. It does not give 9.99 or the `en` price.
  - Every existing Yu-Gi-Oh pricing test is unchanged and passes.
- [ ] **Step 2:** Run `npm test -- tests/main/game-pricing.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test -- tests/main/game-pricing.test.ts tests/main/pricing.test.ts tests/main/collection.test.ts tests/main/en-twin.test.ts tests/main/prices.test.ts`.
  Expected: PASS.
- [ ] **Step 5:** Commit with `feat(pricing): per-game price rule; Pokémon uses its own market price only`.

### Task 9: Search, details and filters for Pokémon

**Files:**
- Modify: `src/main/repo/browse.ts`, `src/main/repo/cards.ts` (search), `src/main/repo/pkmFilters.ts`,
  `src/shared/types.ts`, `src/shared/games/types.ts` and `src/shared/games/pokemon.ts`.
- Modify: `src/renderer/src/features/collection/filterFacets.ts`,
  `src/renderer/src/components/CardDetails.tsx`, `src/renderer/src/lib/rarityColors.ts` and
  `src/phone/ScreenDetails.tsx`.
- Test: `tests/main/game-filters.test.ts`, `tests/main/cards.test.ts` and `tests/main/browse.test.ts`
  (extend), and a renderer test beside the existing CardDetails tests in `tests/renderer/`.

**Interfaces:**
- Produces:
  - `CardRow` gains an optional `pokemon?: { category: string; hp: number | null; types: string[]; stage: string | null; rarity: string | null; illustrator: string | null; localName: string | null }`.
    It is filled wherever cards are read for a `pkm` scope, with one LEFT JOIN on `pokemon_cards`.
  - `GameDef.details: { key: string; label: string }[]`. For Pokémon: category "Category", hp
    "HP", types "Type", stage "Stage", rarity "Rarity", illustrator "Illustrator", localName
    "Japanese name". `CardDetails` and `ScreenDetails` render these from `card.pokemon`, skipping
    empty ones, and then `card.desc` as the card text. Yu-Gi-Oh's details are unchanged.
  - The filter `pkmRarities?: string[]` gets a FilterDef `{ key: 'pkmRarities', label: 'Rarity', kind: 'multi' }`.
    It is added to `pokemonWhere`, `pokemonFacets` and the `GAME_KEYS` of `filterFacets.ts`.
  - **Search** for a `pkm` scope matches `c.name`, `pokemon_cards.local_name` and the printing
    number. A query of digits matches `p.set_code`'s number part as `' {q}/'` or the `' {q}'` end.
    A query with a slash matches `' {q}'`. Leading zeros are significant only if typed: `45`
    matches `045/193` by comparing integers of the part after the last space and before `/`.
  - **Version colours:** in `rarityColors.ts`, Pokémon `Holofoil` and `1st Edition Holofoil`
    reuse the existing foil or holo colour if there is one, else gold. `Reverse Holofoil` gets a
    distinct silver-blue. Everything else is neutral.

- [ ] **Step 1: Write the failing tests**:
  - Searching `Pineco`, the Japanese name of a seeded `ja` card, `045` and `45/193` finds the
    seeded cards in a `pkm` scope and never in `ygo`.
  - The `pkmRarities` facet lists the seeded rarities, and filtering by one narrows the results.
  - `CardDetails` for a `pkm` card shows HP, Stage, Rarity and the Japanese name.
  - `CardDetails` for a Yu-Gi-Oh card renders as before (the existing tests still pass).
- [ ] **Step 2:** Run `npm test -- tests/main/game-filters.test.ts tests/main/cards.test.ts tests/main/browse.test.ts tests/renderer`.
  Expected: FAIL.
- [ ] **Step 3:** Implement. Check that the add-card flow (`AddCardDialog`, `PickerSheet` and
  `ReviewSheet`) lists the versions with their prices for a `pkm` card, using the seeded catalog
  in dev. Fix anything Yu-Gi-Oh-specific you find there, such as a hard-coded rarity list or
  passcode wording.
- [ ] **Step 4:** Run the same command plus `npm run typecheck`, or the repo's equivalent script
  from package.json. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(pokemon): search, details, rarity filter and version colours`.

### Task 10: Live dry run and full check

**Files:**
- None, unless the dry run finds a defect. Defects are fixed in the owning module, with a test.

- [ ] **Step 1:** Run `npm run catalog:job -- --dry-run` against the live APIs. Use a copy of
  `catalog-work` if one exists locally; otherwise an empty directory. It is network-heavy but
  real data, not synthetic.
  - Record the per-language report: sets, cards, versions, priced, images, unmatched sets and
    unmatched cards.
  - Record the dry-run counts for `*:pkm`.
  - Expected: roughly 23.7k en cards and 12.8k ja cards, no error, and most sets matched.
- [ ] **Step 2:** Pull 20 random `ja` and 20 random `en` set names and `set_code`s from the work
  database, and check them by eye. Japanese set names should be English where matched, and numbers
  should look like `SVI 001/198`. Check 10 random priced versions against tcgcsv by hand with
  curl. Any mismatch is a defect: fix it, with a test.
- [ ] **Step 3:** Run the whole suite, `npm test`, and `npm run typecheck` (or the equivalent).
  Expected: PASS.
- [ ] **Step 4:** Write the counts into the PR description draft at
  `.superpowers/sdd/pokemon-dryrun.md`.
