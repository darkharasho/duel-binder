# Phone Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Stream mode to the phone app that shows the live back camera full screen with the desktop's pull and hit overlays, for sharing through Discord mobile, upright or sideways.

**Architecture:** A new `src/phone/stream/` folder holds a full-screen `StreamScreen` that `ScannerScreen` swaps to. It scans through the existing `useHubScan`, shows pulls through the existing `useOverlay` and `PullOverlay`, and saves through the existing `ReviewSheet`. A small persisted stream record (a list of `ScanRow` snapshots) feeds the count and `sessionSummary`, so saving can't reset them. A native `Stream` Capacitor plugin handles rotation and keeping the screen awake on iOS; the web falls back to the Wake Lock API.

**Tech Stack:** React, TypeScript, Tailwind, Vitest with Testing Library, Capacitor 8, Swift.

**Spec:** `docs/superpowers/specs/2026-11-01-phone-stream-design.md`

## Global Constraints

- There is no Add button outside `ReviewSheet`. Closing a stream never saves or clears the list.
- Stream mode changes no recognition code: `centreCrop`, `useScanLoop` and the look model stay as they are. The loop is only told when to run.
- `pullOf`, `pushPull` and `tickOverlay` remain the only pull and hit rules: 4 s normal, 8 s hit.
- Hit price uses the existing `scan.hitPrice` setting, default $20.
- Back camera only: `useCamera(settings.deviceId, 'environment')`.
- Only Stream mode rotates; every other screen stays upright.
- Between pulls, viewers see only the camera, the corner marks and the small count. Controls show for about 3 seconds after a tap, then fade.
- The stream shows no account details or collection value.
- Run tests with `npm test -- <file>`, which already caps vitest at 2 workers.
- No heavy synthetic test data.
- Do not cut a release, push a tag or deploy without the owner asking.

## Review Focus

1. **The app goes to the background mid-stream** (a call, or a trip to Discord): on return the camera resumes, pulls are intact, and the wake lock is taken again. Pinned in Tasks 5 and 6.
2. **Saving mid-stream, then scanning more:** the count keeps climbing and the summary keeps every card, including a row partly saved while its quantity was raised. Pinned in Task 2.
3. **Cards left on the list from before the stream:** they stay in the drawer, can be saved there, and never enter the stream's count or summary. Pinned in Task 2.
4. **A crash or restart mid-stream:** reopening offers to carry on with the same count, and no pull is lost. Pinned in Task 5.
5. **A stream with no cards, or one where every card was removed:** the summary shows "No cards yet" and Done still leaves cleanly. Pinned in Task 6.

---

### Task 1: Prove it on a real iPhone (throwaway)

This is the spec's gate. Nothing here is merged. It needs the owner and their iPhone.

**Files (on branch `spike/phone-stream`, never merged):**
- Modify: `ios/App/App/Info.plist`, adding `UIInterfaceOrientationLandscapeLeft` and `UIInterfaceOrientationLandscapeRight`
- Modify: `src/phone/ScannerScreen.tsx`, making `PhoneCamera`'s `ScanViewport` fill the screen behind a temporary toggle

- [ ] **Step 1: Build the iOS spike.** Run `gh workflow run ios.yml --ref spike/phone-stream`. On `workflow_dispatch` this workflow signs and uploads to TestFlight, so confirm with the owner first. Expected: a build appears in TestFlight.

- [ ] **Step 2: Serve the web spike without deploying.** Run the phone build over HTTPS on the LAN, using the tilt booth's self-signed certificate in `~/scan-capture/.tilt`. Expected: the page opens on the iPhone and can be added to the home screen. Do not deploy the Worker.

- [ ] **Step 3: The owner runs spec checks 1 to 3 on both versions:**
  1. Discord's share keeps running with the camera open, and a viewer sees video.
  2. Going to Discord and back brings the camera back.
  3. 30 minutes passes with no crash, camera stop or visibly choppy video.

- [ ] **Step 4: The owner runs spec check 4.** Scan at least 50 real cards at stand distance, in each direction, and again with the normal phone scanner. Expected: no more wrong cards than the normal scanner on the same cards.

- [ ] **Step 5: Apply the spec's bars.** If check 1 or 2 fails on both versions, or check 3 or 4 fails, stop and report to the owner. If only the web version fails check 1 or 2, continue, drop the web parts of Tasks 5 and 7, and tell the owner the web version needs separate work. Record the results at the end of this plan.

- [ ] **Step 6: Create the working branch.** Run `git switch -c feat/phone-stream origin/main`, leaving the spike branch behind.

### Task 2: The stream record

**Files:**
- Create: `src/phone/stream/record.ts`
- Modify: `src/renderer/src/features/scan/session.ts`, `src/renderer/src/features/scan/ScanHub.tsx`
- Test: `tests/renderer/phone-stream-record.test.ts`, `tests/renderer/scan-session.test.ts`

**Interfaces:**
- Consumes: `ScanRow`, `sessionSummary(rows, hitPrice)`
- Produces:
  - `useScanSession().onSaved(listener: (key: string, quantity: number) => void): () => void` and the same `hub.onSaved`: told the copies of each successful commit. *Ruling during Task 2: replaced an in-memory `saved` map, which double-counted on Carry on within one app run.*
  - `ScanHub.count(draft): string`: now returns the row key from `add`.
  - `interface StreamRecord { game: GameId; rows: ScanRow[]; saved: Record<string, number> }`
  - `recordSaved(record, key: string, quantity: number): StreamRecord`
  - `newStream(game: GameId): StreamRecord`
  - `recordPull(record, row: ScanRow): StreamRecord`
  - `reconcile(record, listRows: ScanRow[]): StreamRecord`
  - `streamCards(record): number`
  - `loadStream(): StreamRecord | null`, `saveStream(record): void`, `endStream(): void`, stored under `scan.stream.v1`

- [ ] **Step 1: Write the failing tests.**

In `scan-session.test.ts`, test `commit records what it saved`: after committing a row of quantity 2, `saved.get(key) === 2`, and a row raised to 3 mid-commit keeps 1 on the list.

In `phone-stream-record.test.ts`:

```ts
it('takes a corrected printing or quantity from the list', ...)
// row q=1 in record; list has it at q=2, rarity 'Secret Rare' => record row q=2, 'Secret Rare'
it('keeps a saved row after it leaves the list', ...)
// list [], saved {k: 2} => record keeps k with quantity 2
it('counts saved and unsaved copies of a partly saved row', ...)
// list has k q=1, saved {k: 2} => quantity 3
it('drops a row removed from the list without saving', ...)
// list [], saved {} => record.rows === []
it('ignores list rows that were not pulled on this stream', ...)
// list has other key => record unchanged
it('returns the same record when nothing changed', ...)
// reconcile(...) === record, so the effect does not loop
it('loads null from corrupt storage', ...)
```

- [ ] **Step 2: Run them.** Run `npm test -- tests/renderer/phone-stream-record.test.ts tests/renderer/scan-session.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** In `commit`'s success branch, add `row.quantity` to `saved` for that key (state, not persisted). Have `ScanHub.count` return the key. Write `record.ts`; `saveStream` and `loadStream` swallow storage errors, as `session.ts` does. Update the `count` type in the `ScanHub` interface.

- [ ] **Step 4: Run them again.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(phone): keep a record of each stream's pulls"`

### Task 3: Scan area and overlay on a phone

**Files:**
- Create: `src/phone/stream/scanArea.ts`
- Modify: `src/renderer/src/features/scan/useHubScan.ts`, `src/renderer/src/features/scan/window/PullOverlay.tsx`, `src/renderer/src/features/scan/window/SummaryScreen.tsx`
- Test: `tests/renderer/phone-stream-area.test.ts`, `tests/renderer/scan-window.test.tsx`, `tests/renderer/scan-summary.test.tsx`, `tests/renderer/phone-scanner.test.tsx`

**Interfaces:**
- Consumes: `centreCrop`, `ScanHub.count` from Task 2
- Produces:
  - `scanArea(video: {width: number; height: number}, view: {width: number; height: number}): CropRect`: the scanned crop in screen pixels under `object-fit: cover`, clamped to the view.
  - `useHubScan({ ..., paused?: boolean, onPull?: (pull: Pull, scanned: number, draft: ScanDraft) => void })`. `pull.id` is the row key; `scanned` is `copiesOf(draft)`.
  - `PullOverlay({ pull, scanned, phone?: boolean })`

- [ ] **Step 1: Write the failing tests.**

```ts
it('marks the middle of a sideways frame', () => {
  expect(scanArea({ width: 1920, height: 1080 }, { width: 844, height: 390 }))
    .toEqual({ x: 276, y: 0, width: 293, height: 390 }) // rounded
})
it('clamps to the screen when the crop is wider than the view', () => {
  const a = scanArea({ width: 1080, height: 1920 }, { width: 390, height: 844 })
  expect(a.x).toBe(0); expect(a.width).toBe(390)
})
it('is the whole view before the video has a size', ...) // 0x0 video
```

In `scan-window.test.tsx`: with `phone`, the bar carries the phone layout classes and desktop's render is unchanged. In `phone-scanner.test.tsx`: `paused` stops counting, and `onPull` receives the row key and the copy count.

- [ ] **Step 2: Run them.** Run `npm test -- tests/renderer/phone-stream-area.test.ts tests/renderer/scan-window.test.tsx tests/renderer/phone-scanner.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.** `scanArea` gives the crop from `centreCrop`, scaled by `max(view.w/video.w, view.h/video.h)`, offset by the centred overflow, then clamped. In `useHubScan`, `running` becomes `stream !== null && !paused`. In `PullOverlay`, `phone` makes the bar `inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-w-none`, with `landscape:right-auto landscape:max-w-[55vw]` sideways. Pass the phone sizes down so type stays legible; the `vw` values stay for desktop. In `SummaryScreen`, use `portrait:` variants so the hit stacks above a list that fits a narrow screen; a wide desktop window must not change.

- [ ] **Step 4: Run them again,** adding `tests/renderer/scan-summary.test.tsx`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(scan): let the overlay and scan loop run in a phone stream"`

### Task 4: Device control

**Files:**
- Create: `ios/App/App/StreamPlugin.swift`, `src/phone/stream/device.ts`
- Modify: `ios/App/App/Info.plist`, `ios/App/App/WebAuthPlugin.swift`, `ios/App/App.xcodeproj/project.pbxproj`
- Test: `tests/renderer/phone-stream-device.test.ts`

**Interfaces:**
- Produces:
  - `enterStream(): Promise<{ awake: boolean }>`: `awake` is false when nothing can hold the screen on.
  - `reacquireStream(): Promise<void>`: takes the web wake lock again.
  - `exitStream(): Promise<void>`
  - Plugin `Stream`, methods `enter()` and `exit()`.

- [ ] **Step 1: Write the failing tests.** In the web path: `enterStream` requests `navigator.wakeLock` with `'screen'` and returns `{ awake: true }`; a refused or missing wake lock returns `{ awake: false }` without throwing; `exitStream` releases it; `reacquireStream` requests it again. In the native path, with `isNativeApp()` true: the plugin's `enter` and `exit` are called, and no wake lock is requested.

- [ ] **Step 2: Run them.** Run `npm test -- tests/renderer/phone-stream-device.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** `device.ts` uses `registerPlugin` as `nativeSignIn.ts` does. In Swift, follow `WebAuthPlugin`'s plugin shape and register in `MainViewController.capacitorDidLoad`. Give `MainViewController` a static allowed-orientations value, default `.portrait`, returned from `supportedInterfaceOrientations`. `enter()` sets `.allButUpsideDown`, sets `UIApplication.shared.isIdleTimerDisabled = true`, and calls `setNeedsUpdateOfSupportedInterfaceOrientations()`. `exit()` reverses both and calls `requestGeometryUpdate` to return to portrait. Do these on the main thread. Add the landscape keys to `Info.plist` and the file to `project.pbxproj`, mirroring the `WebAuthPlugin.swift` entries.

- [ ] **Step 4: Run them again,** then `npm run typecheck:phone`. Expected: PASS. The Swift compile is checked by the PR's iOS workflow.

- [ ] **Step 5: Commit.** `git commit -m "feat(ios): rotate and stay awake during a stream"`

### Task 5: The start screen and the live stream screen

**Files:**
- Create: `src/phone/stream/StreamScreen.tsx`, `src/phone/stream/StreamStart.tsx`, `src/phone/stream/StreamCamera.tsx`
- Create: `src/renderer/src/features/scan/HitPriceInput.tsx`, moved out of `ScanPage.tsx`
- Modify: `src/phone/ScannerScreen.tsx`, `src/phone/Settings.tsx`, `src/renderer/src/features/scan/ScanPage.tsx`
- Test: `tests/renderer/phone-stream.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2 to 4; `useOverlay`, `PullOverlay`, `useCamera`
- Produces: `StreamScreen({ engineFactory?, onExit: () => void })`, and `HitPriceInput` in its own file

- [ ] **Step 1: Write the failing tests,** using the camera and engine fakes from `phone-scanner.test.tsx`.

- `opens from the scanner's Stream button`, showing the hit price and exact copy: "Turn on Do Not Disturb, because viewers can see notifications." and "Start your Discord share first."
- `changing the hit price saves it`: `localStorage['scan.hitPrice']` updates.
- `says to set Auto-Lock when the screen can't be held on`: with `enterStream` returning `{ awake: false }`, it shows "Set Auto-Lock to Never so the screen stays on."
- `offers to carry on a saved stream`: with a saved record of 3 cards, it shows "Carry on (3 cards)" and "Start new"; "Start new" calls `endStream` and leaves the list alone.
- `shows a pull and counts it`: a scan shows the pull and "1 card".
- `does not show a Stream Add button`: no button named `/^Add/` is present on the live screen.
- `shows no scanner status bar`: on the live screen there is no "Take photo" button and none of the scanner's status lines ("Couldn't find", the match line); a scan's result appears only as the `PullOverlay` pop-up at the bottom. *Owner, after the spike: "it should have a popup at the bottom like the stream on desktop does."*
- `keeps controls clear of the notch`: the count, "to check", Close stream and Pause sit inside `env(safe-area-inset-top|left|right)` (assert their containers use the safe-area padding classes), so nothing sits under the clock or the Dynamic Island in either direction. *Owner, after the spike: "i also couldnt hit the top buttons on ios since it overlayed the time."*
- `celebrates a hit`: a pull priced at or above the hit price shows the desktop hit moment and `Confetti` for 8 s. *Owner, after the spike: "i didnt see any of the celebration for a hit."*
- `shows the corner marks`: `data-testid="scan-area"` matches `scanArea`.
- `shows to-check only when there is some`: "2 to check" counts `flagText(row)` rows, including older rows, and is absent at 0.
- `a tap shows Close stream and Pause, and they fade after 3 s`, with fake timers.
- `pausing stops counting and clears the overlay`.
- `says when the camera stops`: with `camera.error` set, it shows "The camera stopped" and a Try again button; the count remains.
- `takes the wake lock again when the app returns`: firing `visibilitychange` to visible calls `reacquireStream`.

- [ ] **Step 2: Run them.** Run `npm test -- tests/renderer/phone-stream.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `ScannerScreen` gets a Stream button and returns `<StreamScreen>` while `streaming`, so `PhoneCamera` unmounts and only one camera is open.
  - `StreamScreen` moves through `start`, `live` and `over`. It holds the record in state, saves it on each change, subscribes to `hub.onSaved` and applies `recordSaved`, and runs `reconcile` in an effect on `session.rows`.
  - `StreamCamera` renders a `<video>` with `absolute inset-0 size-full object-cover`, unmirrored, with `useHubScan`'s `onPull` pushing `{ ...pull }` to `useOverlay` and adding the row to the record and to a `scanned` record by id. Measure the video and view with a `ResizeObserver` and the video's `resize` event, for `scanArea`.
  - Show the `ArtDataNotice` when `loop.artReady === false`, as `PhoneCamera` does.
  - `enterStream` runs on Start, and `exitStream` runs on unmount, so any way out restores rotation.
  - Move `HitPriceInput` to its own file, so the phone doesn't import `ScanPage`, and use it in `StreamStart` and `Settings`.

- [ ] **Step 4: Run them again.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(phone): add the live stream screen"`

### Task 6: Review drawer and end of stream

**Files:**
- Modify: `src/phone/ReviewSheet.tsx`, `src/phone/stream/StreamScreen.tsx`
- Test: `tests/renderer/phone-stream.test.tsx`

**Interfaces:**
- Consumes: `StreamRecord`, `sessionSummary`, `SummaryScreen`
- Produces: `ReviewSheet({ onClose, stream?: boolean })`

- [ ] **Step 1: Write the failing tests.**

- `the drawer opens on cards to check`: with 3 rows, 1 flagged, only that row shows; "All" shows 3.
- `the drawer's Add covers the whole list`: the button reads "Add 3 cards" while filtered to one.
- `the normal review is unchanged`: without `stream`, all rows and the backdrop show.
- `scanning continues while the drawer is open`: a scan raises the count behind it.
- `saving mid-stream keeps the count`: Add leaves the count at 3, and a further scan makes 4.
- `Close stream shows the summary and stops counting`.
- `the summary has Review and no Add`: a Review button opens the drawer; no button matches `/^Add/` or `/share/i` outside the drawer.
- `an empty stream's summary leaves cleanly`: "No cards yet" shows and Done calls `onExit`.
- `Done ends the record and keeps the list`: `scan.stream.v1` is removed and `scan.session.v1` is unchanged.

- [ ] **Step 2: Run them.** Same command as Task 5. Expected: new tests FAIL.

- [ ] **Step 3: Implement.** With `stream`, `ReviewSheet` drops its dimming backdrop, uses `h-[60%]` upright and `landscape:inset-y-0 landscape:right-0 landscape:left-auto landscape:h-full landscape:w-[45%]` sideways, and adds a "To check" and "All" toggle that defaults to To check when any exist. The footer stays as it is. `StreamScreen`'s `over` state pauses scanning and shows `SummaryScreen` from `sessionSummary(record.rows, settings.hitPrice)` with Review and Done buttons over it. Done calls `endStream()` and then `onExit()`.

- [ ] **Step 4: Run them again.** Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(phone): review and finish a stream"`

### Task 7: Final check on the iPhone

**Files:** none expected, beyond fixes from what this finds.

- [ ] **Step 1: Run everything.** Run `npm test`, `npm run typecheck` and `npm run lint`. Expected: all pass.

- [ ] **Step 2: Build for the owner.** Open the PR and let the iOS check compile. With the owner's OK, run `gh workflow run ios.yml --ref feat/phone-stream` for TestFlight. Serve the web build as in Task 1.

- [ ] **Step 3: The owner runs a real stream,** upright and sideways, on both versions: pulls, a hit, the drawer, saving mid-stream, leaving to Discord and back, closing, and saving at the end. Expected: every screen reads clearly at viewer size, corner marks line up with what scans, and other screens stay upright.

- [ ] **Step 4: Stop for the owner.** Merging, the release tag and the App Store update all wait for the owner to ask.

## Spike results

iOS app, TestFlight build from `spike/phone-stream` (c190ec6), 2026-11-02:

- Check 1 (Discord share with the back camera open): passed. "yes it worked, friend could see it".
- Check 2 (back from Discord): taken as passed from the same answer.
- Checks 3 (30 minutes) and 4 (50+ cards each way): not yet run. They gate shipping, not the build.
- Web version: not tried; unproven.
- Owner feedback: no scanner status bar or Take photo on stream, use the desktop pop-up; the hit celebration must show; top buttons sat under the clock and could not be tapped. Added as tests to Task 5.
