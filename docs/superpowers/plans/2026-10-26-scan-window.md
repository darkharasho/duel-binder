# Scan Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Scan's camera and recognition into a separate, full-screen-able "Duel Binder — Scan" window that shows each counted pull as a fading overlay (big moment for hits). The main window's Scan page becomes the list plus the controls, and it keeps filling whatever page the main window is on.

**Architecture:** A second sandboxed BrowserWindow loads the same renderer bundle at `#scan`. It owns `useCamera`, `useScanLoop` and the overlays. The two windows talk only through a typed message relay in the main process: settings and retries go to the scan window, while state and counted drafts come back. The main window gets a `ScanHubProvider` at the `App` root. It owns the session list, which stays in localStorage `scan.session.v1` via the existing `useScanSession`, plus the scan settings and the last reported scan-window state. That lets drafts land while the Scan page is unmounted. The main window renderer is the only writer of the list.

**Tech Stack:** Electron (main, sandboxed preload), React + TypeScript, TanStack Query, better-sqlite3, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-26-scan-window-design.md`

## Global Constraints

- Run Vitest as `npx vitest run --maxWorkers=2 …`, and the full suite as `npm test -- --maxWorkers=2`. `npm run typecheck` must pass at the end of every task.
- No new dependencies.
- The scan window has `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` and the same preload as the main window, plus `backgroundThrottling: false`.
- Only the scan window ever calls `getUserMedia`. After Task 5 the main window never opens the camera.
- Window title: exactly `Duel Binder — Scan` (em dash).
- Hit price default `20` (dollars), stored in localStorage `scan.hitPrice`. A pull is a hit when its price is `>=` the hit price. A pull with no price is never a hit.
- Overlay timings: normal bar `NORMAL_MS = 4000`, hit `HIT_MS = 8000`, fades `FADE_MS = 250`.
- The video is **not mirrored** (ruling: viewers must read card text the right way round).
- The scan window shows no buttons, menus, list or status text. Only the video, the green outline, the overlays, and the `Camera not available` message.
- Recognition, counting rules (`tracker.ts`, `resolve.ts`), list behaviour and Add to collection are unchanged.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Scan window covered, unfocused or minimized:** scanning must keep running. Today `useScanLoop` skips frames while `document.hidden`. Task 4 removes that and sets `backgroundThrottling: false`, and its test runs frames with `document.hidden === true`.
2. **Main window on another page when a pull is counted:** the row must still land. Task 5 tests this by navigating to Collection, emitting a draft, and coming back to Scan.
3. **Scan window opened (or reloaded) before or after the hub mounts:** the scan window must get its settings. It sends `ready` on mount and the hub answers with `settings`; Task 5 tests that.
4. **Session rows saved before this change** have `options` without `price`. The page must render them, and `pullOf` treats a missing price as no price (Task 3 test).
5. **Saved scan-window bounds on a monitor that's gone:** the window must open at the default size on a visible display (Task 2 test).
6. **Bad hit price input** (empty, `abc`, `-5`, `0`): keep the last valid value (Task 5 test).

---

### Task 1: Price on each scan printing

**Files:**
- Modify: `src/shared/scan/types.ts` (`ScanPrinting`), `src/main/repo/scan.ts` (`SELECT`, `PrintingRow`)
- Test: `tests/main/scan-repo.test.ts`

**Interfaces:**
- Produces: `ScanPrinting.price: number | null`, the printing's own USD price. Every function in `repo/scan.ts` returns it.

**Ruling:** the collection's per-printing rule (`repo/collection.ts` `toView`) without its card-level approximate TCGplayer fallback, because that fallback isn't per printing. For English printings it is `market_price`, then the eBay price in `intl_prices.price`, then `set_price`. Non-English printings use eBay only. Each value goes through `parsePrice` (0, negative or non-finite becomes null). Do it in SQL with `LEFT JOIN intl_prices ip ON ip.printing_id = p.id` and finish with `parsePrice` in TS.

- [ ] **Step 1: Write the failing tests** in `scan-repo.test.ts`, using the file's existing fixture db and setting prices with `UPDATE` on the seeded rows:
  - `'carries each printing\'s own price: market, then eBay, then set price'`. An English printing with `market_price = 12.5, set_price = 3` gives `12.5`. With `market_price = NULL` and an `intl_prices` row with `price = 7` it gives `7`. With only `set_price = 3` it gives `3`.
  - `'a non-English printing is priced from eBay only'`. A `LOB-FR005` printing with `set_price = 3` and no `intl_prices` gives `null`. With `intl_prices.price = 4` it gives `4`.
  - `'a zero or missing price is null'`. `set_price = 0` gives `null`.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/main/scan-repo.test.ts` and expect FAIL (`price` undefined).
- [ ] **Step 3:** Add `price` to `ScanPrinting` (doc comment: "USD, this printing's own price; null when unknown") and to the repo query. Fix any test fixtures elsewhere that build a `ScanPrinting` literal so they typecheck (`tests/renderer/scan-*.test.ts*`): add `price: null`.
- [ ] **Step 4:** Run the scan-repo tests (expect PASS), then `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(scan): carry each printing's price to the scanner`.

### Task 2: The scan window in main, and the message relay

**Files:**
- Create: `src/shared/scanWindow.ts`, `src/main/scanWindow.ts`
- Modify: `src/shared/scan/types.ts` (move the `ScanDraft` interface here from `renderer/.../scan/resolve.ts`; `resolve.ts` re-exports it with `export type { ScanDraft } from '@shared/scan/types'`), `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc/handlers.ts`, `src/main/index.ts`, `tests/renderer/mockApi.ts`
- Test: `tests/main/scan-window.test.ts`, `tests/main/handlers.test.ts`

**Interfaces (produces, in `src/shared/scanWindow.ts`):**
```ts
export type ScanStatus =            // moved from useScanLoop.ts, which re-exports it
  | { kind: 'idle' } | { kind: 'unsure' }
  | { kind: 'added'; name: string; setCode: string | null } | { kind: 'stopped' }
export interface ScanWindowSettings {
  deviceId: string | null
  paused: boolean
  set: { setName: string; language: Language } | null
  defaultRarity: string | null
  hitPrice: number
}
export interface ScanWindowState {
  devices: { deviceId: string; label: string }[]
  /** The camera actually open, from its track settings. */
  openDeviceId: string | null
  cameraError: 'denied' | 'none' | 'lost' | null
  loop: ScanStatus
  artReady: boolean | null
  setUnreadable: boolean
}
export type ToScanWindow =
  | { kind: 'settings'; settings: ScanWindowSettings } | { kind: 'retryCamera' } | { kind: 'retryScan' }
export type FromScanWindow =
  | { kind: 'ready' } | { kind: 'state'; state: ScanWindowState } | { kind: 'draft'; draft: ScanDraft }
export type ScanWindowMessage = ToScanWindow | FromScanWindow
export function isToScanWindow(v: unknown): v is ToScanWindow     // object with a known `kind`
export function isFromScanWindow(v: unknown): v is FromScanWindow
```
`Api` gains:
```ts
scanWindow: {
  /** Opens the scan window, or brings it to the front. */
  open(): Promise<void>
  isOpen(): Promise<boolean>
  toggleFullScreen(): Promise<void>
  send(m: ScanWindowMessage): void
  onMessage(cb: (m: ScanWindowMessage) => void): () => void
  onOpenChange(cb: (open: boolean) => void): () => void
}
```
These are the channels: invoke `'scanWindow:open' | 'scanWindow:isOpen' | 'scanWindow:toggleFullScreen'` (added to `INVOKE_CHANNELS`), and `SCAN_WINDOW_SEND = 'scanWindow:send'` (renderer to main via `ipcRenderer.send`). Main pushes on `SCAN_WINDOW_MESSAGE = 'scanWindow:message'` and `SCAN_WINDOW_OPEN = 'scanWindow:openChanged'` (payload boolean).

`src/main/scanWindow.ts`:
```ts
export interface Rect { x: number; y: number; width: number; height: number }
export interface ScanWindowLike {          // the BrowserWindow surface used; a fake in tests
  webContents: { id: number; send(channel: string, payload: unknown): void }
  isDestroyed(): boolean; isMinimized(): boolean; restore(): void; focus(): void; close(): void
  isFullScreen(): boolean; setFullScreen(on: boolean): void; getNormalBounds(): Rect
  on(event: 'closed' | 'close', cb: () => void): void
}
/** Saved bounds when they overlap a display's work area by at least 100x100 px, else null. */
export function restoreBounds(saved: unknown, workAreas: Rect[]): Rect | null
export interface ScanWindowManager {
  open(): void; isOpen(): boolean; toggleFullScreen(): void
  /** Forwards scan-window messages to the main window and main-window messages to the scan window; drops anything else. */
  relay(senderId: number, message: unknown): void
  close(): void
}
export function createScanWindowManager(deps: {
  create(bounds: Rect | null): ScanWindowLike
  mainWindow(): ScanWindowLike | null
  readBounds(): unknown; writeBounds(r: Rect): void
  workAreas(): Rect[]
}): ScanWindowManager
```
`open()` creates the window once; if it's already open it restores and focuses it. It sends `SCAN_WINDOW_OPEN true` to the main window on create. On `'close'` it writes `getNormalBounds()`; on `'closed'` it forgets the window and sends `SCAN_WINDOW_OPEN false`.

- [ ] **Step 1: Write the failing tests** in `tests/main/scan-window.test.ts`, with a `fakeWindow(id)` that records `send` calls and lets the test fire `close` and `closed`:
  - `'open creates the window once and brings it to the front after that'`. Calling `open` twice calls `create` once; the second call calls `restore` (when minimized) and `focus`.
  - `'tells the main window when the scan window opens and closes'` checks the main fake's sends: `['scanWindow:openChanged', true]`, and after `closed`, `['scanWindow:openChanged', false]`. `isOpen()` follows along.
  - `'relays state and drafts to the main window, settings and retries to the scan window'`. `relay(scanId, {kind:'draft', draft})` reaches the main window as `scanWindow:message`, and `relay(mainId, {kind:'settings', settings})` reaches the scan window.
  - `'drops messages in the wrong direction, from unknown windows, or malformed'`. Cases: `relay(mainId, {kind:'draft', …})`, `relay(scanId, {kind:'settings', …})`, `relay(99, {kind:'ready'})`, `relay(scanId, 'x')`, and `relay(scanId, {kind:'ready'})` while the main window is null. Each sends nothing and doesn't throw.
  - `'remembers its bounds and reopens there'`. On `close`, `writeBounds` gets `getNormalBounds()`; the next `open` passes `restoreBounds(readBounds(), workAreas())` to `create`.
  - `restoreBounds`: on-screen gives the same rect; on a display that's gone (`x: 5000` with work area `{0,0,1920,1080}`) gives `null`; `null`, `{}` and `{x:'a'}` give `null`.
  - `'close closes the scan window'`.
  - In `handlers.test.ts`, follow its existing pattern: the three `scanWindow:*` handlers call the dep.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/main/scan-window.test.ts tests/main/handlers.test.ts` and expect FAIL.
- [ ] **Step 3: Implement `src/shared/scanWindow.ts`, `src/main/scanWindow.ts`, the `Api`/channel additions, the preload (`send` uses `ipcRenderer.send(SCAN_WINDOW_SEND, m)`; the two `on*` use the existing `subscribe`), and the handlers dep** `scanWindow: Pick<ScanWindowManager, 'open' | 'isOpen' | 'toggleFullScreen'>`. Add `scanWindow` to `createMockApi`: `open`/`toggleFullScreen` are resolving `vi.fn`s, `isOpen` resolves `false`, `send` is `vi.fn()`, and the `on*` fns return unsubscribe no-ops.
- [ ] **Step 4: Wire it in `src/main/index.ts`.** `createScanBrowserWindow(bounds)` builds the window. It has `width: 1280, height: 720` (or `bounds`), `minWidth: 480, minHeight: 270`, `title: 'Duel Binder — Scan'`, `backgroundColor: '#000000'`, `autoHideMenuBar: true`, the native frame, the Linux `icon`, and the main window's `webPreferences` plus `backgroundThrottling: false`. It also needs:
  - `page-title-updated`: `preventDefault()`;
  - the same `will-navigate` guard and the deny `setWindowOpenHandler`;
  - `before-input-event`: `F11` toggles full screen, and `Escape` leaves full screen;
  - it loads `ELECTRON_RENDERER_URL + '#scan'` in dev, or `loadFile(…index.html, { hash: 'scan' })`.

  Then create the manager with `screen.getAllDisplays().map(d => d.workArea)`, with bounds in `join(userData, 'scan-window.json')` (read and parse in try/catch; a bad file means null). Register `ipcMain.on(SCAN_WINDOW_SEND, (e, m) => manager.relay(e.sender.id, m))`, pass the manager to `createHandlers`, and call `manager.close()` from the main window's `closed` handler. `restrictPermissions` needs no change: the `#scan` page is the same origin.
- [ ] **Step 5:** Run the tests (expect PASS) and `npm run typecheck`.
- [ ] **Step 6:** Commit `feat(scan): a separate scan window and a relay between the windows`.

### Task 3: Pull overlays, as pure logic

**Files:**
- Create: `src/renderer/src/features/scan/window/overlay.ts`
- Test: `tests/renderer/scan-overlay.test.ts`

**Interfaces (produces):**
```ts
export const NORMAL_MS = 4000, HIT_MS = 8000, FADE_MS = 250
export interface Pull {
  key: number; name: string; imageId: number
  setCode: string | null; rarity: string | null; price: number | null; hit: boolean
}
/** A Pick printing draft shows only its name and is never a hit; the price is the drafted printing's. */
export function pullOf(d: ScanDraft, hitPrice: number, key: number): Pull
export interface OverlayState { showing: Pull | null; until: number; pending: Pull | null }
export const NO_OVERLAY: OverlayState
/** A new pull shows at once, except that a normal pull waits (latest only) behind a showing hit. */
export function pushPull(s: OverlayState, p: Pull, now: number): OverlayState
/** Expires what's showing at `until`; a waiting pull then shows for NORMAL_MS from now. */
export function tickOverlay(s: OverlayState, now: number): OverlayState
/** The card outline in video pixels: the loop's quad is in centre-crop pixels. */
export function outlineInVideo(o: { quad: Quad; width: number; height: number }, videoWidth: number, videoHeight: number): [number, number][]
```
`pushPull` rule: if `s.showing?.hit && now < s.until && !p.hit`, the result is `{ ...s, pending: p }`. Otherwise it is `{ showing: p, until: now + (p.hit ? HIT_MS : NORMAL_MS), pending: p.hit ? s.pending : null }`. `outlineInVideo` adds `centreCrop(videoWidth, videoHeight)`'s `x, y` to each point.

- [ ] **Step 1: Write the failing tests:**
  - `pullOf`: a certain draft priced 12.5 with `hitPrice` 20 gives the full pull with `hit: false`. At 20 it gives `hit: true` (the boundary). A `pick-printing` draft priced 50 gives `setCode/rarity/price: null, hit: false`. A `check-rarity` draft shows its picked rarity and that printing's price. A draft whose option has no `price` key (an old saved row) gives `price: null, hit: false`.
  - `pushPull`/`tickOverlay`, with explicit `now` values:
    - a normal pull replaces a normal pull at once;
    - a normal pull during a hit waits, the hit stays until `HIT_MS`, then the waiting one shows for `NORMAL_MS`;
    - two normals during a hit leave only the second waiting;
    - a hit during a hit replaces it and keeps the waiting normal;
    - a hit replaces a showing normal;
    - with nothing waiting, `tickOverlay` at `until` gives `NO_OVERLAY`.
  - `outlineInVideo`: a 1920x1080 video with quad point `[0,0]` gives `[555,0]` (the documented crop).
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/renderer/scan-overlay.test.ts` and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run (expect PASS) and `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(scan): overlay rules for pulls and hits`.

### Task 4: The scan window's page

**Files:**
- Create: `src/renderer/src/features/scan/window/ScanWindowApp.tsx`, `src/renderer/src/features/scan/window/PullOverlay.tsx`, `src/renderer/src/features/scan/window/useOverlay.ts`
- Modify: `src/renderer/src/main.tsx` (when `location.hash === '#scan'`, render a lazily imported `ScanWindowApp` inside the same `QueryClientProvider` instead of `App`), `src/renderer/src/features/scan/useScanLoop.ts` (drop `document.hidden` from the tick guard and say why in a comment: the scan window is often covered while streaming)
- Test: `tests/renderer/scan-window.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`window.api.scanWindow`, the message types) and Task 3 (`overlay.ts`).
- Produces: `ScanWindowApp({ engineFactory = defaultEngine }: { engineFactory?: () => ScanEngine })`. Move `defaultEngine` to `engine.ts` as an export so `ScanPage` no longer needs it after Task 5. `useOverlay(): { overlay: Pull | null; push(p: Pull): void; clear(): void }` uses timers driven by `pushPull`/`tickOverlay`.

**Behaviour:**
- On mount, set `document.title = 'Duel Binder — Scan'` and send `{kind:'ready'}`.
- Don't open the camera until the first `settings` message arrives. After that it calls `useCamera(settings.deviceId)`. `retryCamera` calls `camera.retry()` and `retryScan` calls `loop.retry()`.
- Fetch the picked set's printings with the same `useQuery` key as today's Scan page (`['scan','setPrintings', setName, language]`). A failed fetch means it scans as any set and reports `setUnreadable: true`.
- Run `useScanLoop` with `running: camera.stream !== null && !settings.paused`.
- `onDraft` sends `{kind:'draft', draft}` and pushes `pullOf(draft, settings.hitPrice, n++)`.
- Pausing calls `overlay.clear()`.
- Send `{kind:'state', state}` whenever the serialized `ScanWindowState` changes. Devices come from `camera.devices` as `{deviceId, label}`.
- **Layout:**
  - The video fills the window (`object-cover`, not mirrored) on black.
  - The outline is an SVG over it with `viewBox="0 0 videoWidth videoHeight"` and `preserveAspectRatio="xMidYMid slice"`, with points from `outlineInVideo`, stroke `#34d399`.
  - A camera error, or no stream once settings have arrived, shows a dark screen with only `Camera not available`.
  - Double-clicking the video calls `api.scanWindow.toggleFullScreen()`.
  - There are no buttons or other text.
- **`PullOverlay`:**
  - The normal bar is a lower third, a dark translucent bar. It holds a `CardArt` thumbnail (`imageId`, size `small`, alt `""`), the name, the set code, the rarity, and the price from `formatUsd` in green, large, on the right. Leave out the parts that are null.
  - The hit is a centred moment at the top: the rarity in small spaced capitals in gold, the name large, the price, and a soft gold radial glow behind.
  - Opacity transitions over `FADE_MS`. The outgoing overlay stays mounted until its fade ends.
  - Text sizes use `vw`/`clamp` so they scale with the window and stay legible at 720p.
  - Give the bar `role="status"` with `aria-label="Pull"` and the hit `aria-label="Hit"` for tests.

- [ ] **Step 1: Write the failing tests** in `scan-window.test.tsx`. Copy the camera stubs, fake engine and frame helpers from `scan-page.test.tsx` (factor them into `tests/renderer/scanFakes.ts` and import them from both files). Add a `fakeBridge()` helper there that returns `api` overrides for `scanWindow`, `emit(m)` (calls the registered `onMessage` callbacks), `emitOpen(b)`, and `sent` (the `send` calls). Render `ScanWindowApp` with `fakeBridge` and emit `settings` with `hitPrice: 20`. Move these existing `Scan page` tests here, asserting on `sent` drafts and state instead of list rows:
  - recognized card;
  - far-art lowered;
  - the two rarity-by-look tests;
  - centre crop and outline (now in video space);
  - no outline round a far thing;
  - the four fingerprint tests;
  - set candidates;
  - set unreadable (now `state.setUnreadable`);
  - re-init after failure;
  - stopped then retry (via `{kind:'retryScan'}`);
  - pausing stops analysis (via `settings.paused`);
  - camera denied, none and lost (via `state.cameraError` and the `Camera not available` text), and Try again (via `{kind:'retryCamera'}`).

  New tests:
  - `'waits for settings before opening the camera'`: `getUserMedia` isn't called until `settings` arrives, and `{kind:'ready'}` is sent on mount.
  - `'a counted pull shows the bar, then fades out'`: the Pull status shows name, set code, rarity and `$12.50`, and it's gone after `NORMAL_MS + FADE_MS` (fake timers).
  - `'a pull at the hit price gets the hit moment'`: the `Hit` label is present at price `20`.
  - `'a Pick printing pull shows only the name'`.
  - `'shows no app UI'`: `queryAllByRole('button')` is empty and no status-bar text like `Hold a card up` appears.
  - `'keeps scanning while the window is hidden'`: with `document.hidden` stubbed `true`, frames are still analysed.
  - `'sets the window title'`.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/renderer/scan-window.test.tsx` and expect FAIL.
- [ ] **Step 3:** Implement. Leave `ScanPage` as it is in this task; its old camera tests keep passing until Task 5.
- [ ] **Step 4:** Run `npx vitest run --maxWorkers=2 tests/renderer/scan-window.test.tsx tests/renderer/scan-page.test.tsx tests/renderer/scan-overlay.test.ts` (expect PASS) and `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(scan): the scan window shows the camera and each pull`.

### Task 5: The hub, and the Scan page as list and controls

**Files:**
- Create: `src/renderer/src/features/scan/ScanHub.tsx`
- Modify: `src/renderer/src/App.tsx` (on desktop, wrap what `App` returns in `ScanHubProvider`, above the sign-in gate; the web build never mounts it), `src/renderer/src/features/scan/ScanPage.tsx`
- Test: `tests/renderer/scan-page.test.tsx`

**Interfaces (produces):**
```ts
export interface ScanHub {
  session: ReturnType<typeof useScanSession>
  /** The row last counted, for 1.5 s, to highlight. */
  fresh: string | null
  open: boolean
  /** Last state the open scan window reported; null while closed or before it reports. */
  state: ScanWindowState | null
  settings: ScanWindowSettings
  setSettings(patch: Partial<ScanWindowSettings>): void
  openWindow(): void
  retryCamera(): void
  retryScan(): void
}
export function ScanHubProvider({ children }: { children: React.ReactNode }): React.JSX.Element
export function useScanHub(): ScanHub
```

**Hub behaviour:**
- Settings start from localStorage (`scan.set`, `scan.defaultRarity`, `scan.hitPrice` with default `20`, and `deviceId` from `rememberedCamera()`), with `paused: false`.
- `setSettings` writes the persisted ones back. `paused` isn't persisted and resets to `false` when the window closes.
- It sends `{kind:'settings'}` on every settings change, on a `ready` message, and when `onOpenChange(true)` fires.
- It reads `isOpen()` on mount.
- A `draft` message calls `session.add` and sets `fresh` (`HIGHLIGHT_MS = 1500`, moved from `ScanPage`).
- A `state` message stores the state; when the window closes, `state` becomes null.

**Scan page:**
- **Header:** the title, the Set picker, and the Camera select. The camera options come from `hub.state.devices`; the select is disabled when the window is closed or there are no devices. Picking a camera calls `setSettings({deviceId})` and then `retryCamera()`, and keeps the `UNNAMED_CAMERA` handling.
- **Controls row:**
  - `Open scan window` (or `Show scan window` when open);
  - `Pause`/`Resume` (disabled when closed or there's no open camera);
  - `New scans as`;
  - `Hit price`, a labelled `$` number input. It commits on blur or Enter, and only a finite value `> 0` is accepted; anything else reverts to the last value.
- **Status line:**
  - When closed: `The scan window is closed. Open it to start scanning.`
  - On a camera error: the `CAMERA_MESSAGES` text, reworded from "reopen Scan" to "reopen the scan window", with `Try again` calling `retryCamera` for `none` and `lost`.
  - Otherwise `statusText(state.loop)`, plus `Retry` calling `retryScan` when stopped.
  - The `SET_UNREADABLE` and `NO_FINGERPRINTS` notices come from the state.
- **List section:** unchanged, now full width.
- Remove all camera, loop, video and engine code from `ScanPage` (along with its `engineFactory` prop).

- [ ] **Step 1: Rewrite `scan-page.test.tsx`.** Delete the tests moved in Task 4. Keep the nav test and the list tests: rarity dropdown, picked printing, New scans as remembered, Add, the row locked during Add, Add disabled, and Clear asks. They seed rows through localStorage or a `draft` message from `fakeBridge`, rendering with `ScanHubProvider` around `ScanPage`. New tests:
  - `'Open scan window opens it, and says Show once open'`.
  - `'a pull counted while on another page is on the list when you come back'`: render `App` signed in, open Scan, go to Collection, `emit({kind:'draft', …})`, return to Scan, and the row is there with quantity 1.
  - `'sends settings when the scan window says it is ready, and on every change'`: `ready` leads to a sent `settings`; picking a set sends `settings` with that set; Pause sends `paused: true`.
  - `'shows the scan window\'s status, camera errors with Try again, and Retry when stopped'`.
  - `'hit price is remembered and rejects bad input'`: typing `35` and blurring stores `scan.hitPrice = '35'` and sends `hitPrice: 35`; then `''`, `abc`, `0` and `-5` each revert to `35`.
  - `'says the scan window is closed, and Pause is disabled'`.
  - Rework the existing `'stays responsive with thousands of sets while frames come in'` into `…while pulls come in` with 50 `draft` messages.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/renderer/scan-page.test.tsx` and expect FAIL.
- [ ] **Step 3:** Implement the hub, the App wiring and the page.
- [ ] **Step 4:** Run `npm test -- --maxWorkers=2` and `npm run typecheck`, and expect all to PASS. Confirm `grep -rn "getUserMedia\|useCamera\|useScanLoop" src/renderer/src` shows them only under `features/scan/useCamera.ts`, `useScanLoop.ts` and `window/`.
- [ ] **Step 5:** Commit `feat(scan): the Scan page is the list and controls for the scan window`.

### Task 6: Try it for real (with the owner)

Not code. The controller asks the owner to run `npm run dev` on Linux and check these, then reports the results:
- [ ] Open the scan window from Scan. The camera shows, and the title in Discord's window picker is `Duel Binder — Scan`.
- [ ] F11 and double-click go full screen, and Escape leaves it. Close and reopen: it comes back at its last size and place.
- [ ] Share it in Discord while ripping a few cards. The bar and the hit moment read well on the viewer's side, the text isn't mirrored, and the video is smooth.
- [ ] Browse Collection mid-rip. Pulls keep counting and the stream doesn't stop, also with the scan window covered by another window.
- [ ] Closing the scan window stops the camera (the camera light goes off) and keeps the list. Closing the main window closes both.

Fix whatever this turns up through the normal fix loop before the final review.
