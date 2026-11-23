# Decks step 4: Magic: The Gathering (short design)

Parent spec: `2026-11-22-decks-design.md`. Steps 1–3 (Yu-Gi-Oh! v0.115.0, Pokémon v0.116.0, One Piece v0.117.0) are built. This file covers only what step 4 adds or changes. Everything else is reused as built: deck storage, sync, RPC, the deck page, errors vs warnings, pack caching and staleness, the import preview, and costs.

Approved by the owner 2026-11-23 ("approved, write the spec") from the proposal in chat.

## Intent

Magic players get the same Decks page: build a 60-card or Commander deck, see live whether it's legal in the format, see what they own and what's missing, and move lists to and from Arena and MTGO. This is the last game in the decks ship order.

## Goals

- `mtg` appears in `DECK_FORMATS` with seven formats, as the parent spec lists: `standard`, `pioneer`, `modern`, `legacy`, `vintage`, `pauper`, `commander` (labels "Standard", "Pioneer", "Modern", "Legacy", "Vintage", "Pauper", "Commander"). All price in English (`priceRegion: 'en'`).
- Sections:
  - 60-card formats: "Main" (`main`, 60 or more) and "Sideboard" (`side`, 0–15).
  - Commander: "Commander" (a new `commander` section, 1–2 cards) and "Main" (`main`). No sideboard.
- Checks (errors unless noted):
  - 60-card formats: Main at least 60; Sideboard at most 15.
  - At most 4 copies by English name across Main and Sideboard together, except basic lands and the "any number" cards. A card whose text gives its own cap ("up to seven", Seven Dwarves; "up to nine", Nazgûl) uses that cap.
  - Banned cards are errors. In Vintage, a restricted card allows 1 copy across Main and Sideboard.
  - A card not legal in the format (Scryfall `not_legal`, e.g. an older card in Standard): error, "Not legal in Pioneer".
  - Commander: exactly 100 cards including the commander zone; singleton by name except basic lands and "any number" cards (and their caps); every card's colour identity within the commanders' combined identity; each commander can be a commander; two commanders only as a valid pair (below); banned cards from Scryfall's `commander` legality.
  - A card whose first printing isn't out yet: warning, "Not out until Feb 6" (people build ahead from previews), as the parent spec's region rule.
  - A card the pack doesn't know (new since the pack was built): warning, "Couldn't check N cards".
  - Pack older than 14 days: warning (existing behaviour).
- Commander pairs, all decided by the pack, not by reading text on the device:
  - Partner with any other Partner (plain "Partner").
  - "Partner with X": only with X.
  - "Friends forever" with any other Friends forever.
  - "Choose a Background" with a Background enchantment.
  - "Doctor's companion" with a Time Lord Doctor.
  - A named partner variant (for example "Partner—Father & son"): only with the same variant.
- Who can be a commander: a legendary creature, or a card whose text says it can be your commander, or a Background paired as above. The builder confirms the current Commander rules (including any newer card kinds, such as legendary Vehicles or Spacecraft) and writes the test into the pack builder, so a rules change is a pack change, not an app release.
- Default sort: Commander first; then Creature, Planeswalker, Battle, Instant, Sorcery, Artifact, Enchantment, Land; then mana value, then name.
- Adder filter chips: Owned, Creature, Instant/Sorcery, Land, and the five colours plus colourless. In Commander the colour chips default to the commanders' identity.
- Import:
  - Arena text: `4 Lightning Bolt (2X2) 117` or `4 Lightning Bolt`, with `Deck`, `Sideboard`, `Commander`, `Companion` and `About`/`Name` headers. A `Companion` card goes to the Sideboard; in Commander it's listed as left out ("Commander decks here have no sideboard").
  - MTGO text: `4 Lightning Bolt` lines, with the sideboard after a blank line or a `SIDEBOARD:` line.
  - The import screen guesses the format from the counts (a 1–2 card `Commander` header or 100 cards = Commander) only when the deck has no format yet; otherwise it keeps the deck's format.
- Export: Arena text (headers; `(SET) number` added when a printing is pinned) and MTGO text.

## Non-goals

- Brawl, Historic, Timeless, Alchemy, Oathbreaker, Pauper Commander and other formats (parent spec). Digital-only (Alchemy `A-`) cards are left out of the pack.
- Companion deck-building conditions (Lurrus, Yorion and so on). A companion just sits in the Sideboard and counts toward 15.
- Commander brackets, "Game Changers" and other power-level labels: those are play advice, which the parent spec parks.
- Arena collection codes, deck images, or Moxfield/Archidekt links.
- Signature spellbooks, Un-cards' and Conspiracy draft-matters rules beyond what Scryfall's legality says.

## Approaches

1. **Scryfall Oracle bulk file in the rules step (chosen).** `catalog:rules -- --game mtg` downloads Scryfall's `oracle_cards` bulk file (one object per card, ~160 MB, with `legalities`, type line, oracle text and keywords), streams it with the existing line reader, and writes a compact pack. It's independent of the 2 GB `all_cards` stage, so the rules step stays fast and can be run by hand.
2. **Carry legality through the catalog stage.** Rejected: the stage slims `legalities` away on purpose to keep memory down while streaming 2 GB, and a ban would wait on the full catalog job and its caches.
3. **Read legality and partner text on the device from `mtg_cards`.** Rejected: the catalog doesn't carry legality (parent spec approach B was rejected for this), and the parent spec puts text-judged rules in the pack.

## Design

- **Pack (`rules/mtg.json`, schema version 1).**
  - Keyed by English card name exactly as Scryfall writes it (`Fire // Ice`, `Delver of Secrets // Insectile Aberration`). Copy limits are by name, so the key is the rule's own unit.
  - `legal: { "<name>": <number> }`, 2 bits per format in a fixed order (`standard, pioneer, modern, legacy, vintage, pauper, commander`): 0 not legal, 1 legal, 2 restricted, 3 banned. Names that are not legal anywhere are left out.
  - `anyNumber: { "<name>": <cap or 0 for no cap> }`, built from the text "A deck can have any number of cards named" and "up to <number> cards named".
  - `commander: { "<name>": <pair kind> }` for every card that can be a commander, with the kind as `""` (alone only), `"partner"`, `"partner-with:<name>"`, `"friends"`, `"background-chooser"`, `"background"`, `"companion"`, `"doctor"`, or `"variant:<text>"`.
  - `upcoming: { "<name>": "YYYY-MM-DD" }` for cards whose first paper printing is after the build day.
  - `formats` lists the seven ids in bit order, so an app can tell a pack with a new format from a broken one.
  - Size: the builder measures with `--dry-run` first. If over ~1 MB gzipped, `legal` splits per format (parent spec); expected is ~250–400 KB.
- **Card facts.** `DeckCard` gains `mtgName` (the English name, through `oracle_id`, so a Japanese printing counts as the same card), `mtgTypeLine`, `mtgColorIdentity` and `mtgManaValue` (null or empty for other games), from `mtg_cards`. `decks:get` returns them, so the web checks without a catalog. Basic land = type line has `Basic` and `Land`.
- **Checks.** `src/shared/decks/magic/check.ts`, pure functions, one test per rule, plugged into the shared `check.ts` as the other games are.
- **Import/export.** `src/shared/decks/magic/text.ts` for both Arena and MTGO text, using the shared import preview and the existing unmatched-lines list.
- **Matching.** Full English name, then the front face name of a two-faced or split card (Arena writes only the front face), then case- and accent-insensitive. A set + number on an Arena line pins that printing if the catalog has it; otherwise the line still matches by name, unpinned.
- **Sections.** `DeckSection` gains `commander`. A card added to a Commander deck goes to Commander when the zone is empty and it can be a commander, else to Main.
- **Release.** As before: portal deploy (it must accept `mtg` packs and decks) → push → catalog run, with a new "Magic deck rules pack" step in `catalog.yml` → tag.

## Left to the builder

- The 100-card total isn't a per-section limit; how the Commander format's sections express it (for example Main 0–99 plus a total check).
- Exact Arena/MTGO line quirks (split-card slashes, `*F*` foil marks, set codes Arena uses that Scryfall doesn't), tested with fixtures in `tests/fixtures/decks/mtg/` copied from Arena and MTGO exports.
- Whether the catalog's English `cards.name` for two-faced cards matches Scryfall's `A // B`; if not, the matcher maps between them.

## Open items

- Pack size, measured in task 1.
- Commander rule changes for new card kinds: confirmed by the builder against the current official rules and recorded in the pack builder's tests.
