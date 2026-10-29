# Multi-game Duel Binder, starting with Pokémon

Date: 2026-10-29. Status: approved 2026-10-29.

## Intent

The owner wants Duel Binder to become a multi-TCG app, and Pokémon is the first new game. Two
people drive it:

- **The owner** wants to track their Pokémon cards exactly the way they track Yu-Gi-Oh today, in
  the same app. They add cards about half on desktop and half on the phone.
- **The owner's friends** stream Pokémon pack openings and want the desktop scan window (the
  stream feature: the camera in its own window, with an overlay naming each pull and its price,
  `docs/superpowers/specs/2026-10-26-scan-window-design.md`) for Pokémon. For them, scanning is
  the reason to use the app.

Languages that must work: **English, Japanese and Simplified Chinese** (mainland). Simplified
Chinese is what the friends open almost exclusively. Traditional Chinese is not needed.

**The UI stays the same, just Pokémon.** Every screen keeps its layout and behavior. Only the
vocabulary, filters and data change per game.

## Anti-goals (failure even if everything technically works)

The owner named two: **wrong prices, and misidentified cards on stream.** So:

- **The scanner names a card only when it is sure.** Otherwise the overlay shows nothing or "not
  sure". The same rule as the Yu-Gi-Oh scanner, with the same kind of accuracy gate (zero wrong on
  a checked-in test set) before Pokémon scanning reaches friends.
- **No price beats a wrong price.** A Japanese or Chinese Pokémon card never borrows the English
  card's price. The European→English fallback Yu-Gi-Oh uses (`src/main/repo/enTwin.ts`) does not
  apply to Pokémon.
- **Versions are priced separately.** A reverse holo never shows the normal version's price, and
  the reverse.
- **Prices show their age.** A price from a weekly sweep is not presented as live.
- **Always US dollars** (the owner decided), matching Yu-Gi-Oh's "what it sells for in the US".
  A source that prices in another currency (yuan, yen) is converted to USD with a dated rate, and
  the price records which source and rate it came from. Prices on the wire and in storage stay USD.
- **Yu-Gi-Oh does not regress.** Existing collections, sync, friends' binders, prices, scan, Rip,
  the phone app and signed auto-updates keep working, with no action from any user.

## Goals and non-goals

Goals, in order (each step depends on the one before):

1. **Org move and repo cleanup.** No user-visible change.
2. **Multi-game app.** A whole-app game switch. Yu-Gi-Oh works exactly as now.
3. **Pokémon catalog and prices, English and Japanese.** Add cards by hand, see their value.
4. **Pokémon Simplified Chinese catalog and prices.**
5. **Pokémon scanner**, including the scan window overlay, desktop and phone.

Steps 1 and 2 are specified here in enough detail to plan. Steps 3–5 are sketched so step 2
doesn't box them in; each gets its own design before it is built.

Non-goals (for now, but the design must not block them):

- **Graded slabs** (PSA, CGC, BGS). Wanted "eventually", for both games. Don't shape storage so a
  slab can't later be a property of a collection entry.
- **Rip for Pokémon.** Rip stays Yu-Gi-Oh only.
- **Other games, rebranding, a new domain.** "Duel Binder" and duelbinder.com stay.
- **Combined totals across games.** Nothing adds Yu-Gi-Oh and Pokémon together.
- **Traditional Chinese, Korean, Thai, Indonesian, European-language Pokémon.**
- **A separate sign-in (SSO) service** shared by the iOS, web and desktop apps. The owner raised it
  as "later". Today all three already sign in through the portal Worker; nothing here should make
  pulling sign-in out into its own service harder.

## Step 1: org move and repo cleanup

**Org.** GitHub org `duelbinder` (display name "Duel Binder"). The owner chose the name; the URL
slug without a hyphen is my call (both were free on 2026-10-29). Transfer `darkharasho/duel-binder`
to `duelbinder/duel-binder`.

What has to keep working, each checked after the move:

- **Auto-updates on already-installed apps.** Installed builds have `owner: darkharasho` baked in
  (`electron-builder.yml` → `app-update.yml`). GitHub redirects transferred repos, but that must be
  proven: an older installed build (at least Linux and Windows; macOS too if a machine is at hand)
  has to find and install a release published under the new org. If the redirect doesn't carry
  electron-updater, stop and rethink before publishing the next release.
- `electron-builder.yml` `publish.owner`, `package.json` `homepage`, README links, and any links
  on the marketing site point at the new org.
- **CI:** `ci.yml`, `release.yml`, `catalog.yml` (nightly), `ios.yml`. Repo secrets move with a
  transfer, but check each one is present, plus any self-hosted runner registration.
- **Cloudflare:** any Workers Builds / GitHub App connection gets re-authorized for the org.
- **Not affected:** the macOS appId `com.darkharasho.yugiohcollectiontracker` and the iOS appId
  `com.darkharasho.duelbinder`. Both stay as they are: changing them breaks signed updates and the
  App Store listing.

**Workspaces.** Split the repo into npm workspaces along the boundaries that already exist (desktop
app, phone app, portal Worker, eBay prices Worker, shared code). This is moves and config only: no
behavior change, the same tests passing, the same build outputs, and the nightly catalog job and
release still working. It lands before step 2, because step 2 touches nearly every file and the two
would conflict. How far to split the shared code, and the exact layout, is the builder's call; the
rule is that nothing is published as a separate package and the phone, desktop and Worker keep
sharing code from source.

## Step 2: multi-game app

### How it behaves

- **Both games are always available to everyone.** There is no first-run game choice.
- **A whole-app switch.** On Pokémon, every screen (Collection, Browse, Sets, Add Card, Dashboard,
  Scan and the scan window, Friends, Settings where it's game-specific, and the phone app) shows
  only Pokémon until the user switches back.
- **The app opens on the last game used.** Remembered per device, desktop and phone separately.
- **Friends' binders follow the switch.** On Pokémon you see your friends' Pokémon cards.
- **The switch's look and place is the builder's call**, within "the UI stays the same". It must be
  reachable from every screen on desktop and phone and must make the current game obvious at a
  glance. Mock it up for the owner before building.
- **Pokémon stays hidden from everyone but the owner until step 5 ships** (the owner decided).
  Step 2 ships as a Yu-Gi-Oh-only release that is internally multi-game. From step 3 the owner's
  account sees the switch and Pokémon; everyone else, friends included, gets it when the scanner
  has passed its accuracy gate. Keying this off the existing owner id (`ADMIN_DISCORD_ID`, used by
  `/admin`) and enforcing it on the server, not just by hiding UI, is my call.
- **The web app (app.duelbinder.com) follows the switch too**, like desktop and phone, and
  remembers the last game per browser. (My call, from "the UI stays the same".)
- **Step 2 includes a real, empty Pokémon game**, hidden: its definition (vocabulary, filters,
  card fields, features), its tables in the migrations, and its key namespace. The old-client rules
  and the no-collision rule are tested against small Pokémon fixtures. (My call: migrations are
  append-only and the portal deploy is one-way, so Pokémon's identity has to be right before
  anything ships, not discovered in step 3.)

### A game definition

Everything that differs per game goes behind one per-game definition in shared code, used by
desktop, phone and the Worker. Yu-Gi-Oh moves behind it first, with no visible change. It covers at
least:

- Vocabulary: card identity terms (passcode vs. card number), regions (OCG/TCG for Yu-Gi-Oh,
  languages for Pokémon), rarity names and colors (`src/renderer/src/lib/rarityColors.ts`), set
  labels and set types (`setLabels.ts`, `src/shared/setTypes.ts`).
- Filters, facets and sorts. Today `CollectionFilters`, `BrowseFilters`, `BrowseFacets` and
  `CollectionStats.byFrameType` in `src/shared/types.ts` hard-code attribute, race, level, ATK/DEF.
  Pokémon needs type, stage, Pokémon/Trainer/Energy, HP and so on. `FacetMenu` is already generic
  over facet lists.
- Card details layout (`CardDetails.tsx`, `cardFacts.ts`).
- Which price sources apply and in what order, and whether a cross-language fallback is allowed
  (Yu-Gi-Oh: yes, as today; Pokémon: no).
- Which features exist (Rip: Yu-Gi-Oh only; Scan per game, so a game can exist before its
  scanner does).
- A scan profile (step 5).

### Data

Today nothing models a game. Card ids are YGOPRODeck passcodes, `card_printings.pkey` is
`en|card_id|set_code|set_rarity` or `lang|card_id|set_name|set_code|set_rarity`, `imageId` is a
YGOPRODeck art id, and the sync wire format (`WireEntry`, `WirePrice` in `src/shared/cloud.ts`)
carries bare `pkey` and `imageId`. Rules:

- **Every existing Yu-Gi-Oh key stays byte-for-byte the same.** Existing rows, pkeys, image ids and
  wire messages don't change. Anything without a game is Yu-Gi-Oh.
- **Pokémon keys can never collide with Yu-Gi-Oh keys**, locally, on the server, in R2 image keys
  and in the fingerprint file. Namespacing them (for example a `pkm|` pkey prefix) is the obvious
  way; the exact scheme is the builder's call.
- **Pokémon identity:** a card is a card number in a set in a language (`PAL 045/193`, English).
  The **version** (normal, reverse holo, holo, 1st Edition, and whatever else the step 3 sources
  distinguish) is part of what's counted and priced, the way rarity is for Yu-Gi-Oh today. Each
  version has its own quantity and price. Pokémon rarity (Illustration Rare and so on) is
  descriptive and filterable, not part of identity.
- **Game-specific card fields** (Yu-Gi-Oh's attribute/ATK/DEF, Pokémon's HP/stage/attacks) stay
  per game. Shared things (printings, sets, collection entries, prices, images, value snapshots,
  sync) are game-aware. Whether that's a `game` column on shared tables plus per-game card tables,
  or something else, is the builder's call. Migrations stay append-only in the existing `MIGRATIONS`
  list, and must also work on the portal's Durable Object (which cannot turn foreign keys off;
  see `workers/portal/src/migrate.ts`) and on the phone's wasm SQLite.
- **Dashboard history** (`value_snapshots`) is per game.
- **Server:** stays one Durable Object unless there's a measured reason to split. The builder
  estimates the Pokémon catalog's size there before step 3.

### Old clients

Users don't all update at once. An old desktop or phone build that knows nothing of Pokémon must
never lose, overwrite or "fix" Pokémon data, and must never break on it. In practice the server
should not send Pokémon entries, prices or catalog rows to a client that hasn't said it understands
games, and must never treat their absence in an old client's push as a deletion. Older clients must
also keep syncing Yu-Gi-Oh normally. How a client says it understands games (a version or capability
field) is the builder's call. Note that `checkPush` already ignores unknown fields, and that the
phone pulls only `PHONE_TABLES`.

## Steps 3–5 (sketch, each gets its own design)

### Step 3: Pokémon catalog and prices, English and Japanese

- **Catalog and images:** TCGdex (`api.tcgdex.net/v2/{en,ja}`) looks complete for both (220 English
  and 184 Japanese sets on 2026-10-29; Japanese SV1S had full card data and image URLs). It also
  lists versions per card. Images get cached in R2 like Yu-Gi-Oh's. Built by the nightly catalog job.
- **English prices:** TCGplayer via TCGCSV, which the app already uses for Yu-Gi-Oh (category 2).
  Pokémon is category 3, and Pokémon Japan category 85 (to verify). TCGplayer prices per subtype
  (Normal, Holofoil, Reverse Holofoil, 1st Edition…), which maps to versions. pokemontcg.io is the
  fallback source; the abandoned HitCheck project (`~/Documents/GitHub/pokemon-card-stream-pricer`)
  found it returned 500s often (5 runs to sync 20,479 cards) and had 52 dead images.
- **Japanese prices:** TCGplayer Japan where it has the card, else the eBay sweep
  (`workers/ebay-prices`, Yu-Gi-Oh-specific today: rarity aliases, set-code sweep keys).

### Step 4: Simplified Chinese

The riskiest data in the project. On 2026-10-29 TCGdex listed about 50 mainland sets (CS…, CSV…,
CSM…, gem packs) but every set checked had an empty card list, and some entries under `zh-cn` were
Traditional Chinese sets. There's no official mainland card list. Candidates: PikaQian
(pikaqian.com, has an API with prices and images), `github.com/zstoke/pokemon-tcg-api`,
pokemontcgapi.com, Master Setter. Their set and card counts disagree. Step 4 starts with a short
comparison against real cards (coverage, images, licensing, prices), and may end in building some
set lists ourselves, as was done for Yu-Gi-Oh with Yugipedia. The owner can supply physical
Simplified Chinese cards (for checking data and for the scanner's test set), and eBay listings are
an acceptable fallback route for building card data. Prices: eBay sweep, and PikaQian if it
checks out.

### Step 5: Pokémon scanner

- Reuses the generic pipeline (camera, detection; Pokémon cards share Yu-Gi-Oh's 0.69 aspect),
  tracking, scan loop, outbox, overlay, and the DCT fingerprint format, which needs a per-game file.
- Pokémon-specific: the collector number (`045/193`) and set code in the bottom corner, card regions,
  the name position, language detection for Japanese and Chinese, and **version detection** (reverse
  holo foil is across the card frame, holo is on the art).
- If the card is known but the version isn't, the overlay must not show a price that could belong to
  the wrong version. How it handles that is for step 5's design.
- Same accuracy gate as Yu-Gi-Oh before friends get it. HitCheck's off-the-shelf image matching
  failed (5% top-1 on degraded stream captures), but that was other people's compressed streams; a
  webcam on the desk is what Duel Binder already handles.

## Left to the builder

- Workspace layout and how far to split shared code.
- The data shape for multi-game (columns vs. per-game tables), the key namespacing scheme, and how
  old clients are detected.
- The game switch's look and placement, mocked up for the owner first.
- How the per-game definition is structured in code.

## Calls I made (for the owner to check)

- Org URL slug `duelbinder`.
- The workspace split comes before step 2.
- Pokémon is gated on the owner's id, enforced server-side, until step 5.
- No combined cross-game totals.
- The web app follows the switch.
- Step 2 defines an empty, hidden Pokémon game, not just the abstraction.
- TCGdex as the main Pokémon catalog source, TCGCSV for English and Japanese TCGplayer prices.
- Pokémon gets no cross-language price fallback.
