# One Piece Step 2: the English Catalog and TCGplayer Prices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The nightly catalog job builds the English One Piece catalog from Bandai's card list,
prices it from TCGCSV category 68 without ever putting one version's price on another, and the
apps show it, with filters, facets, card details and the right art per version, to the owner
and testers only.

**Architecture:**
- **A new catalog stage, `onepiece`,** in `scripts/catalog/onepiece/`, built like the Pokémon one.
  It fetches, parses and matches everything first. Then it writes the `game = 'op'` rows into
  `work.sqlite` in one transaction. The shared upload, shrink guard, feed and parity carry them
  as they carry Pokémon's.
- **Sources.**
  - Bandai's series pages give the cards, kept in `catalog-work/onepiece-src.sqlite` and fetched
    on a schedule.
  - Bandai's PNGs are downloaded once each. They are hashed with the scanner's `artHash` and
    stored in R2 at full size and as a small copy, by the job itself.
  - TCGCSV category 68 gives products and prices nightly. TCGplayer's 200w images are hashed to
    tell versions apart.
- **Matching.** A Bandai entry and a TCGplayer product match within one series↔group and one
  number:
  - first by **kind** (base, SP, TR, parallel, or a promo's product name)
  - then by **art hash**, which must agree
  - anything ambiguous stays unpriced and becomes a data note
- **The `_pN` guard.** A known entry whose art hash changes is frozen (no price, product, label
  or art update) and raised once as a job problem.
- **The apps.**
  - `onepiece_cards` feeds new One Piece facts, filters, facets, stats and sorts in the shared
    repos, so desktop, the web app and the phone all get them.
  - A printing's art is `onePieceImageId('en', set_rarity_code)`: the printing's Bandai entry id
    is stored in `card_printings.set_rarity_code`. Every add path pairs an Alternate Art printing
    with its Alternate Art image.

**Tech Stack:** TypeScript, better-sqlite3 (job, desktop), sqlite-wasm (phone), Durable Object
SQLite + R2 (portal), pngjs / jpeg-js (already dependencies), React + Tailwind, Vitest, Miniflare.

**Spec:** `docs/superpowers/specs/2026-11-04-one-piece-design.md`, sections "Step 2: English
catalog and prices", "Anti-goals", "Constraints". It builds on
`docs/superpowers/plans/2026-11-04-one-piece-step1-hidden-game.md` (card model, ids, tables,
`seedOnePiece`), which must be merged first.

**Test commands:** `npm test -- <files>` (the root script already passes `--maxWorkers=2`);
`npm --prefix workers/portal test` (real DO SQLite); `npm run typecheck && npm --prefix
workers/portal run typecheck && npm run lint`.

## Source facts pinned on 2026-11-04 (used in the tests below)

These were fetched live, a handful of requests.
- **Series list.** `GET https://en.onepiece-cardgame.com/cardlist/` 302s to `?series=569117`
  (the newest, OP-17).
  - The series are `<option value="569117" selected>BOOSTER PACK &lt;br class=&quot;spInline&quot;&gt;-THE WORLD’S STRONGEST WARRIORS- [OP-17]`.
    The option text is HTML-escaped and can hold two `<br>`s:
    `BOOSTER PACK <br>-ADVENTURE ON KAMI’S ISLAND- <br>[OP15-EB04]`.
  - Two options have no brackets: `569901` "Promotion card" and `569801` "Other Product Card".
    There are 63 options.
- **Entries.** Each entry is `<dl class="modalCol" id="OP17-005_p1">…</dl>`. Inside it:
  - `<div class="infoCol"><span>OP17-005</span> | <span>SR</span> | <span>CHARACTER</span></div>`
  - `<div class="cardName">Edward.Newgate</div>`
  - `<div class="cost"><h3>Cost</h3>10</div>`. A Leader's has `<h3>Life</h3>5` instead.
  - `<div class="attribute"><h3>Attribute</h3><img …><i>Strike</i></div>`. Two attributes come
    as `Slash/Strike`, and an Event has `-`.
  - `<div class="power"><h3>Power</h3>12000</div>` and `<div class="counter"><h3>Counter</h3>-</div>`
  - `<div class="color"><h3>Color</h3>Yellow</div>`. Multicolor is `Blue/Black`.
  - `<div class="block"><h3>Block<br class="spInline"> icon</h3>5</div>`. The value is 1–5, or
    `X` (OP17-005, OP17-062 and others).
  - `<div class="feature"><h3>Type</h3>Egghead/The Four Emperors/Straw Hat Crew</div>`
  - `<div class="text"><h3>Effect</h3>…<br>…</div>` and an optional
    `<div class="trigger"><h3>Trigger</h3>[Trigger] Play this card.</div>`
  - `<div class="getInfo"><h3>Card Set(s)</h3>BOOSTER PACK -THE WORLD’S STRONGEST WARRIORS- [OP-17]</div>`
  - Names carry entities: `I Don&#039;t Have Time to Chat with Snot-Nosed Brats`.
- **Rarity.** A parallel shows the **base card's rarity**: OP17-005, `_p1` and `_p2` are all
  `SR`. The exceptions are `SP CARD` (`EB04-061_p2`, `P-084_p1`, `OP14-108_p3`) and `TR`.
  Rarities seen: L C UC R SR SEC P TR, and "SP CARD".
- **Listed elsewhere.** `EB04-061_p2` (an SP) is listed on the OP-17 page. The Promotion page
  (375 entries) holds parallels of booster numbers (`EB01-043_p1`…`_p6`), and each one's getInfo
  names a product: `Offline Regional Participation Pack 2025 Vol.1`,
  `Offline Regional Finalist Card Set 25-26 Season 1`.
- **Images.** `/images/cardlist/card/<id>.png`, 600×838, palette PNG with transparent rounded
  corners, about 270 KB.
- **TCGCSV groups.** `https://tcgcsv.com/tcgplayer/68/groups` has 87 groups, for example:
  - `{groupId: 24736, abbreviation: 'OP17', name: "The World's Strongest Warriors", publishedOn: '2026-08-28…'}`
  - `24775 'OP17 RE'` (release event), `24498 'OP13 ANN'`, `23737 'OP08 PRE'`
  - `24637 'OP15-EB04'`, `24749 'ST-31'`, `24305 'PRB-02'`, `23333 'EB01'`, `17675 'OP-PR'`
  - `23304 'OP-CS'`, `24306 'LT-01'`, `24708 'SD01'`, `23907 'OP-DD'`, `23890 'OP-RP'`
- **TCGCSV products.** `/68/24736/products` has 186 products, with `extendedData` Number, Rarity
  (`DON!!` and `PR` also appear), Color, CardType and more. The OP17-005 products:
  - `711499 'Edward.Newgate (005)'`
  - `708077 'Edward.Newgate (005) (Alternate Art)'`
  - `712083 'Edward.Newgate (005) (Manga)'`

  OP17-062 is `707133 'Kaido (062)'`, `707135 '(Alternate Art)'`, `712090 '(Manga)'` and
  `712091 '(Super Alternate Art)'`.

  Other names: `'Monkey.D.Luffy (EB04-061) (SP)'` (Rarity SEC), `'Buggy (P-084) (SP)'`,
  `'DON!! Card (Alternate Art) (Gold)'` (no Number). Suffixes seen: Alternate Art, SP, Manga,
  Pandaman Art, Gold, Super Alternate Art, Super Leader Alternate Art, Special Foil, TR.
- **TCGCSV prices.** `/68/24736/prices` gives `{productId, marketPrice, subTypeName: 'Normal' | 'Foil'}`,
  with one row per product.
- **Hashes.** The whole-card `artHash` distance from Bandai PNG to TCGplayer 200w JPG is 0–2 for
  the same version and 96–128 for any other (14 images measured, OP17-005 and OP17-062). In those
  two numbers `_p1` was the Alternate Art, `_p2` the Manga and `_p3` the Super Alternate Art, but
  nothing promises that order, which is why matching never uses it.

## Builder's calls (the owner delegated these; each is final for step 2)

1. **One printing per Bandai entry,** not per set appearance.
   - The set is the series page that lists the entry. If the same entry id appears on two pages,
     it is kept under the page whose series its own Card Set(s) text (`cardSets`) names: the text
     contains `[<series.code>]` or the series' `title`. This is the spec's "belonging to the set it
     was released in": an SP reprint listed on both EB04 and OP-17 whose getInfo says OP-17 stays
     in OP-17. If `cardSets` names more than one of the listing pages, or none, the earliest of
     those pages wins (by its mapped group's `publishedOn`, then by series id; an unmapped page
     sorts last). A data note is written either way (`dedupeEntries`, Task 3, run in Task 7).
   - This keeps `set_rarity` unique per card × `set_code`, since `pkey` has no set name.
   - The step-1 `SCHEMA_V40` doc comment still says "one row per set appearance x version". This
     call supersedes it. The comment is left as it is, because `schema.ts` must not change (Task 12
     Step 1).
2. **`set_code` is the printed number** (`OP17-005`). **`set_rarity_code` holds the printing's
   Bandai entry id** (`OP17-005_p1`), and the printing's art is
   `onePieceImageId('en', set_rarity_code)`.
   - The column is read by game-agnostic code only as an opaque pass-through (`rowToPrinting`,
     `contributionGroups`, `contribute.ts`, `artResolver.ts`, `references.ts`). The only code that
     parses it is `rarityAbbr` (`/^\(([A-Za-z0-9]+)\)$/`), which can't match a Bandai id. No key,
     unique index, dedupe or display uses it (pre-flight audit, 2026-11-04). Reusing it avoids a
     new migration and feed table.
   - `scripts/catalog/references.ts` does read op printings by their `set_rarity` labels, so
     Task 7 limits its three `card_printings` reads to `game = 'ygo'`.
   - Step 1's "variant stays NULL" still holds.
3. **Version labels (`set_rarity`), frozen at first write** like every Pokémon key:
   - A base entry is the rarity code (`SR`, `L`, `P`). Bandai `SP CARD` is `SP`, and `TR` is `TR`.
     The spec's example wording is "Treasure Rare". The spec leaves label wording to the builder,
     and `TR` is kept so that every label starts with a rarity code (the rarity filter, facet and
     colour read that code).
   - A booster parallel is `<rarity> (<TCGplayer kind>)`, for example `SR (Alternate Art)` or
     `SR (Manga)`.
   - An entry on the Promotion or Other Product page is `<rarity> (<its Card Set(s) text>)`.
   - A second label that's already taken gets a number: `SR (Alternate Art 2)`, `SP (2)`.
   - A booster parallel still unmatched 7 days after it was first seen is written as
     `<rarity> (Parallel)`, unpriced. A later match with a different kind is a data note only.
4. **Matching needs the art to agree.** Kind narrows the candidates, and the hash must then be
   ≤ `MATCH_MAX = 24`. If more than one candidate is left, the best must beat the next by
   `MATCH_MARGIN = 40`. If an image is missing, the entry is unpriced until tomorrow.
5. **A printing keeps its first matched product.** If a later night finds a different one, that's
   a data note, and the stored product stays as long as it is still listed and its hash still
   agrees. Only when the stored product is gone or disagrees can a new product be matched. Then
   the price is set outright from the new product, and the label stays.
6. **Prices.** A product with exactly one price row takes its `marketPrice`. More than one row is
   unpriced plus a note. Price moves go through `movedEnough`, as Pokémon's do.
7. **Sticky, never delete.** An entry Bandai stops listing keeps its rows, with
   `missing_from_api = 1` and its last price, as Pokémon does. So the op stage sends no deletes.
8. **Deferred to follow-ups, with counts logged each night:**
   - **DON!!.** Bandai has no DON!! entries, so they would need a TCGplayer-art image path and a
     permanent id scheme of their own (sketch: `onePieceCardId('en', 'DON-<productId>')`).
     Skipped products: rarity `DON!!`, or a name starting `DON!! Card`.
   - **TCGplayer-only products** (the `RE`, `PRE` and `ANN` groups, event stamps). They have no
     Bandai art, and `onepiece_images.bandai_id` is NOT NULL. They are never priced onto a card.
   - **punk-records cross-check.** The parse guards below catch a misread page instead.
   - **Binder rule fields** beyond name, set and rarity.
   - **Set logos and pack art.**
9. **Block icon `X` is stored as NULL** (`block_icon INTEGER`). The details panel shows nothing,
   and the Block facet lists numbers only.
10. **Schedule and politeness.**
    - The series list is read nightly.
    - The Promotion and Other Product pages, and any **recent** series, are read nightly. Every
      other series page is read when its copy is 7 days old. A series is recent when its mapped
      group's `publishedOn` is within 60 days. An unmapped series falls back to its cache
      `first_seen_at`. So a fresh cache doesn't make all 63 series "new" for 60 days.
    - Page requests run one at a time, 1 s apart. Images run 2 at a time.
    - Each night downloads at most `ART_BUDGET = 3000` images, Bandai and TCGplayer together, so
      the first fill takes about 3 nights. New art is fetched **newest series first** (by mapped
      group `publishedOn`, descending; unmapped pages last, then by series id). Each series' new
      Bandai entries are followed by its candidate TCGplayer images, before the next series.
      Re-checks come last.
    - Each known Bandai image is re-checked with `If-Modified-Since` every 14 days, oldest first,
      within the budget.
    - The User-Agent is `DuelBinder/<version> (https://github.com/darkharasho/duel-binder)`.
11. **Art storage.**
    - The job PUTs the Bandai PNG to R2 `card/full/<imageId>` and a 268-wide JPEG to
      `card/small/<imageId>`. The JPEG's transparent corners are filled with the row's first opaque
      pixel.
    - `/img/small` and `/img/cropped` read the small copy, `/img/full` the PNG.
    - On an R2 miss the portal fetches Bandai's PNG and stores it under `card/full/<imageId>` only.
      A `small` or `cropped` miss serves that PNG with `FALLBACK_CACHE` (an hour), never under
      `card/small`, so the job's next small-copy upload replaces it soon after.
    - The job never uploads art for a frozen entry. A retried upload re-downloads the PNG and
      uploads it only if it still hashes within `SAME_ART_MAX` of the stored hash. Otherwise it is
      treated as changed art (Task 4).
12. **Sets.**
    - `set_name` is `<TITLE> [<CODE>]`, as in step 1's fixture `ROMANCE DAWN [OP-01]`. The two
      special pages are `Promotion Cards` and `Other Product Cards`.
    - `sets.set_code` drops the hyphen from `LETTERS-DIGITS` (`OP17`, `ST31`, `EB01`, `PRB01`) and
      keeps it otherwise (`OP15-EB04`). The special pages are `P` and `OPC`.
    - `tcg_date` is the matched group's `publishedOn` date.
    - Set type: `ST*` is a deck, `P` a promo, `OPC` a collection, everything else a booster.
13. **The card row** comes from the number's base entry, or else its lowest entry id:
    - `type` is the title-cased card type (`Leader`)
    - `frame_type` is `'op'`
    - `desc` is the effect, then the trigger on a new line, so it shows as the rules paragraph
    - the `effect` and `trigger` keys leave `ONE_PIECE.details`, so they aren't shown twice.
      `onepiece_cards.effect` and `trigger` are still written (the feed carries them, and they
      are kept for later use).
    - `cards.tcgplayer_price` stays NULL, as for Pokémon
14. **Problems vs notes.**
    - **Job problems (a red run):** the step failed; an id collision; a known entry's art changed
      (first night only); a set with ≥ 20 printings lost ≥ 20 points of priced share since last
      night; a series page whose cache held entries parsed to 0 entries, or (with ≥ 20 cached)
      under 98% of its last count. In the last case the old entries are kept.
    - **Notes (logged nightly):** everything else, including a series that has never had entries
      parsing to 0 (Bandai lists a new series before its cards).

## Global Constraints

- Vitest runs with at most 2 workers. `npm test` already passes `--maxWorkers=2`.
- Nothing heavy in tests: no synthetic data of 100k rows or more in vitest or Miniflare.
  Fixtures are trimmed snippets, a few KB each. Hash tests inject hashes or build tiny images in
  memory.
- DO SQLite rejects compound SELECTs of about 10 terms. Use one query per table in the Worker.
- Hot portal queries use `+game = ?` (`tests/portal/game-index-plans.test.ts`).
- Deploy the portal before any client release, and before the first job run that uploads op art.
  The `catalog.yml` op stage reaches `main` only after that deploy (Task 12 Step 3 comes before
  the merge), because the scheduled run (`17 6 * * *` UTC) would otherwise run it first.
- `sets.set_code` isn't unique across games: Yu-Gi-Oh already has `OP01` and `OP17` (OTS
  Tournament Packs). Every op query over `sets` or keyed by set code names `game = 'op'`.
- Migrations are append-only. This plan adds none.
- **Yu-Gi-Oh and Pokémon don't change:** their rows, ids, keys, wire formats, prices and
  fingerprint files stay byte-identical. The op stage reads and writes only `game = 'op'` rows
  and the `onepiece_*` tables.
- **One Piece stays gated** to the owner and testers on every data route (step 1). Art at `/img`
  is public.
- **The `catalog.yml` work-database cache path list stays exactly as it is.**
  `onepiece-src.sqlite` gets its own cache step.
- Anti-goal: **no wrong price.** A version never shows another version's price. When in doubt,
  leave it unpriced.

## Review Focus

- **A new parallel that Bandai lists before TCGplayer has it, or while TCGplayer's image is a
  placeholder.** It stays unpriced and never takes the base card's price. Its label waits 7
  days for a match. Pinned in Task 5 (`unmatched parallel stays unpriced`) and Task 6
  (`held parallel is written after 7 days as Parallel`).
- **Same-art versions** (a plain "Parallel" foil, the six `EB01-043` promos). The hashes can't
  separate them, so they stay unpriced rather than guessed. Pinned in Task 5
  (`two same-art candidates are ambiguous`).
- **Bandai re-points a known `_pN` to other art.** The printing freezes, with no price or art
  change. One job problem, then nightly notes. Pinned in Task 4 (`changed art is frozen`) and
  Task 6 (`frozen entry keeps its row`).
- **Bandai changes its HTML, or a page comes back short.** Last night's entries stay, nothing is
  flagged missing, and the run goes red. Pinned in Task 3 (`short parse keeps the cached entries`).
- **Adding an Alternate Art from Add Card, the set checklist's +1, or the card panel.** The entry
  gets the Alternate Art image, and its value is the Alternate Art's price. Pinned in Task 11.
- **The Yu-Gi-Oh fingerprint stage with op rows in the work database.** `references.ts` reads only
  `game = 'ygo'` printings, so an op `SR (Alternate Art)` never becomes a Yugipedia gallery
  lookup, and the references output is unchanged. Pinned in Task 7
  (`op printings get no Yugipedia lookup`).
- **An SP reprint listed on two series pages.** It belongs to the set its Card Set(s) text names.
  Pinned in Task 3 (`a duplicate id keeps the series its card sets name`) and Task 6
  (`SP on a later set`).

---

### Task 1: Parse Bandai's series list and card pages

**Files:**
- Create: `scripts/catalog/onepiece/types.ts`, `scripts/catalog/onepiece/bandai.ts`
- Create fixtures (trimmed from the live pages, a few KB each):
  - `tests/fixtures/onepiece/bandai-op17.html`: a `<select>` with three `<option>`s
    (569117 OP-17 `selected`, 569115 OP15-EB04 with its two `<br>`s, 569901 Promotion card), then
    the `<dl class="modalCol">` blocks for OP17-001 (Leader, Life 5), OP17-005, OP17-005_p1,
    OP17-005_p2 (block `X`), OP17-019 (an Event with a trigger and `&#039;`), and EB04-061_p2
    (SP CARD).
  - `tests/fixtures/onepiece/bandai-promo.html`: EB01-043_p1 and EB01-043_p2.
  - `tests/fixtures/onepiece/bandai-op15eb04.html`: the live OP15-EB04 page cut to its EB04-061
    block, plus the `EB04-061_p2` block copied from `bandai-op17.html` (so the SP is listed on two
    pages, for Task 3's duplicate test; its getInfo still names OP-17).
  - The blocks are copied verbatim, with the whitespace kept.
- Test: `tests/main/onepiece-bandai.test.ts`

**Interfaces:**
- Produces (in `types.ts`):

  ```ts
  type OpSeriesKind = 'booster' | 'deck' | 'promo' | 'other'
  interface BandaiSeries { id: string; kind: OpSeriesKind; title: string; code: string; setName: string; setCode: string }
  interface BandaiEntry {
    bandaiId: string; number: string; rarity: string; cardType: string; name: string
    cost: number | null; life: number | null; power: number | null; counter: number | null
    colors: string[]; attribute: string[]; traits: string[]; block: number | null
    effect: string | null; trigger: string | null; cardSets: string; seriesId: string
  }
  ```

- Produces (in `bandai.ts`):
  - `BANDAI_EN = 'https://en.onepiece-cardgame.com'`
  - `BANDAI_ID_RE = /^[A-Z]+[0-9]*-[0-9]{3}(_[a-z][0-9]{1,2})?$/`
  - `parseSeriesList(html: string): { series: BandaiSeries[]; notes: string[] }`
  - `parseCardList(html: string, seriesId: string): { entries: BandaiEntry[]; skipped: string[] }`.
    `skipped` lists ids failing `BANDAI_ID_RE` or with no name.
- The parsing rules:
  - Decode entities: named ones plus `&#NNN;` and `&#xHH;`.
  - `<br>` in an effect or trigger becomes `\n`. All other tags are stripped and whitespace is
    collapsed.
  - `-`, empty or non-numeric values become `null` or `[]`.
  - `colors`, `attribute` and `traits` split on `/`.
  - The rarity `SP CARD` becomes `SP`.
  - The card type is title-cased (`LEADER` → `Leader`).
  - A cost `<h3>Life</h3>` fills `life` and leaves `cost` null.
  - The series option text, with `<br>`s dropped, matches `^(.*?)\s*-(.+)-\s*\[([^\]]+)\]$`.
    `title` is group 2 trimmed, `code` is group 3, `setName` is `<title> [<code>]`, and `setCode`
    follows Builder's call 12. `kind` is `booster` when the head has BOOSTER, `deck` when it has
    DECK. A head with neither is a `booster` and gets the note
    `<id>: unknown series kind "<head>", read as a booster`.
  - The two special pages are matched by option value, not by text:
    - `569901` is `{kind:'promo', title:'Promotion Cards', code:'P', setName:'Promotion Cards', setCode:'P'}`
    - `569801` is `{kind:'other', title:'Other Product Cards', code:'OPC', setName:'Other Product Cards', setCode:'OPC'}`
  - Any other option whose text fails the pattern is left out, with the note
    `<id>: unreadable series "<text>", skipped`.
- The parser is regex-based, with no DOM library, because the job bundle runs under Electron.

- [ ] **Step 1: Write the failing tests.**

```ts
test('series list', () => {
  const { series: s, notes } = parseSeriesList(read('bandai-op17.html'))
  expect(notes).toEqual([])
  expect(s).toEqual([
    { id: '569117', kind: 'booster', title: 'THE WORLD’S STRONGEST WARRIORS', code: 'OP-17', setName: 'THE WORLD’S STRONGEST WARRIORS [OP-17]', setCode: 'OP17' },
    { id: '569115', kind: 'booster', title: 'ADVENTURE ON KAMI’S ISLAND', code: 'OP15-EB04', setName: 'ADVENTURE ON KAMI’S ISLAND [OP15-EB04]', setCode: 'OP15-EB04' },
    { id: '569901', kind: 'promo', title: 'Promotion Cards', code: 'P', setName: 'Promotion Cards', setCode: 'P' }
  ])
})
test('a Leader, an Event with a trigger, a parallel and an SP', () => {
  const { entries, skipped } = parseCardList(read('bandai-op17.html'), '569117')
  const by = Object.fromEntries(entries.map((e) => [e.bandaiId, e]))
  expect(skipped).toEqual([])
  expect(by['OP17-001']).toMatchObject({ number: 'OP17-001', rarity: 'L', cardType: 'Leader', name: 'Edward.Newgate',
    life: 5, cost: null, power: 5000, counter: null, colors: ['Red'], attribute: ['Special'],
    traits: ['The Four Emperors', 'Whitebeard Pirates'], block: 5, trigger: null })
  expect(by['OP17-019'].name).toBe("I Don't Have Time to Chat with Snot-Nosed Brats")
  expect(by['OP17-019']).toMatchObject({ cardType: 'Event', cost: 1, attribute: [], trigger: '[Trigger] Your Leader gains +1000 power during this turn.' })
  expect(by['OP17-005_p2']).toMatchObject({ number: 'OP17-005', rarity: 'SR', block: null })
  expect(by['EB04-061_p2']).toMatchObject({ number: 'EB04-061', rarity: 'SP', cardSets: 'BOOSTER PACK -THE WORLD’S STRONGEST WARRIORS- [OP-17]' })
})
test('promo entries name their product', () => {
  const { entries } = parseCardList(read('bandai-promo.html'), '569901')
  expect(entries.map((e) => e.cardSets)).toEqual([
    'Offline Regional Participation Pack 2025 Vol.1',
    'Offline Regional Finalist Card Set 25-26 Season 1'
  ])
})
test('an id that is not a Bandai id is skipped', () => {
  const html = read('bandai-op17.html').replace('id="OP17-019"', 'id="../x"')
  expect(parseCardList(html, '569117').skipped).toEqual(['../x'])
})
test('a series of an unknown kind is a booster, with a note', () => {
  const html = read('bandai-op17.html').replace('BOOSTER PACK &lt;br', 'MYSTERY PACK &lt;br')
  const { series, notes } = parseSeriesList(html)
  expect(series[0]).toMatchObject({ id: '569117', kind: 'booster', setCode: 'OP17' })
  expect(notes).toEqual(['569117: unknown series kind "MYSTERY PACK", read as a booster'])
})
```

- [ ] **Step 2: Run them and check they fail.** Run `npm test -- tests/main/onepiece-bandai.test.ts`.
  They should FAIL because the module doesn't exist yet.
- [ ] **Step 3: Implement** `types.ts` and `bandai.ts` by the rules above.
- [ ] **Step 4: Run them and check they pass.** Run the same command. They should PASS.
- [ ] **Step 5: Commit.** `feat(catalog): parse Bandai's One Piece card list`

### Task 2: TCGCSV category 68, product versions and series↔group mapping

**Files:**
- Create: `scripts/catalog/onepiece/tcgcsv.ts`, `scripts/catalog/onepiece/versions.ts`
- Create fixtures, trimmed:
  - `tests/fixtures/onepiece/tcgcsv-groups.json`: the 87-group envelope cut to 24736, 24775,
    24637, 24749, 17675 and 23304
  - `tests/fixtures/onepiece/tcgcsv-op17-products.json`: 711499, 708077, 712083, 707133, 707135,
    712090, 712091, 710857 (EB04-061 SP), 704752 (Booster Box, no extendedData) and one
    `DON!! Card (Alternate Art) (Gold)`
  - `tests/fixtures/onepiece/tcgcsv-op17-prices.json`: their price rows
- Test: `tests/main/onepiece-versions.test.ts`

**Interfaces:**
- Consumes: `getJson`, `createLimiter`, `GetJsonOpts` from `scripts/catalog/pokemon/http.ts`.
  They are imported as they are. No Pokémon file changes.
- Produces:
  - `opGroups(o: GetJsonOpts): Promise<TcGroup[]>`, `opProducts(groupId, o): Promise<OpProduct[]>`
    and `opPrices(groupId, o): Promise<TcPrice[]>`, against
    `https://tcgcsv.com/tcgplayer/68`. They reuse the Pokémon `TcGroup` and `TcPrice` types, and
    reject an unsuccessful envelope as `pokemon/tcgcsv.ts` does.
  - `interface OpProduct { productId: number; groupId: number; name: string; number: string | null; rarity: string | null; imageUrl: string | null }`.
    `imageUrl` is null when `imageCount === 0`.
  - `type OpKind = 'base' | 'sp' | 'tr' | 'parallel'`
  - `productVersion(p: OpProduct): { kind: OpKind; label: string | null; skip: 'don' | 'sealed' | null }`:
    - Trailing `(…)` groups are read right to left.
    - A group that is three digits, or equal to `p.number`, is a number tag and is dropped.
    - The remaining groups, joined with `' '`, are the label: `Alternate Art`,
      `Super Alternate Art`, `Manga`, `Gold`.
    - `SP` gives kind `sp` and `TR` gives `tr`. No label gives `base`. Anything else is
      `parallel`.
    - A trailing `[…]` (`[Participant]`) is appended to the label as it is.
    - Rarity `DON!!`, or a name starting `DON!! Card`, is `skip: 'don'`. Otherwise no `number`
      is `skip: 'sealed'`. A DON!! product has no number either, and `don` wins.
  - `entryKind(e: BandaiEntry, seriesKind: OpSeriesKind): OpKind | 'promo'`:
    - an entry of a `promo` or `other` series is `promo`
    - else rarity `SP` is `sp`, rarity `TR` is `tr`, an id with no `_` is `base`, and the rest
      are `parallel`
  - `normalizeCode(code: string): string`: upper case with every `-` removed.
  - `mapGroups(series: BandaiSeries[], groups: TcGroup[]): { bySeries: Map<string, TcGroup>; promoPool: TcGroup[]; stampGroups: TcGroup[] }`:
    - A group whose abbreviation contains a space (`OP17 RE`, `OP13 ANN`, `ST-01 PRE`) is a stamp
      group.
    - Otherwise `normalizeCode(abbreviation)` is compared with `normalizeCode(series.setCode)`.
    - An unmapped, unstamped group (OP-PR, OP-CS, LT-01, SD01, OP-DD, OP-RP) joins the promo pool,
      which serves the `promo` and `other` series.
  - `promoKey(s: string): string`: lower case, alphanumerics only, with a leading
    `included in` removed.

- [ ] **Step 1: Write the failing tests.**

```ts
test('versions from TCGplayer names', () => {
  const v = (name: string, number = 'OP17-005', rarity = 'SR') => productVersion({ productId: 1, groupId: 1, name, number, rarity, imageUrl: null })
  expect(v('Edward.Newgate (005)')).toEqual({ kind: 'base', label: null, skip: null })
  expect(v('Edward.Newgate (005) (Alternate Art)')).toEqual({ kind: 'parallel', label: 'Alternate Art', skip: null })
  expect(v('Kaido (062) (Super Alternate Art)', 'OP17-062')).toEqual({ kind: 'parallel', label: 'Super Alternate Art', skip: null })
  expect(v('Monkey.D.Luffy (EB04-061) (SP)', 'EB04-061', 'SEC').kind).toBe('sp')
  expect(v('Buggy (P-084) (SP)', 'P-084', 'PR').kind).toBe('sp')
  expect(v('DON!! Card (Alternate Art) (Gold)', null, 'DON!!').skip).toBe('don')
  expect(v("The World's Strongest Warriors Booster Box", null, null).skip).toBe('sealed')
  expect(v('Monkey.D.Luffy (Super Pre-Release) [Participant]', 'P-001', 'PR').label).toBe('Super Pre-Release [Participant]')
})
test('entry kinds', () => {
  expect(entryKind(entry({ bandaiId: 'OP17-005' }), 'booster')).toBe('base')
  expect(entryKind(entry({ bandaiId: 'OP17-005_p1', rarity: 'SR' }), 'booster')).toBe('parallel')
  expect(entryKind(entry({ bandaiId: 'EB04-061_p2', rarity: 'SP' }), 'booster')).toBe('sp')
  expect(entryKind(entry({ bandaiId: 'EB01-043_p1', seriesId: '569901' }), 'promo')).toBe('promo')
})
test('series map to groups; stamps and promos apart', () => {
  const m = mapGroups(SERIES /* OP-17, OP15-EB04, ST-31, Promotion */, groupsFixture)
  expect(m.bySeries.get('569117')?.groupId).toBe(24736)
  expect(m.bySeries.get('569115')?.groupId).toBe(24637)
  expect(m.stampGroups.map((g) => g.groupId)).toEqual([24775])
  expect(m.promoPool.map((g) => g.groupId).sort()).toEqual([17675, 23304])
})
test('promo keys', () => expect(promoKey('Included in Event Pack Vol.2')).toBe(promoKey('Event Pack Vol. 2')))
test('fixture products and prices parse', async () => {
  const urls: string[] = []
  const o = opts(fakeFetch(urls, {
    '/68/24736/products': 'tcgcsv-op17-products.json', '/68/24736/prices': 'tcgcsv-op17-prices.json' }))
  const products = await opProducts(24736, o)
  expect(products).toHaveLength(10)
  expect(products.find((p) => p.productId === 704752)).toMatchObject({ number: null, rarity: null, imageUrl: null })
  expect(products.find((p) => p.productId === 708077)).toMatchObject({
    groupId: 24736, name: 'Edward.Newgate (005) (Alternate Art)', number: 'OP17-005', rarity: 'SR' })
  expect(products.find((p) => p.productId === 708077)?.imageUrl).toMatch(/^https:\/\//)
  const prices = await opPrices(24736, o)
  expect(prices).toHaveLength(readJson('tcgcsv-op17-prices.json').results.length)
  expect(urls).toEqual(['https://tcgcsv.com/tcgplayer/68/24736/products', 'https://tcgcsv.com/tcgplayer/68/24736/prices'])
})
test('an unsuccessful envelope rejects', async () => {
  const o = opts(fakeFetch([], { '/68/groups': { success: false, errors: ['down'], results: [] } }))
  await expect(opGroups(o)).rejects.toThrow()
})
```

  `entry()` is a small builder in the test file. `fakeFetch(urls, routes)` records each URL and
  answers a route ending with the fixture file named (or the inline object) as JSON, else 404.
  `opts(f)` is `{ fetch: f, userAgent: 'test', limiter: createLimiter(1), retryDelayMs: 0 }`.
  The `SR` rarity of 708077 is what the trimmed fixture holds; if the live row differs, assert the
  fixture's value.

- [ ] **Step 2: Run them and check they fail.** Run `npm test -- tests/main/onepiece-versions.test.ts`.
  They should FAIL.
- [ ] **Step 3: Implement** `tcgcsv.ts` and `versions.ts`.
- [ ] **Step 4: Run them and check they pass.** Run the same command. They should PASS.
- [ ] **Step 5: Commit.** `feat(catalog): One Piece TCGplayer versions and set mapping`

### Task 3: The source cache, the fetch schedule and the parse guard

**Files:**
- Create: `scripts/catalog/onepiece/cache.ts`, `scripts/catalog/onepiece/sources.ts`
- Test: `tests/main/onepiece-sources.test.ts`

**Interfaces:**
- Consumes: `parseSeriesList` and `parseCardList` (Task 1), `opGroups`, `opProducts` and
  `opPrices` (Task 2).
- Produces:
  - **`openOpCache(path: string): OpCache`** (WAL), with these tables:

    ```sql
    CREATE TABLE IF NOT EXISTS series (id TEXT PRIMARY KEY, json TEXT NOT NULL, first_seen_at INTEGER NOT NULL, fetched_at INTEGER);
    CREATE TABLE IF NOT EXISTS entries (series_id TEXT NOT NULL, bandai_id TEXT NOT NULL, json TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL, PRIMARY KEY (series_id, bandai_id));
    CREATE TABLE IF NOT EXISTS bandai_art (bandai_id TEXT PRIMARY KEY, hash TEXT NOT NULL, last_modified TEXT,
      checked_at INTEGER NOT NULL, stored_at INTEGER, changed_hash TEXT, noted_at INTEGER);
    CREATE TABLE IF NOT EXISTS tcg_art (product_id INTEGER PRIMARY KEY, image_url TEXT NOT NULL, hash TEXT NOT NULL, fetched_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS set_stats (set_code TEXT PRIMARY KEY, printings INTEGER NOT NULL, priced INTEGER NOT NULL);
    ```

    Hashes are stored as 64 hex characters, from the 8 words of an `artHash`.
    `OpCache` exposes typed get/put methods for each table, plus `close()`.
  - **`interface OnePieceSources`:**

    ```ts
    series(): Promise<{ series: BandaiSeries[]; notes: string[] }>
    /**
     * Tonight's entries of every series, not deduped: fresh pages per the schedule, cached ones
     * otherwise. `published` maps a series id to its mapped group's `publishedOn` (ms).
     */
    entries(series: BandaiSeries[], published: Map<string, number>): Promise<{ entries: BandaiEntry[]; problems: string[]; notes: string[] }>
    groups(): Promise<TcGroup[]>
    products(groupId: number): Promise<OpProduct[]>
    prices(groupId: number): Promise<TcPrice[]>
    /** Raw bytes; `since` makes it conditional (null on 304). */
    bandaiImage(bandaiId: string, since?: string): Promise<{ bytes: Uint8Array; lastModified: string | null } | null>
    tcgImage(url: string): Promise<Uint8Array>
    ```

  - **`createOnePieceSources(o: { cache: OpCache; fetch?: typeof fetch; version: string; log; now?: () => number }): OnePieceSources`**
  - **`seriesDue(s: { fetched_at: number | null; first_seen_at: number }, kind: OpSeriesKind, publishedOn: number | null, now: number): boolean`**
    is true when:
    - the series has never been fetched, or
    - it is `promo` or `other`, or
    - it is recent: `now - publishedOn < 60 days`, or, when `publishedOn` is null (an unmapped
      series), `now - first_seen_at < 60 days`, or
    - `now - fetched_at >= 7 days`
  - **Requests.**
    - Pages run one at a time with `PAGE_GAP_MS = 1000` between them, under the
      User-Agent in Builder's call 10.
    - The series list comes from `GET /cardlist/` (follow the redirect).
    - A page is `GET /cardlist/?series=<id>`.
  - **Parse guard.** If a fetched page whose cache held entries parses to 0 entries, or to fewer
    than 98% of its cached count (when the cache held ≥ 20), its cached entries are kept. A
    problem is returned: `Bandai <setCode> parsed to <n> entries (was <m>); kept the last copy`.
    A page that parses to 0 when the cache never held entries for it is a note,
    `Bandai <setCode> lists no cards yet`, not a problem.
  - **`dedupeEntries(series: BandaiSeries[], entries: BandaiEntry[], published: Map<string, number>): { entries: BandaiEntry[]; notes: string[] }`**
    (pure, in `sources.ts`; Task 7 calls it after `entries()`). An entry id listed on two or more
    series pages is kept once, under the page Builder's call 1 picks:
    - the listing page that `cardSets` names (it contains `[<series.code>]` or the series'
      `title`)
    - else, when it names several listing pages or none, the earliest of them (or of all the
      listing pages): `published` ascending, an unmapped page last, then series id
    - the note is `<id> is listed in <a> and <b>; kept in <kept>`, with `<a>`, `<b>` the set
      codes in series-id order
  - **Cache `first_seen_at`.** A series row's `first_seen_at` is set on its first insert and never
    changes. An entry row's `first_seen_at` is set when that (series, id) is first stored. Task 7
    takes each Bandai id's first-seen time as the MIN over its rows.

- [ ] **Step 1: Write the failing tests.** Each uses a fake `fetch` over the Task 1 fixtures
  (`?series=569117` → `bandai-op17.html`, `?series=569115` → `bandai-op15eb04.html`,
  `?series=569901` → `bandai-promo.html`, `/cardlist/` → `bandai-op17.html`) and a temp cache
  file, and covers one behaviour. `published` is
  `{ 569117 → 2026-08-28, 569115 → 2026-05-01 }` (569901 unmapped).
  - `the schedule fetches new, recent and stale pages only`:
    - The cache is pre-seeded with series 569115 (`first_seen_at` 2026-05-01,
      `fetched_at` 2026-09-12) and its two entries.
    - Night 1, clock 2026-09-15: the page requests are exactly `?series=569117` and
      `?series=569901`. 569115 isn't requested (published 137 days ago, fetched 3 days ago), and
      `entries()` still returns its two cached entries.
    - Night 2, 2026-09-16: `569117` (published 19 days ago, so recent) and `569901` again.
    - Night 3, 2026-09-20: all three, because 569115's copy is now 8 days old.
  - `seriesDue falls back to first seen for an unmapped series`: with `fetched_at` one day ago,
    `seriesDue(s, 'booster', null, now)` is true when `first_seen_at` is 10 days ago and false
    when it is 90 days ago. With `publishedOn` 90 days ago and `first_seen_at` 1 day ago it is
    false (the group date wins).
  - `pages are one at a time`: the fake fetch records start and end times, and none overlap.
  - `short parse keeps the cached entries`: night 2 serves the OP-17 page with all blocks
    removed. `entries()` still returns night 1's six OP-17 entries, and `problems` is
    `['Bandai OP17 parsed to 0 entries (was 6); kept the last copy']`.
  - `a series with no cards yet is a note`: on a fresh cache, the Promotion page served with all
    blocks removed gives `problems` `[]` and the note `Bandai P lists no cards yet`.
  - `a duplicate id keeps the series its card sets name`: `dedupeEntries` over night 1's entries
    of all three pages keeps one `EB04-061_p2`, with `seriesId '569117'` (its getInfo names
    `[OP-17]`), although OP15-EB04 is the earlier series. The note is
    `EB04-061_p2 is listed in OP15-EB04 and OP17; kept in OP17`. With the getInfo text replaced
    by `UNKNOWN`, it is kept in `569115` (published earlier).
  - `conditional image fetch`: `bandaiImage('OP17-005', 'Fri, 21 Aug 2026 00:56:18 GMT')`
    sends `If-Modified-Since` and returns null on a 304.
- [ ] **Step 2: Run them and check they fail.** Run `npm test -- tests/main/onepiece-sources.test.ts`.
  They should FAIL.
- [ ] **Step 3: Implement** `cache.ts` and `sources.ts`.
- [ ] **Step 4: Run them and check they pass.** Run the same command. They should PASS.
- [ ] **Step 5: Commit.** `feat(catalog): One Piece source cache and fetch schedule`

### Task 4: Art: hash, small copy, R2 upload and the `_pN` guard

**Files:**
- Create: `scripts/catalog/onepiece/art.ts`
- Modify:
  - `scripts/catalog/thumbs.ts`: export `smallJpeg`, and make `thumbnail` call it (same bytes out)
  - `scripts/catalog/upload.ts`: export `withRetry`, and make `uploadCatalog`'s `post` use it
    (same waits, same warnings)
- Test: `tests/main/onepiece-art.test.ts`. The existing `tests/main/catalog-thumbs.test.ts` and
  `tests/main/catalog-job.test.ts` (which covers `uploadCatalog`) pass unchanged.

**Interfaces:**
- Consumes:
  - `decodeImage` (`scripts/catalog/references.ts`)
  - `artHash` and `hamming` (`src/shared/scan/fingerprint.ts`)
  - `hashHex` (`src/shared/scan/fingerprintRefs.ts:83`, the same little-endian hex the
    fingerprint files use), imported, not redefined
  - `THUMB_WIDTH = 268` and the new `smallJpeg` (`scripts/catalog/thumbs.ts`)
  - the new `withRetry` (`scripts/catalog/upload.ts`)
  - `OpCache` and `OnePieceSources` (Task 3)
- Produces:
  - In `thumbs.ts`: `smallJpeg(img: RgbaImage): Uint8Array | null`, which is `shrink` to
    `THUMB_WIDTH`, then a JPEG at `QUALITY` (80), and null when over `MAX_THUMB_BYTES` (200 KiB).
    `thumbnail` keeps its own checks and calls it for the shrink-and-encode.
  - In `upload.ts`: `withRetry<T>(label: string, fn: () => Promise<T>): Promise<T>`, which wraps
    the existing `RETRY_DELAYS_MS` loop and `retryable` test. `HttpError` is exported with it so
    that `uploadArt` throws the same kind of error.
  - `MATCH_MAX = 24`, `MATCH_MARGIN = 40`, `SAME_ART_MAX = 24`, `ART_BUDGET = 3000`,
    `RECHECK_MS = 14 * DAY_MS`
  - `hexHash(s: string): Uint32Array` (the inverse of `hashHex`) and
    `distance(a: string, b: string): number` (`hamming` of the two)
  - `smallCopy(png: Uint8Array): Uint8Array | null`: decodes the PNG, fills each fully or partly
    transparent pixel with the first opaque pixel of its row, then returns `smallJpeg` of that.
    null (undecodable, or over 200 KiB) counts as a failed upload.
  - `uploadArt(o: { url: string; token: string; fetch?: typeof fetch }, size: 'full' | 'small', imageId: number, bytes: Uint8Array): Promise<void>`.
    It sends `PUT ${url}/api/admin/op-art/${size}/${imageId}` with the bearer token and
    `content-type` `image/png` or `image/jpeg`, through `withRetry`.
  - `interface ArtBatch { seriesId: string; entries: BandaiEntry[]; candidates: OpProduct[] }`:
    one series' entries and the products its numbers may match (the mapped group's, or the promo
    pool's for a `promo`/`other` series).
  - `refreshArt(o: { cache: OpCache; sources: OnePieceSources; batches: ArtBatch[]; stored: Map<string, number>; portal?: { url: string; token: string; fetch?: typeof fetch }; now: number; log; budget?: number }): Promise<ArtResult>`,
    where
    `ArtResult = { fetched: number; failed: number; uploaded: number; changed: string[]; firstNoticed: string[] }`.
    `batches` come in the hashing order of Builder's call 10 (newest series first; Task 7 sorts
    them). `stored` is bandaiId → product id already on its printing (Task 7). `budget` defaults
    to `ART_BUDGET`. In order:
    1. **New art, batch by batch.** For each batch:
       - **Bandai.** Each entry with no `bandai_art` row is downloaded, hashed with
         `artHash(decodeImage(bytes))` (the whole card), and stored with `checked_at = now`.
       - **TCGplayer.** The candidate products of every number in the batch that has an entry
         **with no stored product** are downloaded and hashed, plus each stored product that has
         no `tcg_art` row. Only a product with an `imageUrl` and no `tcg_art` row for that URL is
         downloaded. A changed `imageUrl` replaces the row. Matching (Task 5) then runs on
         whatever hashes exist, and the rest wait for the next night.
    2. **Uploads.** Each non-frozen entry with `stored_at IS NULL`, when `portal` is given, PUTs
       `full` (the PNG) and `small` (`smallCopy`), then sets `stored_at`. A PNG downloaded in step 1
       tonight is uploaded as it is. One left from an earlier night is downloaded again (counted
       in the budget) and uploaded only if it hashes within `SAME_ART_MAX` of the stored hash.
       Beyond that it is handled as changed art, as in step 3. With no portal (a dry run),
       nothing is uploaded and `stored_at` stays null.
    3. **Re-checks.** Entries with `checked_at` older than `RECHECK_MS`, oldest first, frozen ones
       included, are fetched conditionally. Every outcome sets `checked_at = now`, so a frozen
       entry is re-checked every 14 days, not every night:
       - 304: only `checked_at` changes
       - 200 within `SAME_ART_MAX`: `hash` and `last_modified` update
       - 200 beyond it: `changed_hash` is set, and the hash is **not** replaced; on the first
         time, `noted_at` is set and the id goes in `firstNoticed`
    4. All downloads share `budget`, spent in the order above, and whatever is left over waits for
       the next night. A failed download is counted, logged and tried again the next night.
  - `isFrozen(cache, bandaiId): boolean` is true when `changed_hash IS NOT NULL`. A human clears a
    freeze by deleting that `bandai_art` row, which leads to a fresh hash and re-upload. Say so in
    a doc comment.

- [ ] **Step 1: Write the failing tests.** Images are tiny PNGs built in memory with `pngjs`:
  60×84, with transparent corners, in two different patterns.
  - `hashes and stores new art, uploads both sizes`: the PUTs, recorded by a fake fetch, are
    `full` with `content-type: image/png` and `small` with `image/jpeg`. The small copy decodes
    as 60 wide (no wider than the source) with an opaque (0,0) pixel. `stored_at` is set.
  - `dry run hashes but uploads nothing`
  - `changed art is frozen`:
    - Night 1 hashes pattern A.
    - Night 15 (a re-check) serves pattern B. Then `changed` and `firstNoticed` are
      `['OP17-005_p1']`, the stored `hash` is still A's, and `isFrozen` is true.
    - Night 30 serves B again, and `firstNoticed` is `[]`.
  - `re-encoded same art is not a change`: the same pattern served with a different
    `Last-Modified` stays unfrozen.
  - `budget carries over`: with `budget: 2` and 3 new entries, one is left for night 2.
  - `newest series first`: two batches, `[OP-17 (2 entries, 1 candidate), ST-31 (2 entries)]`,
    with `budget: 3`. Both OP-17 entries and its candidate are fetched, and no ST-31 entry is.
  - `tcg images only for numbers that need them`: `_p1` has a stored product and `_p2` doesn't,
    both of OP17-005. Every OP17-005 candidate is fetched (because of `_p2`). With both stored,
    only a stored product with no `tcg_art` row is fetched.
  - `frozen entries are re-checked fortnightly and never uploaded`: after `changed art is
    frozen`, a frozen entry with `stored_at` NULL makes no PUT, and on night 16 it is not
    downloaded again.
  - `a retried upload with changed art freezes instead`: night 1 has no portal (pattern A hashed,
    `stored_at` NULL). Night 2 has a portal and serves pattern B: no PUT, `isFrozen` is true, and
    `firstNoticed` is `['OP17-005_p1']`.
  - `distance`: equal hashes give 0, and a hash with every bit flipped gives 256. `hexHash(hashHex(h))`
    equals `h`.
- [ ] **Step 2: Run them and check they fail.** Run `npm test -- tests/main/onepiece-art.test.ts`.
  They should FAIL.
- [ ] **Step 3: Implement** `art.ts`, `smallJpeg` and `withRetry`.
- [ ] **Step 4: Run them and check they pass.** Run the same command, then
  `npm test -- tests/main/catalog-thumbs.test.ts tests/main/catalog-job.test.ts`. They should PASS
  with no test edits.
- [ ] **Step 5: Commit.** `feat(catalog): One Piece art hashes, small copies and the art-change guard`

### Task 5: Match Bandai entries to TCGplayer products

**Files:**
- Create: `scripts/catalog/onepiece/match.ts`
- Test: `tests/main/onepiece-match.test.ts`

**Interfaces:**
- Consumes: `entryKind`, `productVersion` and `promoKey` (Task 2), and `distance`, `MATCH_MAX`
  and `MATCH_MARGIN` (Task 4).
- Produces:

  ```ts
  interface OpMatch { bandaiId: string; product: OpProduct; label: string | null }
  function matchSeries(o: {
    series: BandaiSeries; entries: BandaiEntry[]; products: OpProduct[]  // the group's, or the promo pool's
    bandaiHash: (id: string) => string | null; tcgHash: (p: OpProduct) => string | null
    stored: Map<string, number>  // bandaiId → product id already on its printing
  }): { matches: Map<string, OpMatch>; notes: string[]; tcgOnly: number; don: number }
  ```

- **The algorithm**, per number (`entry.number` = `product.number`). Products with
  `skip: 'don'` are left out and counted in `don`. Products with `skip: 'sealed'` are left out and
  counted nowhere.
  1. **Stored product.** An entry whose stored product is still listed (in `products`) and within
     `MATCH_MAX` of the entry's hash keeps it: that is its match. Its product is **reserved**, so
     no other entry can take it. A stored product that is gone, or whose hash is missing or
     beyond `MATCH_MAX`, is dropped, and the entry goes through assignment like a new one, with
     the note `<id>: stored product <old> is gone or disagrees`.
  2. **Partitions.** Split the entries and the unreserved products into partitions by kind:
     - `base` with `base`, `sp` with `sp`, `tr` with `tr`, `parallel` with `parallel`
     - a promo entry with the products whose `promoKey(label)` equals
       `promoKey(entry.cardSets)`
  3. **Assignment** within a partition, for the entries step 1 didn't match:
     - An entry's candidates are the products within `MATCH_MAX` of it.
     - With two or more candidates, the best must be at least `MATCH_MARGIN` closer than the
       second.
     - No product is used twice. If two entries pick the same product, neither matches.
     - A missing hash on either side means no match.
     - Each entry left unmatched gets a note:
       `<bandaiId>: no unambiguous TCGplayer product (<reason>)`. The reason is one of
       `no candidate`, `no art yet`, `ambiguous`, `art disagrees`.
  4. **A changed match.** For each entry step 1 matched, the same rule (candidates within
     `MATCH_MAX`, `MATCH_MARGIN` between best and second) runs over every product of its
     partition, reserved ones included, with no "used twice" check. If it picks a different
     product, write the note `<id>: matches <new> now, keeps <old>`. The match stays the stored
     product.
  5. **TCGplayer-only products.** A non-skipped product of the group that nothing matched counts
     in `tcgOnly`.
- `label` is `productVersion(product).label` for parallels. For base, sp, tr and promo it is null:
  the writer labels those from Bandai.

- [ ] **Step 1: Write the failing tests.** Hashes are injected as hex strings: `H0` is all zero,
  `H1` has bits 0–119 set, `H2` has bits 120–239 set (disjoint from `H1`, so `H0`–`H1` and
  `H0`–`H2` are 120 apart and `H1`–`H2` 240), `H0near` differs from `H0` by 2 bits, and `H2far`
  differs from `H2` by 20 bits.
  - `OP17-005: base, Alternate Art and Manga match by art, not by _p order`:
    - Entries `OP17-005`, `_p1` and `_p2` have hashes H0, H1 and H2. The products are base 711499
      (H0), AA 708077 (H2) and Manga 712083 (H1).
    - `_p1` gets 712083 with label `Manga`, and `_p2` gets 708077 with label `Alternate Art`.
      That deliberately inverts the observed order.
  - `unmatched parallel stays unpriced`: `_p1` has no product of kind parallel. No match, and
    the note contains `no candidate`.
  - `two same-art candidates are ambiguous`: two parallel products both at distance 1 from
    `_p1`. No match, note `ambiguous`.
  - `art disagrees`: one base product at distance 100. No match.
  - `SP listed on a later set`: `EB04-061_p2` (sp) in OP-17 matches 710857
    `Monkey.D.Luffy (EB04-061) (SP)`.
  - `promo by product name`: `EB01-043_p1` with cardSets
    `Offline Regional Participation Pack 2025 Vol.1` matches the pool product
    `Spandine (Offline Regional Participation Pack 2025 Vol.1)`. `EB01-043_p2`
    (`… 25-26 Season 1`) has no candidate.
  - `stored product wins`: `_p1` (H2) has stored product 708077, whose image now hashes `H2far`
    (20, within `MATCH_MAX`). A second OP17-005 parallel built in the test,
    `{ productId: 900001, name: 'Edward.Newgate (005) (Special Foil)', number: 'OP17-005' }` at
    `H2` (distance 0), is closer. `_p1` still matches 708077, 900001 matches nothing, and the
    notes include `OP17-005_p1: matches 900001 now, keeps 708077`.
  - `a gone stored product frees the entry`: `_p1`'s stored product 999999 isn't in `products`.
    `_p1` matches 708077 by art, with the note `OP17-005_p1: stored product 999999 is gone or disagrees`.
  - `DON!! and sealed are skipped and counted`: over the Task 2 products fixture, `don` is 1, the
    Booster Box (704752) is counted nowhere, and neither appears in `matches`.
- [ ] **Step 2: Run them and check they fail.** Run `npm test -- tests/main/onepiece-match.test.ts`.
  They should FAIL.
- [ ] **Step 3: Implement** `match.ts`.
- [ ] **Step 4: Run them and check they pass.** Run the same command. They should PASS.
- [ ] **Step 5: Commit.** `feat(catalog): match One Piece versions to TCGplayer by kind and art`

### Task 6: Write the op rows into the work database

**Files:**
- Create: `scripts/catalog/onepiece/write.ts`
- Modify: `src/shared/games/onePiece.ts`, to drop the `effect` and `trigger` keys from
  `details` (Builder's call 13)
- Test: `tests/main/onepiece-write.test.ts`

**Interfaces:**
- Consumes:
  - `onePieceCardId` and `onePieceImageId`
  - `movedEnough` (`src/main/tcgplayer/prices.ts`)
  - `OpMatch` (Task 5), `isFrozen` (Task 4)
  - the step-1 tables and the card model (the `SCHEMA_V40` doc comment)
- Produces:

  ```ts
  interface OpPlan {
    series: BandaiSeries[]; entries: BandaiEntry[]          // deduped, every series
    groupOf: Map<string, TcGroup>                            // seriesId → group (for tcg_date)
    matches: Map<string, OpMatch>; prices: Map<number, number | null>  // productId → market price (null: none or several rows)
    hashed: Set<string>; frozen: Set<string>; firstSeen: Map<string, number>
  }
  interface OnePieceReport { series: number; cards: number; printings: number; priced: number; held: number;
    images: number; perSet: { setCode: string; printings: number; priced: number }[]; notes: string[] }
  function writeOnePiece(work: Database.Database, plan: OpPlan, o: {
    now: number; nowIso: string
    /** Test-only: replaces onePieceCardId / onePieceImageId to force a collision. */
    idOf?: { card: (number: string) => number; image: (bandaiId: string) => number }
  }): OnePieceReport
  const HOLD_UNMATCHED_MS = 7 * DAY_MS
  ```

  `plan.entries` is already deduped (`dedupeEntries`, Task 3). `firstSeen` is per Bandai id.

- **The rules**, in one transaction. Every statement names `game = 'op'` or an `onepiece_*`
  table:
  - **Only hashed entries are written,** because their art exists.
    - An entry in `frozen` changes nothing: not its row, its price, its product or its image.
      `printings` still counts it.
  - **Id collisions.** Before writing, build a map from each `onePieceCardId` and
    `onePieceImageId` to its source string, over tonight's numbers and entries plus the existing
    `onepiece_cards.number` and `onepiece_images.bandai_id` rows. Two sources on one id throw
    `One Piece id collision: <a> and <b> → <id>`.
  - **`sets`.**
    - Each set is inserted when absent: `('op', 'en', setName, setCode, tcg_date)`.
    - Once written, its name and code are frozen. Only `tcg_date` updates.
  - **`cards` and `onepiece_cards`.**
    - There is one card per number, from its base entry or else its lowest id (Builder's call 13).
    - A row is updated only when a value differs, as in `pokemon/write.ts`.
    - `cards_fts` is rebuilt once if any card changed.
  - **`card_images` and `onepiece_images`.**
    - Each entry gets `(onePieceImageId('en', id), cardId, sort_order = N of _pN or 0, missing 0, 'op')`
      and `onepiece_images (image_id, bandai_id)`.
  - **`card_printings`.** The existing printings are loaded **once**, before the loop, into a
    `Map<set_rarity_code, row>` with
    `SELECT id, set_name, set_code, set_rarity, set_rarity_code, tcg_product_id, market_price, missing_from_api FROM card_printings WHERE game = 'op' AND contributed = 0`.
    There is no index on `set_rarity_code`, so a per-entry lookup would scan the table about
    10k times. An entry's printing is the map's row for its Bandai id. Its `set_name`,
    `set_code` and `set_rarity` never change. The taken-label check reads the same map (per
    card id and set code).
    - **A new base, SP or TR entry** gets the label at once: `rarity`, `SP` or `TR`.
    - **A new promo entry** gets `<rarity> (<cardSets>)` at once.
    - **A new parallel** gets `<rarity> (<match.label>)` when matched. When unmatched, it is held
      until `now - firstSeen >= HOLD_UNMATCHED_MS`, and then written as `<rarity> (Parallel)`.
      `held` counts the entries waiting.
    - **A taken label** gets a number: inside the parentheses, `SR (Alternate Art 2)`, or as
      `SP (2)`. Entries are processed in `bandaiId` order so that the numbering is deterministic.
    - **Price.** `tcg_product_id` and `market_price` come from the match and `plan.prices`. A
      product different from the row's `tcg_product_id` (a new row, or a stored product that
      Task 5 dropped) sets both outright. The same product moves the price only when
      `movedEnough`. No match leaves both NULL on a new row and unchanged on an existing one.
    - `language = 'en'`, `set_price` NULL, `variant` NULL.
  - **Not listed tonight.** An entry Bandai no longer lists gets `missing_from_api = 1` on its
    printing and image. Nothing is deleted.
- **The report.**
  - `printings` counts op printings written or kept tonight (frozen included). Held entries have no
    printing and count only in `held`.
  - `perSet` counts printings, and priced ones (`market_price IS NOT NULL`), per `sets.set_code`,
    with
    `FROM card_printings p JOIN sets s ON s.game = 'op' AND s.language = p.language AND s.set_name = p.set_name WHERE p.game = 'op' GROUP BY s.set_code`.
    Both sides name `game = 'op'`, because Yu-Gi-Oh's `sets` has `OP01` and `OP17` too.

- [ ] **Step 1: Write the failing tests** on a migrated work database, built with `openDatabase`
  on a temp file. It is seeded with the Yu-Gi-Oh fixtures and `seedPokemon`.
  - `writes the OP17-005 versions`:
    - three `card_images` with sort_order 0, 1 and 2
    - one `cards` row: `onePieceCardId('en','OP17-005')`, type `Character`, frame_type `op`
    - printings with `set_rarity` `SR`, `SR (Manga)` and `SR (Alternate Art)`,
      `set_code 'OP17-005'`, `set_rarity_code` the Bandai ids, and prices from the plan
    - `pkey` `en|<card>|OP17-005|SR (Manga)` among them
  - `SP on a later set`: EB04-061_p2 is in set `THE WORLD’S STRONGEST WARRIORS [OP-17]` with
    `set_rarity 'SP'`, on card `onePieceCardId('en','EB04-061')`.
  - `labels never move, prices move enough`: night 1 matches `_p1` to 712083 (`Manga`) at 12.00.
    - Night 2 matches `_p1` to the **same** product 712083, with the match label `Gold` (as if
      TCGplayer renamed it) and price 12.12 (1%). `set_rarity` stays `SR (Manga)` and
      `market_price` stays 12.00.
    - Night 3: the same product at 15.60 (30%). `market_price` is 15.60, and the label is unchanged.
  - `a new product sets the price outright`: night 1 matches `_p1` to 712083 at 12.00. Night 2
    matches it to product 900001 (label `Special Foil`) at 12.12 (1%). `tcg_product_id` is 900001,
    `market_price` is 12.12, and `set_rarity` stays `SR (Manga)`.
  - `held parallel is written after 7 days as Parallel`:
    - Night 1: an unmatched `_p1` has no printing, and `held` is 1.
    - Night 8: it is written as `SR (Parallel)` with no price, and `held` is 0.
  - `second Alternate Art is numbered`: `OP17-062_p1` and `OP17-062_p2` (rarity `SR` in the test
    entries) match 707135 and a test product 900002, both labelled `Alternate Art`. Their labels
    are `SR (Alternate Art)` and `SR (Alternate Art 2)`, by Bandai id order. Two SP entries
    `P-084_p1` and `P-084_p2` of one number get `SP` and `SP (2)`.
  - `frozen entry keeps its row`: a plan with `_p1` frozen and a new price leaves its printing
    row byte-identical.
  - `unlisted entry is flagged, not deleted`: night 2's plan leaves out `OP17-005_p2`. Its
    printing and its `card_images` row have `missing_from_api = 1`, its `market_price` and
    `onepiece_images` row are unchanged, and the op row counts of every table are the same as
    after night 1. Night 3 lists it again, and both flags are 0.
  - `id collision throws`: `idOf.card` maps both `OP17-005` and `OP17-019` to one id.
    `writeOnePiece` throws `One Piece id collision: OP17-005 and OP17-019 → <id>`, and every op
    row count is what it was before.
  - `leaves every ygo and pkm row byte-identical`:
    - For every `CATALOG_TABLES` table, take a SHA-256 of `SELECT * … ORDER BY rowid`. Game
      tables use `WHERE game <> 'op'`, and the YGO-only and `pokemon_*` tables are hashed
      whole.
    - Take the hashes before and after `writeOnePiece`. They are equal.
  - `perSet counts priced share`: a Yu-Gi-Oh `sets` row `('ygo', 'en', 'OTS Tournament Pack 17', 'OP17')`
    with one ygo printing in it is added first. The plan has `OP17-005`, `_p1` and `_p2` matched to
    711499 (0.25), 712083 (12.00) and 708077 (null). `perSet` is
    `[{ setCode: 'OP17', printings: 3, priced: 2 }]`.
- [ ] **Step 2: Run them and check they fail.** Run `npm test -- tests/main/onepiece-write.test.ts`.
  They should FAIL.
- [ ] **Step 3: Implement** `write.ts`, plus the `details` change in `onePiece.ts`.
- [ ] **Step 4: Run them and check they pass.** Run the same command plus
  `tests/main/games.test.ts`. They should PASS.
- [ ] **Step 5: Commit.** `feat(catalog): write the English One Piece catalog`

### Task 7: The `onepiece` stage in the nightly job

**Files:**
- Create: `scripts/catalog/onepiece/index.ts`
- Modify:
  - `scripts/catalog/build.ts`: `STAGES`, `JobOptions`, `--no-onepiece`, logging
  - `scripts/catalog/parity.ts`: `GAMES = ['ygo', 'pkm', 'op']`
  - `scripts/catalog/references.ts`: `game = 'ygo'` on its three `card_printings` reads
  - `.github/workflows/catalog.yml`
- Test: `tests/main/catalog-job.test.ts`, `tests/main/onepiece-step.test.ts`,
  `tests/main/catalog-references.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 6, including `dedupeEntries` (Task 3), `ArtBatch` (Task 4) and the
  `OpPlan` fields (Task 6).
- **`references.ts` (the C1 leak).** `buildReferences` (run by `fingerprints-ygo`,
  `scripts/catalog/fingerprints.ts:277`) reads `card_printings` with no game filter, and
  `wantsReference` takes any `… (X)` label. Every op `SR (Alternate Art)` would become a Yugipedia
  gallery lookup every few nights, ahead of Yu-Gi-Oh's (op sets are the newest). Add the filter
  to its three reads:
  - the `setCodes` query: `WHERE +game = 'ygo' AND language IN (…) AND set_code <> ''`
  - the `printings` query: `WHERE +p.game = 'ygo' AND p.language IN (…)`
  - the `plainRarities` query: `WHERE +game = 'ygo' AND language IN (…)`

  No Pokémon `set_rarity` has parentheses today and no Pokémon card is a token, so no Pokémon row
  passes `wantsReference`: the Yu-Gi-Oh references output is unchanged.
- Produces:
  - `runOnePieceStep(work, o: { cachePath: string; version: string; log; portal?: { url: string; token: string; fetch?: typeof fetch }; sources?: OnePieceSources; now?: () => Date; budget?: number }): Promise<{ report: OnePieceReport | null; error: string | null; problems: string[] }>`.
    In order:
    1. **Fetch.** `series()`, then `groups()` and `mapGroups`. Build
       `published: Map<seriesId, publishedOn ms>` from `bySeries`. Then
       `entries(series, published)` and `dedupeEntries(series, entries, published)`. Then the
       products and prices of every mapped group and the promo pool, with `createLimiter(4)`.
    2. **Read the stored state**, each with one query:
       - `stored: Map<bandaiId, productId>` from
         `SELECT set_rarity_code, tcg_product_id FROM card_printings WHERE game = 'op' AND tcg_product_id IS NOT NULL`
       - `firstSeen: Map<bandaiId, ms>`: the MIN of `entries.first_seen_at` per `bandai_id` in
         the cache (the cache key is (series, id))
       - `prices: Map<productId, number | null>`: `marketPrice` when the product has exactly one
         price row, else null (Builder's call 6)
    3. **`refreshArt`**, with one `ArtBatch` per series in the order of Builder's call 10
       (`published` descending, unmapped last, then series id) and `stored`.
    4. **Read the art state:** `hashed` is every Bandai id with a `bandai_art` row, and `frozen`
       those with `changed_hash IS NOT NULL` (`isFrozen`).
    5. **`matchSeries`** for each series, with its group's products (or the promo pool), `stored`,
       and hash lookups over `bandai_art` and `tcg_art`.
    6. **`writeOnePiece`** with the `OpPlan` built from steps 1–5.
    7. **Compare `perSet` with `set_stats`** and store the new stats.
  - `ONEPIECE_ART_BUDGET` (env, a positive integer) is read by the `build.ts` default and passed
    as `budget`, overriding `ART_BUDGET` for a one-off run (Task 12). Unset or invalid, it is
    `ART_BUDGET`.
  - `problems` and notes from `series()` and `entries()` go into the report's notes and
    problems as they are.
  - Any throw (a source down, a collision) becomes `error`. Nothing is written, so last night's
    op rows stay.
  - `problems` collects: the sources' problems; `Bandai art changed: <id>` for each id in
    `firstNoticed`; and `<setCode> priced share fell from <a>% to <b>%` (Builder's call 14).
  - `logOnePiece(r, log)` writes one summary line,
    `One Piece en: <series> series, <cards> cards, <printings> printings (<priced> priced, <unpriced> unpriced, <held> held), <images> images, <tcgOnly> TCGplayer-only products skipped, <don> DON!! skipped, <notes> notes`,
    then one line per set, `One Piece en <setCode>: <priced>/<printings> priced`, then each note.
  - **`build.ts`:**
    - `STAGES = ['ygo', 'pokemon', 'onepiece', 'upload', 'fingerprints-ygo', 'fingerprints-pkm']`
    - `JobOptions.onePiece?: (work: Database.Database) => Promise<{ report: OnePieceReport | null; error: string | null; problems: string[] }>`
    - `JobOptions.skipOnePiece?: boolean`
    - The flag is `--no-onepiece`.
    - The default runs `runOnePieceStep` with `cachePath: join(dir, 'onepiece-src.sqlite')`,
      and with `portal` only when `url` and `token` are set and it isn't a dry run.
    - `error` gives the problem `One Piece refresh skipped: <error>`, and each of `problems` is
      raised as a problem.
  - **`catalog.yml`:**
    - A step `Refresh One Piece` runs `npm run catalog:job -- --stage onepiece` after
      `Refresh Pokémon`.
    - New `Restore One Piece sources` and `Save One Piece sources` steps (`if: always()`) cover
      `catalog-work/onepiece-src.sqlite` and its `-wal`, with key
      `catalog-onepiece-${{ github.run_id }}-${{ github.run_attempt }}` and restore-keys
      `catalog-onepiece-`.
    - **The work-database path list is not touched.** A comment next to the new steps says why.

- [ ] **Step 1: Write the failing tests.**
  - `catalog-job.test.ts`:
    - The file's `runJob` wrapper also passes
      `onePiece: async () => ({ report: null, error: null, problems: [] })`, so that no test reaches
      Bandai.
    - Add a `One Piece step in the nightly job` describe:
      - `a failed op step is a problem; ygo and pkm still upload`
      - `op problems fail the run but the upload goes ahead`
      - `skipOnePiece leaves the step out`
      - `--stage onepiece runs it alone`
      - `the op step adds only op rows to the diff`: a fake step inserts `seedOnePiece` rows. The
        dry-run `counts` of every `:ygo` and `:pkm` key equal those of the same job with
        `skipOnePiece`, and `cards:op` upserts are 1.
      - `the op rows upload with game op and pass findShrinks on a second night with no change`
  - `onepiece-step.test.ts`, with fake `OnePieceSources` over the Task 1 and 2 fixtures and
    in-memory PNGs:
    - `end to end: OP17-005 versions priced`
    - `a throwing source writes nothing`
    - `a share drop is a problem`: one set of 20 printings, built from the fixture by
      renumbering (still under 30 rows). Night 1 has 20 of 20 priced, and night 2 has 0 of 20
      (the products are gone from the fake prices). `problems` contains
      `OP17 priced share fell from 100% to 0%`. The same drop on a set of 4 printings is no
      problem (under 20 printings).
    - `stored products feed the matcher`: after night 1 prices `_p1`, night 2's fake sources
      serve a closer product for `_p1`. The printing keeps its product, and the notes have the
      `keeps` line.
  - `catalog-references.test.ts`, new test `op printings get no Yugipedia lookup`: with
    `seedOnePiece(work)` added to the file's setup work database (its `L (Alternate Art)`
    printing passes `wantsReference`), `buildReferences` returns the same `entries` as without
    it, and no `listPageImages` call names a title containing `Monkey.D.Luffy`. Every existing
    test in the file passes unchanged.
- [ ] **Step 2: Run them and check they fail.** Run
  `npm test -- tests/main/catalog-job.test.ts tests/main/onepiece-step.test.ts tests/main/catalog-references.test.ts`.
  They should FAIL (the references test makes a `Monkey.D.Luffy` gallery request).
- [ ] **Step 3: Implement** `index.ts`, `build.ts`, `parity.ts`, `references.ts` and `catalog.yml`.
- [ ] **Step 4: Run them and check they pass.** Run the same command, then
  `npm test -- tests/main/catalog-fingerprints.test.ts tests/main/scan-fingerprint-refs.test.ts`
  (unchanged, PASS), then `git diff main -- .github/workflows/catalog.yml`. The tests PASS, and the diff shows no
  change inside either `Restore work database` or `Save work database` `path:` block.
  **Don't merge this task's `catalog.yml` change to `main` before the portal deploy (Task 12
  Step 3).**
- [ ] **Step 5: Commit.** `feat(catalog): One Piece stage in the nightly job`

### Task 8: The portal serves and stores One Piece art, and keeps op versions sticky

**Files:**
- Create: `workers/portal/src/opArt.ts`
- Modify:
  - `workers/portal/src/images.ts`: `cardArtKey`, the `game === 'op'` branch of `resolve`, and
    the `printing` branch of `resolve` (no upstream lookup for an op printing)
  - `workers/portal/src/thumbs.ts`: export `adminAuthorized` and `isJpegBytes`, and make
    `thumbsRoute` use them (same responses)
  - `workers/portal/src/index.ts`, next to `thumbsRoute`
  - `workers/portal/src/catalogLoad.ts`: `upsertRows`
  - `src/shared/imageSources.ts`: `BANDAI_EN_IMAGE_PREFIX`
  - `src/main/dev/directSources.ts`
- Test: `tests/portal/op-art.test.ts`, `tests/portal/images.test.ts`,
  `tests/portal/catalog-load.test.ts`, `tests/main/directSources.test.ts`. The existing
  `tests/portal/thumbs.test.ts` passes unchanged.

**Interfaces:**
- Consumes: `BANDAI_ID_RE` (Task 1; move it into `src/shared/imageSources.ts` so that the Worker
  can import it, and re-export it from `bandai.ts`), `gameOfId`, `tokenMatches`,
  `MAX_THUMB_BYTES` (`workers/portal/src/thumbs.ts`).
- Produces:
  - `BANDAI_EN_IMAGE_PREFIX = 'https://en.onepiece-cardgame.com/images/cardlist/card/'`
  - In `thumbs.ts`, shared with `thumbsRoute` instead of copied:
    - `adminAuthorized(req: Request, adminToken: string | undefined): Promise<boolean>`: the
      `Bearer` parse plus `tokenMatches`, as `thumbsRoute` does today
    - `isJpegBytes(b: Uint8Array): boolean` (`ff d8`) and `isPngBytes(b: Uint8Array): boolean`
      (`89 50 4e 47 0d 0a 1a 0a`)
  - **`opArtRoute(req, bucket, adminToken): Promise<Response | null>`** for
    `PUT /api/admin/op-art/(full|small)/(\d+)`:
    - It is bearer-token only, through `adminAuthorized` (401 otherwise).
    - The id must be `gameOfId(n) === 'op'` (400 `not-an-op-id`).
    - `full` needs `content-type: image/png`, PNG magic bytes and at most 2 MiB. `small` needs
      `image/jpeg`, JPEG magic bytes and at most 200 KiB (`MAX_THUMB_BYTES`). Anything else gets
      415 or 413.
    - The bytes are stored under `card/full/<n>` or `card/small/<n>`, with the content type, and
      it answers `{ ok: true }`.
    - It returns null for any other path.
  - **`cardArtKey(size, n)`** is `card/small/<n>` for an op id at `small` or `cropped`, and stays
    as it is for everything else. Yu-Gi-Oh and Pokémon keys are unchanged.
  - **`resolve` for `op`** (it runs only on an R2 miss of `cardArtKey(kind, n)`, which the edge
    path at `images.ts:332` checks first):
    - `SELECT bandai_id FROM onepiece_images WHERE image_id = ?`
    - It returns null when there is no row or the id fails `BANDAI_ID_RE`.
    - Otherwise the target always stores and reads the PNG under `card/full/<n>`, never under
      `card/small`:
      `{ key: `card/full/${n}`, source: fixed(`${BANDAI_EN_IMAGE_PREFIX}${bandai_id}.png`, { 'User-Agent': USER_AGENT }), cache: kind === 'full' ? CARD_CACHE : FALLBACK_CACHE, anonymous: true }`.
      So a `small` or `cropped` miss serves the full PNG for an hour only, and the job's small
      copy takes over after its next upload.
    - A miss on a frozen entry's `full` only happens when its first upload failed. Task 4 then
      never uploads it, and this path could store Bandai's newer art under `card/full`. That is
      accepted: it needs a failed upload and a re-pointed id together, and the job reports the
      freeze.
  - **`resolve` for `printing`:** the lookup also selects `game`. For `game = 'op'` the target
    keeps its R2 key but `source` returns null, so an op printing never reaches the Yugipedia
    printing-art lookup (`deps.printingArt.url`).
  - **`upsertRows`:** the flagged-printing rule becomes
    `(row.game === 'pkm' || row.game === 'op') && row.missing_from_api === 1`.
  - **`directImageSources.card`:** for `op`, the same lookup gives
    `{ url: <Bandai URL>, headers }` for every size.

- [ ] **Step 1: Write the failing tests.**
  - `op-art.test.ts`:
    - `stores full and small` (then the R2 objects exist with their content types)
    - `401 without the token`
    - `400 for a Yu-Gi-Oh id`
    - `415 for a JPEG sent as full`
    - `413 for a 3 MiB PNG` (built as a zero-filled buffer with the PNG magic bytes, never decoded)
  - `images.test.ts`, `op art`:
    - with `seedOnePiece`, a stored `card/small/<id>` serves `/img/small/<id>` and
      `/img/cropped/<id>`
    - an R2 miss on `/img/full/<id>` fetches exactly
      `https://en.onepiece-cardgame.com/images/cardlist/card/OP01-001.png`, answers with
      `cache-control: public, max-age=31536000, immutable`, and stores `card/full/<id>`
    - an R2 miss on `/img/small/<id>` fetches the same PNG, answers with
      `cache-control: public, max-age=3600`, stores `card/full/<id>`, and leaves `card/small/<id>`
      absent
    - `/img/printing/<op printing id>` with no R2 object answers 404, and the fake
      `printingArt.url` is never called
    - an op id with no `onepiece_images` row answers 404
    - a row whose `bandai_id` is `../x` answers 404 with no upstream fetch
    - Yu-Gi-Oh and Pokémon keys stay as they are (`card/small/<passcode>`)
  - `catalog-load.test.ts`, `op printings stay flagged when uploaded flagged`: upload an op
    printing with `missing_from_api: 1`, and it stays 1.
  - `directSources.test.ts`, `op ids get the Bandai url`
- [ ] **Step 2: Run them and check they fail.** Run
  `npm test -- tests/portal/op-art.test.ts tests/portal/images.test.ts tests/portal/catalog-load.test.ts tests/main/directSources.test.ts tests/portal/thumbs.test.ts`.
  The new tests should FAIL; `thumbs.test.ts` passes before and after.
- [ ] **Step 3: Implement** the files listed above.
- [ ] **Step 4: Run them and check they pass.** Run the same command, then `npm --prefix workers/portal test`
  and `npm --prefix workers/portal run typecheck`. Everything should PASS.
- [ ] **Step 5: Commit.** `feat(portal): serve and store One Piece art; op versions stay sticky`

### Task 9: Client feed: the delete order and the phone's daily limit

**Files:**
- Modify: `src/main/catalog/apply.ts` (the `card_images` delete branch)
- Test: `tests/main/catalog-apply.test.ts`, `tests/main/phone-store.test.ts`

**Interfaces:**
- Consumes: `seedOnePiece`, `inProcessPortal`, and the phone-store test setup.
- **The rule.** In `applyChanges`, a `card_images` tombstone for an image no entry uses first
  deletes its `onepiece_images` child (`DELETE FROM onepiece_images WHERE image_id = ?`), then
  the image.
  - So a feed page that holds the image's tombstone without the child's never fails the deferred
    FK check at commit.
  - A later `onepiece_images` tombstone for it finds nothing and is a no-op.
  - The server never tombstones `card_images` (`deleteKeys` skips it), so this only guards
    against future jobs. Say so in a comment.

- [ ] **Step 1: Write the failing tests.**
  - `catalog-apply.test.ts`, on a database with `seedOnePiece` and no entries:
    - `an op image tombstone alone commits`: `applyChanges` gets
      `[{ table: 'card_images', deleted: [imageIds[1]] }]` inside a transaction. The commit
      succeeds, both rows are gone, and `PRAGMA foreign_key_check` is empty.
    - `child then parent commits`
    - `parent then child commits`
    - `an image an entry uses keeps both rows`
  - `phone-store.test.ts`, `the daily limit holds for an op account once its catalog exists`:
    1. The owner account (`ADMIN_DISCORD_ID`) has `seedPokemon` and `seedOnePiece` on
       `portal.serverDb` before `ready()`.
    2. After `ready()`, the phone has the op card (`SELECT COUNT(*) FROM cards WHERE game = 'op'`
       is 1).
    3. An hour later, an unforced `store.updateCatalog()` returns false and makes no
       `/api/catalog/changes` request.
    4. With `force: true`, it requests `game=op`.

    The existing test's manual op insert stays as it is.
- [ ] **Step 2: Run them and check they fail.** Run
  `npm test -- tests/main/catalog-apply.test.ts tests/main/phone-store.test.ts`. Only
  `an op image tombstone alone commits` should FAIL, with an FK error. If the phone test fails,
  that is a real bypass: fix it in `updateCatalog`.
- [ ] **Step 3: Implement** the `apply.ts` change.
- [ ] **Step 4: Run them and check they pass.** Run the same command. They should PASS.
- [ ] **Step 5: Commit.** `fix(catalog): an op image tombstone takes its Bandai row first`

### Task 10: One Piece facts, filters, facets, stats, sorts and set types in the repos

**Files:**
- Create: `src/main/repo/opFilters.ts`
- Modify:
  - `src/main/repo/cards.ts`: `ONEPIECE_COLS`, `onePieceFacts` and `rowToCard`, plus the queries
    that select `POKEMON_COLS`, in `cards.ts:268`, `collection.ts:43` and `binders.ts:371`
  - `src/main/repo/collection.ts`: `listEntries`, `getFacets`
  - `src/main/repo/browse.ts`: `whereClause`, `browseFacets`, `SORT_SQL`, `sortSql`
  - `src/main/repo/stats.ts`: `byFrameType.op`
  - `src/shared/types.ts`: `OnePieceFacts`, `CardRow.onePiece`, `BrowseSort` gains
    `'cost' | 'power'`, and `opVersions?: string[]` next to `opRarities` in `CollectionFilters`,
    `BrowseFilters`, `BrowseFacets` and `Facets` (the other op filter fields exist from step 1,
    `types.ts:142-153`)
  - `src/shared/games/onePiece.ts`: `opVersionSql`, and the filter
    `{ key: 'opVersions', label: 'Version', kind: 'multi' }` right after Rarity
  - `src/shared/setTypes.ts`
  - `src/renderer/src/lib/filters.ts`: `HIDDEN_SORTS`, and `'opVersions'` in `GameKey` and
    `GAME_KEYS` after `'opRarities'`
  - `src/renderer/src/features/browse/BrowsePage.tsx`: the sort list
- Test: `tests/main/onepiece-repo.test.ts`, `tests/main/game-branches.test.ts`. In the latter only
  `stats: byFrameType is empty on 'op' and unchanged on the other games` (line 55) changes: its
  first assertion becomes `toEqual([{ frameType: 'Leader', count: 4 }])` (the file's op entry is
  4 copies of the seeded Leader; OP01-002 has no `onepiece_cards` row), and it is renamed
  `stats: byFrameType counts card types on 'op' and is unchanged on the other games`. Its facets
  test checks the Yu-Gi-Oh facets, which stay empty on op, so it is unchanged.

**Interfaces:**
- Consumes: `seedOnePiece`, `OP_CARD_TYPES`, `OP_RARITIES`.
- Produces:
  - **`OnePieceFacts`:**

    ```ts
    { cardType: string; colors: string[]; cost: number | null; life: number | null; power: number | null;
      counter: number | null; attribute: string[]; traits: string[]; blockIcon: number | null; number: string }
    ```

    `rowToCard` sets `onePiece` when `op_number` is non-null, from
    `LEFT JOIN onepiece_cards oc ON oc.card_id = c.id` with
    `ONEPIECE_COLS = oc.number AS op_number, oc.card_type AS op_card_type, …`.
  - **`onePieceWhere(f): { where: string[]; params: unknown[] }`**, against `c`, in the same shape
    as `pokemonWhere`:
    - `opCardTypes` matches `card_type IN`.
    - `opColors`, `opAttributes` and `opTraits` match through `json_each`.
    - `opBlocks` matches `CAST(block_icon AS TEXT) IN`.
    - `cost`, `power` and `counter` take Min/Max.
  - **`opRarityWhere(values, printingCol)`** compares the rarity code, `set_rarity` up to its
    first space (`substr(col, 1, instr(col || ' ', ' ') - 1) IN (…)`):
    - in Collection, on `p.set_rarity`
    - in Browse, as
      `c.id IN (SELECT card_id FROM card_printings WHERE +game = <op> AND contributed = 0 AND …)`
  - **The version filter (the spec lists "version" apart from rarity).**
    `opVersionSql(col: string): string` (in `onePiece.ts`, shared by the filter and the facet) is
    the SQL for a label's version:
    - no ` (` in the label: `'Base'` (`SR`, `SP`, `TR`)
    - else the text between the first ` (` and the final `)`: `SR (Alternate Art)` →
      `Alternate Art`, `SR (Alternate Art 2)` → `Alternate Art 2`,
      `P (Offline Regional Participation Pack 2025 Vol.1)` → that product name
    - an all-digit remainder (`SP (2)`) is `'Base'`, tested with `NOT GLOB '*[^0-9]*'`

    Numbered labels keep their number (`Alternate Art 2`): stripping it would also cut real
    product names such as `… Season 1`.
    `opVersionWhere(values, printingCol)` is `opVersionSql(printingCol) IN (…)`, used where
    `opRarityWhere` is (Collection on `p.set_rarity`, Browse through the same `c.id IN (…)`
    subquery).
  - **`onePieceFacets(db, scope, cardIds: string | null)`** returns
    `{ opColors, opCardTypes, opAttributes, opTraits, opBlocks, opRarities, opVersions }`:
    - `opCardTypes` and `opRarities` follow the order of `OP_CARD_TYPES` and `OP_RARITIES`, and
      the others are sorted alphabetically, except that `opVersions` puts `'Base'` first.
    - `opBlocks` holds strings (`'1'`…`'5'`).
    - `opRarities` and `opVersions` come from the printings of the cards in scope
      (`contributed = 0`).
  - **Where they are used.** `getFacets` and `browseFacets` add them for `'op'`. `listEntries` and
    `whereClause` apply `onePieceWhere`, `opRarityWhere` and `opVersionWhere` for `'op'`. The
    Yu-Gi-Oh branch is unchanged.
  - **`byFrameType.op`** gives card types with copy counts (`onePieceCardTypes(db, scope)`, shaped
    like `pokemonCategories`).
  - **Sorts.**
    - `SORT_SQL.cost` is `(SELECT cost FROM onepiece_cards WHERE card_id = c.id)`, and `power` is
      the same.
    - `sortSql` says they are missing for ygo and pkm, and `atk`, `def`, `level` and `hp` are
      missing for op.
    - `HIDDEN_SORTS` hides `cost` and `power` for ygo and pkm, and `atk`, `def`, `level` and `hp`
      for op.
    - BrowsePage gains `{ value: 'cost', label: 'Cost', kind: 'number', dir: 'asc' }` and
      `{ value: 'power', label: 'Power', kind: 'number', dir: 'desc' }`. The Yu-Gi-Oh and Pokémon
      sort menus are unchanged, because those sorts are hidden there.
  - **`setType(s, 'op')`**: a `setCode` starting `ST` is `'deck'`, `'P'` is `'promo'`, `'OPC'` is
    `'collection'`, and anything else is `'booster'`.
- All new SQL uses `+c.game = ${scope.game}` and `+game = …`, as the neighbouring code does.

- [ ] **Step 1: Write the failing tests** in `onepiece-repo.test.ts`.
  - **Setup:** `seedOnePiece`, plus a second op card written with `writeOnePiece` from a tiny
    plan, or by hand: OP17-019 (Event, Red, cost 1, block 5) with a `C` printing. Add one entry
    of each op printing in the `'op'` scope: the Leader's `L` and `L (Alternate Art)`, and
    OP17-019's `C`.
  - `facts`: `getCard` for OP01-001 has
    `onePiece: { cardType: 'Leader', colors: ['Red'], life: 5, power: 5000, attribute: ['Strike'], traits: ['Straw Hat Crew'], number: 'OP01-001', … }`,
    and a Yu-Gi-Oh card has no `onePiece`.
  - `collection filters`:
    - `opCardTypes: ['Event']` lists only OP17-019
    - `opColors: ['Red']` lists both
    - `costMax: 0` lists none
    - `opRarities: ['L']` lists only the Leader, matching both `L` and `L (Alternate Art)`
    - `opVersions: ['Alternate Art']` lists only the Leader's `L (Alternate Art)` entry, and
      `opVersions: ['Base']` lists the Leader's `L` entry and OP17-019's `C` entry
  - `browse filters and facets`:
    - `browseFacets` op has `opCardTypes: ['Leader','Event']` (in `OP_CARD_TYPES` order),
      `opRarities: ['L','C']`, `opVersions: ['Base','Alternate Art']` and `opBlocks: ['5']`
    - the Yu-Gi-Oh facets are `[]`
  - `browse sort by cost`: OP17-019 (cost 1) comes before the Leader (cost NULL, last), and
    `sort: 'atk'` on op sorts by name.
  - `stats`: `getStats().byFrameType` on op is `[{ frameType: 'Leader', count: 2 }, { frameType: 'Event', count: 1 }]`
    in any order with those counts (two Leader entries of one copy each).
  - `set types`: `setType({ setName: 'x', setCode: 'ST31' }, 'op')` is `'deck'`, then check
    `'P'`, `'OPC'` and `'OP17'`. A Yu-Gi-Oh name is unchanged.
  - `version of a label`: `SELECT ${opVersionSql('?1')}`-style checks (or a one-row table) give
    `Base` for `SR`, `SP` and `SP (2)`, `Alternate Art` for `SR (Alternate Art)`,
    `Alternate Art 2` for `SR (Alternate Art 2)`, and
    `Offline Regional Finalist Card Set 25-26 Season 1` for
    `P (Offline Regional Finalist Card Set 25-26 Season 1)`.
  - **Yu-Gi-Oh and Pokémon unchanged:** the existing `tests/main/collection*.test.ts`,
    `browse*.test.ts` and `stats*.test.ts` pass with no edits.
- [ ] **Step 2: Run them and check they fail.** Run
  `npm test -- tests/main/onepiece-repo.test.ts tests/main/game-branches.test.ts`. They should
  FAIL.
- [ ] **Step 3: Implement** the files listed above.
- [ ] **Step 4: Run them and check they pass.** Run the same command, then
  `npm test -- tests/main tests/portal/game-index-plans.test.ts`. Everything should PASS.
- [ ] **Step 5: Commit.** `feat(repo): One Piece facts, filters, facets, stats and sorts`

### Task 11: A version's own art and price everywhere it's added or shown

**Files:**
- Modify:
  - `src/shared/games/onePiece.ts`: `opPrintingImageId`
  - `src/shared/types.ts`: `Printing.artImageId?`
  - `src/main/repo/cards.ts`: `PrintingDbRow.contributed?`, `rowToPrinting`
  - `src/main/repo/collection.ts`: `cardPriceColumns` also selects `p.contributed`
  - `src/main/repo/sets.ts`: `adjustPrinting` (`sets.ts:460`), and `checklistCards`' card `imageId`
  - `src/main/repo/wishlist.ts`: `listWishlist`'s `imageId`
  - `src/renderer/src/features/add-card/AddCardDialog.tsx`: `imageId(p)`
  - `src/renderer/src/features/card/CardPanel.tsx`: the **display** art of a selected printing
    with no entry (`:136–141`). It is not an add path. The panel's +1 goes through
    `CardTypeList.tsx:126` → `api.sets.adjust` → `adjustPrinting`, and "More options…" opens
    AddCardDialog, so both are covered below.
  - `src/renderer/src/components/CardDetails.tsx`: read `card.pokemon ?? card.onePiece`
  - `src/renderer/src/lib/rarityColors.ts`: the op branch of `rarityColor`
  - The pre-flight grep (`sort_order, image_id LIMIT 1\|images\[0\]?.imageId`) found no other
    op add path: `browse.ts:216` is a card tile's art, and `dexImport.ts:47` is Pokémon only.
    Leave Rip and Scan alone: they are off for op.
  - Favourites are per card, so their tile keeps the card's first (base) image. That is right
    for a card-level heart.
- Test: `tests/main/onepiece-art-pairing.test.ts`, `tests/renderer/op-catalog-ui.test.tsx`,
  `tests/renderer/rarityColors.test.ts` (existing; add one test)

**Interfaces:**
- Consumes: `onePieceImageId`, `gameOfId`, `OnePieceFacts` (Task 10), `BANDAI_ID_RE` (moved to
  `src/shared/imageSources.ts` in Task 8), and the `opVersions` filter and facet (Task 10).
- Produces:
  - `opPrintingImageId(language: string, setRarityCode: string): number | null`. It returns null
    when `setRarityCode` is empty or fails `BANDAI_ID_RE`.
  - `rowToPrinting` sets `artImageId` when `gameOfId(row.card_id) === 'op'`, the row isn't
    contributed (`row.contributed !== 1`), and `opPrintingImageId(...)` is non-null. Other games
    never get the field. A contributed op printing's `set_rarity_code` is client-chosen, so it
    never names art. (`assertLink` in `collection.ts:160` already refuses an add whose image
    belongs to another card.)
  - **`listWishlist`:** `imageId` is `printing.artImageId ?? w_image_id`, so a wanted Alternate
    Art shows its own art.
  - **`rarityColor(rarity, 'op')`** looks up the rarity code, `rarity.split(' ')[0]`, so
    `SR (Alternate Art)` gets the `SR` colour. The ygo and pkm branches are unchanged.
  - **CardPanel display art:** `shown.artImageId ?? (seed?.imageId || detail.data?.images[0]?.imageId)`.
  - **`adjustPrinting`, for op:** a +1 adds with the printing's art image, when that image's
    `card_images` row exists, else the original. A −1 prefers the entry with that image.
  - **`checklistCards`, for op:** the card's `imageId` is the art of its first printing in the
    set, by label order.
  - **AddCardDialog `imageId(p)`:** the owned entry's image, else `p.artImageId`, else
    `images[0]`.
  - **CardDetails:**
    - The facts come from `card.pokemon ?? card.onePiece`. `colors`, `attribute` and `traits` are
      joined with `, `.
    - `life` shows only for a Leader, which is the only card with a non-null life.
    - `blockIcon` null shows nothing.
    - The effect and trigger come from `card.desc`.

- [ ] **Step 1: Write the failing tests.**
  - `onepiece-art-pairing.test.ts`, with `seedOnePiece`. Its printings have no
    `set_rarity_code`, so the test sets `OP01-001` and `OP01-001_p1` and
    `market_price` 1.00 and 40.00.
    - `getCard(...).printings` gives the `L (Alternate Art)` printing an `artImageId` equal to
      `onePieceImageId('en','OP01-001_p1')`. Yu-Gi-Oh printings have none.
    - `adjustPrinting(..., altPrintingId, +1)` creates an entry with that image, and
      `listEntries` shows its `unitPrice` as 40.
    - The checklist card for the set has `imageId` equal to the base image (`L` sorts first).
    - With `contributed = 1` set on the `L (Alternate Art)` printing, `rowToPrinting` of that row
      has no `artImageId`.
    - `listWishlist` with a want on the `L (Alternate Art)` pkey gives `imageId`
      `onePieceImageId('en','OP01-001_p1')`, and a Yu-Gi-Oh want keeps its first image.
  - `op-catalog-ui.test.tsx`:
    - **AddCardDialog** with an op card: choosing the `L (Alternate Art)` printing and adding
      calls `collection.add` with `imageId: onePieceImageId('en','OP01-001_p1')`.
    - **CardDetails** for the op card, with its `desc` set to the effect text
      `[Activate: Main] Give 1 Rested DON!!` (as `writeOnePiece` writes it; `seedOnePiece` leaves
      `desc` empty, and `tests/fixtures/onePiece.ts` stays as it is), shows "Card type Leader",
      "Color Red", "Life 5" and "Traits Straw Hat Crew", and the effect text exactly once
      (`getAllByText(...)` has length 1).
    - **CardPanel** for the op card with no entries: selecting the `L (Alternate Art)` row shows
      the art `onePieceImageId('en','OP01-001_p1')`.
    - **BrowsePage** with `active = 'op'` and op facets:
      - the filter panel shows Color, Card type, Attribute, Trait, Rarity, Version and Block with
        their options, plus Cost, Power and Counter ranges
      - the sort menu has "Cost: low to high" and no "ATK"
  - `rarityColors.test.ts`, `op labels take their rarity's colour`:
    `rarityColor('SR (Alternate Art)', 'op')` equals `rarityColor('SR', 'op')` (`#e9c46a`), and
    `rarityColor('Unknown', 'op')` is `#9ca3af`. The existing ygo and pkm tests pass unchanged.
- [ ] **Step 2: Run them and check they fail.** Run
  `npm test -- tests/main/onepiece-art-pairing.test.ts tests/renderer/op-catalog-ui.test.tsx tests/renderer/rarityColors.test.ts`.
  They should FAIL.
- [ ] **Step 3: Implement** the files listed above.
- [ ] **Step 4: Run them and check they pass.** Run the same command, then
  `npm run typecheck && npm test`. Everything should PASS, and the existing Yu-Gi-Oh and Pokémon
  renderer tests pass unchanged.
- [ ] **Step 5: Commit.** `feat(ui): One Piece versions add and show with their own art and price`

### Task 12: Release check and order

**Files:** none new.

- [ ] **Step 1: Run the full suite.** Run
  `npm run typecheck && npm --prefix workers/portal run typecheck && npm run lint && npm test && npm --prefix workers/portal test`.
  Everything should PASS. Also check:
  - `git diff main -- src/shared/catalogTables.ts src/main/db/schema.ts workers/portal/src/migrate.ts`
    is empty (no migration).
  - `catalog-feed-legacy.test.ts` passes unchanged.
- [ ] **Step 2: Do a capped live dry run** on the builder's machine. It is polite, a one-off, and
  it proves the parser and the matcher on real data.
  - **The work database.** There is no `work.sqlite` on this machine; the nightly one lives only
    in the Actions cache, which `gh` can't download. Use a scratch `catalog-work/` holding a copy
    of the desktop catalog, `cp ~/.config/duel-binder/collection.db catalog-work/work.sqlite`
    (same migrated schema, about 346k ygo and 109k pkm printings; the original is never opened).
    If the job refuses that copy, use a freshly migrated empty work database instead, and rely
    on the Task 6 digest test for the "other games unchanged" check.
  - Run `ONEPIECE_ART_BUDGET=300 npm run catalog:job -- --stage onepiece` with `PORTAL_URL`
    unset. Art is spent newest series first (Builder's call 10), so OP-17's entries and its
    candidate TCGplayer images go first, and whatever OP-17 leaves goes to the next newest
    series. Nothing promises that more than OP-17 is hashed.
  - Record the summary line and the OP-17 priced share in the PR. Expect 90% or more of the
    OP-17 printings whose entry and candidates were all hashed to be priced, and 0 versions
    priced onto another number. If OP-17 alone needs more than 300 downloads, say so and report
    the share over the hashed pairs.
  - Open `work.sqlite` and check OP17-005's three printings against the TCGplayer product pages.
  - Then compare per-table row counts for `game <> 'op'` before and after the run. They must be
    identical.
- [ ] **Step 3: Deploy the portal first, from the branch, before merging.** Run
  `npm --prefix workers/portal run deploy` on `feat/one-piece-catalog`. It carries the op-art
  route, the `/img` op branch and the sticky op rule. Record the Worker version id in memory.
  Only then merge the PR to `main`. The scheduled run is at 06:17 UTC (`17 6 * * *`); if the
  deploy can't happen first, merge well outside that window and deploy right after. Never leave
  `main` with the op stage while the deployed portal lacks the op-art route.
- [ ] **Step 4: Run the workflow by hand** on `main` (`workflow_dispatch`, no options), and read
  its log:
  - The `One Piece en:` lines are there, with up to `ART_BUDGET` images uploaded.
  - The `:ygo` and `:pkm` upsert and delete counts look like an ordinary night, with no shrink
    lines.
  - Parity is OK for all three games.
  - The `fingerprints-ygo` references line has no more gallery lookups than the night before,
    and the fingerprint files' upload reports no change caused by op rows.
  - Then signed in as the owner on the web app, open One Piece Browse and see OP-17 art and prices.
  - The next two nights finish the art.
- [ ] **Step 5: Release the clients:** desktop, phone and web (deployed with the portal), as the
  next minor. Commit: `chore: release <next minor>`. Tell the owner the catalog fills over about
  3 nights. Then add the friend by app username at `/admin#testers` if he isn't bound yet.

---

## Self-review notes

- **Spec coverage:**
  - sources and schedule: Tasks 1–3
  - `_pN` guard: Tasks 4 and 6
  - matching rule and unpriced-when-unsure: Task 5
  - per-set priced share: Tasks 6 and 7
  - vocabulary, labels and sets: Task 6
  - filters, facets and details: Tasks 10 and 11 (the version filter, Task 10)
  - an SP reprint belongs to the set it was released in: Task 3 (`dedupeEntries`) and Task 6
  - everywhere (desktop, web, phone through the shared repos and components): Tasks 10 and 11
  - gating: unchanged from step 1, and art is public in Task 8
  - DON!!: deferred, with its reason (call 8)
- **From step 1's ledger:**
  - phone daily limit: Task 9
  - apply delete order: Task 9
  - facets and filters: Task 10
  - card details: Task 11
  - Yu-Gi-Oh and Pokémon unchanged: Task 6 (digest test), Task 7 (diff counts and the
    `references.ts` ygo filter with its test) and Task 12 (live counts)

## Revision log (2026-11-04, from `step2-preflight.md`)

- **C1** (H): `references.ts` gets `game = 'ygo'` on its three `card_printings` reads in Task 7, with the test `op printings get no Yugipedia lookup`; Review Focus and self-review updated.
- **P1** (H): `refreshArt` takes `batches` and `stored`; TCGplayer images are fetched for numbers with an entry that has no stored product, plus stored products with no `tcg_art` row.
- **P2 / C3** (H): duplicates are kept under the page their `cardSets` names, else the earliest (`publishedOn`, then id); new `dedupeEntries` in Task 3, run in Task 7 after `groups()`; Builder's call 1 rewritten; Task 3 test added.
- **P3**: `labels never move` rewritten (same product: 1% ignored, 30% applied, label kept); new test `a new product sets the price outright`; Builder's call 5 and Task 6's price rule say when a product can change.
- **P4 / D6**: `H2` defined (bits 120–239), `H2far` added; the 712091 case replaced by a test product 900001 of OP17-005; a gone-stored-product test added; Task 5 says which steps run for a stored entry and that its product is reserved.
- **P5**: Task 7's ordered steps build `published`, `stored`, `firstSeen` (MIN per id), `prices`, `hashed` and `frozen`.
- **P6**: the CardDetails test sets `desc` to the effect text; the fixture stays as it is.
- **P7**: `perSet` joins `sets` on `game = 'op'`; Global Constraint added; the `perSet` test adds a ygo `OP17` set.
- **P8**: Task 11 Consumes lists `BANDAI_ID_RE` from Task 8.
- **P12**: an op `small`/`cropped` R2 miss serves the PNG with `FALLBACK_CACHE` and stores it only under `card/full`; frozen entries are never uploaded; a retried upload checks the hash; images tests added; Builder's call 11 updated.
- **P13**: Task 12 Step 3 deploys the portal from the branch before the merge; Global Constraint and a Task 7 warning added.
- **P15**: Task 10 names the one `game-branches` assertion that changes (line 55, Leader count 4); the facets test stays.
- **P9, P10, P11, P14**: no conflict found; no change.
- **Task 1 (L)**: special-page `title`/`code` stated; `parseSeriesList` returns `{ series, notes }`, so the unknown-kind note has somewhere to go; test added.
- **Task 2 (M/L), D1**: the fetch test has real assertions (10 products, 704752 `imageUrl` null, URLs, the envelope rejecting); `don` wins over `sealed`.
- **Task 3 (M)**: recency comes from group `publishedOn`, falling back to `first_seen_at`; the schedule test is pre-seeded with an old series and a pinned clock; an OP15-EB04 page fixture is added; a series that never had cards gives a note, not a problem.
- **Task 4 (L)**: a frozen entry's `checked_at` moves forward on every re-check; `smallCopy` returns null over 200 KiB (counted as failed); new tests for ordering, TCGplayer scope, frozen uploads and retried uploads.
- **Task 5 (M)**: `don` counts DON!! only; sealed products are counted nowhere.
- **Task 6 (M/L), D2**: the `idOf?` option is in the signature; printings load once into a Map (no unindexed per-entry lookup); `onepiece_cards.effect`/`trigger` are still written; expected values given for `second Alternate Art is numbered`, `unlisted entry is flagged, not deleted`, `perSet counts priced share` and `id collision throws`.
- **D3**: `hashHex` is imported from `fingerprintRefs.ts`; only `hexHash` is new.
- **D4**: `withRetry` is exported from `upload.ts`, and `smallJpeg` from `thumbs.ts`; both are reused, and their existing tests run unchanged.
- **D5**: `adminAuthorized`, `isJpegBytes` and `isPngBytes` are shared from `workers/portal/src/thumbs.ts` by `thumbsRoute` and `opArtRoute`.
- **§4 Builder's call 2 wording**: rewritten to "opaque pass-through, parsed only by `rarityAbbr`".
- **§4 contributed rows (L)**: `rowToPrinting` gives no `artImageId` for `contributed = 1`; test added; `assertLink` noted as the add guard.
- **§4 artResolver (L)**: the portal's `/img/printing` for an op printing never calls the Yugipedia lookup; test added.
- **C2**: a Version filter and facet (`opVersions`, `opVersionSql`) are added in Task 10, with tests, and listed in the Task 11 filter panel test.
- **C4**: `rarityColor(…, 'op')` reads the code before the first space; test in `rarityColors.test.ts`.
- **C5**: wishlist tiles use `printing.artImageId`; favourites stay per card (base art), which is correct.
- **C6**: the stale `SCHEMA_V40` comment is noted in Builder's call 1 and left alone, because `schema.ts` must not change.
- **C7**: `TR` is kept over "Treasure Rare", with the reason stated in Builder's call 3.
- **Task 11 (L)**: the CardPanel lines are described as display art, the panel's +1 path is traced to `adjustPrinting`, and the grep results are listed.
- **Task 12 (L)**: the budget run's claim matches the newest-first order, and the work-database source is given (a desktop catalog copy, else an empty migrated DB).

