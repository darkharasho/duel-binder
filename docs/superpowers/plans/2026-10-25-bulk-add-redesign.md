# Bulk Add Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the set checklist's bulk mode with big per-rarity photo tiles, a type-the-number box driving a keyboard highlight, and a "Just added" strip with undo.

**Architecture:** Pure helpers (tile list, bulk query match) go in `setsView.ts`; a presentational `BulkTile` replaces `BulkCard`; a new `BulkMode` component owns the bulk search box, highlight, chosen codes and the "Just added" list, and calls the existing per-card serial `adjust` queue in `SetChecklist.tsx`, which now reports each op's outcome.

**Tech Stack:** React 19 + TypeScript, Tailwind, shadcn/ui, TanStack Query, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-25-bulk-add-design.md`

## Global Constraints

- Run vitest with `--maxWorkers=2` (e.g. `npx vitest run --maxWorkers=2 tests/renderer/set-bulk.test.tsx`).
- The normal (non-bulk) checklist, `SetCardPanel` and `BulkRow` keep their behaviour; `BulkRow` stays (used by `SetCardPanel`).
- Adds save immediately through the existing `adjust` queue; "Changes save as you click." text and the Bulk add / Done button stay.
- The frozen id list and Show filter / sort keep working in bulk mode.
- Same renderer is used by the web portal; no main-process or shared-type changes.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on branch `bulk-add-redesign`.
- Accessible names used by tests (exact): tile group `"{name} {rarity}"`; buttons `"Add one {name} {rarity}"`, `"Remove one {name} {rarity}"`; photo button `"Add one {name} {rarity} (photo)"`; code picker `"Set code for {name} {rarity}"`; search box `"Type a card number or name"`; strip list `"Just added"`; strip undo button `"Undo {name} {rarity}"`.

## Review Focus

- Enter with no matching tiles does nothing (no adjust call). → Task 4 test.
- Undo after a failed add must not send −1 (entry already dropped). → Task 4 test.
- Typing "1" when card numbers 1 and 10 exist (fixture Gamma is 10) shows only card 1 (exact numeric), not 10. → Task 1 test.
- Highlighted tile stays on the same tile after its count changes (owned sort/filter frozen). → Task 4 test.
- Header search hidden in bulk mode and its text survives a round trip through bulk mode. → Task 3 test.

---

### Task 1: Pure helpers and shared rarity colours

**Files:**
- Modify: `src/renderer/src/features/sets/setsView.ts`
- Create: `src/renderer/src/lib/rarityColors.ts`
- Modify: `src/renderer/src/features/dashboard/DashboardPage.tsx` (import `RARITY_COLORS` from the new module, delete its local copy)
- Test: `tests/renderer/setsView.test.ts`

**Interfaces:**
- Produces:
  - `export interface BulkTileData { key: string; card: ChecklistCard; rarity: ChecklistRarity }` — `key` is `` `${card.cardId}:${rarity.rarity}` ``.
  - `export function bulkTiles(cards: ChecklistCard[]): BulkTileData[]` — one per (card, rarity), cards in given order, rarities in `card.rarities` order.
  - `export function filterBulkCards(cards: ChecklistCard[], q: string): ChecklistCard[]` — trimmed `q` empty → all; `/^\d+$/` and some card has `number === Number(q)` → only those; otherwise `cards.filter(c => matchesCardSearch(c, q))`.
  - `src/renderer/src/lib/rarityColors.ts`: `export const RARITY_COLORS: Record<string, string>` (moved verbatim) and `export function rarityColor(rarity: string): string` returning the mapped colour or `'#9ca3af'`.

- [ ] **Step 1: Write failing tests** in `tests/renderer/setsView.test.ts` using `metalRaidersChecklist` (card numbers 1, 2, 10):
  - `bulkTiles` on the fixture: keys `['1001:Secret Rare','1001:Ultra Rare','2001:Common', …]` (one per rarity in order).
  - `filterBulkCards(cards, '2')` → `[Beta Knight]`; `filterBulkCards(cards, ' 1 ')` → `[Alpha Dragon]` only (Gamma, number 10, is excluded); `filterBulkCards(cards, '10')` → `[Gamma …]` only; `filterBulkCards(cards, '999')` falls back to `matchesCardSearch` (→ `[]`); `filterBulkCards(cards, 'beta')` → `[Beta Knight]`; `filterBulkCards(cards, 'MRD-E001')` → `[Alpha Dragon]`; `''` → all.
  - `rarityColor('Secret Rare') === '#c8b6ff'`, `rarityColor('Mystery') === '#9ca3af'`.
- [ ] **Step 2:** `npx vitest run --maxWorkers=2 tests/renderer/setsView.test.ts` → FAIL (not exported).
- [ ] **Step 3:** Implement the interfaces above; update `DashboardPage.tsx` import.
- [ ] **Step 4:** Same command plus `tests/renderer/dashboard.test.tsx` → PASS; `npm run typecheck:web` clean.
- [ ] **Step 5: Commit** `feat(sets): bulk tile helpers and shared rarity colours`.

### Task 2: `BulkTile` component

**Files:**
- Create: `src/renderer/src/features/sets/BulkTile.tsx`
- Test: `tests/renderer/bulk-tile.test.tsx`

**Interfaces:**
- Consumes: `rarityColor` (Task 1), `CardArt`, `formatUsd`, shadcn `Select`/`Button`.
- Produces:
  ```ts
  interface BulkTileProps {
    card: ChecklistCard
    rarity: ChecklistRarity
    printingId: number            // the chosen code's printing (parent owns the choice)
    onPickCode: (printingId: number) => void
    busy: boolean
    highlighted: boolean
    onAdjust: (printingId: number, delta: 1 | -1) => void
  }
  export const BulkTile: React.MemoExoticComponent<(p: BulkTileProps) => React.JSX.Element>
  ```
  Renders an `<li>` with `role="group"`, `aria-label="{name} {rarity}"`, `data-tile-key="{cardId}:{rarity}"`, `data-highlighted={highlighted}`, `data-owned={rarity.owned > 0}`.

Layout (sizes are the builder's call within the spec): photo button (`CardArt size="small"` with `printingId`, full tile width, `tabIndex={-1}`, label `"Add one {name} {rarity} (photo)"`, click → `onAdjust(printingId, 1)`); rarity badge in the photo's top-left corner coloured by `rarityColor` with the rarity name; under the photo the chosen code (`setCode`), name, and `formatUsd(rarity.price)` when non-null; code `Select` (label `"Set code for {name} {rarity}"`, `showOwned` ×n suffix as in `BulkRow`) only when `rarity.codes.length > 1`; −/count/+ bar (− disabled when the chosen code's `owned === 0`; count = `rarity.owned`, muted + `aria-busy` when busy). Owned → green outline (`ring-2 ring-emerald-500`); highlighted → `ring-2 ring-primary` plus a visible offset (highlight wins when both). Unowned tiles are not greyed. If `printingId` is no longer among `rarity.codes`, use `rarity.defaultPrintingId` (same guard as `BulkRow`).

- [ ] **Step 1: Write failing tests** with Alpha Dragon from the fixture:
  - Secret Rare tile: group `"Alpha Dragon Secret Rare"` shows `MRD-001`, `$40.00`, text `Secret Rare`; no combobox inside; `Remove one Alpha Dragon Secret Rare` disabled.
  - Clicking `"Add one Alpha Dragon Secret Rare (photo)"` and `"Add one Alpha Dragon Secret Rare"` each call `onAdjust(PRINTING.alphaSecret, 1)`.
  - Ultra Rare tile with `printingId={PRINTING.alphaUltraE001}`: combobox `"Set code for Alpha Dragon Ultra Rare"` shows `MRD-E001`; `data-owned="true"`; Remove enabled and calls `onAdjust(PRINTING.alphaUltraE001, -1)`; picking `MRD-EN001` calls `onPickCode(PRINTING.alphaUltraEN001)`.
  - `printingId={999}` falls back to the default: Add calls `onAdjust(PRINTING.alphaUltraE001, 1)`.
  - `highlighted` → `data-highlighted="true"`.
  - Photo: an `img` with the printing scan (`data-testid="printing-scan"`) exists for the chosen printing.
- [ ] **Step 2:** `npx vitest run --maxWorkers=2 tests/renderer/bulk-tile.test.tsx` → FAIL.
- [ ] **Step 3:** Implement `BulkTile` (wrap in `memo`).
- [ ] **Step 4:** Same command → PASS; `npm run typecheck:web` clean.
- [ ] **Step 5: Commit** `feat(sets): big per-rarity bulk tile`.

### Task 3: `BulkMode` grid with its own search; wire into `SetChecklist`

**Files:**
- Create: `src/renderer/src/features/sets/BulkMode.tsx`
- Modify: `src/renderer/src/features/sets/SetChecklist.tsx`
- Delete: `src/renderer/src/features/sets/BulkCard.tsx`
- Test: rewrite `tests/renderer/set-bulk.test.tsx` (keep `createAdjust`/`setup` helpers)

**Interfaces:**
- Consumes: `bulkTiles`, `filterBulkCards` (Task 1), `BulkTile` (Task 2).
- Produces:
  ```ts
  interface BulkModeProps {
    cards: ChecklistCard[]                       // frozen + sorted, NOT filtered by the page q
    pending: Record<number, number>
    adjust: (cardId: number, printingId: number, delta: 1 | -1) => Promise<boolean>
  }
  export function BulkMode(props: BulkModeProps): React.JSX.Element
  ```
  `adjust` in `SetChecklist` now returns the queued promise mapped to `true` on save, `false` on failure (the toast/rollback/invalidate behaviour is unchanged; the returned promise never rejects).

Behaviour in this task: `BulkMode` renders a search `Input` (`type="search"`, label `"Type a card number or name"`, `autoFocus`) above a grid of `BulkTile`s for `bulkTiles(filterBulkCards(cards, query))`; empty-result message `No cards in this set match “{q}”`. Chosen codes live in `BulkMode` state `Record<tileKey, printingId>` (default `rarity.defaultPrintingId`), so they survive filtering. Tile `onAdjust` → `void adjust(card.cardId, printingId, delta)`. `highlighted` is `false` for now. In `SetChecklist`: when `bulk`, hide the header search box and its "no match" message, and render `<BulkMode cards={frozen-and-sorted cards without the q filter} …/>`; the page `q` is untouched. Grid columns: `grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]` (or larger).

- [ ] **Step 1: Rewrite tests** in `set-bulk.test.tsx`. Port every existing test to the new names (groups/buttons keep the same names, so most port by replacing `row(...)` text checks); drop the `'Secret Rare · MRD-001'` text assertion in favour of `within(group).getByText('MRD-001')`. Add:
  - entering bulk focuses `"Type a card number or name"`; header `"Search this set"` is absent.
  - typing `2` shows only `Beta Knight Common` tile; typing `alpha` shows both Alpha tiles; `zzz` shows `No cards in this set match “zzz”`.
  - picking `MRD-EN001` on Alpha Ultra, typing `beta`, clearing, then Add → `adjust` called with `PRINTING.alphaUltraEN001`.
  - header search text `gamma` typed before Bulk add is still in `"Search this set"` after Done, and the bulk box starts empty.
  - photo click adds (`adjust` called with the tile's printing, `1`).
- [ ] **Step 2:** `npx vitest run --maxWorkers=2 tests/renderer/set-bulk.test.tsx` → FAIL.
- [ ] **Step 3:** Implement `BulkMode`, change `adjust`'s return type, wire it, delete `BulkCard.tsx`.
- [ ] **Step 4:** Run `set-bulk`, `set-checklist`, `set-card-panel`, `bulk-row` tests → PASS; `npm run typecheck:web` clean.
- [ ] **Step 5: Commit** `feat(sets): bulk mode shows big rarity tiles with its own search`.

### Task 4: Keyboard highlight, Enter-to-add, "Just added" strip and undo

**Files:**
- Modify: `src/renderer/src/features/sets/BulkMode.tsx`
- Create: `src/renderer/src/features/sets/JustAdded.tsx`
- Test: `tests/renderer/set-bulk.test.tsx`

**Interfaces:**
- Consumes: `BulkModeProps.adjust` returning `Promise<boolean>` (Task 3).
- Produces (`JustAdded.tsx`):
  ```ts
  export interface AddedItem { id: number; cardId: number; printingId: number; name: string; rarity: string; setCode: string; imageId: number }
  export function JustAdded(p: { items: AddedItem[]; onUndo: (id: number) => void }): React.JSX.Element | null
  ```
  Renders nothing when empty; otherwise a `<ul aria-label="Just added">`, newest first, showing at most 8 (small `CardArt` with `printingId`, name, rarity, set code, `Undo {name} {rarity}` button).

Behaviour in `BulkMode`:
- `highlightKey: string | null`. When the query changes, set it to the first visible tile's key. If the highlighted key is not among visible tiles, fall back to the first visible key. Pass `highlighted` to the matching tile and scroll it into view (`scrollIntoView({ block: 'nearest' })`, guarded for jsdom).
- `onKeyDown` on the search input: ArrowRight/ArrowDown → next visible tile, ArrowLeft/ArrowUp → previous (clamped, `preventDefault`); Enter → if a tile is highlighted, `add(tile)` then clear the query; nothing otherwise; Backspace with empty query → undo the newest item (if any, `preventDefault`); Escape with non-empty query → clear it and `preventDefault` + `stopPropagation`. Number-key picking is omitted (spec allows).
- `add(tile, printingId)` is the single path for Enter, tile +, and photo click: push an `AddedItem` (incrementing id) onto the list, call `adjust(…, 1)`, and when it resolves `false` remove that item. The tile's − button calls `adjust(…, -1)` without touching the list.
- `undo(id)`: remove the item and call `adjust(item.cardId, item.printingId, -1)`.
- The list resets when `BulkMode` unmounts (leaving bulk mode).
- Place `JustAdded` beside or under the search box.

- [ ] **Step 1: Write failing tests** (all with the `createAdjust` mock, releasing calls as needed):
  - after entering bulk, the first tile (`Alpha Dragon Secret Rare`) has `data-highlighted="true"`; ArrowRight moves it to `Alpha Dragon Ultra Rare`; ArrowLeft back.
  - type `2`, Enter → `adjust('Metal Raiders','en',PRINTING.beta,1)`; box is empty; `Just added` list has `Undo Beta Knight Common`.
  - type `zzz`, Enter → `adjust` not called.
  - Backspace in the empty box after the add → `adjust(…, PRINTING.beta, -1)` and the list is gone.
  - clicking the strip's `Undo Beta Knight Common` → `adjust(…, PRINTING.beta, -1)`.
  - add then `rejectNext(new Error('x'))` → item disappears; Backspace afterwards does not call `adjust` again.
  - highlight follows identity: ArrowRight to `Alpha Dragon Ultra Rare`, click its `Add one Alpha Dragon Ultra Rare`, `releaseNext()`; after the count updates, `Alpha Dragon Ultra Rare` still has `data-highlighted="true"`.
  - Escape with text clears the box and does not call `onBack` (pass a `vi.fn` `onBack` in `setup`).
  - tile `Remove one …` does not add to the strip.
  - Done then Bulk add again → no `Just added` list.
- [ ] **Step 2:** `npx vitest run --maxWorkers=2 tests/renderer/set-bulk.test.tsx` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Full renderer + main suite `npx vitest run --maxWorkers=2` → PASS; `npm run typecheck` and `npm run lint` clean.
- [ ] **Step 5: Commit** `feat(sets): type-a-number bulk add with just-added undo`.
