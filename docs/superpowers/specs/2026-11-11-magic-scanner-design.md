# Magic scanner (Magic step 3+)

Date: 2026-11-11. Status: draft, owner's finish decision folded in 2026-11-11; awaiting approval. The owner asked to "draft the design
from the One Piece plan" before any Magic rip frames exist. Each call below is marked as either
the owner's or the builder's (mine). Numbers marked *measured* come from Scryfall's `all_cards`
file of 2026-11-09 (`/var/tmp/scry/all-cards.jsonl.gz`).

## Intent

The owner bought Magic cards and opens packs on camera. They want the scanner to name each pull,
the way it already does for Yu-Gi-Oh, Pokémon and One Piece. They asked for Admin → Rip capture
(v0.68.0) to collect frames for exactly this. Magic is in the app (steps 1, 2 and 2b: English and
10 other languages, art, USD prices, back faces), but it's hidden from everyone except the owner
and testers, with `features.scan: false`. The Magic design (`2026-11-09-magic-design.md`) says it
opens to everyone only once the scanner passes its accuracy check. This design gets it there.

It follows One Piece's scanner path (`2026-11-04-one-piece-design.md`, step 4, and what shipped
after it): profile, nightly art fingerprints, a game-specific resolver, then a gate run on real
photos in CI.

## Anti-goals (failure even if it technically works)

The standing ones:

- **A wrong card anywhere the scanner names one, on stream above all.** When the scanner isn't
  sure, it asks the user to pick, and the overlay shows nothing or "not sure".
- **A wrong price.** A foil never shows the non-foil price, and the other way round. A reprint
  never shows the price of the printing it reprints. A Japanese printing never borrows the English
  price (`crossLanguagePriceFallback: false` already).
- **Yu-Gi-Oh, Pokémon and One Piece don't regress.** Their profiles, fingerprint files, resolvers
  and gate results stay as they are. Each game's CI gate must still pass at its current floor.
- **Slow scanning for the other games.** Per the owner's standing rule, report the time each card
  adds, and keep slow steps skippable.
- **Magic leaking before it's ready.** Scanning works for the owner and testers first. Opening to
  everyone is the owner's go.
- **Breaking Scryfall's image rules where users see it.** Fingerprint crops are internal and never
  shown. The UI keeps showing whole cards.

## What makes Magic different (measured)

- **Reprints share art across sets.** 107k English paper printings have about 52k distinct
  illustrations (Scryfall `illustration_id`). 19.5k illustrations appear in more than one set.
  **15.2k appear with the same frame and border in more than one set**: the same art in the same
  frame, in a different set, at a different price. One artwork has 41 English printings. Art
  can name the card and narrow the printing, but it can't name the set on its own.
- **Most printings print their set and number.** On frame `2015` (M15 onward, 75.5k of 107k
  English printings, *measured*), the bottom left reads collector number, rarity letter, set code
  and language (`0123 R` over `MH3 • EN`). Older frames (`2003` 16.2k, `1997` 10.9k, `1993`
  4.6k) print less or nothing. Packs opened today are all `2015` frame, so on rips the printed
  code can do most of the work, as One Piece's number does.
- **Foil vs non-foil is priced separately and both are common.** A pack has foils, and many
  printings come in both finishes.
- **Language is printed.** The `EN`/`JA`/`DE` … on the info line names the language, which saves
  guessing it from the text the way One Piece and Pokémon do.
- **Clean reference art.** Scryfall's images are scans of real cards with no SAMPLE stamp, so
  unlike One Piece the art box can be the whole art window.
- **Many frames for one artwork.** Borderless, showcase, extended art, retro frame and full-art
  lands are separate printings with their own Scryfall image (2b already stores art for each
  printing), and they look different around the art.

## Goals and order

Each step ships on its own, for testers only, as One Piece's did. The owner's photos decide
when it opens to everyone. **The first plan covers steps 3 and 3b in full** (they need no
photos). Step 4 is planned in outline: its thresholds, inner frames and info-line reading depend
on the 3b photos, so it gets a full plan once there are about 200 of them (my call).

1. **Step 3: profile and fingerprints.** A Magic `ScanProfile` measured on Scryfall images, and
   a `fingerprints-mtg` catalog stage that hashes reference art nightly and uploads its own file.
   No resolver yet; scanning stays off.
2. **Step 3b: training photos.** Magic in Contribute on desktop and phone (typed or read
   `SET NUMBER`, plus finish), and Rip capture frames labelled through the rip-review tools, both
   feeding a `mtg/` folder in the private scan corpus repo (`duel-binder-scan-corpus`).
3. **Step 4: the resolver.** `resolveMagic.ts`: art group plus info-line read plus name read,
   then printing, then finish. Turns `features.scan` on for testers. Desktop scan window, phone
   scanner, Stream mode and Code mode all work for Magic.
4. **Step 5: the gate, then open.** `scan-mtg-real.test.ts` runs the corpus in CI with a floor
   and 0 wrong. When it passes and the owner says go, Magic goes to `access: 'everyone'`, and the
   Fan Content notice goes on the marketing site (the Magic design's rule).

## Non-goals

- Reading the set symbol as a picture. The printed set code does that job on modern cards, and
  the art plus picking does it on old ones. Revisit only if the photos show old-frame reprints
  as the main miss.
- Detecting foil from the picture in step 4 (see **Finish**). That's a later spike, once rip
  frames show what foil looks like on this camera.
- Grading, condition, misprints, signed or altered cards, and art series cards.
- Tokens, emblems and oversized cards get fingerprints (they're in the catalog), but the gate
  doesn't count them.
- Digital-only printings (already out of the catalog).

## Step 3: profile and fingerprints

### Profile (my calls; numbers measured by the builder)

A `MTG_PROFILE` in `src/shared/scan/profiles.ts`, replacing the `// mtg: scanner step` comment:

- **Card shape:** 63 × 88 mm like the others, so the outline finder and warp need no change.
- **`artBoxes`:** the art window of the `2015` frame first. The builder measures it on Scryfall
  `large` images of a normal creature, an instant, a planeswalker, a saga, a borderless card, an
  extended-art card and a full-art land, then picks one box that is art on all of them (as
  Pokémon's `PKM_ART` is). The reference is cut to the same box, so a borderless printing matches
  its own image, whatever surrounds the art.
- **`windows` / `windowArt`:** the printed art window borders for the `2015`, `2003` and `1997`
  frames. `windowArt: true` lets a slightly-off outline still find the art, as for Pokémon.
- **`innerFrames`:** the art window and the text box border. Black-bordered cards on a dark desk
  will lose their outline, the way held One Piece cards did. Each inner frame is kept only if it
  finds one more card in the photos (One Piece's ablation rule).
- **`codeBands`:** the `2015` info line, bottom left, two lines. Also the `2003` collector
  number, bottom centre-left. Each band gets room for an outline a few percent off, with
  `codeReach` like One Piece. Whether `codeGray` helps is decided on photos.
- **`nameBand`:** top left, from the frame's edge to before the mana cost. **`textBox`:** the
  rules text, used only when the info line doesn't read.
- **`rarityLook: false`, `foil: null`** in step 3 (see **Finish**). **`holderSearch`:** off at
  first. Rips are bare cards, and turning it on is a one-line change if sleeved photos miss.
- **`keepOutline: true`** once fingerprints exist.

### Fingerprints (my calls)

- **A `fingerprints-mtg` stage** in `scripts/catalog/build.ts` and `catalog.yml`, next to
  `fingerprints-pkm` and `fingerprints-op`, with its own R2 key in `scanFiles.ts`, its own file on
  desktop and phone, and hidden-game download auth (Bearer token), as One Piece's has.
- **One record per distinct look of an artwork, not one per printing.** The key is
  `illustration_id` × frame × border × full-art × frame effects. The image hashed is the English
  printing's when there is one, else the earliest printing's. The other printings of that look,
  every language included, find it through `mtg_images.illustration_id` (stored since step 2).
  The builder measures the size; expect about 70k records at 44 bytes (format v2, since Magic
  ids are above 2^32), about 3 MB, against One Piece's 0.4 MB. If it comes out much bigger, say
  over 6 MB, stop and bring it back.
- **Japanese-only and other art that only exists outside English** (Japanese alternate-art
  planeswalkers, Mystical Archive JP) has its own `illustration_id`, so it gets its own record
  from that rule with no special case.
- **Back faces:** each face of a two-faced card is its own record, both resolving to the same
  printing. A card shown back side up still scans.
- **Skip** printings whose Scryfall `image_status` is `placeholder` or `missing`. Hash `lowres`
  ones but mark them, so the nightly report counts them. Recent previews start low-res and fill in
  later, and an artwork's hash refreshes when its image does (the per-printing art rule from
  2b).
- **Hash the `large` image** (672 × 936), cut to the art box. The scanner never shows these crops.
- **Budget:** images come from `cards.scryfall.io` at the politeness the art stage already uses.
  The first full hash will take more than one night; the stage keeps a cursor and only hashes
  new or changed art after that. Scryfall asks for 50–100 ms between API calls; image downloads
  from `cards.scryfall.io` have no stated limit, but hold to the same pace.

## Step 3b: training photos (my calls)

The gate needs real photos with known answers. Two sources, both feeding the corpus repo's `mtg/`
folder and `~/scan-capture/mtg-truth.json`, as One Piece's do:

- **Contribute** (desktop and phone, Magic added): the user types `MH3 123` (set code + collector
  number) or lets the reader fill it from the info line (the One Piece auto-read, two agreeing
  reads). Then they tap **Foil** or **Non-foil** when the printing has both. The language comes
  from the printing they pick. Truth is the printing and finish.
- **Rip capture frames:** labelled after the rip, with the rip-review contact sheets and the
  catalog, as the One Piece rips were. Low-confidence labels go to the owner to check.

Which cards to shoot (ask the owner): this week's packs as they come, plus a stack of older cards
(`2003` and `1997` frames, black and white borders), a handful of foils, two-faced cards and a few
non-English cards if they have any.

### Training photos (as built, 2026-11-11)

- Contribute for Magic takes a typed code only: `mh3 123`, `MH3-0123`, `mh3 #123` and
  `plst xln-217` all work (`normalizeMagicCode`), and set codes are suggested as you type. The
  info-line reader comes with step 4's `frameMagicCode`; the One Piece reader and guide box stay
  off for Magic.
- The finish is picked in the version list, which already lists each finish as its own printing
  (`Rare`, `Rare (Foil)`). Nothing is picked until the tester taps one.
- The Contribute button opens the game shown when that game is open to testers, so a tester with
  both One Piece and Magic gets Magic while on Magic.
- Pull the photos with `PORTAL_URL=… PORTAL_ADMIN_TOKEN=… npm run scan:pull-training -- --game mtg`,
  which writes `~/scan-capture/shots-mtg/` and `~/scan-capture/mtg-truth.json`.
- Rip capture frames are labelled by hand into the same `TruthRow` shape (`src/shared/training.ts`),
  with `tester` set to `rip-<session folder>` so they can be told apart from Contribute photos.
- Fingerprint size, measured on the desktop catalog (543,269 Magic images): 69,565 records (66,090
  looks and 3,475 back faces), 2.65 MB, and 1.4 ms per art lookup on the desktop.

## Step 4: the resolver (my calls)

`src/renderer/src/features/scan/resolveMagic.ts`, called where `resolve.ts` now leaves
`// mtg: scanner step`, in the same shape as `resolveOnePiece.ts`:

1. **Read the info line** (`codeBands`): set code, collector number, language. A new
   `src/shared/scan/magicCode.ts`, like `onePieceNumber.ts`, normalises what tesseract mixes up
   in this font, then checks the set code against the catalog's set codes and the number against
   that set's numbers. A read that names no printing is dropped, not guessed.
2. **Match the art** against `fingerprints-mtg`. This gives an artwork look, and from it every
   printing that has that look.
3. **Combine:**
   - **Read and art agree** (the read printing has the matched look): recognized, that printing.
   - **Read only:** recognized only if the art is not confidently another card. If confident art
     disagrees, unsure (One Piece's rule). A read one character off a printing of the confident
     art's look in the same set is taken as a misread, and the art stands (One Piece's
     `oneDigitApart`, extended to letters).
   - **Art only:** if the look has one printing in the chosen language, recognized. If it has
     several (a reprint, or a version in another set), the name read and the scan session's set
     (a picked set, as One Piece has) narrow it. If that still leaves more than one, unsure, with
     the user picking the printing. The overlay shows "not sure" and the price range of the
     choices, the existing unsure-version rule.
4. **Language:** the info line's language when read. Else the picked set's, else the user's
   language filter, else English (One Piece's order). `ja`, `zhs` and `ko` also come from
   `cardLanguage.ts` reading the text box, as for the other games.
5. **Finish:** see below.
6. **Thresholds** (`MTG_ART_MIN_MARGIN`, `MTG_SAME_ART`) go in `thresholds.ts`, starting at One
   Piece's values and tuned on the corpus. They're never loosened to raise the score if that adds
   a wrong one.

Code mode (`CODE_MODE_GAMES`) adds `'mtg'`. On the phone, holding the info line up to the camera
is
the fast path for old reprints. Stream mode and the desktop scan window need no Magic-specific
work beyond the resolver.

### Finish (owner's call, 2026-11-11: "tap only foil, with maybe an option to hard lock one or the other")

Non-foil is the default, and the user taps to mark a foil. The owner accepted the risk that comes
with it: a foil nobody taps is priced as non-foil. In step 4:

- **Only one finish:** a printing that exists in only one finish (`finishes` in Scryfall, e.g.
  foil-only promos and collector-booster-only foils) takes that finish, whatever the setting.
- **Both finishes:** the scan row is recognized as the **non-foil** printing, with its single
  price. A one-tap **Foil** toggle on the row, on the phone's last-scan card and on the desktop
  scan window's last row switches it to the foil printing (and back). The toggle is a printing
  switch. It moves the collection entry and the overlay price to that finish.
- **Finish lock:** a session setting with three states, **Auto** (the default, the rule above),
  **All non-foil** and **All foil**. It sits next to the session's set picker on desktop and phone,
  and the overlay shows a small "Foil" tag while All foil is on. A lock applies to every card that
  comes in both finishes. A card with only one finish still takes that finish (my call: a lock
  must never pick a printing that doesn't exist). The per-row toggle still works under a lock.
  The lock lasts for the session and isn't remembered across sessions (my call: a foil lock left
  on from last time would misprice a whole rip).
- **Gate scoring:** a non-foil default on a card the photo's truth says is foil isn't a scanner
  wrong; it's the rule the owner chose. The gate reports how many truth foils were defaulted to
  non-foil, on their own line. A scanner that *claims* foil (the spikes below) and is wrong counts
  as wrong.
- **Later spike, not in step 4:** M15+ cards print `•` between set and language on non-foils and
  `★` on foils (to verify on the owner's cards). If the info line reads it reliably at rip
  distance, the star alone can settle the finish. Separately, the Pokémon reverse-holo brightness
  check (`reverse-holo-detection`) may carry over to Magic's whole-card foil. Both are measured
  on the corpus first and only turned on if they add 0 wrong.

## Step 5: the gate, then open

- **`tests/main/scan-mtg-real.test.ts`** replays the corpus `mtg/` at the app's crop, in the CI
  `scan-photos` matrix with `SCAN_CORPUS_KEY`, as `scan-op-real.test.ts` does, against a slim
  Magic-only `catalog.sqlite` plus `fingerprints-mtg.bin`.
- **The bar:** 0 wrong over everything (a wrong finish counts as wrong). The recognized floor,
  85%, the standing bar, applies to `2015`-frame cards only, which is what packs hold today. Older
  frames (`2003`, `1997`, `1993`) are scored in their own group with no floor: most of their
  reprints print no set code, so "unsure" is the right answer there, and loosening thresholds to
  recognize them would risk wrong ones (my call). Hand-held tilted shots can be split out with a
  lower floor, as One Piece's went to 77% at the owner's call. Recognized means the right
  printing apart from the finish default (see **Finish**).
- **Fixture gate on upload:** a small committed set (`tests/fixtures/scan-mtg`, `make-fixtures.ts
  --game mtg`) blocks the nightly fingerprint upload if it fails, as for the other games.
- **Speed:** report median and slow-case time per card against One Piece's (~486 ms median).
  Matching 70k records instead of 10k must not add more than ~50 ms per frame on the phone. If it
  does, prefilter by the read set's printings.
- **Open:** on the owner's go, `MAGIC.access = 'everyone'`, `features.scan: true`, the Fan Content
  notice on duelbinder.com, and the portal deployed before the tag (the standing deploy order).

## Constraints

- **Deploy order:** a new R2 file and a portal route for fingerprints go out before any `v*` tag
  that downloads them (the Magic step 1 hard gate, and Android CI uploads on tags).
- **No heavy test data:** fingerprint and resolver tests use a few hundred records. Size and speed
  are measured in a capped standalone script, never 100k rows in vitest.
- **Typecheck:** run `typecheck:web` and `typecheck:phone` separately before pushing.
- **Worktree:** other sessions commit in the main checkout, so build in a worktree.
- **Scryfall terms:** accurate User-Agent; images not shown cropped; Magic never paywalled.

## Left to the builder

- Exact boxes for the profile, measured on Scryfall images and then on photos.
- The tesseract whitelist and confusion table for the info line's font, and whether to read both
  lines together or separately.
- The fingerprint look key's exact fields, if the measured count shows a simpler key does as well.
- How the Contribute picker shows set + number + finish on the phone, following One Piece's picker.
- Threshold values, within the 0-wrong rule.

## Owner decisions

- 2026-11-11, finish: non-foil by default, tap to mark foil, plus a session lock for all foil or
  all non-foil (see **Finish**).
