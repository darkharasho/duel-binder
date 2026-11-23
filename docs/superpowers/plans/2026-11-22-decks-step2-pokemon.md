# Decks step 2: Pokémon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pokémon decks on every client: a 60-card deck checked live against Standard and Expanded, from a rules pack built nightly from TCGdex, with Pokémon TCG Live text import and export.

**Architecture:** A pure builder turns the English TCGdex cards in the catalog's card cache into `rules/pkm.json`: card keys with flags and legality, a TCGdex-id → key map, and banned keys. Clients find a card's key from `pokemon_cards.source_id` (English and European cards) or by English name (everything else), then run pure checks. Import and export reuse step 1's preview and resolver, with a Pokémon parser and a set-plus-number lookup.

**Tech Stack:** TypeScript, vitest (`--maxWorkers=2`), better-sqlite3 (desktop, catalog scripts), Cloudflare Worker (portal, shares `src/main/repo/decks.ts`), React renderer.

**Spec:** `docs/superpowers/specs/2026-11-22-decks-pokemon-design.md` (this step), parent `docs/superpowers/specs/2026-11-22-decks-design.md`.

## Global Constraints

- Game id is `pkm`. Formats are `standard` ("Standard") and `expanded` ("Expanded"), `priceRegion: 'en'`.
- One section: `{ id: 'main', label: 'Deck', min: 60, max: 60 }`. No new `DeckSection` value.
- Copy limit: at most 4 by name, across the deck, except basic Energy.
- At most one ACE SPEC card in total, at most one Radiant Pokémon in total, and at least one Basic Pokémon.
- Rules pack path `rules/pkm.json`, `game: 'pkm'`, `schema: 1` (`RULES_SCHEMA` stays 1). Upload `PUT ${PORTAL_URL}/api/admin/rules/pkm`, dry run writes `out/rules-pkm.json`.
- Pack size target is under 100 KB gzipped. The dry run prints it.
- Problems are errors except `stale`, and `unsure:<cardId>`, which are warnings.
- Problem keys are at most 64 characters (`MAX_PROBLEM_KEY`).
- The Yu-Gi-Oh! behaviour of every shared file is unchanged. Its tests pass untouched.
- Run vitest as `npx vitest run --maxWorkers=2 <paths>`. Run `npm run typecheck:web` and `npm run typecheck:phone` separately (plain `typecheck` stops early).
- Never launch the app against the real profile, and never sign in.

## Review Focus

1. **A thin card cache.** A night where the cache holds only some English cards would mark most decks Not legal. The builder refuses fewer than 15,000 English cards (Task 2).
2. **Japanese and Chinese cards by name.** A card whose English name matches several keys (Pikachu) must not be Not legal when any of those keys is legal. It gets a warning instead (Task 4).
3. **PTCGL energy lines.** `Basic {R} Energy SVE 2`, `Fire Energy SVE 2` and `Basic Fire Energy Energy 2` must all resolve to Fire Energy (Task 6).
4. **Numbers with and without zero padding.** `SVI 57` and `SVI 057` both match the printing `SVI 057/198` (Task 6).
5. **Black & White ACE SPECs.** Computer Search (rarity "Rare ACE") counts as an ACE SPEC in Expanded (Task 2).

---

### Task 1: Pokémon pack types, parsing and the manual file

**Files:**
- Modify: `src/shared/decks/pack.ts`
- Create: `src/shared/decks/rules/pokemon-manual.json`
- Test: `tests/shared/decks/pack.test.ts` (add cases)

**Interfaces:**
- Produces:
  ```ts
  export const PKM_FLAG = { basic: 1, aceSpec: 2, radiant: 4, basicEnergy: 8 } as const
  export const PKM_LEGAL = { standard: 1, expanded: 2 } as const
  export interface PkmKey { n: string; k: 'P' | 'T' | 'E'; f: number; l: number }
  export interface PkmRulesPack {
    schema: number; game: 'pkm'; version: string; builtAt: string
    sources: { name: string; fetchedAt: string }[]
    keys: PkmKey[]
    /** TCGdex English card id ("sv01-196") → index into keys */
    ids: Record<string, number>
    formats: { standard: { banned: number[] }; expanded: { banned: number[] } }
  }
  export type RulesPack = YgoRulesPack | PkmRulesPack
  ```
  `n` is the English name as TCGdex prints it. `f` holds `PKM_FLAG` bits and `l` holds `PKM_LEGAL` bits.
- `parseRulesPack(raw)` keeps its signature and also accepts `game: 'pkm'`.

- [ ] **Step 1: Write failing tests** in `pack.test.ts`:
  - `parses a valid pkm pack`: `keys: [{n:'Ultra Ball',k:'T',f:0,l:3}]`, `ids: {'sv01-196':0}`, banned lists empty → `state: 'ready'`, and `pack.game === 'pkm'`.
  - `rejects a pkm pack whose ids point past keys`: `ids: {'x':5}` with one key → `missing`.
  - `rejects a pkm key with a bad kind`: `k: 'X'` → `missing`.
  - `rejects a pkm banned index out of range` → `missing`.
  - `a pkm pack of a newer schema is tooNew`.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/shared/decks/pack.test.ts`. Expected: the new cases FAIL.
- [ ] **Step 3:** Implement. `parseRulesPack` branches on `raw.game` after the shared header checks. The pkm branch checks every key's `n` (string), `k`, and that `f`/`l` are integers; every `ids` value and banned index is an integer in range.
- [ ] **Step 4:** Create `pokemon-manual.json`:
  ```json
  { "asOf": "2026-11-22", "source": "https://www.pokemon.com/us/play-pokemon/about/pokemon-tcg-banned-card-list",
    "banned": { "standard": [], "expanded": ["<TCGdex English id of each printing below>"] },
    "override": {} }
  ```
  Expanded holds one TCGdex English id per banned card. One printing is enough, since a ban covers the card's key. Look each id up at `https://api.tcgdex.net/v2/en/cards?name=<name>` and pick the printing in this list:
  - Archeops NVI 67/101
  - Chip-Chip Ice Axe UNB 165/214
  - Delinquent BKP 98/122
  - Duskull CEC 83/236
  - Flabébé FLI 83/131
  - Flapple RCL 022/192
  - Forest of Giant Plants AOR 74/98
  - Ghetsis PLF 101/116
  - Hex Maniac AOR 75/98
  - Island Challenge Amulet CEC 194/236
  - Jessie & James HIF 58/68
  - Lt. Surge's Strategy UNB 178/214
  - Lysandre's Trump Card PHF 99/119
  - Marshadow SLG 45/73
  - Maxie's Hidden Ball Trick PRC 133/160
  - Medicham V EVS 083/203
  - Milotic FLF 23/106
  - Mismagius UNB 78/214
  - Oranguru UPR 114/156
  - Puzzle of Time BKP 109/122
  - Red Card XY 124/146
  - Reset Stamp UNM 206/236
  - Sableye DEX 62/108
  - Scoop Up Net RCL 165/192
  - Shaymin-EX ROS 77/108
  - Unown LOT 90/214
  - Unown LOT 91/214

  That's 27 ids for 26 names, because the two Unown are separate bans.
- [ ] **Step 5:** Run the pack tests. Expected: PASS, with the Yu-Gi-Oh! cases unchanged.
- [ ] **Step 6:** Commit `feat(decks): Pokémon rules pack type and manual ban list`.

### Task 2: The Pokémon pack builder

**Files:**
- Modify: `scripts/catalog/pokemon/types.ts`. Add to `TdCard`: `legal?: { standard?: boolean; expanded?: boolean }`, `regulationMark?: string`, `trainerType?: string` and `energyType?: string`.
- Create: `src/shared/decks/pokemon/buildPack.ts`
- Create: `src/shared/decks/names.ts`. Move `normalName` here from `src/main/repo/decks.ts` and export it as `normalCardName`. The repo imports it from here.
- Test: `tests/shared/decks/pkmBuildPack.test.ts`

**Interfaces:**
- Consumes: Task 1's types.
- Produces:
  ```ts
  export interface PkmPackCard {
    id: string; name: string; category?: string; stage?: string; rarity?: string | null
    energyType?: string; legal?: { standard?: boolean; expanded?: boolean }
    attacks?: { name: string }[]; abilities?: { name: string }[]
  }
  export interface PkmManual {
    banned: { standard: string[]; expanded: string[] }
    override: Record<string, { standard?: boolean; expanded?: boolean }>
  }
  export const MIN_ENGLISH_CARDS = 15000
  export function cardKeyOf(c: PkmPackCard): string
  export function buildPkmPack(cards: PkmPackCard[], manual: PkmManual, builtAt: Date, minCards?: number): PkmRulesPack
  ```
  `cardKeyOf` gives `normalCardName(name)`, then `|`, then the sorted normalized attack names joined by `,`, then `|`, then the sorted ability names joined by `,`.

- [ ] **Step 1: Write failing tests:**
  - `reprints share a key`: two Ultra Balls, one with `legal.standard: false` and one with `true`. They give one key with `l === 3`, and both ids point at it.
  - `different attacks are different keys`: two Pikachu with different attacks → 2 keys, both `n: 'Pikachu'`.
  - `flags`: stage Basic → `basic`. Rarity `'ACE SPEC Rare'` → `aceSpec`. Rarity `'Rare ACE'` → `aceSpec`. Name `'Radiant Greninja'` → `radiant`. Category Energy with `energyType 'Normal'` → `basicEnergy`, and with `'Special'` → no flag.
  - `kind`: categories `Pokemon` / `Trainer` / `Energy` → `P` / `T` / `E`.
  - `a banned id bans its whole key`: Expanded banned `['sm8-90']` → the index of that key is in `formats.expanded.banned`. The other Unown key isn't. Standard banned is empty.
  - `override wins over TCGdex`: override `{'sv01-196': {standard: true}}` sets the Standard bit on that key.
  - `throws on a manual id not in the cards`, with the message naming the id.
  - `throws below the card floor`: `buildPkmPack(cards, manual, now)` with 10 cards throws. Passing `minCards = 0` builds.
  - `version and builtAt`: `version` is the build date as YYYY-MM-DD.
- [ ] **Step 2:** Run the test. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement. Keys are numbered in first-seen order. `l` is the OR of every printing's `legal`, then the overrides, applied to the key of the overridden id. `sources: [{ name: 'TCGdex', fetchedAt: builtAt }]`.
- [ ] **Step 4:** Run the test plus `tests/main/decks.test.ts`. The `normalName` move must leave the deck repo tests passing. Expected: PASS.
- [ ] **Step 5:** Commit `feat(decks): build the Pokémon rules pack from TCGdex cards`.

### Task 3: Build and upload the pack in the catalog run

**Files:**
- Modify: `scripts/catalog/rules.ts`
- Modify: `.github/workflows/catalog.yml`
- Test: `tests/shared/decks/pkmRulesScript.test.ts`, testing the exported reader only

**Interfaces:**
- Consumes: `buildPkmPack`, `parseRulesPack`, and `pokemon-manual.json`.
- Produces: `export function readEnglishCards(cachePath: string): PkmPackCard[]` in `rules.ts`. It reads `SELECT json FROM td_cards WHERE lang = 'en'` read-only and maps each row to a `PkmPackCard`.
- CLI:
  - `npm run catalog:rules -- --game pkm [--cache <path>] [--dry-run]`. The default cache is `catalog-work/pokemon-src.sqlite`.
  - With no `--game`, it builds `ygo` as today.

- [ ] **Step 1:** Write a failing test. Make a temp sqlite file with a `td_cards` table holding two `en` rows and one `ja` row, then check that `readEnglishCards` returns the two English cards with their `legal` and `attacks`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. Turn the upload and dry-run code into one `publish(game, pack)` used by both games. The pkm dry run writes `out/rules-pkm.json` and prints bytes and gzipped bytes, the same as ygo.
- [ ] **Step 4:** In `catalog.yml`, right after "Refresh Pokémon", add a step "Pokémon deck rules pack" (`id: pkmrules`, `timeout-minutes: 10`, `continue-on-error: true`, `run: npm run catalog:rules -- --game pkm`). Then add "Flag failed Pokémon rules pack", which sets `CATALOG_PROBLEMS=1` on failure, the same way as the ygo pair. Give it the same `env` as the ygo step.
- [ ] **Step 5:** Run the test. Expected: PASS. Then run `npm run catalog:rules -- --dry-run` (ygo, needs network). Expected: it writes `out/rules-ygo.json` as before.
- [ ] **Step 6:** Commit `ci(catalog): build and upload the Pokémon deck rules pack after the Pokémon stage`.

### Task 4: Card facts and key lookup

**Files:**
- Modify: `src/shared/decks/types.ts`. Add `sourceId: string | null` and `code: string | null` to `DeckCard`.
- Modify: `src/main/repo/decks.ts`, in `deckCards()` and every other place that builds a `DeckCard`.
- Modify: any renderer or phone code that builds a `DeckCard` literal (the typecheck finds them), to use `sourceId: null, code: null`.
- Create: `src/shared/decks/pokemon/keys.ts`
- Test: `tests/main/decks.test.ts` (add cases), `tests/shared/decks/pkmKeys.test.ts`

**Interfaces:**
- `sourceId` is `pokemon_cards.source_id` for a pkm card, else `null`. `code` is the pkm card's English printing `set_code`: the lowest one, where `language = 'en'`. It is `null` for other games, or when there is none. Get both with one extra query per table, as the file's comment requires.
- Produces:
  ```ts
  export type KeyHit = { key: number } | { unsure: number[] } | { none: true }
  export interface KeyIndex { byName: Map<string, number[]> }
  export function keyIndex(pack: PkmRulesPack): KeyIndex
  export function keyOfCard(card: DeckCard, pack: PkmRulesPack, index: KeyIndex): KeyHit
  export function pkmKind(type: string): 'P' | 'T' | 'E' | null
  ```
  - `keyOfCard` first tries `pack.ids[sourceId after the first '/']`.
  - Otherwise it looks up the card's English name in `byName`: one key gives `{key}`, several give `{unsure}`, and none gives `{none}`.
  - `pkmKind` folds accents and case and knows:
    - en: Pokemon / Trainer / Energy
    - fr: Pokémon / Dresseur / Énergie
    - de: Pokémon / Trainer / Energie
    - it: Pokémon / Allenatore / Energia
    - es: Pokémon / Entrenador / Energía
    - pt: Pokémon / Treinador / Energia
    - ja: ポケモン / トレーナーズ / エネルギー
    - zh-hans: 宝可梦 / 训练家 / 能量
    - zh-hant: 寶可夢 / 訓練家 / 能量

- [ ] **Step 1:** Write failing tests.
  - `deckCards gives a pkm card its source id and lowest English code`: in `decks.test.ts`, seed one pkm card with `en` printings `SVI 057/198` and `PAL 001/193` → `code: 'PAL 001/193'`. A ygo card gets `sourceId: null, code: null`.
  - `keyOfCard`, four cases:
    - `fr/sv01-196` hits through ids.
    - A `ja/...` card named Ultra Ball with one key gives `{key}`.
    - A `ja/...` Pikachu with 2 keys gives `{unsure: [a, b]}`.
    - An unknown name gives `{none: true}`.
  - `pkmKind('Énergie') === 'E'`, `pkmKind('トレーナーズ') === 'T'`, `pkmKind('Spell Card') === null`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run --maxWorkers=2 tests/main/decks.test.ts tests/shared/decks`, then `npm run typecheck:web` and `npm run typecheck:phone`. Expected: PASS and clean.
- [ ] **Step 5:** Commit `feat(decks): Pokémon card facts and card-key lookup`.

### Task 5: Pokémon formats, checks and sort

**Files:**
- Modify: `src/shared/decks/formats.ts` (pkm formats)
- Create: `src/shared/decks/pokemon/check.ts`
- Modify: `src/shared/decks/check.ts`. Add a `deck.game === 'pkm'` branch that mirrors ygo's, including the stale warning, with the message "The rules here are from {date} and may be out of date". Add `'ace'`, `'radiant'`, `'basic'`, `'legal'`, `'banned'` and `'unsure'` to `rank()` after `'limit'`.
- Modify: `src/shared/decks/sort.ts`
- Test: `tests/shared/decks/pkmCheck.test.ts`, `tests/shared/decks/formats.test.ts` (add a case)

**Interfaces:**
- Consumes: `keyIndex`, `keyOfCard`, and the pack types.
- Produces: `export function checkPkm(deck: Pick<WireDeck,'format'|'cards'>, format: DeckFormat, cards: Record<number, DeckCard>, pack: PkmRulesPack | null): DeckProblem[]`.
- Problem keys, messages and severities. Formats read "Standard" and "Expanded". `{name}` is the card's name.

  | key | severity | message |
  |---|---|---|
  | `count:main` | error | `Deck has {n} cards; it needs exactly 60` |
  | `copies:{normalized name}` | error | `{n} × {name}: at most 4 copies of cards with the same name` |
  | `ace` | error | `{n} ACE SPEC cards: at most 1 in a deck` |
  | `radiant` | error | `{n} Radiant Pokémon: at most 1 in a deck` |
  | `basic` | error | `The deck needs at least one Basic Pokémon` |
  | `legal:{cardId}` | error | `{name} isn't legal in {format}` |
  | `banned:{cardId}` | error | `{name} is banned in {format}` |
  | `unsure:{cardId}` | warning | `{name}: several English cards share this name; pin an English printing to check exactly` |

- Rules that need no pack: count and copies. Copies are grouped by `normalCardName`, using the key's `n` when the card has a key and the card's own name otherwise. A group is exempt when every card in it is basic Energy. With no pack, a card counts as basic Energy when `pkmKind` is `E` and the name, after folding, matches `/^(basic )?\w+ energy$/`.
- Rules that need the pack: ace, radiant, basic, legal, banned and unsure.
  - With `unsure`, a card is legal when any candidate is. It is banned only when every candidate is banned. Flags count when any candidate has them.
  - With `none`, the card is not legal.
  - The `copies` key is truncated to `MAX_PROBLEM_KEY`.
- Sort: rank Pokémon 0, Trainer 1, Energy 2, unknown 3, from `pkmKind(card.type)`, then by name as today.

- [ ] **Step 1:** Write failing tests in `pkmCheck.test.ts`. Build a small pack fixture with `buildPkmPack(..., 0)` from inline cards. Then:
  - `a legal 60`: a 60-card deck with a Basic Pokémon gives `[]`, and `checkDeck` gives `status: 'legal'`.
  - `59 and 61 are count errors`.
  - `5 Ultra Ball across two printings is a copies error`, while `20 Fire Energy is fine`. `5 Double Turbo Energy` (Special) is a copies error.
  - `two different ACE SPECs is an ace error`, and `two Radiant Pokémon is a radiant error`.
  - `no Basic Pokémon is a basic error`.
  - `a card with no legal key is a legal error in standard but not in expanded` (a key with `l = 2`).
  - `a banned key is a banned error in expanded only`.
  - `a Japanese Pikachu with two keys, one legal, gives an unsure warning and no legal error`, and the badge reads `Legal · 1 warning`.
  - `no pack: count and copies still run, status unknown`.
  - In `formats.test.ts`: `DECK_FORMATS.pkm` has `standard` and `expanded`, with one section `{id:'main',label:'Deck',min:60,max:60}`, and `decksAvailable('pkm')` is true.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run --maxWorkers=2 tests/shared/decks`. Expected: PASS, with the ygo tests untouched.
- [ ] **Step 5:** Commit `feat(decks): Pokémon Standard and Expanded checks`.

### Task 6: PTCGL import and export

**Files:**
- Create: `src/shared/decks/pokemon/ptcgl.ts`
- Modify: `src/shared/decks/ygo/lists.ts`. Widen `DeckLineRef` with `| { set: string; number: string; name: string }`. Move `ParsedLine`, `ParsedList` and `DeckLineRef` to `src/shared/decks/lists.ts`, and re-export them from `ygo/lists.ts` so existing imports keep working.
- Modify: `src/main/repo/decks.ts`, in `checkRefs` and `resolveDeckLines`.
- Test: `tests/shared/decks/ptcgl.test.ts`, plus cases in `tests/main/decks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function parsePtcgl(text: string): ParsedList   // sectioned: false; every line section 'main'
  export function toPtcgl(entries: DeckEntry[], cards: Record<number, DeckCard>): string
  ```
- Parse rules:
  - A line is `^(\d+)\s+(.+?)\s+([A-Z][A-Z0-9-]{1,7})\s+([A-Z]*\d+[a-z]?)$`, giving `{set, number, name}`. Otherwise `^(\d+)\s+(.+)$` gives `{name}`.
  - Headers (`Pokémon: 12`, `Pokemon: 12`, `Trainer: 36`, `Energy: 12`, `Total Cards: 60`) and blank lines are ignored. Anything else goes in `skipped`.
  - Energy names are normalized before the ref is made:
    - `Basic {X} Energy` becomes `{Type} Energy`, with `{G}` Grass, `{R}` Fire, `{W}` Water, `{L}` Lightning, `{P}` Psychic, `{F}` Fighting, `{D}` Darkness, `{M}` Metal.
    - `Basic Fire Energy` becomes `Fire Energy`.
    - A set of `Energy` or `SVE` on a basic Energy line drops the set and keeps only the name.
- Export: lines `{qty} {name} {set} {number}` from `card.code`. The code `PAL 001/193` gives `PAL 1`, with leading zeros dropped and the part after `/` dropped. A card with no code exports as `{qty} {name}`. Lines are grouped under `Pokémon: N`, `Trainer: N` and `Energy: N` headers in sort order, with `Total Cards: N` at the end.
- Resolver: a `{set, number, name}` ref matches English printings (`language = 'en'`) with `p.set_code LIKE '{set} %' COLLATE NOCASE`. A row matches when the number before any `/`, with leading zeros stripped, equals the ref's number with leading zeros stripped.
  - One card matches: `matched`.
  - None: fall back to the name, limited to cards that have an English printing.
  - Several: `ambiguous`.
  - A `{name}` ref on a pkm scope is also limited to cards with an English printing. Ygo name matching is unchanged.

- [ ] **Step 1:** Write failing tests.
  - In `ptcgl.test.ts`:
    - `4 Pikachu ex SVI 057` → `{set:'SVI', number:'057', name:'Pikachu ex'}`, qty 4.
    - The headers are ignored.
    - `Basic {R} Energy SVE 2`, `Fire Energy SVE 2` and `Basic Fire Energy Energy 2` each give `{name:'Fire Energy'}`.
    - `garbage` goes to skipped.
    - Round trip: `toPtcgl` of 3 entries gives the header lines and `4 Iono PAL 185`.
  - In `decks.test.ts`:
    - `SVI 57` and `SVI 057` both match a card printed `SVI 057/198`.
    - An unknown set falls back to the name.
    - A name shared by two English cards is ambiguous, and a Japanese-only card of the same name is left out.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run --maxWorkers=2 tests/shared/decks tests/main/decks.test.ts tests/portal`. The portal uses the same resolver. Expected: PASS.
- [ ] **Step 5:** Commit `feat(decks): Pokémon TCG Live text import and export`.

### Task 7: Deck screens for Pokémon

**Files:**
- Modify: `src/renderer/src/features/decks/ImportDialog.tsx`. For `pkm`, call `parsePtcgl` with kind `'text'`.
- Modify: `src/renderer/src/features/decks/deckExport.ts` and `ExportMenu.tsx`. For `pkm`, the menu offers only "Copy deck list", which copies `toPtcgl` text.
- Modify: `src/renderer/src/features/decks/DeckAdder.tsx`. For `pkm`, the kind chips are `Pokémon` / `Trainer` / `Energy`, filtered with `pkmKind(c.type)`. Ygo's chips are unchanged.
- Modify: any copy that says "ban list" or Yu-Gi-Oh!-only words on a shared deck screen, reworded per game. Grep `features/decks` for `ban list`, `Extra Deck` and `passcode`.
- Test: `tests/renderer/` deck tests (add cases where a file for that component exists). Otherwise add `tests/renderer/decks/pkmAdder.test.tsx`.

- [ ] **Step 1:** Write failing tests:
  - The adder for `pkm` shows the chips `Pokémon`, `Trainer` and `Energy`, and picking `Trainer` keeps only Trainer results.
  - The export menu for `pkm` has one item, "Copy deck list".
  - The import dialog for `pkm` previews `4 Iono PAL 185` as one line.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run --maxWorkers=2 tests/renderer tests/shared/decks`, `npm run typecheck:web` and `npm run typecheck:phone`. Expected: PASS and clean.
- [ ] **Step 5:** Commit `feat(decks): Pokémon on the deck page, adder, import and export`.

### Task 8: Full check and dry-run size

- [ ] **Step 1:** Run `npx vitest run --maxWorkers=2`. Expected: all pass.
- [ ] **Step 2:** Run `npm run lint`, `npm run typecheck:web`, `npm run typecheck:phone` and `cd workers/portal && npx tsc --noEmit`. Expected: clean.
- [ ] **Step 3:** Build a real pack from TCGdex. With no local cache, fetch the English card list (`https://api.tcgdex.net/v2/en/cards`) plus the full card for ~300 cards in a throwaway script under `/tmp`. Build with `minCards = 0`, gzip it, and scale the size up to the full card count. Record the estimate in the ledger. If it is over 100 KB gzipped, group `ids` by set (`Record<setId, Record<localId, number>>`). Update Task 1's type, parser and tests and Task 4's `keyOfCard` to match. Keep `schema: 1`, since no app has read a pkm pack yet. Then re-measure.
- [ ] **Step 4:** Commit any fixes.

## Release (owner only, not part of execution)

The order is: deploy the portal (it validates the pkm pack on PUT), push main, then run the catalog workflow once by hand so the pack exists, then tag.
