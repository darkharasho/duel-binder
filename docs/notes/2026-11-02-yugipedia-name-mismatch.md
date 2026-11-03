# Yugipedia name mismatch (LOCH-KR013 didn't scan), 2026-11-02

## Why the scan failed

The scanner (`src/renderer/src/features/scan/resolve.ts`, shared by desktop, phone and Stream) tries the
set code first, then the art, then the name. The catalog had no LOCH-JP013 or LOCH-KR013 printing, so:

- **Code:** `printingsByCode("LOCH-KR013")` finds nothing, so the scanner moves on to the art.
- **Set picked (Limit Over Collection: The Heroes, KR):** art matching only compares the set's own
  artworks (`useScanLoop` candidates), and Odd-Eyes isn't in the set. `inSet` has no printing, and the
  Korean name OCR can't match an English card name. The result is `unsure` on every frame, so the card
  never scans.
- **No set picked:** the art can match. `anyPrinting` then only has MAMO-EN013 (English) to offer and
  flags it `pick-printing`. A Korean filter falls back to English because the card has no ko printing.
  The scan gives the wrong printing, and there's no Korean one to pick.

The missing printing explains the failure by itself. Nothing else in the scan path needs a ko
printing: language reading only runs when a card has printings in several languages. The fingerprint
side is fine: card 75787708's art is already in the fingerprint file. LOCH-JP013 also has
extended-art rows (UR/PScR/GMR). Those are art variants, so the nightly `buildReferences` will add
Yugipedia scans for them once the printings exist. That needs no code change.

## How big the problem is (sample: 44 partly-unmatched set lists, 6,554 rows, 703 unmatched)

The sample was the top 12 sets by unmatched rows plus 32 picked by a fixed hash. It cost 9 Yugipedia
requests, using the app's client (same User-Agent, 500 ms gap).

| Class | Rows | Names |
|---|---|---|
| Tip / strategy cards (Dark Beginning/Revelation, Duelist Pack tips, "Monster Token combo") | 578 | 178 |
| Rush Duel cards in OCG lists (all `RD/…` codes, e.g. Saikyō Jump promos) | 69 | 69 |
| **Name spelled differently, real card in catalog** | **55** | **39** |
| No password, other ("Wedge Counter (card)") | 1 | 1 |

Some of the spelling differences:

- Different words: "Cliff the Trap Remover" / "Dark Scorpion - Cliff the Trap Remover", "Hidden Book of
  Spell" / "Hidden Spellbook", "Jinzo #7.7" / "Jinzo".
- Accents and symbols: "Machine Lord Ür", "Falchionβ".
- 10 names were only off by an invisible U+200E (left-to-right mark).
- 2 names had wiki `{{=}}` markup in them ("Damage {{=}} Reptile").

## The fix (`src/main/sync/cardPasswords.ts`, `intl.ts`, `parse.ts`)

- A row that doesn't match by name looks up its Yugipedia card page (redirects followed, 50 titles per
  request). It reads `password` from the page's `{{CardTable2}}` (`parseCardPassword`) and matches on
  card id, or on an alternate-artwork id from `card_images`.
- Each name's result is cached in meta `yugipedia_card_passwords`. A found password is kept for good:
  if YGOPRODeck doesn't have the card yet, the row matches as soon as it does, with no refetch. A miss
  is asked again after 30 days. Names from a failed request aren't cached.
- A name match never fetches a page. Rush Duel rows (`RD/` code) are never looked up.
- Cheap exact fixes: `normalizeName` drops invisible marks (U+200B–200F, U+2060, U+FEFF), and
  `parseSetList` reads `{{=}}` as `=`.
- The nightly catalog job runs this same `refreshIntlSets` code through `refreshCatalog`, so there's
  no second path to change. The Worker isn't touched.

I couldn't find a cheaper exact signal. The page title doesn't redirect to YGOPRODeck's name (the
Odd-Eyes page *is* titled "…, Four Heavenly Dragons"), so only the password links the two names.

**Recovered in the sample: 55 of 703 unmatched rows**, using 6 requests (2 set-list fetches + 4
card-page fetches for 206 titles; 216 Rush rows skipped). The other 648 rows are tip cards and Rush
cards, which correctly stay unmatched. Tests: 10 new ones in `intl-sync.test.ts` and
`yugipedia-parse.test.ts`. They cover the Odd-Eyes row resolving to 75787708, cache hits, a password
YGOPRODeck lacks, misses and their retry, a failed fetch, a name match never fetching, Rush rows, and
50-title chunks.

**First-run cost:** every unmatched non-Rush name is fetched once. For the whole catalog that's a few
thousand names (an estimate), about 40–60 extra requests spread across the batches. After that, about
1/30 of the misses come due each month.

## What the owner needs to do

1. Merge `fix/yugipedia-name-mismatch`.
2. Run the **Catalog** workflow by hand with `refresh_sets` ticked. Otherwise the change waits for the
   weekly intl timer. The `ygo` stage adds the printings (LOCH-JP013/KR013 and the rest), `upload`
   sends them to the portal, and `fingerprints-ygo` adds reference scans for the new art-variant
   printings in the same run. Phones and server-catalog desktops get the printings through the catalog
   feed.
3. **No Worker deploy.** A desktop release is only needed for desktops still running their own sync
   (not switched to the server catalog).
4. Check the run log: the `Yugipedia: N unmatched rows` total should drop, and LOCH-KR013 should be
   in the KR set.
