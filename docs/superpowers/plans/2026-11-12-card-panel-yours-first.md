# Card Panel: Your Copies First — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The card side panel opens on the user's own copies; a "Show all N printings" button opens a full list grouped by art, set and rarity.

**Architecture:** One new pure module (`printingGroups.ts`) turns a card's printings into art groups, set rows and pill labels. `CardTypeList` keeps all its count logic (serial queue, overlay, confirm, Browse patching) and changes only what it renders: an owned-copies block, a Show-all gate, and a grouped full list. The only server change is a `releaseDate` on each printing from `getCardDetail`, which the desktop and the portal Worker share (`workers/portal/src/rpc.ts` calls the same function).

**Tech Stack:** Electron + React 19 + TS, Tailwind/shadcn, TanStack Query, better-sqlite3 / Durable Object SQLite, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-12-card-panel-yours-first-design.md`

Worktree: `/var/tmp/cp-wt`, branch `feat/card-panel-yours-first` (other sessions commit in the main checkout).

## Global Constraints

- vitest always with `--maxWorkers=2`.
- Typecheck with `npm run typecheck:web` and `npm run typecheck:phone` separately (`npm run typecheck` stops at resvg).
- All four games (ygo, pkm, op, mtg), desktop + web + phone; the phone keeps the list before `CardDetails`.
- Don't change `sets.adjust`, the serial queue, the optimistic overlay, `patchBrowseOwned`, last-copy confirm, `WishToggle`, `AddToBinder`, or prices.
- If unsure which art a printing is, it goes to **Original**, never hidden.
- Deploy the portal Worker before tagging a client release.
- Keep the region `aria-label="Printings"` and the stepper labels `Remove one ${label}` / `Add one ${label}` with `label = ${cardName} ${setCode} ${setRarity}` (plus ` entry ${id}` for second entries), so the existing tests' intent carries over.

## Review Focus

1. **A copy on a different art than its printing's group** (scanned alt art on a plain printing, `viaPrinting=false`): it must be listed and editable in Your copies. Its pill counts every copy on that printing and shows "Edit in your copies" instead of a stepper. Test in Task 4.
2. **A card with no English printing** (Japanese-only OCG card, Korean-only): the default language filter is "All languages" and the list isn't empty. Test in Task 2 (`defaultLanguageMode`).
3. **Owned non-English printing with the "English" filter on:** that printing's set row still shows, because the English filter also includes owned languages and the opened set's language. Test in Task 2.
4. **Removing the last copy from an owned line:** confirm still asks first. Afterwards the line stays at 0 with `+` disabled until the refetch, as rows do today, and the panel doesn't jump to the full list. Test in Task 3.
5. **Unknown release dates:** the set row shows no year (never "null" or "NaN"), and those rows sort after dated ones. Tests in Task 2 and Task 4.

---

### Task 1: `releaseDate` on a card's printings

**Files:**
- Modify: `src/shared/types.ts` (`Printing`)
- Modify: `src/main/repo/cards.ts`: `PrintingDbRow` (~161), `rowToPrinting` (~218), the printings query in `getCardDetail` (~477)
- Test: `tests/main/cards.test.ts`; run `tests/portal/game-index-plans.test.ts`

**Interfaces:**
- Produces: `Printing.releaseDate?: string` (ISO `YYYY-MM-DD`, present only when known, only from `getCardDetail`).

- [ ] **Step 1: Write the failing tests** in `tests/main/cards.test.ts`:

```ts
test("getCardDetail dates a printing by its set, else the English set's", () => {
  db.prepare("INSERT OR REPLACE INTO sets (game, language, set_name, set_code, tcg_date) VALUES ('ygo','en','Legend of Blue Eyes White Dragon','LOB','2002-03-08')").run()
  const d = getCardDetail(db, 46986414)!
  expect(d.printings.find((p) => p.setCode === 'LOB-EN005')?.releaseDate).toBe('2002-03-08')
})
test('getCardDetail leaves releaseDate out when the set has no date', () => {
  const d = getCardDetail(db, 46986414)!
  expect(d.printings.find((p) => p.setCode === 'SDY-006')).not.toHaveProperty('releaseDate')
})
```

Check that the seeded set names match the fixture, and adjust the set name if it doesn't. Add a third test with a non-English printing whose own-language set row is missing, to show that the English set's date is used.

- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run tests/main/cards.test.ts --maxWorkers=2`. Expect FAIL: `releaseDate` is undefined.

- [ ] **Step 3: Implement.**
  - Add `release_date?: string | null` to `PrintingDbRow`.
  - In `rowToPrinting`, add `...(row.release_date ? { releaseDate: row.release_date } : {})`. The key is left out when there's no date, so existing `toEqual` assertions on printings stay valid.
  - In the `getCardDetail` printings query, select `COALESCE(rs.tcg_date, res.tcg_date) AS release_date` and add the same two joins `collection.ts` uses (~line 78): `LEFT JOIN sets rs ON rs.game = p.game AND rs.language = p.language AND rs.set_name = p.set_name LEFT JOIN sets res ON res.game = p.game AND res.language = 'en' AND res.set_name = p.set_name`. Both are primary-key lookups.

- [ ] **Step 4: Run the tests and the portal query-plan test.** `npx vitest run tests/main/cards.test.ts tests/portal/game-index-plans.test.ts tests/main --maxWorkers=2`. Expect PASS. If game-index-plans flags a scan on `sets`, the join is not using the `(game, language, set_name)` primary key. Fix the join; don't change the test.

- [ ] **Step 5: Commit.** `feat: date each printing in a card's details`

---

### Task 2: Pure grouping module

**Files:**
- Create: `src/renderer/src/features/card/printingGroups.ts`
- Test: `tests/renderer/printing-groups.test.ts`

**Interfaces:**
- Consumes: `Printing` (with optional `releaseDate`, `artImageId`), `GameId` from `@shared/games`, `Language`, `finishOf` from `@shared/games/magic`.
- Produces:

```ts
export interface ArtKind { key: string; label: string }   // key 'original' for Original
export function artKind(p: Printing, game: GameId): ArtKind
/** A Yu-Gi-Oh rarity text split as RARITY_LABEL wrote it: "Ultra Rare (Chibi artwork)" → rarity + variant, wiki markup stripped. */
export function splitRarity(setRarity: string): { rarity: string; variant: string | null }
export interface ArtGroup { kind: ArtKind; printings: Printing[]; thumb: Printing }
/** Original first, then by printing count desc, then label. Empty-safe. */
export function artGroups(printings: Printing[], game: GameId): ArtGroup[]
export interface Pill { printing: Printing; label: string }
export interface SetRow { key: string; setName: string; language: Language; codePrefix: string; year: string | null; pills: Pill[] }
export function setRows(printings: Printing[], game: GameId, preferSet?: { setName: string; language: Language }): SetRow[]
export type LanguageMode = 'english' | 'all'
export function defaultLanguageMode(printings: Printing[]): LanguageMode
/** The languages the 'english' mode lets through: en, every owned language, preferSet's. */
export function englishModeLanguages(owned: Printing[], preferSet?: { language: Language }): Set<Language>
export function printingSummary(printings: Printing[], game: GameId): { printings: number; arts: number; sets: number; languages: number }
```

Rules (the spec's calls 1, 2 and 4):

- **`splitRarity`:** first replace `[[a|b]]` with `b` and `[[a]]` with `a`, and drop `"` quotes. Then use `/^(.+?)\s*\(([^()]+)\)$/`. No match means variant null.
- **`artKind`, Yu-Gi-Oh:** the variant is lowercased and trimmed, then matched against this allow-list. Anything else, and no variant, is `{ key: 'original', label: 'Original' }`.

  | Match | key / label |
  |---|---|
  | `/^chibi( artwork)?$/` | `chibi` / `Chibi` |
  | `/^overframe$/` | `overframe` / `Overframe` |
  | `/^alternate art(work)?$/` | `alternate` / `Alternate art` |
  | `/^manga-style\b/` | `manga` / `Manga-Style` |
  | `/^anime( artwork)?$/` | `anime` / `Anime` |
  | `/^japanese artwork$/` | `japanese` / `Japanese artwork` |
  | `/^international artwork$/` | `international` / `International artwork` |
  | `/^(\d+)(st\|nd\|rd\|th) artwork$/` | `art-N` / `Nth artwork` (e.g. `3rd artwork`) |

  The last row adds ordinal artworks to the spec's list. They are real distinct arts: 65 "3rd artwork" printings in the catalog.
- **`artKind`, One Piece:** `artImageId` present gives `{ key: 'op' + artImageId, label: 'Alternate art' }`; otherwise Original. `artGroups` numbers the labels ("Alternate art 1", "Alternate art 2") when there are two or more such groups, ordered by first printing id.
- **`artKind`, Pokémon and Magic:** always Original, so there's one group and the UI hides tiles.
- **`thumb`:** the group's printing with the latest `releaseDate`. A printing with no date loses to any dated one; between equals, the higher id wins.
- **`setRows`:** key `${language}|${setName}`. `codePrefix` is the text before the first `-` of the first printing's `setCode`, or the whole code if there's no `-`. `year` is `releaseDate.slice(0, 4)` of any printing in the row, else null.
  - Order: the preferSet row first; then newest `releaseDate` first; then rows with no date; ties by `codePrefix`.
  - Pills keep the input order.
- **Pill labels:**
  - The base label is `splitRarity(setRarity).rarity` for ygo, the whole `setRarity` for pkm, and the rarity with its finish suffix removed for mtg plus `· Foil` / `· Etched` when `finishOf` says so (Nonfoil gets nothing).
  - Shorten ygo base labels by dropping a trailing ` Rare`, unless the label is just `Rare` ("Secret Rare" becomes "Secret", "Quarter Century Secret Rare" becomes "Quarter Century Secret"). Pokémon and Magic labels aren't shortened.
  - If two pills in a row share a label, append ` · ${variant}` (ygo) to each one that has a variant.
  - If labels still collide, append ` · ${setCode.slice(codePrefix.length + 1)}` (the code suffix) to every colliding pill.
- **`defaultLanguageMode`:** `'all'` when no printing has `language === 'en'`, else `'english'`.
- **`printingSummary`:** counts printings, `artGroups(...).length`, distinct `setRows` keys, and distinct languages.

- [ ] **Step 1: Write the failing tests** in `tests/renderer/printing-groups.test.ts`. Use a `printing(id, extra)` factory like the one in `card-panel.test.tsx`. Cases, each one `it` with exact expectations:
  - `artKind` gives `chibi` for `'Secret Rare (Chibi artwork)'`, `alternate` for both `'Ultra Rare (Alternate Art)'` and `'Secret Rare (Alternate artwork)'`, and `manga` for `'Ultra Rare (Manga-Style, Monochrome)'`.
  - It gives `original` for `'Secret Rare (New artwork)'`, `'Ultra Rare (Alternate password)'`, `'Rare (Stamp artwork)'`, `'Ultra Rare (Blue)'`, `'Secret Rare (Special Red Version)'`, `'Ultra Rare (Pharaoh\'s Rare)'`, `'Common (Yellow "[[Sheep Token]]")'`, `'Ultra Rare (10th anniversary artwork)'` and a plain `'Ultra Rare'`.
  - `'Ultra Rare ([[Alternate artwork|alternate artwork]])'` gives `alternate`, and `'Secret Rare (3rd artwork)'` gives `{ key: 'art-3', label: '3rd artwork' }`.
  - One Piece: two printings with different `artImageId` plus one plain give groups labelled `['Original', 'Alternate art 1', 'Alternate art 2']`. Pokémon and Magic always give one group.
  - `thumb` is the newest-dated printing of its group.
  - `setRows` puts the preferSet row first, then newest first, then undated rows last. An undated row's `year` is `null`.
  - Two printings in one set with `setRarity` `'Ultra Rare'` and `'Ultra Rare (1st Edition)'` give the labels `['Ultra', 'Ultra · 1st Edition']`. Two Secret Rares in one set with codes `RA01-EN001` and `RA01-EN051` and no variants give `['Secret · EN001', 'Secret · EN051']`.
  - Magic `'Rare'`, `'Rare (Foil)'` and `'Rare (Etched Foil)'` in one set give `['Rare', 'Rare · Foil', 'Rare · Etched']`.
  - The same set name in `en` and `ja` gives two rows.
  - `defaultLanguageMode` of Japanese-only printings is `'all'`. `englishModeLanguages([jaOwned], undefined)` contains `en` and `ja`.
  - `printingSummary` of 3 printings in 2 sets, 2 languages and 2 arts gives `{ printings: 3, arts: 2, sets: 2, languages: 2 }`.

- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run tests/renderer/printing-groups.test.ts --maxWorkers=2`. Expect FAIL: module not found.

- [ ] **Step 3: Implement** the module to the interfaces and rules above. No React and no I/O.

- [ ] **Step 4: Run them and confirm they pass.** Same command. Expect PASS.

- [ ] **Step 5: Commit.** `feat: group a card's printings by art, set and rarity`

---

### Task 3: Your copies first, Show all gate

**Files:**
- Modify: `src/renderer/src/features/card/CardTypeList.tsx`
- Create: `src/renderer/src/features/card/OwnedCopies.tsx`
- Modify: `src/renderer/src/features/card/CardPanel.tsx`
- Test: `tests/renderer/card-panel.test.tsx` (update and extend)

**Interfaces:**
- Consumes: `printingSummary` (Task 2), `scanFor` (`@/components/scanFor`), `CardArt` (`@/components/CardArt`, `size="small"`), `formatUsd`, `useCardWishes`.
- Produces:
  - `CardTypeList` gets a new prop `originalImageId: number | undefined` and a new prop `startExpanded: boolean`.
  - `OwnedCopies` props:

    ```ts
    { rows: CardTypeRow[]; cardName: string; selectedKey?: string; onSelect(row); ownedOf(row): number;
      pending: boolean; wished(printingId): boolean; stepper(row, label): React.ReactNode; compact: boolean }
    ```

  - Extract the existing −/count/+ plus last-copy confirm JSX from `CardTypeList` into a local `renderStepper(row, label)` inside `CardTypeList`, behaviour unchanged. `OwnedCopies` and Task 4's action row both call it.

Behaviour:

- **Owned rows** are `rows.filter((r) => r.entry)`, in their current `cardTypeRows` order.
- **Heading:** `You have ${total}` plus ` · worth ${formatUsd(value)}` when `value > 0`, where value is the sum of `ownedOf(row) * (row.entry.unitPrice ?? 0)`. With no owned rows it reads "You have none yet", as today.
- **Owned line:** a `role="group"` row with the same `aria-label` as today, selectable through `pickableRow`. It shows:
  - a thumbnail: `CardArt` with `imageId={entry.imageId}`, `printingId={scanFor(entry)}`, about 36×52 px;
  - the set code in mono;
  - the English set name (`englishSetName`) and a `LanguageTag`;
  - a rarity pill with a `rarityColor` swatch and `setRarity`;
  - the year from `releaseDate`, hidden when unknown;
  - the unit price;
  - the stepper;
  - a small filled heart (not a toggle, `aria-label="On your wishlist"`), shown only when `wishes.data` has this printing.
  - No `WishToggle` on owned lines.
- **Compact mode:** used while expanded. Same line without the set name, year and price.
- **Expanded state:** `const [expanded, setExpanded] = useState(startExpanded)`. The list is already keyed by `cardId`, so it resets for each card.
- **Collapsed:** owned block, then an outline button `Show all ${summary.printings} printings` with a muted line under it. The line lists the parts of the summary that are above 1 (for example `4 artworks · 17 sets · 3 languages`) and is left out when empty.
- **Expanded:** "Your copies" (compact) when there are any, then the full list. Until Task 4, the full list is today's flat rows for printings with no entry. Then a "Show less" link, shown only when there are owned rows.
- **Wiring in `CardPanel`:**
  - pass `originalImageId={detail.data?.images[0]?.imageId}`;
  - pass `startExpanded={onlySet || !(copies.data ?? []).length}`; with onlySet there's no gate, since set lists are short;
  - show `LoadingState` while `copies.isPending`, as well as in the current case, so `startExpanded` is decided once the copies are known.
- `AddToBinder` stays at the bottom, unchanged.

- [ ] **Step 1: Update and write the failing tests** in `tests/renderer/card-panel.test.tsx`:
  - The `list()` helper waits for the region and either an owned line or the Show all button. Add `showAll()`, which clicks `Show all` when it's present.
  - Existing tests that touch unowned printings call `showAll()` first. Keep each test's assertions as they are.
  - New: `it('opens an owned card on its copies only, with the count and value')`. With copies `[entry(10, a)]` (quantity 2, unitPrice 1), the region shows `You have 2 · worth $2.00`. There's a single `group` (LOB-001). There's a `Show all 3 printings` button, and the summary line includes `2 languages`.
  - New: `it('opens an unowned card straight on every printing')`. With no copies, there's no Show all button and all three printings are listed.
  - New: `it('opens on every printing from a set page')`. With `onlySet` and `preferSet`, the list starts expanded.
  - New: `it('keeps the line, at 0, after its last copy is removed')`. Using the confirm flow, the group is still there with count `0`, and there's no Show all button change.
  - New: `it('marks a wished owned printing with a heart, without a toggle')`. Mock `wishlist.forCard` so it returns a wish on printing 1, and expect `getByLabelText('On your wishlist')`.

- [ ] **Step 2: Run them and confirm the new ones fail.** `npx vitest run tests/renderer/card-panel.test.tsx --maxWorkers=2`.

- [ ] **Step 3: Implement** as described above.

- [ ] **Step 4: Run the card tests and both typechecks.** `npx vitest run tests/renderer/card-panel.test.tsx tests/renderer/card-type-search.test.tsx tests/renderer/card-types-only-set.test.ts --maxWorkers=2 && npm run typecheck:web && npm run typecheck:phone`. Expect PASS. `card-type-search` may need `showAll()` too, since its fixture may own nothing; check.

- [ ] **Step 5: Commit.** `feat: open an owned card on your copies, with Show all`

---

### Task 4: Grouped full list

**Files:**
- Create: `src/renderer/src/features/card/PrintingGroups.tsx` (tiles, language toggle, set rows, pills, action row)
- Modify: `src/renderer/src/features/card/CardTypeList.tsx` (expanded view renders `PrintingGroups` instead of the flat rows)
- Test: `tests/renderer/card-panel.test.tsx`, `tests/renderer/card-type-search.test.tsx`

**Interfaces:**
- Consumes: everything in Task 2; `renderStepper` and `ownedOf` from Task 3 (passed in as props); `WishToggle`; `rowMatches` (move it next to `PrintingGroups`, or export it).
- Produces: `PrintingGroups` props:

```ts
{ game: GameId; cardId: number; cardName: string; rows: CardTypeRow[]; originalImageId?: number;
  selectedKey?: string; onSelect(row: CardTypeRow): void; ownedOf(row: CardTypeRow): number;
  stepper(row: CardTypeRow, label: string): React.ReactNode; wished(printingId: number): boolean;
  preferSet?: { setName: string; language: Language }; searchable: boolean }
```

Behaviour:

- **Pill to row mapping:** each pill's printing maps to the row keyed `p${id}`, since every printing has one.
  - The pill's owned count is the sum of `ownedOf` over every row of that printing, so a printing owned only through a different-art entry still shows as owned.
  - **Stepper:** the action row shows the stepper only when the printing has exactly one row. Otherwise it shows the muted text `Edit in your copies above`. This is the spec's call 3: entry-only rows are edited only in Your copies.
- **Art tiles:** shown when `artGroups(...)` has 2 or more groups.
  - The tile is a `button` with `aria-pressed`, a thumbnail and the label with its count.
  - The thumbnail is `CardArt` with `imageId={thumb.artImageId ?? originalImageId}` and `printingId={thumb.id}`.
  - State: `art: string | null`. Null means all; clicking a tile toggles that group's key.
- **Language toggle:** two buttons, `English` and `All languages`, with `aria-pressed`. Initial mode is `defaultLanguageMode(printings)`.
  - The English mode filters by `englishModeLanguages(ownedPrintings, preferSet)`.
  - The toggle is hidden when every printing is in one language.
  - The `All languages` set rows show a `LanguageTag`.
- **Search:** keep today's `SearchInput` when `searchable` (ygo, more than 8 rows). It filters printings with `rowMatches` before grouping.
- **Set row:** shows `codePrefix` in mono, `englishSetName(setName, codePrefix)`, and the year when it isn't null, followed by its pills.
- **Pill:** a `button` with `aria-pressed={selected}` and `aria-label={`${cardName} ${setCode} ${setRarity}`}`. It shows a `rarityColor` swatch, the label, and the price (`formatUsd`) or, when owned, a gold count (`×2`, gold border). Clicking it calls `onSelect(row)`.
- **Action row:** appears only under the set row whose pill is selected. It has a `role="group"` with the same `aria-label` as the pill, the label, `WishToggle` (as today), and the stepper (or "Edit in your copies above").
- **Empty state:** when nothing passes the filters, show `No prints match`, as today.

- [ ] **Step 1: Write the failing tests:**
  - `it('groups printings into set rows with rarity pills')`. Using fixtures `a`, `b` (same set, Ultra and Secret) and `c` (ja) with no copies:
    - one `LOB` row with pills `Ultra $1.00` and `Secret $2.00`;
    - the Japanese row is hidden until `All languages` is clicked.
  - `it('adds a printing from its pill, through sets.adjust')`. Click the `LOB-002` pill, then `Add one Dark Magician LOB-002 Secret Rare`, and expect `adjust` to have been called with `('Legend of Blue Eyes', 'en', 2, 1)`.
  - `it('shows art tiles only when a card has two arts, and filters by them')`. Add a `printing(4, { setRarity: 'Secret Rare (Chibi artwork)', setName: 'Rarity Collection', setCode: 'RA01-EN004' })`. Tiles read `Original` and `Chibi`. Clicking `Chibi` leaves only the RA01 row. With `[a, b]` alone, there's no tile.
  - `it('counts a different-art copy on its pill, and edits it only in your copies')`. One entry on `a` with `imageId: 999` (so `viaPrinting=false`). After `showAll()`, the pill shows `×2`. Selecting it shows `Edit in your copies above`, and no `Add one` button is under the pill row.
  - `it('shows no year for a set with no date')`. Printings without `releaseDate` give a set row with no 4-digit year text.
  - In `card-type-search.test.tsx`, keep the three tests' intent. Search now filters set rows and pills, so the assertions query pills by `aria-label` instead of row groups.
  - Update the Pokémon version-chip test so it selects through a pill.

- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run tests/renderer/card-panel.test.tsx tests/renderer/card-type-search.test.tsx --maxWorkers=2`.

- [ ] **Step 3: Implement** `PrintingGroups` and swap it into the expanded view.

- [ ] **Step 4: Run the full renderer suite and both typechecks.** `npx vitest run tests/renderer --maxWorkers=2 && npm run typecheck:web && npm run typecheck:phone`. Expect PASS.

- [ ] **Step 5: Commit.** `feat: group the full printings list by art, set and rarity`

---

### Task 5: Check it in the app on all four games, then ship

**Files:** none, unless fixes are needed.

- [ ] **Step 1: Full test suite and lint.** `npx vitest run --maxWorkers=2 && npm run lint && npm run typecheck:web && npm run typecheck:phone`. Expect all green.

- [ ] **Step 2: Run the desktop app** with the `run` skill against the `duel-binder-fake-data` profile. Use desktop width and a phone-width web build (`isPhone()` path). Screenshot:
  1. A Yu-Gi-Oh card with many printings and a Chibi or alt art you own (Dark Magician or Blue-Eyes): the collapsed view, then Show all with tiles.
  2. An unowned Yu-Gi-Oh card.
  3. A Japanese-only card.
  4. A Pokémon card with Normal and Reverse Holo.
  5. A One Piece card with an alt art.
  6. A Magic card with foil.
  7. Opening from a set page (onlySet).

  For each, check:
  - nothing owned is missing;
  - the steppers work;
  - the last-copy confirm appears;
  - the panel opens about as fast as today.

- [ ] **Step 3: Push the branch and open a PR.** Show the CI watcher card.

- [ ] **Step 4: After merge, deploy the portal and tag.** From `workers/portal`, run `npx wrangler deploy`, since it serves `getCardDetail` with `releaseDate`. Then tag the client release. Record the Worker version id in memory.
