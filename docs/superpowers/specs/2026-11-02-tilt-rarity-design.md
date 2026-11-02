# Tilt rarity

Date: 2026-11-02. Written against `origin/main` at `183140f`.

## Intent

A still camera frame can't tell most foils apart. Super, Ultra and Secret Rare, or a Pokémon Holo and a Cosmos Holo, look alike at one angle. They look different when light moves across them. Today, when a scanned card's set code comes in several such finishes, the scanner leaves the lowest rarity selected and flags the row "Check rarity" (Pokémon: "Check version"). The user then picks the rarity by hand from the dropdown.

With this feature, the scanner asks for a short tilt when it would help. It reads how the light moved and pre-selects its best guess. The row keeps its "Check rarity" flag, so the user still confirms. Most of the time the guess is already right.

The evidence is three private tilt spikes (2026-11-01 and 2026-11-02, see "Evidence"). None of them reached near-certain. The owner decided on 2026-11-02 to ship anyway, as a pre-picked guess on a webcam, and to improve it later.

## Goals

- When a scanned printing's code comes in two or more holo-type finishes, prompt "Tilt the card" over the camera, record about 2 seconds of frames, and pre-select the finish a classifier picks.
- The classifier picks only among that printing's real rarities.
- Never prompt when the prompt can't help: all finishes plain, one plain and one foil, or (Pokémon) Normal against a reverse.
- Skip, or about 4 seconds with no usable tilt, gives exactly today's result.
- Works in the desktop scan window and the phone app, desktop and iOS.
- Train the model from the private clips, and ship only its numbers.

## Non-goals

- Near-certain rarity. Every tilt guess keeps "Check rarity".
- A model for still frames. Rows with no prompt keep today's still-frame result: name and frame rules on every scanner, and the look model after them on the phone.
- Telling stamps apart (1st Edition, Shadowless, Set Logo). Tilt reads a finish, not a stamp.
- New screens, settings or toggles. The prompt overlays the camera, like the hit pop-up does.
- Tilt on a photo (Take photo, or the automatic photo of an unsure card). A card counted from a photo is counted as today.
- Shipping clips, frames, features, labels or corpus paths in the repo.

## Anti-goals

These would make it a failure even if it technically works:

- A card that never gets counted because the tilt never finished. Every path out of a tilt counts the card.
- A guess that is not one of the printing's own rarities.
- A tilt guess that clears "Check rarity".
- The phone Stream mode, or anything its viewers see, showing the tilt prompt.
- A scan loop that slows down for cards that never tilt.

## Decisions by the owner (2026-11-02)

- **When.** After a scan identifies the card and printing as today, look up which rarities that printing's set code comes in.
  - If they're all normal, or the choice is only Common against a foil, or (Pokémon) Normal against Reverse, show no tilt prompt. The guess comes from still frames, as today.
  - If two or more holo-type finishes are possible, show "Tilt the card" over the camera and record about 2 seconds of frames. Holo-type means Yu-Gi-Oh! Super, Ultra, Secret, Prismatic and kin, or Pokémon Holo against Cosmos and similar.
- **Guess.** A classifier picks only among the printing's real rarities. The guess is pre-selected on the scanned row, and the row still shows "Check rarity".
- **Skip.** A Skip button, or about 4 seconds with no usable tilt, falls back to today's behaviour.
- **Where.** In both the desktop scan window and the phone app ("both, phone too"). The owner knows phone accuracy is poor for now.
- **Stream mode.** The phone Stream mode (`src/phone/stream`, PR #153, not on `main` yet) never shows the prompt.
- **No new screens.** The prompt overlays the camera.
- **Model.** It is trained from the private clips, and only its coefficients ship. Its webcam accuracy is good enough to ship as a pre-picked guess plus "Check rarity".

## Decisions by Claude

These are my calls. The owner hasn't seen them yet.

- **The desktop in-page scanner (Scan page) tilts too.** It uses the same webcam and the same loop as the scan window.
- **Pokémon reverse finishes are not holo-type.** These are Reverse Holofoil, Poke Ball Pattern, Master Ball Pattern and the other pattern reverses. Holo against Reverse, or Reverse against Poké Ball, does not prompt. This follows the owner's "Normal vs Reverse: no prompt". It also keeps Pokémon rares from prompting on every card. The spikes found Holo vs Reverse weak on the phone and Reverse vs Poké Ball no better than chance. When a prompt does fire, a reverse finish can still be the guess.
- **Yu-Gi-Oh! Rare is plain.** Its foil is only the name, which today's name rules already read.
- **The prompt needs two holo-type finishes the model knows.** A finish the model has too few clips for never counts toward a prompt and is never guessed. The user can still pick it from the dropdown. In v1 this means Ultimate, Starlight, Quarter Century, Collector's, Ghost, Gold and Platinum never prompt (see "The model").
- **No prompt where an option is overframe or full art**, as `look.ts` already does: art over the frame reads as foil.
- **No prompt for a best-guess card** (`draft.guess`). A tilt on what may be the wrong card wastes the user's time.
- **The draft is held, not counted then patched.** The card is counted once, after the tilt, skip or timeout. The hit pop-up and ping come at that point. This keeps one count per showing, with no row edits after the fact and no change to the scan window's outbox.
- **During a tilt, frames skip the resolver.** Each tilt frame is matched only against the held card's artworks, with no OCR and no lookups. If the card leaves the view (`ABSENT_MS`) or another card's art turns up, the held draft is counted as today, and scanning goes on.
- **Desktop scan window Skip.** The scan window has no buttons, since it is a capture surface, and (owner's ruling) shows no tilt prompt. Skip sits next to Take photo in the main window's Scan page and travels as a `skipTilt` message, the way `takePhoto` does. The in-page scanner and the phone show Skip on the prompt itself.
- **One model per game, pooled over cameras and holders.** The spikes show that accuracy collapses when a model trained on one holder or one camera is tested on another. Phone clips are too few for a model of their own.
- **A per-pair nearest-centroid classifier**, ported from the spike's classifier (Fisher-ranked features, standardized, nearest centroid). Each pair of finishes gets its own feature subset and centroids. Among more than two finishes, the finish that wins the most pairs is the guess; ties go to the larger summed margin.
- **The fit uses the runtime's window.** The fit doesn't reuse the spike's per-clip features, which cover whole 4-second, 15 fps clips. It recomputes features from each clip's straightened frames, sampled the way the app samples them (`TILT_MS` of frames at `TILT_FRAME_MS`). The worker and the fit run the same shared function.
- **Corpus labels excluded from training.** "Gold Rare" is excluded, because most of its clips are probably Premium Gold. So are EX, V, VMAX, VSTAR, Shiny and Amazing Rare, which name a card, not a finish.

## How it works

### When a tilt is asked for

A live draft is held for a tilt only when every one of these holds:

1. The scanner was given a tilt model for the draft's game.
2. Rarity is Auto: `defaultRarity === null`.
3. The draft isn't a best guess, and its flag is `check-rarity`. On Pokémon it may also be `pick-printing`.
4. None of its options is overframe or full art.
5. Among the options, at least two distinct **holo-type** finishes are classes of the model.

The options are the ones the look model reads among. For Yu-Gi-Oh!, that is the draft's code's printings in its language and art family (`lookOptions` in `resolve.ts`). For Pokémon, it is the card's own versions (`options` with the draft's `cardId`).

The guess is made among every option whose finish the model knows. Plain finishes count here too: for Common, Super and Ultra, all three are candidates.

### Finishes

A catalog rarity maps to a **finish**. For Yu-Gi-Oh!, that is the rarity's family (`rarityFamily`: the variant in brackets dropped). For Pokémon, it is the version with any stamp prefix dropped. Finish names are catalog names, taken from `card_printings.set_rarity`, local DB checked 2026-11-02.

**Yu-Gi-Oh!, plain.** Common, Short Print, Super Short Print, Rare (and its coloured and DL variants), Normal Rare, Kaiba Corporation Common, Kaiba Corporation Rare, Duel Terminal Technology Common. Leftover abbreviations c and SP count as plain too.

**Yu-Gi-Oh!, holo-type.** Every other rarity. In catalog order of frequency: Super Rare, Ultra Rare, Secret Rare, Quarter Century Secret Rare, Ultimate Rare, Prismatic Secret Rare, Normal Parallel Rare, Collector's Rare, Starlight Rare, Platinum Secret Rare (PlScR), Starfoil Rare, Gold Rare, Shatterfoil Rare, Mosaic Rare, Duel Terminal * Parallel Rare, Gold Secret Rare, Premium Gold Rare, Ultra/Super/Secret Parallel Rare, Extra Secret Rare, Millennium (Super/Ultra/Gold/Secret) Rare, Ghost Rare, Platinum Rare, Holographic Rare, 20th Secret Rare, Grand Master Rare, Ultra Secret Rare, 10000 Secret Rare, Kaiba Corporation Ultra Rare, Pharaoh's Rares, Ghost/Gold Rare.

Rows still stored under an abbreviation (PlScR, DNPR, DUPR, URPR, GGR) aren't spelled out. They count as holo-type finishes the model doesn't know, so they never prompt. The builder may move `normalizeRarity`'s table from `src/main/yugipedia/parse.ts` into `src/shared` if a test shows they matter. That is optional.

**Pokémon, plain.** Normal and every stamped Normal: 1st Edition, Shadowless 1st Edition, Shadowless Normal, Set Logo Normal, 1999 2000 Copyright Normal, Player Rewards Program Normal, No Rarity Normal, Pre Release Normal, the player-name Normals and the other "… Normal" labels.

**Pokémon, reverse (not holo-type).** Labels containing "Reverse" or "Pattern": Reverse Holofoil, Poke Ball Pattern, Master Ball Pattern, Energy Symbol Pattern, Dusk Ball Pattern, Love Ball Pattern, Set Logo Reverse Holofoil, and the like. Each pattern is its own finish. Every "… Reverse Holofoil" is the finish Reverse Holofoil.

**Pokémon, holo-type.** Holofoil and every stamped "… Holofoil" (1st Edition, Shadowless, Set Logo, Player Rewards Program, 25th Celebration, Pokemon Center and others; finish Holofoil). Also Cosmos Holo, Cracked Ice Holo, Starlight Holo, Mirror Holofoil and Mirror Foil, each its own finish.

**Unknown labels.** A label in none of these groups is its own holo-type finish. Since the model doesn't know it, it never prompts and is never guessed.

### The tilt

1. **Hold.** The loop holds the draft, sets status `{ kind: 'tilt', name }` and asks the worker to start keeping frames of that card. It does not call `onDraft`.
2. **Collect.** Each tick (`TILT_FRAME_MS`) grabs a frame. The worker matches it against the held card's artworks only, with no text bands. When the art matches, it keeps the straightened card, shrunk to 421×614 RGB, with a timestamp. It keeps at most `TILT_MAX_FRAMES`.
3. **Read.** From `TILT_MS` after the prompt, and then every `TILT_RETRY_MS`, the loop asks the worker for the features of the latest `TILT_MS` of kept frames. A reading is **usable** when it has at least `TILT_MIN_FRAMES` frames and its `motion` is at least `TILT_MIN_MOTION`. Motion is the spike's moDiff on the art: the mean absolute luminance change between aligned, exposure-matched frames.
4. **Guess.** On the first usable reading, the classifier picks a finish among the options. The draft is set to that finish's printing (`withRarityByTilt`), keeping `check-rarity`. The draft is then counted.
5. **Fallbacks.** In each of these cases the held draft is counted exactly as it would have been without tilt, and the frame store is cleared:
   - Skip.
   - `TILT_TIMEOUT_MS` passes with no usable reading.
   - The card is gone for `ABSENT_MS`.
   - Another card's art appears.
   - The set, game or language changes.
   - Scanning stops.

After a tilt, the tracker treats the card as counted for its showing, as it does today. Lowering the card is still how the next card starts.

### Starting values (thresholds.ts)

| constant | value | note |
|---|---|---|
| `TILT_MS` | 2000 | the window the model reads (owner: "about 2 seconds") |
| `TILT_TIMEOUT_MS` | 4000 | owner: "about 4 seconds" |
| `TILT_FRAME_MS` | 100 | tick during a tilt; the fit samples clips on the same grid |
| `TILT_RETRY_MS` | 500 | re-read cadence after the first window |
| `TILT_MIN_FRAMES` | 12 | |
| `TILT_MAX_FRAMES` | 40 | about 31 MB of RGB at 421×614 |
| `TILT_MIN_MOTION` | builder sets | from the corpus: the fit prints motion per window; set it to the 10th percentile of webcam windows |

`TILT_FRAME_MS` and `TILT_MIN_FRAMES` are the builder's to tune once the realized frame rate is measured on the desktop and the phone. If they change, the model is refit.

### Features

`src/shared/scan/tiltFeatures.ts` is a pure TypeScript port of the spike's feature code. It has no OpenCV and no Node APIs, so the worker and the fit script both run it. It computes only the 25 features the spike's classifier ranks:

- reflection: `rxart rxname rxtext rxborder rxband rhart rhname rhtext rhborder rhband`
- reflection colour: `rxEntropy rxTop rxGold rxColour`
- spectrum: `sp0 sp1 sp2 sp3 spAxis spSkew`
- `nameHueR`, `gFlow`
- ratios: `artVsText artVsBorder textVsBorder`

It also returns `motion`. The port covers alignment, exposure matching, the reflection, the spectrum, the per-region amplitude and peak-hue statistics, and gFlow, with each game's regions as in the spike. The spike's other outputs aren't ported (Travel, P90, Chroma, Foil, the g-lags, sparkle). In-place `sort()` on a Float32Array must stay numeric.

Budget: one 2-second window must compute in under 1 s in the desktop worker. If it doesn't, the builder halves the working size and refits. The worker and the fit share the code, so they stay equal.

### The model

`src/shared/scan/tiltModel.ts` is generated, as `lookModel.ts` is, and exports `TILT_MODELS: Partial<Record<GameId, TiltModel>>`. Per game, it holds:

- the feature names, plus the mean and spread for standardizing them
- the classes (finishes)
- one entry per pair of classes: the indices of its k features, and the two centroids

It holds no clip keys, no labels and no accuracy figures.

A class enters the model with at least 8 usable clips from at least 5 cards. A pair enters when both of its classes do. Going by the spike's counts, v1 should have:

- **Yu-Gi-Oh!:** Common, Super, Ultra, Secret, Prismatic Secret
- **Pokémon:** Normal, Holofoil, Reverse Holofoil, Cosmos Holo, Poke Ball Pattern

The fit decides the real list.

Corpus labels map to finishes: Yu-Gi-Oh! labels are already catalog names. For Pokémon: Holo → Holofoil, Reverse Holo → Reverse Holofoil, Poké Ball Reverse → Poke Ball Pattern, Master Ball Reverse → Master Ball Pattern; Normal and Cosmos Holo stay as they are.

### Fitting (private corpus, outside the repo)

`scripts/scan/rarity/fit-tilt.ts` is bundled by `scripts/scan/rarity/vite.config.ts` like `fit-look`. It reads the corpus only from paths given on the command line:

- `--frames <dir>`: the straightened frames, one directory per clip, in the private corpus
- `--clips <file>`: card id, rarity, holder and game per clip
- `--labels <file>`: camera per clip

It writes the model with `--write src/shared/scan/tiltModel.ts`. Its held-out report goes to `--report <path>` outside the repo.

All of these are in the owner's private corpus. Their paths stay out of the repo.

Held-out evaluation is leave one card out, as in the spike. It reports per pair and per game, split by camera (webcam, phone) and by holder. Each held-out clip is scored on the first full `TILT_MS` window after its first straightened frame, which is what the app would see. Training may use every window that starts on a `TILT_MS / 2` step.

### UI

- **`TiltPrompt`** is a pointer-transparent overlay over the camera, styled like `PullOverlay`'s bar. It reads "Tilt the card" and shows the card's name. It has an optional Skip button, which is pointer-active.
- **Phone (`PhoneCamera`) and in-page scanner (`InPageScanner`):** the prompt with Skip, inside `ScanViewport`. `statusText` reads "Tilt the card to read its rarity".
- **Scan window:** no tilt prompt (owner's ruling), so a stream capturing the window never shows one. Its status reads as above, and the Scan page shows Skip beside Take photo while the window's `state.loop.kind === 'tilt'`.
- **Stream mode:** `useHubScan` takes a `tiltModels` option that defaults to none. `StreamCamera` doesn't pass it, so it never tilts. If PR #153 merges first, the builder adds a test that Stream mode never reports `tilt`.

## Evidence

The evidence is in the owner's private tilt notes, outside the repo. In short: the foil-vs-foil guess is weak, especially across holders and on the phone; Common against a foil is strong. Expect pooled results below the best single-holder ones. The guess is pre-selected, and "Check rarity" stays.

## Left to the builder

- `TILT_FRAME_MS`, `TILT_MIN_FRAMES` and `TILT_MIN_MOTION`, from measured frame rates and the corpus.
- k, the number of features per pair: 3 by default, or chosen by the fit's held-out report. Don't select k on the same held-out scores you then report without saying so.
- Whether to spell out stored abbreviations in shared code.
- The prompt's exact styling, within the `PullOverlay` look.
