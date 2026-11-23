# Decks step 4: Magic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Magic decks on every client, in seven formats including Commander, checked live against a nightly Scryfall-built rules pack, with Arena and MTGO text import and export.

**Architecture:**
- **The pack.** The catalog run streams Scryfall's `oracle_cards` bulk file and writes `rules/mtg.json`. It holds:
  - per-name legality bits;
  - the "any number" cards with their caps;
  - who can be a commander, and how they pair;
  - cards not yet released.
- **The checks** are pure functions over that pack and the card facts `decks:get` returns: English name, type line, colour identity, mana value and layout, read from `mtg_cards`.
- **Import and export** reuse step 1's preview and resolver, with a Magic text parser and exporter.

**Tech Stack:** TypeScript, vitest (`--maxWorkers=2`), better-sqlite3 (desktop, catalog scripts), Cloudflare Worker (the portal shares `src/main/repo/decks.ts` and `src/shared/decks/fields.ts`), React renderer.

**Spec:** `docs/superpowers/specs/2026-11-23-decks-magic-design.md` (this step), parent `docs/superpowers/specs/2026-11-22-decks-design.md`. Step 3's plan (`docs/superpowers/plans/2026-11-22-decks-step3-onepiece.md`) shows the same seams for One Piece; follow its patterns.

## Global Constraints

- **Game and formats.** Game id is `mtg`. There are seven formats, in this order, all with `priceRegion: 'en'`:
  - `standard` "Standard"
  - `pioneer` "Pioneer"
  - `modern` "Modern"
  - `legacy` "Legacy"
  - `vintage` "Vintage"
  - `pauper` "Pauper"
  - `commander` "Commander"
- **Sections.**
  - The six 60-card formats: `{ id: 'main', label: 'Main', min: 60, max: Infinity }` and `{ id: 'side', label: 'Sideboard', min: 0, max: 15 }`.
  - Commander: `{ id: 'commander', label: 'Commander', min: 1, max: 2 }` and `{ id: 'main', label: 'Main', min: 98, max: 99 }`.
  - `DeckSection` gains `'commander'`.
- **Copy limits** are by English name (`mtgName`). Cards in different languages count together.
  - 60-card formats: 4 across Main and Sideboard.
  - Commander: 1 across Commander and Main.
  - Basic lands are exempt: the front face's type line has both `Basic` and `Land`.
  - Pack `anyNumber` cards are exempt. Cap 0 means no cap; any other cap is that card's limit.
- **Pack.** The path is `rules/mtg.json`, with `game: 'mtg'` and `schema: 1` (`RULES_SCHEMA` stays 1).
  - Upload with `PUT ${PORTAL_URL}/api/admin/rules/mtg`. The dry run writes `out/rules-mtg.json`.
  - Legality bits are 2 per format in `MTG_FORMATS` order: 0 not legal, 1 legal, 2 restricted, 3 banned.
- **Problem keys and severity.**
  - Keys are at most 64 characters (`MAX_PROBLEM_KEY`). Per-card keys use the card id, never the name, because Magic names run past 64.
  - Problems are errors, except these warnings: `stale`, `soon:*` and `unsure`.
- **Dates** in messages read like `Feb 6`, using `toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })`.
- **Other games are unchanged.** The behaviour of every shared file for Yu-Gi-Oh!, Pokémon and One Piece stays the same, and their tests pass untouched.
- **Running checks.** Run vitest as `npx vitest run --maxWorkers=2 <paths>`. Run `npm run typecheck:web` and `npm run typecheck:phone` separately, because plain `typecheck` stops early.
- **Safety.** Never launch the app against the real profile, and never sign in. Scryfall requests send the existing `DuelBinder/<version> (<repo url>)` User-Agent and nothing personal.

## Review Focus

1. **Language twins.** 3 English plus 2 Japanese Lightning Bolt is 5 copies, so it's a copies error (Tasks 3 and 4).
2. **Two-faced and split names.** The catalog's English name for `Delver of Secrets // Insectile Aberration` equals the pack key. An Arena line `4 Delver of Secrets` matches it (Tasks 3 and 5).
3. **A Commander deck with no commander yet.** `count:commander` is the only commander-related problem. There are no colour errors on every card (Task 4).
4. **Vintage restricted across Main and Sideboard.** 1 Black Lotus in Main plus 1 in Sideboard is a `limit:` error (Task 4).
5. **A previewed card.** It's a `soon:` warning, not a "not legal" error. A future-dated reprint of an old card isn't marked upcoming (Tasks 1 and 4).

---

### Task 1: Magic pack type and pack builder

**Files:**
- Modify: `src/shared/decks/pack.ts`
- Create: `src/shared/decks/magic/buildPack.ts`
- Test: `tests/shared/decks/pack.test.ts` (add cases), `tests/shared/decks/mtgBuildPack.test.ts`

**Interfaces:**
- Produces, in `pack.ts`:
  ```ts
  export const MTG_FORMATS = ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'commander'] as const
  export type MtgFormat = (typeof MTG_FORMATS)[number]
  export const MTG_LEGALITY = { notLegal: 0, legal: 1, restricted: 2, banned: 3 } as const
  /** '' alone only | 'partner' | `partner-with:${name}` | 'friends' | 'background-chooser' | 'background' | 'companion' | 'doctor' | `variant:${text}` */
  export type MtgCommanderKind = string
  export interface MtgRulesPack {
    schema: number; game: 'mtg'; version: string; builtAt: string
    sources: { name: string; fetchedAt: string }[]
    formats: string[]                          // MTG_FORMATS at build time, in bit order
    legal: Record<string, number>              // English name → 2 bits per format
    anyNumber: Record<string, number>          // name → cap, 0 = no cap
    commander: Record<string, MtgCommanderKind>
    upcoming: Record<string, string>           // name → YYYY-MM-DD
  }
  export function mtgLegality(pack: MtgRulesPack, name: string, format: MtgFormat): 0 | 1 | 2 | 3 | null  // null = name not in pack
  export type RulesPack = YgoRulesPack | PkmRulesPack | OpRulesPack | MtgRulesPack
  ```
- Produces, in `magic/buildPack.ts`:
  ```ts
  /** The fields of a Scryfall oracle_cards object the builder reads. */
  export interface MtgPackCard {
    name: string; layout: string; type_line?: string; oracle_text?: string; keywords?: string[]
    legalities: Record<string, string>; released_at: string; reprint?: boolean; digital?: boolean
    games?: string[]; card_faces?: { name: string; type_line?: string; oracle_text?: string }[]
  }
  export function commanderKind(c: MtgPackCard): MtgCommanderKind | null   // null = can't be a commander
  export function anyNumberCap(c: MtgPackCard): number | null              // null = normal limits
  export function buildMtgPack(cards: Iterable<MtgPackCard>, o: { version: string; builtAt: Date }): MtgRulesPack
  ```
- **What the builder decides from each card:**
  - **Skipped cards:** those with `digital` true or without `'paper'` in `games`, Alchemy `A-` names, and any card with every format bit 0.
  - **Legality bits:** from `legalities[format]`: `legal` 1, `restricted` 2, `banned` 3, anything else 0.
  - **`anyNumberCap`:**
    - 0 for text containing `A deck can have any number of cards named`.
    - n for `A deck can have up to <word or digit> cards named` (seven → 7, nine → 9).
    - Otherwise null.
  - **`commanderKind`:** read the front face (`card_faces[0]` when present, else the card).
    - It's null unless one of these holds:
      - the type line has `Legendary` and `Creature`;
      - any face's text has `can be your commander`;
      - the type line has `Legendary` and `Background`.
    - The builder also confirms the current Commander rules for other legendary permanents (Vehicles, Spacecraft) at mtgcommander.net or Wizards' Commander rules page. If they're eligible now, add them here with a test, and cite the page in the report.
    - When the card is eligible, the kind is:
      - `background` for a Background;
      - `partner-with:<name>` when the text has `Partner with <name>` (up to ` (` or the line end);
      - `variant:<text>` for `Partner—<text>`;
      - `partner` for the keyword `Partner`;
      - `friends` for `Friends forever`;
      - `background-chooser` for `Choose a Background`;
      - `companion` for `Doctor's companion`;
      - `doctor` when the type line has `Time Lord Doctor`;
      - else `''`.
  - **`upcoming[name]`:** set to `released_at` when it's later than the build day (UTC) and `reprint` isn't true.
- **Pack header:**
  - `version` is `o.version`, Scryfall's bulk `updated_at`.
  - `sources` is `[{ name: 'Scryfall', fetchedAt: o.version }]`.
  - `formats` is `[...MTG_FORMATS]`.
  - The function throws when `parseRulesPack` of the result isn't `ready`.
- **`validMtg` in `parseRulesPack`** requires:
  - `formats` to equal `MTG_FORMATS`. A different list is `missing`, so an older app shows "update to check legality" through the existing schema path rather than misreading bits.
  - `legal` values to be integers in `0 … 4^7-1`.
  - `anyNumber` values to be integers ≥ 0.
  - `commander` values to be strings.
  - `upcoming` values to match `YYYY-MM-DD`.

- [ ] **Step 1: Write failing tests.**
  - In `pack.test.ts`:
    - `parses a valid mtg pack` → `ready` and `game === 'mtg'`.
    - `rejects an mtg pack whose formats differ` → `missing`.
    - `rejects a legal value over 4^7-1` → `missing`.
    - `rejects a bad upcoming date` → `missing`.
  - In `mtgBuildPack.test.ts`, using small inline `MtgPackCard`s:
    - Black Lotus with vintage `restricted`, legacy `banned` and commander `banned` gives `mtgLegality` 2 / 3 / 3.
    - Relentless Rats (`A deck can have any number of cards named Relentless Rats.`) gives 0.
    - Seven Dwarves (`up to seven`) gives 7.
    - Commander kinds:
      - a Legendary Creature with no keyword is `''`;
      - a non-legendary creature is null;
      - a Legendary Planeswalker whose text says `can be your commander` is `''`;
      - Thrasios with keyword `Partner` is `partner`;
      - Pir (`Partner with Toothy, Imaginary Friend`) is `partner-with:Toothy, Imaginary Friend`;
      - a `Friends forever` card is `friends`;
      - a `Choose a Background` card is `background-chooser`;
      - a Legendary Enchantment — Background is `background`;
      - a `Doctor's companion` card is `companion`;
      - a `Legendary Creature — Time Lord Doctor` is `doctor`;
      - a card with text `Partner—Father & son` is `variant:Father & son`.
    - A modal DFC whose front is a Legendary Creature reads its kind from `card_faces[0]`.
    - Upcoming:
      - a new card released after `builtAt` is in `upcoming`;
      - the same with `reprint: true` isn't (Review Focus 5).
    - A `digital: true` card and an `A-` card are left out.
    - The built pack passes `parseRulesPack`.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/shared/decks/pack.test.ts tests/shared/decks/mtgBuildPack.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `validMtg` next to `validOp`. `parseRulesPack` accepts `game: 'mtg'`. Implement `buildPack.ts`.
- [ ] **Step 4:** Run the tests again. Expected: PASS, with the ygo, pkm and op cases unchanged.
- [ ] **Step 5:** Commit `feat(decks): Magic rules pack type and builder`.

### Task 2: Build and upload the pack nightly

**Files:**
- Modify: `scripts/catalog/magic/scryfall.ts`. `bulkInfo(type: 'all_cards' | 'oracle_cards' = 'all_cards')`, and a new `rawObjects(downloadUri): AsyncIterable<unknown>` that streams the bulk file like `cards()` but without `slimCard`, because `slimCard` drops `legalities`.
- Modify: `scripts/catalog/magic/types.ts` (`ScryfallSource` gains `rawObjects`; `bulkInfo` takes the type)
- Modify: `scripts/catalog/rules.ts` (header comment, a `game === 'mtg'` branch, and the game union `'ygo' | 'pkm' | 'op' | 'mtg'` in `publish` and the unknown-game error)
- Modify: `.github/workflows/catalog.yml`
- Modify: `workers/portal/src/rulesPack.ts`, if its body size cap is below the measured pack size. Raise it to 4 MB raw.
- Test: `tests/portal/rulesPack.test.ts` (add a case), `tests/catalog/` (whichever file tests `scryfall.ts`; add a `rawObjects keeps legalities` case)

**Interfaces:**
- CLI: `npm run catalog:rules -- --game mtg [--dry-run]`. It reads `bulkInfo('oracle_cards')`, streams `rawObjects`, and maps each object to `MtgPackCard`. Then it calls `buildMtgPack(cards, { version: updatedAt, builtAt: new Date() })`, prints raw and gzipped sizes, and uploads or writes `out/rules-mtg.json`.
- **Ruling on pack size:** if the gzipped pack is over 1 MB, stop after Step 4 and report the sizes. Don't split it on your own; the controller decides. The spec expects ~250–400 KB.

- [ ] **Step 1: Write failing tests.**
  - The portal test: `PUT /api/admin/rules/mtg accepts an mtg pack and GET serves it`, and an op pack PUT to `.../rules/mtg` answers 400 `bad-pack`.
  - The Scryfall test: `rawObjects` over a two-line JSONL body keeps each object's `legalities`.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/portal/rulesPack.test.ts` plus the Scryfall test file. Expected: FAIL. If the portal case already passes after Task 1, note that and keep the test.
- [ ] **Step 3:** Implement. In `catalog.yml`, right after "Flag failed One Piece rules pack":
  - Add "Magic deck rules pack", with `id: mtgrules`, `timeout-minutes: 15`, `continue-on-error: true` and `run: npm run catalog:rules -- --game mtg`, using the same `env` as the op step.
  - Then add "Flag failed Magic rules pack", which sets `CATALOG_PROBLEMS=1` on failure.
- [ ] **Step 4:** Run `npm run catalog:rules -- --game mtg --dry-run`. This downloads ~160 MB from Scryfall. Expected: it writes `out/rules-mtg.json` and prints its sizes.
  - Record in the report the raw size, the gzipped size and the counts of `legal`, `anyNumber`, `commander` and `upcoming`.
  - Spot-check these entries and record each value:
    - Black Lotus;
    - Lightning Bolt;
    - Relentless Rats;
    - Seven Dwarves;
    - Nazgûl;
    - Thrasios, Triton Hero;
    - Pir, Imaginative Rascal;
    - Agent of the Iron Throne (a Background);
    - The Tenth Doctor;
    - one `variant:` card;
    - one two-faced card's key.
  - Then run the portal test. Expected: PASS.
- [ ] **Step 5:** Commit `ci(catalog): build and upload the Magic deck rules pack nightly`.

### Task 3: Sections, formats, card facts and sort

**Files:**
- Modify: `src/shared/decks/types.ts`. Add `'commander'` to `DeckSection`, and these fields to `DeckCard`:
  ```ts
  /** Magic only, else null / []: the English name (through oracle_id), front-face type line, colour identity codes, mana value and Scryfall layout */
  mtgName: string | null
  mtgTypeLine: string | null
  mtgColorIdentity: string[]
  mtgManaValue: number | null
  mtgLayout: string | null
  ```
- Modify: `src/shared/decks/formats.ts`:
  - Add the seven mtg formats with the sections in Global Constraints.
  - `defaultSection` gains an optional third argument, `ctx?: { format: string; commanders: number }`. On `mtg` with `format === 'commander'`, `commanders === 0` and an `mtgTypeLine` front face with `Legendary` and `Creature`, the card goes to `'commander'`; otherwise it goes to `'main'`.
- Modify: `src/shared/decks/fields.ts`. Accept the `commander` section, and the mtg format ids for `mtg` decks.
- Modify: `src/main/repo/decks.ts` (`deckCards()`)
- Modify: `src/shared/decks/sort.ts`
- Modify: every `DeckCard` literal the typecheck flags, using `mtgName: null, mtgTypeLine: null, mtgColorIdentity: [], mtgManaValue: null, mtgLayout: null`
- Test: `tests/main/decks.test.ts`, `tests/shared/decks/formats.test.ts`, `tests/shared/decks/sort.test.ts`, `tests/shared/decks/fields.test.ts` (or wherever `checkDeckFields` is tested)

**Interfaces:**
- `deckCards()` on an `mtg` scope adds one query per table, following the file's one-query-per-table comment.
  - Read `mtg_cards` for the cards: `oracle_id`, `type_line`, `color_identity` (a JSON array), `mana_value` and `layout`.
  - `mtgName` is the `cards.name` of the English card with the same `oracle_id` (`mtgCardId('en', oracleId)`), falling back to the card's own name.
  - `mtgTypeLine` is the front face: the part before ` // `.
- Sort for `mtg`:
  - Section rank: `commander` first.
  - Then the first of `Creature, Planeswalker, Battle, Instant, Sorcery, Artifact, Enchantment, Land` found in `mtgTypeLine`. Anything else ranks 8.
  - Then `mtgManaValue` ascending, with null last.
  - Then name, then id.
  - ygo, pkm and op sorting is unchanged.
- Section counts display: a section with `max: Infinity` shows its count as `{n} / {min}+`. Find where the deck page renders `n / max` and add this.

- [ ] **Step 1: Write failing tests.**
  - In `decks.test.ts`, `deckCards gives an mtg card its English name, type line, identity, mana value and layout`:
    - Seed an English and a Japanese row of one oracle id. Both get the English `mtgName` (Review Focus 1).
    - Seed a transform card named `Delver of Secrets // Insectile Aberration`. Its `mtgName` is that full name and its `mtgTypeLine` is the front face's (Review Focus 2).
    - A pkm card gets `mtgName: null` and `mtgColorIdentity: []`.
  - In `formats.test.ts`:
    - `DECK_FORMATS.mtg` has the seven ids in order, with the sections above.
    - `defaultSection('mtg', legendaryCreature, { format: 'commander', commanders: 0 })` is `'commander'`. With `commanders: 1`, and in `modern`, it's `'main'`.
  - In `fields.test.ts`: an mtg deck with a `commander` entry and format `commander` passes, and format `brawl` fails.
  - In `sort.test.ts`: a Land, an Instant with mana value 1, a Creature with mana value 3, a Creature with mana value 1 and a commander sort as commander, Creature 1, Creature 3, Instant 1, Land.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run --maxWorkers=2 tests/main/decks.test.ts tests/shared/decks tests/portal`, then `npm run typecheck:web` and `npm run typecheck:phone`. Expected: PASS and clean.
- [ ] **Step 5:** Commit `feat(decks): Magic sections, formats, card facts and sort`.

### Task 4: Magic checks

**Files:**
- Create: `src/shared/decks/magic/check.ts`
- Modify: `src/shared/decks/check.ts`:
  - Add a `deck.game === 'mtg'` branch like op's, including the stale warning.
  - Add `'commander'` to `rank()`, right after `'limit'`. The other keys used here already exist.
- Test: `tests/shared/decks/mtgCheck.test.ts`

**Interfaces:**
- Consumes: `MtgRulesPack`, `mtgLegality` and the `DeckCard` mtg fields.
- Produces:
  ```ts
  /** Whether a and b (commander kinds, with their names) may be commanders together. */
  export function validPair(a: { name: string; kind: string }, b: { name: string; kind: string }): boolean
  export function checkMtg(deck: Pick<WireDeck,'format'|'cards'>, format: DeckFormat, cards: Record<number, DeckCard>, pack: MtgRulesPack | null, today: string): DeckProblem[]
  ```
- **Notation in the table below:**
  - `{id}` is the first card id seen for that name.
  - `{name}` is `mtgName`, falling back to the card's name.
  - `{format}` is the format label.

  | key | severity | message | needs pack |
  |---|---|---|---|
  | `count:main` | error | `Main has {n} cards; it needs at least 60` (60-card formats) | no |
  | `count:side` | error | `Sideboard has {n} cards; at most 15` | no |
  | `count:commander` | error | `Commander has {n} cards; it needs 1 or 2` | no |
  | `count:total` | error | `The deck has {n} cards; Commander needs exactly 100` | no |
  | `copies:{id}` | error | `{n} × {name}: at most 4 copies` (60-card), `{n} × {name}: Commander allows 1 copy`, or `{n} × {name}: at most {cap} copies` (an `anyNumber` cap) | cap only |
  | `legal:{id}` | error | `{name} isn't legal in {format}` | yes |
  | `banned:{id}` | error | `{name} is banned in {format}` | yes |
  | `limit:{id}` | error | `{n} × {name}: restricted to 1 in Vintage` | yes |
  | `commander:{id}` | error | `{name} can't be your commander` | yes |
  | `pair` | error | `{a} and {b} can't be commanders together` | yes |
  | `color:{id}` | error | `{name} is outside your commander's colour identity` | no |
  | `soon:{id}` | warning | `{name} isn't out until {date}` | yes |
  | `unsure` | warning | `Couldn't check {n} cards` | yes |

- **Rules:**
  - **Copies:** counts sum across every section, grouped by `mtgName`.
    - Without a pack, the `anyNumber` exemption can't apply. Basic lands are still exempt, and `copies` still runs, with no cap known.
    - With no pack, a name over the limit is still an error. An "any number" card then reads as over the limit, and that's accepted: the status is unknown anyway.
  - **Upcoming cards:** a name in `upcoming` with `today` before the date is `soon:` and skips `legal`, `banned` and `limit`.
  - **Unknown cards:** a name not in the pack (`mtgLegality` null) counts toward `unsure`, by copies.
  - **Commander, no commander yet:** with an empty commander zone there are no `commander:`, `pair` or `color:` problems (Review Focus 3).
  - **Colour identity:** each Main card's `mtgColorIdentity` must be a subset of the union of the commanders' identities. A card with an empty identity always fits. A card missing from `cards` is skipped by every per-card rule.
  - **Commander eligibility:** a commander whose name isn't in `pack.commander`, or whose kind is `background` while it's the only commander, is `commander:`.
  - **Pairs:** two commanders that aren't a `validPair` are `pair`. `validPair` holds when:
    - both are `partner`;
    - `partner-with:X` is matched with the card named X, both ways;
    - both are `friends`;
    - one is `background-chooser` and the other is `background`;
    - one is `companion` and the other is `doctor`;
    - both are `variant:` with the same text.
  - **Vintage restricted:** restricted (2) in `vintage` with more than 1 copy, counted across Main and Sideboard, is `limit:` (Review Focus 4).
  - **Legality:** 3 is `banned:` and 0 is `legal:`, in every format.

- [ ] **Step 1: Write failing tests.** Use a small pack built with `buildMtgPack` and `today = '2026-11-23'`.
  - Counts and copies:
    - `a legal 60 + 15 modern deck gives [] and status legal`.
    - `59 main is count:main`, and `16 side is count:side`.
    - `3 English + 2 Japanese Lightning Bolt is copies:` (Review Focus 1).
    - `24 basic Mountains are fine`.
    - `30 Relentless Rats are fine; 8 Seven Dwarves is copies: with cap 7`.
  - Legality:
    - `a banned card is banned:`, and `a card not legal in Pioneer is legal:`.
    - `1 Black Lotus main + 1 side in vintage is limit:` (Review Focus 4).
    - `a card upcoming on 2026-12-05 is soon:, not legal:` (Review Focus 5). On `today = '2026-12-05'` the soon warning is gone.
    - `a card missing from the pack adds to unsure`.
  - Commander:
    - `a 100-card commander deck with one Legendary Creature is legal`.
    - `99 cards is count:total`.
    - `2 copies of a non-basic is copies: with the Commander message`.
    - `an empty commander zone gives count:commander only` (Review Focus 3).
    - `a non-legendary commander is commander:`, and `a lone Background is commander:`.
    - Pairs: `partner + partner is fine`, `partner + plain legendary is pair`, `Pir + Toothy is fine`, `Pir + Thrasios is pair`, `background-chooser + background is fine`, `companion + doctor is fine`, and `same variant is fine, different variants is pair`.
    - `a blue card under a mono-red commander is color:`, while `a colourless artifact is fine` and `a Boros card under red+white partners is fine`.
  - `no pack: counts, copies (no cap) and colour still run; status unknown`.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/shared/decks/mtgCheck.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run --maxWorkers=2 tests/shared/decks`. Expected: PASS, with the other games' tests untouched.
- [ ] **Step 5:** Commit `feat(decks): Magic checks for the seven formats and Commander`.

### Task 5: Arena and MTGO import and export

**Files:**
- Create: `src/shared/decks/magic/text.ts`
- Create: `tests/fixtures/decks/mtg/` with `arena-modern.txt`, `arena-commander.txt` (with a `Companion` section) and `mtgo-legacy.txt`. These are hand-made in the exact layouts Arena and MTGO export. Include a split card, a transform card and an adventure card.
- Modify: `src/main/repo/decks.ts` (`resolveDeckLines` for mtg; `checkRefs` needs no new shape)
- Test: `tests/shared/decks/mtgText.test.ts`, plus cases in `tests/main/decks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function parseMtgText(text: string): ParsedList
  export function toArenaText(entries: DeckEntry[], cards: Record<number, DeckCard>, pins: Record<string, { set: string; number: string }>): string
  export function toMtgoText(entries: DeckEntry[], cards: Record<number, DeckCard>): string
  ```
- **Parsing:**
  - **Lines:** `<qty> <name>`, optionally followed by ` (<SET>) <number>`, with an optional trailing `*F*`, which is ignored.
    - With a set, the ref is the existing `{ set, number, name }` shape.
    - Without one, the ref is `{ name }`.
  - **Arena headers** (case-insensitive, alone on a line):
    - `Deck` → `main`;
    - `Sideboard` → `side`;
    - `Commander` → `commander`;
    - `Companion` → `side`.
    - `About` and `Name …` lines are ignored.
  - **MTGO:** `SIDEBOARD:` goes to `side`. With no headers at all, the first blank line after cards starts `side`.
  - `sectioned` is true when any header was seen or a blank-line split happened.
  - Blank lines, `//` comments and `#` comments are otherwise ignored. Anything else goes to `skipped`.
  - MTGO's split-card form `Fire/Ice` is normalised to `Fire // Ice`.
- **Resolving on an `mtg` scope:**
  - With `{ set, number, name }`: look for the printing with that set code and collector number, ignoring case, in the Magic printing tables. If found, that's its card, pinned to that printing. Otherwise fall back to the name.
  - With a name, in this order:
    1. exact English `cards.name`;
    2. the front face, where `cards.name` starts with `<name> // `;
    3. `magicNameSearchKey` equality (case and accents).
  - Of several card ids, pick the English one. Always `matched`, never `ambiguous`.
  - A miss is `unmatched`.
- **Companion in Commander:** this is the import preview's job, not the parser's. When the target deck's format is `commander`, every `side` line goes to the preview's left-out list with the reason `Commander decks here have no sideboard`. Find where the preview builds its unmatched/left-out list and add it there.
- **Export:**
  - Arena:
    - `Commander` (if any), blank line, `Deck`, then the Main lines, blank line, `Sideboard`, then the side lines.
    - Each line is `{qty} {name}`, plus ` ({SET}) {number}` when the entry has a pinned printing whose set and number are in `pins`.
  - MTGO:
    - Main lines, then a blank line and the side lines.
    - In Commander, the commanders go in the sideboard position.
  - Names:
    - Arena writes the full `A // B` for layouts `split` and `aftermath`, and the front face for every other two-name card.
    - MTGO writes `A/B` for `split` and `aftermath`, and the front face otherwise.
  - Ordering is `sortEntries('mtg', …)`.
- **Ruling:** the import screen's format guess (spec: "only when the deck has no format yet") applies only if the import flow can create a deck without a format. If every import goes into an existing deck, skip it and note that in the report.

- [ ] **Step 1: Write failing tests.**
  - In `mtgText.test.ts`:
    - Each fixture parses to the expected sections and counts.
    - `4 Lightning Bolt (2X2) 117` gives `{ set: '2X2', number: '117', name: 'Lightning Bolt' }`.
    - `1 Fire/Ice` gives the name `Fire // Ice`.
    - A `*F*` suffix is ignored.
    - `hello` is skipped.
    - Arena round trip: export, then parse, gives the same section and qty per name.
    - `toArenaText` writes `Delver of Secrets` for a transform card and `Fire // Ice` for a split card. `toMtgoText` writes `Fire/Ice`.
  - In `decks.test.ts`:
    - `4 Delver of Secrets` matches the `Delver of Secrets // Insectile Aberration` card (Review Focus 2).
    - A set and number line pins the printing.
    - An unknown set and number falls back to the name, unpinned.
    - `lightning bolt` matches by search key.
    - A Japanese and an English card for one name pick the English one.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run --maxWorkers=2 tests/shared/decks tests/main/decks.test.ts tests/portal`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(decks): Arena and MTGO deck lists`.

### Task 6: Deck screens for Magic

**Files:**
- Modify: `src/renderer/src/features/decks/ImportDialog.tsx`:
  - For `mtg`, call `parseMtgText` with the preview kind `'text'`.
  - Placeholder: `Paste an Arena or MTGO deck list`.
  - Accept `.txt` and `.dek`. A `.dek` file is MTGO XML: if it doesn't parse as text, show `Export as text from MTGO instead`.
- Modify: `src/renderer/src/features/decks/deckExport.ts` and `ExportMenu.tsx`:
  - `ExportKind` gains `'arena' | 'mtgo'`.
  - For `mtg`, the menu offers "Copy Arena list" and "Copy MTGO list".
  - `pins` comes from the entries' pinned printings: set code and collector number, read the way the deck page already reads a pinned printing's label.
- Modify: `src/renderer/src/features/decks/DeckAdder.tsx`:
  - For `mtg`, the chips are `Creature`, `Instant/Sorcery` (`mtgTypes: ['Instant','Sorcery']`), `Land`, and the colour chips `White, Blue, Black, Red, Green, Colorless` (`mtgColors`).
  - In a `commander` deck with commanders, `DeckPage` passes `identity: string[]`. The colour chips for those colours, plus `Colorless`, start switched on.
  - The ygo, pkm and op chips are unchanged.
- Modify: `src/renderer/src/features/decks/DeckPage.tsx` and `DeckSection.tsx`:
  - The Commander section shows above Main, as a small section like One Piece's Leader.
  - Adding a card passes `{ format, commanders }` to `defaultSection`.
- Test: `tests/renderer/decks.test.tsx` (add cases)

- [ ] **Step 1: Write failing tests.**
  - The mtg adder shows `Creature`, `Instant/Sorcery`, `Land` and the six colour chips. Picking `Instant/Sorcery` calls browse with `mtgTypes: ['Instant','Sorcery']`.
  - In a Commander deck with a red commander, `Red` and `Colorless` start on.
  - The mtg export menu has the two items.
  - The mtg import dialog previews an Arena list with a `Commander` header, placing the commander in Commander.
  - Importing a list with a `Companion` into a Commander deck lists it as left out with the reason.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/renderer/decks.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run --maxWorkers=2 tests/renderer tests/shared/decks`, `npm run typecheck:web` and `npm run typecheck:phone`. Expected: PASS and clean.
- [ ] **Step 5:** Commit `feat(decks): Magic on the deck page, adder, import and export`.

### Task 7: Full check

- [ ] **Step 1:** Run `npx vitest run --maxWorkers=2`. Expected: all pass.
- [ ] **Step 2:** Run `npm run lint`, `npm run typecheck:web`, `npm run typecheck:phone` and `cd workers/portal && npx tsc --noEmit`. Expected: clean, apart from the known `@shared/games` portal tsc error on main. Report any other.
- [ ] **Step 3: Check names against the real pack.** Take the `out/rules-mtg.json` from Task 2's dry run (re-run the dry run if it's gone). In a throwaway script under `/tmp`, count how many English names in a desktop-shaped test catalog's `mtg` cards are missing from `pack.legal`. If there's no seeded catalog to use, take 200 names from the pack and run them back through `resolveDeckLines` on a fixture DB instead.
  - Record the counts in the ledger.
  - If two-faced names mismatch, fix the matcher or `mtgName` and add a test.
- [ ] **Step 4:** Commit any fixes.

## Release (owner only, not part of execution)

1. **Deploy the portal.** An old portal rejects the `mtg` pack and any deck with a `commander` section or an mtg format, and a rejected deck fails the whole decks push.
2. Push main.
3. **Run the catalog workflow once by hand** so `rules/mtg.json` exists. Check that the "Magic deck rules pack" step succeeded; it's `continue-on-error`.
4. Tag.
