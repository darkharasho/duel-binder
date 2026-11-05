# Rip Replay (release 1: art-only countdown) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Make replay** button that turns the night's best pulls into a muted countdown video of up to 30 s (MP4, GIF as a second choice) and saves it to the device. It sits at the end of phone Stream and beside "Show summary" on the desktop scan page.

**Architecture:** Pure functions pick the pulls (`pulls.ts`) and lay out a timeline (`timeline.ts`). One deterministic `drawReplayFrame(ctx, scene, t)` paints any moment onto a 720×900 canvas. Video comes from a `MediaRecorder` on `canvas.captureStream(30)`, driven in real time. GIF steps the same draw function frame by frame into `gifenc`. Art is loaded with `fetch` → `createImageBitmap`, so the canvas is never tainted. Saving goes through a desktop IPC save dialog, a native share sheet in the apps, or Web Share/download on phone web.

**Tech Stack:** React 19 + TypeScript, Canvas 2D, MediaRecorder, `gifenc` (new dependency), Electron IPC, Capacitor 8 local plugins (Swift/Java), Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-11-05-rip-replay-design.md`

## Global Constraints

- Pulls: priced at **$1.00 or more** (`REPLAY_MIN_PRICE = 1`), **at most 8** (`REPLAY_MAX_PULLS = 8`), price only, every game. `priceOf(row)` is one copy's price; unpriced and `row.guess` never count.
- Order shown: cheapest first, best (dearest) last. Ties: earlier `addedAt` first.
- Length ≤ 30 s. Muted: no audio track.
- Output ≤ **10 MB**. MP4 (H.264) preferred, WebM fallback, GIF on request.
- 4:5 frame, 720×900.
- Phone: Stream only (not the regular scanner). Desktop: the main window's scan page, next to "Show summary". Never in the captured scan window.
- Nothing is uploaded. Rendering is on the device.
- Camera moments are **out of scope** for this plan (release 2).
- Tests: `npm test -- tests/renderer/<file>` (the script already caps `--maxWorkers=2`). Never run the full suite while the machine is under memory pressure; run single files.
- Copy rules: plain words. Button "Make replay"; disabled reason "No pulls to replay".

## Review Focus

1. **A night with one qualifying pull:** the replay is that pull alone, held as the best (5.5 s), then the end card. No "#1 of 1" oddities, no empty slots. *Pinned in Task 2.*
2. **Art that fails to load** (offline, 404, a CORS refusal): that pull is dropped and the rank renumbers. If every pull fails, say "Couldn't load the card art" instead of saving an empty video. *Pinned in Task 4.*
3. **A row with quantity 3:** one entry captioned "×3". Price is one copy's price, not ×3. *Pinned in Task 1.*
4. **A platform with no MP4 MediaRecorder** (older WebView): WebM is picked, and the file gets a `.webm` name. With no MediaRecorder at all, the video choice is hidden and only GIF is offered. *Pinned in Task 5.*
5. **Leaving the summary mid-render** (tap Done on phone, or close the scan page): recording stops, nothing is saved, and no error toast shows. *Pinned in Task 7.*

---

## File Structure

All new replay code lives in `src/renderer/src/features/scan/replay/`. The phone imports it through `@/` like the rest of the scan code.

| File | Responsibility |
|---|---|
| `replay/pulls.ts` | `pickReplayPulls`, `replayHeader` (pure) |
| `replay/timeline.ts` | segment timing and `frameAt` (pure) |
| `replay/draw.ts` | `drawReplayFrame`, the look |
| `replay/art.ts` | art URL per pull, load to `ImageBitmap`, drop failures |
| `replay/encode.ts` | `pickVideoType`, `recordVideo`, `encodeGif` |
| `replay/save.ts` | `saveReplay` per platform |
| `replay/MakeReplay.tsx` | button, format menu, progress, errors |
| `src/main/index.ts`, `src/main/ipc/handlers.ts`, `src/shared/ipc.ts`, `src/phone/api.ts`, `src/renderer/src/web/httpApi.ts` | `app.saveReplay` IPC |
| `ios/App/App/StreamPlugin.swift`, `android/.../StreamPlugin.java`, `src/phone/stream/device.ts` | native `shareFile` |
| `src/phone/stream/StreamScreen.tsx`, `src/renderer/src/features/scan/ScanPage.tsx` | mount the button |

---

### Task 1: Pick the pulls and the header line

**Files:**
- Create: `src/renderer/src/features/scan/replay/pulls.ts`
- Test: `tests/renderer/replay-pulls.test.ts`

**Interfaces:**
- Consumes: `ScanRow` (`@/features/scan/session`), `priceOf`, `photoFor`, `listValue` (`@/features/scan/scanLook`), `formatUsd` (`@/lib/format`).
- Produces:
  ```ts
  export const REPLAY_MIN_PRICE = 1
  export const REPLAY_MAX_PULLS = 8
  export interface ReplayPull {
    key: string; name: string; imageId: number; photoId: number | null
    rarity: string | null; setCode: string | null
    price: number; quantity: number; addedAt: number
  }
  /** Qualifying pulls in play order: cheapest first, dearest last. */
  export function pickReplayPulls(rows: ScanRow[]): ReplayPull[]
  /** "Nov 4 · 142 cards · $310": the date of the newest row, card count, list value. */
  export function replayHeader(rows: ScanRow[]): string
  ```
- Caption rarity: the selected printing option's `printedRarity` when present, else `row.rarity`. The selected option is `row.options.find(o => o.printingId === row.printingId)`.

- [ ] **Step 1: Write the failing tests.** Reuse the `row(price, over)` builder pattern from `tests/renderer/scan-summary.test.tsx`.
  - `keeps pulls at $1.00 and up, drops $0.99, unpriced and guesses`: rows priced 0.99, 1.00, null, 5 (guess: true), 3 → names of the 1.00 and 3 rows only.
  - `keeps the 8 dearest of 10, cheapest first`: prices 1..10 → prices `[3,4,5,6,7,8,9,10]`.
  - `breaks a price tie by pull order`: two $5 rows with addedAt 200 and 100 → the 100 one first.
  - `one entry per row with its quantity`: quantity 3 at $2 → one pull, `quantity: 3`, `price: 2`.
  - `uses the printed rarity when the printing has one`: option `printedRarity: 'Special Illustration Rare'`, row rarity 'Holo' → `'Special Illustration Rare'`.
  - `header names the newest row's date, cards and value`: two rows (qty 1 and 2, $10 and $5, newest addedAt = 2026-11-04 local) → `'Nov 4 · 3 cards · $20.00'` (use `formatUsd` for the value, so match its output exactly).
  - `empty list → []`.
- [ ] **Step 2: Run** `npm test -- tests/renderer/replay-pulls.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `pulls.ts`** with the interfaces above. Use `toLocaleDateString('en-US', { month: 'short', day: 'numeric' })` for the date and `plural` from `../scanText` for "card"/"cards".
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(replay): pick the night's pulls by price`.

### Task 2: Timeline

**Files:**
- Create: `src/renderer/src/features/scan/replay/timeline.ts`
- Test: `tests/renderer/replay-timeline.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PULL_MS = 3000, BEST_MS = 5500, END_MS = 2000, SLIDE_MS = 450
  export type ReplaySegment =
    | { kind: 'pull'; index: number; rank: number; of: number; start: number; end: number }
    | { kind: 'end'; start: number; end: number }
  export interface ReplayTimeline { segments: ReplaySegment[]; duration: number }
  export function replayTimeline(pullCount: number): ReplayTimeline
  /** The segment at t (ms) and progress 0..1 through it; t past the end clamps to the last frame. */
  export function frameAt(tl: ReplayTimeline, t: number): { segment: ReplaySegment; progress: number }
  ```
- `rank` counts down to 1: with 5 pulls, index 0 is rank 5 and the last is rank 1. `of` = pullCount. The last pull lasts `BEST_MS`, every other one `PULL_MS`, then one `end` segment.

- [ ] **Step 1: Write the failing tests:**
  - `8 pulls fit in 30 s`: `replayTimeline(8).duration === 7*3000 + 5500 + 2000` (28 500) and `<= 30000`.
  - `one pull is the best, held 5.5 s, then the end card`: `replayTimeline(1).segments` = `[{kind:'pull',index:0,rank:1,of:1,start:0,end:5500},{kind:'end',start:5500,end:7500}]`.
  - `ranks count down to 1`: `replayTimeline(3)` pull ranks `[3,2,1]`.
  - `frameAt clamps past the end`: `frameAt(tl, 99999)` → the end segment, progress 1.
  - `frameAt mid-segment`: `frameAt(replayTimeline(2), 1500)` → index 0, progress 0.5.
  - `zero pulls throws` (the caller never asks; this guards misuse): `expect(() => replayTimeline(0)).toThrow()`.
- [ ] **Step 2: Run** `npm test -- tests/renderer/replay-timeline.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(replay): countdown timeline`.

### Task 3: Draw a frame

**Files:**
- Create: `src/renderer/src/features/scan/replay/draw.ts`
- Test: `tests/renderer/replay-draw.test.ts`

**Interfaces:**
- Consumes: `ReplayPull` (Task 1), `ReplayTimeline`, `frameAt`, `SLIDE_MS` (Task 2), `formatUsd`.
- Produces:
  ```ts
  export const REPLAY_W = 720, REPLAY_H = 900
  export interface ReplayScene { pulls: ReplayPull[]; art: ImageBitmap[]; header: string; timeline: ReplayTimeline }
  export function drawReplayFrame(ctx: CanvasRenderingContext2D, scene: ReplayScene, t: number): void
  ```
  `art[i]` belongs to `pulls[i]`; the arrays are always the same length (Task 4 guarantees it).

The look, from mockup B in the spec:
- Backdrop: a radial gradient from `#2a1e4a` at the top centre to `#0d0a18`.
- Header chip top left (the `header` string); "#rank of N" top right in `rgba(255,255,255,0.56)`.
- Card: centred at 44 % height, 46 % of the width, card aspect 63:88, 8 px corner radius, drawn from `art[i]`, with a soft coloured glow behind it.
- Sheen: a diagonal white band (alpha 0.5) sweeping across the card every 2.2 s, clipped to the card.
- Motion: in over `SLIDE_MS` (rise 60 px, scale 0.8 → 1, fade in); out over the last `SLIDE_MS` (rise 40 px, scale → 0.9, fade out). The best pull also gets a brief white flash at its start (alpha 0.6 → 0 over 250 ms).
- Caption under the card: the rarity in uppercase gold `#ffd77a` with 0.06 em tracking; the name in bold white; then `formatUsd(price)`, plus ` · ×N` when `quantity > 1`. A caption with no rarity skips that line.
- End segment: the best pull (the last one) at 42 % width, with `"N hits · $total"` under it, where total = Σ price × quantity of the pulls shown.
- Watermark: "DUEL BINDER · RIP REPLAY" at the bottom centre, 11 px, alpha 0.38, on every frame.
- Font: `600 …px system-ui, sans-serif`.

- [ ] **Step 1: Write the failing tests** with a recording fake context (an object whose methods push `[name, ...args]` into an array, with `createLinearGradient`/`createRadialGradient` returning `{ addColorStop(){} }`; build it with a `Proxy`):
  - `draws the best pull's caption on its segment`: 2 pulls, `t` = middle of index 1 → `fillText` calls include the pull's name, `'$12.00'` and `'#1 of 2'`.
  - `shows ×3 for a triple`: quantity 3 → a `fillText` containing `'×3'`.
  - `draws the art bitmap for the current pull`: a `drawImage` call whose first argument is `art[1]`.
  - `end card tallies the hits`: `t` inside `end` with pulls $2 ×1 and $10 ×2 → `fillText` containing `'2 hits · $22.00'`.
  - `watermark on every frame`: `t` = 0 and `t` = end → both contain `'DUEL BINDER · RIP REPLAY'`.
- [ ] **Step 2: Run** `npm test -- tests/renderer/replay-draw.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `drawReplayFrame`.** Keep it free of time sources and randomness: same inputs, same calls.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Look at it.** Render 5 frames into a throwaway HTML page (or the SAI in-app renderer) with placeholder bitmaps, and compare with mockup B. Adjust spacing until it matches.
- [ ] **Step 6: Commit** `feat(replay): draw the countdown`.

### Task 4: Load the art

**Files:**
- Create: `src/renderer/src/features/scan/replay/art.ts`
- Test: `tests/renderer/replay-art.test.ts`

**Interfaces:**
- Consumes: `ReplayPull`; `cardImageSrc`, `printingImageSrc` (`@/lib/images`).
- Produces:
  ```ts
  /** The owner's printing photo when there is one (desktop only; null on phone), else the catalog's full art. */
  export function replayArtSrc(pull: ReplayPull): string
  /** Loads each pull's art; pulls whose art fails are dropped, so both arrays line up. */
  export function loadReplayArt(
    pulls: ReplayPull[],
    load?: (src: string) => Promise<ImageBitmap>
  ): Promise<{ pulls: ReplayPull[]; art: ImageBitmap[] }>
  ```
  The default `load` is `fetch(src)` → `res.ok` or throw → `createImageBitmap(await res.blob())`. Never use `<img>`: an image without CORS taints the canvas, and then `captureStream` records nothing. Load in parallel with `Promise.allSettled`, keeping the input order.

- [ ] **Step 1: Write the failing tests** with an injected `load`:
  - `drops a pull whose art fails and keeps order`: 3 pulls, the middle one rejects → 2 pulls, the first and third, with art in the same order.
  - `all fail → empty`: → `{ pulls: [], art: [] }`.
  - `prefers the printing photo on desktop`: with `photoId: 7` (default jsdom platform is desktop in `@/lib/platform`; check how other tests set it) → `replayArtSrc` equals `printingImageSrc(7)`; with `photoId: null` → `cardImageSrc('full', imageId)`.
- [ ] **Step 2: Run** `npm test -- tests/renderer/replay-art.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(replay): load card art without tainting the canvas`.

### Task 5: Encode video and GIF

**Files:**
- Create: `src/renderer/src/features/scan/replay/encode.ts`
- Modify: `package.json` (add `gifenc`)
- Test: `tests/renderer/replay-encode.test.ts`

**Interfaces:**
- Consumes: `ReplayScene`, `drawReplayFrame`, `REPLAY_W/H` (Task 3).
- Produces:
  ```ts
  export const MAX_BYTES = 10 * 1024 * 1024
  export type ReplayFormat = 'video' | 'gif'
  export interface VideoType { mime: string; ext: 'mp4' | 'webm' }
  /** First supported of mp4 avc1, plain mp4, webm vp9, webm; null when MediaRecorder is missing. */
  export function pickVideoType(isSupported?: (mime: string) => boolean): VideoType | null
  /** Plays the scene in real time onto a canvas and records it. onProgress(0..1). Rejects with AbortError when signal aborts. */
  export function recordVideo(scene: ReplayScene, type: VideoType, opts: { signal: AbortSignal; onProgress?: (p: number) => void }): Promise<Blob>
  /** Steps the scene frame by frame into a GIF; retries smaller when over MAX_BYTES. */
  export function encodeGif(scene: ReplayScene, opts: { signal: AbortSignal; onProgress?: (p: number) => void }): Promise<Blob>
  /** GIF attempts, largest first. */
  export const GIF_STEPS = [{ w: 360, h: 450, fps: 10 }, { w: 288, h: 360, fps: 8 }, { w: 240, h: 300, fps: 6 }]
  ```
- Video: `canvas.captureStream(30)` and `new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 2_000_000 })`. At 2 Mbps, 30 s is about 7.5 MB, under the limit. A `requestAnimationFrame` loop draws `drawReplayFrame(ctx, scene, performance.now() - start)` until `duration`, then stops the recorder. If the blob is over `MAX_BYTES`, record once more at 1 Mbps.
- GIF: `gifenc` (`GIFEncoder`, `quantize`, `applyPalette`) on an `OffscreenCanvas`, or a detached canvas where `OffscreenCanvas` is missing. Draw each frame scaled down from 720×900. Yield to the event loop (`await new Promise(r => setTimeout(r))`) every 5 frames so the UI stays live. If the result is over `MAX_BYTES`, try the next `GIF_STEPS` entry. Past the last one, throw `Error('The GIF came out too big')`.

- [ ] **Step 1: Write the failing tests:**
  - `prefers mp4 avc1`: `isSupported` true for everything → `{ mime: 'video/mp4;codecs=avc1', ext: 'mp4' }`.
  - `falls back to webm`: true only for strings starting `video/webm` → `ext: 'webm'`.
  - `null without MediaRecorder`: default `isSupported` with `globalThis.MediaRecorder` undefined → `null`.
  - `GIF steps down when too big`: mock `gifenc` with `vi.mock('gifenc')` so `bytes()` returns 11 MB on the first attempt and 1 MB on the second; give `drawReplayFrame` a stubbed context → resolves, and the encoder was created at 288×360 the second time.
  - `GIF gives up past the last step`: always 11 MB → rejects `/too big/`.
  - `abort stops the GIF`: abort before the call → rejects with `name === 'AbortError'`.
  - `recordVideo` itself isn't unit-tested (jsdom has no MediaRecorder or captureStream); it's checked on devices in Task 8.
- [ ] **Step 2: Run** `npm test -- tests/renderer/replay-encode.test.ts`. Expected: FAIL.
- [ ] **Step 3:** `npm install gifenc` (MIT, no dependencies). Add a `declare module 'gifenc'` shim in `src/renderer/src/globals.d.ts` (or the nearest existing `*.d.ts`) if it ships without types. Implement `encode.ts`.
- [ ] **Step 4: Run.** Expected: PASS. Then run `npm run typecheck` (or the repo's equivalent script in `package.json`). Expected: no errors.
- [ ] **Step 5: Commit** `feat(replay): record MP4/WebM and encode GIF under 10 MB`.

### Task 6: Save to the device

**Files:**
- Create: `src/renderer/src/features/scan/replay/save.ts`
- Modify: `src/shared/ipc.ts` (the `app` API interface near `backupDatabase` at :267, and the channel list near :436), `src/main/ipc/handlers.ts` (:47 and :220, beside `backupDatabase`), `src/main/index.ts` (`appDeps`, beside `backupDatabase` at :327), `src/phone/api.ts` (:340), `src/renderer/src/web/httpApi.ts` (:338), the preload if it lists channels explicitly
- Modify: `src/phone/stream/device.ts`, `ios/App/App/StreamPlugin.swift`, `android/app/src/main/java/**/StreamPlugin.java`
- Test: `tests/renderer/replay-save.test.ts`, plus the existing IPC wiring test if there is one (search `tests/main` for `app:backupDatabase` and follow it)

**Interfaces:**
- Produces:
  ```ts
  // src/shared/ipc.ts, app:
  /** Asks where to save a replay and writes it; the path, or null when cancelled. */
  saveReplay(name: string, data: Uint8Array): Promise<string | null>   // channel 'app:saveReplay'
  // src/phone/stream/device.ts:
  /** The apps' share sheet for a file (Save Video on iOS, any app on Android). Resolves when the sheet closes. */
  export function shareFile(name: string, mime: string, blob: Blob): Promise<void>
  // replay/save.ts:
  export type SaveResult = { saved: true; where: string | null } | { saved: false }
  export function saveReplay(blob: Blob, name: string): Promise<SaveResult>
  export function replayFileName(ext: string, now?: Date): string   // "rip-replay-2026-11-04.mp4"
  ```
- `saveReplay` branches like this:
  - Desktop (`!isPhone() && !isWeb()`): `api.app.saveReplay`.
  - Native app (`isNativeApp()`): `shareFile`.
  - Phone web: `navigator.canShare?.({ files: [file] })` → `navigator.share`. Otherwise an `<a download>` with an object URL, revoked after the click.
  - A cancelled share (`AbortError`) → `{ saved: false }`.
- Main: `dialog.showSaveDialog({ defaultPath: name, filters: [{ name: 'Video', extensions: [ext] }] })`, where ext comes from the name, then `writeFile`.
- Native `shareFile({ name, mime, base64 })`:
  - iOS: write to `FileManager.default.temporaryDirectory/name`, then present `UIActivityViewController` with the file URL on the main thread, with a popover anchor for iPad. Resolve on its completion handler.
  - Android: write to `getContext().getCacheDir()/name`. `FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file)` is already allowed by `file_paths.xml`'s `cache-path`. Then `ACTION_SEND` with `FLAG_GRANT_READ_URI_PERMISSION`, `Intent.createChooser`, and resolve right away.
  - Add `shareFile` to `pluginMethods` on iOS and `@PluginMethod` on Android.
  - JS: `blob` → base64 via `FileReader.readAsDataURL`, with the prefix stripped.

- [ ] **Step 1: Write the failing tests** (`replay-save.test.ts`):
  - `names the file by date`: `replayFileName('mp4', new Date(2026, 10, 4))` → `'rip-replay-2026-11-04.mp4'`.
  - `desktop saves through the app API`: the mock api `app.saveReplay` resolves `'/x.mp4'` → `{ saved: true, where: '/x.mp4' }`, called with the name and a `Uint8Array` of the blob's bytes.
  - `desktop cancel`: resolves `null` → `{ saved: false }`.
  - `phone web shares when it can`: stub `navigator.canShare` true and `navigator.share` resolved → `{ saved: true, where: null }`.
  - `phone web cancel is not an error`: `navigator.share` rejects `DOMException('', 'AbortError')` → `{ saved: false }`.
  - `phone web downloads when it can't share`: no `canShare` → an anchor with `download === name` was clicked.
  - Platform switching: follow how existing tests stub `@/lib/platform` and `@/lib/portal` (grep `vi.mock('@/lib/platform'` in `tests/renderer`).
- [ ] **Step 2: Run** `npm test -- tests/renderer/replay-save.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the IPC, `save.ts` and `shareFile` (JS side), then the Swift and Java methods.
- [ ] **Step 4: Run** the test file, then `npm run typecheck`. Expected: PASS, with no type errors.
- [ ] **Step 5: Compile the native side.** Android: `cd android && ./gradlew assembleDebug -Dorg.gradle.java.home=$HOME/Android/jdk-21`. Expected: BUILD SUCCESSFUL. iOS can't build on Linux: push the branch, open a PR, and check that the iOS CI job compiles (`gh pr checks`).
- [ ] **Step 6: Commit** `feat(replay): save replays on desktop, in the apps and on phone web`.

### Task 7: The Make replay button, on both screens

**Files:**
- Create: `src/renderer/src/features/scan/replay/MakeReplay.tsx`
- Modify: `src/phone/stream/StreamScreen.tsx` (the `phase === 'over'` button row, about :244, between Review and Done), `src/renderer/src/features/scan/ScanPage.tsx` (after the Show summary `Button`, about :202)
- Test: `tests/renderer/replay-button.test.tsx`; add one test each to `tests/renderer/phone-stream.test.tsx` and `tests/renderer/scan-page.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces:
  ```tsx
  export function MakeReplay(props: {
    rows: ScanRow[]
    /** Phone Stream's pill style or the desktop's outline Button. */
    variant: 'phone' | 'desktop'
    /** Injected in tests; defaults to the real pipeline. */
    make?: (rows: ScanRow[], format: ReplayFormat, opts: { signal: AbortSignal; onProgress: (p: number) => void }) => Promise<SaveResult>
  }): React.JSX.Element
  ```
- The default `make`: `pickReplayPulls` → `loadReplayArt` → if no pulls are left, throw `Error("Couldn't load the card art")` → build the scene with `replayHeader` and `replayTimeline` → `recordVideo`/`encodeGif` → `saveReplay(blob, replayFileName(ext))`.
- States and copy:
  - Idle: "Make replay". Disabled with `title`/visible hint "No pulls to replay" when `pickReplayPulls(rows)` is empty.
  - Format: a small menu beside it. Desktop uses the existing `DropdownMenu` (or `Select`); phone uses a second pill that toggles "MP4"/"GIF". Default 'video'. Hidden, forced to GIF, when `pickVideoType()` is null.
  - Working: "Making replay… 40%", disabled, with a Cancel link.
  - Done: a toast (use the app's existing toast helper; grep `toast(` in `src/renderer/src`) saying "Replay saved" (with the path on desktop). Nothing when the share was cancelled.
  - Error: a toast with the error's message.
- The component aborts its controller on unmount. An `AbortError` never shows a toast.
- Phone: `<MakeReplay rows={record.rows} variant="phone" />` in the over-phase row. Desktop: `<MakeReplay rows={hub.session.rows} variant="desktop" />`, using the same rows the summary is built from (check `ScanHub` for the field name). It's enabled whenever the scan page is open, even with the window closed.

- [ ] **Step 1: Write the failing tests** (`replay-button.test.tsx`, injected `make`):
  - `disabled with no pulls`: rows all under $1 → the button is disabled and "No pulls to replay" is shown.
  - `makes a video by default`: click → `make` called with `'video'`, then "Replay saved".
  - `GIF when chosen`: pick GIF, click → `make` called with `'gif'`.
  - `shows progress`: `make` calls `onProgress(0.4)` and hangs → "Making replay… 40%".
  - `error shows its message`: `make` rejects `Error("Couldn't load the card art")` → that text.
  - `unmount mid-render aborts quietly` (Review Focus 5): render, click, unmount → the signal `make` received has `aborted === true`, and no toast.
  - `phone-stream.test.tsx`: after Close stream, "Make replay" is in the end row.
  - `scan-page.test.tsx`: "Make replay" sits beside "Show summary".
- [ ] **Step 2: Run** the three test files. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `MakeReplay.tsx` and mount it in both screens.
- [ ] **Step 4: Run** the three files. Expected: PASS. Then `npm run typecheck` and `npm run lint`. Expected: clean.
- [ ] **Step 5: Commit** `feat(replay): Make replay on phone Stream and the desktop scan page`.

### Task 8: Check it on real devices

No new code unless this turns something up.

- [ ] **Step 1: Desktop.** Run `npm run dev`, scan or seed a list with 9+ rows across games (prices 0.50–80, one quantity 3), and click Make replay with MP4. Check:
  - Save dialog: `rip-replay-<date>.mp4`.
  - In mpv or a browser: 8 pulls, cheapest first, "×3" shown, under 30 s, under 10 MB (`ls -l`), no audio track (`ffprobe -v error -show_streams`).
  - Repeat with GIF.
- [ ] **Step 2: Discord.** Upload both files to a test channel. The MP4 should autoplay inline and the GIF should animate.
- [ ] **Step 3: Phone.** Android (Play internal track or an APK from the PR build) and iOS (TestFlight from the PR's iOS job): end a short Stream with 2–3 hits and tap Make replay. The share sheet should open, with Save Video on iOS. The saved file should play in Photos/Gallery. On phone web (`app.duelbinder.com/scan/`), check share or download.
- [ ] **Step 4: Record results** in the PR description, including any platform where MP4 fell back to WebM.
- [ ] **Step 5: Commit** any fixes, each with a test where the bug can be pinned.
