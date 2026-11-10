# Magic: The Gathering in Duel Binder

Date: 2026-11-09. Status: the owner asked for "the plumbing of supporting magic the gathering" and
said "you got the method down now, go for it. it should be like the rest". Every decision below is
the builder's call unless marked as the owner's, made so it matches how Pokémon and One Piece went in.

## Intent

The owner bought Magic cards and has started recording live rips for a Magic scanner (Admin →
Rip capture, v0.68.0). Magic becomes the fourth game: the same app and UI, with only vocabulary,
filters and data changing per game. It follows the One Piece path
(`2026-11-04-one-piece-design.md`): ship the empty, hidden game first, then the catalog and prices,
then the scanner, and open it to everyone only when the scanner passes its gate.

"Plumbing" here means steps 1 and 2: the game exists for the owner, with a full English catalog,
art and USD prices on desktop, web and phone. The scanner (step 3+) needs the rip frames and gets
its own design.

## Anti-goals

The standing ones for every game:

- **A wrong card anywhere the scanner names one, and a wrong price.** No price beats a wrong
  price. A foil never shows the non-foil price, and the other way round.
- **Yu-Gi-Oh, Pokémon and One Piece don't regress.** Their ids, keys, wire formats, sync, prices,
  scan and fingerprint files stay byte-identical, with no action from any user.
- **Magic doesn't leak early.** Until it opens, only the owner and accounts on its tester list see
  it, and the server enforces that.

New for Magic:

- **Breaking Scryfall's or Wizards' terms.** See **Terms** below. Card art is never cropped,
  stretched, recoloured or watermarked where it is shown; Magic data is never behind a paywall.

## Terms (read 2026-11-09)

- **Scryfall API guidelines** (scryfall.com/docs/api): data and images are free "for the primary
  purpose of creating additional Magic software". We may not paywall it ("If you have an account
  system, end-users should be able to access card data anonymously or with free accounts"), may not
  imply Scryfall endorses us or use its logo, and may not "simply repackage, republish, or proxy
  Scryfall data" (a collection tracker adds value). Requests need an accurate `User-Agent`
  (`DuelBinder/<version>`) and an `Accept` header.
- **Scryfall image rules:** don't cover, crop or clip the copyright or artist name, don't distort,
  blur or colour-shift, no watermarks. Our UI shows whole cards. The scanner's internal art crops
  (fingerprints) are never shown to users, so they're fine.
- **Wizards Fan Content Policy:** free to access, no Wizards logos or mana-symbol trademarks used as
  branding, and the notice: "Duel Binder is unofficial Fan Content permitted under the Fan Content
  Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards
  of the Coast. ©Wizards of the Coast LLC." It goes on the legal/about pages in step 2, and on the
  marketing site when Magic opens to everyone.
- Duel Binder has no paid tier, so all of this holds today. **If a paid tier is ever added, Magic
  data must stay outside it.** This goes in the step 2 PR description.

## Source: Scryfall (my call)

Scryfall's bulk files replace the scraping and TCGplayer matching the other games needed:

- **`default_cards`** (JSONL, 81 MB gzipped on 2026-11-09, rebuilt every 12 hours; found through
  `https://api.scryfall.com/bulk-data`). One object per printing, in English, or in the only language
  it was printed in. On 2026-11-09: 120,053 objects; 108,038 are paper (`games` includes `paper`),
  105,388 of them English; 35,992 oracle cards; 959 sets.
- **Finishes** (`nonfoil`, `foil`, `etched`) are listed per printing: 94,524 + 64,979 + 1,218 =
  160,721 printing × finish rows.
- **Prices** come with the same objects: `prices.usd`, `usd_foil` and `usd_etched` are TCGplayer
  market prices, one per finish, already matched by Scryfall. 149,548 of the 160,721 had one. No
  TCGCSV matching is needed. Scryfall updates them daily.
- **Images:** `cards.scryfall.io`, `normal` 488 × 680 JPG and `large` 672 × 936 JPG. A two-faced
  card (`transform`, `modal_dfc`, `reversible_card` and so on; 1,465 objects) has no top-level
  `image_uris`: each face has its own.

For size: today's desktop catalog holds 346k Yu-Gi-Oh printings, 109k Pokémon and 10k One Piece.
Magic adds about 161k printings and 108k images, inside the range the app already handles.

## Identity (fixed in step 1, permanent once shipped)

- **Game id** `'mtg'`. **Display name "Magic"** (my call: the game switch and phone segments
  are tight; "Magic: The Gathering" is used in prose and legal text). Colour `#c2410c` (a burnt orange,
  apart from the other three; the owner may change it).
- **Id range [2^38, 2^39)**, hashed like One Piece: `mtgId(sourceId)` is the first 52 bits of
  SHA-256 of `mtg:${sourceId}` (7 bytes read, `>> 4`), mod 2^38, plus 2^38. `gameOfId` becomes
  `≥ 2^40 → pkm`, `≥ 2^39 → op`, `≥ 2^38 → mtg`, otherwise `ygo`. Yu-Gi-Oh's largest ids are below
  2^31, so nothing moves. About 275 billion slots for about 150k ids; the catalog job still checks
  for a collision and fails loudly.
- **A card** is one oracle card per language: `mtgCardId('en', oracleId)` = `mtgId('en/<oracle_id>')`.
  Reversible cards with no top-level `oracle_id` use their first face's. All printings of
  Lightning Bolt share one card, its name and its rules text.
- **An image** is one Scryfall card object: `mtgImageId(scryfallId)` = `mtgId('<scryfall id>#img')`.
  Scryfall ids are UUIDs and already per language, so there is no region prefix.
- **A printing** is one Scryfall card object × one finish, in `card_printings`:
  - `set_code`: the set code and collector number, `'MH3 123'`, `'PLST XLN-217'`, `'9ED 213★'`
    (set + collector number is unique in Scryfall; checked on 2026-11-09, 0 duplicates).
  - `set_rarity`: the rarity, plus the finish when it isn't non-foil: `'Rare'`, `'Rare (Foil)'`,
    `'Mythic (Etched Foil)'`. This is the One Piece form (`'SR (Alternate Art)'`), so `pkey`
    (`en|card|set_code|set_rarity`) keeps finishes apart and the version filter reads the text
    in brackets.
  - `set_rarity_code`: the Scryfall id, which names the printing's image (as One Piece's Bandai id
    does).
  - `set_name`: the Scryfall set name. `language`: Scryfall's `lang` mapped to the app's languages
    (step 2 is English only).
- **Tables:** `mtg_cards` (game text) and `mtg_images` (`image_id → scryfall_id`, plus artist and
  illustration id) on desktop, phone and server, as `onepiece_cards`/`onepiece_images`.

## Step 1: the empty, hidden game

- `'mtg'` in `GameId`/`GAME_IDS`, a `MAGIC: GameDef` in `src/shared/games/magic.ts`:
  `features: { scan: false, pokedex: false }`, `cardAspect: { width: 488, height: 680 }`,
  `crossLanguagePriceFallback: false`, `priceRule: 'marketOnly'`, `access: 'testers'`.
- Vocabulary: card id "Card", printing code "Set & number", rarity "Rarity".
- Filters (stubs that step 2 fills): `mtgColors` (Color), `mtgTypes` (Type), `mtgRarities`
  (Rarity), `mtgFinishes` (Finish), `mtgSetTypes` (Set type), ranges `manaValue` (Mana value),
  `mtgPower` (Power), `mtgToughness` (Toughness).
- Details: type line, mana cost, mana value, colors, rules text, power/toughness, loyalty, defense,
  artist, set & number.
- Ids, `gameOfId`, the tables (next desktop migration and server steps, with catalog seq triggers),
  `CATALOG_TABLES`, `PHONE_TABLES`, catalog cursors, apply-delete rules.
- Every string branch on game reviewed so `'mtg'` never falls into a Yu-Gi-Oh or Pokémon default,
  as One Piece's step 1 did (Task 7 of its plan). The tester list (`game_testers`) and the
  Testers admin panel already exist; Magic just appears in them. The owner is the only viewer until
  someone is added.
- The game switch holds four games on desktop, web and phone.

## Step 2: English catalog, art and prices

- **A `magic` stage in `scripts/catalog/build.ts`** (and `catalog.yml`), on the nightly run:
  download `default_cards` JSONL (skip it when `updated_at` hasn't changed since the cached copy),
  keep paper English objects, and write cards, images, printings, sets and prices through the same
  catalog load the other games use. `--no-magic` skips it.
- **What's in:** every paper English printing, including tokens, emblems, art series cards,
  oversized and promo cards (collectors have them; they're in the file). Digital-only (Arena, MTGO)
  printings are out. Non-English printings wait for a later step.
- **Sets:** one row per Scryfall set, `set_code` uppercase, `tcg_date` = `released_at`, `series`
  = the parent set's name when there is one (commander decks, promos and tokens sit under their
  main set), else the set's own name. Set icon from `icon_svg_uri`.
- **Prices:** `market_price` per printing × finish from `usd`/`usd_foil`/`usd_etched`. A missing
  price stays empty; a foil never falls back to the non-foil price. The job reports the priced share
  per set, as the One Piece job does, so a parse bug shows as a drop.
- **Art:** the `/img` proxy fetches a Magic image on an R2 miss from `cards.scryfall.io` (the
  `normal` size for small/medium, `large` for large), stores it in R2, and serves it, as Pokémon art
  is served. The path comes from `mtg_images.scryfall_id`. Two-faced cards show the front face; the
  back face is a later step.
- **Removed or changed objects:** Scryfall ids are stable. An object that disappears is flagged
  `missing_from_api`, never deleted while someone owns it.
- **UI:** filters and facets above, details panel, rarity colours (common, uncommon, rare, mythic,
  special, bonus), placeholder at 488 × 680, mana cost shown as text (`{2}{R}{R}`), not the
  trademarked symbol font. Collection, Browse, Sets and checklists, Add Card, Dashboard, Binders,
  Friends, wishlist and favourites on desktop, web and phone.
- **Fan Content notice and Scryfall credit** ("Card data and images from Scryfall") on the legal and
  about pages.

## Later (not in this design)

- **Scanner:** profile, art fingerprints (the `illustration_id` groups printings that share art),
  set symbol / collector number OCR, foil detection, accuracy gate on the owner's rip frames. Opens
  Magic to everyone when it passes, as for the other games.
- Non-English printings (`all_cards`, 404 MB gzipped), back faces, Japanese and other prices.
- Format legality filters and deck features: out of scope (it's a collection app).
