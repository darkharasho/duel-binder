# Magic step 2b: non-English printings and back faces

Follows `2026-11-09-magic-design.md` (steps 1 and 2 shipped in v0.72.0 and v0.73.0). Its anti-goals
and Terms section bind this step unchanged. The owner asked for this while the scanner (step 3)
waits on Magic rip frames, and skipped the questions: every choice below is my call unless marked
otherwise.

## Intent

A collector with a Japanese or German Magic card can find that exact printing, add it, and see its
own art; and any two-faced card shows both faces. Today the catalog is English only and shows only
the front.

## Measured (Scryfall `all_cards`, 2026-11-09)

`all_cards` is one object per printing per language: 404 MB gzipped, rebuilt every 12 hours, listed
at `api.scryfall.com/bulk-data` as `all_cards`.

| lang (Scryfall) | paper objects | printing × finish rows | distinct oracle cards | priced rows |
|---|---|---|---|---|
| en | 108,229 | 160,834 | 38,403 | 148,191 |
| ja | 62,939 | 106,342 | 31,068 | 684 |
| fr | 59,602 | 99,714 | 31,144 | 246 |
| de | 59,268 | 99,587 | 31,152 | 104 |
| es | 54,062 | 90,687 | 30,349 | 262 |
| it | 53,441 | 89,491 | 30,534 | 63 |
| zhs | 40,870 | 73,664 | 24,044 | 11 |
| pt | 39,593 | 69,440 | 25,355 | 221 |
| zht | 23,582 | 41,707 | 17,526 | 1 |
| ru | 21,761 | 40,741 | 15,965 | 1 |
| ko | 15,383 | 28,315 | 12,570 | 0 |
| others (ph, qya, tlh, grc, he, ar, la, sa, dw) | 84 | 120 | – | – |

- Non-English adds about **430k objects, 740k printing rows, 250k cards** in ten languages: about
  4.6× today's Magic catalog. Today's desktop database holds 626k printings in 562 MB.
- **Prices:** Scryfall has almost none for non-English (under 0.3%).
- **Images:** non-English objects are `lowres` (most), `highres_scan`, or `placeholder` (about
  85k, a Scryfall stand-in card, not the real one) / `missing` (27).
- **Names:** `printed_name` is set on 97%+ of non-English objects (Korean 86%, Traditional Chinese
  71%); `printed_text` on most.
- **Two faces:** 11,261 multi-face objects in all languages; 8,338 of them have an image per face
  (`transform`, `modal_dfc`, `double_faced_token`, `reversible_card`, `art_series`). The rest
  (`split`, `adventure`, `flip`, `prepare`) are one image with two halves.

## Goals

1. **Non-English printings** in ten languages: ja, ko, de, fr, it, es, pt, zh-hans (`zhs`),
   zh-hant (`zht`), and **ru (Russian), a new app language** (tag `RU`, label "Russian").
2. **Back faces** of every Magic object that has an image per face, on desktop, web and phone.

## Non-goals

- The novelty languages (Phyrexian, Quenya, Klingon, Ancient Greek, Hebrew, Arabic, Latin,
  Sanskrit, Dwarvish): 84 objects, no app language fits them. Dropped silently, as digital cards are.
- Non-English prices beyond the few Scryfall has. **No English fallback**:
  `crossLanguagePriceFallback` stays `false` (a Japanese Magic card is not the English card's
  price; no price beats a wrong price). An eBay sweep is a later step if the owner wants it.
- Printed (translated) rules text. The card keeps the English oracle text; only the printed name is
  stored. (Space: printed text would roughly double the new card rows.)
- Back faces in grids, binders and tiles. Those show the front; flipping is a details action.
- Back-face scanning (step 3's business).

## Anti-goals (this step)

- **Yu-Gi-Oh!, Pokémon and One Piece don't change.** Adding `ru` to `LANGUAGES` must not change any
  of their rows, filters, sweeps or scan paths. Every `LANGUAGES` reader is checked.
- **A Scryfall placeholder shown as a card's art.** A placeholder object shows the English printing's
  art (same set and collector number) or the app placeholder, never Scryfall's stand-in image.
- **English Magic regressing:** its ids, keys, prices and images stay byte-identical.
- **A night that times out halfway.** The first upload carries about 1.4M new rows.

## Design

### Source

- The Magic stage downloads **`all_cards` instead of `default_cards`** (one file holds every
  language, English included, with the same fields). Skip it when `updated_at` is unchanged, as now.
- The job must not hold 530k full Scryfall objects in memory: objects are reduced to the fields the
  rows need as they're parsed (the builder picks how).
- Kept: paper, not digital, `lang` in the eleven above. Scryfall `lang` maps to the app code
  (`zhs` → `zh-hans`, `zht` → `zh-hant`, others the same).

### Identity (extends step 1's, nothing existing moves)

- **A card** per language per oracle card: `mtgCardId(lang, oracleId)` with the app language code
  (`'ja'`, `'zh-hans'`, `'ru'`, …). English ids are unchanged.
- `cards.name` is the **English oracle name** (search, sort and the scanner keep working across
  languages, as Pokémon's Japanese cards do). New column `mtg_cards.local_name` holds the printed
  name (face names joined with ` // ` for two-faced cards), null when Scryfall has none or it equals
  the English name. It shows as the "Printed name" detail and is searched like Pokémon's
  `local_name`.
- Game text (types, mana, rules text, stats, faces JSON) is the oracle card's, so all languages of
  one card agree.
- **An image** is still one Scryfall object: `mtgImageId(scryfallId)`. Non-English Scryfall ids
  are their own UUIDs, so no prefix is needed.
- **A printing** keeps the step 2 form; `language` is the app code. `set_code`
  (`'MH3 123'`) repeats across languages, so `pkey` stays unique through its language field.
- **Sets:** one row per (language, set), the same set code and name as English. The Sets page
  already groups by language.

### Each printing's own art (a step 2 gap)

Today a Magic printing shows its card's oldest art (`printingArtImageId` only knows One Piece), so
every Lightning Bolt printing shows the same picture. This step makes a Magic printing show its own
object's image, `mtgImageId(set_rarity_code)`, exactly as a One Piece version does; a new language
card would otherwise show one picture for all its printings.

### Placeholder art

New column `mtg_images.art_from`: null means the object's own Scryfall image. When an object's
`image_status` is `placeholder` or `missing`, `art_from` is the Scryfall id of the English object
with the same set and collector number (its art is fetched instead), or `'none'` when there is no
such English object with a real image; then the Worker answers 404 and the app shows its
placeholder, as for any missing art. (English objects can be `missing` too: 162 today; they get
`'none'`.)

### Back faces

- New column `mtg_images.back_image_id`: set when every face of the object has its own
  `image_uris`, to `mtgBackImageId(scryfallId)` = `mtgId('<scryfall id>#back')`; null otherwise.
  The back has no `card_images` row, so it never shows up as another art of the card.
- `scryfallArtUrl` takes a face (`'front' | 'back'`). The Worker's `/img` Magic branch looks an id
  up as `image_id`, else as `back_image_id` (indexed), and fetches `.../back/...` for the latter
  (from `art_from`'s object when that is a Scryfall id). R2 stores it under the back id like any
  image.
- **Details on desktop, web and phone** (the shared `CardPanel`) get a flip control on Magic art
  whose image has a back: it swaps the shown art between faces. `CardImage` carries
  `backImageId` for Magic. The front is the default everywhere, including after re-opening the card.
- Details text already lists both faces (the faces JSON); unchanged.

### New columns

`mtg_cards.lang` (app language, default `'en'`, so the job can rebuild each card's id source for
its collision check) and `mtg_cards.local_name`; `mtg_images.back_image_id` and
`mtg_images.art_from`. Desktop migration 45 and a server step that re-creates the two tables' seq
triggers over the new columns, as server-40 did for `dex_no`. Filling `back_image_id` and
`art_from` on English rows re-sends those rows once; their ids, keys and prices don't change.

### Size and the first night

- The Magic stage keeps its own error handling: a failure leaves last night's rows.
- The upload step's timeout goes up enough for the first night's 1.4M rows (measure the rate from the
  local build; the job's overall 340 minutes stays the ceiling).
- The language list is one constant (`MTG_LANGUAGES`), so dropping a language is a one-line change
  if the sizes hurt.
- **Before the PR merges**, the builder runs the Magic stage locally against the real file and
  reports: rows per table, desktop database growth, peak memory and stage time. If desktop growth
  is over 1 GB or peak memory over 3 GB, stop and report rather than ship.

### UI

- `ru` appears in language chips and the language picker only where data exists, as every language
  does today.
- Collection, Browse, Sets, Add Card and binders already handle languages. Check them on Magic with
  a Japanese and a Russian card.
- No other UI changes besides the flip control and the "Printed name" detail.

## What's left to the builder

How objects are slimmed while streaming, where the flip control sits in `CardPanel`, the upload
timeout value, and how placeholder fallback finds the English object (two passes or an index of
English set + number).
