# Decks step 3: One Piece (short design)

Parent spec: `2026-11-22-decks-design.md`. Steps 1 (Yu-Gi-Oh!, v0.115.0) and 2 (Pokémon, v0.116.0) are built. This file covers only what step 3 adds or changes. Everything else is reused from steps 1 and 2 as built: deck storage, sync, RPC, the deck page, errors vs warnings, and pack caching and staleness.

## Intent

One Piece players get the same Decks page: build a Leader plus 50 deck, see live whether it's legal, see what they own, and move lists between Duel Binder, OPTCGSim and OPlay.

## Goals

- `op` appears in `DECK_FORMATS` with two formats (owner's choice, 2026-11-22):
  - `standard`: "Standard", with block rotation.
  - `extra`: "Extra Regulation", with no rotation.
- Two sections: "Leader", exactly 1 card, and "Deck", exactly 50 cards. A Leader added without a section picked goes to Leader.
- Checks (errors unless noted):
  - Leader is exactly 1, and it is a Leader card.
  - Deck is exactly 50, with no Leader cards in it.
  - At most 4 copies of each card number. English and Japanese twins count together.
  - Every Deck card shares at least one colour with the Leader.
  - No banned cards for the format.
  - No banned pairs: a card that's banned with this Leader ("Jewelry Bonney can't be used with this Leader").
  - Standard only: no cards from a rotated block, except the hand-kept exemptions (the PRB-02 reprints).
  - Restricted cards (none today): at most the listed number of copies. Kept in the file so a future list needs no code.
  - A card whose block isn't known: warning in Standard, "Couldn't check the block of N cards".
  - Pack older than 14 days: warning (existing behaviour).
- DON!! cards are ignored on import and can't be added.
- Default sort: Leader, then Character, Event, Stage; then cost, then card number.
- Adder filter chips: Owned, Character, Event, Stage, and the Leader's colours.
- Import/export: OPTCGSim/plain text and OPlay deck codes and share links, exactly as the parent spec's "OPlay compatibility" section says.

## Non-goals

- Parsing Leader text for deck-building exceptions. A Leader that changes the rules is handled later as a hand-kept exception list if players ask.
- Japanese-only rules timing. Japanese cards count through their card number.
- Reading OPlay `?deck=<number>` links (they point at OPlay's server). The import screen says so.

## Approaches

1. **Hand-kept rules file + the catalog's card facts (chosen).** The checks use what the catalog already has per card: card type, colours, card number and block icon. The rules that change (bans, banned pairs, rotated blocks, exemptions, restricted) live in `src/shared/decks/rules/onepiece.json` and go out through the existing pack pipeline, so a ban list update is a PR plus an upload, with no app release.
2. **Build the pack from the catalog run** (as Pokémon does). Rejected: Bandai publishes no legality data to build from, so the pack would just copy the hand-kept file. The card facts the checks need are already on every device.
3. **Bundle the rules in the app.** Rejected: a ban would need an app release and App Store review.

## Design

- **Pack (`rules/op.json`, schema version 1).** `npm run catalog:rules -- --game op` reads `onepiece.json`, checks it with `parseRulesPack`, and uploads it with `PUT /api/admin/rules/op`. `--dry-run` writes `out/rules-op.json`. Contents:
  - `formats.standard` and `formats.extra`, each `{ banned: [card numbers], restricted: { "<card number>": copies }, bannedPairs: [{ leader: "<card number>", cards: ["<card number>"], from?: "YYYY-MM-DD" }] }`.
  - `formats.standard.rotatedBlocks: [1]` and `formats.standard.exempt: [card numbers]`, the Block 1 cards reprinted in PRB-02.
  - `from` lets a pair or ban be entered before it takes effect. A rule with a future `from` is shown as a warning ("Banned from Nov 27") until that day, then an error.
  - Every list is by card number (`OP01-016`), since that's how Bandai writes them and it covers twins and alternate arts.
- **Contents as of 2026-11-22** (the builder confirms against Bandai's pages before writing the file):
  - Banned in both formats: Charlotte Pudding, Nami, Gecko Moria, Trafalgar Law ST10-001, Reject, and Dracule Mihawk OP14-020 (Leader, from 2026-10-12).
  - Banned pairs: Jewelry Bonney EB05-001 with Monkey.D.Luffy OP13-001 and with Trafalgar Law OP01-002, from 2026-11-27. I Re-Quasar Helllp! with Borsalino (since April 2026).
  - Restricted: none.
  - Standard rotation: Block 1 out since 2026-04-01; PRB-02 reprints exempt.
  - Whether Extra Regulation uses the same ban list or its own: the builder checks Bandai's page and writes what it says. If it says nothing, use the same list.
- **Card facts.** `DeckCard` gains `opNumber`, `opCardType`, `opColors` and `opBlock` (null for other games), filled from `onepiece_cards`. `decks:get` returns them, so the web checks without a catalog.
- **Block exemption, by card (Claude's call).** The catalog keeps one block icon per card, not per printing. An exempt card counts as legal in Standard whatever printing the user owns, and its entry shows a note: "Use the PRB-02 printing in Standard". If Bandai's rule turns out to allow every printing, the note goes.
- **Checks.** `src/shared/decks/onepiece/check.ts`, pure functions, one test per rule, plugged into the shared `check.ts` as Yu-Gi-Oh! and Pokémon are.
- **Import/export.** `src/shared/decks/onepiece/text.ts` (plain text) and `src/shared/decks/onepiece/oplay.ts` (v1 and v2 deck codes, share links), using the shared import preview. Export writes plain text (`4xOP01-016`, Leader first as `1xOP01-001`), an OPlay v2 deck code and a share link.
- **Matching.** By card number, then by name. A number with several catalog cards (English and Japanese twins) picks the English one.

## Left to the builder

- How the shared `DeckSection` type gains `leader`, and how the deck page shows a one-card section.
- How sources' line formats are tested (fixtures in `tests/fixtures/decks/op/`, copied from OPlay and OPTCGSim).
- Where the 4-per-number count reads twins from (the tracker already keys One Piece by number).

## Open items

- Leaders whose text changes deck building (for example, colour or cost limits), if any are played: a hand-kept list later.
- If the block icon is missing for many cards, the builder reports how many and falls back to the set's block from a small table in `onepiece.json`.
