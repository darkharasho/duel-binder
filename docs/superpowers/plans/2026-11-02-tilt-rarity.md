# Tilt Rarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a scanned printing's code comes in two or more holo-type finishes, ask for a 2-second tilt over the camera, then pre-select the finish a corpus-trained classifier picks among that printing's real rarities. The row keeps "Check rarity".

**Architecture:** Shared pure code holds the finish map, the classifier and the feature extraction (`src/shared/scan/tilt.ts` and `tiltFeatures.ts`). The scan worker keeps straightened frames of the held card and computes features on request. `useScanLoop` holds the draft through a tilt. It counts it once, with the guess or with today's result. A fitting script, run on the private corpus outside the repo, writes `src/shared/scan/tiltModel.ts`, as `fit-look.ts` writes `lookModel.ts`.

**Tech Stack:** TypeScript, React, Electron renderer and Web Worker, Capacitor phone build, vitest, vite-bundled node scripts, jpeg-js.

**Spec:** `docs/superpowers/specs/2026-11-02-tilt-rarity-design.md`

## Global Constraints

- Work on `feat/tilt-rarity`, branched from `origin/main` (`183140f`). Never use local `main`, which has diverged.
- Run vitest with at most 2 workers, and only the touched tests: `npm test -- <paths>`. The script already passes `--maxWorkers=2`.
- No heavy synthetic test data. Never build 100k+ rows in vitest. Synthetic frames in tests: at most 8 at 421×614.
- No corpus material in the repo: no clips, frames, features, labels, clip keys, accuracy tables or corpus paths. That covers source, tests, comments and commit messages too. The only corpus-derived file is the generated `src/shared/scan/tiltModel.ts`, which holds coefficients.
- The repo lint forbids calling setState synchronously in an effect (`react-hooks` recommended rules). Use refs and event-time updates, as `useScanLoop` does.
- Match the surrounding comment style: plain sentences, a JSDoc line on each export, and why rather than what.
- The fitting script reads the private corpus only from paths given on its command line, outside the repo. Its report goes outside the repo. In this plan, `$TILT_CORPUS` and `$TILT_CLIPS` stand for the private corpus's frames and clips directories. Set them in your shell, and never write their values into the repo.
- The shipped coefficients file comes from actually running the fit (Task 4). Never hand-write it.
- Thresholds start at the spec's values: `TILT_MS = 2000`, `TILT_TIMEOUT_MS = 4000`, `TILT_FRAME_MS = 100`, `TILT_RETRY_MS = 500`, `TILT_MIN_FRAMES = 12`, `TILT_MAX_FRAMES = 40`.
- Prompt copy: overlay "Tilt the card"; status line "Tilt the card to read its rarity"; button "Skip".
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The card is lowered mid-tilt.** It is counted once, with today's rarity and flag, and the prompt goes. (Task 5)
2. **The user swaps in another card mid-tilt.** The held card is counted as today, and the new card is then scanned as normal, including its own tilt. (Task 5)
3. **Skip is pressed twice, or after the guess has already counted the card.** Nothing is counted twice, and the next card isn't skipped. (Task 5)
4. **The worker can't give a reading** (engine without tilt support, a rejected reading, or a worker crash mid-tilt). The card is counted as today, and no prompt is left on screen. (Task 5)
5. **Scanning is paused, or the set or game changes, mid-tilt.** The held card is counted exactly once, as today, and the frame store is cleared. (Task 5)

---

### Task 1: Finishes, when to tilt, and the pick

**Files:**
- Create: `src/shared/scan/tilt.ts`
- Modify: `src/shared/scan/thresholds.ts` (append the `TILT_*` constants after `AUTO_PHOTO_TRIES`)
- Modify: `src/renderer/src/features/scan/resolve.ts` (after `describeLook`)
- Test: `tests/main/scan-tilt.test.ts`, `tests/renderer/scan-resolve.test.ts`

**Interfaces:**
- Produces, from `src/shared/scan/tilt.ts`:

```ts
export interface TiltPair {
  a: string
  b: string
  /** Indices into TiltModel.features: the k this pair reads. */
  use: readonly number[]
  /** Standardizing over `use`, from the pair's training clips. */
  mean: readonly number[]
  spread: readonly number[]
  /** Each class's centroid, standardized, over `use`. */
  ca: readonly number[]
  cb: readonly number[]
}
export interface TiltModel {
  features: readonly string[]
  /** Finishes, as tiltFinish names them. */
  classes: readonly string[]
  pairs: readonly TiltPair[]
}
export function tiltFinish(game: GameId, rarity: string): string
export function isHoloType(game: GameId, finish: string): boolean
/** The known finishes among `rarities` to pick from, or null when no tilt is due. */
export function tiltFinishes(game: GameId, rarities: readonly string[], model: TiltModel): string[] | null
export function pickByTilt(model: TiltModel, features: readonly number[], finishes: readonly string[]): { finish: string; margin: number } | null
```

- Produces, from `thresholds.ts`: `TILT_MS`, `TILT_TIMEOUT_MS`, `TILT_FRAME_MS`, `TILT_RETRY_MS`, `TILT_MIN_FRAMES`, `TILT_MAX_FRAMES`, `TILT_MIN_MOTION`. Set `TILT_MIN_MOTION = 0` for now; Task 4 sets it.
- Produces, from `resolve.ts`:

```ts
/** The printings a tilt picks among: lookOptions for Yu-Gi-Oh!, the card's own versions for Pokémon. */
export function tiltOptions(item: ScanDraft): ScanPrinting[]
/** The finishes to tilt for, or null when the draft gets no tilt (the spec's five conditions). */
export function tiltChoicesFor(item: ScanDraft, defaultRarity: string | null, model: TiltModel | undefined): string[] | null
/** The draft on the printing of `finish`, flagged check-rarity. */
export function withRarityByTilt(item: ScanDraft, finish: string): ScanDraft
```

- [ ] **Step 1: Write the failing tests**

In `tests/main/scan-tilt.test.ts`:

```ts
it('maps catalog rarities to finishes', () => {
  expect(tiltFinish('ygo', 'Ultra Rare (Alternate Art)')).toBe('Ultra Rare')
  expect(tiltFinish('pkm', '1st Edition Holofoil')).toBe('Holofoil')
  expect(tiltFinish('pkm', 'Set Logo Reverse Holofoil')).toBe('Reverse Holofoil')
  expect(tiltFinish('pkm', 'Shadowless Normal')).toBe('Normal')
  expect(tiltFinish('pkm', '1st Edition')).toBe('Normal')
  expect(tiltFinish('pkm', 'Poke Ball Pattern')).toBe('Poke Ball Pattern')
})
it('names holo-type finishes per game', () => {
  for (const r of ['Common', 'Rare', 'Short Print', 'Rare (Purple)', 'Kaiba Corporation Rare'])
    expect(isHoloType('ygo', tiltFinish('ygo', r))).toBe(false)
  for (const r of ['Super Rare', 'Ultra Rare', 'Secret Rare', 'Prismatic Secret Rare', 'Starfoil Rare', 'PlScR'])
    expect(isHoloType('ygo', tiltFinish('ygo', r))).toBe(true)
  for (const r of ['Normal', 'Reverse Holofoil', 'Poke Ball Pattern', 'Master Ball Pattern'])
    expect(isHoloType('pkm', tiltFinish('pkm', r))).toBe(false)
  for (const r of ['Holofoil', 'Cosmos Holo', 'Cracked Ice Holo'])
    expect(isHoloType('pkm', tiltFinish('pkm', r))).toBe(true)
})
// MODEL: classes Common, Super Rare, Ultra Rare, Secret Rare, Normal, Holofoil, Reverse Holofoil, Cosmos Holo,
// and a pair for each two of them reading feature 0 (spread 1, mean 0, centroids at each class's index)
it('tilts only for two known holo-type finishes', () => {
  expect(tiltFinishes('ygo', ['Common', 'Rare'], MODEL)).toBeNull()
  expect(tiltFinishes('ygo', ['Common', 'Ultra Rare'], MODEL)).toBeNull()
  expect(tiltFinishes('ygo', ['Super Rare', 'Ultimate Rare'], MODEL)).toBeNull() // Ultimate unknown
  expect(tiltFinishes('ygo', ['Common', 'Super Rare', 'Ultra Rare'], MODEL)).toEqual(['Common', 'Super Rare', 'Ultra Rare'])
  expect(tiltFinishes('ygo', ['Ultra Rare', 'Ultra Rare (Overframe)', 'Secret Rare'], MODEL)).toBeNull()
  expect(tiltFinishes('pkm', ['Normal', 'Reverse Holofoil'], MODEL)).toBeNull()
  expect(tiltFinishes('pkm', ['Holofoil', 'Reverse Holofoil'], MODEL)).toBeNull()
  expect(tiltFinishes('pkm', ['Holofoil', 'Cosmos Holo', 'Master Ball Pattern'], MODEL)).toEqual(['Holofoil', 'Cosmos Holo'])
})
it('picks only among the given finishes', () => {
  // A feature nearest Secret Rare's centroid, but Secret Rare isn't an option.
  expect(pickByTilt(MODEL, [at('Secret Rare')], ['Super Rare', 'Ultra Rare'])?.finish).toBe('Ultra Rare')
  expect(pickByTilt(MODEL, [at('Super Rare')], ['Super Rare'])).toBeNull()
})
it('a three-way pick goes to the finish that wins most pairs', () => {
  expect(pickByTilt(MODEL, [at('Ultra Rare')], ['Common', 'Super Rare', 'Ultra Rare'])?.finish).toBe('Ultra Rare')
})
```

In `tests/renderer/scan-resolve.test.ts`, under a new `describe('tilt', ...)`:

```ts
it('no tilt under a default rarity, for a best guess, or once the rules settled it', () => {
  expect(tiltChoicesFor(draftOf(['Super Rare', 'Ultra Rare']), 'Super Rare', MODEL)).toBeNull()
  expect(tiltChoicesFor({ ...draftOf(['Super Rare', 'Ultra Rare']), guess: true }, null, MODEL)).toBeNull()
  expect(tiltChoicesFor({ ...draftOf(['Super Rare', 'Ultra Rare']), flag: null }, null, MODEL)).toBeNull()
  expect(tiltChoicesFor(draftOf(['Super Rare', 'Ultra Rare']), null, undefined)).toBeNull()
})
it("a Pokémon card's versions tilt even when flagged pick-printing", () => {
  expect(tiltChoicesFor(pkmDraftOf(['Holofoil', 'Cosmos Holo'], 'pick-printing'), null, MODEL)).toEqual(['Holofoil', 'Cosmos Holo'])
})
it('the tilt guess moves the printing and keeps Check rarity', () => {
  const out = withRarityByTilt(draftOf(['Super Rare', 'Ultra Rare']), 'Ultra Rare')
  expect(out).toMatchObject({ rarity: 'Ultra Rare', flag: 'check-rarity' })
  expect(out.options.find((o) => o.printingId === out.printingId)?.rarity).toBe('Ultra Rare')
})
it('a guessed finish with stamped twins takes the unstamped version', () => {
  const out = withRarityByTilt(pkmDraftOf(['1st Edition Holofoil', 'Holofoil', 'Cosmos Holo'], 'check-rarity'), 'Holofoil')
  expect(out.rarity).toBe('Holofoil')
})
```

`draftOf(rarities)` builds a Yu-Gi-Oh! draft with one same-code printing per rarity (`printing()` from `tests/renderer/scanFakes.ts`), flagged `check-rarity`. `pkmDraftOf(versions, flag)` builds a Pokémon draft over one card's versions.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/main/scan-tilt.test.ts tests/renderer/scan-resolve.test.ts`
Expected: FAIL, because `../../src/shared/scan/tilt` can't be resolved and `tiltChoicesFor` is not exported.

- [ ] **Step 3: Implement**

- `tiltFinish`, Yu-Gi-Oh!: `rarityFamily`. Pokémon: "Reverse" anywhere means `Reverse Holofoil`. A label ending in "Pattern" is itself. Otherwise strip known stamp prefixes before "Holofoil" or "Normal". A bare stamp ("1st Edition", "Shadowless 1st Edition") is `Normal`.
- `isHoloType` uses the spec's plain lists (Yu-Gi-Oh!: a `Set` plus a `/^Rare\b/` test; Pokémon: Normal, Reverse Holofoil and anything ending in "Pattern" are not holo-type). Everything else is holo-type.
- `tiltFinishes` returns null when any rarity matches `/overframe|full art/i`. Otherwise it dedupes the finishes, keeps those in `model.classes`, and returns them in option order when at least two of the kept ones are holo-type.
- `pickByTilt` runs a round robin over the given finishes that are classes. For each pair found in `model.pairs` (either order), the nearer centroid wins, after standardizing `features[use[i]]` with the pair's mean and spread. Most wins is the guess; a tie goes to the larger summed margin. `margin` is the winner's summed margin. Return null for fewer than two finishes that are classes.
- `tiltChoicesFor` applies the spec's five conditions to `tiltOptions(item).map((p) => p.rarity)`.
- `withRarityByTilt` prefers a printing of `finish` that shows `item.imageId`, then the one whose rarity equals `finish` (unstamped), then the first. On Pokémon it also sets `setCode`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/main/scan-tilt.test.ts tests/renderer/scan-resolve.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/scan/tilt.ts src/shared/scan/thresholds.ts src/renderer/src/features/scan/resolve.ts tests/main/scan-tilt.test.ts tests/renderer/scan-resolve.test.ts
git commit -m "feat(scan): finishes, when a card is tilted, and the tilt pick"
```

---

### Task 2: Tilt features, shared by the worker and the fit

**Files:**
- Create: `src/shared/scan/tiltFeatures.ts`
- Test: `tests/main/scan-tilt-features.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:

```ts
export const TILT_W = 421
export const TILT_H = 614
/** The features a TiltModel reads, in vector order. */
export const TILT_FEATURES: readonly string[] // the 25 names, in the spec's order
export interface TiltReading {
  features: number[] // TILT_FEATURES order
  frames: number
  /** Mean |luminance change| on the art between aligned, exposure-matched frames, 0-255. */
  motion: number
}
/** An upright straightened card (any size, RGBA), box-shrunk to TILT_W x TILT_H RGB. */
export function shrinkCard(card: RgbaImage): Uint8Array
/** The tilt features over frames from shrinkCard, in time order; null for fewer than 3. */
export function tiltFeatures(frames: readonly Uint8Array[], game: GameId): TiltReading | null
```

- [ ] **Step 1: Write the failing tests**

```ts
it('lists the 25 features the tilt model is fitted on, in its fixed order', () => {
  expect(TILT_FEATURES).toEqual(['rxart','rxname','rxtext','rxborder','rxband','rhart','rhname','rhtext','rhborder','rhband','rxEntropy','rxTop','rxGold','rxColour','sp0','sp1','sp2','sp3','spAxis','spSkew','nameHueR','gFlow','artVsText','artVsBorder','textVsBorder'])
})
it('shrinks a card by box averaging', () => {
  const out = shrinkCard(solid(842, 1228, [200, 100, 50]))
  expect(out.length).toBe(TILT_W * TILT_H * 3)
  expect([out[0], out[1], out[2]]).toEqual([200, 100, 50])
})
it('a card that never moves reflects nothing', () => {
  const r = tiltFeatures(Array.from({ length: 6 }, () => printed()), 'ygo')!
  expect(r.motion).toBe(0)
  expect(r.features.slice(0, 10).every((v) => v === 0)).toBe(true)
  expect(r.features.every(Number.isFinite)).toBe(true)
})
it('light crossing the art reflects there and not on the text', () => {
  const r = tiltFeatures(Array.from({ length: 8 }, (_, t) => printed({ glintOnArtAt: t / 7 })), 'ygo')!
  const f = (n: string): number => r.features[TILT_FEATURES.indexOf(n)]
  expect(f('rxart')).toBeGreaterThan(f('rxtext'))
  expect(r.motion).toBeGreaterThan(0)
})
it('needs three frames', () => {
  expect(tiltFeatures([printed(), printed()], 'pkm')).toBeNull()
})
```

`printed()` is a 421×614 RGB frame with fixed texture, so alignment finds patches: a seeded checker plus noise. `glintOnArtAt` adds a bright diagonal band across the Yu-Gi-Oh! art box at that fraction. Keep it under 8 frames.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/main/scan-tilt-features.test.ts`
Expected: FAIL, because the module can't be resolved.

- [ ] **Step 3: Implement**

Port the spike's feature code, in the private corpus, into typed functions:

- `down` becomes `shrinkCard`; also port `matchPatch`, `fitAffine`, `align`, `expose`, `fft`, `reflection`, the region amplitude loop (only `Mean` per region and `HueR` for name) and gFlow.
- Copy the spike's regions, band boxes and exposure cells for each game.
- The reference frame is the middle frame. The grain gap is `min(3, T - 1)`.
- Derive the ratios as the spike does: `artVsText = artMean / max(1, textMean)`, `artVsBorder = rxart / max(1e-6, rxborder)`, `textVsBorder = rxtext / max(1e-6, rxborder)`.
- `motion` is the largest pair's mean absolute luminance change over the art box, after alignment and exposure.
- Drop the spike's rounding (`toFixed`). Don't read or mention any corpus path.

Header comment: what it measures and why, and that `scripts/scan/rarity/fit-tilt.ts` and the scan worker both run it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/main/scan-tilt-features.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/scan/tiltFeatures.ts tests/main/scan-tilt-features.test.ts
git commit -m "feat(scan): tilt features from a run of straightened frames"
```

---

### Task 3: The worker keeps tilt frames and reads them

**Files:**
- Create: `src/renderer/src/features/scan/vision/tiltFrames.ts`
- Modify: `src/renderer/src/features/scan/vision/analyze.ts` (trailing `wantUpright = false`; signals carry `upright` when set)
- Modify: `src/renderer/src/features/scan/vision/vision.worker.ts`
- Modify: `src/renderer/src/features/scan/engine.ts` (types, `analyze` opts, two methods)
- Modify: `tests/renderer/scanFakes.ts` (`tiltEngine`)
- Test: `tests/main/scan-tilt-frames.test.ts`, `tests/renderer/scan-engine.test.ts`

**Interfaces:**
- Consumes: `shrinkCard`, `tiltFeatures`, `TiltReading` (Task 2); `TILT_MAX_FRAMES`, `TILT_MS` (Task 1).
- Produces:

```ts
// vision/tiltFrames.ts
export interface TiltFrames {
  keep(card: RgbaImage, at: number): void
  /** The kept frames from the last ms before now, oldest first. */
  latest(ms: number, now: number): Uint8Array[]
  clear(): void
  readonly size: number
}
export function createTiltFrames(max?: number): TiltFrames // default TILT_MAX_FRAMES; drops the oldest past max

// engine.ts
// WorkerRequest 'frame' gains: tilt?: number[]  (keep this frame when art[0] is one of these images)
// WorkerRequest gains: { type: 'tiltReading'; id: number; game: GameId } | { type: 'tiltReset' }
// WorkerReply gains:   { type: 'tiltReading'; id: number; reading: TiltReading | null }
// FrameSignals and RawSignals gain: tiltKept?: boolean
// ScanEngine.analyze opts gain: tilt?: number[]
// ScanEngine gains (optional, like artDistance):
tiltReading?(game: GameId): Promise<TiltReading | null> // the latest TILT_MS of kept frames
tiltReset?(): void

// tests/renderer/scanFakes.ts
export function tiltEngine(frame: (n: number) => RawSignals | Error, reading: () => TiltReading | null | Error): FakeEngine
// analyze reports tiltKept: true whenever opts.tilt includes the frame's art[0].imageId
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/main/scan-tilt-frames.test.ts
it('keeps the latest frames up to its cap, oldest first', () => {
  const f = createTiltFrames(3)
  for (let t = 0; t < 5; t++) f.keep(solid(842, 1228, [t, t, t]), t * 100)
  expect(f.size).toBe(3)
  expect(f.latest(1000, 400).map((x) => x[0])).toEqual([2, 3, 4])
})
it('reads only the window asked for', () => {
  const f = createTiltFrames(10)
  for (let t = 0; t < 5; t++) f.keep(solid(842, 1228, [t, t, t]), t * 100)
  expect(f.latest(250, 400).map((x) => x[0])).toEqual([2, 3, 4])
  f.clear()
  expect(f.size).toBe(0)
})
```

In `tests/renderer/scan-engine.test.ts`, use the file's existing fake worker:

```ts
it('asks the worker for a tilt reading and resolves with it', async () => { /* posts { type: 'tiltReading', id, game }, replies reading */ })
it('a tilt reading rejects when the worker dies', async () => { /* as analyze does */ })
it('passes the tilt images with a frame', async () => { /* the posted frame message has tilt: [7] */ })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/main/scan-tilt-frames.test.ts tests/renderer/scan-engine.test.ts`
Expected: FAIL, because `createTiltFrames` doesn't exist and `tiltReading` isn't a function.

- [ ] **Step 3: Implement**

- `tiltFrames.ts`: a ring of `{ at, rgb: shrinkCard(card) }`.
- Worker, live `frame` with `tilt`: call `analyze(..., wantUpright = true)`. When `signals.upright` exists and `signals.art[0]` is in `msg.tilt`, call `keep(upright, performance.now())` and set `tiltKept: true`. Delete `upright` before `reply`, because it must never cross to the UI thread.
- `tiltReading`: run `tiltFeatures(store.latest(TILT_MS, performance.now()), msg.game)`.
- `tiltReset` and `init` clear the store.
- Engine: `tiltReading` follows `artDistance`'s waiter pattern, with its own reply type. `tiltReset` posts and doesn't wait.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/main/scan-tilt-frames.test.ts tests/renderer/scan-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/scan/vision/tiltFrames.ts src/renderer/src/features/scan/vision/analyze.ts src/renderer/src/features/scan/vision/vision.worker.ts src/renderer/src/features/scan/engine.ts tests/renderer/scanFakes.ts tests/main/scan-tilt-frames.test.ts tests/renderer/scan-engine.test.ts
git commit -m "feat(scan): the scan worker keeps a tilted card's frames and reads their features"
```

---

### Task 4: Fit the tilt model on the private corpus and generate tiltModel.ts

**Files:**
- Create: `scripts/scan/rarity/fit-tilt.ts`
- Create: `scripts/scan/rarity/tiltFit.ts` (pure fitting helpers, so they can be tested)
- Modify: `scripts/scan/rarity/vite.config.ts` (add the `'fit-tilt'` entry, and one line in the pipeline comment)
- Create (generated): `src/shared/scan/tiltModel.ts`
- Modify: `src/shared/scan/thresholds.ts` (set `TILT_MIN_MOTION` from the fit's output)
- Test: `tests/main/scan-tilt-fit.test.ts`

**Interfaces:**
- Consumes: `TiltModel`, `TiltPair`, `pickByTilt` (Task 1); `tiltFeatures`, `shrinkCard`, `TILT_FEATURES` (Task 2); `TILT_MS`, `TILT_FRAME_MS` (Task 1).
- Produces:

```ts
// scripts/scan/rarity/tiltFit.ts
export interface TiltRow { card: string; finish: string; x: number[] }
/** One pair: Fisher-ranked top k features, standardized over the pair's rows, two centroids. */
export function fitPair(rows: readonly TiltRow[], a: string, b: string, k: number): TiltPair
/** Every class with >= minClips rows from >= minCards cards, and a pair for each two of them. */
export function fitModel(rows: readonly TiltRow[], k: number, minClips?: number, minCards?: number): TiltModel // defaults 8, 5
/** Leave one card out: each card's rows scored by a model fitted without that card. */
export function heldOut(train: readonly TiltRow[], test: readonly TiltRow[], finishes: readonly string[], k: number): { right: number; total: number }
/** Indices of frames sampled every stepMs over windowMs from startMs; frame n is at n * 1000 / fps. */
export function windowFrames(ns: readonly number[], fps: number, startMs: number, windowMs: number, stepMs: number): number[]

// src/shared/scan/tiltModel.ts (generated)
export const TILT_MODELS: Partial<Record<GameId, TiltModel>>
```

- [ ] **Step 1: Write the failing tests** (toy rows only, a few dozen)

```ts
it('a pair reads the feature that separates it', () => {
  const rows = toy({ 'Super Rare': [0, 5], 'Ultra Rare': [3, 5] }, 6) // feature 0 separates, 1 doesn't
  expect(fitPair(rows, 'Super Rare', 'Ultra Rare', 1).use).toEqual([0])
})
it('leaves out a class with too few clips or cards', () => {
  const m = fitModel([...toy({ A: [0], B: [3] }, 10), ...toy({ C: [6] }, 3)], 1)
  expect(m.classes).toEqual(['A', 'B'])
  expect(m.pairs).toHaveLength(1)
})
it('held out by card, a separable toy scores every row right', () => {
  const rows = toy({ A: [0], B: [3] }, 8)
  expect(heldOut(rows, rows, ['A', 'B'], 1)).toEqual({ right: 16, total: 16 })
})
it('samples the runtime grid from 15 fps frames, ties to the earlier frame', () => {
  // grid 0,100,...,500 (end exclusive); frame n is at n * 66.7 ms
  expect(windowFrames([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 15, 0, 600, 100)).toEqual([0, 1, 3, 4, 6, 7])
})
it('skips a grid time with no frame within half a step', () => {
  // frame 3 (200 ms) was not straightened
  expect(windowFrames([0, 1, 2, 4, 5, 6, 7, 8, 9], 15, 0, 600, 100)).toEqual([0, 1, 4, 6, 7])
})
```

`toy(centres, perClass)` gives each row its own card id, and features at the class centre plus a small seeded jitter.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/main/scan-tilt-fit.test.ts`
Expected: FAIL, because the module can't be resolved.

- [ ] **Step 3: Implement the helpers and the script**

- `tiltFit.ts` ports the spike classifier's `stats`, `fit` (Fisher score, standardizing) and its leave-one-card-out evaluation. The output is `TiltPair` and `TiltModel`, and the pick is `pickByTilt`, so evaluation runs the shipped decision.
- `windowFrames` takes, for each grid time, the nearest frame not taken yet, within half a step (inclusive). A tie goes to the earlier frame.
- `fit-tilt.ts` has the flags `--frames <dir> --clips <features.jsonl> --labels <labels.jsonl> --cache <jsonl> --report <md> --write <ts> [--k 3] [--parity 20]`.
  - Process one clip at a time, so only one clip's frames are in memory.
  - Map labels to finishes as the spec says. Drop Gold Rare, EX, V, VMAX, VSTAR, Shiny and Amazing Rare. The camera comes from labels (`source === 'phone'`).
  - Training rows: every `TILT_MS` window starting on a `TILT_MS / 2` step. Test row: the first full window.
  - `--cache` stores rows per window, so refits skip decoding.
  - `--parity N` runs `tiltFeatures` over all of N clips' frames and prints the largest relative difference against the `--clips` file's values, per feature.
  - The report covers every pair per game: held out by card on webcam, phone and pooled; each holder; and the 10th percentile of `motion` over webcam windows.
  - `--write` emits `tiltModel.ts` with a header naming the script and the flags. It must hold no keys, labels or numbers other than the model.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/main/scan-tilt-fit.test.ts`
Expected: PASS

- [ ] **Step 5: Run the parity check against the corpus**

```bash
npx vite build --config scripts/scan/rarity/vite.config.ts
node --max-old-space-size=2000 out/rarity/fit-tilt.mjs --frames $TILT_CORPUS --clips <the spike's features file> --labels <the clips' labels file> --parity 20
```

Expected: every feature within 0.01 relative (or 0.01 absolute) of the `--clips` file's values. If not, fix the port in `tiltFeatures.ts` (Task 2's tests must still pass) before fitting.

- [ ] **Step 6: Run the fit and generate the model**

```bash
node --max-old-space-size=2000 out/rarity/fit-tilt.mjs --frames $TILT_CORPUS --clips <the spike's features file> --labels <the clips' labels file> --cache <a rows file outside the repo> --report <a report outside the repo> --write src/shared/scan/tiltModel.ts
npx prettier --write src/shared/scan/tiltModel.ts
```

Expected: the report exists outside the repo, and `tiltModel.ts` has a `ygo` and a `pkm` entry. Set `TILT_MIN_MOTION` in `thresholds.ts` to the reported webcam 10th percentile, with a one-line comment on how it was chosen. Leave out the figure's source path.

- [ ] **Step 7: Check that no corpus material went in**

Run: `git add -N . && git grep -nE "rarity-corp[u]s|scan-captur[e]|clip_[0-9]{5}" -- .` (the brackets keep this plan from matching itself)
Expected: no matches anywhere in the tree. The `fit-tilt.ts` usage comment names flags, not paths. `tiltModel.ts` holds only the model.

- [ ] **Step 8: Typecheck, lint and commit**

Run: `npm run typecheck:node && npm run typecheck:web && npx eslint scripts/scan/rarity src/shared/scan/tiltModel.ts`
Expected: no errors.

```bash
git add scripts/scan/rarity/fit-tilt.ts scripts/scan/rarity/tiltFit.ts scripts/scan/rarity/vite.config.ts src/shared/scan/tiltModel.ts src/shared/scan/thresholds.ts tests/main/scan-tilt-fit.test.ts
git commit -m "feat(scan): fit the tilt model on private clips; ship its coefficients"
```

---

### Task 5: The scan loop holds a card for its tilt

**Files:**
- Modify: `src/shared/scanWindow.ts` (`ScanStatus` gains `{ kind: 'tilt'; name: string }`; `ToScanWindow` gains `{ kind: 'skipTilt' }`)
- Modify: `src/renderer/src/features/scan/scanText.ts` (`'tilt'` → "Tilt the card to read its rarity")
- Modify: `src/renderer/src/features/scan/useScanLoop.ts`
- Modify: `src/renderer/src/features/scan/window/ScanWindowApp.tsx` (`tiltModels` prop, default `TILT_MODELS`; handles `skipTilt`)
- Test: `tests/renderer/scan-window.test.tsx`

**Interfaces:**
- Consumes: `tiltChoicesFor`, `withRarityByTilt`, `pickByTilt` (Task 1); `ScanEngine.tiltReading` / `tiltReset` and `analyze({ tilt })`, plus `tiltEngine` (Task 3); `TILT_MODELS` (Task 4).
- Produces:

```ts
// ScanLoopOptions gains:
/** Tilt models by game; a game without one, or a scanner without them (Stream), never tilts. */
tiltModels?: Partial<Record<GameId, TiltModel>> | null
// ScanLoop gains:
/** Ends a tilt now; the card counts as it would have without one. */
skipTilt: () => void
```

- [ ] **Step 1: Write the failing tests** (in `describe('Scan window tilt', ...)`, with `tiltEngine` and a toy `TiltModel` passed as `tiltModels`)

```ts
it('a code with Super and Ultra holds the card and asks for a tilt', async () => {
  // codeFrame('LOB-EN005') with printingsByCode -> Super Rare and Ultra Rare
  await run(1000)
  expect(lastState().loop).toEqual({ kind: 'tilt', name: 'Dark Magician' })
  expect(drafts()).toHaveLength(0)
})
it('a usable reading pre-selects its guess and keeps Check rarity', async () => {
  // reading: features nearest Ultra Rare, frames 20, motion 50
  await run(1000 + TILT_MS + 200)
  expect(drafts()).toEqual([expect.objectContaining({ rarity: 'Ultra Rare', flag: 'check-rarity' })])
})
it('Common against one foil asks for no tilt', async () => { /* Common, Ultra Rare -> counted at once, no 'tilt' state ever sent */ })
it('no usable tilt in TILT_TIMEOUT_MS counts the card as today', async () => {
  // reading: frames 4 every time
  await run(1000 + TILT_TIMEOUT_MS + 200)
  expect(drafts()).toEqual([expect.objectContaining({ rarity: 'Super Rare', flag: 'check-rarity' })])
})
it('Skip counts the card as today, once, even pressed twice', async () => {
  act(() => bridge.emit({ kind: 'skipTilt' })); act(() => bridge.emit({ kind: 'skipTilt' }))
  await run(TILT_TIMEOUT_MS)
  expect(drafts()).toHaveLength(1)
})
it('a Skip after the guess counted changes nothing and skips no next card', async () => { /* guess counts, skipTilt, a second card's tilt still runs */ })
it('a card lowered mid-tilt counts once as today', async () => { /* frames turn NOTHING after the prompt; after ABSENT_MS one draft, Super Rare, state leaves 'tilt' */ })
it('another card mid-tilt counts the held one as today, then scans the new one', async () => { /* art[0] switches to another card's image; two drafts, the first as today */ })
it('a worker that fails the reading counts the card as today', async () => { /* reading throws; one draft; tiltReset called */ })
it('an engine without tilt support never asks for a tilt', async () => { /* fakeEngine without tiltReading: counted at once */ })
it('pausing mid-tilt counts the card once and clears the frames', async () => { /* settings({ paused: true }); one draft; tiltReset called */ })
it('under a default rarity no tilt is asked for', async () => { /* settings defaultRarity 'Super Rare' */ })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/renderer/scan-window.test.tsx`
Expected: the new tests FAIL (no `tilt` state; drafts counted at once), and the existing ones PASS.

- [ ] **Step 3: Implement**

In `useScanLoop`, a ref-held `l.tilt: { draft; finishes; since; lastSeen; nextRead } | null`, with no React state besides `status`.

- **Start.** After `tracker.push` returns a draft, when `tiltChoicesFor(draft, defaultRarity, tiltModels?.[game])` is non-null and `engine.tiltReading` exists: set `l.tilt`, set status `tilt`, and don't call `onDraft`.
- **Ticks while `l.tilt`:**
  - Frames come every `TILT_FRAME_MS`: while `l.tilt` is set, each tick ends by scheduling the next with `setTimeout(tick, TILT_FRAME_MS)`. The `FRAME_MS` interval's ticks are skipped while `l.busy`, so the two never overlap. Cleanup clears that timeout too.
  - Each tilt frame goes to `engine.analyze(frame, { candidates: cardImageIds, wantText: false, tilt: cardImageIds })`, with no `resolveSignals`.
  - `tiltKept` refreshes `lastSeen`. A frame whose top art is close (`ART_MAX_DISTANCE`) but another card's ends the tilt as "another card".
  - Over `ABSENT_MS` since `lastSeen` ends it as "lowered".
  - From `since + TILT_MS`, every `TILT_RETRY_MS`, call `tiltReading(game)`. A usable reading (`frames >= TILT_MIN_FRAMES && motion >= TILT_MIN_MOTION`) with a non-null `pickByTilt` ends it with `withRarityByTilt`.
  - `since + TILT_TIMEOUT_MS` ends it as today. So does a rejected reading.
- **End, always through one `endTilt(draft)`.** It clears `l.tilt` first, so a second Skip finds nothing. Then it calls `engine.tiltReset?.()`, `show(...)` and `onDraft(draft)`.
- `skipTilt`, the set, game or language reset effect and the `running` cleanup all call `endTilt` with the held draft as it is.
- In a dev build, log the reading's time and frame count once per tilt, as `lookLogged` does.

`ScanWindowApp` passes `tiltModels` (prop, default `TILT_MODELS`) and routes `skipTilt` to `loop.skipTilt`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/renderer/scan-window.test.tsx tests/renderer/auto-photo.test.ts tests/renderer/scan-session.test.ts`
Expected: PASS

- [ ] **Step 5: Lint, typecheck and commit**

Run: `npx eslint src/renderer/src/features/scan src/shared/scanWindow.ts && npm run typecheck:web`
Expected: no errors. In particular, no `react-hooks/set-state-in-effect`.

```bash
git add src/shared/scanWindow.ts src/renderer/src/features/scan/scanText.ts src/renderer/src/features/scan/useScanLoop.ts src/renderer/src/features/scan/window/ScanWindowApp.tsx tests/renderer/scan-window.test.tsx
git commit -m "feat(scan): hold a card with several foils for a tilt, then count it with the guess"
```

---

### Task 6: The prompt over the camera, Skip, and which scanners tilt

**Files:**
- Create: `src/renderer/src/features/scan/TiltPrompt.tsx`
- Modify: `src/renderer/src/features/scan/ScanViewport.tsx` (prompt with Skip while `loop.status.kind === 'tilt'`)
- Modify: `src/renderer/src/features/scan/window/ScanWindowApp.tsx` (prompt without a button)
- Modify: `src/renderer/src/features/scan/ScanHub.tsx` (`skipTilt()` sends `{ kind: 'skipTilt' }`)
- Modify: `src/renderer/src/features/scan/ScanPage.tsx` (Skip beside Take photo while `state.loop.kind === 'tilt'`)
- Modify: `src/renderer/src/features/scan/useHubScan.ts` (`tiltModels` option, default null)
- Modify: `src/renderer/src/features/scan/InPageScanner.tsx`, `src/phone/PhoneCamera.tsx` (pass `TILT_MODELS`; `PhoneCamera` gets a `tiltModels` prop for tests, like `lookModel`)
- Test: `tests/renderer/scan-window.test.tsx`, `tests/renderer/scan-page.test.tsx`, `tests/renderer/phone-scanner.test.tsx`

**Interfaces:**
- Consumes: `ScanStatus` `'tilt'`, `ScanLoop.skipTilt`, `ScanLoopOptions.tiltModels` (Task 5); `TILT_MODELS` (Task 4).
- Produces:

```ts
/** "Tilt the card" over the camera while a card is held for its tilt; Skip when onSkip is given. */
export function TiltPrompt({ name, onSkip }: { name: string; onSkip?: () => void }): React.JSX.Element
// ScanHub gains: skipTilt(): void
// useHubScan options gain: tiltModels?: Partial<Record<GameId, TiltModel>> | null
```

- [ ] **Step 1: Write the failing tests**

```ts
// scan-window.test.tsx
it('the scan window shows no tilt prompt, so a stream never captures one', async () => {
  // a tilt in progress (owner's ruling: no prompt on the captured window)
  expect(screen.queryByText(/Tilt the card/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
})
// scan-page.test.tsx
it("Skip shows while the scan window's card is held for a tilt, and sends skipTilt", async () => {
  // emit state with loop { kind: 'tilt', name: 'Dark Magician' }
  await user.click(screen.getByRole('button', { name: 'Skip' }))
  expect(bridge.sent).toContainEqual({ kind: 'skipTilt' })
})
// phone-scanner.test.tsx
it('the phone shows the tilt prompt with Skip, and Skip counts the card', async () => { /* PhoneCamera with tiltEngine and a toy tiltModels */ })
it('the phone scanner tilts with the shipped models by default', () => {
  // PhoneCamera rendered without tiltModels: useHubScan received TILT_MODELS (spy on the module, as the lookModel test does)
})
it('useHubScan never tilts unless given tilt models', async () => { /* useHubScan without tiltModels, a Super/Ultra code: counted at once, status never 'tilt' */ })
```

The last test pins Stream mode, which calls `useHubScan` without `tiltModels`. If PR #153 is on `main` by now, also add to its `StreamCamera` test: "Stream mode never shows the tilt prompt".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/renderer/scan-window.test.tsx tests/renderer/scan-page.test.tsx tests/renderer/phone-scanner.test.tsx`
Expected: the new tests FAIL, because there is no "Tilt the card" text and no Skip button.

- [ ] **Step 3: Implement**

- `TiltPrompt` takes `PullOverlay`'s `Bar` look: glass, `bg-black/45`, `backdrop-blur-xl`, `role="status"`, and vw-clamped sizes so it scales in the scan window. The container is `pointer-events-none`; Skip is `pointer-events-auto`. It shows "Tilt the card" and the card's name, with no animation loop that would run while idle.
- `ScanViewport` renders it above the status bar.
- `ScanWindowApp` renders it beside `PullOverlay` while `loop.status.kind === 'tilt'`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/renderer/scan-window.test.tsx tests/renderer/scan-page.test.tsx tests/renderer/phone-scanner.test.tsx tests/renderer/phone-layout.test.tsx`
Expected: PASS

- [ ] **Step 5: Lint, typecheck and commit**

Run: `npx eslint src/renderer/src/features/scan src/phone && npm run typecheck:web && npm run typecheck:phone`
Expected: no errors.

```bash
git add src/renderer/src/features/scan/TiltPrompt.tsx src/renderer/src/features/scan/ScanViewport.tsx src/renderer/src/features/scan/window/ScanWindowApp.tsx src/renderer/src/features/scan/ScanHub.tsx src/renderer/src/features/scan/ScanPage.tsx src/renderer/src/features/scan/useHubScan.ts src/renderer/src/features/scan/InPageScanner.tsx src/phone/PhoneCamera.tsx tests/renderer/scan-window.test.tsx tests/renderer/scan-page.test.tsx tests/renderer/phone-scanner.test.tsx
git commit -m "feat(scan): Tilt the card prompt over the camera, with Skip, on desktop and phone"
```

---

### Task 7: Measure held-out accuracy and draft the PR description (no repo changes)

**Files:**
- Create, outside the repo: a PR description draft in the private corpus
- No repo file changes. If a measurement forces a threshold change, go back to the owning task, refit (Task 4, Step 6) and commit there.

**Interfaces:**
- Consumes: `out/rarity/fit-tilt.mjs` and its `--report` (Task 4); the dev-build tilt log line (Task 5).

- [ ] **Step 1: Re-run the held-out report on the committed model's settings**

Run the Task 4, Step 6 command with `--cache` and `--report` (both outside the repo), without `--write`.
Expected: `git status` shows no change in the repo, and the report lists per-pair held-out accuracy for webcam, phone and pooled.

- [ ] **Step 2: Measure the realized tilt frame rate and reading time**

Run `npm run dev`. With the desktop scan window and a webcam, scan a Super/Ultra code card and tilt it. Read the dev log line (frames, ms) three times. Do the same in the phone build if a device is to hand. Otherwise say so in the draft.
Expected: reading time under 1 s on desktop. If frames per window fall below `TILT_MIN_FRAMES`, note it. It means `TILT_FRAME_MS` or `TILT_MIN_FRAMES` should change, followed by a refit.

- [ ] **Step 3: Write the PR description draft outside the repo**

The draft holds:

- the summary, with the decisions copied from the spec
- a table of held-out accuracy by card, with baseline, per pair:
  - Yu-Gi-Oh!: Super/Ultra, Super/Secret, Ultra/Secret, Secret/Prismatic, Common vs each foil
  - Pokémon: Holo/Cosmos, plus the reverse pairs a three-way pick meets
- each row split into webcam, phone and pooled, with clip and card counts
- the realized frame rate and reading time
- the classes left out for too few clips
- the test plan
- the closing line "🤖 Generated with [Claude Code](https://claude.com/claude-code)"

No clip keys and no corpus paths: the description is public on GitHub.

- [ ] **Step 4: Confirm the repo is clean of corpus material**

Run: `git grep -nE "rarity-corp[u]s|scan-captur[e]|clip_[0-9]{5}" HEAD -- . ; git log -p origin/main..HEAD | grep -cE "rarity-corp[u]s|scan-captur[e]|clip_[0-9]{5}" ; git status --short`
Expected: no grep matches, a count of 0, and a clean tree.
