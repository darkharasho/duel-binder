# Pokémon scanner design (step 5)

Step 5 of `docs/superpowers/specs/2026-10-29-multi-game-pokemon-design.md`. Steps 2 and 3 shipped
(v0.22.0, v0.23.0): the app is multi-game and has a Pokémon English + Japanese catalog with prices,
visible only to the owner. This step makes the scanner work for Pokémon and, once it passes its
accuracy bar, opens Pokémon to everyone.

## Why

The owner and their friends stream Pokémon rips. For them the scanner, and above all the scan
window's overlay naming each pull and its price, is the reason to use the app. The owner's words:
**"I want the scanner to act just like the one for Yu-Gi-Oh."**

## Anti-goals

From the parent design, unchanged: **wrong prices, and misidentified cards on stream.**

- The scanner names a card only when it is sure. Otherwise it says nothing or "not sure".
- No price beats a wrong price. No cross-language price fallback; always USD.
- A version's price never shows for another version (reverse holo vs normal vs holo vs 1st Edition).
- Yu-Gi-Oh scanning does not regress: same results on its accuracy gate, same keys, same
  fingerprint file, same wire format.

## Goals

**Same behavior as Yu-Gi-Oh, on every surface.** When the current game is Pokémon:

- **Desktop Scan page:** in-page scanner and session list; nothing reaches the collection until Add.
- **Desktop scan window (stream overlay):** a normal pull shows the bottom bar for 4 s; a pull at or
  above the hit price (default $20, the existing setting) shows the gold top banner for 8 s with the
  FoundBurst sparkles. Pulls reach the main window through the existing outbox.
- **Phone scanner** (`ScannerScreen`, web and iOS).
- Same timings, stability rule (2 stable frames), confidence rules, session behavior and layout.
  Only the reading of the card is Pokémon-specific.

**Versions.** Pokémon prices per version (normal, reverse holo, holo, 1st Edition, and stamped
versions from step 3). The scanner tries to tell which version is in front of it.

- **Card known, version not sure:** the overlay shows the card's name and the **price range** across
  its possible versions (`low – high`), never a single price that might be the wrong version.
  Like Yu-Gi-Oh's pick-printing pulls, such a pull **never gets the hit banner**, even if its top
  price is over the hit price. In the session list it waits for the user to pick the version.
- **Card and version sure:** the version's price, and the hit banner if it's at or above the hit
  price.

**How cards are held.** On stream, cards are mostly shown **bare**, sometimes **in a toploader or
slab** to show them off.

- **Toploader (or magnetic case):** treated as a bare card, same price. (My call.)
- **Graded slab:** recognized as the card inside. The overlay shows the **raw card's price with a
  clear "raw" label**, so no one reads it as the graded value. A slab **can get the hit banner** on
  that raw price (the owner: "hit banner would be nice"). A slab still counts as a pull in the
  session list like any other card (my call, following "acts like Yu-Gi-Oh"; Add stores it as the
  raw card, which is what the collection can hold today, and nothing is added until Add, so a
  slab that's only being shown off can just be left out).

**Languages at launch: English and Japanese.** Simplified Chinese joins when step 4 builds its card
data (the owner: "we can follow up once it's ready"). Until then a **Chinese card must never be
named as its Japanese or English twin**: it shares the art, so an art match alone would be a
confident wrong answer with a wrong price. A Chinese card gets "not sure". Same for any other
language not in the catalog (Korean, Traditional Chinese, Thai, Indonesian, European).

**Accuracy bar, then everyone gets Pokémon.** The same bar as Yu-Gi-Oh: **zero cards named wrong,
and at least 85% recognized**. A correct card shown with its price range counts as recognized
(the owner decided); a card with only one version in the catalog is taken to be that version. Measured by a checked script like `scripts/catalog/accuracy.ts`
that runs in CI. "Wrong" includes the wrong version priced as sure and the wrong language. When it
passes, the owner-only gate (`ADMIN_DISCORD_ID`, server-enforced) comes off **in the same
release**, without a separate sign-off (the owner: everyone is fine, they're all internal testers
for now), and **all of Pokémon opens to everyone**: browsing, collection, prices and scanner, together.

**Test set.** Real photos, not just generated ones:

- The owner's **226 photos** in `~/scan-capture/shots-pkm/` (booth: `~/scan-capture/server.mjs`,
  `SHOTS=shots-pkm`). Labels in `labels.jsonl` are per batch only (a blank label continues the batch
  above), so each photo needs a per-card label (card, version, held how) before it can be scored.
  The owner labeled for the batch only: **the builder labels every photo and runs its own review
  and classification check on all of them**, as was done for the Yu-Gi-Oh corpus. A photo whose
  card or version can't be told for certain by eye is marked so and left out of the "wrong" count
  rather than guessed.
  The batches include Japanese, Trainer, Energy and old cards, bare holos, slabs, toploaders and
  magnetic cases, and Simplified Chinese (CSV5C), which must score as "not sure".
- **A much wider set of eBay listing photos** (the owner asked for breadth): many sets and eras,
  both languages, holo glare, poor lighting, odd angles, toploaders and slabs. They are for testing
  on this machine only; they never ship in the app, the repo or any upload.
- The bar holds across the combined set, and separately on the owner's own photos.

**Where the bar is measured** (my call). The launch decision is a **local run** of the accuracy
script on the full real-photo set, since those photos can't go in the repo. CI keeps guarding
afterwards the way Yu-Gi-Oh's does: a small committed set of generated Pokémon shots (built from
catalog art, like `tests/fixtures/scan`), and the nightly Pokémon fingerprint upload is blocked if
that set gets anything wrong. eBay photos are gathered once, in small batches outside the price
sweep's daily eBay quota (or saved by hand), not through a running job.

## Constraints

- Yu-Gi-Oh keys, wire format and the existing Yu-Gi-Oh fingerprint file stay byte-identical. Pokémon
  gets its own fingerprint file (the parent design: "per-game file"); keys can't collide.
- Run vitest with `--maxWorkers=2`. No heavy synthetic test data in vitest; benchmarks in a capped
  standalone script (≤50k rows).
- Deploy the portal before any release; deploys are one-way.
- Rip stays Yu-Gi-Oh only.
- The iOS app bundles the phone build, so phone scanner changes reach iOS only with a release.

## What's known about the how

- **Reusable as is:** camera loop, card detection (Pokémon cards share Yu-Gi-Oh's ~0.69 aspect), the
  warp, tracker, scan loop, outbox, overlay, session list, the DCT 256-bit fingerprint format, and the
  game-aware repo scan lookups (`scope.game`). The `features.scan` flag for Pokémon is `false` today
  (`src/shared/games/pokemon.ts`).
- **Yu-Gi-Oh-specific today, needing a Pokémon counterpart:** set-code OCR (`setCode.ts`), card
  regions (`vision/regions.ts`), the rarity cues and look model, the nightly fingerprint build
  (`scripts/catalog/fingerprints.ts`), and the rarity picker options.
- **Pokémon card reading:** the collector number (`045/193`) and set code/mark in the bottom corner,
  the name at the top, and language from the printed text. **Version:** reverse holo shines across
  the frame, holo on the art; 1st Edition and stamps are printed marks.
- HitCheck (`~/Documents/GitHub/pokemon-card-stream-pricer`, abandoned) got 5% top-1 with
  off-the-shelf image matching on other people's compressed streams; a desk webcam is the case the
  app already handles.

## Later (noted, not in this step)

- **Slabs as their own thing**, for both games: scannable as a slab (grader, grade), stored in a new
  **slab section** that showcases slab collections and their prices. A slabbed card **still counts
  as owning the raw card**; how the slab section and the raw collection reconcile is to be worked
  out then. Nothing in this step should make that harder (the parent design: a slab can later be a
  property of a collection entry).
- Simplified Chinese scanning, after step 4.
- Rip for Pokémon.

## Left to the builder

- How to detect the version, and how the per-game scan profile is structured in code.
- How sure is "sure" for Pokémon (art distance/margin, OCR agreement), within the bar.
- How to tell a slab or toploader from a bare card, and how the slab's "raw" label looks (matching
  the existing overlay style).
- How to gather and label the eBay photos, and how many are enough for breadth.
- Where the test photos live on disk and how the accuracy script finds them without committing them.
