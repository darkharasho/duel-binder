# Bulk add redesign: big rarity tiles + type-the-number

Issue #29. Replaces the current bulk add mode on a set's checklist (`SetChecklist.tsx` → `BulkCard` / `BulkRow`).

## Why

The user adds cards a stack at a time: a pile of cards from one set in hand, entering each one. With today's bulk mode,
"the icons were too small and it was too slow to discover which is which and what the card looked like." Two problems,
equally painful:

1. **Finding the card** in the set. The grid is a wall of 14rem rows with a 56px thumbnail each.
2. **Telling its rarities apart.** Each rarity is a text row ("Ultra Rare · LOB-EN001") next to one thumbnail that only
   shows the first rarity's photo.

Success: with a card in hand, the user can type the number printed on it, see every rarity of that card as a full-size
photo, and add the right one in a keystroke or a click, then move straight to the next card.

## What gets built

Two parts that work together, both inside bulk mode only. The normal checklist (browse tiles, side panels) is unchanged.

### A. Big tiles, one per rarity

Bulk mode shows a grid of **one tile per (card, rarity)**, not one box per card. A card with three rarities appears as
three tiles side by side, in the checklist's current sort order, rarities of one card adjacent.

Each tile:

- **Photo**, large: about the size of a normal-checklist tile or bigger (target min column ~11rem; builder's call on exact
  size, but it must be clearly bigger than today's 7.5rem browse tiles so rarities are recognisable). Uses
  `CardArt` with `printingId` = the tile's selected printing, so each rarity shows its own printing scan and falls back to
  the card art when there is none.
- **Rarity badge** over a corner of the photo, coloured by rarity. Reuse the collector colours already in
  `DashboardPage.tsx` (`RARITY_COLORS`); move them to a shared module rather than duplicating.
- Under the photo: number label (e.g. `LOB-EN005`), name, and the rarity's price (`ChecklistRarity.price`) when known.
- **−/count/+ bar** along the bottom, same semantics as `BulkRow` today (count = `rarity.owned`; − disabled at 0 for the
  selected code).
- **Clicking the photo adds one** (same as +).
- **Owned tiles get a green outline**; unowned tiles are *not* greyed out (the user needs to see them clearly to pick).
- Where one rarity has several set codes, the tile keeps a small code picker (today's `Select` in `BulkRow`); the
  picker's choice is the printing that + / click / Enter adds and whose scan is shown.
- Busy state per card as today (`pending[cardId]`).

### C. Type the number

A search box pinned at the top of bulk mode, **focused when bulk mode opens**.

- Typing narrows the grid to matching cards' tiles. It matches like today's `matchesCardSearch` (name, number label, set
  code), but a **purely numeric query matches the card number exactly** first ("178" → number 178 / `…-EN178`, not
  1178 or 17), so a typed number lands on one card. Builder's call on how partial numbers behave as long as typing the full
  number printed on the card narrows to that card.
- The **first visible tile is highlighted** (clear ring) whenever the query changes.
- Keys, while the box has focus:
  - **← / →** (and ↑ / ↓) move the highlight between visible tiles.
  - **1–9** pick the Nth visible tile — only when the query is non-empty and numeric digits wouldn't be better read as
    more of the number. *Builder's call:* simplest acceptable rule is that digits always go into the box, and number-picking
    uses Alt+1–9 or similar; or skip number-picking. Arrows + Enter are the must-have.
  - **Enter** adds one copy of the highlighted tile, then **clears the box** so the next number can be typed right away
    (user confirmed).
  - **Backspace on an empty box** undoes the last add from this session.
  - **Esc** clears the box (full grid back). Esc on an empty box keeps today's behaviour of nothing special inside the
    input (the page-level Esc-to-leave shortcut already ignores inputs).
- Mouse and keyboard mix freely: clicking a tile also counts as an add for the "Just added" strip and undo.

### "Just added" strip

A strip near the search box listing this bulk session's adds, newest first: small photo, name, rarity, set code, and an
**undo** button per entry (undo = −1 on that printing). Backspace-on-empty undoes the newest entry. Shows the last several
(builder's call, ~8) with the rest scrolled or dropped. Cleared when leaving bulk mode. Only adds made in this bulk
session appear; − clicks remove nothing from the list but an undo removes its entry.

## Unchanged

- Adds save immediately through the existing `adjust(cardId, printingId, delta)` queue in `SetChecklist.tsx` (optimistic
  count, serial per card, toast on failure). No separate save step. "Changes save as you click." stays.
- "Bulk add" / "Done" button, the Show filter (All / Owned / Missing), sort, and the frozen id list so a save never
  re-filters a card away mid-session.
- Leaving bulk mode returns to the normal checklist.
- `BulkRow` stays for `SetCardPanel` (side panel for unowned cards).
- Works the same in the desktop app and the web portal (same renderer; `api.sets.adjust` exists in both).

## Non-goals

- No camera / scanning, no OCR.
- No adding cards outside the open set (cross-set entry stays in the normal Add Card flow).
- No condition / language / notes per add — bulk adds the default as today.
- No change to the normal (non-bulk) checklist or to data shapes from main (`ChecklistCard` / `ChecklistRarity` already carry
  everything needed).

## Anti-goals

- Typing must never be slow: filtering a large set (hundreds of tiles) on each keystroke must feel instant.
- Enter must never add the wrong thing silently: if nothing is highlighted (no matches), Enter does nothing.
- Undo must only ever reverse an add the user made in this session.

## Constraints

- Tests: vitest with `--maxWorkers=2`. Renderer tests live in `tests/renderer/` (`set-bulk.test.tsx` covers the current
  bulk mode and will need rewriting).
- Match the surrounding code style (Tailwind, shadcn components, `cn`, comment density).

## Calls made after the builder check (Claude's calls, not the user's)

1. **Strip records on click, drops on failure.** An add appears in "Just added" immediately; if its save fails (the
   existing rollback + toast), its entry is removed. `adjust` therefore needs to report each op's outcome (e.g. return
   the queued promise, or take an `onFailed` callback). Undo is allowed while a card has saves in flight — the per-card
   queue is serial, so the −1 lands after the +1.
2. **Numeric query is exclusive when it hits.** A purely numeric query (`/^\d+$/`) shows only cards whose `number`
   equals it; if no card has that number, it falls back to the normal `matchesCardSearch`. Cards with `number: null`
   never match the exact rule. Non-numeric queries ("LOB-178", names) use `matchesCardSearch` as today.
3. **Bulk mode has its own search box,** separate from the page `q`. The header search box is hidden while bulk mode is
   open; the bulk box starts empty, is focused on entry, and is discarded on exit. The page `q` is left untouched for
   when the user returns to the checklist.
4. **Code picker is mouse-only,** and each tile's chosen code persists for the bulk session (state keyed by
   `cardId + rarity`, held above the grid so filtering doesn't reset it). Enter adds the tile's currently chosen code.
5. **Highlight follows the tile's identity** (`cardId + rarity`), not its index; it resets to the first visible tile
   only when the query changes, or when the highlighted tile is no longer visible.
6. **Images:** `CardArt`'s `loading="lazy"` plus memoised tiles; no virtualisation unless it measurably lags.

## Left to the builder

- Exact tile size, badge styling, strip placement and length.
- Number-key picking rule (or omitting it).
- Whether the search box in bulk mode is the existing header search or a separate one, as long as it's focused on entering
  bulk mode and drives both the filter and the keys.
- Component split (e.g. `BulkTile`, `BulkSearch`, `JustAdded`).
