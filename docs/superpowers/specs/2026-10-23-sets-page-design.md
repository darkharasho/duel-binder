# Sets Page — Design

Date: 2026-10-23
Builds on: `2026-10-23-yugioh-collection-tracker-design.md` (v0.1.0, shipped)

## Intent

The owner wants to see every Yu-Gi-Oh! set with its artwork and how close
they are to completing it, open a set to see a checklist of its cards, and
add cards from a set quickly while sorting through a physical stack of them.
Completion tracking is the point; the bulk editor is what makes keeping it
accurate cheap.

## Goals

- A **Sets** page in the sidebar (between Collection and Settings) listing
  sets with their booster/set artwork and completion progress.
- Grid / list view toggle, remembered across launches, like Collection.
- Opening a set shows a **checklist** of every card in it: owned cards in
  colour, missing cards greyed out.
- A **bulk mode** on the checklist with a `−  [count]  +` stepper per card
  per rarity, for fast entry.
- Works offline once synced, like the rest of the app.

## Non-goals

- Edition (1st/Unlimited), language, or condition tracking (still out of
  scope app-wide).
- Wishlist / "want" marking for missing cards.
- Completion stats on the Dashboard (possible later).
- Set-level value totals or price charts.

## Anti-goals

- Inflated or nonsense totals. YGOPRODeck's `num_of_cards` counts printings
  across region codes (Metal Raiders reports 432; the set has 144 cards), so
  it must not be used as the denominator.
- Silent price drift: bulk mode must not collapse different set codes into
  one, because codes of the same card + rarity can differ a lot in price
  (MRD-003 Summoned Skull UR $45.91 vs MRD-E003 $86.25).
- A bulk editor that can lose work: every click saves immediately.

## Definitions (owner-decided unless marked)

- **Set** = a distinct `set_name` among card printings.
- **Count mode** (owner: "rarity or not should be on the user to set"):
  - **Each card once** (default): a set's slots are its distinct cards. A
    slot is filled if the owner has any entry for that card with any
    printing whose `set_name` is this set, any code, any rarity, any art.
  - **Every rarity**: slots are distinct (card, rarity) pairs within the
    set. Codes still don't matter (MRD-003 and MRD-E003 Ultra Rare fill the
    same slot).
  - A toggle on the page, shared by the list and the checklist, remembered
    across launches.
- *Builder's call:* a card counts toward a set only via a printing from that
  set. Owning Dark Magician from Starter Deck: Yugi does not fill Dark
  Magician's slot in Legend of Blue Eyes.
- Totals come from the local printings data: distinct cards (or card+rarity
  pairs) per `set_name`. Verified locally: Metal Raiders → 144 cards, 146
  card+rarity slots; LOB → 126 cards.
- *Builder's call:* printings flagged `missing_from_api` still count, both in
  totals and as owned (the main spec keeps them precisely so owned cards
  don't vanish).
- *Builder's call:* "Started" = at least one slot filled in the current
  count mode (in practice the same set either way).
- *Builder's call:* match `set_name` exactly; no normalisation. A rename
  upstream shows up as a set with placeholder art until the printings catch
  up, which is acceptable.

## Set metadata and artwork

- Fetch `https://db.ygoprodeck.com/api/v7/cardsets.php` as part of the
  existing card-data sync (same cadence, same failure handling: sync failure
  keeps old data). *Builder's call:* a cardsets.php failure does not fail the
  card sync; it is logged, old set data is kept, and it is retried on the
  next sync. On startup, if the sets table is empty and the network is up,
  fetch cardsets.php once even when the card data is fresh, so 0.1.0 users
  get set art without waiting a day. It returns `set_name`, `set_code`, `num_of_cards`,
  `tcg_date`, `set_image` for ~1035 sets. `set_name` is unique there;
  `set_code` is not (e.g. "Metal Raiders" and "Metal Raiders (25th
  Anniversary Edition)" both use MRD), so join on `set_name`.
- Store set rows in a new table via a schema migration: set_name (key),
  set_code, tcg_date, image URL (nullable). `num_of_cards` is not used.
- Sets that appear in printings but not in cardsets.php still show, with no
  date and placeholder art. Sets in cardsets.php with no printings are not
  shown (nothing to complete).
- Set images (~125 sets have none) are cached on first display like card
  images, through the same image cache, rate limiter and timeouts, and served
  via the existing `ygo-img://` protocol under a distinct path for sets
  (builder picks the URL shape; it must not collide with card image ids).
  Set images are fetched only from `https://images.ygoprodeck.com/images/sets/`
  (all current `set_image` values use it); any other URL is treated as no
  image. The cache keys set images by set code file name.
  Missing/failed images show a neutral placeholder tile with the set code.
- YGOPRODeck's image-hosting rules from the main spec still apply: cache,
  never hotlink.

## Sets list (grid and list views)

- Each set shows: art, name, set code, release year (list view: full date),
  "owned / total", percent, and a progress bar. 100% → green bar and a
  "✓ Complete" badge.
- Header line: "You've started N of M sets · K complete" (for the current
  count mode).
- Filter: **Started** (default; ≥1 slot filled) / **All sets** (unstarted
  ones dimmed) / **Complete**.
- Search by set name or set code.
- Sort: most complete (default; percent desc, then owned desc), name,
  release date (newest first).
- Empty state when nothing is started: point the owner to "All sets" and to
  Add card.

## Set checklist

- Header: back link to the list, set art, name, code, release date, progress
  bar for the current count mode.
- Cards in set-number order. *Builder's call:* order by the numeric part of
  the set code of the card's lowest-numbered printing in the set (MRD-003,
  MRD-E003 → 3); ties by name.
- Each card: image (the card's original art, `card_images[0]`, small size),
  number, name. Owned → full colour with a total-quantity badge (×N, summed
  across codes, rarities and arts in this set). Missing → greyscale, faded.
- In **Every rarity** mode a card printed in several rarities is shown once
  per rarity, labelled with the rarity, each filled/missing on its own.
- Filter: All / Owned / Missing. Count-mode toggle as on the list.
- *Builder's call:* the ×N badge counts what that tile represents: all of
  the card's entries in this set (Each card once), or that rarity's entries
  (Every rarity).
- Clicking an owned card (outside bulk mode) opens the existing entry detail
  panel on one of the tile's entries; the panel already lists all owned
  printings of the card. *Builder's call:* clicking a missing card opens the
  existing Add card dialog with that card already picked, showing all its
  printings (not restricted to the set), with this set's default code
  preselected.

## Bulk mode

- A "Bulk add" button on the checklist switches every card to steppers; a
  "Done" button leaves it. Hint text: changes save as you click.
- One stepper **per rarity** the card has in this set (owner-confirmed),
  regardless of count mode.
- Each rarity row's label is a small dropdown of that rarity's set codes in
  this set. Default code (owner agreed to this suggestion): the code with no
  region letter after the dash (MRD-003); else the `-EN` code; else the first
  listed. The stepper's `+` / `−` act on the selected code.
- The stepper shows the total owned for that card + rarity in this set across
  all codes. If the owner holds more than one code of it, the dropdown shows
  the per-code split, and the selected code defaults to one they own.
- `+` adds one copy of the selected code with the original art — the card's
  `card_images` row with sort order 0 — merging into an existing entry for
  that printing + art, as Add card does today. Alt-art copies are managed in
  the entry detail panel, not by the stepper.
- Every rarity row comes from real printing rows, so the selected code
  always exists; there is no "missing printing" case.
- `−` removes one copy from the selected code's entry; reaching 0 deletes that
  entry, with no confirmation (one click to undo). *Builder's call:* if the
  selected code has several entries with different arts, `−` decrements the
  original-art entry first, then the most recently updated one. If the
  selected code has none, `−` is disabled.
- Progress, badges and greying update immediately. Rapid clicking must not
  drop or double-apply changes. *Builder's call:* main takes relative deltas
  (`+1` / `−1` on a printing) applied in one transaction each and returns the
  new counts; the renderer serialises clicks per row rather than guessing
  optimistically.

## Constraints

- Same stack and architecture as the main app: all data access in main via
  typed IPC; renderer has no network access.
- Vitest with `--maxWorkers=2`.
- Must work offline after one successful sync that included cardsets.php.
  Existing users upgrading from 0.1.0 get set data on their next sync; until
  then, the Sets page lists sets from printings with placeholder art.
- Value snapshots must keep being recorded after bulk changes (same as other
  collection mutations). Snapshots are one row per day, so per-click
  recording is fine; the builder may debounce if it measures slow.

## Left to the builder

Component structure, query shapes and indexes (the list must stay fast with
~1000 sets and the owner's collection), exact styling within the existing
theme, how the set-image protocol path looks, keyboard affordances in bulk
mode, and test strategy.
