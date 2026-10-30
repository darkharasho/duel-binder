# Pokémon scanner: learned detector and camera tiers

Follows `2026-10-30-pokemon-scanner-holders-design.md` and the pass 3b log in
`.superpowers/sdd/2026-10-29-pokemon-scanner/task-13-report.md`. Design only; nothing here has been
built, trained or benchmarked. Figures marked *estimate* are unmeasured.

The owner's direction: "idk where this 1080p limit came from, we should train it well and then have
the camera dependent."

## Summary of decisions

1. **First, fix what we measure.** The gates run whole landscape frames; the app runs a 3:4 centre
   crop. The "110 px card" and the "960 was worse" result describe the gate, not the app.
2. **Detector:** a small MobileNetV3-Small encoder with a light decoder, outputting a card mask and a
   corner heatmap. Input 240×320, about 1.5–2 MB as int8 ONNX, run by ONNX Runtime Web on WASM in the
   vision worker. It proposes quads into the existing `closest` → `ranked` path, so the art match
   stays the only judge. No model, a failed load or a low score leaves today's finder as is.
3. **Training:** synthetic composites of catalog art only, on a rented GPU, capped at $40. Real
   photos are for evaluation only and never leave this machine.
4. **Camera tiers:** by pixels on the card, per showing, not by frame size. Tiers decide what is worth
   reading, what the user is told and how a read counts. They never loosen an art rule.
5. **Evaluation:** about 200 new 4K photos, split by card, with 100 sealed.
6. **Honest expectation:** owner 104/172 today. Detector plus 4K likely reaches about 71–81% on
   comparable photos. The 85% bar probably still needs the owner's rule calls (section 7).

## 1. What the code shows

**The 1080p limit was only in the photos.** `useCamera.ts` already asks for `ideal` 3840×2160.

**4K gains nothing at the find-the-card step.** Search is scaled to SEARCH_WIDTH (640) by frame
width, so the same view of the card gives the same search image at any resolution. The gain from 4K
is in reading: `bandWidth` (analyze.ts) warps text at the card's own size, up to 2×CARD_W.

**The gates and the app see different frames (new finding).** `grab()` in `useScanLoop.ts` cuts every
live frame to a 3:4 centre crop before the worker sees it: 1920×1080 becomes 810×1080. Neither
`scan-pkm-real.test.ts` nor `scan-real.test.ts` calls `centreCrop`; they pass the whole photo.

| | gate today | live app, 1080p | live app, 4K |
|---|---|---|---|
| frame reaching `analyze` | 1920×1080 | 810×1080 | 1620×2160 |
| search image | 640×360 | 640×853 | 640×853 |
| search scale | 0.33 | 0.79 | 0.40 |
| card about 330 px wide at 1080p, in the search | **110 px** | **about 260 px** | about 260 px |

Consequences, all unmeasured:

- The app may already find bare cards the gate misses, so some of the 27 "art missing" owner photos
  may be gate artefacts. Others may get worse: a card outside the centre crop is lost, and the search
  image has 2.4× the pixels, so Canny and Hough settings tuned at 640×360 may behave differently.
- The 960 trial (107 vs 116) ran at scale 0.5 on a landscape frame. It says nothing about the app.
- 0 wrong has not been measured on what the app actually analyses.

**Native text size is smaller than reported (to confirm).** A 330 px card on a 63 mm width is about
5.2 px/mm. A collector number's digits are about 1.2 mm tall (*estimate*), so about 6 px native at
1080p. That fits the "14 px at 4K, not 7" comment in `useCamera.ts`, but task 13's "about 12 px" looks
like a figure on the upscaled warp. Upscaling adds no detail, so the native figure is what decides.

**A model cannot reuse OpenCV.** The bundled `opencv.js` (10.9 MB) has no `dnn` module
(`readNetFromONNX`, `blobFromImage`: 0 hits), so a new runtime is needed.

**The look model's route doesn't scale to this.** `lookModel.ts` is a logistic model of about 16 KB
written out as TypeScript by `fit-look.ts`. A convolutional model doesn't fit that. Its habits do
carry over: a private corpus outside the repo, a generated artefact, hold-out by card, and its lesson
that a model scoring well on eBay gave no gain on webcam frames until tested there.

## 2. Detector

### Model

| option | verdict |
|---|---|
| **Mask + corner heatmap, MobileNetV3-Small encoder** | **Chosen.** Small, tolerant of occlusion, single-card, one-class. |
| MobileNetV4-Conv-Small encoder | Reserve if accuracy falls short and the latency budget has room: about 3× the MACs. Apache-2.0 weights confirmed on the timm card. |
| Ultralytics YOLO-pose / -seg | Rejected. AGPL-3.0 or paid Enterprise. |
| RTMPose / RTMDet (MMPose, Apache-2.0) | Licence fine, but built for many instances with a heavy training stack; more than one card outline needs. |
| Direct corner regression | Rejected. One hidden corner spoils the whole output, and fingers hide corners. |
| MobileSAM-class segmenters | Rejected. Tens of MB, too slow on a phone. |

- **Outputs**, at stride 4 (60×80): one card mask and one corner heatmap. The corner channel has no
  order, because `orderCorners` already handles that and the top of a card can't be told from its
  outline; `rankArt` tries both ways up as it does now.
- **Target:** the frontmost face-up card itself, never its holder. That is the whole point: today's
  miss is the holder's rim or the deck beating the card.
- **Size:** about 1.2–1.5 M parameters and 0.15–0.2 GMAC (*estimate*). Limit: **3 MB** on disk.
  Static int8 quantisation, calibrated on synthetic frames.
- **Input:** 240×320, matching the 3:4 crop. Other shapes (eBay photos) are letterboxed. A 4K frame is
  shrunk first, so model cost doesn't depend on the camera.
- **Heads we don't add:** holder kind, orientation, glare. Each is more labels and more to go wrong,
  and nothing depends on them yet.

### Two passes for accuracy

The art hash loses about 20 bits per percent the box is off (`jittered` in detect.ts). A typical card
spans about 40% of the crop's width, so about 98 px at 240 input, and 1 px is 1% of the card, or about
20 bits. One pass is not accurate enough, so:

1. Run on the whole crop to find the card.
2. Run again on a region round it, cut from the full-size frame, so the card fills about 65% of the
   input (1 px is about 0.6%).
3. Fit four lines to the mask's boundary with RANSAC, so a finger's bite doesn't bend a side, and use
   corner peaks to choose between fits.
4. Propose that quad, plus the existing `searchRegion` lines inside the region, which snap to real
   edges at native resolution.

No refinement step may score against art distance; that can manufacture a match (same rule as 3b).

### Runtime

**ONNX Runtime Web 1.31 (MIT), WASM backend, in `vision.worker.ts`**, on desktop and phone.

- One path everywhere. Electron 44, the phone web app and the iOS web view all run WASM SIMD, and
  both CSPs that run the scanner already allow `wasm-unsafe-eval` (`src/renderer/index.html`,
  `phonePage.ts`).
- WebGPU is not the baseline: ORT Web calls it experimental, and iOS has it on by default only from
  iOS 26.
- Single thread budgeted. WASM threads need cross-origin isolation, which neither page has today;
  adding it for one model isn't worth the risk to the portal page.
- LiteRT.js (`@litertjs/core`, Apache-2.0) is the alternative, but needs a TFLite conversion step.
  Revisit only if ORT fails the spike.

### Latency budget

Today: detection about 230–280 ms in node, a loop tick every 200 ms that skips while one is in flight,
and a median 2.7 s on frames that fail into the holder search.

| | budget, both passes and quad fit | note |
|---|---|---|
| Desktop | p95 ≤ 80 ms | *estimate* 30–60 ms |
| iPhone, 3 years old | p95 ≤ 150 ms | *estimate* 60–120 ms |
| First load | ≤ 1 s | after download |

I found no published timing for this model on this runtime, so these are limits to test, not
predictions. Step 4 tests them before any training money is spent. If the phone misses by less than
2×, drop pass 1 to 192×256; otherwise stop.

### Delivery and size

- **Runtime:** bundled with the app as a lazy chunk, loaded only when a Pokémon scan starts.
  About 11–12 MB of WASM, per public reports of `ort-wasm-simd-threaded.wasm`; a custom ORT build with
  only the needed kernels can cut this and is worth trying once the model is fixed. On the phone it
  follows the OCR core's route: own files, not in the first precache. Yu-Gi-Oh scanning never loads it.
- **Model:** downloaded, like the fingerprints: `GET /scan/detector?game=pkm`, stored in R2 at
  `scan/pkm/detector.onnx` with a `.prev` copy and rollback, as `scanFiles.ts` does. It takes the same
  access rule as the Pokémon fingerprints, so it stays owner-only. A retrain then needs no app release.
  It is passed to the worker in `init` as bytes, next to `fingerprints`. The download is only needed
  once per version.
- **Limit:** a model over 3 MB doesn't ship. Runtime over 15 MB means doing the custom build first.

### How it plugs in

`recognizeArt` is synchronous and ORT is async, so the model runs first in the worker:

```text
vision.worker handle(frame):
  proposals = profile.detector && session ? await detect(frame) : []
  analyze(..., proposals)          // new trailing argument, default []

recognizeArt:
  first search → inner-frame pass        (unchanged)
  no match?  closest(proposals) → ranked (new; artVia: 'detector')
  no match?  lookAgain, on holderBudget  (unchanged)
```

- `ScanProfile` gains `detector: boolean`: pkm true, ygo false. Yu-Gi-Oh passes no proposals, so its
  code path, outputs and messages stay the same.
- A `via: 'detector'` match must also pass the resolver's `clearOfOtherNames`, as a holder match does.
  Relax that only on sealed-set evidence.
- **Promotion (a separate step):** if the gate shows the detector at least level in every holder
  bucket, try proposals *before* the line search. A match then skips the 230 ms search, and a
  confident "no card" skips everything, which helps phones most. This is where the speed gain is, and
  it risks only rows that already pass, which the gate will show.

**Fallback.** No model, no WASM, a load failure, a thrown error, or a mask scoring below threshold or
failing the aspect check: no proposals, and today's pipeline runs unchanged. Three worker errors in a
row disable the detector for the session. Nothing else may depend on it.

### Effect on number and language reading

Modest, and only through the outline. The detector adds no pixels.

- **Helps:** the number band is 4.4% of the card's height, so a corner 1.5% off loses a third of it.
  Holder quads have been the least accurate, so holder cards should gain most. Text boxes are less
  sensitive.
- **Doesn't help:** glare, blur, or digit size. The 41 owner photos with art but no decision depend
  mainly on 4K, sharpness and the owner's rules.

## 3. Training

### Synthetic recipe

Each sample is a 2D composite, rendered at 480×640 and shrunk for pass 1, or cut round the card for
pass 2. A 3D renderer isn't needed; Blender is GPL and its plastic realism isn't the deciding factor.

1. **Card:** catalog art, EN and JA, every layout including full arts, rounded corners, slight bend.
   Card size 20–85% of frame width, covering both passes.
2. **Under and behind:** CC0 desk textures; a deck of other catalog cards, offset; distractors with
   straight edges (phones, books, card boxes, other loose cards).
3. **Holder, parametric:** sleeve; toploader with a coloured rim; magnetic case with a thick lip;
   slab with a clear frame and a generated fake label block. Sizes and colours range past the real
   ones. No real grader logos are needed.
4. **Plastic:** glare streaks and reflections from CC0 HDRIs over the card, which also covers text.
5. **Hands:** procedural finger capsules with skin tones and soft shadow, over sides and corners.
6. **Camera:** perspective tilt up to about 35°, lens distortion, defocus, motion blur, sensor noise,
   white balance, exposure, MJPEG blocks at quality 40–90, chroma subsampling, and shrink-then-enlarge
   to mimic each resolution. `scripts/scan/rarity/degrade.ts` is the starting point for ranges.
7. **Negatives, 15%:** empty desks, hands alone, card backs, decks face down. The output must be
   empty, so a confident "no card" means something.

**What makes it generalise:** randomising past reality so the real world is just one more variation;
real-life distractors; deliberately hard holders; heavy MJPEG, because the camera's compression is
the likeliest gap. Check the gap with a **cross-game test**: score synthetic Yu-Gi-Oh composites the
model never trained on. If it fails there, it learned the art and not the card.

The expected failure is that plastic glare or real fingers look unlike the synthetic ones. The real
dev set will show it, and the fix is to improve the recipe, not to add real photos.

### Validation and data rules

- **Train / val:** 10% of cards and of background textures held out of training entirely.
- **Real photos:** never in training, never in the repo, never on a rented machine. Checkpoint choice
  uses the real dev set locally (section 5). That is a small leak by design, and it's why a sealed set
  exists.
- Corpus lives outside the repo in `~/detector-corpus`, as `~/rarity-corpus` does. The generator and
  training scripts go in `scripts/scan/detector/`, and the corpus manifest records every texture's
  source and licence.
- Excluded: anything from simeydotme/pokemon-cards-css, and PokéCottage assets. Neither is needed.

### Licences

| piece | licence | status |
|---|---|---|
| ONNX Runtime Web | MIT | checked on npm |
| PyTorch | BSD-3 | from memory, confirm at pin |
| timm code and MobileNetV3 weights | Apache-2.0 | MobileNetV4 card checked; confirm the V3 card at pin |
| Poly Haven textures, HDRIs | CC0 | its FAQ; ambientCG likewise but from third parties, confirm |
| kornia, for augmentation | Apache-2.0 | from memory, confirm at pin |
| Albumentations | **avoid** | old MIT package unmaintained; its successor AlbumentationsX is AGPL or paid |
| Ultralytics models and weights | **avoid** | AGPL-3.0 or paid |
| MANO hand models and research hand datasets | **avoid** | I'd expect non-commercial terms; procedural hands avoid the question |

Pretrained encoder weights come from ImageNet, whose images have research-only terms even though the
weights are published under Apache-2.0. Common practice, not a settled question (section 7).

### Where, on what, how long, what it costs

**Rented RTX 4090 by the hour, default.** The owner's streaming and gaming are not touched, and it
needs no setup on this machine, which has no PyTorch installed.

| stage | time, *estimate* | cost at $0.34–0.69/h |
|---|---|---|
| Pilot: 5k composites, 1 h training, proves the pipeline | 1–2 h | ≤ $1.50 |
| Render 300k composites once | 3–5 h | $1–4 |
| One full training run | 4–8 h | $2–6 |
| Up to 4 runs, plus storage | | **$10–25 total; hard cap $40** |

Prices are 2026 market reports and vary; check at booking. GitHub-hosted GPU runners cost several
times more per hour (from memory, not checked) with no advantage for a long job, so CI is not used. Upload only downscaled catalog
art (about 2 GB, *estimate*). Delete the pod's volume after each run. Evaluation runs locally, on CPU,
at the same pace as a normal gate run with `--maxWorkers=2`, while the owner isn't streaming.

**Local fallback.** The RTX 4070 Ti (12 GB) is enough, at perhaps 1.5–2× the time:

- A timer window of about 02:00–09:00, in a container, capped to 8 cores and 12 GB of RAM.
- Power-limited, which needs `sudo nvidia-smi -pl`.
- Checkpoints every 15 minutes, and a watcher that stops the job if OBS or a game starts.

It's free, but a clash with an unplanned stream costs the owner far more than $25 saves.

## 4. Camera tiers

### Step zero: what does Chromium really get?

`ideal` constraints fall back silently. The owner needs to check this once, in the Electron scan
window and in the capture page, because no agent may open the camera:

- In DevTools, `track.getSettings()` and `track.getCapabilities()`, plus `video.videoWidth/Height`.
- `v4l2-ctl --list-formats-ext` for the MJPG list, and `lsusb -t` for link speed.
- Save one frame of a printed page and compare it to a 1080p frame. Is it real 4K detail or an
  upscale?

What to look for:

- **USB:** Insta360 lists the Link 2 Pro as **USB 2.0**, so a 480M link is expected, not a fault. 4K
  then rests on compression.
- **Format:** reports suggest Chromium on Linux takes MJPG or raw from V4L2 but not H264, though I
  found no current authority. If 4K is H264-only here, Chromium won't get it. Insta360's manual lists
  MJPEG too. Whether 4K30 MJPEG over USB 2.0 is sharp or heavily compressed is the real question.
- **OBS:** if the scan window reads a virtual camera while streaming, it gets the canvas size, likely
  1080p, whatever the sensor does. Only the owner knows the live setup.
- **Tracking:** AI tracking or zoom digitally crops. It should be off, and close focus is unverified.

### The measure

Frame size is the wrong input: a 4K camera with a small card can be worse than a 1080p camera with a
large one. Two numbers per frame with a card, from the quad and the warp:

- **`cardPx`:** the card's short side in *source* pixels (`shown` in `bandWidth`). Estimated digit
  height is about 0.019 × `cardPx`.
- **`edgeBlur`:** 10–90% rise width, in source pixels, across the art window's or card's printed edge.
  Cheap, and it catches what `cardPx` can't: soft focus, motion, MJPEG smear and upscaled "4K".

**`effectivePx` = `cardPx` / max(1, `edgeBlur` / 2).** Take the median over a showing's last 5 frames,
with 15% hysteresis so a shaking hand doesn't flip the tier. Both numbers go in `FrameSignals` for
Pokémon only, the way `slab` is left out for Yu-Gi-Oh.

### Tiers

Thresholds are provisional, to be set from the curve in section 5, not from these guesses.

| tier | `effectivePx` | digits, native | read | evidence | hint |
|---|---|---|---|---|---|
| **Too small** | < 260 | < 5 px | art only; skip OCR | art may narrow, never name alone beyond today's rules | "Move the card closer" |
| **Webcam** | 260–520 | 5–10 px | today's reads | exactly today's rules, the baseline | when art matches but undecided: "Move closer to read the number" |
| **Sharp** | 520–1000 | 10–19 px | as today, all bands | number may separate a reprint group, once proven | none |
| **Close** | > 1000 | > 19 px | as Sharp, up to MAX_BAND_SCALE | as Sharp; language reads get more weight only if proven | none |

- Sharpness hint: `cardPx` high but `effectivePx` a tier lower says "Hold steady", not "move closer".
  Moving closer past the focus limit makes things worse.
- **Direction of trust:** in lower tiers evidence is ignored or not attempted, so a tier can move a
  result towards unsure and never towards a name. Higher tiers may use evidence only after it holds at
  0 wrong on the sealed set. Tier rules that widen naming wait for that.
- One exception needs the owner: at Too small and Webcam, a number read names nothing reliable, so
  should it still veto the art (rule G)? See section 7.
- A camera note, once per session, not per frame: "This camera gives 1280×720; a closer card or a
  better camera reads more".

### Keeping phones and low-end webcams fast

Frame cost and card tier are separate.

- **Search stays at 640.** Same view, same search image, so 4K costs nothing there except copying
  pixels: about 14 MB per 4K crop against 3.5 MB at 1080p.
- **Pacing:** if `analyze` p50 passes 300 ms over 10 frames, `applyConstraints` drops the stream to
  1920×1080 for the session. A phone that can't afford 4K then runs as today, and the worker's
  behaviour is otherwise unchanged. Step 1 measures whether this is ever needed.
- **Low-end:** a 720p webcam shows up as a smaller `cardPx` and lands in Webcam or Too small. No code
  path depends on the camera's name or resolution.
- OCR skip at Too small saves work. Detector cost is independent of camera resolution.

### What stays fixed

- All Yu-Gi-Oh behaviour, keys, wire format and fingerprint file.
- CARD_W, the art hash, the fingerprint file, SEARCH_WIDTH for full frames, FRAME_MS.
- ART_MAX_DISTANCE, PKM_ART_MIN_MARGIN, the unseen-twin rule, the Chinese-stays-unsure rule.
- The art match as the only judge of a quad.

## 5. Evaluation

**Why a new set:** the current 0 wrong was tuned on the same photos, the 4K camera has no photos at
all, and these photos cannot fairly test a model whose checkpoints they helped pick.

### Replay at app framing

Add a `SCAN_PKM_CROP=1` mode to `scan-pkm-real.test.ts` that applies `centreCrop` first, and report
both. Default stays as is. `scan-real.test.ts` keeps its 183 rows as they are, as the no-regression
check, and gets its own crop run for information only.

### The new shoot

The owner shoots with `~/scan-capture` (the page lists 4K first). Check the saved JPEGs are 3840×2160
before starting, since the page also uses `ideal`. Keep the card in the central 3:4 part of the guide,
and hold it as on stream, not specially.

| group | shots | use | notes |
|---|---|---|---|
| Re-shoots of owner misses at 1080p | 40 | **dev** | same cards as the old set; includes reprint-group and language misses |
| Bare | 50 | 20 dev, 30 sealed | at least 10 over a deck, 10 with fingers over a side |
| Toploader | 50 | 20 dev, 30 sealed | |
| Slab | 30 | 10 dev, 20 sealed | |
| Case | 30 | 10 dev, 20 sealed | |
| **total** | **200** | 100 dev, 100 sealed | about 1–1.5 hours with card changes |

- **Split by card:** no card in both dev and sealed. Include EN, JA and some Chinese, so the rule that
  Chinese stays unsure is tested. Prefer at least 30 cards that have a same-art reprint.
- Labelling goes through the same route as `pkm-truth.owner.json`. The owner labels, or the builder
  labels and the owner checks a sample.
- **Sealed means sealed:** no one looks at it during tuning. It runs once per release candidate; a
  sealed failure means new dev work, and after two rounds, more photos.
- Also freeze 30% of the eBay set now, by card, as a second sealed set. It's contaminated for the
  classic finder, but clean for the detector.
- With 100 sealed shots and 0 wrong, the 95% upper bound on the wrong rate is about 3%. That is a
  useful check but no proof, so the gate needs 0 wrong and any wrong is looked at by hand.

### Comparing with the 1080p set

- **Same scene, lower resolution:** shrink each 4K shot to 1080p and 720p with INTER_AREA and JPEG at
  the camera's quality. The same photo then gives a paired result. It's a simulation: downscaled 4K is
  cleaner than a real 1080p stream, so its results run optimistic.
- **Same card, real camera:** the 40 re-shoots against their old 1080p rows. Different pose, so compare
  in aggregate. Report the sign test on discordant rows, and call anything under about 5 rows noise.
- **Do not** compare old and new sets as a single percentage. Different cards, different difficulty.
- **Read-rate curve:** number and language read rate against `effectivePx`, from the same shrunk
  copies. **This curve sets the tier thresholds.**

### Gates

| gate | when | pass |
|---|---|---|
| `scan-real` with `SCAN_REAL_DIR=~/scan-capture/shots` | every change | 183 rows identical to baseline: 117/147, 115 accepted, 0 accepted-wrong, 0/36 false accepts |
| `scan-accuracy-gate`, full `npm test` with `--maxWorkers=2` | every change | passes |
| Pokémon gate, whole-frame and cropped | every change | 0 wrong, per holder and source |
| Detector without its model | every change | Pokémon rows identical to the same build without the detector |
| Sealed 4K and sealed eBay | release candidate | 0 wrong; right rate reported as is |

Detector metrics on dev: "card in top art" per holder (no hand corners needed), plus about 40 hand
quads for corner error in percent of card width, using the 3b oracle's method.

## 6. Order of work, and what each step should gain

Effort assumes one builder and the owner's time where noted. Each step can stop the rest.

| # | step | who | expected gain | confidence |
|---|---|---|---|---|
| 0 | Check what Chromium gets (section 4) | owner, 10–20 min | Decides whether "4K" is real on this camera | certain to be useful |
| 1 | Replay gates at app framing; log frame cost at 4K | builder, under 1 day | New honest baseline. Could move owner right either way, by perhaps ±10 | direction unknown |
| 2 | Shoot the 200 | owner, 1–1.5 h | Enables all that follows | |
| 3 | Run today's code on the 4K set; plot the read-rate curve | builder, under 1 day | First direct answer to the owner's question. Guess: **+10 to +20** of the 41 undecided, in owner-set terms | low; depends on MJPEG sharpness |
| 4 | Runtime spike: ORT in the worker with an untrained model, on desktop and a real iPhone | builder, 1 day | Proves latency, size, CSP and node use in the gate. Stops the detector if the phone is over 2× budget | medium |
| 5 | `cardPx`, `edgeBlur`, tiers and hints, no trust changes | builder, 2–3 days | No gate gain. Better live behaviour: users move closer, which raises every read | medium |
| 6 | Synthetic generator, pilot, training | builder, 1–1.5 weeks with reviews | | |
| 7 | Detector behind `via: 'detector'`, after the classic finder | builder, 2–3 days | Of 27 art-missing owner photos, finds 15–22, of which **+8 to +15** end up right | medium-low; sim-to-real for plastic is the risk |
| 8 | Promote to first, if level in all buckets | builder, 1–2 days | Faster: failing frames drop from seconds towards the 300 ms range. Small accuracy gain on C-class picks | medium |
| 9 | Widen trust only where the sealed set supports it | builder, plus owner's calls | Number for reprint groups (12 owner, 105 combined at most); depends wholly on step 3 | low |
| 10 | Sealed run, then release to the owner | | Honest figures | |

Stops:

- **After step 0:** if the camera can't deliver real 4K, step 3 becomes 1080p-closer: the tiers and
  "move closer" still apply, and the same shots work.
- **After step 3:** if 4K shows no read gain, drop step 9. Step 7 stands on its own.
- **After step 7:** if the detector finds fewer than half the art-missing dev photos, or any wrong
  can't be fixed by a guard, it stays off. It costs a download, not a regression, and the classic
  finder is unchanged.

**Honest total.** From 104/172 owner, adding 8–15 from detection and 10–20 from 4K gives about 122–139
(71–81%), against 147 needed. These are guesses that may overlap, and step 1 can move the starting
point. The owner's rule G adds up to +5. **The 85% bar is not a safe promise from this work.**

The combined bar is further off, and camera work does nothing for eBay photos. Its big levers are
reprint groups (105) and the 80 cards with no artwork.

## 7. Questions only the owner can answer

1. **Camera check (step 0):** run it, and say whether the stream's scan window opens the real camera
   or an OBS virtual camera.
2. **Shoot 200 4K photos** (step 2), including 30 slabs and 30 cases. Are enough slabs and cases to
   hand, or does the mix need changing?
3. **Spending:** up to $40 on a rented GPU, which means uploading downscaled catalog art to a rented
   machine, deleted afterwards. Or the nightly capped local run instead, accepting the clash risk?
4. **ImageNet-pretrained encoder:** accept it (Apache-2.0 weights, common practice, images under
   research terms), or train from scratch on synthetic data, likely weaker on real photos?
5. **The bar:** which set does the 85% apply to from now on? I suggest the sealed 4K set at app
   framing, since that's what the product does. The old 1080p set stays as a regression check.
6. **Rule G by tier:** at the low tiers, may an unreliable number read that names nothing in the art
   group be ignored, rather than making the scan unsure? The holders design asked this for all frames;
   limiting it to low tiers is a narrower way to say yes.
7. **Hints on stream:** may "Move closer" and "Hold steady" show in the scan window while live, or
   only in the app's own panel and never the overlay?
8. **App size:** about 12 MB more in the installer for everyone, while only the owner uses it. Fine, or
   should the runtime also be a download until Pokémon opens up?

## Sources

- [Insta360 Link 2 Pro specs](https://www.insta360.com/specs/link2pro) (USB 2.0);
  [manual, photo and video formats](https://onlinemanual.insta360.com/link2cpro/en-us/specs/hardware/photo-video)
  (Link 2C Pro page; check the Link 2 Pro's)
- [ONNX Runtime Web on npm](https://npmjs.com/package/onnxruntime-web);
  [deployment and custom builds](https://onnxruntime.ai/docs/tutorials/web/deploy.html);
  [WASM size manifest](https://huggingface.co/janitr/experiments/blob/main/runtime/onnxruntime-web/RUNTIME_INFO.json);
  [WebGPU in major browsers](https://web.dev/blog/webgpu-supported-major-browsers?hl=zh-cn)
- [MobileNetV4 Conv Small on timm](https://huggingface.co/timm/mobilenetv4_conv_small.e2400_r224_in1k/raw/7249cacba963f438597f373327119b22f4d3a848/README.md);
  [MMPose licence](https://raw.githubusercontent.com/open-mmlab/mmpose/main/LICENSE);
  [Ultralytics package licence](https://anaconda.org/channels/cf-post-staging/packages/ultralytics/overview)
- [AlbumentationsX licensing](https://albumentations.ai/blog/2025/01-albumentationsx-dual-licensing/);
  [Poly Haven FAQ](https://polyhaven.com/faq)
- GPU prices: [RunPod vs Vast.ai 2026](https://www.spheron.network/blog/gpu-cloud-pricing-comparison-runpod-vs-vastai-2026/);
  [Vast.ai pricing](https://costbench.com/software/ai-gpu-cloud/vast-ai/)
- Chromium and V4L2, anecdotal:
  [NixOS thread](https://discourse.nixos.org/t/very-low-resolution-camera-in-some-programs-but-not-others/72695),
  [Level1Techs thread](https://forum.level1techs.com/t/webcam-capturing-at-640x360/171037),
  [Firefox bug 1789112](https://bugzilla.mozilla.org/show_bug.cgi?id=1789112)
