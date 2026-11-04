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
5. **Later, not designed here:** Japanese catalog and eBay prices, Simplified Chinese.

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
