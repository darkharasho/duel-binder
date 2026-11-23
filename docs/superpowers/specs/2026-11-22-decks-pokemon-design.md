# Decks step 2: Pokémon (short design)

Parent spec: `2026-11-22-decks-design.md` (step 1, Yu-Gi-Oh!, shipped v0.115.0). This file covers only what step 2 adds or changes. Everything else (deck storage, sync, RPC, the deck page layout, errors vs warnings, pack caching and staleness) is reused from step 1 as built.

## Intent

Pokémon players get the same Decks page Yu-Gi-Oh! players have: build a 60-card deck, see live whether it's legal in Standard or Expanded, see what they own, and move lists in and out of Pokémon TCG Live.

## Goals

- `pkm` appears in `DECK_FORMATS` with formats `standard` and `expanded`.
- One section, "Deck", exactly 60 cards.
- Checks (errors unless noted):
  - Deck is exactly 60.
  - At most 4 copies by name, except basic Energy (any number).
  - At most one ACE SPEC card in the deck.
  - At most one Radiant Pokémon in the deck.
  - At least one Basic Pokémon.
  - Every card has a printing legal in the format (via its card key, so reprints count).
  - No banned cards for the format.
  - Pack older than 14 days: warning (existing behaviour).
- Default sort: Pokémon, Trainer, Energy; then name.
- Adder filter chips: Owned, Pokémon, Trainer, Energy.
- Import/export PTCGL text: `4 Pikachu ex SVI 057` lines, with `Pokémon: N`, `Trainer: N`, `Energy: N` headers. Export writes the same. Matching: set code + number, then name (case- and accent-insensitive, also `local_name`).

## Non-goals

- Older formats (Unlimited, GLC, retro formats).
- Japanese-format rules (different rotation timing). Japanese and Chinese printings count through their English twins.
- Parsing card text for exceptions.

## Approaches

1. **TCGdex legality flags + hand-kept banned list (chosen).** The builder uses TCGdex's per-printing `legal.standard` / `legal.expanded`. TCGdex has already applied the current rotation (Ultra Ball sv01-196, mark G, reads standard: false). The hand-kept file holds only the banned lists and a manual per-card override. No yearly edit.
2. **Hand-kept Standard regulation marks** (the parent spec's plan). Exact, but someone has to edit the marks every rotation, and a missed edit makes every deck look wrong. Kept only as a fallback idea if TCGdex's flags prove stale.
3. **Fetch legality live from TCGdex in the client.** Rejected: online-only, and it doesn't fit the pack model step 1 built.

The owner approved approach 1 (2026-11-22).

## Design

- **Card data.** Add `legal`, `regulationMark`, `trainerType`, `energyType` (and keep `rarity`) to the catalog's `TdCard` type. The raw JSON is already in the `td_cards` cache, so no new fetching.
- **Card key.** The normalized English name plus the sorted attack names and ability names, built from TCGdex's English cards only.
- **How a card finds its key (Claude's call, changed while planning).** A pack listing every catalog card id in every language would be hundreds of KB gzipped (European languages alone multiply the count), so the pack is keyed by TCGdex's *English card id* instead, and the client works out the rest:
  - English and European cards: their `pokemon_cards.source_id` (`fr/sv01-196`) shares TCGdex's id with the English card (`sv01-196`), so they look it up directly.
  - Japanese, Chinese and anything else: by English name (`cards.name`, which the catalog already sets in English for most of them). One key with that name: that key. Several: the card is legal if any of them is, the Basic/ACE SPEC/Radiant flags come from them, and the deck shows a warning, "Pin an English printing to check exactly". None: no legal printing.
  - No catalog schema change and no full re-pull.
- **Pack (`rules/pkm.json`, schema version 1).** Built by `src/shared/decks/pokemon/buildPack.ts` from the English TCGdex cards in the catalog run's card cache, after the Pokémon stage. Uploaded with `PUT /api/admin/rules/pkm`. `--dry-run` writes `out/rules-pkm.json`. Contents:
  - `keys`: one entry per card key: English name, kind (Pokémon / Trainer / Energy), flags (Basic Pokémon, ACE SPEC, Radiant, basic Energy) and legality bits (Standard, Expanded).
  - `ids`: TCGdex English card id → key index.
  - per format, the banned key indexes.
  - Target under 100 KB gzipped; measured in the dry run.
  - ACE SPEC comes from the rarity ("ACE SPEC Rare", and the Black & White era's "Rare ACE"). Radiant comes from the name ("Radiant ..."). Basic Pokémon comes from stage "Basic". Basic Energy comes from `energyType` "Normal". Legality is TCGdex's `legal`, OR'd over a key's printings.
- **Manual file.** `src/shared/decks/rules/pokemon-manual.json`: `{ banned: { standard: [TCGdex ids], expanded: [TCGdex ids] }, override: { "<TCGdex id>": { standard?: boolean, expanded?: boolean } } }`. A ban or override on one printing applies to its whole card key, since the official list bans by card (Unown LOT 90 and 91 are different keys). As of 2026-11-22, pokemon.com lists no Standard bans and 26 Expanded ones.
- **Checks.** `src/shared/decks/pokemon/check.ts`, pure functions, one test per rule, plugged into the shared `check.ts` the same way Yu-Gi-Oh! is.
- **Import/export.** `src/shared/decks/pokemon/ptcgl.ts`, using the shared import preview (matched / ambiguous / unmatched).

## Left to the builder

- Exact key format and how the pack compresses it.
- How PTCGL set codes map onto the catalog's set ids (TCGdex `abbreviation.official` where present).
- Where the Pokémon name normalization lives (for example, accents and "Pokémon" vs "Pokemon").

## Open item

- If TCGdex's `legal.standard` turns out stale after a rotation, the `override` entries cover it until TCGdex catches up.
