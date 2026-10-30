# Pokémon scanner: holders and detection (pass 3b)

Follows `2026-10-29-pokemon-scanner-design.md` and the pass 1–3a log in
`.superpowers/sdd/2026-10-29-pokemon-scanner/task-13-report.md`. Design only; no product code here.

The bar is unchanged: **0 named wrong, at least 85% right**, on the combined set and on the owner's
photos alone. At e6c8e0f (r5) owner is 92/172 right (53.5%; 147 needed), combined 292/669 (43.6%;
569 needed), 0 wrong.

## 1. Where the misses are (measured)

Source: the r5 gate rows (`SCAN_PKM_OUT`, e6c8e0f), plus a throwaway diagnostic run on every
scorable miss (377 photos). For each one it ran the app's own `searchCandidates`/`recognizeArt`
and measured how far the truth card's own artwork is from each candidate quad (`rankArt` limited
to the truth's image ids, at CARD_W with the usual jitter and window search), including the
"card around an inner frame" quads. Nothing was committed and no photo was copied.

Classes, in pipeline order:

- **A, no card-shaped candidate:** `recognizeArt` returns null.
- **B, no fingerprint:** the truth card has no artwork in `fingerprints-pkm.bin` (no image URL, or a
  403 tcgplayer image). Detection can't help.
- **C, a candidate reaches the art, another is picked:** some candidate puts the truth art at ≤80
  bits (ART_MAX_DISTANCE), but the pipeline's quad doesn't bring it into the top 20.
- **D, no candidate reaches the art:** every candidate is 82+ bits from the truth art (most are 95–110,
  close to chance). The quads are the holder's rim, the slab, the deck under the card, or the art
  window taken for the wrong frame.
- **E, reprint group:** the art matched, but cards with the same name and illustrator in other sets
  (or an unseen twin) share it. Only the collector number can tell them apart.
- **F, language untold:** the art matched, but neither the text box nor the name band told the
  language (blurred webcam text, glare on plastic, kanji noise).
- **G, number misread vs art:** the number read names a card outside the art group, and Task 6's rule
  makes that unsure.

The owner's E/F/G split is the hand check from pass 3a. The eBay split is heuristic: E means another
card of the same name and language within 24 bits of the truth in the art list, or the unseen-twin
flag. So eBay E and F may each be off by a few.

| cause | owner | (bare / toploader / case / slab) | eBay | (bare / toploader / case / slab) |
|---|---|---|---|---|
| A no candidate | 11 | 11 / 0 / 0 / 0 | 4 | 3 / 0 / 0 / 1 |
| B no fingerprint | 0 | | 80 | 56 / 4 / 0 / 20 |
| C reached, other picked | 9 | 1 / 5 / 2 / 1 | 6 | 2 / 1 / 0 / 3 |
| D no candidate reaches art | 31 | 6 / 14 / 3 / 8 | 63 | 23 / 10 / 1 / 29 |
| E reprint group (number) | 12 | | 93 | 66 / 3 / 0 / 24 |
| F language untold | 12 | | 50 | 25 / 3 / 1 / 21 |
| G number misread vs art | 5 | 5 bare | 1 | |
| **misses** | **80** | | **297** | |

Detection (A+C+D) accounts for **51 of 80 owner misses** (bare 18, toploader 19, case 5, slab 9) and
**73 of 297 eBay misses**.

**Checked by eye.** I looked at 12 owner and 9 eBay photos and confirmed the classes.

- Owner holder shots: the card is fully visible and sharp-edged inside the plastic. Its outline loses
  to the holder's rim (a toploader's blue edge, a slab's clear frame, a magnetic case's lip), and
  fingers cover a side.
- Owner bare A shots: the card is held over a deck whose edge runs into the card's.
- Full and special arts (Celebrations/30th-style Charmander and Scorbunny, SIRs, an AR) are common in
  the owner's toploaders.

**Oracle check, 7 owner photos (2 toploader, 2 slab, 1 case, 2 bare).** I placed the card's corners
by hand. Unrefined, 4/7 put the truth art in the top 2. After a small corner search (±12 px), all 7
did, at 18–68 bits. That search scored against the truth art, so it is optimistic. Still, the art
can be found in these shots once the outline is right. In 3 of the 7, a same-art twin sat within
2–6 bits, so those photos then move to class E rather than to right.

**eBay D is less clean.** In 3 checked:

- A CGC slab of Team Rocket's Mewtwo ex is a detection miss: the pipeline took the whole slab. With
  the right corners the truth art is rank 1 at 56 bits, behind a same-art printing at 50, so the
  photo moves to class E.
- A Jungle Kangaskhan is a reference problem: it was detected fine, and another Kangaskhan matched
  at 70, but its own reference image is 110 bits away.
- A Japanese AR Lairon is unclear: the pipeline quad was absurd, and the hand quad still gave 102.

I assume about half of eBay D is fixable by detection.

## 2. How much each lever could recover at most

Owner: 92 right, 147 needed, a gap of 55.

| lever | owner ceiling | likely | combined ceiling | notes |
|---|---|---|---|---|
| Holders and detection (A+C+D) | +51 (→143, 83%) | +25 to +35 | +124 | After the art matches, today's photos convert to right at: owner bare 87%, toploader 60%, slab and case 0/6 (all reprint or untold language), eBay bare 63%, eBay slab 42%. |
| Collector number for reprint groups (E) | +12 | small | +105 | Numbers read right on 2 of 70 eBay reprint photos. Owner numbers are about 12 px on a 1080p webcam. |
| Language from glare and blur (F) | +12 | small | +62 | Mostly glare on holders and one-attack cards. Finding the card's outline doesn't de-glare its text. |
| Number misread rule (G) | +5 | +5 if allowed | +6 | Needs the owner's rule change. |
| Catalog artwork for 80 eBay cards (B) | 0 | 0 | +80 | Classic Collection, trainer kits, JP promos. Without them the combined set tops out near 88%. |

**Honest read.**

- Holders and detection is the **largest single lever for the owner's photos**: 64% of their misses.
  Without it the owner's ceiling is 121/172 (70%). So it is necessary.
- **It is not sufficient.** Even if every detection fix also named the card, owner would reach 143
  (83%). A realistic +30 gives about 122 (71%). The owner bar also needs the number or language
  levers (or rule G).
- On the combined set, **detection is not the big lever**. Reprint groups (105) and missing artwork
  (80) are larger. A realistic detection pass adds about +55 to +65 combined (about 52%).

## 3. Design

### Approaches considered

1. **Nested search inside the holder (recommended).** When the first pass doesn't accept a match,
   treat each candidate that looks like a holder (larger than a card, holding a card-shaped
   interior, or with a slab label) as a region of interest. Run the existing line and quad search
   again inside it, cropped from the full-resolution frame and scaled so the region fills
   SEARCH_WIDTH. The card then spans about 400 px instead of about 110 px, and the rim is no longer
   the strongest quad. Add a few holder-prior quads, snapped to edges: a slab's card sits below the
   label, and a toploader's or case's card sits a fairly even border in. The art match stays the
   only judge.
   - Same idea for bare cards with no candidate (A): zoom regions around the art-window candidates
     and around the frame's busiest card-sized blob.
   - Pros: classical, small, testable, no new assets; reuses `lineQuads`, `holds()`,
     `cardsBeforeHolders`, `isSlab`'s label sampler and `aroundInnerFrame`.
   - Cons: more quads per failing frame (cost, and more chances of a chance match); tuning on few
     owner holder photos (49 toploader, 14 slab, 6 case).
2. **Keypoint matching (ORB/AKAZE) against the top-k reference images.** Robust to partial outlines
   and glare. But the device has only 256-bit hashes, not reference images. Fetching or bundling
   images for 30k cards is out of scope, and it is slow on the phone. Rejected.
3. **A learned card-corner detector:** a small segmentation or corner model in the vision worker,
   trained on catalog art composited into synthetic holders, hands and desks. It is the most robust
   long-term. But it is a new model asset in the app and on iOS, with a training pipeline, and real
   photos can't be used for training without leaking the corpus. Too big for this pass; kept as the
   fallback if approach 1 stalls below +20 owner.

### Recommendation: approach 1, in four parts

1. **Re-rank before giving up (class C).** Today the pick is made at PICK_WIDTH 210. Holder cards are
   small in the frame, so the top three candidates by PICK_WIDTH distance are matched again at
   CARD_W, as `runnerUp` already is for one. Cheap, and aimed at the 15 C photos.
2. **Holder region search (class D, holders).** Runs only when no quad's art is ≤ART_MAX_DISTANCE
   after the first pass and the inner-frame pass:
   - Regions: every candidate that holds a card-shaped interior candidate (`holds()`), every
     candidate with a slab label beside it (the `labelAbove` sampler, run on the outer quad), and the
     preferOuter outline. At most 3 regions.
   - Each region is cropped from the full-resolution frame with a 4% margin, searched with the same
     `searchCandidates` at SEARCH_WIDTH, and its quads are mapped back. Plus holder priors per kind
     (slab: lower 72% of the holder, 6–9% side borders; toploader and case: 4–10% even border). Each
     prior is snapped to the strongest nearby edge line within 3% before matching.
   - Candidates go through the same `closest` → `ranked` path.
3. **Zoom search for bare cards with no outline (class A).** When `searchCandidates` finds no quads, or
   none matches, search crops at 2x around each art-window candidate (`windows`) and around the
   frame centre: the scan window and the phone both centre the card. At most 3 crops per frame.
4. **Holder kind as a signal, not a decision.** The pass records which holder kind it found and passes
   it on as `signals.holder` (for the gate's per-holder lines and later the slab "raw" tag).
   `isSlab` is then sampled above the card found *inside* the slab, which is where its label is.
   Nothing in resolve changes because of it.

### How it plugs in

- New `ScanProfile` field `holderSearch: boolean` (pkm `true`, ygo `false`). In `recognizeArt`:
  rerank (part 1) runs under the same flag. The holder and zoom pass runs after the existing
  `aroundInnerFrame` fallback and before the final `ranked`, only on frames where nothing has
  matched. The code goes in `vision/holderSearch.ts`, which `candidates.ts` calls.
- No change to `resolve.ts`, `resolvePokemon.ts`, thresholds that decide naming, the fingerprint
  file, keys or the wire format. Detection only proposes more quads. Every name is still decided by
  ART_MAX_DISTANCE, PKM_ART_MIN_MARGIN, the unseen-twin rule, language and number rules.
- **Speed:** the scan loop already runs `analyze` per frame on the worker. The extra pass runs only on
  frames whose art didn't match. It is capped at 3 regions or crops × (one search + up to 8 quads at
  PICK_WIDTH + 1 at CARD_W). Target: at most +150 ms per failing frame on desktop (node 276 ms
  detection today). The tracker reuses the found holder region on the next frames, so a held card
  pays it once.

### Yu-Gi-Oh stays unchanged

`holderSearch` is false on the ygo profile, so every new branch is skipped and its quads, picks and
outputs are the same code path as today.

Checks before merge:

- The ygo real test (`SCAN_REAL_DIR=~/scan-capture/shots`) is row-for-row identical to e6c8e0f:
  117/147 top-1, 115 accepted and correct, 0 accepted-wrong.
- `scan-accuracy-gate` passes.
- Full `npm test` passes with `--maxWorkers=2`.

### Nothing new may name a card wrong

- New quads face exactly the same acceptance as old ones. One extra guard: a match found **only** by
  the holder or zoom pass must also clear PKM_ART_MIN_MARGIN against the next *different-name* card.
  More quads mean more chances of a chance hit, and the margin is what protects against it.
- No corner refinement is scored by art distance (that can manufacture a match). Snapping uses edges
  only.
- Measured on the full gate: 0 wrong. Every Chinese and other-language photo must stay
  unsure or none. Each new quad source is logged in `SCAN_PKM_OUT`, so any wrong is traced to it.

### Gate numbers to expect

| set | now (r5) | expected after 3b |
|---|---|---|
| owner | 92/172 (53.5%) | 117–127 (68–74%) |
| owner toploader / slab / case | 18/49, 0/14, 0/6 | 26–32, 2–5, 1–3 |
| owner bare | 74/103 | 82–88 |
| eBay | 200/497 (40.2%) | 220–235 |
| combined | 292/669 (43.6%) | 337–362 (50–54%) |
| wrong | 0 | 0 |

The 85% bar will **not** be met by 3b alone. Pass 3c (collector number on holders and eBay, the name
band through glare) and the owner's rule calls in section 4 are still needed.

### Risks

- **Overfitting to 69 owner holder photos.** Tune on the eBay holders (161) and check on the owner's,
  or the reverse, and report both. The owner's slab and case sets (20 photos) are too small to tune
  thresholds on.
- **Chance matches from more quads.** Guarded by the margin rule above. If a wrong appears, the holder
  pass is dropped for that holder kind, not loosened elsewhere.
- **CPU on the phone** for frames that never match (no card in view): cap by frame budget. Run the
  pass at most every third frame while nothing is tracked.
- **Found but still unsure.** Holders cut OCR quality (glare), so the conversion of newly found
  holder cards may sit at 40–60%, as today's slab and toploader rates show. Counted in the estimate.
- **eBay D is partly reference quality** (Kangaskhan): those stay misses, and the estimate assumes
  half.

## 4. Questions only the owner can answer

1. **Number misread rule (G, +5 owner):** may a read number that names no card in the art group be
   treated as a misread and ignored, rather than making the scan unsure? The art still has to decide
   alone under every other rule.
2. **The 80 eBay cards with no catalog artwork** (Classic Collections, trainer kits, JP promos): can
   their artwork come from another source? Or should the combined bar be measured on cards that
   have artwork? Without either, combined can't pass 88%.
3. **Stream camera:** can the scan window run 4K, or the card be held closer? Collector numbers are
   about 12 px at 1080p. That one change decides whether the number lever (105 combined, 12 owner)
   is reachable at all.
4. **More holder shots:** could you take about 40 more slab, magnetic-case and toploader photos as a
   held-out check? There are 14 slabs and 6 cases today.
