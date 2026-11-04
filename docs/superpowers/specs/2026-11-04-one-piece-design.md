# One Piece Card Game in Duel Binder

Date: 2026-11-04. Status: approved 2026-11-04 (the owner handed decisions to the builder for an overnight run).

## Intent

A friend of the owner plays and collects the One Piece Card Game (Bandai, "OPTCG") and asked for
it in Duel Binder. He is the first real One Piece user, and he will mostly use the **Android app**.
He wants all of it:

- **Cataloguing** the English cards he already owns: search the card list, add a card with its
  quantity and version (base, alternate art, manga, SP, Treasure Rare and so on), see what it is
  worth in USD.
- **Opening packs** and adding each pull with the scanner, on the phone and on desktop.
- **Streaming** pack openings with the scan window overlay and phone Stream mode, the way the
  owner's Pokémon friends do.

He is also the person who trains the scanner. He will sit down and photograph a few hundred of
his cards in a couple of sessions, in the app, and those photos become the test set the One Piece
scanner has to pass before the game opens to everyone.

One Piece is the third game, so it follows the pattern Pokémon set
(`2026-10-29-multi-game-pokemon-design.md`, `2026-10-29-pokemon-catalog-prices-design.md`,
`2026-10-29-pokemon-scanner-design.md`): the same UI, with only vocabulary, filters and data
changing per game. **It needs full support on desktop, the web app and the phone apps** (Android
first in practice, iOS from the same code).

## Anti-goals (failure even if everything technically works)

The same two the owner named for Pokémon apply here:

- **A wrong card on stream, or anywhere the scanner names a card.** The scanner names a card only
  when it is sure, otherwise it asks the user to pick, and the overlay shows nothing or "not sure".
- **A wrong price.** No price beats a wrong price. An alternate art never shows the base card's
  price, and the other way round. A Japanese card (later) never borrows the English price.

Also:

- **Yu-Gi-Oh and Pokémon do not regress.** Existing ids, keys, wire formats, sync, prices, scan
  and fingerprint files stay byte-identical, with no action from any user.
- **One Piece doesn't leak early.** Until the scanner passes its gate, only the owner and the
  friend see it, and the server enforces that, not just the UI.

## Decisions the owner made (2026-11-04)

- **Art and text** are fetched, cached and served from R2 the same way as Yu-Gi-Oh and Pokémon art.
- **English first.** The friend's cards are English. Japanese comes later.
- **Japanese prices**, when Japanese is added, come from the eBay sweep (as for Asian Yu-Gi-Oh and
  Chinese Pokémon). TCGCSV has no Japanese One Piece category.
- **Simplified Chinese** is left for later.
- **DON!! cards** are wanted ("would be nice"). Treat them like Pokémon basic energy: in the
  catalog, collectable, priced if a price exists, but they must not hold up a release.
- **The friend gets access** to One Piece while it is still hidden from everyone else.
- **Photo capture lives in the phone app** (Android is his device), not on a separate page.

## Goals and order

Each step ships on its own and depends on the one before.

1. **An empty, hidden One Piece game.** Its identity (game id, card id range, keys, tables) is
   fixed and shipped before any data, because migrations are append-only and the portal deploy is
   one-way. Includes the tester access list.
2. **English catalog and prices.** The friend can add cards by hand on Android, web and desktop and
   see their value. DON!! here if it's easy, otherwise in a follow-up.
3. **Photo capture** in the phone app for testers. Can be built alongside step 2, but needs the
   catalog to label against, so it ships after or with it.
4. **One Piece scanner**: desktop scan, scan window overlay, phone scanner and Stream mode. Gated
   on the friend's photos; when it passes, One Piece opens to everyone in the same release.
5. **Later:** Japanese catalog and eBay prices (designed below in **Step 5a**), Simplified Chinese.

Steps 1–3 are specified enough to plan. Step 4 is sketched so earlier steps don't box it in; it
gets its own short design once the photos exist and a first replay has been run.

## Non-goals

- **Rip** (simulated pack openings) for One Piece. Rip is Yu-Gi-Oh only, as it stayed for Pokémon.
- **Japanese, Simplified Chinese, other regions** (Asia-English, French) in this design.
- **Graded slabs**, beyond what the Pokémon scanner already does (raw price, labelled "raw").
- **Combined totals across games.**
- **Deck building or play features.** It's a collection app; type, cost, power and so on are for
  filtering.

## Step 1: the empty game

### Game id and definition

- `GameId` gains `'op'` (`src/shared/games/types.ts`), and `GAMES` gains a One Piece `GameDef`
  (`src/shared/games/onePiece.ts`): name "One Piece", its own color, `features: { scan: false,
  rip: false }` until step 4, `crossLanguagePriceFallback: false`, `priceRule: 'marketOnly'`,
  vocabulary and filters (below), and a card aspect of 600×838 (Bandai's image size; the physical
  card is the standard 63×88 mm).
- **Every place that branches on game by string** (`=== 'pkm'`, `=== 'ygo'`, `'ygo' | 'pkm'`
  checks such as `src/phone/stream/record.ts:58`) is reviewed. There are about 85 string comparisons
  across main, renderer, phone, Worker and the catalog scripts, plus 6 `PKM_ID_MIN` uses. The compiler catches `Record<GameId, …>` maps but not these.
- Game-specific card fields go in their own table, `onepiece_cards` (as `pokemon_cards`),
  locally, on the DO and in the phone's wasm SQLite. Migrations are append-only and also run on the
  DO (which can't turn foreign keys off).

### Card ids (the hidden blocker)

Today `gameOfId` (`src/shared/games/ids.ts:82`) says that any id at or above 2^40 is Pokémon and
anything below is Yu-Gi-Oh. Pokémon's hashed ids fill all of [2^40, 2^53), so One Piece can't go
above it.

**My call:** One Piece ids are hashed into **[2^39, 2^40)**. `onePieceId(sourceId)` works like
`pokemonId`: SHA-256 of `op:${sourceId}`, folded into that range. That gives about 550 billion
slots for roughly 10,000 printings, so collisions aren't a practical concern, but the catalog job
still checks for one and fails loudly if it happens. `gameOfId` becomes `≥ 2^40 → pkm`,
`≥ 2^39 → op`, otherwise `ygo`. Nothing uses [2^31, 2^39) today: Yu-Gi-Oh's largest ids,
including the Yugipedia token range, are below 2^31. That gap is left for future games.

Everything that decides game by id must go through `gameOfId`. The image proxy's
`id >= PKM_ID_MIN` check (`workers/portal/src/images.ts:388-400`) is one known case to change, and
there may be others; the builder searches for `PKM_ID_MIN`. One Piece ids are above 2^32, so its
fingerprint file is format v2 (8-byte ids), which the reader already supports.

`sourceId` is the region plus Bandai's card id with a slash, matching Pokémon's `en/me05-068`: e.g.
`en/OP05-119_p1` (see **Card identity**), hashed as `op:en/OP05-119_p1`. Ids are permanent once
shipped, so this format is fixed in step 1 and covered by a golden-value test.
The game, region and id together never collide with Pokémon or Yu-Gi-Oh keys locally, on the
server, in R2 image keys or in fingerprint files.

### Access: owner plus testers

`access` today is `'everyone' | 'owner'`, keyed off `ADMIN_DISCORD_ID`. One Piece needs the
friend too.

**My call:** add `'testers'`. A tester game is visible to the owner plus the accounts on that
game's tester list. The list is a small server table (game, account id), edited from `/admin` by
username, so the owner can add the friend without a deploy and without knowing his account id
(he may sign in with email, not Discord). The check lives in `gamesFor` / `allowedGames`
(`workers/portal/src/auth.ts:190`, `src/shared/games/index.ts:19`), so `/api/me` and every
data route enforce it. `allowedGames(isOwner)` is a pure shared function, so it changes to take
the viewer's facts (owner, and the tester games read from the table) rather than reading the table
itself.

What "hidden" covers (my calls):

- **Hidden:** the game switch, the catalog feed, fingerprint files, and every data route for
  One Piece rows (collection, sync, binders, wishlist, favourites, prices). **Cross-user views use
  the viewer's game list,** not the card owner's: a non-tester looking at the friend's binders,
  friend page or a shared binder sees no One Piece cards.
- **Not hidden:** card art at `/img`. It is Bandai's public art, and Pokémon art is already served
  anonymously for iOS. An art URL reveals nothing a non-tester can reach. Desktop, web and phone already take the game list from `/api/me`, so adding
or removing a tester takes effect on the next sign-in or refresh, with no release. Opening the
game to everyone later is a one-line change to `access: 'everyone'`, as it was for Pokémon (#94).

Clients that don't know about `'op'` never receive One Piece data (the old-client rule in the
multi-game design).

## Step 2: English catalog and prices

### Sources

- **Card list: Bandai's English card list** (en.onepiece-cardgame.com/cardlist). It is server-rendered
  HTML, one page per series (61 series as of 2026-11-04: boosters OP, extra boosters EB, premium
  boosters PRB, starter decks ST, promos P). Each printing is its own entry with an id like
  `OP17-005`, `OP17-005_p1`, `OP17-005_p2`, and full fields: name, type, color, cost, power,
  counter, life, attribute, traits, effect, trigger, block icon, rarity, and the series it appears
  in. Images are 600×838 PNG at `/images/cardlist/card/<id>.png`. The job fetches a few pages per
  night (most series never change; refetch new and recent series, re-check old ones weekly), with
  a cache like `pokemon-src.sqlite`.
- **Cross-check: punk-records** (github.com/buhbbl/punk-records), a JSON scrape of the same Bandai
  data, updated as of 2026-10-30. Optional: use it to catch a page the parser misread, never as the
  source of truth. The builder may skip it.
- **Prices: TCGCSV category 68** (TCGplayer, English only). There's one group per set, plus groups
  for event and pre-release stamps, promos and Championship cards. Each version is its own product,
  told apart by a suffix in the name: "(Alternate Art)", "(Manga)", "(SP)", "(TR)", "(Super
  Alternate Art)", "(Parallel)", "(Wanted Poster)" and others. `extendedData` has Number, Rarity,
  Color, CardType and more. Market price, USD, daily, as Pokémon does.
- **DON!! cards:** Bandai's HTML list doesn't include them, but TCGCSV has DON!! products, with
  images and no number. The builder decides the source. Treat them like Pokémon basic energy:
  their own card type, collectable and priced. If it gets fiddly, ship step 2 without them and
  follow up.

### Card identity

- A **card** is a name plus game text, keyed by the base number (`OP05-119`).
- A **printing (version)** is one Bandai entry: `OP05-119`, `OP05-119_p1`, and so on. An SP
  reprint keeps its original number but is listed under the newer series; it is a printing of the
  same card, belonging to the set it was released in.
- **Is `_pN` stable?** Not known. Bandai could renumber a card's parallels when it adds one, and a
  quietly re-pointed id would show a collection entry with the wrong art and price. So the catalog
  job stores each printing's art hash, and if a known id's art changes it doesn't update that
  printing: it logs a data note for a human. A new `_pN` is just a new printing. (My call.)
- The `_pN` suffix is **not printed on the card** and doesn't say what kind of version it is
  (alternate art, manga, SP, TR). We show a version label instead: "Alternate Art", "Manga", "SP",
  "Treasure Rare" and so on, taken from the rarity field and the matched TCGplayer product.
  `_pN` is never shown to users.
- **Bandai entry ↔ TCGplayer product matching** decides every price, so it's where wrong prices
  would come from. Match by number, then by version: first by kind (rarity plus TCGplayer suffix),
  and where a number has two or more versions of the same kind, by comparing the two sources'
  images (art hash). **A printing that doesn't match unambiguously stays unpriced** and is logged
  as a data note. A product left with no Bandai entry (event stamps, pre-release, Championship)
  becomes its own printing if TCGplayer has it; whether those are worth showing is the builder's
  call, but they are never priced onto the plain card. As a guard, the job reports the share of
  printings priced per set, so a bad parse shows up as a drop, not as silently missing prices.

### What the user sees

- **Vocabulary:** card number (not passcode), set codes (`OP05`, `EB01`, `ST10`, `PRB01`, `P`),
  rarities L, C, UC, R, SR, SEC, SP, TR, P with their own colors, and version labels as above.
- **Filters and facets:** color (including multicolor), card type (Leader, Character, Event,
  Stage, DON!!), rarity, version, cost, power, counter, attribute (Strike, Slash, Ranged, Special,
  Wisdom), traits, set and set type, block icon. Life shows on Leaders only.
- **Card details:** type, color, cost or life, power, counter, attribute, traits, effect and
  trigger text, block icon, number, version, set.
- **Everywhere:** Collection, Browse, Sets with set checklists, Add Card, Dashboard, Friends'
  binders, Binders, wishlist and favourites, on desktop, the web app and the phone. The game switch
  shows a third game without the layout breaking; how it looks with three is the builder's call,
  mocked up for the owner first.

## Step 3: photo capture in the phone app

The friend takes the scanner's training photos in the Android app. Taking them with the same
camera code the scanner will use gives photos that look like what the scanner will really see,
which booth shots don't.

### Flow

- A **"Contribute photos"** screen in the phone app, visible only to testers of a game (the
  owner too). Reached from Settings or the One Piece Home; where it goes is the builder's call.
- He holds a card in front of the camera. The app reads the printed number (bottom-right,
  e.g. `OP05-119`) and shows that number's versions with their art. He taps the one in his hand.
  If the number didn't read, he types it (with set-code autocomplete).
- **Step 3 includes the One Piece scan profile and number OCR** that step 4 also needs (card
  regions, number region, the number format). That pulls some of step 4 forward on purpose: it's
  the first real test of the OCR on his cards. If OCR proves hard, step 3 ships with typed numbers
  first and OCR follows; typing must always work. (My call.)
- He picks how it's held: **bare, sleeve, top loader, magnetic case, slab**. The choice sticks for
  the next shots, because he'll shoot a stack in one holder.
- He shoots. A shot is a full-resolution JPEG at the scanner's camera settings, and a few angles of
  the same card are encouraged (straight on, tilted, under a light), each tapped once.
- Each upload carries its label: card id, printing id, holder, device model, app version, and
  time. Labels are per shot, never "same as the batch above", so nothing gets mislabelled the way
  the booth's blank labels can.
- Uploads queue offline and retry, like other phone writes. He sees a running count, and can
  delete his last shot if it was blurry or wrongly labelled.

### Server

- A new route stores the photo in R2 under a training prefix, e.g. `training/op/<accountId>/<id>.jpg`,
  and its label in a DO table. Only testers of that game can call it. Size cap per photo and a
  daily cap per account. **Training photos are never served publicly** and never shown in the
  catalog or to other users.
- The `/admin` page shows counts per game, per tester and per holder, and how many distinct cards
  and versions are covered.
- A script pulls them down to `~/scan-capture/shots-op/` with a truth file in the same shape as
  `pkm-truth.json` (`{file, source, sourceId, version, language, holder}`), so the existing replay
  tests can read them. The photos stay off the repo, as the Pokémon owner photos do.

### What to ask him to shoot

The test set has to cover the lookalikes, not just a pile of commons. A short in-app checklist,
or a note the owner passes on, asks for:

- a spread of sets, rarities, Leaders, Characters, Events, Stages and DON!!;
- **every version he has of the same number**, especially alternate arts and the base card side by
  side, plain "Parallel" foils that reuse the base art, SP, manga, Treasure Rare;
- sleeves and top loaders, since that's what he'll stream with.

Pokémon needed about 200 labelled owner photos plus eBay photos for breadth. Aim for 200–300 here.
The capture screen is game-generic (it labels against the catalog and the holder list), so it
works for Pokémon and Yu-Gi-Oh testers too; turning that on for other games is the builder's call
and not needed now.

## Step 4: the One Piece scanner (sketch)

Reused as they are: the card detector and tracker, the overlay and scan window, phone scanner and
Stream mode, the DCT art fingerprint format, the unsure→pick flow, and the "price range for an
unsure version" rule from the Pokémon scanner design.

Needs a One Piece counterpart:

- **A scan profile**: card regions, art crop, where the number and rarity are printed
  (bottom-right).
- **Code OCR for the One Piece number format** (`OP05-119`, `ST10-003`, `EB01-012`, `PRB01-…`,
  `P-084`). It is short, printed and well placed, so it should do much of the work.
- **Art fingerprints** built nightly from the Bandai images: a `fingerprints-op` stage in
  `scripts/catalog/build.ts` and `catalog.yml`, its own R2 key in `scanFiles.ts`, and its own file
  on desktop and phone.
- **Version picking.** The number names the card; the art separates alternate art, manga, SP and
  TR from the base. **Same-art versions** (plain "Parallel" foil, stamped promos) can't be told
  apart by art. Unless the rarity or tilt cues in the existing rarity work can separate them
  reliably, these are "unsure version": the user picks, and the overlay shows a price range,
  following the Pokémon scanner rules.
- **Accuracy gate**, the same bar as Pokémon: **0 wrong and at least 85% recognized** on the
  friend's photos, replayed at the app's crop. A committed fixture set (`tests/fixtures/scan-op`,
  `make-fixtures.ts --game op`) blocks the nightly fingerprint upload if it fails. When the gate
  passes, the release flips One Piece to `access: 'everyone'` and `features.scan: true`.
- **Speed** (the owner's standing rule): report the added per-card latency, and keep slow steps
  skippable.

## Step 5a: Japanese catalog and eBay prices (addendum, 2026-11-04)

Status: decided by the builder on 2026-11-04, under the owner's grant of autonomy. Every call here
is mine, marked so the owner can check it. Simplified Chinese stays later.

### What was checked (2026-11-04)

- Bandai's Japanese card list (www.onepiece-cardgame.com/cardlist) is the same static HTML as the
  English one: a series `<select>` and one `<dl class="modalCol">` block per entry, images at
  `/images/cardlist/card/<id>.png` (600×838 PNG). It lists **63 series** today (the brief guessed
  about 113): 17 boosters, 2 premium boosters, 5 extra boosters, 36 starter and ultimate decks, plus
  promotion cards (550901), limited-product cards (550801) and the Family Deck Set (550701).
  `/cardlist/` answers with a 302 to the newest series.
- It differs from the English page in its words, not its shape: Japanese `<h3>` labels (ライフ for
  Life), colors as 赤/緑/青/紫/黒/黄, attributes as `<img alt="打">` (not `<i>Strike</i>`),
  `SPカード` for SP, series labels like `ブースターパック 世界最強の戦士【OP-17】` with full-width
  brackets, and card sets (入手情報) in Japanese. One entry has a typo'd type (キャラクタークター).
- Japanese-only series: **EB-04** (EGGHEAD CRISIS; English folded it into OP14-EB04 and OP15-EB04),
  separate **OP-14** and **OP-15**, the **Family Deck Set**, and most of the promotion and
  limited-product pages (Japanese events and products).
- The `_pN` suffixes mostly agree with English, but not always (OP05: Japanese `ST01-012_p4`,
  English `ST01-012_p2`).
- **Cross-language art hashes separate cleanly.** On 14 OP05 numbers (28 entries), the Japanese
  entry was 20–52 bits from the English entry with the same art, and 108–136 bits from the other art
  of the same number. So linking by image hash works for different art. Same-art versions stay apart.

### Catalog (my calls)

- **Identity.** A Japanese card is `onePieceCardId('ja', number)`, an image is
  `onePieceImageId('ja', bandaiId)`, and a printing has `language = 'ja'` with `set_rarity_code` the
  Japanese Bandai id. That is the id scheme step 1 fixed; no English id, key or row changes. The
  Japanese `onepiece_images.bandai_id` is `ja:<bandai id>` (as DON!! uses `tcg:`), so the `/img`
  proxy and the dev image source know to fetch from `www.onepiece-cardgame.com`. **No schema change.**
- **One stage, two regions.** The English modules take a region: `parseSeriesList` and
  `parseCardList` read either site's page, the sources take the site, the art store takes the
  region, and `writeOnePiece` scopes every read and write to its language. The English run is
  unchanged (its tests stand), but it now leaves Japanese rows alone. Before this, its "Bandai stopped
  listing it" pass would have flagged every Japanese row missing, and its per-set priced share would
  have mixed the two languages.
- **Its own source cache**, `onepiece-ja-src.sqlite`, with its own `catalog.yml` cache entry, so no
  existing cache path list changes. The English cache is opened read-only for its art hashes.
- **The same schedule and politeness** as English: one page at a time, 1 s apart, image downloads
  2 at a time, and `ONEPIECE_ART_BUDGET` (3000) downloads a night per region, so the first full
  Japanese fetch takes two or three nights. `--no-onepiece` skips both regions, `--no-onepiece-ja`
  only Japanese.
- **Sets.** One set per Japanese series, in `sets` with `language = 'ja'`. The set name is the
  English series' name when an English series has the same set code (`OP17`), so both languages read
  alike. Otherwise it is the Japanese title and code (`蒼海の七傑 [OP-14]`). Promotion cards keep `P`
  and limited products `OPC` (as English); the Family Deck Set gets `FDS`. No set dates (there's no
  TCGCSV). Set names freeze once written, as in English.
- **Card text.** A Japanese card whose number exists in English takes the English card's name, text
  and traits, so search, the trait facet and the details panel read the same in both languages (card
  data is per number, as the design's card identity says). A Japanese-only number keeps its Japanese
  text. Colors, attribute and card type are mapped to the English words either way, so the filters
  work. The Japanese name itself isn't stored: that needs an `onepiece_cards.local_name` column,
  parked.
- **Version labels.** There's no TCGplayer, so labels come from the art. A Japanese parallel whose
  art is within 64 bits of exactly one English entry of the same number (with the next one 40 or
  more bits further) takes that English printing's version label (`SR (Alternate Art)`,
  `SEC (Manga)`). Otherwise it is `<rarity> (Parallel)`, numbered as English does. Base, SP, TR and
  reprints are labelled as in English. A Japanese parallel is written on first sight, with no 7-day
  hold, since there is no match to wait for. Labels freeze once written; a later link that disagrees
  is a note.
- **Art** is uploaded to R2 by the job, as English art is (`/api/admin/op-art`), hashed, and frozen
  if it changes.

### eBay sweep for Japanese One Piece (my calls)

- **Queue.** `price_sweeps` rows keyed `op:<prefix>` with `language = 'ja'`, one per printed number
  prefix (`OP17`, `EB04`, `ST01`, `PRB02`), not per series. So an SP reprint of `OP05-119` sold in
  OP17 is swept with OP05's listings. Prefixes under 4 characters (`P`) aren't swept. No migration:
  the table has no game column, and Pokémon set the pattern. The Yu-Gi-Oh and Pokémon queries that
  find their own keys with `NOT LIKE 'pkm:%'` now also skip `op:`, so they see exactly the rows
  they saw before.
- **Search.** A new price Worker route, `/v1/onepiece-listings?code=OP17&lang=ja`, searches
  `OP17 Japanese` in eBay category 183454 (CCG Individual Cards). Fixed price and USD only, the
  graded condition (2750) dropped, at most 3 pages of 200 (3 calls). As for Pokémon, the Worker
  returns raw listings and the portal picks from them, since only the portal knows the numbers and
  versions.
- **Listing filters** (all must pass): the title says Japanese and no other language (English,
  Chinese, Korean, Thai, French). It is one raw single card (`isSingleCard`, plus the Pokémon
  sweep's slab, several-cards, not-a-card, fake and bad-condition rules, now shared). It has no
  event or special-printing words (promo, stamp, pre-release, championship, flagship, winner,
  finalist, top 8, anniversary, serial, signed, error, jumbo, gold, DON!!, box topper). It has
  exactly one card number, and that number is in the swept prefix.
- **Listing to version.** The title's version words give one kind: TR (`TR`, `treasure`), SP
  (`SP`, `SPC`, `special`), manga (`manga`, `comic`), super parallel (`super parallel`, `super
  alt`), wanted poster, generic parallel (`parallel`, `alt art`, `alternate`, `AA`), or none (base).
  Kinds that can't both be true (SP and TR) drop the listing. Each printing's kind comes from its
  label. A listing prices a printing only if exactly one printing of that number has its kind, and
  a generic parallel title needs exactly one printing of kind parallel. A number whose parallels
  can't be told apart (two `Parallel`s) gets no parallel price. Reprint and promo printings are
  never swept.
- **Price**, as for Pokémon: each seller counts once, at their cheapest copy; a price needs at
  least 3 sellers, goes through the shared `askingPrice` trim and passes the spread check (under 5
  sellers, a top price over 3× the bottom one is dropped). Prices go to `intl_prices` and are never
  erased. Each prefix is swept weekly, spread over 6 days. A printing with a market price (none
  today) isn't swept.
- **Clients.** The market-only price rule uses `intl_prices` only for Chinese (Pokémon) today. It
  now also does for `op` in `ja`, by game and language together, so Pokémon Japanese is unchanged.
  A Japanese One Piece card never takes an English price: the two are different printings with
  different card ids, and there is no cross-language fallback (`crossLanguagePriceFallback: false`).

### Call budget (my calls)

The eBay sweeps already share one counter (`sweep_calls_day`), capped at `SWEEP_DAILY_CALLS` = 2000,
with Yu-Gi-Oh first. Nothing about Yu-Gi-Oh or Pokémon changes:

| Sweep | Before | After |
| --- | --- | --- |
| Yu-Gi-Oh Asian sets | up to 2000/day, first call on the budget | same |
| Chinese Pokémon | up to `POKEMON_SWEEP_DAILY_CALLS` = 100/day, from what Yu-Gi-Oh can't need | same |
| Japanese One Piece | none | up to `ONEPIECE_SWEEP_DAILY_CALLS` = 60/day (capped at 200), from what Yu-Gi-Oh can't need **and** Pokémon hasn't spent of its 100 today |
| Total | ≤ 2000 | ≤ 2000 (all three count on the one counter) |

About 60 Japanese prefixes × 3 calls is 180 calls a week, about 30 a day, so 60 leaves room for
prefixes that page deeper. The knob is `ONEPIECE_SWEEP_DAILY_CALLS` in `wrangler.toml` ("0" is off),
like Pokémon's. The sweep runs in the same alarm, after Pokémon's. It stands down while any Yu-Gi-Oh
prefix is due, and when the eBay quota is unknown or near the reserve.

### What the user sees (my calls)

- **The language filter and badges are already data-driven** (Pokémon's work): the Language
  section lists the languages a game has rows in, and printings show their language tag (JP). One
  Piece gets Japanese in its Language filter as soon as Japanese rows land. Nothing new to build.
- A Japanese price is an eBay asking price with its check date, shown as Chinese Pokémon's is.
- Japanese cards are hidden from non-testers by the same server rules as English One Piece.

### Deploy order

1. The price Worker (`workers/ebay-prices`), with `/v1/onepiece-listings`.
2. The portal: `/img` for `ja:` art, the op sweep and its knob. Until the price Worker is out, the
   sweep's calls fail and each set backs off for a day. Until the portal is out, the job's Japanese
   art uploads still work (the upload route only checks the id range), but `/img` returns 404 for
   Japanese art on a cache miss.
3. The nightly job (its cache entry in `catalog.yml`).
4. A client release, for Japanese eBay prices on desktop and phone (the price rule lives in the
   client's SQL). The web app gets it with the portal deploy.

### Parked

- The Japanese name (`local_name`), and Japanese text for cards with an English twin.
- Prices for Japanese event promos (they are skipped).
- Re-labelling a `Parallel` once its English twin appears (labels freeze).

## Getting builds to the friend

The friend gets One Piece through **normal public releases**: every release carries the hidden
code, and the server's tester list decides who sees it, the same way Pokémon shipped before it
opened (my call; Play internal testing would also work if the owner adds him there). Hidden code
in public builds is fine as long as non-testers see no change.

## Constraints

- **Deploy the portal before any client release** that depends on it. Server migrations come
  first and are one-way.
- **Nothing heavy in tests.** No 100k-row synthetic data in vitest or Miniflare; any benchmarking
  goes in a capped standalone script (50,000 rows at most).
- **DO SQLite rejects large compound queries** (about 10-term UNIONs) that pass in better-sqlite3
  tests. Use one query per table in the Worker.
- **Hot portal queries use `+game = ?`** so the DO planner doesn't pick the `ix_*_game_seq`
  index (`tests/portal/game-index-plans.test.ts`). New One Piece queries follow the same rule.
- **Changing a `catalog.yml` cache path list** makes its caches cold and forces a full rebuild,
  which can trip the shrink guard. Add new paths knowing that.
- **Vitest runs with at most 2 workers** on this machine.

## Left to the builder

- How the game switch shows three games, on desktop, web and phone (mock up first).
- One Piece's color, rarity colors and version label wording.
- Which TCGplayer-only versions (stamps, Championship) become printings.
- The DON!! source, and whether DON!! ships in step 2 or after it.
- The Bandai fetch schedule, and whether to use punk-records as a cross-check.
- Where the Contribute photos screen sits, and the per-photo and daily caps.
- Whether Contribute photos is switched on for other games' testers.
