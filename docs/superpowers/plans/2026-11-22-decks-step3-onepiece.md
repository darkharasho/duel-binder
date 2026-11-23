# Decks step 3: One Piece Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Piece decks on every client: a Leader plus 50, checked live against Standard (with block rotation) and Extra Regulation from a hand-kept rules file, with plain-text and OPlay deck code import and export.

**Architecture:** `src/shared/decks/rules/onepiece.json` is the source of the bans, banned pairs, restricted list, rotated blocks and exemptions. The catalog run turns it into `rules/op.json` and uploads it nightly, so `builtAt` stays fresh. Clients check decks with pure functions over that pack and the card facts that `decks:get` already returns (number, card type, colours, cost and block, read from `onepiece_cards`). Import and export reuse step 1's preview and resolver, with a One Piece parser, a card-number ref and an OPlay codec.

**Tech Stack:** TypeScript, vitest (`--maxWorkers=2`), better-sqlite3 (desktop, catalog scripts), Cloudflare Worker (the portal shares `src/main/repo/decks.ts` and `src/shared/decks/fields.ts`), React renderer.

**Spec:** `docs/superpowers/specs/2026-11-22-decks-onepiece-design.md` (this step), parent `docs/superpowers/specs/2026-11-22-decks-design.md`. The parent's "OPlay compatibility" section is the codec's spec.

## Global Constraints

- Game id is `op`. Formats are `standard` ("Standard") and `extra` ("Extra Regulation"), both with `priceRegion: 'en'`.
- Sections, in this order: `{ id: 'leader', label: 'Leader', min: 1, max: 1 }` and `{ id: 'main', label: 'Deck', min: 50, max: 50 }`. `DeckSection` gains `'leader'`.
- At most 4 copies of each card number across the Deck. English and Japanese twins share a number, so they count together.
- Every list in the rules file and pack is keyed by card number (`OP01-016`).
- A rule with `from` later than today is a warning. On `from` itself, or after it, it is an error. Dates are `YYYY-MM-DD`, compared as strings.
- DON!! cards (`opCardType === 'DON!!'`) are ignored on import and can't be added.
- Rules pack path is `rules/op.json` with `game: 'op'` and `schema: 1` (`RULES_SCHEMA` stays 1). Upload with `PUT ${PORTAL_URL}/api/admin/rules/op`. The dry run writes `out/rules-op.json`.
- Problems are errors, except these warnings: `stale`, `soon:*` and `block`.
- Problem keys are at most 64 characters (`MAX_PROBLEM_KEY`).
- The behaviour of every shared file for Yu-Gi-Oh! and Pokémon is unchanged, and their tests pass untouched.
- Run vitest as `npx vitest run --maxWorkers=2 <paths>`. Run `npm run typecheck:web` and `npm run typecheck:phone` separately, because plain `typecheck` stops early.
- Never launch the app against the real profile, and never sign in.

## Review Focus

1. **Twins.** 3 English plus 2 Japanese `OP01-016` is 5 copies, so it's a copies error (Task 4).
2. **A Japanese card with no block icon whose English twin has one.** It takes the twin's block and doesn't add to "Couldn't check the block" (Task 3).
3. **The day a dated rule starts.** On `from` it's an error. The day before, it's a `soon` warning (Task 4).
4. **An OPlay `?deck=123` link.** It shows the "saved on OPlay" message, not "Nothing to import" (Task 6).
5. **A deck with no Leader yet.** The Leader count error is the only Leader-related problem. There's no colour error on every card (Task 4).

---

### Task 1: One Piece pack type, parsing and the rules file

**Files:**
- Modify: `src/shared/decks/pack.ts`
- Create: `src/shared/decks/rules/onepiece.json`
- Create: `src/shared/decks/onepiece/buildPack.ts`
- Test: `tests/shared/decks/pack.test.ts` (add cases), `tests/shared/decks/opBuildPack.test.ts`

**Interfaces:**
- Produces, in `pack.ts`:
  ```ts
  export interface OpBan { card: string; from?: string }
  export interface OpPair { leader: string; cards: string[]; from?: string }
  export interface OpFormatRules {
    banned: OpBan[]
    /** card number → copies allowed */
    restricted: Record<string, number>
    bannedPairs: OpPair[]
  }
  export interface OpRulesPack {
    schema: number; game: 'op'; version: string; builtAt: string
    sources: { name: string; fetchedAt: string }[]
    formats: {
      standard: OpFormatRules & { rotatedBlocks: number[]; exempt: string[] }
      extra: OpFormatRules
    }
    /** Number prefix ("OP01") → block, for cards the catalog has no block icon for */
    setBlocks: Record<string, number>
  }
  export type RulesPack = YgoRulesPack | PkmRulesPack | OpRulesPack
  ```
- Produces, in `onepiece/buildPack.ts`:
  ```ts
  export interface OpRulesFile { asOf: string; source: string; formats: OpRulesPack['formats']; setBlocks: Record<string, number> }
  export function buildOpPack(file: OpRulesFile, builtAt: Date): OpRulesPack
  ```
  - `version` is `file.asOf`.
  - `builtAt` is `builtAt.toISOString()`.
  - `sources` is `[{ name: 'Bandai', fetchedAt: file.asOf }]`.
  - The function throws when `parseRulesPack` of the result isn't `ready`.
- **Ruling:** `banned` holds `{ card, from? }` objects rather than bare numbers, because the spec's `from` applies to bans too (Mihawk). A version that only changes when someone edits `asOf` means a dated rule starting doesn't trigger `verdictChange`. That's accepted.

- [ ] **Step 1: Write failing tests.**
  - In `pack.test.ts`:
    - `parses a valid op pack`: both formats, a dated pair, `setBlocks: {}` → `ready` and `game === 'op'`.
    - `rejects an op pack with a bad date`: `from: '27 Nov'` → `missing`.
    - `rejects an op pack whose restricted count isn't 0–3`: `5` → `missing`.
    - `rejects an op pack missing standard.rotatedBlocks` → `missing`.
    - `rejects an op pack whose card numbers aren't non-empty strings` → `missing`.
  - In `opBuildPack.test.ts`:
    - `version is asOf, builtAt is the run time`.
    - `the shipped onepiece.json builds`: `buildOpPack(file, new Date())` doesn't throw.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/shared/decks/pack.test.ts tests/shared/decks/opBuildPack.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `validOp` in `pack.ts` next to `validPkm`. `parseRulesPack` accepts `game: 'op'`.
- [ ] **Step 4: Write `onepiece.json`.**
  - Before writing, confirm every entry against Bandai's English rules pages:
    - `https://en.onepiece-cardgame.com/rules/` (Banned / Restricted cards, and the Standard format and block icon notes);
    - the PRB-02 reprint list.
  - Record the URLs in `source`. Set `asOf` to `"2026-11-22"`.
  - Contents:
    - **Banned in both formats:**
      - Charlotte Pudding
      - Nami
      - Gecko Moria
      - Trafalgar Law ST10-001
      - Reject
      - Dracule Mihawk OP14-020, `from: "2026-10-12"`
      Use the card numbers Bandai's page gives. If Bandai lists Extra Regulation bans separately, write that list instead.
    - **Banned pairs:**
      - `{ leader: "OP13-001", cards: ["EB05-001"], from: "2026-11-27" }`
      - `{ leader: "OP01-002", cards: ["EB05-001"], from: "2026-11-27" }`
      - I Re-Quasar Helllp! with the Borsalino Leader (since April 2026), with no `from` if it's already in force.
    - **Restricted:** `{}`.
    - **Standard only:** `rotatedBlocks: [1]`, plus `exempt` set to the Block 1 card numbers reprinted in PRB-02.
    - **`setBlocks`:** `{}`. Task 8 decides whether it needs entries.
  - If Bandai's page disagrees with the spec, follow Bandai and say so in the report.
- [ ] **Step 5:** Run the tests again. Expected: PASS, with the ygo and pkm cases unchanged.
- [ ] **Step 6:** Commit `feat(decks): One Piece rules pack type and the hand-kept rules file`.

### Task 2: Upload the pack nightly

**Files:**
- Modify: `scripts/catalog/rules.ts` (the header comment and a `game === 'op'` branch)
- Modify: `.github/workflows/catalog.yml`
- Test: `tests/portal/rulesPack.test.ts` (add a case)

**Interfaces:**
- Consumes: `buildOpPack` and `onepiece.json`.
- CLI: `npm run catalog:rules -- --game op [--dry-run]`. It needs no cache and no network. `publish`'s game type widens to `'ygo' | 'pkm' | 'op'`, and the unknown-game error lists all three.

- [ ] **Step 1:** Write a failing test, `PUT /api/admin/rules/op accepts an op pack and GET serves it`. Also check that `PUT .../rules/op` with a pkm pack answers 400 `bad-pack`.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/portal/rulesPack.test.ts`. Expected: the op case FAILS (parse rejects `op` until Task 1 lands; after Task 1 it may already pass, in which case note that and keep the test).
- [ ] **Step 3:** Implement the script branch. In `catalog.yml`, right after "Flag failed Pokémon rules pack", add "One Piece deck rules pack" (`id: oprules`, `timeout-minutes: 5`, `continue-on-error: true`, `run: npm run catalog:rules -- --game op`, with the same `env` as the pkm step). Then add "Flag failed One Piece rules pack", which sets `CATALOG_PROBLEMS=1` on failure.
- [ ] **Step 4:** Run `npm run catalog:rules -- --game op --dry-run`. Expected: it writes `out/rules-op.json` and prints its sizes. Then run the portal test. Expected: PASS.
- [ ] **Step 5:** Commit `ci(catalog): upload the One Piece deck rules pack nightly`.

### Task 3: Sections, card facts and sort

**Files:**
- Modify: `src/shared/decks/types.ts`. Add `'leader'` to `DeckSection`, and these fields to `DeckCard`:
  ```ts
  /** One Piece only, else null / []: the card number, its card_type, colours, cost and block */
  opNumber: string | null
  opCardType: string | null
  opColors: string[]
  opCost: number | null
  opBlock: number | null
  ```
- Modify: `src/shared/decks/formats.ts` (op formats; `defaultSection` takes `Pick<DeckCard, 'frameType' | 'opCardType'>` and sends `opCardType === 'Leader'` to `'leader'` on `op`)
- Modify: `src/main/repo/decks.ts` (`deckCards()`)
- Modify: `src/shared/decks/sort.ts`
- Modify: every `DeckCard` literal the typecheck flags (renderer, phone, tests' fixtures), using `opNumber: null, opCardType: null, opColors: [], opCost: null, opBlock: null`
- Test: `tests/main/decks.test.ts`, `tests/shared/decks/formats.test.ts`, plus a new `tests/shared/decks/sort.test.ts` if none covers sort

**Interfaces:**
- `deckCards()` adds one query per table when the scope's game is `op`, as the file's comment requires.
  - The first reads `onepiece_cards` for the cards: `number`, `card_type`, `colors` (a JSON array), `cost`.
  - The second gives `opBlock` as `MAX(block_icon)` over every `onepiece_cards` row with the same `number`. That way a twin with no block icon takes the other's.
- **Ruling:** `opCost` is added beyond the spec's four fields, because the spec's sort orders by cost.
- Sort for `op`:
  - rank: Leader 0, Character 1, Event 2, Stage 3, anything else 4, from `opCardType`;
  - then `opCost` ascending, with null last;
  - then `opNumber`, then name, then id.
  - ygo and pkm sorting is unchanged.

- [ ] **Step 1: Write failing tests.**
  - In `decks.test.ts`, `deckCards gives an op card its number, type, colours, cost and block`:
    - Seed English `OP01-016` with `block_icon = 1`, and a Japanese twin `OP01-016` with `block_icon` NULL.
    - Both get `opBlock: 1` and `opColors: ['Red']`.
    - A pkm card gets `opNumber: null, opColors: []`.
  - In `formats.test.ts`:
    - `DECK_FORMATS.op` has `standard` and `extra` with the two sections above, in order.
    - `decksAvailable('op')` is true.
    - `defaultSection('op', {frameType:'op', opCardType:'Leader'})` is `'leader'`, and for a Character it's `'main'`.
  - In the sort test: a Stage, an Event costing 1, a Character costing 3, a Character costing 1 and a Leader sort as Leader, Character 1, Character 3, Event 1, Stage.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run --maxWorkers=2 tests/main/decks.test.ts tests/shared/decks tests/portal`, then `npm run typecheck:web` and `npm run typecheck:phone`. Expected: PASS and clean.
- [ ] **Step 5:** Commit `feat(decks): One Piece sections, card facts and sort`.

### Task 4: One Piece checks

**Files:**
- Create: `src/shared/decks/onepiece/check.ts`
- Modify: `src/shared/decks/check.ts`:
  - Add a `deck.game === 'op'` branch like pkm's, including the stale warning "The rules here are from {date} and may be out of date".
  - Add `'leader'`, `'color'`, `'pair'`, `'rotated'`, `'soon'` and `'block'` to `rank()`, right after `'limit'`.
- Test: `tests/shared/decks/opCheck.test.ts`

**Interfaces:**
- Consumes: `OpRulesPack` and the `DeckCard` op fields.
- Produces:
  ```ts
  export function checkOp(deck: Pick<WireDeck,'format'|'cards'>, format: DeckFormat, cards: Record<number, DeckCard>, pack: OpRulesPack | null, today: string): DeckProblem[]
  /** Per-card notes that aren't problems: an exempt Block 1 card in Standard. */
  export function opCardNotes(deck: Pick<WireDeck,'format'|'cards'>, cards: Record<number, DeckCard>, pack: OpRulesPack | null): Record<number, string>
  ```
- In the table below:
  - "The Leader" is the first Leader-type card in the `leader` section.
  - `{num}` is `opNumber`, falling back to the card id when null.
  - Dates in messages read like `Nov 27`: `toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })`.

  | key | severity | message | needs pack |
  |---|---|---|---|
  | `count:leader` | error | `Leader has {n} cards; it needs exactly 1` | no |
  | `count:main` | error | `Deck has {n} cards; it needs exactly 50` | no |
  | `leader:{cardId}` | error | `{name} isn't a Leader` (a non-Leader in the Leader section) | no |
  | `place:{cardId}` | error | `{name} is a Leader; it goes in the Leader slot` (a Leader in Deck) | no |
  | `copies:{num}` | error | `{n} × {name} ({num}): at most 4 copies of each card` | no |
  | `color:{cardId}` | error | `{name} doesn't share a colour with {leader name}` | no |
  | `banned:{num}` | error | `{name} is banned in {format}` | yes |
  | `pair:{num}` | error | `{name} can't be used with {leader name}` | yes |
  | `limit:{num}` | error | `{n} × {name}: at most {k} in {format}` | yes |
  | `rotated:{cardId}` | error | `{name} is from Block {b}, which has left Standard` | yes |
  | `soon:{num}` | warning | `{name} is banned from {date}`, or for a pair `{name} can't be used with {leader name} from {date}` | yes |
  | `block` | warning | `Couldn't check the block of {n} cards` | yes |

- Rules:
  - The colour check is skipped when there's no Leader, or the Leader's `opColors` is empty. A card with empty `opColors` is skipped as well.
  - Copies and restricted counts sum across both sections, grouped by number.
  - In Standard:
    - The block is `opBlock`, else `pack.setBlocks[num.split('-')[0]]`.
    - A block in `rotatedBlocks` whose number isn't in `exempt` is `rotated`.
    - An unknown block counts toward `block`, counting copies, not distinct cards.
  - Extra has no block checks.
  - `opCardNotes` gives exempt cards in Standard `Use the PRB-02 printing in Standard`.
  - Cards missing from `cards` are skipped by every per-card rule.

- [ ] **Step 1: Write failing tests.** Use a small inline pack built with `buildOpPack`, and `today = '2026-11-22'`.
  - `a legal Leader + 50 gives [] and status legal`.
  - `49 in Deck is count:main`, and `an empty Leader is count:leader only` (Review Focus 5).
  - `a Character in Leader is leader:, a Leader in Deck is place:`.
  - `3 English + 2 Japanese OP01-016 is copies:OP01-016` (Review Focus 1).
  - `a Blue card under a Red Leader is color:`, while `a Red/Blue card under a Red/Green Leader is fine`.
  - `a banned number is banned: in both formats`.
  - `Bonney under Luffy OP13-001 is soon: before 2026-11-27 and pair: on 2026-11-27` (Review Focus 3, two `today` values). Under another Leader it's fine.
  - `a restricted 1 with 2 copies is limit:`.
  - `Block 1 card is rotated: in standard, fine in extra`, and `an exempt Block 1 card is fine with a note from opCardNotes`.
  - `a card with null opBlock uses setBlocks`, and with no entry it adds to the `block` warning, giving the badge `Legal · 1 warning`.
  - `no pack: counts, placement, copies and colours still run; status unknown`.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/shared/decks/opCheck.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run --maxWorkers=2 tests/shared/decks`. Expected: PASS, with the ygo and pkm tests untouched.
- [ ] **Step 5:** Commit `feat(decks): One Piece Standard and Extra Regulation checks`.

### Task 5: Plain-text import and export

**Files:**
- Create: `src/shared/decks/onepiece/text.ts`
- Modify: `src/shared/decks/lists.ts`. `DeckLineRef` gains `| { opNumber: string; name: string }`, with `name` set to `''` when the line has none.
- Modify: `src/main/repo/decks.ts` (`checkRefs` and `resolveDeckLines`)
- Test: `tests/shared/decks/opText.test.ts`, plus cases in `tests/main/decks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const OP_CODE = /[A-Za-z]{1,5}\d{0,3}-\d{1,4}[A-Za-z0-9_]*/
  export function parseOpText(text: string): ParsedList   // sectioned: false; every line section 'main'
  export function toOpText(entries: DeckEntry[], cards: Record<number, DeckCard>): string
  ```
- Parsing:
  - It accepts every form in the parent spec: `4xOP13-086`, `4x OP13-086 Sabo`, `4 × OP13-086 - Sabo`, `OP13-086 x4` and `OP13-086` (1 copy), with the separators `x`, `×`, `*` and `·`.
  - The code is upper-cased. The trailing name, trimmed of a leading `-`, becomes `name`.
  - Lines containing `DON!!` (case-insensitive), blank lines and `#`/`//` comments are ignored. Anything else goes to `skipped`.
- Export:
  - Leader entries come first, then the Deck in `sortEntries('op', …)` order.
  - Each line is `{qty}x{opNumber}`, or `{qty}x{name}` when `opNumber` is null.
  - Lines are joined with `\n`.
- Resolving an `opNumber` ref on an `op` scope:
  - Look the number up in `onepiece_cards.number`, ignoring case.
  - Of the cards found, pick the lowest id among those with an English printing, else the lowest id. That's `matched`, never `ambiguous`, because twins share the rules.
  - With no hit and a non-empty `name`, fall back to the name. With neither, it's `unmatched`.
  - An `opNumber` ref on another game is `unmatched`.
  - `checkRefs` accepts the new shape, with the number at most 32 characters and the name at most the existing name limit.

- [ ] **Step 1: Write failing tests.**
  - In `opText.test.ts`:
    - Each of the five line forms parses to the right qty and `opNumber`.
    - `10xDON!!` is ignored, not skipped.
    - `hello` is skipped.
    - Round trip: `toOpText` of a Leader plus 2 entries gives `1xOP01-001\n4xOP01-016\n…`, with the Leader first.
  - In `decks.test.ts`:
    - `OP01-016` with English and Japanese twins matches the English card.
    - A Japanese-only number matches the Japanese card.
    - An unknown number named `Sabo` falls back to the name.
    - An `opNumber` ref on a ygo scope is unmatched.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run --maxWorkers=2 tests/shared/decks tests/main/decks.test.ts tests/portal`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(decks): One Piece text deck lists`.

### Task 6: OPlay deck codes and share links

**Files:**
- Create: `src/shared/decks/onepiece/oplay.ts`
- Create: `tests/fixtures/decks/op/oplay-codes.json` (`[{ code, leader, entries }]`)
- Modify: `src/shared/decks/onepiece/text.ts`. Add `parseOpList(text)`, which tries the link, then the code, then falls back to `parseOpText`.
- Test: `tests/shared/decks/oplay.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface OplayDeck { leader: string | null; entries: { code: string; qty: number }[] }
  export class OplayError extends Error {}
  export function decodeOplay(code: string): OplayDeck          // v1 or v2; throws OplayError on a bad check char or malformed payload
  export function encodeOplayV2(deck: OplayDeck): string        // entries sorted by code ascending, per the spec
  export function oplayLink(code: string): string               // `https://oplaytcg.com/en/deck-builder?d=${code}`
  export function parseOpList(text: string): ParsedList
  ```
- `parseOpList` works in this order:
  - A URL with `?deck=<digits>` throws `OplayError("That link points to a deck saved on OPlay. Open it there and copy its deck code or share link instead.")`.
  - A URL with `?d=` decodes that parameter.
  - Otherwise, if the trimmed text is a single token starting with `1` or `2` that decodes, use it.
  - Otherwise fall back to `parseOpText`.
  - A decoded code gives `sectioned: true`, with the Leader line in `'leader'` and the rest in `'main'`, and `{ opNumber, name: '' }` refs.
- The bit layout, check character, prefix table (`OP, ST, EB, PRB, P`), custom prefix and raw form are exactly as in the parent spec's "Deck code v2" bullets. v1 is `1` + base64url(`LEADER|4xOP01-016,…`).

- [ ] **Step 1: Make the fixtures.**
  - Fetch the OPlay deck builder (`https://oplaytcg.com/en/deck-builder`) and find its deck code module in the JS bundle.
  - Put the bundle in its own new directory under `/tmp`. Write the extraction script in a different directory, and run node there on the extracted functions only.
  - Use OPlay's own encoder to make 5 codes:
    - a plain Leader + 50;
    - one with ST and EB cards;
    - one with a PRB card;
    - one with a P promo;
    - one with a qty-1 card after a same-set run.
  - Write them to the fixture with their decoded decks.
  - If the bundle can't be reached or read, write the fixtures from our own encoder, and record in the report that they aren't from OPlay.
- [ ] **Step 2: Write failing tests.**
  - Every fixture decodes to its deck.
  - `encodeOplayV2(decodeOplay(c))` round-trips each deck. Compare decks, not strings, unless the fixture came from OPlay, in which case the strings must match too.
  - A changed check character throws `OplayError`.
  - A v1 code decodes.
  - `parseOpList` behaviour:
    - It reads a `?d=` share link.
    - A `?deck=123` link throws with the message above (Review Focus 4).
    - A plain list still parses as text.
- [ ] **Step 3:** Run `npx vitest run --maxWorkers=2 tests/shared/decks/oplay.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run the test again. Expected: PASS.
- [ ] **Step 6:** Commit `feat(decks): OPlay deck codes and share links`.

### Task 7: Deck screens for One Piece

**Files:**
- Modify: `src/renderer/src/features/decks/ImportDialog.tsx`:
  - For `op`, call `parseOpList` with the preview kind `'text'`.
  - Placeholder: `Paste a deck list, an OPlay deck code or share link`.
  - Accept `.txt`.
  - An `OplayError` shows its message as the read error.
- Modify: `src/renderer/src/features/decks/deckExport.ts` and `ExportMenu.tsx`:
  - `ExportKind` gains `'oplay' | 'oplayLink'`.
  - For `op`, the menu offers "Copy deck list" (`toOpText`), "Copy OPlay deck code" and "Copy OPlay link".
  - The code is built from the Leader entry's and the Deck entries' `opNumber`. Entries with none are left out, and the toast says how many were left out.
- Modify: `src/renderer/src/features/decks/DeckAdder.tsx`:
  - For `op`, the chips are `Character` / `Event` / `Stage`, plus one chip per colour of the deck's Leader, which `DeckPage` passes in as `leaderColors: string[]`.
  - Chips filter with the browse filters `opCardTypes` and `opColors`.
  - With no type chip on, `opCardTypes` is `['Leader','Character','Event','Stage']`, so DON!! never shows.
  - The ygo and pkm chips are unchanged.
- Modify: `src/renderer/src/features/decks/DeckPage.tsx` and `DeckSection.tsx`:
  - The Leader section shows as a one-card section, above the Deck.
  - `opCardNotes` notes show in `ProblemsBar` after the problems, in muted text. They aren't counted in the badge.
- Test: `tests/renderer/decks.test.tsx` (add cases)

- [ ] **Step 1: Write failing tests.**
  - The adder for `op` shows `Character`, `Event` and `Stage`, plus `Red` when the Leader is Red. Picking `Event` calls browse with `opCardTypes: ['Event']`.
  - The op export menu has the three items.
  - The op import dialog previews `1xOP01-001\n4xOP01-016` with the Leader placed in Leader.
  - A `?deck=1` link shows the OPlay message.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/renderer/decks.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run --maxWorkers=2 tests/renderer tests/shared/decks`, `npm run typecheck:web` and `npm run typecheck:phone`. Expected: PASS and clean.
- [ ] **Step 5:** Commit `feat(decks): One Piece on the deck page, adder, import and export`.

### Task 8: Full check and block coverage

- [ ] **Step 1:** Run `npx vitest run --maxWorkers=2`. Expected: all pass.
- [ ] **Step 2:** Run `npm run lint`, `npm run typecheck:web`, `npm run typecheck:phone` and `cd workers/portal && npx tsc --noEmit`. Expected: clean.
- [ ] **Step 3: Block coverage.**
  - Fetch Bandai's English card list for one Block 1 set and one recent set (`https://en.onepiece-cardgame.com/cardlist/?series=<id>`).
  - Run them through `scripts/catalog/onepiece/bandai.ts`'s parser in a throwaway script under `/tmp`, and count the cards with a null `block`.
  - If more than a handful lack it, fill `setBlocks` in `onepiece.json` for every set prefix, from Bandai's block table. Re-run Task 1's tests.
  - Record the counts in the ledger.
- [ ] **Step 4:** Commit any fixes.

## Release (owner only, not part of execution)

1. Deploy the portal. An old portal rejects the `op` pack and any deck with a `leader` section, and a rejected op deck fails the whole decks push.
2. Push main.
3. Run the catalog workflow once by hand so `rules/op.json` exists.
4. Tag.
