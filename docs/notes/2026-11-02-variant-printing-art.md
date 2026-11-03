# Variant printing art (2026-11-02)

Owner reports: overframe art missing (LOCH-KR, RV01-JP, MAMS-EN), and BLGG chibi Starlights showing the non-chibi art.
Branch `fix/variant-printing-art`.

## What was measured, and what it showed

The reported sets are matched correctly. I ran `scripts/catalog/variant-art-coverage.mjs` against the owner's catalog (read-only) and live Yugipedia card galleries. The sample was every variant printing in LOCH/LOCR/RV01/BLGG/MAMO plus 150 other cards with variant printings (2,518 printings). In every language, before this change, all 633 LOCH/LOCR/RV01/BLGG overframe, chibi and new-art printings got the right scan, with none wrong and none missing.

These are real file names:
- `…-LOCH-KR-UR-UE-EA.png` for the overframe Ultra Rare.
- `…-LOCH-KR-PScR-UE.png` and `…-GMR-UE.png`, unsuffixed, for the all-overframe rarities.
- `…-RV01-JP-ScR.png`.
- `…-BLGG-DE-StR-1E.png` for the chibi printings. The whole code is chibi, with no suffix.

I also checked the server's R2 photos. LOCR-JP001 and RV01-JP008/013 overframes, LOCH-KR003 UR (Overframe) and BLGG-EN001/003 Starlight all show the right art.

Two things in the brief point the wrong way:
- **`printing_art` in the local `collection.db` is stale.** Packaged desktop builds ask the portal (`/img/printing/<remote_id>`). The local table is only filled in the fake-data dev profile, and its rows date from 2026-10-25/26. Counts from it (LOCH-KR 2/51) don't show what the app displays.
- **The phone shows no printing scans at all.** `printingImageSrc` returns null on the phone because its printing ids aren't the server's. So on the Android and iOS app every overframe and chibi printing shows YGOPRODeck's default art. The scanner's pull overlay and summary also show only the matched card art.

  This is the likeliest place the owner saw "missing overframes" and "non-chibi BLGG". YGOPRODeck has no chibi art, and BLGG-EN rows carry no variant, so a chibi scan resolves to the card's usual art.

  **Not fixed here.** The fix needs a printing route keyed by pkey, or server ids in the phone catalog. That is Worker work.

## Causes found and fixed

1. **Wrong art (the worst case).** Two problems led to it:
   - The file-name matcher knew only the overframe suffix (`EA`). Alternate-art printings (`-AA` on Yugipedia) fell back to the plain card's scan, and `artResolver` stored whatever `choosePrintingFile` returned.
   - Any art variant with no scan of its own did the same: Japanese and International artwork, numbered artworks, and token variants.

   The sample found 564 printings with the wrong art (22%). Examples: `RA01-IT043 Ultra Rare (Alternate Art)` showed `KnightmareUnicorn-RA01-IT-UR-1E.png` instead of `…-UR-1E-AA.png`.
2. **Abbreviated rarities.** 3,293 printings store their rarity as `PlScR` (RA03/RA04 lists). `rarityAbbr` didn't know the abbreviation, so these took any rarity's scan. For example, `RA04-DE024 PlScR (Alternate artwork)` showed the Collector's Rare scan.
3. **English variants and TCGplayer.** The lone-product fallback gave an English art variant with no product of its own the plain card's photo.
4. **MAMS-EN overframe rows missing entirely.** The TCG-EN fill (`englishFill`) skips every list row whose code YGOPRODeck holds, and leaves variants to TCGplayer. MAMS releases on 2026-11-12 and TCGplayer has no products for it yet. So the "(extended art)" rows on Yugipedia's MAMS list never became "Ultra Rare (Overframe)" printings.

## The fix

| Commit | Change |
|---|---|
| `f7b2379` | `choosePrintingScan` / `needsOwnScan`: an art variant takes only a scan named for its art. When its code has no plain printing of that rarity, it takes its rarity's only scan (LOCH PScR/GMR, RV01 ScR, BLGG chibi). Otherwise it gets none. `EA`/`AA` suffixes; `PlScR` read as itself. Foil-only variants (Special Red Version, Emblazoned, colours, editions) still take the plain scan. `artResolver` uses it. **SCHEMA_V38** (desktop and server) deletes stored art for variant and abbreviated-rarity printings, plus stored misses. Their photos move to new keys (`printing/<id>-v38` in R2, `srv-<id>-v38` on desktop), so wrong photos already cached are never served again. Scan references choose their files again once (`ref_choice_version`). |
| `4ff2665` | `englishFill` adds an overframe or alternate-art row the list prints beside a plain rarity YGOPRODeck holds, for the same card and code, when no art variant of that rarity exists yet. Example: `MAMS-EN001 Ultra Rare (Overframe)`. TCGplayer takes it over under the same name once it sells it (tested). The change is separate from the name-matching code. |
| `9be58cf` | RA05 "Stamp artwork" uses Yugipedia's `-AA` files; RA05 is the only set with stamped printings, and none sits beside another alternate art. The TCGplayer lookup gives an art variant with no own product only a product labelled with its art. |

## Coverage before → after (same 2,518-printing sample, one judge)

| | right | wrong | none |
|---|---|---|---|
| before | 1,919 | **564** | 35 |
| after | 2,159 | **0** | 359 |

- Alternate art went from 268 right / 249 wrong to 498 right / 0 wrong / 19 none.
- The 359 still missing are art variants whose gallery has no scan naming them: Japanese/International artwork, numbered artworks with `-AA2`-style files, token variants, and unscanned new sets. These now show the card art instead of another printing's photo.
- The reported sets are unchanged: right before, right after.

## Risk of wrong art

- "Wrong" here is judged from file names. A scan counts as right if it names the printing's variant, or if it is the only scan of a rarity the code never printed plain.
- Yugipedia misfiling a scan would still slip through, as would a set where `AA` means a different art than the list's "alternate art". I found none in the sample.
- The rule only adds suffix mappings that occurred unambiguously in real galleries. Anything ambiguous now resolves to "no scan".
- Still not covered: the phone (no printing scans at all), and the scanner overlay (card art only).

## What the owner must run

1. **Desktop.** Release a build. SCHEMA_V38 runs at launch. Variant photos re-key to `srv-<id>-v38` and are fetched again from the portal on view. Old files stay on disk, unused.
2. **Worker: deploy needed.** It carries the new matcher, SCHEMA_V38 (it runs `MIGRATIONS` too) and the `-v38` R2 keys. After deploy, about 10.9k variant printings are looked up again lazily, as they are viewed, in batches of 50 per gallery request. Old R2 objects stay orphaned. Signed-out (anonymous) requests for re-keyed photos 404 until a signed-in user has viewed them once.
3. **Catalog workflow.** Run `catalog.yml` with **`refresh_sets: true`**. That re-reads the TCG-EN lists now rather than on the weekly timer, so the MAMS overframe rows are added and uploaded. Phones and desktops get the rows through the catalog feed.
4. **Scan fingerprints.** No `HASH_VERSION` bump: hashing is unchanged. The next catalog run re-chooses reference scans once (`ref_choice_version` "2"). That costs one gallery pass over the en/ja reference printings and downloads only new files, up to 600 per run. Alternate-art and stamp printings in en/ja gain their own refs.

## Parked

- ~~The phone needs printing photos.~~ Fixed in `fix/phone-printing-photos`. The phone's catalog already holds each printing's server id (`remote_id`), so no new route was needed. The phone looks the ids up in batches and asks `/img/printing/<server id>`, which now serves known printings to signed-out requests, metered per address like card art. The scanner's pull overlay, summary and phone last-scan card show the printing's photo when the printing is sure.
- BLGG-EN chibi rows carry no variant. The scanner can't name them, and its overlay shows the usual art.
- `normalizeRarity` doesn't spell out `PlScR` (3,293 rows). It is a pkey change, so it was left alone.
- MAMO-EN013's gallery isn't found (name mismatch). That belongs to the parallel `fix/yugipedia-name-mismatch` work.
- SCHEMA_V38 may collide with another branch's V38. Renumber on merge.
