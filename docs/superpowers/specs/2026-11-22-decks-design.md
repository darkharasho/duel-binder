# Decks

Date: 2026-11-22. Written against `origin/main` at `c302df84`.

## Intent

People who collect cards also play them. Today the app knows what you own, but you can't write down the deck you take to locals or the one you're working towards. You also can't ask whether it's legal, or what it would cost to finish.

A **deck** is a named list of cards in one game and one format. You build it in the app or paste it in from elsewhere, and keep editing it as you go. As you edit, the app gives **feedback**: whether the deck is legal in its format, and which cards you don't own yet and what they would cost. The feedback comes from the app, worked out from each game's rules, not from other people.

Managing decks has to feel natural and flawless in every game. That means each game's own sections, limits and list formats, not one generic list with a game label on it.

## Goals

- A **Decks** section in every game, on desktop, web and phone.
- Create, edit, duplicate, rename and delete decks. Sections and copy limits follow the game and format.
- **Import** a pasted list or a file in each game's usual format, and **export** it back out.
- **Legality feedback**: a live list of problems against the deck's format, and a legal/not-legal badge.
- **Missing cards**: owned vs needed per card, and a total cost to finish.
- Sync across devices. Friends can see decks, and each deck has a private toggle.
- Ship one game at a time: Yu-Gi-Oh! first, then Pokémon, One Piece and Magic.

## Non-goals

- **Play advice** (opening-hand odds, ratios, "your deck needs more Energy"). The owner wants this later. This design must not rule it out, but builds none of it.
- Comments or reactions from friends on decks.
- Public share links, or a public deck browser. Friends see decks through the friend page, as with binders.
- Decks that span games.
- Tracking which physical copies sit in which deck ("you have 3, and 2 are in another deck"). This is parked for later.
- Trading or marketplace features (project-wide). Affiliate buy links for missing cards are allowed, because they already exist elsewhere in the app.
- Formats beyond the table below in v1: no Goat, Edison, Genesys, GLC, Brawl, Oathbreaker, Historic or Timeless.

## Anti-goals

These would make it a failure even if it technically works:

- An import that drops or changes cards without saying so. Every line that doesn't match shows up for the user to fix.
- A legality verdict that is wrong because the rules data is stale or silently missing. If the rules pack for a game can't be loaded, the deck shows "Legality unknown" rather than "Legal".
- An edit that blocks the user. A deck can always be saved, even when it is illegal or still being built.
- Anything that adds weight to the catalog pull or the shared Durable Object. Past freezes came from both (see `catalog-open-games-freeze`, `web-app-slowness`).
- Feedback that lags typing. Checks run on the device, in milliseconds, on every edit.

## Decisions by the owner

- Feedback is driven by the app, based on rules: legality and missing cards first, play advice later.
- Build in the app **plus** import/export.
- Formats, sections and limits as in the table below, with feedback as a live panel, decks counted by card rather than printing, cheapest English printing for cost, shared copies counted by every deck, and unmatched import lines listed rather than dropped. These were proposed by Claude and confirmed by the owner ("looks right").
- **Approach A** (rules pack in R2, checks on the device).
- Ship order: Yu-Gi-Oh!, Pokémon, One Piece, Magic.
- Decks on web and phone are online-only, like binders: edits save straight to the portal and need a connection. The checks still run on the device. Desktop works offline as always. Offline phone editing can come later if people need it at events.
- Claude's calls (Pokémon card key, region pricing for OCG, errors vs warnings, the changed-overnight notice, friends without notes) were reviewed and accepted.

## Approaches

**A. Rules pack plus checks on the device (chosen).** A nightly job writes a small legality file per game to R2. Each client downloads and caches it. Plain shared TypeScript in `src/shared/decks/` runs the checks on desktop, web and phone alike. Feedback is instant and works offline. A banlist change reaches everyone the next night with no app release. The cost is one new fetched artifact per game, with its own freshness handling.

**B. Legality columns in the catalog.** Banlist status and format legality would be stored on card rows and arrive with the normal catalog pull. This reuses existing machinery, but every banlist update rewrites card rows in catalogs of up to 2M rows, and the snapshots would have to be rebuilt. That is the kind of heavy pull that froze the desktop in v0.95. Rejected.

**C. Checks in the portal Worker.** The client would send the deck and get problems back. That gives one source of truth, but it doesn't work offline (the desktop is offline-first), adds a round trip on every edit, and puts more load on the one shared DO. Rejected.

## Formats, sections and rules

Each deck has one `game` and one `format`, fixed at creation. Changing the format is allowed and just re-runs the checks.

| Game | Formats (v1) | Sections | Rules checked |
|---|---|---|---|
| Yu-Gi-Oh! | Advanced (TCG), OCG | Main 40–60, Extra 0–15, Side 0–15 | Max 3 copies by card across all three sections. Forbidden 0, Limited 1, Semi-Limited 2 per the format's list. Extra Deck monsters (Fusion, Synchro, Xyz, Link) only in Extra or Side; nothing else in Extra. A card not released in that region yet (TCG/OCG) is flagged. |
| Pokémon | Standard, Expanded | Deck exactly 60 | Max 4 copies by name, except basic Energy. Exactly one ACE SPEC at most. Only one Radiant Pokémon. At least one Basic Pokémon. Each card has a printing legal in the format (regulation mark for Standard, Expanded legality from data). Banned list per format. |
| One Piece | Standard | Leader exactly 1, Deck exactly 50 | Max 4 copies by card number. Every Deck card shares at least one colour with the Leader. No Leaders in the Deck. Banned/restricted list. DON!! cards aren't part of the list and are ignored on import. |
| Magic | Standard, Pioneer, Modern, Legacy, Vintage, Pauper, Commander | Main, Sideboard; Commander adds a Commander zone (1–2, partner rules) | 60+ main and 0–15 side (Commander: exactly 100 including commander, no sideboard). Max 4 copies by name, or singleton in Commander, except basic lands and cards whose text allows any number. Banned/restricted per Scryfall's legality per format (Vintage restricted means 1). Commander: colour identity within the commander's, and the commander must be legal as a commander. |

**Pokémon card identity (Claude's call).** Copy limits go by name, which is the official rule. Ownership and legality go by a *card key*, meaning the same English name with the same attacks and abilities. The rules pack carries this key as a reprint group per card, built from TCGdex. Japanese and Chinese printings join the group through the catalog's existing twin links. So owning a Japanese Ultra Ball fills an Ultra Ball slot, and an old Ultra Ball is Standard-legal through its current reprint. A different Pikachu with different attacks is a different card key. ACE SPEC and Radiant cards come as card-key lists in the pack, not from the rarity field. The Pokémon banned list and rotation mark are hand-kept in `src/shared/decks/rules/pokemon-manual.json`, next to the One Piece file.

**Errors and warnings (Claude's call).** A problem is either an *error*, which makes the deck "Not legal", or a *warning*, which doesn't. Warnings cover a card not yet released in the format's region (YGOPRODeck dates are off by a few days around releases, and people build ahead), and a rules pack older than 14 days. The badge says "Legal", "Legal · 2 warnings" or "Not legal".

**Changed overnight (Claude's call).** Each deck stores its last verdict and the pack version it was checked against. When a newer pack flips the verdict, the deck shows "Changed with the 2026-12-01 list", naming what changed ("Maxx \"C\" is now Forbidden"), until the user opens the deck.

"By card" means the game's identity for copy limits: the card name for Pokémon and Magic (with the usual Pokémon exceptions handled by the rules data), the passcode/konami id for Yu-Gi-Oh!, and the card number for One Piece.

Rules that need card text to judge, such as Magic's "A deck can have any number of cards named…" or Yu-Gi-Oh! cards with deck-building conditions, are handled through a per-game exceptions list in the rules pack, not by parsing card text.

## The rules pack

- One JSON file per game in R2, `rules/<game>.json`, written by the nightly `catalog.yml` run. It's served through the portal's existing edge-cached `/img`-style route, or a new `/rules/<game>` route, with a long edge TTL and an ETag.
- Contents: `version`, `builtAt`, sources with their dates, and for each format the limited/banned lists and the legal-card data the checks need (regulation marks or legal set codes for Pokémon, a legality map for Magic, region release data for Yu-Gi-Oh!).
- Sources:
  - Yu-Gi-Oh!: YGOPRODeck `banlist_info` (`ban_tcg`, `ban_ocg`) plus TCG/OCG release dates.
  - Pokémon: TCGdex `legal.standard` / `legal.expanded` and `regulationMark`, plus a small hand-kept list for the Standard rotation mark and the banned list.
  - One Piece: a hand-kept file in the repo, `src/shared/decks/rules/onepiece.json`, since Bandai publishes no feed. It's updated by PR when Bandai changes its list. The pack builder copies it in.
  - Magic: Scryfall bulk `legalities` per card.
- Size target: under 100 KB gzipped for Yu-Gi-Oh!, Pokémon and One Piece. Magic legality across ~30k names is the big one, so store it as a compact name→bitmask map and measure it. If it's over ~1 MB gzipped, split it per format.
- Clients fetch the pack when a deck for that game is first opened, then again when it is older than 24 h. They cache it locally (SQLite meta on desktop, IndexedDB/Cache API on web and phone). If there's no pack and no network, legality shows "unknown". A pack older than 14 days shows a "rules may be out of date" note.
- The pack carries a schema `version`. An app that is too old for the pack's version shows "update to check legality" instead of guessing.

## Data model and sync

Decks follow the binder pattern (local desktop tables, a portal DO table, seq-based push/pull, friend reads), so a builder should model `src/main/repo/binders.ts`, `workers/portal/src/binderSync.ts` and `workers/portal/src/friendBinders.ts`.

- `decks`: `id` (uuid), `game`, `format`, `name`, `notes` (free text, private like graded notes), `cover` (a card id for the tile art), `private`, `last_verdict` + `last_pack_version` (see Changed overnight), `created_at`, `updated_at`, `deleted`.
- Deck contents are stored as one serialized list on the deck row (`cards`: `[{ section, card, printing?, qty }]`), not as per-card edit rows. A deck is small (≤ 115 entries) and edited as a whole, so last-writer-wins per deck, with the newer `updated_at` winning, is enough. This avoids binder-style edit sequences.
- `card` is the game's card id as the catalog already uses it. `printing` is an optional pinned printing for the art shown. It never affects legality or ownership.
- Limits: 200 decks per owner per game, 300 entries per deck, an 80-character name and 2,000-character notes.
- Portal: the next free `server-NN` migration adds a `decks` table, keyed by user, to the shared `Store` DO (there is no per-user DO). Desktop sync adds `decks-push` / `decks-pull` routes, run in the same scheduled sync pass as binders. That's one more call per sync and none per edit. The server keeps its own stamp and clamps future client times through `checkTime`.
- Web and phone use `decks:*` RPC calls, following the `binders:*` ones in `workers/portal/src/rpc.ts`. `decks:get` returns the card facts the checks need, so neither client has to pull a catalog. Saving needs a connection (owner's decision); without one the deck page says so and keeps the unsaved edit on screen.
- Friends: a Decks tab on the friend page, shown only if the friend has a visible deck. Friends see the cards, format, legality and the owner's owned/missing view, the same as friend binders. Notes are never shown. (Claude's call.)

## Missing cards and cost

- For each entry, the app shows owned vs needed. Any owned printing of the card counts, in any language, condition or graded state.
- Cost to finish = the sum over missing copies of the cheapest current printing price the app already has (TCGplayer/eBay as today). It uses English printings for Advanced and Western formats, and the region's own printings (Japanese, Asian eBay prices) for OCG decks, or wherever the card has no English printing. (Claude's call; the owner's "cheapest English printing" assumed English-format decks.) For a card with no price, cost shows "+N unpriced" instead of guessing.
- Shared copies count for every deck (owner's decision). No reservation between decks.
- The missing list has a "copy as list" export and the existing affiliate buy link per card.
- A deck view filter, "show only cards I own", applies in the add-card search, not as a separate building mode.

## Import and export

Per game:

| Game | Import | Export |
|---|---|---|
| Yu-Gi-Oh! | `.ydk` file or paste, `ydke://` URL, plain "3 Ash Blossom & Joyous Spring" text | `.ydk`, `ydke://`, plain text |
| Pokémon | Pokémon TCG Live / PTCGO text (`4 Pikachu ex SVI 057`, section headers) | the same text |
| One Piece | OPTCGSim / common text (`4xOP01-016`) | the same text |
| Magic | Arena/MTGO text (`4 Lightning Bolt (2X2) 117`, Deck/Sideboard/Commander headers) | Arena text, MTGO text |

- Matching goes by the most exact identifier the line has: passcode, then set code + number, then name. Names match case- and accent-insensitively, and on Pokémon also check `local_name`.
- The import screen shows a preview: matched lines, ambiguous lines (several cards share the name, so pick one), and unmatched lines. You can fix or drop them before saving. Nothing is dropped silently.
- An import can create a new deck or replace an existing deck's contents (with confirmation).
- Export copies to the clipboard, and on desktop also saves a file for `.ydk`.

## Screens

Shapes follow the binder screens and the app's current look, and are left to the builder within these lines:

- **Decks list** (per game): deck tiles with cover art, name, format, card count, a legal/not-legal badge and the cost to finish. Actions: New deck, Import.
- **Deck page**: sections as columns or stacked groups, each with a running count against its limit (Main 41/40–60). Entries show art, name, qty with +/− and a printing pin. Search-and-add sits on the page, with section targeting: a Yu-Gi-Oh! Extra monster goes to Extra by default, and a One Piece Leader to the Leader slot.
- **Feedback panel**, beside the deck on desktop and web, and a collapsible sheet on phone. It lists the problems in plain language ("Main Deck has 62 cards; the limit is 60", "3 × Pot of Greed: Forbidden in Advanced"), each tapping through to the card. There's a summary line for legality, then Missing cards with the cost.
- **Card panel** (shared): an "Add to deck" action next to "Add to binder".
- **Friend page**: a Decks tab, read-only.

## Steps

Each step is released on its own:

1. **Decks core plus Yu-Gi-Oh!** Tables, sync, friend tab, list/page/panel, card-panel action, missing cards and cost, the rules pack pipeline with the Yu-Gi-Oh! pack, Yu-Gi-Oh! checks and Yu-Gi-Oh! import/export. Desktop, web and phone.
2. **Pokémon**: pack plus checks plus PTCGL import/export.
3. **One Piece**: hand-kept rules file plus checks plus import/export.
4. **Magic**: Scryfall legality pack (size measured first) plus checks including Commander, plus Arena/MTGO import/export.

Release order stays as the project already does it: deploy the portal before the tag.

## Testing

- The checks are pure functions over (deck, pack, card facts), unit-tested per game with hand-written fixtures for every rule in the table, including edge cases: a basic Energy over 4, a Vintage restricted card at 2, Commander colour identity, a One Piece Leader with two colours, and a Yu-Gi-Oh! Extra monster in Main.
- Import parsers are tested against real exported lists from each source tool, kept small in `tests/fixtures/decks/`.
- A pack build test that runs against small source fixtures, not live APIs.
- Respect the memory limits: no large synthetic data in vitest (`no-heavy-test-data`), and `--maxWorkers=2`.

## Left to the builder

- Exact screen layout, iconography and copy, in the app's existing style.
- Pack route naming and cache headers.
- Whether the checks run in a worker thread (they should be fast enough not to need one; measure).
- How to show ambiguous import matches.
- Default sort within a section (Yu-Gi-Oh! convention is monsters, spells, traps; Pokémon is Pokémon, Trainer, Energy; Magic is by type then mana value).
