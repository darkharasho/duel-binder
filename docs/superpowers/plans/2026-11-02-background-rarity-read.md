# Background Rarity Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the v0.46.0 tilt prompt and hold. A card counts at once. While the counted card stays in view, the scan loop keeps its frames, and a clear reading quietly updates that unsaved row's rarity once and flashes it.

**Architecture:** The loop's normal live frames do the work. While a counted, eligible row is being read, each live `analyze` call also asks the worker to keep the straightened card (the `tilt` and `at` fields the worker already has). Readings come from the existing `tiltReading` and are decided by a stricter pick over an allowlist of pairs. The update goes back to the counting surface through a new `onRarityRead(rowId, draft)` callback. The hub applies it to the row only if the user hasn't touched the row. The scan window sends it to the hub as a new acknowledged message.

**Tech Stack:** React + TypeScript, Vite, a Web Worker with OpenCV.js, Vitest + Testing Library, Electron IPC for the scan window, and Capacitor/WKWebView for the phone.

**Spec:** `docs/superpowers/specs/2026-11-02-background-rarity-read-design.md`

## Global Constraints

- Counting is exactly as fast as before v0.46.0: no prompt, no Skip, no hold, no timeout. A card counts the moment the loop counts it today.
- Any per-frame cost added to the common path (a card with no unsure rarity) counts as a failure. No extra frames are grabbed, and the loop's interval (`FRAME_MS` 200) doesn't change.
- Only unsaved session rows are updated. A row the user touched (printing or rarity), a removed row, a committed row, or a row whose rarity the rules were sure of is never changed.
- A background guess never clears the flag. The updated row keeps "Check rarity" / "Check version".
- One update per row. It never flips back.
- Never mix frames from two physical cards into one reading.
- No accuracy numbers, corpus paths, clip names or private training data in the repo, the PR or commit messages. Only fitted coefficients and the plain pair allowlist ship.
- Vitest at most 2 workers (`--maxWorkers=2`). No heavy synthetic test data.
- The PR reports the measured worker cost per kept frame and per reading on a desktop webcam, plus a phone measurement or a note that none was available.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings made writing this plan

- **Phone Stream is in.** The spec made Stream a follow-up "after PR #153 merges". #153 merges before this work starts, so Stream gets the read in Task 8, which is a one-line change.
- **Pick rule.** A read picks a finish only if it wins every enabled pair it is in, and it must be the only finish that does. With options Common, Super and Ultra and the pairs Common/Super and Common/Ultra enabled, a "Common" reading updates the row. A "foil" reading (Super and Ultra each win their one pair) changes nothing.
- **Eligibility.** Every distinct finish among the row's options must be a class the model knows, and at least one enabled pair must be among them. An option the model can't name would make any update a guess at the wrong card version, so such a row is never read.
- **Touch detection.** A user edit always goes through `setPrinting`, which sets `flag` to null. So "untouched" means the row still exists and its flag is non-null. The row also gets `read: true` once an update lands, and a row with `read` set is never updated again.
- **Bounded cost.** A read ends `TILT_READ_MS` (6000) after its row counted, usable or not. That keeps a card on a stand from paying for readings forever.
- **Scan-window updates** stay in memory and are resent until acknowledged, not kept in localStorage. A reload loses at most one quiet guess.

## Review Focus

1. **Two copies of the same card back to back** (a Normal, then a Reverse): the second count ends the first read and clears the worker's kept frames before the new row's read keeps any. The first row is never updated from the second card's frames. This is tested in Task 5.
2. **A card on a stand** (no motion, so every reading is below `TILT_MIN_MOTION`): the row is unchanged, and after `TILT_READ_MS` no more frames are kept and no more readings are asked for. This is tested in Task 5.
3. **The user edits or removes the row, or commits, while a reading is in flight:** a late update changes nothing and doesn't flash. This is tested in Task 6.
4. **Scan window update for a draft the hub hasn't acknowledged yet, or after the hub reloaded** (unknown id): the update is dropped and acknowledged, and no other row changes. This is tested in Task 7.
5. **Set, game or default rarity changed mid-read:** the read ends with nothing applied. This is tested in Task 5.

---

### Task 1: Fit and pick pairs at the live frame spacing (private)

The controller runs this task, or an implementer given the private fit inputs' location in its dispatch. The location never goes in the repo. Only `src/shared/scan/thresholds.ts`, `src/shared/scan/tiltModel.ts` and `scripts/scan/rarity/fit-tilt.ts` may change in git.

**Files:**
- Modify: `src/shared/scan/thresholds.ts:282-301` (TILT_* constants)
- Modify (maybe): `src/shared/scan/tiltModel.ts` (rewritten by `fit-tilt --write` only if the refit is kept)
- Modify (maybe): `scripts/scan/rarity/fit-tilt.ts` header comment (the flags the model was written with)

**Interfaces:**
- Produces: `TILT_FRAME_MS = 200`; `TILT_MIN_FRAMES` (the chosen floor); `TILT_MIN_MOTION` (unchanged unless held-out data supports lower); a new `TILT_READ_MS = 6000`; `TILT_TIMEOUT_MS` removed. It also produces the private decision of which pairs pass the bar, which Task 2 hard-codes.

- [ ] **Step 1:** Set `TILT_FRAME_MS = 200` and make its comment say it matches the live loop's `FRAME_MS`, since the read uses live frames. Replace `TILT_TIMEOUT_MS` with `TILT_READ_MS = 6000`, commented: "A background read with no usable reading this long after its card counted ends; it keeps no more frames and asks for no more readings."
- [ ] **Step 2:** Build fit-tilt (`npx vite build` per its header), delete the fit cache (the header says so after a `TILT_*` change), and run it on the private inputs twice: with `TILT_MIN_FRAMES` 8, then 6. Write the reports to the private folder only.
- [ ] **Step 3:** From the reports, enable a pair only if its held-out pooled score beats its baseline by ≥10 points. Check Pokémon `Normal`/`Reverse Holofoil` and Yu-Gi-Oh! `Common`/each foil. Pick the `TILT_MIN_FRAMES` with more passing pairs; if tied, take 8. Lower `TILT_MIN_MOTION` only if the report's motion percentile at the new spacing is lower and the pairs still pass. If the refit's passing pairs score at least as well as the shipped model's at 200 ms, keep the `--write` output in `tiltModel.ts` (prettier-formatted). If not, keep the shipped coefficients. If no refit can be checked, enable only Pokémon `Normal`/`Reverse Holofoil`, and only if it passes. Record the figures privately.
- [ ] **Step 4:** Run `npx vitest run --maxWorkers=2 tests/main/scan-tilt-fit.test.ts tests/main/scan-tilt.test.ts tests/main/scan-tilt-features.test.ts`. Expected: PASS. Any test pinning `TILT_TIMEOUT_MS` or the old grid is updated to the new constants.
- [ ] **Step 5: Commit** (thresholds, maybe tiltModel and the fit header): `feat(scan): fit the tilt reading to the live loop's frame spacing`. The message carries no figures.

### Task 2: Read eligibility and the strict pick

**Files:**
- Create: `src/shared/scan/tiltRead.ts`
- Modify: `src/renderer/src/features/scan/resolve.ts:446-466` (replace `tiltChoicesFor`)
- Test: `tests/main/scan-tilt-read.test.ts` (new), `tests/renderer/scan-resolve.test.ts:830-870`

**Interfaces:**
- Consumes: `TiltModel`, `tiltFinish`, `pickByTilt`'s per-pair nearest-centroid scoring (from `src/shared/scan/tilt.ts`)
- Produces:
  - `TILT_READ_PAIRS: Partial<Record<GameId, readonly (readonly [string, string])[]>>`: the allowlist from Task 1, with no figures beside it.
  - `readFinishes(game: GameId, rarities: readonly string[], model: TiltModel, pairs?: readonly (readonly [string, string])[]): string[] | null`
  - `pickByRead(model: TiltModel, features: readonly number[], finishes: readonly string[], pairs: readonly (readonly [string, string])[]): string | null`
  - In resolve.ts: `readChoicesFor(item: ScanDraft, defaultRarity: string | null, model: TiltModel | undefined): string[] | null`, which replaces `tiltChoicesFor` and keeps its guards (model, Auto rarity, not a guess, flag `check-rarity` or Pokémon `pick-printing`) but uses `readFinishes` with `TILT_READ_PAIRS[gameOf(item)]`.
  - `withRarityByTilt` is unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/main/scan-tilt-read.test.ts` with a one-feature model (classes Normal, Reverse Holofoil, Holofoil; each pair is split at 0 on feature 0):
  - `readFinishes('pkm', ['Normal', 'Reverse Holofoil'], M, [['Normal','Reverse Holofoil']])` → `['Normal','Reverse Holofoil']`
  - with the options `['Normal','Reverse Holofoil','Holofoil']` and only that pair enabled → the three finishes (eligible; Holofoil is a class)
  - with `['Normal','Cosmos Holo']` (not a class) → `null`
  - with `['Holofoil','Reverse Holofoil']` and no enabled pair among them → `null`
  - any option `/overframe|full art/i` → `null`
  - `pickByRead(M, [-1], ['Normal','Reverse Holofoil'], [['Normal','Reverse Holofoil']])` → `'Normal'`
  - over three finishes with two enabled pairs that split one win each (`Normal` beats `Holofoil`, `Reverse` beats `Normal`), with neither finish winning all of its pairs → `null`
  - no enabled pair present in `model.pairs` → `null`
  - In `scan-resolve.test.ts`, rename the `tiltChoicesFor` cases to `readChoicesFor`. The existing guard cases (default rarity, guess, no flag, no model) still return `null`. A Pokémon `pick-printing` Normal/Reverse draft returns both finishes when that pair is in `TILT_READ_PAIRS.pkm`.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/main/scan-tilt-read.test.ts tests/renderer/scan-resolve.test.ts`. Expected: FAIL (module/function not defined).
- [ ] **Step 3:** Implement `tiltRead.ts` and `readChoicesFor`. Use the "Rulings" section's pick rule, and score each pair the same way `pickByTilt` does. Factor that per-pair distance out of `pickByTilt` into an exported `pairWinner(pair, features): string` in tilt.ts so both callers share it.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scan): which counted rows a tilt reading may update, and a stricter pick`

### Task 3: Remove the tilt prompt and hold

Everything that only served the v0.46.0 hold goes. After this task, no surface waits, and the models are passed but unused until Task 5.

**Files:**
- Modify: `src/renderer/src/features/scan/useScanLoop.ts` (remove `Tilt`, `startTilt`, `endTilt`, `endAnyTilt`, `askTilt`, `tiltFrame`, `skipTilt`, `tiltTimer`/`tiltDeadline`, the `l.tilt` branch in `tick`, the tilt start at lines 954-962, and the `'tilt'` arm of `sameStatus`)
- Modify: `src/shared/scanWindow.ts` (drop the `{ kind: 'tilt' }` ScanStatus and the `skipTilt` ToScanWindow, including its `TO` entry)
- Modify: `src/renderer/src/features/scan/ScanHub.tsx` (drop `skipTilt` from the context type and value)
- Modify: `src/renderer/src/features/scan/window/ScanWindowApp.tsx:143` (drop the `skipTilt` arm)
- Modify: `src/renderer/src/features/scan/ScanPage.tsx:256-273` (drop the tilt status line and Skip)
- Modify: `src/renderer/src/features/scan/ScanViewport.tsx:62-64`; delete `src/renderer/src/features/scan/TiltPrompt.tsx`
- Modify: `src/renderer/src/features/scan/scanText.ts:19-20`
- Modify: `src/phone/PhoneCamera.tsx:80-81` (the doc comment no longer mentions a prompt)
- Test: `tests/renderer/scan-page.test.tsx`, `tests/renderer/phone-scanner.test.tsx` (`describe('phone scanner tilt')`), `tests/renderer/scan-window.test.tsx`

**Interfaces:**
- Produces: `ScanLoop` without `skipTilt`; `ScanStatus` without `'tilt'`; `ToScanWindow` without `'skipTilt'`.

- [ ] **Step 1: Replace the prompt tests.** Delete the tests that pin "Tilt the card", Skip and the `'tilt'` status. Add `it('counts a two-foil card on its first recognized frame, with tilt models given')` in `phone-scanner.test.tsx`. Use `tiltEngine(() => held(), () => FEW)` and `{ ygo: MODEL }`, the existing FOILS (Super and Ultra), `renderCamera`, then `settle(1000)`. Assert `counted` is `'1'`, and that `queryByText('Tilt the card')` and `queryByRole('button', { name: 'Skip' })` are null. Add the same assertion on the Scan page for a scan-window state: `isToScanWindow({ kind: 'skipTilt' })` is `false`.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/renderer/phone-scanner.test.tsx tests/renderer/scan-page.test.tsx tests/renderer/scan-window.test.tsx`. Expected: the new tests FAIL (the card is held).
- [ ] **Step 3:** Remove the code listed above. A recognized draft goes straight to `show(outcome, draft)` and `onDraft(draft)`.
- [ ] **Step 4:** Run `npm run typecheck`, `npx eslint src tests --cache` and the Step 2 command. Expected: clean, PASS.
- [ ] **Step 5: Commit** `feat(scan): drop the tilt prompt and hold; cards count at once again`

### Task 4: The worker keeps a read frame without dropping its cues

Today, a frame that asks for its upright card (`wantUpright`) leaves out the rarity cues, look, version cues and slab. A read frame is now an ordinary live frame that the loop resolves and may count from. It must keep all of those.

**Files:**
- Modify: `src/renderer/src/features/scan/vision/analyze.ts:50-60,145-160` (`wantUpright` only adds `upright`)
- Modify: `src/renderer/src/features/scan/vision/vision.worker.ts:122-141` (comments: a read frame, not a tilt frame)
- Test: `tests/main/scan-vision-detect.test.ts` or the existing analyze test that covers `wantUpright`

**Interfaces:**
- Produces: `analyze(..., wantUpright = true)` returns the same `cues`, `look`, `version` and `slab` as with `false`, plus `upright`.

- [ ] **Step 1: Write the failing test** `it('a frame kept for a read keeps its rarity cues and version cues')`. Use the existing synthetic card the analyze tests use, with `SCAN_PROFILES.ygo` and then `.pkm`. Compare `analyze(..., false)` to `analyze(..., true)` with `upright` removed: deep-equal `cues`, `look` and `version`. `upright` is defined only with `true`.
- [ ] **Step 2:** Run that test file with `--maxWorkers=2`. Expected: FAIL (cues null with `true`).
- [ ] **Step 3:** Change the three `!wantUpright` guards so they no longer depend on it, and update the doc comment.
- [ ] **Step 4:** Run the file again plus `tests/main/scan-tilt-frames.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scan): a frame kept for a rarity read is still a whole live frame`

### Task 5: The background read in the scan loop

**Files:**
- Modify: `src/renderer/src/features/scan/useScanLoop.ts`
- Test: `tests/renderer/scan-rarity-read.test.tsx` (new; mounts `useScanLoop` directly in a small harness with `tiltEngine`, `stubCamera`, fake timers, as `phone-scanner.test.tsx`'s `Bare` does)

**Interfaces:**
- Consumes: `readChoicesFor`, `pickByRead`, `TILT_READ_PAIRS` (Task 2); `withRarityByTilt`; `engine.tiltReading(game, now)`, `engine.tiltReset()`; `analyze(frame, { ..., tilt: number[], at: number })` → `tiltKept`; `TILT_MS`, `TILT_RETRY_MS`, `TILT_MIN_FRAMES`, `TILT_MIN_MOTION`, `TILT_READ_MS`, `ABSENT_MS`, `ART_MAX_DISTANCE`; `sameSpot(a, b)`.
- Produces, in `ScanLoopOptions`:
  - `onDraft: (d: ScanDraft) => string | void`: returns the counted row's id; with no id, the row is never read.
  - `onRarityRead?: (rowId: string, draft: ScanDraft) => void`: the counted draft on the read's printing (`withRarityByTilt`), called at most once per row, and only when its `printingId` differs from the counted one.

State, in `loop.current.read: RarityRead | null`:
```ts
interface RarityRead {
  rowId: string
  draft: ScanDraft
  finishes: string[]
  model: TiltModel
  pairs: readonly (readonly [string, string])[]
  game: GameId
  engine: ScanEngine
  imageIds: number[] // as Tilt's were: the draft's image and its card's printings' images
  quad: Quad | null // the outline when last kept
  since: number // when its row counted
  missSince: number | null
  nextRead: number // since + TILT_MS, then TILT_RETRY_MS after each unusable reply
  reading: boolean
}
```

Behaviour (each point is a test in Step 1):
- One counting path, `counted(draft, engine, o)`, is used by both the live and photo paths. It ends any read (`tiltReset`), shows and calls `onDraft`, and starts a read when `readChoicesFor` gives finishes, the engine has `tiltReading`, and `onDraft` returned an id.
- While a read is on, the live `analyze` call adds `tilt: read.imageIds, at`. With no read, the call is byte-for-byte as today.
- After each live frame, the read ends when: the frame's top art is another card's within `ART_MAX_DISTANCE`; a kept frame's `quad` is not `sameSpot` as `read.quad`; no frame has been kept for `ABSENT_MS`; `TILT_READ_MS` has passed since it counted; or `running`, the set key, the game, the language or `defaultRarity` changes.
- A reading is asked for (not awaited by the tick) when `!reading && now >= nextRead`. A usable reply (frames ≥ `TILT_MIN_FRAMES`, motion ≥ `TILT_MIN_MOTION`) with a `pickByRead` result ends the read and calls `onRarityRead`. A reply for a read that has ended is ignored. A failed reading ends the read with nothing applied.
- In dev builds only, `console.debug('[scan] rarity read', JSON.stringify({ ms, frames, motion, pick }))` is logged per reply, for Task 9's measurement.

- [ ] **Step 1: Write the failing tests** in `scan-rarity-read.test.tsx`. Use a Pokémon draft with options Normal and Reverse Holofoil, flag `pick-printing`, `TILT_READ_PAIRS.pkm` containing that pair, and the one-feature model (feature 0 above 0 means Reverse):
  - `it('counts on the first recognized frame and updates the row once from a usable reading')`: onDraft returns `'row-1'` on the first counting tick. After `TILT_MS`, the reading `{ features: [1], frames: 10, motion: 50 }` gives `onRarityRead('row-1', draft with rarity 'Reverse Holofoil', flag 'check-rarity')`, called exactly once even though more ticks follow.
  - `it('passes tilt only while a read is on')`: an ineligible draft (flag null) never sends `tilt` in the `analyze` options.
  - `it('a second copy counted ends the first read before its own')`: the frames are the same card, absent for `ABSENT_MS`, then the same card again. Expect `tiltReset` between the two counts and `onRarityRead` only with `'row-2'`. The `tiltReading` reply that was in flight for row 1 is ignored.
  - `it('an outline that jumps ends the read')`: a kept frame whose quad is shifted beyond `sameSpot` → no `onRarityRead`.
  - `it('a card held still past TILT_READ_MS changes nothing and stops asking')`: readings with motion 0 → no `onRarityRead`. `tiltReading` call count stops growing after `TILT_READ_MS`, and later `analyze` calls carry no `tilt`.
  - `it('a change of set or default rarity mid-read applies nothing')`: rerender with a new `defaultRarity` before the reading resolves → no `onRarityRead`.
  - `it('a pick equal to the counted printing calls nothing')`.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/renderer/scan-rarity-read.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement as described above. Keep `l.busy` handling and the interval unchanged. There is no extra timer: reads are driven only by live ticks.
- [ ] **Step 4:** Run the Step 2 command plus `tests/renderer/scan-page.test.tsx tests/renderer/phone-scanner.test.tsx tests/renderer/scan-window.test.tsx`, then `npm run typecheck`. Expected: PASS, clean.
- [ ] **Step 5: Commit** `feat(scan): read a counted card's rarity from the live frames while it stays in view`

### Task 6: The hub applies a read and flashes the row

**Files:**
- Modify: `src/renderer/src/features/scan/types.ts:63` (`ScanDraft.read?: true`)
- Modify: `src/renderer/src/features/scan/session.ts` (new `applyRead`)
- Modify: `src/renderer/src/features/scan/ScanHub.tsx` (new `reread` and `flashed`)
- Modify: `src/renderer/src/features/scan/useHubScan.ts:67-95` (`onDraft` returns the key; `onRarityRead` → `reread`)
- Test: `tests/renderer/scan-session.test.ts` (or the existing session test file), `tests/renderer/phone-scanner.test.tsx`

**Interfaces:**
- Produces:
  - `session.applyRead(key: string, next: ScanDraft): boolean`: true when applied. It applies only if the row exists, `committing` is false, `row.flag !== null`, `!row.read`, and `next.cardId === row.cardId`. It then sets `printingId`, `rarity`, `setCode` and `flag` from `next`, plus `read: true`. Quantity, key and everything else stay as they are.
  - Hub context: `reread(key: string, next: ScanDraft): void` (applyRead; when applied, `flashed = key` for `READ_FLASH_MS = 900`, then null); `flashed: string | null`.
  - `useHubScan`'s `onDraft` returns `count(draft)`'s key, and it passes `onRarityRead: reread`.

- [ ] **Step 1: Write the failing tests:**
  - `applyRead` applies to an untouched flagged row and sets `read` and the new rarity. The flag stays `'check-rarity'`.
  - After `setPrinting(key, …)` it returns false and the row is unchanged.
  - After `remove(key)` it returns false.
  - While `commit()` is pending it returns false.
  - A second `applyRead` on the same row returns false.
  - A `next` of another card returns false.
  - `reread` sets `flashed` to the key and back to null after 900 ms; a refused one leaves `flashed` null.
  - Phone end to end: `it('the phone updates a counted Normal row to Reverse Holofoil when the reading says so')`. A Pokémon `tiltEngine` with the Normal/Reverse options; after `TILT_MS`, the row in `scan.session.v1` has rarity `'Reverse Holofoil'` and a non-null flag, and the counted total is still 1.
- [ ] **Step 2:** Run the two files with `--maxWorkers=2`. Expected: FAIL.
- [ ] **Step 3:** Implement as described above.
- [ ] **Step 4:** Run them again plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scan): a counted row takes a background rarity read once, unless touched`

### Task 7: The scan window sends reads to the hub

**Files:**
- Modify: `src/shared/scanWindow.ts` (FromScanWindow `{ kind: 'rarity'; id: string; draft: ScanDraft }`; ToScanWindow `{ kind: 'rarityAck'; id: string }`; the `TO`/`FROM` lists)
- Modify: `src/renderer/src/features/scan/window/ScanWindowApp.tsx` (`onDraft` returns the outbox id; `onRarityRead`; an in-memory `rereads: Map<string, ScanDraft>` resent with `flush` every `RESEND_MS` until `rarityAck`)
- Modify: `src/renderer/src/features/scan/ScanHub.tsx:263-319` (`seen` becomes `Map<draftId, rowKey>`; on `'rarity'`: `reread(seen.get(id), draft)` when known; always reply `rarityAck`)
- Test: `tests/renderer/scan-window.test.tsx`

**Interfaces:**
- Consumes: `reread` (Task 6), `onRarityRead` (Task 5), `Outbox.pending()`.
- Produces: the two message kinds above.

- [ ] **Step 1: Write the failing tests** with `fakeBridge`:
  - The hub, given `draft` id `d1` and then `rarity` id `d1` with a Reverse draft, updates that row and sends `{ kind: 'rarityAck', id: 'd1' }`.
  - A `rarity` for an unknown id changes no row and is still acknowledged.
  - The window, with `d1` still pending in its outbox (no `ack` yet), sends no `rarity` message for it.
  - With `d1` acknowledged, the window resends `rarity` every `RESEND_MS` until `rarityAck`, then stops.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/renderer/scan-window.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement as described above.
- [ ] **Step 4:** Run it again plus `tests/renderer/scan-page.test.tsx` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scan): the scan window's rarity reads reach the hub's row`

### Task 8: The flash, and Phone Stream gets the read

**Files:**
- Modify: `src/renderer/src/index.css` (`@keyframes scan-reread` and a `.scan-reread` class)
- Modify: `src/renderer/src/features/scan/ScanRowItem.tsx:131-161` (`flashed` prop → `scan-reread`)
- Modify: `src/renderer/src/features/scan/SessionList.tsx:143` (`flashed={row.key === flashed}`)
- Modify: `src/phone/ReviewSheet.tsx:56` (`ReviewRow` takes the class when `row.key === flashed`), `src/phone/ScannerScreen.tsx` (the last-card strip, when `last.key === flashed`)
- Modify: `src/phone/stream/StreamCamera.tsx:101` (pass `tiltModels: TILT_MODELS`)
- Test: `tests/renderer/scan-page.test.tsx`, `tests/renderer/phone-scanner.test.tsx`

**Interfaces:**
- Consumes: hub `flashed` (Task 6).

The flash is a single amber background tint, about 900 ms, ease-out, run once (`animation-iteration-count: 1`). It uses no transform, size, layout or focus change, so reduced motion needs no override. Under `prefers-reduced-motion: reduce` it is a plain background colour shown while `flashed` matches, with no animation. It is separate from the emerald "just counted" highlight (`highlighted`).

- [ ] **Step 1: Write the failing tests:**
  - On the Scan page, after a hub `reread` that applies, the row's element has class `scan-reread`; after 900 ms it doesn't.
  - In the phone review sheet, the same.
  - `StreamCamera` calls `useHubScan` with `tiltModels: TILT_MODELS` (spy, as the existing phone test does).
- [ ] **Step 2:** Run the two files with `--maxWorkers=2`. Expected: FAIL.
- [ ] **Step 3:** Implement as described above.
- [ ] **Step 4:** Run them again, then the full suite: `npx vitest run --maxWorkers=2`, `npm run typecheck`, `npx eslint src tests --cache`. Expected: all PASS, clean.
- [ ] **Step 5: Commit** `feat(scan): flash a row when a background read changes it; Phone Stream reads too`

### Task 9: Measure the cost and open the PR (controller)

**Files:**
- Create: `scripts/scan/rarity/bench-read.ts` (takes a frames directory as an argument and names no private paths; it times `shrinkCard` per frame and `tiltFeatures` per reading, median and p90 over the runs)

- [ ] **Step 1:** Write the bench, build it as fit-tilt is built, and run it on 20 private clips. Record the median and p90 ms per kept frame and per reading.
- [ ] **Step 2:** In a dev build on the desktop webcam, scan 10 cards that have a Pokémon Normal/Reverse choice. From the console, record the `[scan] rarity read` ms, and the live frames' analyze ms (`debugTimes`) with and without a read on. On a phone, do the same if one is available; otherwise say so in the PR.
- [ ] **Step 3:** Push the branch and open the PR, following the repo's PR description style:
  - what changed (no prompt, a quiet read, the flash, Stream included);
  - which pairs are on (names only);
  - the cost figures from Steps 1–2;
  - the calls from the spec and this plan for the owner to check.
  - No accuracy figures.
- [ ] **Step 4:** Show the CI watcher card for the pushed branch.
