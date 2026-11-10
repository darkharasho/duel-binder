# Magic Step 2: the English Catalog, Art and Prices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The nightly catalog job builds the English paper Magic catalog from Scryfall's `default_cards` bulk file. That catalog has sets, cards, images, one printing per finish, and a USD market price per finish. The portal serves Magic art from `cards.scryfall.io` through R2. The apps show Magic filters, facets, stats and details, still to the owner and testers only. The legal and about pages carry the Wizards Fan Content notice and a Scryfall credit.

**Architecture:**
- **A new catalog stage, `magic`,** in `scripts/catalog/magic/`, after `onepiece` and before `upload`. It streams the bulk file and keeps only paper English objects. It maps them into rows, then writes the `game = 'mtg'` rows into `work.sqlite` in one transaction. The shared upload, shrink guard, feed and parity carry them as they carry One Piece's.
- **No matching step.** Scryfall already joins the TCGplayer prices (`prices.usd`, `usd_foil`, `usd_etched`) to each object.
- **Art isn't hashed or uploaded by the job.** The portal's `/img` fetches it on an R2 miss, the way Pokémon art works.
- **The apps** get Magic's facts, filters and facets through the shared repos (`src/main/repo/*`). The phone worker and the portal RPC import those same repos.

**Tech Stack:**
- TypeScript, Node streams (`node:zlib`, `node:readline`)
- better-sqlite3 for the job and desktop, sqlite-wasm for the phone, Durable Object SQLite + R2 for the portal
- React + Tailwind
- Vitest and Miniflare

**Spec:** `docs/superpowers/specs/2026-11-09-magic-design.md`: sections "Step 2", "Identity", "Terms" and "Anti-goals". It builds on `docs/superpowers/plans/2026-11-09-magic-step1-hidden-game.md` (merged as #243, shipped in v0.72.0).

**Test commands:**
- `npm test -- <files>`. The root script already passes `--maxWorkers=2`.
- `npm --prefix workers/portal test -- <files>`.
- `npm run typecheck && npm --prefix workers/portal run typecheck && npm run lint`.

## Global Constraints

- **Ids:**
  - card: `mtgCardId('en', oracleId)`
  - image: `mtgImageId(scryfallId)`
  - Both are in `src/shared/games/ids.ts` and are already permanent. A reversible card with no top-level `oracle_id` uses `card_faces[0].oracle_id`.
- **A printing** is one Scryfall object × one finish:
  - `set_code` = `` `${set.toUpperCase()} ${collector_number}` `` (`'MH3 123'`, `'PLST XLN-217'`, `'9ED 213★'`)
  - `set_rarity` = the rarity, plus ` (Foil)` or ` (Etched Foil)` for a finish other than non-foil (`'Rare'`, `'Rare (Foil)'`, `'Mythic (Etched Foil)'`)
  - `set_rarity_code` = the Scryfall id
  - `language = 'en'`, `tcg_product_id` NULL, `variant` NULL, `set_price` NULL
- **Rarity words:** `common`→`Common`, `uncommon`→`Uncommon`, `rare`→`Rare`, `mythic`→`Mythic`, `special`→`Special`, `bonus`→`Bonus` (`MTG_RARITIES`). Any other value is a note, and that object is skipped.
- **Price:**
  - Each finish takes its own field: `nonfoil`→`usd`, `foil`→`usd_foil`, `etched`→`usd_etched`.
  - **A foil never takes the non-foil price, and the other way round.**
  - A missing price on a new row stays NULL.
  - A missing price on an existing row leaves the stored price alone, as One Piece does.
  - A present price moves the stored one only when `movedEnough(old, next)` (`src/main/tcgplayer/prices.ts`).
- **What's kept:** objects with `lang === 'en'`, `games` including `'paper'`, and `digital !== true`. That includes tokens, emblems, art series and oversized cards. Everything else is dropped silently.
- **Keys never move.**
  - A written set keeps its name and code; only `tcg_date` and `series` update.
  - A written printing keeps `set_name`, `set_code` and `set_rarity`.
  - Nothing is deleted. A Scryfall object missing tonight gets `missing_from_api = 1` on its printings and its image.
- **Every statement in the Magic writer names `game = 'mtg'` or an `mtg_*` table.** Yu-Gi-Oh, Pokémon and One Piece rows stay byte-identical.
- **Scryfall requests:** `User-Agent: DuelBinder/<version> (<REPO_URL>)` and `Accept: application/json` (`*/*` for the bulk download). At most one request every 100 ms to `api.scryfall.com`.
- **Art:** Magic art is shown whole, never cropped or recoloured. The portal fetches only from `https://cards.scryfall.io/`.
- **Terms:**
  - Magic data is never behind an account tier: anonymous art is kept on, as for the other games.
  - The Fan Content notice is verbatim: "Duel Binder is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC."
  - The Scryfall credit is verbatim: "Card data and images from Scryfall".
  - No Scryfall or Wizards logo, and no mana-symbol font.
- **No heavy test data.** Fixtures stay under 30 objects. No vitest test builds 100k rows.

## Builder's calls (made while planning; the executor follows them)

1. **Set icons wait.** Scryfall set icons are SVG only (`icon_svg_uri`), and the portal refuses SVG (`IMAGE_TYPES`, `images.ts:219`). Serving SVG from our origin is a script risk. Sets are written with no `image_url` and no `image_key`. Cost if wrong: Magic sets show the generic set tile until a later step rasterises the icons.
2. **No bulk-file cache.** Scryfall rebuilds `default_cards` every 12 hours and asks bulk users to download it daily, so the job downloads it every night. The spec's "skip when `updated_at` hasn't changed" doesn't apply. The report logs `updated_at`.
3. **`magic-src.sqlite`** holds only `set_stats` (for the priced-share check), cached in the workflow like `onepiece-src.sqlite`.
4. **`tcg_product_id` stays NULL** for Magic. The Yu-Gi-Oh TCGplayer jobs read that column, so a Magic product id could be picked up there.
5. **Set type filter waits.** `sets` has no `set_type` column, and step 2 adds no migration. `mtgSetTypes` is removed from `MAGIC.filters`.
6. **Rarity filter:** the shared `rarities` facet already strips the ` (…)` suffix (`storedRarities`), so Magic uses it. The `mtgRarities` stub is removed. The finish is its own filter, `mtgFinishes`, with the values `Nonfoil`, `Foil` and `Etched Foil`.
7. **Colors** are stored as Scryfall letters (`W U B R G`).
   - Facets and the filter use display names: `White Blue Black Red Green`, plus `Colorless` for an empty list.
   - The filter matches any selected color, as `opColors` does.
   - `Colorless` matches `colors = '[]'`.
8. **Card types:**
   - `mtg_cards.types` = the words before `—` in every face's type line that are in `MTG_CARD_TYPES`, in that list's order:
     `['Artifact','Battle','Creature','Enchantment','Instant','Kindred','Land','Planeswalker','Sorcery','Tribal','Token','Emblem','Dungeon','Conspiracy','Plane','Phenomenon','Scheme','Vanguard']`
   - `cards.type` is the first of those, or `'Other'` when there are none.
9. **Two-faced cards:**
   - `name` is Scryfall's top-level name (`'A // B'`).
   - `cards.desc` is the faces' oracle texts joined with `'\n//\n'`.
   - `mana_cost`, `power`, `toughness`, `loyalty` and `defense` come from the top level, else from face 0.
   - `colors` is the top level, else the union of the faces' colors in WUBRG order.
   - `faces` is a JSON list of `{ name, mana_cost, type_line, oracle_text, power, toughness, loyalty, defense }` per face (NULL when the card has no `card_faces`).
   - The art is the front face.
10. **Set names:**
    - A new set whose Scryfall name another mtg set already has is written as `` `${name} (${CODE})` ``.
    - `series` is the parent set's name (`parent_set_code`, one level), else the set's own name.
    - `tcg_date` = `released_at`.
11. **Card facts:** `MagicFacts` gains `artist: string | null`, the card's distinct artists joined with `', '` (`GROUP_CONCAT(DISTINCT mi.artist)`). `setNumber` leaves `MAGIC.details`, because `CardDetails` already shows the printing code ("Set & number").
12. **A short file is refused.**
    - Tonight's kept objects must be at least 90% of the stored mtg images that aren't missing; otherwise the step throws `Scryfall file too short: <n> objects, <m> stored` and writes nothing.
    - A first night with nothing stored always passes.
13. **Legal text:**
    - The Fan Content notice and the Scryfall credit go on the portal terms page and on the desktop and phone About sections.
    - The About sections show them only when Magic is among the user's games.
    - The marketing footer and the `<title>`/`<h1>` stay as they are until Magic opens (spec: "on the marketing site when Magic opens to everyone").

## Review Focus

1. **A truncated or partial bulk download.** A cut-off stream must not flag most of the Magic catalog missing. Builder's call 12 makes it an error; a test in Task 3 pins it.
2. **Finish-only printings and one-sided prices.** A foil-only object with `usd` set but `usd_foil` null gets one printing, `Rare (Foil)`, with no price. An object with only `usd_foil` set prices its foil row and leaves its non-foil row NULL. Tests in Task 2.
3. **Two-faced and reversible cards.** A `transform` card has no top-level `image_uris`. A `reversible_card` has no top-level `oracle_id`. Both must still become one card with one front-face image, never a throw. Tests in Task 2 and Task 5.
4. **Odd collector numbers and duplicate keys.** `★`, `XLN-217` and letters keep their exact text. Two kept objects with one set and number (Scryfall says none, so a guard) must not abort the transaction on the unique `pkey`: the later one is skipped and noted. Tests in Task 2 and Task 3.
5. **Other games with 160k Magic rows beside them.** Every Yu-Gi-Oh, Pokémon and One Piece row stays byte-identical after the Magic write. No job read without a game filter picks up Magic printings: the audit is in Task 4. Tests in Task 3 and Task 4.

---

### Task 1: Read Scryfall: the bulk index, the streamed file, and the sets list

**Files:**
- Create:
  - `scripts/catalog/magic/types.ts`
  - `scripts/catalog/magic/scryfall.ts`
- Create the fixtures:
  - `tests/fixtures/scryfall/default-cards.sample.json`: about 12 objects, one per line, in Scryfall's array layout (`[`, then `{…},` per line, then `]`)
  - `tests/fixtures/scryfall/sets.sample.json`
- Test: `tests/main/magic-scryfall.test.ts`

**Interfaces:**
- Produces, in `types.ts`, the subset of Scryfall's card object the job reads, with Scryfall's field names:

  ```ts
  interface ScryFace { name: string; oracle_id?: string; mana_cost?: string; type_line?: string; oracle_text?: string
    colors?: string[]; power?: string; toughness?: string; loyalty?: string; defense?: string
    illustration_id?: string; artist?: string; image_uris?: Record<string, string> }
  interface ScryCard { id: string; oracle_id?: string; name: string; lang: string; layout: string
    set: string; set_name: string; collector_number: string; rarity: string; released_at: string
    games: string[]; digital: boolean; finishes: string[]
    prices: { usd: string | null; usd_foil: string | null; usd_etched: string | null }
    mana_cost?: string; cmc?: number; type_line?: string; oracle_text?: string; colors?: string[]
    color_identity: string[]; power?: string; toughness?: string; loyalty?: string; defense?: string
    keywords: string[]; card_faces?: ScryFace[]; illustration_id?: string; artist?: string
    frame: string; border_color: string; full_art: boolean; promo_types?: string[] }
  interface ScrySet { code: string; name: string; released_at?: string; parent_set_code?: string; set_type: string }
  interface ScryfallSource {
    bulkInfo(): Promise<{ downloadUri: string; updatedAt: string }>
    cards(downloadUri: string): AsyncIterable<ScryCard>   // every object, unfiltered
    sets(): Promise<ScrySet[]>
  }
  ```

- Produces, in `scryfall.ts`:
  - `createScryfall(o: { version: string; fetch?: typeof fetch; gapMs?: number }): ScryfallSource`
  - `isKept(c: ScryCard): boolean`: the Global Constraints rule
  - `parseBulkLines(lines: AsyncIterable<string>): AsyncIterable<ScryCard>`
- Uses `getJson` and `REPO_URL` from `scripts/catalog/pokemon/http.ts` for `GET https://api.scryfall.com/bulk-data` and `GET https://api.scryfall.com/sets`.
  - The bulk entry is the one with `type === 'default_cards'`, read as `{ download_uri, updated_at }`.
  - `sets()` follows `has_more`/`next_page` until it's done.
  - Requests to `api.scryfall.com` are spaced at least `gapMs` apart (default 100).
- `cards()` streams: `fetch` → `Readable.fromWeb(res.body)` → `readline`. If the response is still gzip (bytes `1f 8b`, when the runtime didn't decode it), it goes through `createGunzip()` first.
- `parseBulkLines`:
  - Accepts both array lines (`{…},`) and plain JSONL.
  - Ignores `[`, `]` and blank lines.
  - A line that isn't valid JSON throws `Scryfall bulk line <n> is not JSON`, so a cut-off file fails the night.
  - A stream that ends with no closing `]` after array-style lines throws `Scryfall bulk file ended early`.

- [ ] **Step 1: Write the failing tests:**
  - `parseBulkLines reads array and JSONL layouts`: the fixture file, read line by line, gives every object in order. The same objects re-serialised as JSONL give the same list.
  - `a cut-off file throws`: the fixture with its last 2 lines removed rejects with `Scryfall bulk file ended early`. A half line rejects with `is not JSON`.
  - `isKept`: an English paper object → true. Each of these → false:
    - `lang: 'ja'`
    - `games: ['arena']`
    - `digital: true`
    - `games: ['paper','mtgo']` with `digital: true`
  - `bulkInfo picks default_cards`: a fake fetch serves a `bulk-data` list with `oracle_cards`, `default_cards` and `all_cards`. The result is the `default_cards` URI and `updated_at`. The request carried `User-Agent` starting with `DuelBinder/` and `Accept: application/json`.
  - `cards() streams a gzipped body`: a fake fetch serves the fixture gzipped (`gzipSync`) with no content-encoding. It yields the same objects as the plain file.
  - `sets() follows next_page`: two fake pages give all their sets, in order.
- [ ] **Step 2: Run them and check they fail.** Run `npm test -- tests/main/magic-scryfall.test.ts`. They should FAIL (module not found).
- [ ] **Step 3: Implement** `types.ts` and `scryfall.ts`.
- [ ] **Step 4: Run them and check they pass.** Run the same command. They should PASS.
- [ ] **Step 5: Commit.** `feat(catalog): read Scryfall's bulk cards and sets`

### Task 2: Map Scryfall objects to Magic rows

**Files:**
- Create: `scripts/catalog/magic/rows.ts`
- Modify: `src/shared/games/magic.ts`. Add `MTG_CARD_TYPES` (Builder's call 8) and `MTG_COLOR_NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' } as const`.
- Test: `tests/main/magic-rows.test.ts`. It uses the Task 1 fixture, whose objects include:
  - one plain card with `finishes: ['nonfoil','foil']` and both prices
  - an etched-only object
  - a foil-only object with `usd` set and `usd_foil` null
  - a `transform` card with no top-level `image_uris`
  - a `reversible_card` with no top-level `oracle_id`
  - a token
  - an `art_series` object
  - a `★` collector number
  - a `PLST` `XLN-217` number
  - two printings of one oracle card in different sets
  - a `rarity: 'masterpiece'` object

**Interfaces:**
- Consumes: `ScryCard`, `ScrySet` (Task 1); `mtgCardId` and `mtgImageId`; `MTG_RARITIES`.
- Produces:

  ```ts
  interface MtgCardRow { id: number; oracleId: string; name: string; type: string; desc: string
    layout: string; typeLine: string; types: string[]; manaCost: string | null; manaValue: number | null
    colors: string[]; colorIdentity: string[]; oracleText: string | null; power: string | null
    toughness: string | null; loyalty: string | null; defense: string | null; keywords: string[]; faces: string | null }
  interface MtgImageRow { imageId: number; cardId: number; scryfallId: string; illustrationId: string | null
    artist: string | null; frame: string; borderColor: string; fullArt: boolean; promoTypes: string[] }
  interface MtgPrintingRow { cardId: number; scryfallId: string; finish: 'nonfoil' | 'foil' | 'etched'
    setCode: string /* 'MH3' */; code: string /* 'MH3 123' */; rarity: string /* 'Rare (Foil)' */; price: number | null }
  interface MtgSetRow { code: string; name: string; series: string; releasedAt: string | null }
  interface MagicRows { cards: Map<number, MtgCardRow>; images: MtgImageRow[]; printings: MtgPrintingRow[]
    sets: Map<string, MtgSetRow>; notes: string[] }
  function mtgRows(objects: Iterable<ScryCard>, sets: ScrySet[]): MagicRows   // objects already isKept
  ```

  - The card row comes from the first object seen for its oracle id. A later object with different oracle text adds no note: Scryfall's oracle data is per oracle id.
  - Prices: `Number(s)` of a non-null string; a value that isn't finite or is negative is NULL.
  - `sets` holds only codes that have a kept printing. A printing whose set isn't in the sets list gets a set row named after the object's `set_name`, with series = name.
  - Duplicate `(code, finish)` pairs: the later object is skipped with the note `duplicate Magic printing <code> <finish>: <id>`.
  - An unknown rarity is skipped with the note `unknown Magic rarity <rarity>: <id>`.

- [ ] **Step 1: Write the failing tests:**
  - `one card per oracle id`: the two printings of one oracle card give one `cards` entry with `id === mtgCardId('en', oracleId)` and two images.
  - `finishes and prices`:
    - The plain card gives `Rare` at its `usd` and `Rare (Foil)` at its `usd_foil`.
    - The etched-only object gives one `… (Etched Foil)` row at `usd_etched`.
    - The foil-only object gives one `(Foil)` row with `price` null, not its `usd`.
  - `set_code keeps the collector number exactly`: `'9ED 213★'` and `'PLST XLN-217'`.
  - `transform card`: one card named `'A // B'`, desc joined with `'\n//\n'`, `faces` lists two faces, `types` from both faces' type lines, and one image row.
  - `reversible card takes face 0's oracle id`.
  - `token types`: `types` includes `'Token'` and `'Creature'`; `type` is `'Creature'`. An `art_series` object with no known type has `type` `'Other'`.
  - `colors`:
    - top-level colors are kept;
    - a two-faced card with none at the top gets the faces' union in WUBRG order;
    - a land gets `[]`.
  - `series from parent set`: a set with `parent_set_code` takes the parent's name; one with no parent takes its own.
  - `unknown rarity and duplicate printing are notes`: `masterpiece` gives a note and no rows. A duplicated object (the fixture's plain card again with a new id) gives the duplicate note.
- [ ] **Step 2: Run them and check they fail.** Run `npm test -- tests/main/magic-rows.test.ts`. They should FAIL.
- [ ] **Step 3: Implement** `rows.ts` and the `magic.ts` constants.
- [ ] **Step 4: Run them and check they pass.** Run the same command plus `tests/main/games.test.ts`. They should PASS.
- [ ] **Step 5: Commit.** `feat(catalog): map Scryfall objects to Magic rows`

### Task 3: Write the mtg rows into the work database

**Files:**
- Create:
  - `scripts/catalog/magic/write.ts`
  - `tests/helpers/catalogHashes.ts`: move the `hashes()` closure out of `tests/main/onepiece-write.test.ts` as `catalogHashes(db, exceptGame: GameId): Record<string, string>`, and use it from both tests
- Modify: `tests/fixtures/magic.ts` (`seedMagic`): printings use `set_code` `'M15 33'` and `'M15 34'`, in the spec's form
- Test:
  - `tests/main/magic-write.test.ts`
  - `tests/main/onepiece-write.test.ts`: helper swap only; its assertions are unchanged

**Interfaces:**
- Consumes: `MagicRows` (Task 2), `movedEnough`, and the step-1 tables (`mtg_cards`, `mtg_images`, `schema.ts:615`).
- Produces:

  ```ts
  interface MagicReport { updatedAt: string; sets: number; cards: number; images: number; printings: number
    priced: number; missing: number; perSet: { setCode: string; printings: number; priced: number }[]; notes: string[] }
  function writeMagic(work: Database.Database, rows: MagicRows, o: { now: number; nowIso: string; updatedAt: string
    /** Test-only: replaces mtgCardId / mtgImageId to force a collision. */
    idOf?: { card: (oracleId: string) => number; image: (scryfallId: string) => number } }): MagicReport
  ```

- **The rules**, in one transaction, in the style of `scripts/catalog/onepiece/write.ts`:
  - **Short-file guard** (Builder's call 12). It runs before anything else. Count `card_images WHERE game = 'mtg' AND missing_from_api = 0` as `m`. If `m > 0` and `rows.images.length < 0.9 * m`, throw `Scryfall file too short: <n> objects, <m> stored`.
  - **Id collisions.** Map each card id to its oracle id and each image id to its Scryfall id. Do it over tonight's rows plus the existing `mtg_cards.oracle_id` and `mtg_images.scryfall_id`. Two sources on one id throw `Magic id collision: <a> and <b> → <id>`.
  - **`sets`.**
    - Look up by `(game 'mtg', set_code)`.
    - A new set inserts `('mtg', 'en', name, code, releasedAt, series)`, with Builder's call 10 for a taken name.
    - An existing one updates only `tcg_date` and `series` when they differ.
  - **`cards` and `mtg_cards`.**
    - `cards` is `(id, name, type, frame_type 'mtg', race '', "desc", updated_at, game 'mtg')`. It is updated only when name, type or desc differ.
    - `mtg_cards` is an upsert with `ON CONFLICT(card_id) DO UPDATE … WHERE <any column> IS NOT excluded.<col>`. JSON columns use `JSON.stringify`.
    - `cards_fts` is rebuilt once if any card changed.
  - **`card_images` and `mtg_images`.**
    - `card_images` is `(imageId, cardId, sort_order 0, missing 0, 'mtg')`, upserted when the card or the missing flag differs.
    - `mtg_images` is upserted when any column differs. `full_art` is 0 or 1, and `promo_types` is JSON.
  - **`card_printings`.**
    - Load the existing rows once:

      ```sql
      SELECT id, set_rarity_code, set_rarity, market_price, missing_from_api FROM card_printings
      WHERE game = 'mtg' AND language = 'en' AND contributed = 0
      ```

    - Key them `` `${set_rarity_code}|${finishOf(set_rarity)}` ``.
    - An existing row updates only `missing_from_api = 0` and the price, by the Global Constraints price rule.
    - A new row is inserted, with `set_name` the set's written name.
    - A new row whose `pkey` already exists is skipped with the note `Magic printing key taken: <code> <rarity>`, so the unique index never aborts the transaction.
  - **Not listed tonight.** Existing printings and `card_images` rows not seen tonight get `missing_from_api = 1`. Their price and `mtg_images` row stay unchanged.
  - **`perSet`** uses the One Piece query with `game = 'mtg'` on both sides. `priced` = `market_price IS NOT NULL`, and `missing` = printings flagged tonight.
- `finishOf(setRarity: string): 'nonfoil' | 'foil' | 'etched'` is exported from `src/shared/games/magic.ts`, next to `mtgFinishSql` (Task 6).

- [ ] **Step 1: Write the failing tests.** Each runs on a migrated work database (`openDatabase` on a temp file), seeded like `onepiece-write.test.ts`, plus `seedOnePiece`:
  - `writes the fixture`:
    - Row counts per table match `mtgRows`.
    - The plain card's printings carry `set_code` `'<SET> <n>'` and `set_rarity` `'Rare'` / `'Rare (Foil)'`, each with its own price.
    - `pkey` `en|<card>|<SET> <n>|Rare (Foil)` exists.
    - `cards.frame_type` is `'mtg'`.
  - `prices move enough, keep on null`:
    - Night 2 at +1% leaves `market_price`.
    - Night 3 at +30% moves it.
    - Night 4 with that price null leaves it.
  - `labels never move`: night 2 with the object's rarity changed to `mythic` keeps `set_rarity` `'Rare'`.
  - `missing is flagged, not deleted`:
    - Night 2 without one object flags its printings and image, and every mtg row count is unchanged.
    - Night 3 with it clears both flags.
  - `short file writes nothing`: night 1 has 10 objects; night 2 has 8, i.e. under 90% (the object count is what's compared; give the fixture enough images to make 8 < 9). It throws `Scryfall file too short: 8 objects, 10 stored`, and the mtg row hashes are equal before and after.
  - `id collision throws and writes nothing`: `idOf.card` maps two oracle ids to one id.
  - `taken set name gets its code`: two sets named `Promos` with codes `PA` and `PB` are written as `Promos` and `Promos (PB)`.
  - `leaves every ygo, pkm and op row byte-identical`: `catalogHashes(db, 'mtg')` is equal before and after, and its keys include `pokemon_cards` and `onepiece_cards`.
  - `a second identical night changes nothing`: `total_changes` is 0 across night 2.
- [ ] **Step 2: Run them and check they fail.** Run `npm test -- tests/main/magic-write.test.ts tests/main/onepiece-write.test.ts`. The Magic tests should FAIL, and the One Piece ones should PASS with the shared helper.
- [ ] **Step 3: Implement** `write.ts`, the helper, the `seedMagic` change and `finishOf`.
- [ ] **Step 4: Run them and check they pass.** Run the same command, plus every test file that imports `seedMagic` (`grep -rl seedMagic tests`). They should PASS.
- [ ] **Step 5: Commit.** `feat(catalog): write the English Magic catalog`

### Task 4: The `magic` stage in the nightly job

**Files:**
- Create:
  - `scripts/catalog/magic/index.ts`
  - `scripts/catalog/magic/cache.ts`: `magic-src.sqlite` holding `set_stats(set_code PRIMARY KEY, printings, priced)`, with `getSetStats`/`putSetStats`/`close`
  - `scripts/catalog/priceShare.ts`: move the priced-share check out of `scripts/catalog/onepiece/index.ts` (`SHARE_SET_MIN = 20`, `SHARE_DROP_PARTS = 5`, lines ~307-325) as `pricedShareProblems(old: Map<string, SetStat>, now: SetStat[]): string[]`, and use it from both stages
- Modify:
  - `scripts/catalog/build.ts`:
    - `STAGES` gets `'magic'` after `'onepiece'`
    - `JobOptions.magic?` and `skipMagic?`
    - the `--no-magic` flag and the usage comment
    - the default step: `runMagicStep(w, { cachePath: join(opts.dir, 'magic-src.sqlite'), version, log })`
    - the `.catch` → problem `Magic refresh skipped: <error>`; each of `problems` raised; `logMagic`
  - `.github/workflows/catalog.yml`:
    - `Restore Magic sources` / `Save Magic sources` (`if: always()`), covering `catalog-work/magic-src.sqlite` and its `-wal`, with key `catalog-mtg-${{ github.run_id }}-${{ github.run_attempt }}` and restore-keys `catalog-mtg-`. Check that no existing key starts with `catalog-mtg`.
    - A `Refresh Magic` step (id `magic`, `timeout-minutes: 60`, `continue-on-error: true`, `npm run catalog:job -- --stage magic`) after the One Piece one and before `Upload catalog`, plus `Flag a failed Magic step` in the One Piece form.
    - **The work-database cache path lists are not touched.**
  - Any job read the audit below finds.
- Test:
  - `tests/main/catalog-job.test.ts`: its `runJob` wrapper also passes `magic: async () => ({ report: null, error: null, problems: [] })`
  - `tests/main/magic-step.test.ts`
  - the existing One Piece step tests, unchanged

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces:
  - `runMagicStep(work, o: { cachePath: string; version: string; log: (l: string) => void; source?: ScryfallSource; now?: () => Date }): Promise<{ report: MagicReport | null; error: string | null; problems: string[] }>`. It never throws. In order:
    1. `bulkInfo()`
    2. `sets()`
    3. stream `cards()` through `isKept` into an array
    4. `mtgRows`
    5. `writeMagic`
    6. `pricedShareProblems` against `set_stats`, then store the new stats
  - Notes go in the report; the share drops go in `problems`.
  - `logMagic(r, log)`:
    - one line: `Magic en (<updatedAt>): <sets> sets, <cards> cards, <images> images, <printings> printings (<priced> priced), <missing> missing, <notes> notes`
    - then `Magic en <setCode>: <priced>/<printings> priced` for each set whose share is under 80%; all 950 sets would bury the log
    - then each note
- **Audit (Review Focus 5).**
  - List every `card_printings` / `card_images` / `cards` read in these places:
    - `scripts/catalog/*.ts`
    - `src/main/tcgplayer/*.ts`
    - `src/main/sync/*.ts`
    - `workers/ebay-prices/src`
  - Skip those already scoped by `game` (inline or on a following line), by `language <> 'en'`, or by joining a game-only table.
  - For each read that would pick up an English mtg row, add `+game = '<its game>'` (the `+` keeps the index choice, see the `+game` gotcha) and a test in that file's existing test file showing a `seedMagic` row is ignored.
  - Write the list, with a verdict per read, into the task report.

- [ ] **Step 1: Write the failing tests:**
  - In `catalog-job.test.ts`, add a describe `Magic step in the nightly job`:
    - `a failed mtg step is a problem; the others still upload`
    - `skipMagic leaves the step out`
    - `--stage magic runs it alone`
    - `the mtg step adds only mtg rows to the diff`: a fake step runs `seedMagic`. Every `:ygo`, `:pkm` and `:op` count equals the `skipMagic` run's.
  - In `magic-step.test.ts`, with a fake `ScryfallSource` over the Task 1 fixtures:
    - `end to end`: rows written, and `report.priced` counted
    - `a throwing source writes nothing`
    - `a share drop is a problem`: a set of 20 printings fully priced, then unpriced, gives `<SET> priced share fell from 100% to 0%`. The fixture objects are renumbered in memory, still under 30 objects.
- [ ] **Step 2: Run them and check they fail.** Run `npm test -- tests/main/catalog-job.test.ts tests/main/magic-step.test.ts`. They should FAIL.
- [ ] **Step 3: Implement** `index.ts`, `cache.ts`, `priceShare.ts`, the One Piece swap, `build.ts`, `catalog.yml`, and the audit fixes.
- [ ] **Step 4: Run them and check they pass.** Run the same command, then `npm test -- tests/main/onepiece-step.test.ts tests/main/catalog-references.test.ts` and the audited files' tests. They should all PASS.
- [ ] **Step 5: Run the stage against the live Scryfall once.** Write a throwaway script under `/tmp`, not committed. It opens `openDatabase('/tmp/mtg-scratch.sqlite')` and runs `runMagicStep` with `cachePath: '/tmp/mtg-scratch-src.sqlite'`, under `/usr/bin/time -v`. Record in the report:
  - wall time
  - peak RSS
  - the summary line
  - the note count, with the first 20 notes
  - the row counts

  They should be near the spec's: about 105k objects, 36k cards and 161k printings. A second run should report 0 changes. Then delete both scratch files.
- [ ] **Step 6: Commit.** `feat(catalog): Magic stage in the nightly job`

### Task 5: The portal serves Magic art from Scryfall

**Files:**
- Modify:
  - `src/shared/imageSources.ts`: `SCRYFALL_IMAGE_PREFIX = 'https://cards.scryfall.io/'` and `scryfallArtUrl(scryfallId: string, size: 'small' | 'full'): string | null`
  - `workers/portal/src/images.ts`: in the `mtg` branch of `resolve` (about line 444), select `scryfall_id` and return `source: fixed(url)`, keeping the existing key, `CARD_CACHE` and `anonymous: true`
- Test:
  - `tests/main/image-sources.test.ts` (or the file that tests `imageSources.ts`)
  - `workers/portal/test/images*.test.ts` (the file that has the step-1 Magic R2-only case)

**Interfaces:**
- `scryfallArtUrl`:
  - It is `` `${SCRYFALL_IMAGE_PREFIX}${size === 'small' ? 'normal' : 'large'}/front/${id[0]}/${id[1]}/${id}.jpg` ``.
  - It returns null unless `id` matches `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/` after lowercasing. That pins the host and stops path tricks.
  - `cropped` requests use `small`, as `cardArtKey` does.
- The step-1 test "Magic art 404s with no upstream fetch" is replaced by the tests below.

- [ ] **Step 1: Write the failing tests:**
  - `scryfallArtUrl`:
    - `('77c6fa74-5543-42ac-9ead-0e890b188e99','small')` → `https://cards.scryfall.io/normal/front/7/7/77c6fa74-5543-42ac-9ead-0e890b188e99.jpg`
    - `'full'` → `/large/`
    - an uppercase id is lowercased
    - `'../x'` and `''` → null
  - Portal:
    - `Magic art: an R2 miss fetches Scryfall and stores it`: seed `mtg_images` for `mtgImageId('77c6fa74-…')`. A fake upstream serves a JPEG. `/img/small/<id>` returns 200 `image/jpeg`. R2 has `card/small/<id>`, and the fetched URL is the `normal` one.
    - `full` fetches `large` into `card/full/<id>`.
    - `an unknown Magic image is 404 with no fetch`.
    - `anonymous Magic art is served`: unsigned, within the per-IP quota.
    - `a Scryfall 404 is a 404 and is remembered`: the existing `anonMisses` behaviour.
- [ ] **Step 2: Run them and check they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and check they pass.** Run `npm --prefix workers/portal test -- <the images file> tests/portal/mtg-hidden.test.ts`, plus the root test for `imageSources`. Magic stays hidden for non-testers, so `mtg-hidden` passes unchanged.
- [ ] **Step 5: Commit.** `feat(portal): Magic art from Scryfall through R2`

### Task 6: Magic filters, facets, stats and details in the apps

**Files:**
- Create: `src/main/repo/mtgFilters.ts`
- Modify:
  - `src/shared/games/magic.ts`:
    - `filters` lose `mtgRarities` and `mtgSetTypes` (Builder's calls 5 and 6)
    - `details` lose `setNumber` (Builder's call 11)
    - add `mtgFinishSql(col: string): string`
  - `src/shared/types.ts`: `mtgColors?`, `mtgTypes?`, `mtgFinishes?` (string lists) and `manaValue?`, `mtgPower?`, `mtgToughness?` (ranges, the same shape as `cost`/`power`) in the four filter and facet interfaces (lines ~183, 233, 295, 318); `MagicFacts.artist: string | null`
  - `src/main/repo/cards.ts`:
    - rename `onePieceRead` → `gameFactsRead` everywhere (`cards.ts`, `collection.ts`, `browse.ts`)
    - add the artist sub-select to the mtg branch: `(SELECT GROUP_CONCAT(DISTINCT mi.artist) FROM card_images ci JOIN mtg_images mi ON mi.image_id = ci.image_id WHERE ci.card_id = c.id) AS mtg_artist`, joined with `', '`; GROUP_CONCAT's default separator is `','`, so use `GROUP_CONCAT(DISTINCT mi.artist)` and replace in JS, or a sub-select with `', '`
  - `src/main/repo/browse.ts` and `src/main/repo/collection.ts`: the `mtg` thunk in the filter chain calls `magicWhere`; facets spread `magicFacts(db, scope, …)` for mtg
  - `src/main/repo/stats.ts`: `byFrameType` `mtg` → copies grouped by `cards.type`
  - `src/renderer/src/lib/filters.ts`: `GameKey`/`GAME_KEYS` gain `mtgColors`, `mtgTypes`, `mtgFinishes`; labels `Color`, `Type`, `Finish`
  - `src/renderer/src/lib/rangeFilters.ts`: `RANGE_FIELDS` gain `manaValue` (`Mana value`), `mtgPower` (`Power`), `mtgToughness` (`Toughness`)
- Test:
  - `tests/main/mtg-filters.test.ts`
  - `tests/renderer/mtg-branches.test.tsx` (extend)
  - existing `cards`/`browse`/`collection` repo tests, unchanged except for the rename

**Interfaces:**
- `mtgFilters.ts`:
  - `magicWhere(f: MagicFilterFields): { sql: string; args: unknown[] } | null`, in the `onePieceWhere` form, with:
    - colors: any selected, via `json_each(mc.colors)`; `Colorless` → `mc.colors = '[]'`
    - types: any selected, via `json_each(mc.types)`
    - `manaValue` on `mc.mana_value`
    - power and toughness: only on rows whose value is all digits (`mc.power GLOB '[0-9]*' AND mc.power NOT GLOB '*[^0-9]*'`), compared as `CAST(… AS INTEGER)`
  - `mtgFinishWhere(values: string[], printingCol: string)` uses `mtgFinishSql`.
  - `magicFacets(db, scope, cardIds: number[] | null): { mtgColors: string[]; mtgTypes: string[]; mtgFinishes: string[] }`:
    - colors as display names in WUBRG order, then `Colorless`
    - types in `MTG_CARD_TYPES` order
    - finishes in the order `Nonfoil`, `Foil`, `Etched Foil`
    - only values present
- `mtgFinishSql(col)` = `CASE WHEN col LIKE '% (Etched Foil)' THEN 'Etched Foil' WHEN col LIKE '% (Foil)' THEN 'Foil' ELSE 'Nonfoil' END`.

- [ ] **Step 1: Write the failing tests** on a database with `seedMagic`, plus a second Magic card (a blue instant with `mana_value` 1, `power` NULL) and a colorless artifact creature with `power` `'*'`:
  - Filters:
    - `mtgColors ['Blue']` → only the instant
    - `['Colorless']` → only the artifact
    - `['White','Blue']` → both coloured cards
  - `mtgTypes ['Creature']` → Serra Angel and the artifact.
  - `manaValue {min: 0, max: 2}` → the instant only.
  - `mtgPower {min: 4}` → Serra Angel only; the `'*'` card is never matched by a power range.
  - `mtgFinishes ['Foil']` on the collection → only the `Rare (Foil)` printing.
  - `magicFacts`:
    - colors `['White','Blue','Colorless']`
    - finishes `['Nonfoil','Foil']`
    - types in list order
  - The shared `rarities` facet for Magic in browse is `['Rare']`, not `'Rare (Foil)'`.
  - `card.magic.artist` is the seeded artists joined with `', '`.
  - Stats: Magic `byFrameType` counts by `Creature` / `Instant` / `Artifact`.
  - Renderer (`mtg-branches.test.tsx`):
    - the Magic filter panel shows Color, Type, Finish, Rarity, Mana value, Power and Toughness, and no Set type
    - `CardDetails` for Serra Angel shows "Set & number" once and an Artist row
- [ ] **Step 2: Run them and check they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and check they pass.**
  - Run the new tests, plus every `tests/main/*browse*`, `*collection*`, `*cards*`, `*stats*` and `tests/renderer/op-branches.test.tsx`.
  - Run `npm run typecheck`.
  - Then `npm --prefix workers/portal test -- tests/portal/mtg-hidden.test.ts` (the RPC shares the repos).
  - All should PASS.
- [ ] **Step 5: Commit.** `feat(games): Magic filters, facets, stats and details`

### Task 7: Fan Content notice and Scryfall credit

**Files:**
- Modify:
  - `workers/portal/src/site/terms.ts`: in "Card data, prices and trademarks", a Magic paragraph with the two verbatim texts from Global Constraints. Line 25's game list stays as it is (Builder's call 13).
  - `src/renderer/src/features/settings/SettingsPage.tsx` (`AboutSection`, lines ~66-95): a Magic block, shown when `allowedGames` includes `'mtg'`.
  - `src/phone/Settings.tsx` (About, about line 305): the same block, with the same gate.
  - `README.md`: a Magic line under the disclaimers.
- Create: `src/shared/legal.ts`, with `MAGIC_FAN_CONTENT` and `SCRYFALL_CREDIT` as the verbatim strings, imported by all four places.
- Test:
  - `tests/portal/site*.test.ts` (or the test that renders the terms page)
  - `tests/renderer/settings*.test.tsx`
  - a phone settings test if one exists; otherwise add the case to `tests/renderer/mtg-branches.test.tsx`

- [ ] **Step 1: Write the failing tests:**
  - The terms page HTML contains `MAGIC_FAN_CONTENT` and `SCRYFALL_CREDIT`.
  - Desktop About shows both with Magic allowed, and neither without it.
  - The same for phone About.
  - The marketing home page (`page.ts`) contains neither (Builder's call 13).
- [ ] **Step 2: Run them and check they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and check they pass.**
- [ ] **Step 5: Commit.** `feat(legal): Wizards Fan Content notice and Scryfall credit`

### Task 8: Release check and order

- [ ] **Step 1: Full checks.** Run `npm run typecheck && npm --prefix workers/portal run typecheck && npm run lint`, then `npm test` and `npm --prefix workers/portal test`. If the machine is short on memory, run them one at a time; PR CI runs both again.
- [ ] **Step 2: Byte-identical check of the other games.** `git diff origin/main -- src/shared/games/ids.ts src/shared/catalogTables.ts src/main/db` shows no change.
- [ ] **Step 3: PR.** The body:
  - lists the Builder's calls and the Task 4 audit verdicts
  - says that **if a paid tier is ever added, Magic data must stay outside it** (spec, Terms)
  - carries this order as checkboxes:
    1. Merge, then deploy the portal. Magic art needs the new `/img` source; until then Magic tiles show the placeholder.
    2. The next nightly catalog run (or a manual `workflow_dispatch` of `catalog.yml`) loads Magic. Watch:
       - the `Refresh Magic` step's time and summary line
       - the upload step's time
       - the parity check
       - the first night uploads about 300k Magic rows
    3. Check on desktop as the owner: Browse → Magic shows cards, art loads, and prices are on foil and non-foil rows apart.
    4. Then tag the client release for the filters, facets, details and About text. Clients from v0.72.0 already receive and store the Magic rows.
- [ ] **Step 4: Stop for the owner's go** before the deploy, the workflow dispatch and the tag.
