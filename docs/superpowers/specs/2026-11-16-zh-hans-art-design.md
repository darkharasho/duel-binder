# Simplified Chinese card and pack art

Date: 2026-11-16. Approved by the owner in chat ("go for it, but we do need the variants for like gempacks").

## Why

Every Simplified Chinese (zh-hans) card in the catalog has no art of its own (12,754 cards).
11,820 of them borrow English, Japanese or Traditional twin art. About 930 have nothing. No
zh-hans set has pack art. The scanner never sees real Chinese art: it matches the English twin
and maps across, and it picks Gem Pack versions by foil pattern alone.

## Sources

- **PokiPair** (pokipair.com, an Irish shop). It has 73 Simplified Chinese set pages, linked
  from `/simplified-chinese-pokemon-set-list/`.
  - **Most pages** list `li.pp-card` items. Each item carries:
    - `data-number` ("006/207");
    - `data-variant` (`normal`, `holo`, `full-art`, `ace`, `pokeball-reverse`,
      `masterball-reverse`);
    - `data-full`, a full PNG of about 260 KB on media.pokipair.com;
    - `data-caption` ("006/207 · Illumise · Common").
  - **Gem Pack pages** carry no number or name. Their images run in our catalog's order: CBB7C
    has 196 images, the same count as our cards. The 001–007 images are Raticate 0101–0107 and
    196 is Hydrapple 2807, all checked by eye.
  - **Terms:** their terms forbid scraping (clause (h)). The owner read them, was told that (h)
    stands on its own, and chose to use the site anyway in good faith. The art belongs to TPC.
- **Pack art from pokemon.cn.** The official product list at `/products_category/products/`
  has product names ("补充包 共逐荣光") and images on image.pokemon.com.cn. Those image URLs need
  an `auth_key` that expires, and the files are large (7.8 MB PNG).

## Approach (owner-approved)

Copy each image once into our own R2 storage, politely, and never link to either site. Rejected
alternatives:
- Hotlinking: every user would load PokiPair, and pokemon.cn's keys expire.
- Fetching on demand in the portal: the same load, plus live failures like Ascended Heroes had.

## Design

- **Where the copies live.** In R2 as hand art, which the app already supports end to end:
  - the catalog's `image_url` is `${HAND_ART_PREFIX}<id>`;
  - the portal serves `hand/<id>/high.jpg` and `hand/<id>/low.jpg`;
  - the fingerprints read `<base>/low.jpg`.

  The id is the source id in lowercase with `/` changed to `-` (for example
  `zh-hans-cbb7c-0101`), so the portal's lowercase-only `HAND_PATH_RE` serves it directly.
- **Upload.** A new admin route, `PUT /api/admin/hand-art/<id>/(high|low)`, behind
  `PORTAL_ADMIN_TOKEN`, takes JPEGs only. It is modelled on `op-art`.
- **Mirror job** (`scripts/catalog/pokemon/pokipair.ts`), a new step in the catalog workflow
  before the Pokémon refresh:
  1. Read the hub, then each set page, then each image: one request at a time with a 1-second
     gap, a `DuelBinder/catalog` User-Agent, and a nightly budget of 1,500 images. The full
     backlog therefore takes several nights.
  2. Match a page to our set by the code in its slug or title (`csv8` to `CSV8C`, `cs4a` to
     `CS4aC`). A small table covers the rest, such as Gem Pack Vol N to `CBBNC` and the 151
     pages to `151C`. An unmapped page is logged and skipped.
  3. Match a card on a numbered page by set, number and English name, using the same name rule
     as the TCGplayer art match. A disagreement gets no art: a wrong image is worse than none.
  4. Match a card on a Gem Pack page by position. This applies only when the page's image count
     equals the set's card count; otherwise the whole page is skipped.
  5. Which image a card takes: `normal`, then `holo`, `full-art` and `ace`, each for its own
     card. On regular sets, the `pokeball-reverse` and `masterball-reverse` images belong to
     printings of the same card. They are recorded in the manifest but not downloaded yet,
     because Pokémon has no per-printing art. See "Later".
  6. Convert each image to `high.jpg` (the full size) and `low.jpg` (about 245 px wide, as
     `smallJpeg`), then upload both.
  7. Keep the done list and the matches in `catalog-work/pokipair.json` (Actions cache). The
     Pokémon stage reads that file, so the art reaches the catalog the same night it lands in R2.
- **Catalog.** `handArtUrl` gains the PokiPair map. A zh-hans card in it gets the hand URL. The
  existing write path then clears the twin links (`write.ts:515`), and the card's own art is
  shown everywhere.
- **Pack art** (`setArt.ts`), weekly with the existing set-art refresh:
  1. Read pokemon.cn's product list.
  2. Match a product to a zh-hans set by its Chinese set name, from the zsjy947 list.
  3. Mirror the image into R2 as `hand/zh-hans-pack-<set>/high.jpg`, downscaled.
  4. Write it as a `pokemon_set_art` row (`zh-hans`, `pack`, order 0) with a hand URL. The
     portal's set-art lookup accepts hand URLs for `pack`.

  A set with no official product image falls back to PokiPair's set thumbnail, through the same
  path.
- **Scanner.** zh-hans cards with their own art get their own fingerprints. They are not
  excluded today. Two scanner paths change once the zh-hans fingerprints exist:
  - `chineseOfArt`, which maps an English match to its Chinese card only while
    `z.image_url IS NULL`;
  - Gem Pack version picking (`resolvePokemon` `versionsDraft` plus `gemPattern`).

  Both need checking on the photo corpus, the 30thC set and the owner's Gem Pack traces before
  this ships. If they get worse, the zh-hans fingerprints stay off behind `UNSCANNED_SOURCES`
  and only the display art ships.
- **Credit.** About gets "Simplified Chinese card images: PokiPair (pokipair.com)". If PokiPair
  asks us to stop, we delete the `hand/zh-hans-*` keys and remove the map.

## Later (not in this change)

- Per-printing art for Pokémon (Poké Ball and Master Ball reverse images), using the image
  URLs already recorded in the manifest.
- Simplified Chinese prices. PokiPair has only sealed products; the eBay sweep stays.
- English Trainer Kit art from pokemon.com in the owner's Chrome. This is a separate task.

## Builder's calls

- **Budget, gap, concurrency:** 1,500 images, a 1-second gap, one request at a time. If a run
  sees 429s, it stops and continues the next night.
- **JPEG quality:** 85 for `high` and the `smallJpeg` setting for `low`.
