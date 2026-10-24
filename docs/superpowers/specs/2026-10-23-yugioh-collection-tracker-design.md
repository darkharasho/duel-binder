# Yu-Gi-Oh! Collection Tracker — Design

Date: 2026-10-23

## Intent

A local, offline-first desktop app for cataloging a personal Yu-Gi-Oh! card
collection. The owner wants "the basic features of most card collecting apps"
with a modern, easy-to-use UI: add the cards they own, find them again quickly,
and see what the collection is worth. Prices matter and should be recent.

## Goals (v1)

- Add, edit (quantity, notes), and remove cards manually.
- A collection entry is identified by **card + set printing + rarity +
  artwork**. Condition is **not** tracked. Edition and language are not
  tracked.
- Each entry shows the artwork of the copy the owner actually has (owner's
  request). Cards with a single art need no extra step.
- Search and filter the collection by name, card type, attribute, level/rank,
  archetype, set, and rarity; sort by name, value, quantity, date added.
- Card details, images, and prices come from the YGOPRODeck API and are cached
  locally so the app works offline after first sync.
- Dashboard: total cards (sum of quantities), unique cards, estimated value,
  breakdowns by rarity and card type, most valuable entries.
- Runs on Linux, Windows, and macOS, with auto-update (owner's request).

## Non-goals (v1)

- CSV import/export or importing from other apps (planned later; the data model
  should not make this hard).
- Wishlist, deck building.
- Condition, edition, or language tracking.
- Trading/marketplace, cloud sync, accounts, mobile.

## Anti-goals

- Requiring a network connection to search or browse the collection.
- Hotlinking YGOPRODeck images or hammering its API (it asks clients to cache
  images and stay under 20 requests/second; violators get IP-banned).
- Stale prices presented as current: the UI must show when prices were last
  updated.

## Constraints

- Stack (decided by owner): Electron, React + TypeScript via Vite, Tailwind CSS
  + shadcn/ui, SQLite via better-sqlite3, YGOPRODeck API.
- better-sqlite3 is a native module: it must be rebuilt for Electron's ABI and
  packaged per-platform. Tests that use it under plain Node need a separate
  build or must run via `ELECTRON_RUN_AS_NODE`. Resolve this in the scaffold
  phase.
- Vitest must run with `--maxWorkers=2` (machine memory constraint).

## Architecture

- **electron-vite** for dev/build; **electron-builder** for packaging
  (AppImage on Linux, NSIS on Windows, dmg + zip on macOS).
- **Main process** owns SQLite, all network access (YGOPRODeck), and the image
  cache. **Renderer** is React; it talks to main only via a typed IPC API
  exposed through the preload script (`contextIsolation` on, `nodeIntegration`
  off).
- **Images** are downloaded on first display into the app's userData directory
  and served to the renderer via a custom protocol (e.g. `ygo-img://<id>`).
  Small thumbnails (`images_small`) for grids, full image in the detail view.

## Card data strategy

- On first launch, download the full card database in one request
  (`https://db.ygoprodeck.com/api/v7/cardinfo.php`, ~13k cards) and store it in
  SQLite. Show progress; the app is usable for browsing the (empty) collection
  meanwhile but adding cards waits for the first sync.
- Each card's `card_sets` array supplies the printings: set name, set code
  (e.g. `LOB-EN001`), set rarity, and per-printing `set_price`.
- Refresh: on startup, if the last sync is older than 24h and the network is
  available, call `checkDBVer.php`; if the database version or date changed, or
  prices are >24h old, re-download `cardinfo.php` in the background and upsert.
  YGOPRODeck updates prices roughly daily, so checking more often gains nothing.
  A manual "Refresh card data" button in Settings forces a sync.
- Sync must upsert, never delete rows referenced by collection entries (if a
  printing disappears from the API, keep the cached row and flag it).
- *Builder's call:* a renamed/re-coded printing looks like "old missing, new
  added". No auto-remapping in v1: the owned entry shows a "no longer in
  database — price may be stale" badge, and the edit dialog lets the user
  re-link it to a current printing of the same card.

## Artwork

- YGOPRODeck lists every artwork for a card (`card_images[]`, each with its own
  image id) but does **not** say which artwork a given set printing uses.
- So artwork is chosen per entry: in the Add dialog, if the card has more than
  one artwork, show the arts as thumbnails after the printing is picked,
  defaulting to the first (`card_images[0]`, the original art). One art → step
  skipped. Editable later from the edit dialog.
- Two copies of the same printing with different arts are separate entries.
- *Builder's call:* no attempt to infer art from the set; the default is the
  original art. Price is the printing's price regardless of art (the API has no
  per-art prices).

## Pricing

- **Value of an entry = per-printing `set_price` (USD, TCGplayer-derived) ×
  quantity.** If `set_price` is missing or 0, fall back to the card's
  `card_prices[0].tcgplayer_price`, and mark the value as approximate in the UI.
- Display "Prices updated <relative time>" on the dashboard and collection
  view.
- *Builder's call:* record a daily snapshot of total collection value
  (one row per day) so a value-over-time chart can be added later; it's cheap
  and can't be reconstructed after the fact. No chart in v1.

## Data model (draft)

- `cards` — id (YGOPRODeck passcode), name, type, frame_type, race, attribute,
  level, linkval, atk, def, archetype, desc, card_prices JSON, image ids,
  updated_at. FTS5 virtual table over name (and desc, builder's call).
- `card_printings` — id, card_id, set_name, set_code, set_rarity,
  set_rarity_code, set_price, missing_from_api flag. Unique on
  (card_id, set_code, set_rarity).
- `card_images` — image_id, card_id, sort order (index 0 = original art).
- `collection_entries` — id, printing_id, image_id, quantity (≥1), notes,
  created_at, updated_at. Unique on (printing_id, image_id). Adding a
  printing + art that already exists increments quantity instead of creating a
  duplicate.
- `value_snapshots` — date, total_value, total_cards.
- `meta` — db_version, last_sync_at, schema_version, settings.
- Schema migrations run on startup, versioned.

## UI

- Left sidebar: Dashboard, Collection, Settings.
- **Add card** (dialog, reachable from anywhere via button and Ctrl/Cmd+K):
  one search box matching card names (FTS) and set codes; pick a card → list of
  its printings (set, code, rarity, price, thumbnail) → pick one → pick
  artwork (only if the card has several) → quantity → save. Fast keyboard
  flow.
- *Builder's call:* the Collection view shows **one row/tile per entry**
  (card + printing + rarity + art), so filtering by set/rarity and sorting by
  value/quantity mean what they say. A card owned in 3 printings appears 3
  times; the detail panel groups them.
- **Collection**: toggle grid (card images) / table (TanStack Table). Filter
  bar with search + facets; sort controls. Clicking an entry opens a detail
  panel with the full card image, card text, all owned printings of that card,
  and edit/remove controls.
- **Dashboard**: stat tiles (total cards, unique cards, estimated value, prices
  updated time), rarity and type breakdowns, top 10 most valuable entries.
  *Builder's call:* "total cards" = sum of quantities; "unique cards" =
  distinct card passcodes; "most valuable" ranked by price × quantity.
- **Settings**: app version + "Check for updates", sync status, last sync, refresh button, cache size + clear
  image cache, open data folder, back up database (copy the SQLite file).
- Light/dark theme following the OS.
- Visual direction is left to the builder: modern, clean, card art forward.

## Phases

1. Scaffold: electron-vite, React/TS, Tailwind/shadcn, better-sqlite3 rebuilt,
   typed IPC, vitest, electron-builder config for all three OSes.
2. Data layer: schema/migrations, card DB sync service, image cache + protocol.
3. Add/edit/remove cards.
4. Collection view: grid/table, filters, sort, detail panel.
5. Dashboard + value snapshots.
6. Settings: sync controls, cache management, DB backup.
7. Packaging + releases + auto-update (see below).

## Releases and auto-update

- Pushing a `v*` tag runs a GitHub Actions matrix (ubuntu, windows, macos)
  that builds with electron-builder and publishes installers plus update
  metadata (`latest*.yml`) to a GitHub Release on this repo.
- The app uses **electron-updater** against GitHub Releases: check on startup
  and every few hours, download in the background, then show an "Update ready —
  restart" prompt. Never restart without asking.
- Platform realities:
  - **Windows (NSIS)** and **Linux (AppImage)**: auto-update works unsigned.
    Windows will show a SmartScreen warning on first install.
  - **macOS**: Squirrel.Mac refuses to apply updates to apps that aren't signed
    with an Apple Developer ID (paid, $99/yr) and notarized. *Builder's call:*
    wire signing + notarization into CI behind secrets
    (`CSC_LINK`, `APPLE_ID`, etc.). When the secrets are absent, the mac build
    is ad-hoc signed and the app falls back to an "Update available —
    download" notice that opens the release page instead of installing
    silently. Turning on full mac auto-update later is just adding the secrets.
- macOS target: universal (arm64 + x64). Version comes from `package.json`;
  tag must match it.

## Left to the builder

Component structure, state management, exact styling, test strategy beyond the
native-module issue, choice of icon set, how the sync progress is surfaced.
