# Pokémon catalog and prices, English and Japanese (step 3)

Date: 2026-10-29. Status: written without questions at the owner's request ("skip the questions,
write it from the plan"). Every decision not taken from the parent spec is marked as my call.

Parent spec: `docs/superpowers/specs/2026-10-29-multi-game-pokemon-design.md`. Its intent,
anti-goals, data rules and old-client rules all apply here and are not repeated in full.

## Intent

Step 2 shipped an empty Pokémon game, visible only to the owner (v0.22.0). The owner can see the
Pokémon tab, but it has no cards. Step 3 fills it. Afterwards the owner can find any English or
Japanese Pokémon card by name or number, add it by hand on desktop or phone in the right version
(normal, reverse holo, holo, 1st Edition…), and see what it sells for in US dollars. The owner adds
cards about half on desktop and half on the phone.

Pokémon stays owner-only until step 5. Nothing in this step is visible to anyone else.

## Anti-goals (from the parent spec, restated for this step)

- **No price beats a wrong price.** A Japanese card never shows an English price. A version never
  shows another version's price. When the mapping from a card to its TCGplayer product is in any
  doubt, the card gets no price.
- **Prices show their age.** These prices come from the nightly job, so they are at most about a
  day old, the same as Yu-Gi-Oh's English TCGplayer prices. Yu-Gi-Oh shows no age for those daily
  prices today, so Pokémon adds no new age UI either (my call). A weekly or older source added
  later must show its date.
- **Always US dollars.** Both sources in this step (TCGplayer and TCGplayer Japan through TCGCSV)
  price in USD, so no currency conversion is needed yet.
- **Yu-Gi-Oh does not regress.** The nightly job still uploads Yu-Gi-Oh's catalog, prices and
  fingerprints when every Pokémon source is down. Yu-Gi-Oh rows, keys and the legacy feed stay
  byte-for-byte the same.
- **The owner's collection never loses a card** because an upstream source dropped or renamed it.

## Goals

1. The nightly catalog job builds the English and Japanese Pokémon catalog from TCGdex and uploads
   it to the portal through the existing catalog feed: cards, versions (printings), sets, card
   art and set logos.
2. The same job prices every version it can match from TCGCSV: category 3 (Pokemon) for English,
   category 85 (Pokemon Japan) for Japanese.
3. Card art and set logos are served through the portal's `/img/` routes and cached in R2, like
   Yu-Gi-Oh's.
4. Desktop and phone can search, browse, filter, add, edit and value Pokémon cards, with Pokémon
   card details (HP, stage, types, attacks, rarity, illustrator).

## Non-goals

- **Japanese eBay prices.** My call: deferred. The recon found that TCGplayer Japan lists
  Japanese sets back to the 1996 Expansion Pack, so it covers most cards. eBay matching for Pokémon
  would need a version-aware matcher, and versions are where a wrong price is easiest to make. The
  job reports how many Japanese versions have no price, so the gap can be measured before eBay is
  designed. Cards without a TCGplayer match show no price.
- **pokemontcg.io.** My call: not used. TCGdex covered every sampled set's card data. The only gap
  was missing Japanese art for recent sets, and TCGplayer's product images fill it (below).
- **Simplified Chinese** (step 4), **scanner** (step 5), **Rip**, graded slabs.
- **Making Pokémon visible to friends.** The `ADMIN_DISCORD_ID` gate stays.

## Sources (recon, 2026-10-29)

- **TCGdex** (`https://api.tcgdex.net/v2/{en,ja}`): 220 English sets with 23,736 cards, and 184
  Japanese sets with 12,781 cards.
  - Endpoints used: `/sets` (the list), `/sets/{id}` (the set with brief cards), and
    `/cards/{id}` (the full card). Its GraphQL endpoint errored on sets with null rarities, so the
    REST endpoints are used.
  - A full card has `localId`, `name`, `rarity`, `category`, `hp`, `types`, `stage`, `attacks`,
    `abilities`, `illustrator`, `set`, `image`, `variants`, `variants_detailed` and `thirdParty`.
    - `image` is a base URL. Append `/low.webp` or `/high.webp`.
    - Each `variants_detailed` item is `{type, subtype?, stamp?, thirdParty?{tcgplayer, cardmarket}}`.
      Its `type` is normal, reverse, holo and so on. Its `subtype` is, for example, unlimited,
      shadowless or no-rarity. Its `stamp` is, for example, `['1st-edition']`.
    - `thirdParty.tcgplayer` on the card or on a variant is a TCGplayer product id.
  - A set has `name`, `abbreviation.official` (for example SVI), `cardCount.official`, `logo`,
    `symbol` and `releaseDate`.
  - **Gaps:**
    - Recent Japanese sets have no art: M4, SV11W and M1L had 0 images, while SV1S and SV8a were
      full.
    - Older Japanese cards have no `image` and often no TCGplayer id (PMCG1, neo1, PCG1).
    - Some cards carry the TCGplayer id only at card level, not on the variant. For example M1L-001
      has variant tcgplayer null but card tcgplayer 647110.
    - Some cards have none. M4-001 has only cardmarket.
- **TCGCSV** (`https://tcgcsv.com/tcgplayer/{category}`): category 3 "Pokemon" has 220 groups and
  category 85 "Pokemon Japan" has 461 groups.
  - Endpoints: `/groups`, `/{groupId}/products` and `/{groupId}/prices`.
  - A product has `productId`, `name` and `imageUrl` (`…/product/{id}_200w.jpg`;
    `_in_1000x1000.jpg` also works). Its `extendedData` includes `Number` (for example `001/083`)
    and `Rarity`.
    - English product names are English. Japanese product names are also in English ("Weedle").
    - The oldest Japanese groups have no abbreviation, and their products have no `Number`.
  - Prices are rows of `{productId, subTypeName, marketPrice, …}`. Subtypes seen: Normal,
    Holofoil, Reverse Holofoil, 1st Edition, 1st Edition Holofoil, Unlimited and Unlimited
    Holofoil.
    - Japanese SV1S has Holofoil prices for 44 cards that TCGdex lists only as normal.
  - Requests need a real User-Agent; Python's default got HTTP 401.
- **Spot checks:**
  - sv01-001 → product 487828: Normal $0.12, Reverse Holofoil $0.22.
  - SV1S-001 → product 567118: Normal $0.15.
  - base1-4 Charizard has variants with different products: 42382 unlimited holo, 106999 for
    shadowless with and without the 1st Edition stamp, and one variant with none.

## Data

Step 2 already made every shared catalog table game-aware and added `pokemon_cards`. Step 3 adds
what's missing and fills the tables.

### Identity

- **Language codes** are `en` and `ja`, from `src/shared/languages.ts`.
- **Card.** One `cards` row per TCGdex card per language, with `game = 'pkm'`.
  - `pokemon_cards.source_id` is `{lang}/{tcgdexId}`, for example `en/sv01-001` or
    `ja/SV1S-001`. My call: the language is included because TCGdex ids are only unique within a
    language.
  - `cards.id` is `pokemonId(source_id)` from `src/shared/games/ids.ts`.
- **Version.** One `card_printings` row per version, with `game = 'pkm'`:
  - `set_name`: the TCGdex set name.
  - `set_code`: the printed number. It is `{abbrev} {localId}/{official}` (for example
    `SVI 001/198`). Without an official count it is `{abbrev} {localId}`, and without an
    abbreviation `{abbrev}` is the TCGdex set id in upper case. My call.
  - `set_rarity`: the version label (below).
  - `set_rarity_code` and `variant` are empty.
  - `tcg_product_id`: the matched product, or null.
  - `market_price`: the USD price, or null.
  - The generated `pkey` then follows the existing formula. Card ids at or above 2^40 keep it from
    ever colliding with a Yu-Gi-Oh key; this was step 2's scheme.
- **Rarity** is descriptive only. It is stored in `pokemon_cards.rarity` and is never part of the
  key.
- **Art.** Exactly one `card_images` row per card, with `game = 'pkm'` and
  `image_id = pokemonId(source_id + '#img')`. Every card gets one, even with no art source, because
  `collection_entries.image_id` is `NOT NULL REFERENCES card_images`. With no source the portal
  answers 404 and clients show their placeholder. When art turns up later, the same id fills on
  its next R2 miss.
- **Set.** One `sets` row per TCGdex set per language, with `game = 'pkm'`.
  - `set_name` is the TCGdex set name for English sets. For Japanese sets it is the matched
    TCGplayer Japan group's English name with any leading `"{code}: "` removed ("M4: Ninja
    Spinner" → "Ninja Spinner"). It is the Japanese name only when no group matched. My call: the
    owner reads English.
  - `set_code` is the abbreviation as above.
  - `tcg_date` is `releaseDate`.
  - `image_url` is the TCGdex logo URL, and `image_key` is `td-{lang}-{tcgdexSetId}`.

### Version labels

The label is what the owner sees in the rarity/version slot, and it is part of the pkey, so it
must be stable from night to night. In particular, a card that is unmatched tonight and matched
later must end up with the same labels, not a second set of them. So both sources map into one
canonical vocabulary (my call):

| Canonical label | TCGplayer `subTypeName` | TCGdex variant |
|---|---|---|
| Normal | Normal, Unlimited | type normal |
| Holofoil | Holofoil, Unlimited Holofoil | type holo |
| Reverse Holofoil | Reverse Holofoil | type reverse |
| 1st Edition | 1st Edition | normal + stamp `1st-edition` |
| 1st Edition Holofoil | 1st Edition Holofoil | holo + stamp `1st-edition` |

- A TCGplayer subtype or TCGdex variant not in the table gets its own name as the label: the
  subtype verbatim, or the variant's type, stamp and subtype title-cased. It is reported, so the
  table can grow.
- **Union.** A card's versions are the union of its TCGdex variants and the TCGplayer subtypes of
  its matched products, deduplicated by canonical label. This catches holos that TCGdex lists only
  as normal.
- **Several products.** When a card matches more than one product (Charizard's shadowless
  product), the versions taken from a product reached through a TCGdex variant with a `subtype`
  (shadowless, no-rarity…) get that subtype as a prefix, title-cased: "Shadowless 1st Edition
  Holofoil". Two different (product, subtype) pairs that would still share a label are both left
  unpriced and reported. A wrong merge is worse than a missing price.
- With no variants and no match, the card gets a single Normal version.

**Frozen identity (my call).** Once a version has been uploaded, its key parts never change:

- The job reads `set_name` and `set_code` for a card from its existing rows in `work.sqlite`, and
  only computes them for a card it has never written. Without that, TCGdex filling in an
  abbreviation or count, or a set's first TCGplayer match, would rekey every version. The cost is
  that a name fixed upstream after the first upload stays old; that is fixed by hand if it ever
  matters.
- So the first upload is the moment to get names right. The builder reviews a dry run's set
  names and numbers before the first real upload.
- **Sticky.** Once a version has been uploaded, the job never deletes it while its card still
  exists. If it disappears upstream, it is kept with `missing_from_api = 1`. My call: this protects
  the owner's entries, and it keeps a version from flickering when a subtype has no sales one
  night.

### New columns (migration V20 locally, server-13 on the portal)

These are added to `pokemon_cards`:

- `image_url TEXT`: the art source, either a TCGdex base URL or a TCGplayer product image URL.
- `local_name TEXT`: the Japanese name for Japanese cards.

The migrations are append-only, as usual. `CATALOG_TABLES` gains both columns for `pokemon_cards`.
`LEGACY_CATALOG_TABLES` doesn't change. Old and v0.22.0 clients are safe:

- The feed apply already skips columns the client doesn't have.
- Old clients don't receive Pokémon rows at all.

**Japanese names (my call):** `cards.name` is the English name when one is known, and
`pokemon_cards.local_name` keeps the Japanese name. The English name is the matched TCGplayer
Japan product's name, with a trailing ` - {number}` removed. When there is no match, `cards.name`
is the Japanese name and `local_name` is null. Search matches both names. Details show both. The
owner reads English, and the phone's search is typed in English.

`cards.desc` holds the card text as plain lines: abilities, then attacks with cost, damage and
effect. `cards.type` holds the category (Pokémon, Trainer, Energy). The other Yu-Gi-Oh columns
stay null.

### Size

About 36.5k cards, 36.5k `pokemon_cards` rows, up to 36.5k images and an estimated 60–80k
versions.

- Yu-Gi-Oh's catalog on the same Durable Object is of the same order, so one DO stays (parent
  spec: split only for a measured reason).
- The builder measures the real counts on the first dry run and puts them in the PR.

## The nightly job

`scripts/catalog/build.ts` gains a Pokémon refresh step after Yu-Gi-Oh's `refreshCatalog`. It
writes into the same `work.sqlite`. My call: put the Pokémon code in its own module,
`scripts/catalog/pokemon/` (TCGdex client, TCGCSV client, matcher, writer). The desktop never builds
the Pokémon catalog itself; it only pulls it from the feed.

**Fetching:**

- The TCGdex set lists and sets are read every night (about 400 requests).
- Full cards are cached in a job-local `catalog-work/pokemon-src.sqlite`, keyed by id with the
  time each card was fetched.
  - New cards are always fetched.
  - Cached cards are re-fetched once they are older than 7 days, so each night re-reads about a
    seventh of them.
  - Cards still missing art or a TCGplayer id are re-fetched every night. They are the ones
    upstream is most likely to fill in.
- TCGCSV groups, products and prices are read for both categories every night (about 1,400
  requests).
- All requests have a polite concurrency (4), a `DuelBinder/{version}` User-Agent and retries with
  backoff.
- That directory is already in the workflow's cache.

**Matching each set to a TCGCSV group** (category 3 for English, 85 for Japanese):

1. **Vote.** Collect every TCGplayer product id from the set's cards (variant level and card level).
   Find each id's group from the products lists. The group holding most of them wins, as long as it
   holds at least half of the ids.
2. **Name.** Otherwise, match the set's official abbreviation to the group's abbreviation, case
   insensitive. Failing that, match the normalized set name to the group name, with punctuation and
   any leading `"{code}: "` removed. Accept only a unique hit.
3. **No group.** Otherwise the set has no group, and its cards are unpriced. This is reported.

A set can also have cards in other groups, such as shadowless or promo products. Those are matched
through their product ids, as below.

**Matching each card to products:**

1. **Ids first.** Use the TCGdex product ids, first on the variants and then on the card.
2. **Then the number.** Without an id, match the card's `localId` within the set's group against
   each product's `Number` (the part before `/`, compared as numbers or exact strings). Accept only
   when exactly one card product has that number. Sealed products have no `Number` and so never
   match.
3. **Check.** Every product must agree with the card. A product that has a `Number` which
   disagrees with the card's `localId` is rejected and reported. This guards against bad ids
   upstream.
4. **No match.** Otherwise the card is unmatched: its versions come from TCGdex and have no price.

**Prices:**

- Pokémon TCGCSV data (groups, products, prices) stays in the job's `pokemon-src.sqlite` and is
  never uploaded. The uploaded `tcgplayer_groups` and `tcgplayer_products` tables stay
  Yu-Gi-Oh-only, so Pokémon products can never disturb Yu-Gi-Oh matching on clients.
- `market_price` for each version is the `marketPrice` of its (product, subtype) row when that is a
  positive finite number, else null. It is the same field Yu-Gi-Oh uses.
- There is no fallback to low or mid prices, to another subtype, to another product or to another
  language.
- The `MIN_MOVE_USD` / `MIN_MOVE_SHARE` rule in `src/main/tcgplayer/prices.ts` is exported as a
  small function and reused, so penny churn doesn't rewrite rows every night.

**Art:**

- `pokemon_cards.image_url` is the TCGdex `image` when present.
- Otherwise it is the first matched product's TCGplayer `imageUrl`.
- With neither, it is null (the card still has its `card_images` row).
- Once a card has an `image_url`, the job keeps it even if a better source appears later (my
  call). Clients and R2 cache art by image id, so a changed source would never reach them anyway.
  Only a null `image_url` is filled in.

**Upload:**

- The job's diff and upload move from `LEGACY_CATALOG_TABLES` to `CATALOG_TABLES`.
  - Yu-Gi-Oh rows already carry `game = 'ygo'`, so their diffs don't change.
  - The new tables are part of the same diff and upload, so there is no second upload path.
- The shrink guard (`findShrinks`) and the dry-run counts are split per table per game, so a
  Pokémon shrink can't hide inside Yu-Gi-Oh's 2%. A first upload, with no Pokémon rows in the
  base, is never a shrink.
- `catalog:parity` checks both games.

**Failure isolation:**

- If any Pokémon source fails during the night, the Pokémon refresh is abandoned for that night,
  and the work database keeps the previous night's Pokémon rows. The failure is reported as a
  problem, which turns the run red.
- Yu-Gi-Oh's catalog and fingerprints still upload.
- A partial Pokémon refresh is never uploaded: the Pokémon step writes in one transaction at the
  end.

**Reporting:** The job logs, per language:

- the set, card, version and image counts;
- the sets with no group;
- the cards with no match;
- the versions with a price and without one.

## Portal

- **server-13:** adds the two `pokemon_cards` columns. It is frozen once deployed, like server-12.
- **`/img/{small|full}/{imageId}`:**
  - An id at or above `PKM_ID_MIN` is resolved from `card_images` → `pokemon_cards.image_url`.
  - Only `https://assets.tcgdex.net/` and `https://tcgplayer-cdn.tcgplayer.com/` sources are
    allowed.
  - Size mapping:
    - TCGdex: small → `/low.webp`, full → `/high.webp`.
    - TCGplayer: small → `_200w.jpg`, full → `_in_1000x1000.jpg`.
  - `cropped` has no Pokémon source, so it returns 404.
  - The R2 keys stay `card/{size}/{imageId}`. Pokémon ids can't collide with YGOPRODeck ids.
  - Anonymous filling follows the same rule as Yu-Gi-Oh card art. Signed-out users can't see
    Pokémon ids anyway.
- **`/img/set/td-…`:** resolved from `sets.image_url` for `game = 'pkm'`. Only TCGdex sources are
  allowed. The URL gets a `.webp` suffix.
- **Unchanged:** the catalog feed (already per game and gated), sync, the owner gate and the
  legacy feed.

## Clients (desktop and phone)

**Price reading is per game.** The `GameDef` gains a price rule, so each reader stops hard-coding
Yu-Gi-Oh's.

- **Yu-Gi-Oh**, as today:
  - English: `market_price`, then intl, then `set_price`.
  - Other languages: intl, then the European→English twin.
- **Pokémon:**
  - Any language: `market_price` only.
  - No `set_price`, no twin, no intl in step 3.
- **Where it applies:** every place that computes a printing's price. That includes:
  - `repo/collection.ts`, `repo/sets.ts`, `repo/scan.ts`, `repo/cards.ts` and browse;
  - the phone's equivalents;
  - value snapshots;
  - dashboard totals.
- **Price age:** shown the way Yu-Gi-Oh English prices show theirs.
- **The eBay candidate picker** (`src/main/prices/candidates.ts`) keeps `game = 'ygo'`, so no
  Pokémon version is ever sent to eBay.

**Search and add:**

- Search matches the name, the Japanese name and the number. Both `045` and `045/193` find PAL 045.
- The add flow lists the card's versions in the version slot, together with the language, and
  shows each version's price when it has one.
- The flow is the same on desktop (`AddCardDialog`) and on the phone (`PickerSheet` /
  `ReviewSheet`).

**Card details for Pokémon:**

- Category, HP, types, stage, rarity, illustrator, the Japanese name for Japanese cards, and the
  card text from `cards.desc`.
- The number and version are shown as today.
- The layout comes from the game definition, not from `if (game === 'pkm')` scattered through
  the components.
- Desktop: `CardDetails.tsx`. Phone: `ScreenDetails.tsx`.

**Filters:**

- The existing `pkmCategories`, `pkmTypes`, `pkmStages` and `hp` facets now have data.
- Add a `pkmRarities` multi filter over `pokemon_cards.rarity`. The parent spec says rarity is
  filterable.
- The version filter reuses the existing rarity filter over `set_rarity`, labelled "Version" by the
  vocabulary.

**Sets screen:**

- Lists Pokémon sets for the active game with their TCGdex logos.

**Version colours:**

- A neutral default.
- Holofoil and Reverse Holofoil get distinct colours. Holofoil uses the existing holo/foil
  colour, if there is one.

**Art:**

- The Pokémon art comes through the portal, which the owner is always signed into.
- A Pokémon image id never falls back to YGOPRODeck's direct URL on the desktop.

## Rollout

1. Merge.
2. Deploy the portal (server-13 and the image routes) before anything else. Deploys are one-way.
3. Run the catalog workflow by hand (`workflow_dispatch`) to do the first Pokémon upload. Check its
   counts and the owner-only feed.
4. Release desktop and phone. A v0.22.0 client keeps working throughout:
   - It pulls Pokémon rows for the owner and ignores the new columns.
   - It prices Japanese Pokémon versions as unpriced until it updates, which is safe.

## Testing

- **Fixtures.** Small checked-in JSON for:
  - TCGdex: a few sv01 cards, a few SV1S cards, base1-4 with its shadowless and 1st-edition
    variants, M4-001 (no art, no id) and PMCG1-001 (old, no-rarity).
  - TCGCSV: the matching groups, products and prices, trimmed to those cards.
  - No heavy synthetic data. Any size benchmark is a capped standalone script of at most 50k rows.
- **Matcher tests:**
  - group vote, abbreviation and name fallback, and no group;
  - number fill, an ambiguous number, and number disagreement rejection;
  - version labels, the shadowless prefix, and a collision dropping both versions;
  - stickiness;
  - no price on an unmatched card, and no cross-subtype price.
- **Job tests:**
  - a Pokémon failure leaves Yu-Gi-Oh's upload intact and keeps the last Pokémon rows;
  - the shrink guard works per game.
- **Portal tests:**
  - the server-13 migration;
  - Pokémon image resolution, the allowed-host check and 404 for cropped;
  - set logos.
- **Client tests:**
  - per-game price rule (a Japanese Pokémon market price is used; a Japanese Pokémon card never
    gets a twin price);
  - search on the Japanese name and on the number;
  - Pokémon details fields;
  - the rarity facet.
- **Unchanged checks:** the existing Yu-Gi-Oh tests, including the legacy feed's frozen shape.
- **Run** vitest with `--maxWorkers=2`.

## Left to the builder

- The exact module split under `scripts/catalog/pokemon/`, the concurrency and retry numbers, and
  the cache file's schema.
- How `GameDef` expresses the price rule and the details layout (data or functions), as long as
  readers stop hard-coding Yu-Gi-Oh.
- Version colour values.
- Whether phone and desktop share the price SQL or each get the rule from `GameDef`.

## Calls I made (for the owner to check)

- Japanese eBay prices are deferred. The job measures the gap first.
- pokemontcg.io is not used.
- The card source id includes the language (`en/…`, `ja/…`).
- Japanese cards and sets are named in English when TCGplayer Japan knows them, with the Japanese
  card name kept and searchable.
- One canonical version vocabulary for both sources, so a later match never duplicates versions.
- A version's set name and number are frozen at first upload.
- Every card gets an image row, even without art, because entries require one.
- Pokémon TCGCSV data stays in the job and is never uploaded.
- No new price-age UI for daily TCGplayer prices, matching Yu-Gi-Oh.
- Ambiguous version labels are left unpriced, not merged.
- Versions are sticky: they are never deleted while the card exists.
- Japanese art falls back to TCGplayer product images.
- A Pokémon failure skips Pokémon for the night but never blocks Yu-Gi-Oh.
- The Pokémon catalog code lives in the job (`scripts/catalog/pokemon/`), not in the desktop app.
