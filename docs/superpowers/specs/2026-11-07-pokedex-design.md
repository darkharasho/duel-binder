# Pokédex — design

2026-11-07 · owner request, brainstormed in chat with mockups.

## Intent

A Pokédex page in the Pokémon section: a grid of every Pokémon by National Dex number with a progress bar,
where owning **one card of any kind** of a Pokémon "catches" it. It turns a Pokémon collection into a
gotta-catch-'em-all goal and shows at a glance which Pokémon you still have no card of.

## What the owner decided

- **Grid of every Pokémon with a progress bar** (e.g. "312 / 1025 caught").
- **One card of any kind counts**: any set, rarity, language, condition.
- **Forms count toward the base Pokémon**: Alolan Vulpix, Mega Charizard X etc. fill the base slot; no
  separate form entries.
- **Clicking a Pokémon shows the cards you own of it and the ones you're missing.**
- **Tiles use pixel game sprites** (PokeAPI's Black/White-style set): caught in colour, missing as a black
  silhouette. The owner accepted the IP risk of game sprites (they're Nintendo's, unlicensed by PokeAPI) over
  card-art tiles; card-art tiles are the fallback if a complaint ever comes.
- **Sprites are hosted on our R2**, not hotlinked from GitHub.
- **Everywhere**: desktop app, phone app, web portal (app.duelbinder.com).
- **Ships to everyone at once**: no tester gate. The builder looks through the 650+ sprites for consistency
  before release.

## Goals

- Pokédex page for the Pokémon game only, on desktop, phone and web.
- Header: caught / total, percentage, progress bar.
- Filters All / Caught / Missing, and generation jumps (I–IX) each with its own caught / total.
- Grid of 1025 tiles in dex order: sprite, name, number; caught in colour with a ×N copies badge (when N > 1),
  missing as a silhouette with muted text.
- Clicking a tile opens a detail panel (side panel on desktop/web, sheet on phone): the Pokémon's sprite, name,
  number, "you have X cards · N missing"; **Yours** (owned cards with copy counts) and **Missing** (catalog cards of it
  you don't own), each card opening the existing card detail.

## Non-goals

- Separate entries for regional forms, Megas, Gigantamax, etc.
- Per-rarity or "master set" completion; shiny dex.
- Friends' Pokédexes (could come later; not in this build).
- Any trading/marketplace angle (out of scope for the app).

## Anti-goals (failure even if it "works")

- Wrong catches: a Pokémon lit up that you have no card of, or a card you own not counting. Correctness of
  the card → species mapping matters more than coverage of odd cards.
- A slow page: 1025 tiles must scroll smoothly and open fast on the phone (sprites are tiny; render lazily if
  needed). Opening the page must not stall the main process (see the sync-price-freeze history).
- Trainer and Energy cards counting toward anything.

## Constraints and facts from the code

- The catalog build already fetches TCGdex `dexId` (`scripts/catalog/pokemon/types.ts:20`) but **doesn't
  store it**. A new column on `pokemon_cards` (e.g. `dex_ids`, a card can show several Pokémon — Tag Team
  "Pikachu & Zekrom-GX" has two) must be added to the schema, `MIGRATIONS` + the Worker's `SERVER_STEPS`, the
  row writer (`scripts/catalog/pokemon/write.ts`) and `src/shared/catalogTables.ts` so it syncs.
- Not every card has a TCGdex `dexId`: Simplified Chinese (from the PTCG-card-data list), TCGplayer-only
  upcoming cards. These take it from their `art_twin_id` English card, else by English name match. TCGdex's
  Japanese `dexId` is sometimes wrong (`match.ts:183-186`); prefer the same checks the build already uses.
- Each language is its own `cards` row; a Japanese Charizard catches Charizard just like an English one.
- Data flows through one data channel used by all three clients: desktop runs `src/main/repo/*` on SQLite,
  phone runs the same handlers on its wasm SQLite (new `DATA_CHANNELS` channels work automatically), web goes
  through `/api/rpc/:channel` (add to `PORTAL_CHANNELS`, `rpc.ts`, `httpApi.ts`). Worker DO SQLite rejects big
  compound UNIONs — keep the query simple.
- Pages: add to the `Page` union, `NAV_GROUPS`, the phone `MORE`/`TABS`, `PageSwitch`; gate to Pokémon with a
  new `features.pokedex` flag checked in `pageInGame`.
- Sprites: new R2-only image family like `hand/` art, e.g. `/img/sprite/<dexNo>` → R2 key `sprite/<n>.png`,
  year-long public cache, optional edge fast path in `edgeImage`. Uploaded once by a script (admin PUT like
  `opArt.ts`). Render with `image-rendering: pixelated`.

## Builder's calls (made by me in the brainstorm, not by the owner — flag if wrong)

- Species list is a static file in `src/shared` (1–1025: number, English name, generation). New species need
  a code update; fine.
- "Caught" = at least one live collection entry (`deleted_at IS NULL`, quantity > 0); removing your last copy
  uncatches it.
- A multi-Pokémon card (Tag Team) catches every Pokémon on it.
- ×N badge = total copies you own of that Pokémon across all cards.
- The unit in the panel is a **card** (one `cards` row: set + number + language), not a printing variant.
  Owning any printing (normal, reverse holo…) of a card owns that card; variants aren't listed separately.
- **Missing** lists English cards of that Pokémon you don't own (all languages would make Charizard's list
  huge), showing a first handful with "Show all". If a Pokémon has no English card at all, Missing falls back
  to its cards in other languages. Yours lists every language you own.
- The panel subtitle is "you have X cards" (X across all languages) plus "N missing" — no "X of Y", since Y
  would be English-only and could be smaller than X.
- Phone: Pokédex sits in the "More" sheet, not a bottom tab.
- Sprite set: PokeAPI `sprites/pokemon/versions/generation-v/black-white/<n>.png` (96×96). Files exist for
  1–1025, but 650+ are community-made in BW style rather than game rips; check they look consistent, and keep
  a credit line (PokeAPI + sprite artists) on the page or in the About/legal page.

## Left to the builder

- Exact query shape and indexes for species counts; whether counts come in one call (grid) plus one per
  Pokémon (panel).
- Virtualisation vs. lazy images for the grid.
- How "Show all" for Missing is presented (expand in place or link to a filtered card browser).
- Backfilling `dex_ids` for existing catalog rows (nightly build rewrite vs. one-off).
