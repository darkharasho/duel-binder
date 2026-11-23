# Task 7 report: deck screens for Pokémon

## Implemented
- DeckAdder: per-game kind chips; pkm shows Pokémon / Trainer / Energy, filtered with pkmKind (facet card types and results). Ygo chips unchanged.
- ImportDialog: pkm parses with parsePtcgl, preview kind 'text'; pkm placeholder and file accept (.txt).
- deckExport/ExportMenu: ExportMenu takes `game` (default ygo, DeckHeader passes it); pkm shows only "Copy deck list" (toPtcgl).
- DecksPage: import format no longer hardcoded 'advanced' (falls to the game's first format: standard).
- DeckTile: non-ygo decks list their format's own sections ("Deck 60") instead of "Main · Extra · Side".
- DeckSearch: "Main or Extra, by card" is ygo only.

## Copy changes
- "Main or Extra, by card" -> ygo same; others "Where the card goes".
- Tile counts "Main n · Extra n · Side n" -> ygo same; pkm "Deck n".
- Import placeholder: pkm "Paste a deck list from Pokémon TCG Live" (ygo unchanged).
- "ban list" stale warning was already gated to ygo in shared check.ts (pkm says "rules"). No "passcode"/"Extra Deck" in shared screens beyond ygo-only code.

## Tests (tests/renderer/decks.test.tsx, new describe "Pokémon on the deck screens")
- adder chips + Trainer filter; export menu single item copies PTCGL; import previews `4 Iono PAL 185` as one line and resolves {set PAL, number 185, name Iono}.
- Two stale tests updated: "Decks in the nav" for Pokémon (now after Binders) and game-switch Pokédex (now after Decks). Both were already failing on HEAD since pkm formats exist.
- RED: `npx vitest run --maxWorkers=2 tests/renderer/decks.test.tsx -t "Pokémon on the deck"` -> 3 failed (no Pokémon button; menu ['Copy as text',...]; no placeholder).
- GREEN: same file 44 passed; with game-switch 77 passed. Full `tests/renderer tests/shared/decks`: only the 2 stale tests failed before updating.

## Checks
- typecheck:web clean (no TS6307 appeared), typecheck:phone clean, eslint clean on changed files.

## Concerns
- Pokémon nav/Decks now visible (earlier task effect); stale tests updated accordingly.
- Adder facets query key is 'all' regardless of game (pre-existing).
