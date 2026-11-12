# Card panel: your copies first

Date: 2026-11-12
Status: design, approved mockups in conversation (three-state mockup: "You own it", "After Show all", "You don't own it")

## Why

Yu-Gi-Oh printings and rarities are confusing by nature. A popular card can have 25+ printings across
many sets, several artworks (original, chibi, alternate, manga, overframe) and several rarities per set,
in several languages. The card side panel (`src/renderer/src/features/card/CardPanel.tsx` →
`CardTypeList.tsx`) lists all of them as one flat list, one row per set + rarity, each with a heart and a
−/count/+ stepper. The owner finds this overwhelming.

When the owner opens a card, the question is almost always **"which one do I own?"**. Today the
answer is mixed in with every printing that exists (owned rows are sorted first, but look identical to
the rest and the list keeps going).

Success: opening a card you own shows your copies and nothing else to scan past. The full list is
still one tap away and is easier to read when you do open it.

## Goals

1. **Owned card → your copies only.** The panel opens on a short list of the user's copies, one line
   each: art thumbnail, set code, set name, rarity pill, year, price, −/count/+. Below it, one button:
   "Show all N printings" with a summary line ("4 artworks · 17 sets · 3 languages").
2. **"Show all" → grouped full list, your copies stay pinned.** Your copies collapse into a compact
   pinned block (thumbnail, code, rarity pill, stepper) above the full list.
3. **Full list is grouped:**
   - **Art tiles** at the top when the card has 2+ art groups: thumbnail, printing count; the selected
     tile filters the list to that art. Hidden when there is only one art group.
   - **One row per set** (set code prefix + English set name + year). The set's printings for the
     selected art become **pills** on that row: rarity/version name + price. A pill for a printing the
     user owns is gold-outlined with its owned count instead of the price.
   - **Language filter:** "English" (default) / "All languages". Default may be smarter (see builder's
     calls).
   - **Sort:** newest first by default (by set release date), with a toggle for oldest first.
4. **Not owned → opens straight on the full grouped list** ("You have none yet" heading). The headline
   price stays as today's fallback.
5. **All four games** (Yu-Gi-Oh, Pokémon, One Piece, Magic) get the same layout, on desktop, the web
   app and the phone (the phone uses this same panel via `isPhone()`).

## Non-goals

- The scan printing picker (`features/scan/PrintingPicker.tsx`) is not changed. That's a later,
  separate piece; this panel's grouping helpers should be written so the picker can reuse them.
- Browse/Collection grid overload (the owner's second complaint) is out of scope here.
- No change to how prices, wishes, binders or `sets.adjust` work; only how rows are laid out and
  grouped.
- No new art-identification data pipeline (no fetching of per-printing artwork ids).

## Anti-goals (would make this a failure even if it works)

- Owned copies harder to find or edit than today.
- A wrong art grouping that hides a printing the user owns, or makes it look like they own a different
  art. If unsure which art a printing is, it goes in the original group, never hidden.
- Losing any action the current rows have (wish heart, binder add, −/+ with the serial queue and
  last-copy confirm, selecting a row to show it in the panel's art/price header).
- Noticeably slower panel open.

## Behaviour details

### Your copies block

- One line per row in today's `cardTypeRows` that has copies (a printing can have several entries,
  e.g. scanned different art; each stays its own line, as today).
- Thumbnail: the entry's own image (`scanFor(entry)` / `entry.imageId`, the art the panel already shows
  for that entry). This is what makes "the chibi one" recognisable without any art grouping data.
- Clicking a line selects it (panel header shows its art + price), as rows do today. The stepper and
  last-copy confirm behave exactly as today.
- Heading: "You have N" plus total value ("· worth $X") from the copies' unit prices.
- Wish heart: not needed on owned lines (you have it). Wishing stays available on full-list pills (see
  below).

### Show all

- Collapsed by default when the user owns at least one copy; the expanded/collapsed choice resets per
  card (not remembered).
- When the panel is opened from a set's checklist with `onlySet` (Sets page), keep today's behaviour:
  list only that set's printings. In that case the grouped list is just that set, no "Show all" gate
  is needed if the set has ≤ 8 printings (builder's call on exact threshold).
- `preferSet` (opened from a set) still puts that set's row first in the full list.

### Full list

- Each pill: rarity/version swatch (`rarityColor`), name, price (or owned count, gold), and is
  clickable to select that printing (header shows it). A selected pill shows the current
  −/count/+ and wish heart in a small action row under its set row (so nothing current is lost),
  instead of every pill carrying its own stepper.
- Existing search box (YGO, > 8 rows) stays, above the full list, and filters set rows by set name,
  code or rarity as today.
- Missing-from-API printings follow today's rules (listed only while owned).

### Art groups per game

| Game | Art key | Notes |
|---|---|---|
| Yu-Gi-Oh | `card_printings.variant`, normalised: no variant / same-art variants (`SAME_ART_VARIANT` in `src/main/yugipedia/printingArt.ts`: foil colours, editions, stamps, Pharaoh's Rare…) / "New artwork" → **Original**; others ("Chibi", "Overframe", "Alternate Art", "Manga-Style"…) → their own group, labelled with the variant | Known gap: unsuffixed "New artwork" printings and alt arts with no variant label land in Original. Acceptable. |
| One Piece | `artImageId` (present = that alt art's own image; absent = original) | Group label "Original" / "Alternate Art"; several alt arts → "Alt art 1, 2…" or the variant text if available |
| Pokémon | none; versions share art | No art tiles. Pills are versions (Normal / Reverse Holo / Holo / stamped…), as `setRarity` |
| Magic | none in v1 (one card row per language; printings already per set) | No art tiles. Pills are finishes (`magic.ts` finish from rarity text) |

Tile thumbnails: the printing photo the app already resolves for one printing in that group (YGO
printing art / `artImageId`), falling back to the card's default image.

### Year

From the set's release date (the same date `EntryView.releaseDate` uses: the printing's set, else
the English set's). Hidden when unknown.

## Constraints

- `Printing` (src/shared/types.ts) doesn't carry `variant` or a release date today; they must be added
  where the card detail is built for **both** the desktop main process (`src/main/repo/cards.ts`
  `rowToPrinting`) and the portal Worker that serves the web app / phone (`workers/portal`). Deploy the
  portal before tagging a client release (memory: deploy portal before tag).
- Keep `CardTypeList`'s in-flight count logic (serial queue, optimistic overlay, browse patching) as is;
  the redesign is layout + grouping on top of it.
- Grouping logic in a pure, unit-tested module (like `cardTypes.ts`) so the scan picker can reuse it
  later.
- Tests: vitest with `--maxWorkers=2`. Run `typecheck:web` and `typecheck:phone` separately (memory:
  `npm run typecheck` stops early).
- Existing tests on `CardTypeList` / `CardPanel` will need updating for the new structure; keep their
  behavioural intent (counts, confirm, selection).

## Calls made after the builder check (designer's calls, not the owner's)

1. **Yu-Gi-Oh art groups use an allow-list.** Read the variant with the existing `printingVariant()`.
   That covers both the `variant` column and a rarity in parentheses, like "Ultra Rare (Overframe)".
   Strip wiki markup (`[[a|b]]` → `b`), normalise case and spelling, then match a short list of
   known art kinds: Chibi, Overframe, Alternate art/artwork, Manga-Style, Anime, Japanese artwork,
   International artwork. Anything else goes to Original, including "Alternate password", "Stamp
   artwork", token colours and anything unrecognised. The tests cover these real labels.
2. **One tile per art kind, not per picture.** Two different "Alternate art" pictures from
   different sets share one tile. That's accepted for v1. The tile thumbnail comes from the newest
   printing in the group.
3. **Copies whose own art differs from their printing's group.** An example is a scanned alt art
   on a plain printing, which is an entry-only row with `viaPrinting = false`. These are shown and
   edited in the Your copies block, with their own thumbnail. In the full list, the printing's pill
   counts only what today's printing row counts (the `viaPrinting` row). The −/+ on a selected pill
   does what that printing row's stepper does today. Entry-only rows are edited only in Your
   copies, so the count logic doesn't change.
4. **Set rows.** A row is keyed by set name + language. Under "All languages", each language gets
   its own row with a language tag. When pills on one row would read the same, they add the same-art
   variant ("Ultra · 1st Edition", "Secret · Red"). When one set holds the card under two codes,
   each pill shows its code suffix.
5. **Wish heart.** Owned lines don't show it, as in the approved mockup. Wishing stays one tap
   away on the full list's selected pill, so the action isn't lost. If a printing you own is
   already wished, its owned line shows a small filled heart, so that state stays visible.

## Left to the builder

- Component split (e.g. `OwnedCopies`, `PrintingGroups`, `ArtTiles`) and file names.
- Exact visual styling within the app's existing tokens (mockup is a guide, not a spec).
- Language default: "English" unless the user owns or opened a non-English printing, in which case
  that language is included (builder may choose "All" when the card has no English printings).
- Whether the "Newest/Oldest" toggle is worth including in v1.
- Phone spacing; the phone currently puts the list before card details, keep that ordering.
- Thresholds (when to show the search box, when `onlySet` skips the Show-all gate).
