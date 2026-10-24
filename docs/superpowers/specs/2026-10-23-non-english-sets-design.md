# Non-English Sets — Design

Date: 2026-10-23
Builds on: `2026-10-23-sets-page-design.md` (merged locally at c252613) and
`2026-10-23-yugioh-collection-tracker-design.md` (v0.1.0)

## Intent

The owner and a couple of friends own Yu-Gi-Oh! cards printed in languages
other than English, mainly Japanese and Korean, but European and Asian
printings as well. Today the app only knows English TCG printings, because
that is all YGOPRODeck lists, so those copies can't be recorded accurately.

A non-English copy is **a different copy of the same card, from a different
set** (owner's words). A Japanese Dark Magician is still Dark Magician (same
card data and art in the app), but it is printing `LB-05` of the Japanese
*Legend of Blue Eyes White Dragon*, a set with its own 61-card checklist,
separate from the English 126-card LOB. A German LOB copy (`LOB-G003`) is
likewise a printing of the German LOB, a set of its own.

This reverses the earlier non-goal "language tracking out of scope app-wide".

## Goals

- **All languages Yugipedia covers** (owner: "include all languages, not just
  japanese/korean"), with Japanese and Korean the priority if anything has to
  be ordered.
- Non-English sets appear on the **Sets page** as sets in their own right,
  each with a checklist and completion progress, labelled with their language.
- **Language filter, default English** (owner), on the Sets page. The same
  filter, also defaulting to English, applies on the Add Card printing step
  and the Collection page (agreed in playback).
- Non-English copies can be added, edited and removed like any other entry,
  with their own quantity and rarity.
- Prices for non-English copies come from **eBay current listings**, through
  a **Cloudflare Worker** that holds the eBay key.
- Works offline once downloaded, like the rest of the app.

## Non-goals

- Localized card names or card text. Cards stay in English. (Agreed in
  playback; YGOResources has localized names if this is ever wanted.)
- Localized card art or scans. The art is YGOPRODeck's.
- eBay sold prices. They are gated to approved eBay partners and not
  available to us.
- Separate English regional variants. Yugipedia's `TCG-EN`, `TCG-NA`,
  `TCG-EU`, `TCG-AU` and `TCG-FC` lists are not imported; English stays
  wholly on YGOPRODeck as today.
- Edition (1st/Unlimited) and condition tracking. Still out of scope.

## Anti-goals

- **Leaking the eBay key.** The repo is public and builds can be unpacked. The
  app must never contain the eBay app ID or cert ID.
- **Borrowing English prices for non-English copies.** The existing
  `priceFor` fallback to the card's TCGplayer price (marked "approximate")
  must not apply to non-English printings. If eBay has no price, the copy has
  no price.
- **Merging languages.** A Japanese LOB copy must never fill a slot in the
  English LOB, or the reverse. Sets that share a name across languages must
  stay distinct.
- **Hammering Yugipedia or eBay.** Downloads are batched, spaced, cached and
  refreshed rarely.
- **Breaking existing data.** Existing English printings, sets and collection
  entries keep working unchanged after the migration.

## Data sources (researched 2026-10-23)

### Yugipedia: set lists (chosen)

MediaWiki API at `https://yugipedia.com/api.php`. Send a descriptive
User-Agent that identifies the app.

- **Set card lists** are pages in namespace 3006 titled
  `Set Card Lists:<Set name> (<REGION>)`. Counts on 2026-10-23 (7,664 pages
  in total):

  | Suffix | Language label in app | Lists |
  |---|---|---|
  | `OCG-JP` | Japanese | 1,868 |
  | `OCG-KR` | Korean | 763 |
  | `TCG-DE` | German | 751 |
  | `TCG-FR` | French | 747 |
  | `TCG-IT` | Italian | 744 |
  | `TCG-SP` | Spanish | 704 |
  | `TCG-PT` | Portuguese | 469 |
  | `OCG-SC` | Simplified Chinese | 190 |
  | `OCG-AE` | Asian-English | 146 |
  | `OCG-TC` | Traditional Chinese | 18 |
  | `OCG-JA` | Japanese-Asian | 11 |

  Enumerate with `list=allpages&apnamespace=3006` (500 titles per request,
  about 16 requests). Fetch content with `prop=revisions&rvprop=content&rvslots=main`,
  up to 50 titles per request.

- **List format** (wikitext). One or more `{{Set list|region=XX|...}}`
  templates, one row per line: `CODE; English card name; Rarity[, Rarity…]`.
  Observed variations:
  - The rarity column may be missing. The template's `rarities=` parameter is
    then the default (e.g. `{{Set list|region=KR|rarities=Common|`).
  - Several comma-separated rarities on one row mean one printing per rarity.
    This matches the existing `UNIQUE(card_id, set_code, set_rarity)`.
  - Older European codes use letters rather than language codes
    (`LOB-G001` German).
  - Rows exist for tokens and other non-cards (`QCCP-JP000; Token (side:Pride)`).
    They won't match a card and are skipped.
  - **The earliest Japanese sets have no set codes.** `Set Card Lists:Vol.1 (OCG-JP)`
    uses `{{Set list|options=noabbr|region=JP|rarities=Common|` and rows like
    `Dark Magician; Ultra Rare` or just `Hitotsu-Me Giant`.
    - Such printings have an empty set code.
    - The printing key must include the set, or the same card and rarity in
      two codeless sets would collide. The current key is
      `UNIQUE(card_id, set_code, set_rarity)`.
    - eBay searches for them use set name + card name + language.
  - Regional sets really do differ. The German LOB list has 103 cards, the
    English LOB 126 and the Japanese LOB 61.

- **Match rate (measured 2026-10-23, exact case-insensitive English name
  against the 14,636 YGOPRODeck cards):**
  - 100% for LOB (JP, DE), Phantom Nightmare (JP, KR) and Terminal World
    (JP, a Japanese-only 2021 set)
  - Quarter Century Chronicle side:Pride (JP): 203 of 204; the miss was a
    token
  - YGOPRODeck includes OCG-only cards, so unmatched rows should be rare. The
    "couldn't be identified" handling is a safety net, not the expected case.

  Samples: `Set Card Lists:Legend of Blue Eyes White Dragon (OCG-JP)`,
  `… (TCG-DE)`, `Set Card Lists:Phantom Nightmare (OCG-KR)`.

- **Set pages** (main namespace, title = the set's English name, or with a
  `(Japanese)`-style suffix when the regional set differs, as for the Japanese
  LOB). `{{Infobox set}}` carries:
  - `image` (a file name; resolve it with `prop=imageinfo&iiprop=url`, e.g.
    `https://ms.yugipedia.com/0/0b/LB-BoosterJP.jpg`)
  - localized names (`ja_name`, `ko_name`, `de_name`, …)
  - per-region release dates (`jp_release_date`, `kr_release_date`,
    `fr/de/it/sp_release_date`, …)

  How to find the set page for each list is left to the builder. The set list
  page's `{{Set page header|set=…}}` names it when it differs, and otherwise
  the list title minus the suffix is the set page.

- Yugipedia returned "technical difficulties" for a few minutes during
  research. Outages happen and must be handled.

### YGOPRODeck: unchanged

YGOPRODeck still supplies cards, English printings, English sets, images and
English prices. Its card data also has `misc_info[].konami_id` (with
`misc=yes`), should the builder need it for matching.

### Not chosen

- **YGOResources** (`db.ygoresources.com`). Per-language print codes per card
  by Konami ID, but no set names or rarities, and its API guidelines ask
  clients not to bulk-download (they offer a file on request).
- **Konami's official database.** HTML only and would mean scraping.

## Behaviour

### Language

- Every printing and every set has a language. Existing YGOPRODeck rows are
  English.
- A set's identity is (name, language). The Japanese and English *Legend of
  Blue Eyes White Dragon* are two sets. The current `sets` table is keyed by
  `set_name` alone, and printings refer to sets by `set_name`. Both change.
- **Language filter** (Sets page, Add Card printing step, Collection page):
  - defaults to English
  - offers "All" and each language that has data
  - is remembered across launches, like the existing view toggles

  *Builder's call:* one shared setting or one per page.
- Wherever a set or printing is shown with a non-English language, it gets a
  short language tag (JP, KR, DE, FR, IT, ES, PT, SC, TC, AE, JA, or similar).
- **Sets show their English name plus the language tag** (owner), e.g.
  "Legend of Blue Eyes White Dragon · JP", never the localized name.
  Localized set names aren't stored. Sets page search matches English names.
- *Builder's call:* Asian-English is its own language in the filter, not
  English.

### Downloading set lists

- After the normal YGOPRODeck sync, in the background, at most **once a week**
  (and on first launch after this update): enumerate the lists, fetch them in
  batches of 50, then fetch the set pages they point to (release date, image).
- Requests are polite: one at a time, a short pause between them, and backoff
  on errors or 429. The first full download is a few hundred requests and
  should take a few minutes. It doesn't block using the app.
- Each row is matched to a YGOPRODeck card **by English name**.
  - The builder chooses the normalization (case, punctuation,
    `The`/quote/hyphen variants).
  - Unmatched rows are skipped and counted in a log.
- **Failure keeps old data**, like `refreshSets`. If Yugipedia is down or a
  page won't parse, the existing data for those sets is kept and the next
  launch tries again.
- Non-English printings must survive the YGOPRODeck sync. Today
  `missing_from_api` is set on printings that YGOPRODeck no longer returns,
  and non-English printings must not be flagged that way.
- *Builder's call:* whether a set whose list fails to parse is skipped or
  kept from its last good copy.

### Sets page and checklist

- Non-English sets behave exactly like English ones:
  - artwork, completion progress, count mode (each card once / every
    rarity), checklist, add-missing and bulk mode
  - slots come from the set's own rows
- Release date is the set's date in that language's region.
- Artwork is the Yugipedia set image, cached through the existing set-image
  cache and protocol.
- If some rows of a set couldn't be matched to a card, the set header says so
  (e.g. "60 of 61 cards listed; 1 couldn't be identified"). The total counts
  only identifiable cards.

### Adding and showing copies

- **Add Card, printing step:** printings of every language are listed, each
  with its language tag. The language filter starts on English. Art and
  quantity steps are unchanged.
- **Collection page:** entries show the language tag, and the filter bar gains
  the language filter.
- Entry detail shows the language and, for non-English copies, the eBay price
  details below.

### Prices for non-English copies

- **Source:** eBay Browse API (current listings, marketplace `EBAY_US`), via a
  **Cloudflare Worker** the owner deploys. The Worker holds the eBay app ID
  and cert ID as secrets, gets the OAuth token (client-credentials grant), and
  queries eBay.
  - The app only talks to the Worker. The Worker's URL is in the app.
  - *Builder's call (Worker URL and deploy order):*
    - The URL is a single constant, overridable by an env var in dev.
    - Until it's set, or when the Worker is unreachable, non-English copies
      show "no price" with a "prices unavailable" reason, and nothing else
      breaks.
    - Price code is tested against a mocked Worker.
    - The plan ends with an owner-approved step to deploy the Worker, set its
      secrets, fill in the real URL, and run one end-to-end price check.
    - Set lists don't depend on the Worker, so they can ship first if the
      deploy waits.
  - Reference implementation of the eBay token/search calls, including
    gotchas (`/v1/` in the OAuth URL, retry policy, never logging
    credentials): `~/Documents/GitHub/pokemon-card-stream-pricer/trainer/hitcheck_trainer/corpus/ebay.py`.
  - That project's account-deletion Worker is
    `workers/ebay-account-deletion/`. The existing eBay keyset is unblocked,
    and its credentials are in the environment as `PROD_APP_ID` and
    `PROD_EBAY_CERT_ID`.
- **What's priced:** only non-English printings the user owns. English
  printings keep YGOPRODeck prices.
- **When:**
  - when a non-English copy is added
  - then refreshed in the background at most once a week per printing
  - prices are stored locally, so the app works offline between refreshes
- **Search:**
  - by the printing's set code (e.g. `LOB-DE001`, `PHNI-KR001`), plus the
    language name where the code alone is ambiguous (e.g. `LB-05` → add
    "Japanese")
  - plus the rarity
- **Price:** the median of matching listings after dropping clear outliers.
  *Builder's call:* the outlier rule, title filtering, and the minimum
  listing count.
- **Label:** "eBay asking price", with the date checked. It is never shown as
  if it were a market or sold price.
- **No listings:** no price. The copy counts $0 toward value and shows a small
  "no price" marker.
- **Dashboard:** the total includes eBay asking prices.
- **Worker:**
  - caches responses (e.g. KV with a TTL of about a week), so the owner and
    friends share one eBay quota (5,000 Browse calls a day by default)
  - accepts only the narrow request the app makes (a search for one printing)
  - doesn't proxy arbitrary eBay calls
  - The Worker URL is public. The accepted risk (owner: only a couple of
    friends use the app) is that strangers could burn quota but never see
    the key.

## Constraints

- Stack as today: Electron + electron-vite, React 19 + TS, TanStack Query,
  better-sqlite3, Vitest (`--maxWorkers=2`).
- **Schema changes are a new migration** (v3) appended to `MIGRATIONS` in
  `src/main/db/database.ts`. Never edit shipped steps. Existing rows migrate
  to English.
- The eBay credentials never appear in the repo, the app bundle, logs or error
  messages.
- `npm run dev:fake-data` (`src/main/dev/fakeData.ts`) should keep working.
  *Builder's call:* whether it also seeds a few non-English copies.
- Cloudflare: the Worker lives in this repo (e.g. `workers/ebay-prices/`).
  Deploying it and setting its secrets are owner actions, so ask first.
- The repo is public. Nothing is pushed or deployed without asking.

## Left to the builder

- A non-English printing that disappears from Yugipedia while owned: mirror
  the existing `missing_from_api` behaviour.
- Mapping Yugipedia rarity names onto the existing rarity names.
- Non-English printings show no price until their first eBay lookup, which
  happens once they're owned.

- Schema shape: language columns, set key, where eBay prices live.
- Name-matching normalization and how unmatched rows are recorded.
- How list pages map to set pages; whether set images use the regional box
  art (e.g. `…-BoosterJP`) when the infobox only names the English one.
- Exact language codes and tag text.
- Refresh scheduling details within the "at most weekly" rule.
- eBay query construction, outlier rule, minimum listings.
- Worker request format and cache keys.
- Whether the language filter setting is shared or per page.
