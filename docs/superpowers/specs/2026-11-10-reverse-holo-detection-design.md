# Reverse holo detection (Pokémon scanner)

Status: design, awaiting owner approval. Date: 2026-11-10.

## Why

The owner opens whole booster boxes and scans every card on the desktop Scan page. The scanner
names the card but can't tell a Reverse Holofoil from the Normal printing, so after a box (438
cards from Delta Reign) they marked every reverse by hand. The background tilt read
(`src/shared/scan/tiltRead.ts`) was meant to settle Normal vs Reverse Holofoil and has never worked
for them.

Success: scan a pack the usual way and every reverse comes out as Reverse Holofoil with no fixing
afterwards.

## How the owner scans

Desktop app, Elgato Facecam on the Scan page, bare cards straight from the pack. They hold the
whole pack and peel off the front card once it counts, so the card barely moves and is never
tilted. Any cue has to work from an ordinary still frame of a card held flat.

## Goals

- Name Reverse Holofoil or Normal for a scanned Pokémon card whose versions are exactly Normal
  and Reverse Holofoil, from the frame the scanner already used to name the card.
- Clear the `check-rarity` flag when it names one, so the card needs no review.
- Keep scanning speed: a few milliseconds per card, no network on the scan path (see
  [Speed](#speed)).

## Non-goals

- Holofoil vs Reverse Holofoil (holo rares). Untested; such cards keep today's behaviour.
- Stamped versions (1st Edition, promo stamps), EX / IR / SIR / full arts: they don't have the
  Normal + Reverse Holofoil pair, so the check never runs on them.
- Phone scanning. The phone shares the engine, but only the desktop camera was tested. The check
  is off on the phone until a phone capture is done (see [Rollout](#rollout)).
- Pack position (holo, reverse, reverse, then normals). The owner rejected it: IRs/SIRs break the
  pattern and mixed piles have no order.
- Reverse Energy: it doesn't exist.

## Anti-goals

- Marking a Normal card as Reverse Holofoil. A wrong name the owner doesn't notice is worse than
  today's flag. If the replay gate (below) shows any Normal named Reverse, it doesn't ship.
- Slowing the scan loop noticeably (owner: speed matters).

## The cue (from the spike)

A reverse holo's foil covers everything except the art window. In a photo, the foil turns the
lower half (attack/text box) darker, greyer and flatter than the same area on the printed
reference image, while the art window stays like the reference. So the lower half's brightness
relative to the art is lower than the reference's.

Regions, as fractions of the upright, straightened card (the crop the scanner already makes,
842x1228). The spike measured them on that crop shrunk to 200x292:

- ART = x 0.06–0.94, y 0.09–0.47
- BODY = x 0.05–0.95, y 0.54–0.86

Luma = 0.299 R + 0.587 G + 0.114 B.

- **bodyLum** = (mean luma BODY / mean luma ART) on the photo ÷ the same ratio on the reference
  image.
- **spread** = (std / mean of luma over BODY) on the photo − the same on the reference image.

**Rule:** Reverse Holofoil if bodyLum < 0.69 or spread > 0.20, else Normal.

Spread is required. Dark-type reverses (Spinarak, Zarude, Nidoqueen) have dark bodies on the
reference too, so bodyLum barely moves. Their textured teal body turns to flat grey, and only
spread catches them.

### Evidence

Two capture runs of Delta Reign (DLR / me06) cards, owner-labelled, at 1080p under one desk
light:

- Run 1: 57 cards (23 reverse); 51 gave a usable crop. The rule was picked on this run.
- Run 2: 66 cards (incl. 7 Trainers, 2 reverse). Applied the run-1 rule unchanged, scoring from a
  single frame: 66/66. Two labels were corrected by the owner after looking at the cards (#58,
  #10). #57 was also changed to reverse on sight.
- Total 117/117. Tightest cases: reverses at bodyLum 0.53 (spread 0.11) and 0.655; dark-type
  reverses at bodyLum 0.74 / 0.975 caught by spread 0.31 / 0.25; lowest Normal bodyLum 0.776.

Data: `~/scan-capture/shots-rev/` (labels.jsonl per run; run 1's raw frames were overwritten,
its crops are in `~/rarity-corpus/revholo/cards`), analysis in `~/rarity-corpus/revholo2en`
(`rows.json`; the script is `~/rarity-corpus/revholo2/spike/analyze.mjs`; the target is the single-frame `_f0` values).

Untested: other sets (including pattern reverses such as Poké Ball / Master Ball styles), other
lighting, 4K frames. Reference images also come from different sources by set (pokemontcg.io
scans, other renders, hand-uploaded R2 art for me06), and a brighter or higher-contrast source
could shift the scores. So the check runs only on checked sets (below).

### Checked sets (owner's decision)

The check runs only for printings in a list of checked sets, kept in shared code. It starts with
Delta Reign (me06) alone. Every other set keeps today's behaviour. A set is added once a pack of
it has been captured with the booth (`~/scan-capture/revholo.mjs`, ↑ reverse / ↓ normal) and scored
against that set's references with no Normal named Reverse. Each set added is a small PR that
includes the capture's result.

### The reference must be the printing's own image

The art match often lands on the Japanese twin's image, whose text box differs. In the spike, half
the run-2 cards matched the Japanese image, and the scores were only right against the English
printing's image. The reference stats must come from an image of the printing being decided (the
draft's chosen English or Japanese card), never just the top art match.

## Where it fits

- **Reference stats, built nightly.** `scripts/catalog/fingerprints.ts` already downloads every
  Pokémon image to hash it. Have it also compute two numbers per Pokémon image id: the reference
  body/art luma ratio and the body spread, on the same straightened crop the scanner uses. Ship
  them alongside `fingerprints-pkm.bin` (a sidecar like the refs file, or extra fields; builder's
  call). Expect a one-time recompute of all Pokémon images.
- **Photo side.** `pokemonVersionCues` (`src/renderer/src/features/scan/vision/pokemonVersion.ts`)
  runs in the vision worker on the straightened card. Add the photo's own body/art ratio and body
  spread there.
- **Decision.** In `draft()` (`src/renderer/src/features/scan/resolvePokemon.ts`), when the card's
  options are exactly Normal and Reverse Holofoil (one printing each), look up the reference stats
  for the image of those printings and apply the rule. `pokemonVersion` today never names Reverse
  Holofoil on purpose (frame texture was unreliable). This new cue replaces that reasoning for this
  pair only. The existing Holofoil logic stays.
- **Tilt read.** It stays. When the new check has named the version, the tilt read leaves the row
  alone; otherwise, behaviour as today.

## Behaviour (my calls, flagged for the owner)

- Only for printings in a checked set (above); anything else is today's behaviour.
- Named Reverse Holofoil or Normal: that printing is chosen and the row has no flag.
- The check can't run (no reference stats for that image, unusable crop, more than the two
  versions): today's behaviour, Normal with `check-rarity`.
- No "unsure" band in the first version. The rule is a clean cut with a margin on run data. An
  extra band would mostly flag Normals, which is the work the owner wants gone. Revisit if misses
  show up.
- Scan Sessions / overlays: no new UI; the row shows the chosen printing like any sure scan.
- English cards only. The thresholds were checked only against English printings' images.
  Japanese and Chinese cards (including Chinese named through a Japanese twin) keep today's
  behaviour. The check runs only when the named card is English. If the language was only assumed
  rather than read or confirmed by the name band, behaviour stays as today.
- Desktop camera frames only. Frames from a phone, whether the phone app's own engine or phone
  Stream mode analysed on the desktop, keep today's behaviour.

## Speed

Two region means and a standard deviation on the already-straightened card, shrunk first, cost a
few milliseconds. Measure the added per-card time on the desktop worker and report it in the PR.
No network on the scan path: the reference stats arrive with the fingerprint file.

## Testing

- Unit tests for the rule and the region stats (small synthetic images).
- Replay: run both capture runs through the app's own pipeline (straighten → cues → rule against
  the nightly-style reference stats of the English printing). Target 117/117, and zero Normals
  named Reverse is required. Add these frames, with their truth, to the private scan corpus
  (`duel-binder-scan-corpus`), so CI keeps checking them; run 1 contributes its surviving crops
  if the corpus format allows, else run 2's 264 frames alone.
- Existing gates (Pokémon photo corpus floors, YGO/OP gates) unchanged.

## Rollout

Desktop first, on for everyone (the owner is the main scanner). The phone's check stays off until
a phone capture of the same kind (a pack, held flat) passes. That later step is a separate
request.

## Left to the builder

- Sidecar format and how the app loads it; exact shrink size and filtering, as long as the replay
  still hits the target (the thresholds were tuned at 200x292).
- How the reference image is straightened in the nightly build so its regions match the photo's.
- Code layout, names, worker plumbing, test structure.
