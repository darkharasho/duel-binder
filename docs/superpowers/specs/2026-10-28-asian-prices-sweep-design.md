# Prices for every card: weekly eBay set sweep + English fallback

Date: 2026-10-28. Status: draft for approval.

## Intent

The owner wants a sensible price on every card in a binder. "Sensible" means **the US price**, what
the card goes for on eBay US, not a Japanese shop price. What exists works well and stays:
TCGplayer market price for English printings, and eBay US asking prices (median after trimming
outliers, `workers/ebay-prices/src/price.js`) for everything else. The problem is coverage. eBay
prices are fetched only for printings someone owns or has just looked at, a few at a time, so most
foreign printings show no price. The stream (scan window) view almost never shows one, because it
reads a card's price once at recognition time, before any lookup has finished.

**Speed matters more than per-language precision.** The owner said so, and accepted the English
price as a fallback for European printings.

## Today (facts the builder needs)

- **No client calls eBay.**
  - The portal Durable Object's price alarm (`workers/portal/src/prices.ts`) prices printings with
    `refreshIntlPrices` (`src/main/prices/refresh.ts`).
    - It runs in batches of 25 and calls the `ygo-ebay-prices` Worker through the `PRICES` service
      binding.
    - It prices only printings that are owned by anyone or in `price_requests` (7 days), and stale
      after 7 days (`src/main/prices/candidates.ts`).
  - Results go to the portal's `intl_prices(printing_id, price, listing_count, checked_at)`.
- **Clients get eBay prices only for printings they own or requested**, through
  `POST /api/sync/prices` (`stalePricePkeys`, max 1000 per sync). Sign-in is required on every
  client (`signInRequired`, `src/main/index.ts`), and `/api/catalog/changes` already needs a token.
- **Shown price.**
  - English: `market_price`, then `ip.price`, then YGOPRODeck `set_price` (marked approximate).
  - Non-English: `ip.price` only.
  - This is computed in four places:
    - `src/main/repo/collection.ts:45-85`
    - `sets.ts:172` (`PRINTING_PRICE`)
    - `scan.ts:23`
    - `stats.ts`
  - The comments in those files say there is deliberately no English fallback. This design reverses
    that.
- **Stream view.**
  - `pullOf` copies `picked?.price` once (`src/renderer/src/features/scan/window/overlay.ts`).
  - Set mode caches set printings with `staleTime: Infinity` (`window/ScanWindowApp.tsx:48-54`).
  - The scan window never listens for data changes.
- **Quota.** The eBay Browse API default is about 5,000 calls a day. On-demand requests are capped
  at 1,000 printings a day across all users, about 2,000 calls (`workers/portal/src/priceRequests.ts`).
  There are no cron triggers in either Worker; the Durable Object alarm is the only scheduler.
- **Scale.** About 342k printings. Foreign printings by language:

  | Language | Printings |
  |---|---|
  | ja | 42k |
  | ko | 35k |
  | zh-hans | 15k |
  | ae | 11k |
  | de, fr, it, es, pt | about 190k combined |

  Distinct set prefixes: 842 JP, 481 KR, 120 SC, 17 TC, 84 AE.

## Goals

1. **Every European printing** (de, fr, it, es, pt) without its own eBay price shows the English
   TCGplayer price of the same card, same rarity and same set number, marked as an estimate ("≈").
   It appears immediately, with no eBay call.
2. **Every Asian printing** (ja, ko, zh-hans, zh-hant, ae) gets an eBay US price refreshed about
   weekly, from a server-side sweep that prices a whole set per search, not one card per search.
3. **Clients have these prices before anyone looks at the card.** Every client (desktop, web,
   phone) holds the server's prices for all printings and keeps them current with small deltas.
   That makes the stream view, checklists and binder values show prices instantly.
4. **The stream view shows a price** for a duplicate or repeat scan as soon as one exists, and
   updates an on-screen card when a price arrives.

## Non-goals

- Japanese shop prices (Yuyu-tei, CardRush and the like). They were considered and left out:
  their terms forbid reproduction, and they give yen, not US, prices. Revisit only if the sweep
  leaves many gaps.
- eBay sold prices (Marketplace Insights is limited release) and PriceCharting (licence needed for
  in-app use).
- Price history, graded prices, currency choice.
- Per-language eBay prices for European printings beyond what the existing on-demand path already
  gives owned cards.

## Anti-goals (a failure even if it "works")

- **A wrong-rarity price is worse than none.** A Common showing a Secret Rare's price, or the other
  way round, breaks trust. When the sweep can't tell rarities apart for a code, it records no price
  for the ambiguous rarities.
- **Another freeze.** Any new per-row lookup in the desktop's synchronous SQLite (better-sqlite3 on
  the main process) must use indexes (see `tests/main/prices.test.ts`, which checks the query plan).
  No full scans of `card_printings × collection_entries`.
- **Starving the on-demand path.** The sweep must leave eBay quota for owned-card refreshes and
  requests, and stop for the day when it hits its budget or eBay returns 429.
- **Blowing the Cloudflare budget.** Sweep writes and client deltas must stay well inside the
  portal's daily row-write and row-read limits. Spread the sweep over the week; don't upsert rows
  whose price didn't change.

## Design

### 1. English fallback for European printings (ship first)

- **Matching.** A European printing matches an English printing that has:
  - the same `card_id`,
  - the same `set_rarity`, and
  - the same set code with the region letters swapped:
    - DE/FR/IT/SP/PT ↔ EN
    - old single-letter G/F/I/S/P ↔ E
- **Coverage.** About 96% of `-DE` printings match locally. Unmatched printings fall back to no
  price, as today.
- **What's shown.** The fallback price is the English printing's `market_price`, used only when the
  European printing has no `ip.price`. It is flagged approximate, reusing the existing approximate
  marker that YGOPRODeck prices use.
- **One rule everywhere.** The binder, checklist, scan, stats and collection value all use the same
  rule. Collection value includes estimates, like today's approximate English prices.
- **The mapping is computed when the catalog changes, not on every read.** A stored English-match
  id or a small mapping table, indexed, keeps every read a point lookup. The builder picks the
  mechanism, but it must be the same on desktop (`schema.ts` MIGRATIONS) and portal
  (`SERVER_STEPS`). If it lives on `collection_entries`, mind the `server: false` rule.
- **Asian printings never use this fallback.** Their prices differ too much.

### 2. Weekly set sweep (Asian printings)

- **eBay Worker endpoint.** The `ygo-ebay-prices` Worker gains a set endpoint, e.g.
  `GET /v1/set?prefix=CORI-JP&lang=ja`.
  - **Search.** It searches eBay US in category 31395 for the prefix (plus the language word where
    the code has no region letters, as `buildQuery` does). It pages through results, up to 200 a
    page and a small page cap.
  - **Parse each title** for:
    - the full code (e.g. `CORI-JP025`)
    - a rarity: long names and the common Japanese abbreviations (N, R, SR, UR, SE, PSE, UL, HR,
      GR, CR, QCSE, 20th SE and so on)
  - **Filters.** It applies the existing `isSingleCard` and USD filters.
  - **Response.** For each code + rarity it returns `askingPrice` (median after trimming outliers),
    plus listings it could match to a code but not a rarity.
- **Portal assigns prices.** The portal maps the results onto the set's printings:
  - A code with **one printing** takes the price of all its matched listings, including listings
    with no rarity.
  - A code with **several rarities** gives each rarity only the listings that name it. Listings
    with no rarity go to no printing (see anti-goal 1).
  - **Freshness is tracked per prefix, not per row** (my call). A `price_sweeps(prefix, language,
    swept_at, calls)` table records when each prefix was last swept. Per printing, the sweep writes
    an `intl_prices` row only when it found a price and that price differs from the stored one,
    or there was no row. That keeps weekly writes and client deltas proportional to real price
    changes.
  - **A sweep never erases a price** (my call). Finding nothing, or only ambiguous listings, leaves
    any existing row untouched. `intl_prices` gains a `source` column ('card' | 'sweep'). A 'card'
    row newer than the sweep is kept even if the sweep found a different price.
  - **Per-card lookups still cover what the sweep can't** (my call). `priceCandidates` keeps
    treating an owned or requested printing with no fresh price row as a candidate, whether or not
    its prefix was swept. So owned multi-rarity cards the sweep couldn't separate still get the
    rarity-specific `/v1/price` lookup. Unowned, unrequested printings in a swept prefix aren't
    candidates at all, as today.
- **Schedule.**
  - Driven by the portal Durable Object alarm, or a cron trigger that pokes it (builder's choice).
  - It works through a queue of set prefixes under a daily budget of eBay calls. The real quota
    for this key and today's on-demand usage aren't known yet, so the budget adapts (my call):
    - **Before sweeping**, the eBay Worker reads the remaining Browse calls from eBay's Developer
      Analytics `getRateLimits`.
    - **It sweeps** only while more than a reserve (about 2,000 calls) is left for the on-demand
      paths.
    - **It caps itself** at about 2,000 sweep calls a day.
    - **It stops for the day** on a 429.
  - The admin dashboard's "Scanner and prices" panel shows sweep calls today and prefixes swept
    in the last 7 days, so the quota can be watched.
  - **Priority.** Prefixes that contain a printing someone owns come first, then the newest sets by
    release date, then the rest. Each prefix is swept again about 7 days after its last sweep.
- **The existing per-card path remains.** It uses `refreshIntlPrices`, owned and requested
  printings, and `/v1/price`. With the sweep's rows fresh, it will mostly skip Asian printings. A
  per-card result is newer, and it wins until the next sweep.

### 3. Getting prices to every client

- **Clients hold all server prices.** They don't ask per printing.
- **Delta feed.** `intl_prices` gets a delta feed: a change sequence or `checked_at` cursor, so a
  client pulls only rows that changed since its last pull. The first pull is roughly 100k–150k
  small rows. Make it a bulk, paged download that doesn't block the desktop main thread for long:
  batch the inserts in transactions, as catalog sync does.
- **Possible home.** The server catalog delta (`docs/superpowers/specs/2026-10-26-server-catalog-design.md`)
  already carries TCGplayer prices and allows "split prices into their own feed". It is the natural
  home and already needs a desktop token, so no new public endpoint is needed.
- **On-demand requests stay, for misses.** `POST /api/sync/prices` and price requests stay as they
  are.

### 4. Stream view

- **`scan.ts` uses the shared rule from part 1**, so estimates show in the scan window too.
- **The scan window refetches.** It subscribes to data-changed events, or polls cheaply while open,
  and refetches its set printings and the price of a card currently on screen. It drops the
  `staleTime: Infinity` assumption for prices.
- **A repeat scan shows the price.** Re-scanning a card whose price arrived after the first scan
  shows it.

## Order and the spike

1. **Spike (throwaway, before part 2 is built properly).** Run the set search and title parsing
   by hand against 3–4 Japanese sets:
   - one recent booster (e.g. CORI)
   - one older booster
   - one set with many multi-rarity codes (e.g. a Rarity Collection)
   - one Korean set

   Compare with today's per-card `/v1/price` results and with eBay by eye. Report:
   - coverage: share of printings priced
   - rarity mix-ups
   - calls per set

   **If wrong-rarity prices show up more than rarely, fall back** to the narrower plan: per-card
   lookups for owned printings only, with the sweep limited to single-rarity codes. Bring the
   result to the owner before continuing.
2. Part 1 (English fallback) and part 4 (stream view). Independent of the spike; they can ship
   first.
3. Part 2 (sweep), then part 3 (delta feed to clients).

## Constraints

- **Deploys.** Portal deploys are one-way (`npm run deploy` in `workers/portal`). Server migrations
  are `SERVER_STEPS` `server-N`. Desktop migrations are `MIGRATIONS`, which needs a `user_version`
  pin update in `tests/main/database.test.ts` and the tombstones pins.
- **Durable Object SQLite** rejects long compound UNIONs. Use one query per table.
- **No heavy synthetic test data** (100k+ rows) in vitest or Miniflare. Benchmark in a capped
  standalone script.
- **Tests and checks:** `npm test` (vitest `--maxWorkers=2`), `npm run typecheck`, and the worker's
  own `npm test`. Lint only changed files.

## Left to the builder

- Storage of the English-match mapping (column vs table) and the delta-feed mechanism.
- The rarity abbreviation table and title parser details, informed by the spike.
- Cron trigger vs alarm-only scheduling. Exact daily budget and page caps, within the quota rules
  above.
- How the "≈" marker looks in each client, reusing the existing approximate style.

## Open

Nothing; the builder check's questions were settled as marked "my call" above.
