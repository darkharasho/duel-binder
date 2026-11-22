# Decks, Step 1 (Core plus Yu-Gi-Oh!) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Decks section for Yu-Gi-Oh! on desktop, phone and web. People can build, import, export and sync decks, with live legality feedback from a nightly rules pack, plus missing cards and the cost to finish.

**Architecture:** Deck rules and checks are pure TypeScript in `src/shared/decks/`, run on the device against a per-game rules pack. The nightly catalog run builds the pack and the portal serves it from R2 through the edge cache. Decks are one row per uid with the card list serialized on the row. They sync whole-row, latest edit wins, exactly as graded copies (slabs) do today. The same repo code runs in three places: the desktop's SQLite, the phone app's local SQLite (via `DATA_CHANNELS`), and the portal DO for the web (via `rpc.ts` with `userScope`).

**Tech Stack:** Electron + React + TypeScript (Vite), better-sqlite3 / sqlite-wasm / DO SQLite, Cloudflare Worker + R2, vitest, @tanstack/react-query, Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-11-22-decks-design.md`. Read it first; this plan argues from it.

## Global Constraints

- Limits: 200 decks per owner per game, 300 entries per deck, an 80-character name, 2,000-character notes. Entry qty is 1–99 (Claude's call).
- Yu-Gi-Oh! formats: `advanced` ("Advanced (TCG)") and `ocg` ("OCG"). Sections: Main 40–60, Extra 0–15, Side 0–15. Max 3 copies by card id across all three sections. Forbidden 0, Limited 1, Semi-Limited 2.
- Extra Deck monsters are frame types `fusion`, `synchro`, `xyz`, `link`, `fusion_pendulum`, `synchro_pendulum`, `xyz_pendulum`. They go only in Extra or Side, and nothing else goes in Extra.
- Errors make a deck "Not legal". Warnings don't: a card not yet out in the format's region, and a pack older than 14 days. Badge copy is exactly: `Legal`, `Legal · 1 warning` / `Legal · N warnings`, `Not legal`, `Legality unknown`, `Update to check legality`.
- With no pack loaded, a deck is never shown as Legal.
- A deck can always be saved, even when it's illegal.
- Clients refetch the pack once it is older than 24 h.
- `last_verdict` / `last_pack_version` are per device and never synced.
- Card ids are the catalog's `cards.id`, the same on every device. A pinned printing is a `pkey`.
- Never add weight to the catalog pull. The pack is its own file.
- SQL `IN` lists over card ids go through `json_each(?)`, never one bound parameter per id (DO rejects over 100 parameters; see memory `community-search`).
- Tests: `npm test` (already `--maxWorkers=2`). No synthetic data over a few hundred rows (`no-heavy-test-data`). Before pushing, run `npm run typecheck:node`, `npm run typecheck:web` and `npm run typecheck:phone` separately (`local-typecheck-gap`), plus `npm run lint`.
- Schema numbers: today the next free numbers are desktop `53` and `server-53`. Re-check `src/main/db/schema.ts` / `workers/portal/src/migrate.ts` on `origin/main` before writing the migration, and take the next free ones.
- Release: deploy the portal (fresh worktree, `npm ci`, `npm run deploy`) before tagging.
- Work in a worktree off `origin/main`, never the shared checkout (`shared-checkout-commits`).

## Review Focus

1. **A deck entry whose card this device's catalog doesn't have** (a fresh phone mid-download, or a card that has since left the catalog). The entry stays in the deck and is never dropped on save. It shows as "Card #<id> isn't in the catalog here yet" and exports by its id. Copy counting still includes it; placement checks skip it. Tests are in Tasks 1, 2 and 6.
2. **Messy pasted text lists**: `3x Name`, `Name x3`, bullets, CRLF, blank lines, `Main Deck (40):` style headers, curly quotes (`Maxx “C”`), and trailing set codes or rarities in brackets. Every line ends up matched, ambiguous or unmatched; none disappears. Tests are in Tasks 3 and 6.
3. **`.ydk` / `ydke://` with alternate-art passcodes** (e.g. Dark Magician `36996508`). These resolve to the base card, with no unmatched line. The test is in Task 6.
4. **A failed pack fetch with a cached pack, a corrupt pack, or a pack with a newer schema.** The cached pack is kept; with none, the status is `unknown`. A newer schema gives `update`. None of these ever reads Legal. Tests are in Tasks 2 and 5.
5. **Two devices editing one deck offline.** The newer `updated_at` wins the whole deck, the losing device takes the server copy, and neither device's `last_verdict` is touched by sync. The test is in Task 8.

---

## File Structure

**Shared (pure, no I/O):**
- `src/shared/decks/types.ts`: deck, entry, card-fact, verdict and wire types.
- `src/shared/decks/formats.ts`: per-game formats and sections; `decksAvailable(game)`.
- `src/shared/decks/fields.ts`: limits and `checkDeckFields` validation.
- `src/shared/decks/pack.ts`: the rules pack types, `RULES_SCHEMA`, `parseRulesPack`.
- `src/shared/decks/check.ts`: `checkDeck` dispatcher, badge, `verdictChange`.
- `src/shared/decks/ygo/check.ts`: the Yu-Gi-Oh! rules.
- `src/shared/decks/ygo/lists.ts`: `.ydk` / `ydke://` / text parse and export.
- `src/shared/decks/ygo/buildPack.ts`: YGOPRODeck cards → pack (pure).
- `src/shared/decks/rulesCache.ts`: `loadRulesPack` with a storage adapter.
- `src/shared/decks/sort.ts`: default in-section order.

**Desktop/phone/portal data (one repo, three hosts):**
- `src/main/db/schema.ts` (+V53), `workers/portal/src/migrate.ts` (+server-53).
- `src/main/repo/scope.ts` (+`decks` scoping), `workers/portal/src/scope.ts` (+`NEXT_DECK_SEQ`, `decks`).
- `src/main/repo/decks.ts`: list/get/save/remove/markSeen/resolve.
- `workers/portal/src/decks.ts`: push validation, push apply, pull.
- `src/main/cloud/localSync.ts`, `engine.ts`, `client.ts`, `src/shared/cloud.ts`: sync.
- `workers/portal/src/sync.ts`, `merge.ts`, `account.ts`: routes and the account merge.
- `src/main/ipc/dataHandlers.ts`, `handlers.ts`, `src/shared/ipc.ts`, `src/shared/portal.ts`, `workers/portal/src/rpc.ts`, `src/renderer/src/web/httpApi.ts`, `src/phone/api.ts`, `src/phone/data/store.ts`: channels.

**Rules pack pipeline:**
- `scripts/catalog/rules.ts` (+ `package.json` `catalog:rules`, `.github/workflows/catalog.yml` step).
- `workers/portal/src/rulesPack.ts`, wired in `workers/portal/src/index.ts`.

**UI (`src/renderer/src/features/decks/`):** `DecksPage.tsx`, `DeckTile.tsx`, `NewDeckDialog.tsx`, `DeckPage.tsx`, `DeckSection.tsx`, `DeckSearch.tsx`, `FeedbackPanel.tsx`, `ImportDialog.tsx`, `ExportMenu.tsx`, `AddToDeck.tsx`, `useRulesPack.ts`. Plus nav in `AppShell.tsx`, `pageSwitch.tsx`, `src/phone/PhoneShell.tsx` and `features/friends/FriendHeader.tsx`, and `lib/api.ts` query keys.

**Tests:** `tests/shared/decks/*.test.ts`, `tests/fixtures/decks/ygo/*`, `tests/main/decks.test.ts`, `tests/main/deckSync.test.ts`, `tests/portal/rulesPack.test.ts`, `tests/renderer/decks.test.tsx`.

---

### Task 1: Deck model, formats and field checks

**Files:**
- Create: `src/shared/decks/types.ts`, `src/shared/decks/formats.ts`, `src/shared/decks/fields.ts`
- Test: `tests/shared/decks/fields.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export type DeckSection = 'main' | 'extra' | 'side'        // later games widen this union
  export interface DeckEntry { section: DeckSection; card: number; printing?: string; qty: number }
  export interface DeckFields { format: string; name: string; notes: string; cover: number | null; private: boolean; cards: DeckEntry[] }
  export interface DeckDraft extends DeckFields { uid?: string }
  /** What the checks and the screens need of one card; absent from the map = not in this catalog. */
  export interface DeckCard { id: number; name: string; type: string; frameType: string; imageId: number | null; owned: number; price: number | null; regionPrice: number | null }
  export interface DeckVerdictMark { status: VerdictStatus; problems: string[]; packVersion: string }
  export interface DeckSummary { uid: string; game: GameId; format: string; name: string; private: boolean; coverImageId: number | null; cards: DeckEntry[]; createdAt: string; updatedAt: string; lastSeen: DeckVerdictMark | null }
  export interface DeckList { decks: DeckSummary[]; cardFacts: Record<number, DeckCard> }
  export interface DeckDetail extends DeckSummary { notes: string; cover: number | null; cardFacts: Record<number, DeckCard>; printingArt: Record<string, number> }
  export type VerdictStatus = 'legal' | 'warnings' | 'illegal' | 'unknown' | 'update'
  export interface WireDeck { uid: string; game: GameId; format: string; name: string; notes: string; cover: number | null; private: boolean; cards: DeckEntry[]; createdAt: string; updatedAt: string; deletedAt: string | null }
  // formats.ts
  export interface SectionDef { id: DeckSection; label: string; min: number; max: number }
  export interface DeckFormat { id: string; label: string; sections: SectionDef[]; priceRegion: 'en' | 'asia' }
  export const DECK_FORMATS: Record<GameId, readonly DeckFormat[]>   // ygo: advanced, ocg; others: []
  export function formatOf(game: GameId, id: string): DeckFormat | null
  export function decksAvailable(game: GameId): boolean
  // fields.ts
  export const MAX_DECKS_PER_GAME = 200, MAX_DECK_ENTRIES = 300, MAX_DECK_NAME = 80, MAX_DECK_NOTES = 2000, MAX_ENTRY_QTY = 99
  export class DeckFieldError extends Error {}
  export function checkDeckFields(o: Record<string, unknown>, game: GameId): DeckFields
  ```
- Section labels: `Main Deck`, `Extra Deck`, `Side Deck`. Advanced has `priceRegion: 'en'`; OCG has `'asia'`.

- [ ] **Step 1: Write the failing tests** in `tests/shared/decks/fields.test.ts`:
  - `accepts a full Yu-Gi-Oh! deck and trims the name`: `checkDeckFields({ format: 'advanced', name: '  Snake-Eye  ', notes: '', cover: null, private: false, cards: [{ section: 'main', card: 14558127, qty: 3 }] }, 'ygo')` returns `name === 'Snake-Eye'`.
  - `merges repeated entries for the same section, card and printing`: two `{main, 14558127, qty 1}` give one entry with `qty 2`. The same card with a different `printing` stays a separate entry.
  - `rejects bad fields`: each of these throws `DeckFieldError`: empty name; an 81-char name; 2,001-char notes; an unknown format `'goat'`; section `'extra'` on a game whose format lacks it (use `'pkm'` with any format, which throws "unknown format" since `DECK_FORMATS.pkm` is empty); qty `0`, `100`, `1.5`; card `-1`; 301 entries; a `printing` that is non-string or over 64 chars.
  - `keeps an entry whose card is unknown to this catalog`: card `99999999` passes, since fields never look at the catalog.
  - `decksAvailable is true only for ygo in step 1`.

- [ ] **Step 2: Run and see them fail.** Run `npm test -- tests/shared/decks/fields.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** the three files with the interfaces above. `checkDeckFields` validates, trims the name, and merges entries in first-seen order. It counts entries after merging for the 300 limit.

- [ ] **Step 4: Run and see them pass.** Run the same command. Expected: PASS.

- [ ] **Step 5: Commit.** `git add src/shared/decks tests/shared/decks && git commit -m "feat(decks): deck model, formats and field checks"`

---

### Task 2: Rules pack types and Yu-Gi-Oh! checks

**Files:**
- Create: `src/shared/decks/pack.ts`, `src/shared/decks/check.ts`, `src/shared/decks/ygo/check.ts`
- Test: `tests/shared/decks/ygoCheck.test.ts`, `tests/shared/decks/pack.test.ts`

**Interfaces:**
- Consumes: Task 1 types and `formatOf`.
- Produces:
  ```ts
  // pack.ts
  export const RULES_SCHEMA = 1
  export interface YgoFormatRules {
    /** card id → copies allowed (0 Forbidden, 1 Limited, 2 Semi-Limited); absent = 3 */
    limits: Record<string, 0 | 1 | 2>
    /** card id → its release date in the region (YYYY-MM-DD), or null when none is known; only cards not out by builtAt */
    notReleased: Record<string, string | null>
  }
  export interface YgoRulesPack { schema: number; game: 'ygo'; version: string /* YYYY-MM-DD */; builtAt: string; sources: { name: string; fetchedAt: string }[]; formats: { advanced: YgoFormatRules; ocg: YgoFormatRules } }
  export type RulesPack = YgoRulesPack
  export type PackState = { state: 'ready'; pack: RulesPack } | { state: 'missing' } | { state: 'tooNew' }
  export function parseRulesPack(raw: unknown): PackState   // malformed → missing; schema > RULES_SCHEMA → tooNew
  // check.ts
  export interface DeckProblem { key: string; severity: 'error' | 'warning'; message: string; cardId?: number; section?: DeckSection }
  export interface DeckVerdict { status: VerdictStatus; badge: string; problems: DeckProblem[]; packVersion: string | null }
  export function checkDeck(deck: Pick<WireDeck, 'game' | 'format' | 'cards'>, cards: Record<number, DeckCard>, pack: PackState, today: string): DeckVerdict
  export function verdictMark(v: DeckVerdict): DeckVerdictMark | null          // null when packVersion is null
  export function verdictChange(seen: DeckVerdictMark | null, v: DeckVerdict): { version: string; added: DeckProblem[]; cleared: string[] } | null
  ```
- Problem keys (stable, used by `verdictChange`): `count:<section>`, `copies:<id>`, `limit:<id>`, `place:<id>:<section>`, `region:<id>`, `stale`.
- Status: any error → `illegal`. Otherwise `missing` → `unknown`, `tooNew` → `update`, warnings → `warnings`, else `legal`. Pack-free rules (counts, copies over 3, placement) always run.
- `verdictChange` is non-null only when `seen` exists, `seen.packVersion !== v.packVersion`, and `seen.status`'s legal-ness (`legal`/`warnings` vs `illegal`) differs from `v.status`'s. `added` = problems whose key wasn't in `seen.problems`.

- [ ] **Step 1: Write the failing tests** (`ygoCheck.test.ts`). Build a fixture `cards` map (Ash Blossom `14558127` effect, Pot of Greed `55144522` spell, Borreload Dragon `31833038` link, Maxx "C" `23434538` effect, a pendulum-xyz) and a fixture pack whose `advanced.limits` holds `{ 55144522: 0, 23434538: 0 }`, whose `ocg.limits` holds `{ 23434538: 1 }`, and whose `advanced.notReleased` holds `{ 77777777: '2026-12-05' }`. Use `today = '2026-11-22'` and pack version `'2026-11-22'`. Each test asserts the exact `message`:
  - `main under 40`: "Main Deck has 38 cards; it needs at least 40" (error, key `count:main`).
  - `main over 60`: "Main Deck has 62 cards; the limit is 60".
  - `extra and side over 15`: "Extra Deck has 16 cards; the limit is 15" and the same for "Side Deck".
  - `four copies across sections`: 2 Main + 2 Side Ash gives "4 × Ash Blossom & Joyous Spring: at most 3 copies across Main, Extra and Side".
  - `forbidden`: 3 Pot of Greed in advanced gives "3 × Pot of Greed: Forbidden in Advanced".
  - `limited by format`: 2 Maxx "C" in OCG gives "2 × Maxx "C": Limited to 1 in OCG". The same deck in Advanced reads "Forbidden in Advanced". Semi-Limited reads "Semi-Limited to 2 in <format label>".
  - `extra monster in main`: "Borreload Dragon is a Link Monster and belongs in the Extra Deck", key `place:31833038:main`. Name the kind by frame type: Fusion, Synchro, Xyz, Link, Pendulum Fusion/Synchro/Xyz.
  - `main-deck card in extra`: "Ash Blossom & Joyous Spring can't go in the Extra Deck".
  - `extra monster in side is fine`.
  - `not out yet is a warning`: "<name> comes out in the TCG on 2026-12-05". A null date reads "<name> isn't out in the TCG yet". For OCG, say "in the OCG". The status is `warnings` and the badge is "Legal · 1 warning".
  - `stale pack is a warning`: pack builtAt 15 days before today gives "The ban list here is from 2026-11-07 and may be out of date" (key `stale`).
  - `legal deck`: 40 Main and 15 Extra, all fine: status `legal`, badge `Legal`.
  - `no pack never reads Legal`: the legal deck with `{state:'missing'}` gives `unknown` / "Legality unknown". With an error present it stays `illegal`.
  - `newer pack schema`: `{state:'tooNew'}` gives `update` / "Update to check legality".
  - `unknown card` (Review Focus 1): an entry `99999999` absent from `cards` counts toward Main's total and copy limits, but gets no placement problem.
  - `verdictChange names what flipped`: seen `{status:'legal', problems:[], packVersion:'2026-11-01'}` against a verdict with `limit:23434538` at pack `'2026-12-01'` gives `{ version: '2026-12-01', added: [that problem] }`. The same pack version gives `null`.
- `pack.test.ts`: `parseRulesPack` returns `missing` for `null`, `'x'`, `{schema:1}` (no formats), and a pack whose `limits` value is `5`. It returns `tooNew` for `{schema: 2, ...}` and `ready` for the fixture.

- [ ] **Step 2: Run and see them fail.** Run `npm test -- tests/shared/decks`. Expected: FAIL.

- [ ] **Step 3: Implement.** `check.ts` dispatches on `deck.game` to `ygo/check.ts`: `checkYgo(deck, format, cards, rules: YgoFormatRules | null, today): DeckProblem[]`. It adds `stale` when `daysBetween(pack.builtAt, today) > 14`. Use a card's `name` from `cards`, falling back to `Card #<id>`.

- [ ] **Step 4: Run and see them pass.** Run the same command. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(decks): rules pack types and Yu-Gi-Oh! legality checks"`

---

### Task 3: Yu-Gi-Oh! list formats (parse and export)

**Files:**
- Create: `src/shared/decks/ygo/lists.ts`, `src/shared/decks/sort.ts`
- Create fixtures: `tests/fixtures/decks/ygo/yugiohprodeck.ydk`, `edopro.ydk`, `ydke.txt`, `paste-discord.txt`, `paste-headers.txt` (copy real exports, each under 70 lines. The `.ydk` files come from a YGOPRODeck deck download and an EDOPro deck folder. Include one alternate-art passcode, `36996508`. The paste files come from a Discord or Reddit list using `3x` and `x3`, bullets, curly quotes and a `(40)` header.)
- Test: `tests/shared/decks/ygoLists.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DeckLineRef = { passcode: number } | { setCode: string } | { name: string }
  export interface ParsedLine { line: number; raw: string; section: DeckSection; qty: number; ref: DeckLineRef }
  export interface ParsedList { lines: ParsedLine[]; skipped: { line: number; raw: string }[] }   // skipped = non-empty, non-comment lines it couldn't read
  export function detectYgoList(text: string): 'ydk' | 'ydke' | 'text'
  export function parseYgoList(text: string): ParsedList
  export function toYdk(entries: DeckEntry[]): string        // "#created by Duel Binder\n#main\n…\n#extra\n…\n!side\n…"
  export function toYdke(entries: DeckEntry[]): string       // ydke://<main>!<extra>!<side>!
  export function toYgoText(entries: DeckEntry[], cards: Record<number, DeckCard>): string
  // sort.ts
  export function sortEntries(game: GameId, entries: DeckEntry[], cards: Record<number, DeckCard>): DeckEntry[]
  ```
- `ydke` sections are base64 of little-endian uint32 passcodes, one per copy. `.ydk` gives one passcode per copy; the parser collapses repeats into qty. Text lines take `N Name`, `Nx Name`, `Name xN` or `Name` (qty 1), and drop a trailing `(…)`/`[…]` holding a set code or rarity. Bullets `-*•` are stripped. Headers (case-insensitive, optional count and colon) are `main`/`main deck`, `extra`/`extra deck`, `side`/`side deck`/`sideboard`. Curly quotes become straight before the name goes into `ref`.
- Text export format:
  ```
  Main Deck (40)
  3 Ash Blossom & Joyous Spring

  Extra Deck (15)
  …

  Side Deck (15)
  …
  ```
  An empty section is left out. A card missing from `cards` is written as `N #<id>`, and the text parser reads `#<id>` back as `{passcode}`.
- `sortEntries` for ygo: monsters, then spells, then traps (by `type`), then name. Unknown cards go last.

- [ ] **Step 1: Write the failing tests:**
  - `reads each fixture`: assert each fixture's total qty per section, e.g. the YGOPRODeck `.ydk` gives `main` 40, `extra` 15, `side` 15 (use the fixture's real numbers), with `skipped` empty.
  - `round-trips ydk and ydke`: `parseYgoList(toYdk(e))` and `parseYgoList(toYdke(e))` give back the same section/passcode/qty set.
  - `messy paste` (Review Focus 2): `paste-discord.txt` gives no `skipped`. `Maxx “C”` gives `{name: 'Maxx "C"'}`. `Name x3` gives qty 3. CRLF works the same as LF.
  - `unknown line is kept, not dropped`: `"lorem ipsum"` in a text list becomes a `{name:'lorem ipsum'}` line, qty 1. Only a header-shaped line with no cards is treated as a header.
  - `detects the format` for each fixture.
  - `text export` of a 3-card deck equals the exact block above. `sortEntries` puts the monster before the spell before the trap.

- [ ] **Step 2: Run and see them fail.** Run `npm test -- tests/shared/decks/ygoLists.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `lists.ts` and `sort.ts` as specified. Use `atob`/`btoa` and a `DataView` for ydke, since they work in Node, browser and worker alike.

- [ ] **Step 4: Run and see them pass.** Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(decks): Yu-Gi-Oh! ydk, ydke and text lists"`

---

### Task 4: Yu-Gi-Oh! pack builder and nightly step

**Files:**
- Create: `src/shared/decks/ygo/buildPack.ts`, `scripts/catalog/rules.ts`
- Modify: `scripts/catalog/vite.config.ts` (add the `rules` entry the same way the other entries are added), `package.json` (`"catalog:rules"` alongside `catalog:snapshots`), `.github/workflows/catalog.yml`
- Test: `tests/shared/decks/ygoBuildPack.test.ts`, `tests/fixtures/decks/ygo/cardinfo-sample.json` (about 8 real cardinfo `misc=yes` records, trimmed to `id, name, frameType, banlist_info, misc_info[0].tcg_date/ocg_date`)

**Interfaces:**
- Consumes: `YgoRulesPack`, `RULES_SCHEMA` (Task 2).
- Produces:
  ```ts
  export interface YgoPackCard { id: number; banlist_info?: { ban_tcg?: string; ban_ocg?: string }; misc_info?: { tcg_date?: string; ocg_date?: string }[] }
  export function buildYgoPack(cards: YgoPackCard[], builtAt: Date): YgoRulesPack
  ```
  `scripts/catalog/rules.ts` fetches `https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes`. It calls `buildYgoPack`, checks the result with `parseRulesPack` (it must be `ready`), and PUTs the JSON to `${PORTAL_URL}/api/admin/rules/ygo` with `authorization: Bearer ${PORTAL_ADMIN_TOKEN}`. It uses the same env names the catalog job already reads for snapshot uploads; check `scripts/catalog/build.ts`. It exits non-zero on failure.
- Mapping: `Banned` → 0, `Limited` → 1, `Semi-Limited` → 2. `ban_tcg` goes to advanced and `ban_ocg` to ocg. `notReleased[region]` holds a card whose region date is missing or later than `builtAt`'s date. `version` = `builtAt` as YYYY-MM-DD. `sources = [{ name: 'YGOPRODeck', fetchedAt: builtAt ISO }]`.
- Workflow: add the step after "Upload catalog". It has `continue-on-error: true` and `id: rules`, and runs `npm run catalog:rules`. Follow it with a "Flag failed rules pack" step that sets `CATALOG_PROBLEMS=1` on failure, the way the Chinese art step does.

- [ ] **Step 1: Write the failing test.** `buildYgoPack(sample, new Date('2026-11-22T03:00:00Z'))`: Pot of Greed gives `advanced.limits['55144522'] === 0`. A `Limited` OCG card gives `ocg.limits[...] === 1`. A card with only `ocg_date` is in `advanced.notReleased` with value `null`. A card with `tcg_date: '2026-12-05'` maps to that date. A card out in both regions is in neither. `version === '2026-11-22'`. `parseRulesPack(result).state === 'ready'`. `JSON.stringify(result).length` is under 2,000 for the sample.
- [ ] **Step 2: Run and see it fail.** Run `npm test -- tests/shared/decks/ygoBuildPack.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `buildPack.ts`, then the script.
- [ ] **Step 4: Run and see it pass.** Expected: PASS. Then run the script once locally against a dev portal, or with the PUT replaced by a dry run (`--dry-run` writes `out/rules-ygo.json` and prints its byte size and gzipped size). Record the gzipped size in the PR. The target is under 100 KB.
- [ ] **Step 5: Commit.** `git commit -m "feat(decks): nightly Yu-Gi-Oh! rules pack build"`

---

### Task 5: Portal rules pack route and client cache

**Files:**
- Create: `workers/portal/src/rulesPack.ts`, `src/shared/decks/rulesCache.ts`
- Modify: `workers/portal/src/index.ts` (route before `edgeImage`, response wrapped in `withAppCors`), `src/shared/ipc.ts` (`decks.rules`, and `'decks:rules'` in the invoke channel list), `src/main/ipc/handlers.ts` + `src/main/index.ts` (desktop adapter on `meta`), `src/phone/data/store.ts` + `src/phone/api.ts` (phone adapter on `phone_files`), `src/renderer/src/web/httpApi.ts` (web adapter on the Cache API)
- Test: `tests/portal/rulesPack.test.ts`, `tests/shared/decks/rulesCache.test.ts`

**Interfaces:**
- Consumes: `parseRulesPack`, `PackState` (Task 2).
- Produces:
  ```ts
  // workers/portal/src/rulesPack.ts: model on appBundles.ts / catalogSnapshot.ts
  export async function rulesPackRoute(req: Request, bucket: Pick<SnapshotBucket, 'get' | 'put'>, adminToken: string | undefined, cache: Cache | null): Promise<Response | null>
  //   GET /api/rules/<game>        → R2 rules/<game>.json; ETag = R2 etag; If-None-Match → 304; Cache-Control: public, max-age=3600; edge-cached; 404 when absent
  //   PUT /api/admin/rules/<game>  → admin token; body must parse as a ready pack of that game, else 400; writes R2; purges the edge copy
  // src/shared/decks/rulesCache.ts
  export interface CachedPack { body: string; etag: string | null; checkedAt: string }
  export interface PackStore { read(game: GameId): Promise<CachedPack | null>; write(game: GameId, c: CachedPack): Promise<void> }
  export const PACK_REFRESH_MS = 24 * 3600 * 1000
  export async function loadRulesPack(game: GameId, deps: { store: PackStore; fetch: typeof fetch; origin: string; now: () => Date }): Promise<PackState>
  // Api (src/shared/ipc.ts), under a new `decks` namespace:
  rules(game: GameId): Promise<PackState>
  ```
- `loadRulesPack` returns the cached pack without fetching when `checkedAt` is newer than 24 h. Otherwise it fetches with `If-None-Match`. A 304 bumps `checkedAt`. A 200 with a parseable body (`ready` or `tooNew`) is stored. A network error, non-OK status or unparseable body keeps the cache and returns its state, or `missing` with no cache. It never throws.
- Desktop adapter: meta keys `rules_pack_<game>` (the JSON of `CachedPack`). It uses the main process `fetch`, which already has the Chromium fallback, and the `portalUrl` that `index.ts` computes. Phone adapter: a `phone_files` row named `rules-<game>.json`, with `bytes` holding UTF-8. Web adapter: `caches.open('duel-binder-rules')`, keyed by the route URL, storing `CachedPack` as a JSON Response.

- [ ] **Step 1: Write the failing tests.**
  - `rulesPack.test.ts` (using an in-memory bucket like the app-bundle tests do): `PUT without token → 401`; `PUT malformed → 400`; `PUT a pkm pack to /ygo → 400`; `PUT ready pack then GET → 200 with ETag, body equal`; `GET with matching If-None-Match → 304`; `GET unknown game → 404`.
  - `rulesCache.test.ts` (Review Focus 4): a fresh cache under 24 h makes no fetch. A stale cache plus a fetch rejection returns the cached `ready` state. A stale cache plus a 200 corrupt body keeps the old pack. No cache plus a 500 gives `missing`. A 304 bumps `checkedAt`. A 200 with `schema: 2` gives `tooNew` and is stored.
- [ ] **Step 2: Run and see them fail.** Run `npm test -- tests/portal/rulesPack.test.ts tests/shared/decks/rulesCache.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the route and the loader, then wire the three adapters. `createPhoneApi` exposes `decks.rules` as `store.rulesPack(game)`. The store method runs `loadRulesPack` with the `phone_files` adapter outside the serial queue, since it's a read.
- [ ] **Step 4: Run and see them pass.** Expected: PASS. Also run `npm run typecheck:node`, `npm run typecheck:web` and `npm run typecheck:phone`; each must exit 0.
- [ ] **Step 5: Commit.** `git commit -m "feat(decks): serve and cache the rules pack"`

---

### Task 6: Deck tables and repo

**Files:**
- Modify: `src/main/db/schema.ts` (`SCHEMA_V53`, `{ version: 53, sql: SCHEMA_V53, server: false }`), `workers/portal/src/migrate.ts` (`server-53`), `src/main/repo/scope.ts` (`decks: WishlistScope` on `Scope` and in `localScope`), `workers/portal/src/scope.ts` (`NEXT_DECK_SEQ`, `decks` in `userScope`)
- Create: `src/main/repo/decks.ts`
- Test: `tests/main/decks.test.ts`

**Interfaces:**
- Consumes: Task 1 (`checkDeckFields`, limits, types), `printingPrice` (`src/main/repo/sets.ts`), `printingArtImageId` (`src/main/repo/cards.ts`), `CollectionError`.
- Desktop table (model on `SCHEMA_V49`):
  ```sql
  CREATE TABLE decks (owner_id INTEGER NOT NULL DEFAULT 0, uid TEXT NOT NULL, game TEXT NOT NULL, format TEXT NOT NULL,
    name TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', cover INTEGER, private INTEGER NOT NULL DEFAULT 0,
    cards TEXT NOT NULL DEFAULT '[]', last_verdict TEXT, last_pack_version TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, dirty INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (owner_id, uid));
  CREATE INDEX ix_decks_dirty ON decks(owner_id) WHERE dirty = 1;
  ```
  Server (`server-53`, model on `server-49`): `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` in place of `owner_id`, `seq INTEGER NOT NULL` in place of `dirty`, `UNIQUE INDEX ux_decks_seq ON decks(seq)`, and `INDEX ix_decks_user_seq ON decks(user_id, seq)`.
- Produces (every function takes `scope: Scope = LOCAL` last):
  ```ts
  export function listDecks(db, scope?): DeckList
  export function getDeck(db, uid: unknown, scope?): DeckDetail | null
  export function saveDeck(db, draft: unknown, now?: Date, scope?): string      // new (no uid) or replace; gone uid → CollectionError
  export function removeDeck(db, uid: unknown, now?: Date, scope?): void        // tombstone; owner 0 deletes outright (as removeGraded)
  export function markDeckSeen(db, uid: unknown, mark: unknown, scope?): void   // writes last_verdict JSON + last_pack_version only: no touch, no updated_at
  export function resolveDeckLines(db, refs: unknown, scope?): DeckResolution[]
  export type DeckResolution = { status: 'matched'; card: number } | { status: 'ambiguous'; options: { card: number; name: string; imageId: number | null }[] } | { status: 'unmatched' }
  ```
- `listDecks` and `getDeck` read only the scope's own game (`scope.where('d')`) and order by `updated_at DESC`. They build `DeckCard`s for every card id in the decks with one query per table (DO compound limit). Card facts and art come from `cards`/`card_images`. `owned` = the live collection quantity over all printings of the card plus the live `graded_copies` of it (joined by `pkey`). `price` = `MIN` of `printingPrice(scope)` over English printings with a price over 0, falling back to any language. `regionPrice` = the same over `ja, ko, zh-hans, zh-hant, ae, ja-asia`, falling back to `price`. `printingArt` maps each pinned pkey to its art via `printingArtImageId`, falling back to the card's first image. A cover is any card id; `coverImageId` is its first image.
- `saveDeck`: if the scope already has 200 live decks of the game, a new deck throws "You have 200 decks in this game; remove one to add another".
- `resolveDeckLines`: `{passcode}` matches `cards.id` of the game, then `card_images.image_id` (alternate art), giving its `card_id`. `{setCode}` matches `card_printings.set_code COLLATE NOCASE`; distinct cards give `ambiguous`. `{name}` is normalised: NFKD, combining marks removed, lowercase, curly quotes made straight, whitespace collapsed. It's compared against candidates from `cards_fts` MATCH on the name's tokens (quoted), then filtered by equal normalised name. One match gives `matched`, several give `ambiguous`, none gives `unmatched`. It caps at 300 refs per call.

- [ ] **Step 1: Write the failing tests** in `tests/main/decks.test.ts`, modelled on the `graded copies repo` block in `tests/main/graded.test.ts` (`seededDb`, `MIGRATIONS`):
  - `migration 53 is desktop-only` (as the graded test checks 49).
  - `saves, lists newest first, and reads a deck back with card facts`: a 3-entry deck gives `getDeck` with `cardFacts[id].name`, `frameType`, `imageId`, and `cards` equal to what was saved.
  - `owned counts any printing, any language, and slabs`: two collection copies (an English and a Japanese printing) plus one slab of the card give `owned === 3`.
  - `cost prices`: English printings priced 2.00 and 0.50 give `price 0.5`. A Japanese printing at 0.30 gives `regionPrice 0.3`. A card with no English printing has `price` equal to its cheapest other-language price. Unpriced gives `null`.
  - `an entry for a card this catalog lacks is kept` (Review Focus 1): save `[{main, 99999999, 1}]`, then `getDeck`. `cards` still has it and `cardFacts[99999999]` is undefined. Saving again keeps it.
  - `200-deck cap per game` (insert 200 rows directly with SQL, then `saveDeck` a new one and expect it to throw; editing an existing deck still works).
  - `removing tombstones a signed-in deck and deletes an owner-0 one`.
  - `markDeckSeen leaves the deck clean and its updated_at alone`: after a save and a sync-style `UPDATE decks SET dirty = 0`, `markDeckSeen` leaves `dirty = 0` and `updated_at` unchanged, and `getDeck(...).lastSeen` equals the mark.
  - `resolves passcodes, alternate art, set codes and names` (Review Focus 3): `36996508` resolves to the Dark Magician card id. Set code `lob-en005` resolves to its card. `'maxx “c”'` matches `Maxx "C"`. `'ash blossom'` (partial) is `unmatched`. Two cards sharing a name are `ambiguous` with both options.
- [ ] **Step 2: Run and see them fail.** Run `npm test -- tests/main/decks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the migrations, the scope additions and `decks.ts`. Pass id lists as `json_each(?)`.
- [ ] **Step 4: Run and see them pass.** Expected: PASS. Run `npm test -- tests/main/binderSchema.test.ts tests/portal/binderSchema.test.ts` too, so the migration lists stay valid.
- [ ] **Step 5: Commit.** `git commit -m "feat(decks): deck tables and repo"`

---

### Task 7: Channels for desktop, phone and web, plus friends

**Files:**
- Modify: `src/shared/ipc.ts` (`decks` namespace and `friends.decks`/`friends.deck`, plus both channel lists), `src/main/ipc/dataHandlers.ts` (`DATA_CHANNELS` + handlers), `src/shared/portal.ts` (portal channels), `workers/portal/src/rpc.ts`, `src/main/ipc/handlers.ts` (friends via `account.portal`), `src/phone/api.ts` (`EDITS` gets `decks:save`, `decks:remove`; friends), `src/renderer/src/web/httpApi.ts`, `src/renderer/src/lib/api.ts` (query keys + `mutationInvalidationKeys` adds `['decks']`)
- Test: add to `tests/main/decks.test.ts`

**Interfaces:**
- Consumes: Task 6 repo functions.
- Produces, in the Api `decks` namespace (data channels `decks:list|get|save|remove|markSeen|resolve`):
  ```ts
  list(): Promise<DeckList>
  get(uid: string): Promise<DeckDetail | null>
  save(draft: DeckDraft): Promise<string>
  remove(uid: string): Promise<void>
  markSeen(uid: string, mark: DeckVerdictMark): Promise<void>
  resolve(refs: DeckLineRef[]): Promise<DeckResolution[]>
  rules(game: GameId): Promise<PackState>       // Task 5; not a data channel
  ```
  Friends: `friends.decks(friendId): Promise<DeckList>` (non-private decks only) and `friends.deck(friendId, uid): Promise<DeckDetail | null>` (null when private). Both carry `notes: ''` and `lastSeen: null`. `owned` is the friend's own collection, since the RPC uses `userScope(friendId(...), game)` as `friends:graded` does.
- Query keys: `decks: ['decks']`, `deck: (uid) => ['decks', uid]`, `friendDecks: (id, game) => ['friends', id, 'decks', game]`, `friendDeck: (id, uid) => ['friends', id, 'decks', 'deck', uid]`, `rulesPack: (game) => ['rulesPack', game]`.
- `markSeen` is not in the phone's `EDITS`, so it doesn't trigger a sync.

- [ ] **Step 1: Write the failing tests** (model on `the web (server scope) adds and removes slabs…` and `friends:graded shows a friend…` in `tests/main/graded.test.ts`, using `inProcessPortal`):
  - `the web (server scope) saves and removes decks`: `rpc('decks:save', [draft], 'ygo')`, then `rpc('decks:list')` shows it.
  - `friends see a friend's non-private decks without notes, with the friend's owned counts`: user A has a private deck and a public deck with notes `'sideboard plan'`. Friend B's `friends:decks` lists only the public one, and `friends:deck` gives `notes === ''`, with `owned` from A's collection. `friends:deck` on the private uid gives `null`. A non-friend gets a rejection.
- [ ] **Step 2: Run and see them fail.** Expected: FAIL.
- [ ] **Step 3: Implement** the wiring in every listed file. The `Api` type makes a missing implementation fail the typecheck on all three hosts.
- [ ] **Step 4: Run and see them pass.** Expected: PASS, and all three typechecks exit 0.
- [ ] **Step 5: Commit.** `git commit -m "feat(decks): deck channels for desktop, phone, web and friends"`

---

### Task 8: Sync

**Files:**
- Modify: `src/shared/cloud.ts` (`DeckPushResult`, `DeckPullResponse`, and `WireDeck` re-exported from decks types), `workers/portal/src/sync.ts` (`decks-push`, `decks-pull` in both route lists and the handler, as `graded-*`), `src/main/cloud/client.ts` (`decksPush`, `decksPull`), `src/main/cloud/localSync.ts` (`SyncStream` gets `'decks'`; `decks` goes into the owner-0 check, `adoptLocalData`, `OWNED_TABLES` and the merge table list; plus `dirtyDecks`, `markDecksPushed`, `applyRemoteDeck`), `src/main/cloud/engine.ts` (`syncDecks` after `syncGraded` in `syncOnce`), `workers/portal/src/merge.ts` (decks copied like `graded_copies`), `workers/portal/src/account.ts` (doc list), `src/main/dev/fakeFriends.ts` (table list)
- Create: `workers/portal/src/decks.ts`
- Test: `tests/main/deckSync.test.ts`

**Interfaces:**
- Consumes: `checkDeckFields`, `replaces`, `checkTime`, `pageCursor`, `MAX_PULL`, `NEXT_DECK_SEQ`.
- Produces:
  ```ts
  export type DeckPushResult = { uid: string; status: 'applied' | 'skipped' } | { uid: string; status: 'stale'; current: WireDeck }
  export interface DeckPullResponse { entries: WireDeck[]; cursor: number; more: boolean }
  // workers/portal/src/decks.ts
  export function checkDecksPush(body: unknown, now: Date): WireDeck[]
  export function applyDecksPush(db: SqlDb, userId: number, entries: WireDeck[], games: readonly GameId[]): DeckPushResult[]
  export function decksPullSince(db: SqlDb, userId: number, cursor: number, limit?: number, game?: GameId): DeckPullResponse
  // localSync.ts
  export function dirtyDecks(db: SqlDb, owner: number, limit: number, skip: ReadonlySet<string>): WireDeck[]
  export function markDecksPushed(db: SqlDb, owner: number, d: WireDeck): void
  export function applyRemoteDeck(db: SqlDb, owner: number, d: WireDeck): boolean
  // client.ts (CloudClient)
  decksPush(entries: WireDeck[]): Promise<DeckPushResult[]>
  decksPull(cursor: number, game: GameId): Promise<DeckPullResponse>
  ```
- Each function mirrors its graded twin line for line: `checkGradedPush`, `applyGradedPush`, `gradedPullSince`, `dirtyGraded`, `markGradedPushed`, `applyRemoteGraded`, `syncGraded`. `cards` crosses the wire as an array and is stored as JSON text. `applyRemoteDeck` and `applyDecksPush` never write `last_verdict`/`last_pack_version`. A row they insert gets NULLs, and a row they update keeps its own values. `checkDecksPush` runs `checkDeckFields` (as a `CollectionError` 400) and refuses a push that would take the user past 1,000 live decks of one game. That's a server ceiling against abuse; the 200 cap is enforced on save on every device (Claude's call).

- [ ] **Step 1: Write the failing tests** in `tests/main/deckSync.test.ts`, modelled on the `graded copies sync` block (`inProcessPortal`, `syncOnce`):
  - `pushes a deck, reaches a fresh install, and an edit and removal follow`.
  - `the latest edit wins between two devices` (Review Focus 5): devices A and B both sync. A edits at T+1 and B at T+2, both offline. A syncs, then B syncs, then A syncs. Both end with B's cards. Then set a `last_verdict` on A before the final sync, and check A's `last_verdict` survives.
  - `a portal without decks (404) leaves them queued and the run whole` (as the graded test does).
  - `a malformed push is a 400`: a deck with 301 entries is rejected by `checkDecksPush`.
  - `never-signed-in decks move to the first account, dirty` (as the graded adopt test does).
- [ ] **Step 2: Run and see them fail.** Run `npm test -- tests/main/deckSync.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** everything in the Files list.
- [ ] **Step 4: Run and see them pass.** Expected: PASS. Run `npm test -- tests/main/graded.test.ts tests/main/binderSync.test.ts tests/portal` too; none may regress.
- [ ] **Step 5: Commit.** `git commit -m "feat(decks): sync decks across devices"`

---

### Task 9: Decks list page and navigation

**Files:**
- Create: `src/renderer/src/features/decks/DecksPage.tsx`, `DeckTile.tsx`, `NewDeckDialog.tsx`, `useRulesPack.ts`
- Modify: `src/renderer/src/components/AppShell.tsx` (`Page` gets `'decks'`; nav entry `{ page: 'decks', label: 'Decks' }` after Binders, shown only when `decksAvailable(game)`), `src/renderer/src/components/pageSwitch.tsx`, `src/phone/PhoneShell.tsx` (the same entry with lucide `LayersIcon`, same condition)
- Test: `tests/renderer/decks.test.tsx` (use `createMockApi`, `renderWithProviders` from `tests/renderer/mockApi`)

**Interfaces:**
- Consumes: `api.decks.list/save/rules`, `checkDeck`, `verdictChange`, `sortEntries`, `DECK_FORMATS`.
- Produces: `DecksPage({ onNavigate, friendId? })`, and `useRulesPack(game): PackState | undefined` (react-query, key `queryKeys.rulesPack(game)`, `staleTime` = `PACK_REFRESH_MS`).
- Tile: cover art, name, format label, the Main/Extra/Side card count, the badge from `checkDeck`, and cost to finish. Cost = the sum over entries of `max(0, needed − owned) × (format.priceRegion === 'asia' ? regionPrice : price)`, with needed counted per card across sections, shown as `$12.40`. When any missing copy has no price, add `+N unpriced`. Show a "Changed with the <version> list" line when `verdictChange(lastSeen, verdict)` is non-null. An empty state follows `EmptyHero` as the Binders page does. Actions: New deck (dialog: name and format, defaulting to Advanced) and Import (Task 11). With `friendId`, the page is read-only and uses `api.friends.decks`.

- [ ] **Step 1: Write the failing tests:**
  - `lists decks with badge, count and cost`: a mock with one legal 40-card deck and one deck holding 3 Pot of Greed, with the fixture pack from Task 2 as `decks.rules`. Expect `Legal` and `Not legal` on the tiles. With two missing copies at $1.50 and one unpriced card, the tile reads `$3.00 +1 unpriced`.
  - `shows Legality unknown without a pack`: `decks.rules` resolves `{state:'missing'}`.
  - `shows the overnight change`: `lastSeen` legal at `2026-11-01` against the pack at `2026-12-01` with Maxx "C" forbidden gives `Changed with the 2026-12-01 list`.
  - `new deck saves with the chosen format and opens it`.
  - `Decks is not in the nav for Pokémon` (active game `pkm`).
- [ ] **Step 2: Run and see them fail.** Run `npm test -- tests/renderer/decks.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(decks): Decks list page"`

---

### Task 10: Deck page, search-and-add, and feedback panel

**Files:**
- Create: `src/renderer/src/features/decks/DeckPage.tsx`, `DeckSection.tsx`, `DeckSearch.tsx`, `FeedbackPanel.tsx`
- Test: `tests/renderer/decks.test.tsx`

**Interfaces:**
- Consumes: `api.decks.get/save/remove/markSeen`, `api.cards.browse({ q, owned })`, `checkDeck`, `verdictMark`, `sortEntries`.
- Produces: `DeckPage({ uid, onNavigate, friendId? })`. It's routed from DecksPage by local state, as BindersPage opens a binder.
- Behaviour:
  - Sections show `Main Deck 41 / 40–60` style counts, sorted with `sortEntries`.
  - Entries have art, name, owned/needed (`2/3`), `+`/`−`, a printing pin (a picker over the card's printings; it sets `printing`), and remove.
  - Search-and-add has a target section. A card whose `frameType` is an Extra frame defaults to Extra; everything else defaults to Main. It has an "Only cards I own" toggle (`owned: 'owned'`).
  - Rename, notes, private toggle, cover (from an entry's menu), duplicate (`save` without uid, named `<name> copy`) and delete (with confirmation).
  - Edits save debounced at 600 ms. A failed save keeps the edit on screen with "Not saved: <reason>" and a retry; on the web offline, the reason is the existing `OFFLINE_MESSAGE`. Feedback runs on every edit from local state, not after the save.
  - FeedbackPanel sits beside the deck on desktop and web, and is a collapsible bottom sheet on phone (`isPhone()`). It shows the badge line, then the problems (errors first, each tapping through to scroll to and highlight its entry), then "Missing cards" with the total cost, a copy-as-list button, and the existing affiliate buy link per card (reuse what the card panel uses).
  - On open, once the verdict has a `packVersion`, call `markSeen(uid, verdictMark(v))`.
  - Read-only for friends: no edit controls, and no notes.

- [ ] **Step 1: Write the failing tests:**
  - `adding a Link monster from search lands in Extra`.
  - `+ past 3 copies shows the copy problem at once and still saves` (the save mock was called with qty 4).
  - `a failed save keeps the edit and offers retry`: the save mock rejects with `OFFLINE_MESSAGE`, and the qty stays at the edited value.
  - `tapping a problem highlights its entry`.
  - `opening a changed deck marks it seen`: `markSeen` is called with `packVersion '2026-12-01'`.
  - `friend view hides edit controls and notes`.
- [ ] **Step 2: Run and see them fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(decks): deck page with live feedback"`

---

### Task 11: Import and export

**Files:**
- Create: `src/renderer/src/features/decks/ImportDialog.tsx`, `ExportMenu.tsx`
- Modify: `src/renderer/src/features/scan/replay/save.ts`: pull its save/share/download logic out as `saveTextFile(text, name, mime)` (or add it beside `saveReplay` reusing the same platform branches), used for `.ydk`
- Test: `tests/renderer/decks.test.tsx`

**Interfaces:**
- Consumes: `parseYgoList`, `detectYgoList`, `toYdk`, `toYdke`, `toYgoText`, `api.decks.resolve`, `api.decks.save`.
- Behaviour:
  - Import takes a paste box or a file picker (`.ydk`, `.txt`), parses it, and calls `resolve` once. The preview has three groups. **Matched** shows a count and the list. **Pick one** (ambiguous) has a choice per line. **Not found** shows the raw text with "Search" (opening `DeckSearch` to pick a card) and "Drop". Parser-`skipped` lines also go under Not found.
  - Save is enabled only once every ambiguous and not-found line is picked or dropped. Nothing leaves silently.
  - It can create a new deck (name from the `.ydk` file name or "Imported deck", format chosen in the dialog) or replace an open deck's cards after a confirm ("Replace the 55 cards in Snake-Eye?").
  - Export offers "Copy as text", "Copy ydke:// link" and "Save .ydk" (the file name is the deck name). Copy uses the app's existing clipboard path (`api.dex.copy` on desktop, `navigator.clipboard` elsewhere; follow how existing copy buttons pick between them).

- [ ] **Step 1: Write the failing tests:**
  - `import preview lists matched, ambiguous and unmatched lines, and save waits for them` (the resolve mock returns one of each).
  - `dropping and picking enables save, and the saved deck has exactly the kept cards`.
  - `replace asks first`.
  - `export copies the text list` (the clipboard mock receives the exact Task 3 text).
- [ ] **Step 2: Run and see them fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(decks): import and export Yu-Gi-Oh! lists"`

---

### Task 12: Add to deck in the card panel, and the friend Decks tab

**Files:**
- Create: `src/renderer/src/features/decks/AddToDeck.tsx`
- Modify: `src/renderer/src/features/card/CardTypeList.tsx` (place `AddToDeck` next to `AddToBinder` when `decksAvailable(game)`), `src/renderer/src/features/friends/FriendHeader.tsx` (`'decks'` tab, `showDecks` prop, shown when `friends.decks` has any), and the friend page that renders FriendHeader's tabs (it renders `DecksPage` with `friendId`)
- Test: `tests/renderer/decks.test.tsx`

**Interfaces:**
- Consumes: `api.decks.list/save`, `api.friends.decks`.
- Behaviour: AddToDeck opens a menu of the game's decks plus "New deck…". Picking one adds 1 copy to the default section (the Task 10 rule) and toasts "Added to <deck>". A deck that would go past 3 copies still adds, and the toast names the problem.

- [ ] **Step 1: Write the failing tests:** `Add to deck adds one copy to the default section`; `friend Decks tab appears only when the friend has a visible deck`.
- [ ] **Step 2: Run and see them fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and see them pass.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(decks): add to deck from the card panel, friend Decks tab"`

---

### Task 13: Whole-branch checks and release prep

**Files:** none new.

- [ ] **Step 1:** Run `npm run lint`, `npm run typecheck:node`, `npm run typecheck:web`, `npm run typecheck:phone`, then `npm test`. Every command exits 0.
- [ ] **Step 2:** Launch the desktop app (the `run` skill) and walk it through:
  - Import a real `.ydk` and see the preview.
  - Save it and check the badge.
  - Add a 4th copy and see the problem appear at once.
  - Export text and re-import it.
  - Sign in on a second profile, sync, and see the deck arrive.
  - Check the web build in a browser against a dev portal with an uploaded pack.
  - Screenshot the list, the deck page and the feedback panel for the PR.
- [ ] **Step 3:** Open the PR. The body lists:
  - The release order: deploy the portal first (server-53, rules route), then run `catalog.yml` once by hand so `rules/ygo.json` exists, then tag.
  - The measured pack size.
  - That `last_verdict` is per device.
