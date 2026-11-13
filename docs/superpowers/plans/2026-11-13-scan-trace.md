# Scan Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin-only switch that makes the installed desktop app write a per-frame trace of how scan identification went (JSONL + sampled JPEGs) to `userData/scan-trace/`, plus a script that sorts a session's misses into reasons.

**Architecture:** The renderer's scan loop (`useScanLoop.ts`) builds one trace line per analysed frame from the raw signals, the outcome and a recorder wrapped around the resolver's `lookups`; it sends the line (and sometimes the frame's JPEG) over a new `scan:trace` IPC channel. Main refuses unless the signed-in account is admin, names the top art matches from the catalog, and appends to `scan-trace/<session>/trace.jsonl` with caps. A standalone `tsx` script summarises a session folder.

**Tech Stack:** Electron (main + preload), React/TypeScript renderer, better-sqlite3, vitest.

**Spec:** `docs/superpowers/specs/2026-11-13-scan-trace-design.md`

## Global Constraints

- Desktop only: nothing for phone (`src/phone`) or web (`src/renderer/src/web/httpApi.ts` gets a no-op `trace` / `traceDir` so it still type-checks).
- Nothing leaves the machine: no network calls added.
- With the switch off, the loop does no extra work: no JPEG encode, no lookups wrapper, no IPC.
- Switch: localStorage key `scan.trace` (`'1'` = on), shown only when `user.admin`; off by default.
- Folder: `userData/scan-trace/<session>/trace.jsonl` + `NNNN.jpg` (4-digit, from `0000`). Session id = ISO start time with `:` and `.` replaced by `-` (as `debugFrames.ts` does), validated in main against `/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/`.
- Main refuses `scan:trace` for a non-admin account; the on/off switch itself lives only in the renderer (main can't read localStorage) — my call, narrowing the spec's "switch on and admin".
- "Whether the fingerprint file is complete" is recorded as `fpCount` (the local file's count); the summary script judges completeness per card — my call, since the client never learns the catalog's total.
- Caps: newest **20** sessions kept (older folders deleted when a new session folder is made); at most **400** JPEGs per session (lines keep being written past it, without `frame`).
- JPEG kept on every **3rd** frame with a card found, plus every frame whose outcome kind differs from the previous traced frame's. Quality 0.92 (as `debugShot`).
- A trace line is at most **8 KB**; lookup results are trimmed to fit (see Task 2).
- The dev-build `scan-debug` path (`debugFrames.ts`, `KEEP_FRAMES`) stays as is.
- Run vitest with `--maxWorkers=2`. Typecheck with `npm run typecheck:web` and `npm run typecheck:node` (`npm run typecheck` stops at resvg).
- Work in the worktree `/var/tmp/trace-wt` on branch `feat/scan-trace`; never commit in the main checkout.

## Review Focus

- Non-admin or signed-out account while `scan.trace` is still `'1'` (switched account): main must refuse, the loop must swallow the rejection and keep scanning. Test in Task 1 (refusal) and Task 3 (loop keeps going on a rejected `trace`).
- A lookup that throws or times out inside the recorder: the error must reach the resolver unchanged and be recorded as `{ error }`. Test in Task 2.
- Huge lookup results (Magic `printingsOfArt` can return hundreds of printings): line stays ≤ 8 KB. Test in Task 2.
- Disk filling: 401st JPEG in a session is not written, 21st session prunes the oldest. Test in Task 1.
- Game switch / set change mid-session: lines carry the new `game` / `setKey`; same session folder. Covered by the line builder taking them per frame (Task 2).

---

### Task 1: Main-side trace writer and IPC channels

**Files:**
- Create: `src/main/scan/scanTrace.ts`
- Modify: `src/shared/ipc.ts` (Api `scan` type + `INVOKE_CHANNELS`), `src/preload/index.ts`, `src/main/ipc/handlers.ts` (next to `'scan:debugFrame'`, ~line 267), `src/renderer/src/web/httpApi.ts` (no-ops)
- Test: `tests/main/scan-trace.test.ts`, `tests/main/handlers.test.ts`

**Interfaces:**
- Produces:
  - `createScanTrace(opts: { root: string; maxSessions?: number; maxFrames?: number }): ScanTraceWriter` with defaults 20 / 400
  - `interface ScanTraceWriter { write(session: string, line: Record<string, unknown>, jpeg?: ArrayBuffer): Promise<string | null>; root: string }` — returns the JPEG file name written, or null (no JPEG, or over the cap). Appends `JSON.stringify({ ...line, frame })` + `\n`.
  - `describeArt(db: Database.Database, imageIds: number[]): { imageId: number; name: string; sets: string[] }[]` — card name and up to 3 distinct `set_code`s per image (via `card_images` → `cards` → `card_printings`), in input order, unknown ids left out.
  - Api: `scan.trace(session: string, line: string, jpeg?: ArrayBuffer): Promise<void>` and `scan.traceDir(): Promise<string>` (returns `root`); channels `'scan:trace'`, `'scan:traceDir'`; plus `scan.openTraceDir(): Promise<void>` → `shell.openPath(root)`, channel `'scan:openTraceDir'`.

- [ ] **Step 1: Write failing tests** in `tests/main/scan-trace.test.ts` (temp dir via `mkdtempSync`):
  - `writes lines and numbered frames`: two writes, second with a JPEG → `trace.jsonl` has 2 lines, second has `frame: '0000.jpg'`, file exists.
  - `stops keeping frames past maxFrames`: `maxFrames: 2`, three JPEG writes → third returns null, 3 lines, 2 jpgs, third line has no `frame`.
  - `prunes the oldest sessions`: `maxSessions: 2`, write to sessions `2026-11-13T01-00-00-000Z`, `…T02…`, `…T03…` → only the last two folders remain.
  - `rejects a bad session id`: `write('../x', {})` rejects.
  - `describeArt names images` using `seededDb()` from `tests/main/helpers`: a seeded image id → its card name and set codes; an unknown id is left out.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 tests/main/scan-trace.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `src/main/scan/scanTrace.ts`. Count frames per session in a `Map`, seeded from the folder's `*.jpg` count the first time a session is seen; prune on first sight of a new session (sort folder names, delete all but the newest `maxSessions` with `rm -r`).
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Write failing handler tests** in `tests/main/handlers.test.ts`:
  - `scan:trace refuses a non-admin account`: account status user without `admin` → rejects with `'Not found'`, nothing written.
  - `scan:trace writes for an admin with named art`: admin user, line `{"art":[[<seeded imageId>,12]]}` → written line has `art[0]` = `{ imageId, distance: 12, name, sets }`.
- [ ] **Step 6: Implement the handlers.** `'scan:trace'`: check `account.status().user?.admin` (same message as `adminHandlers.ts:46`), check `typeof line === 'string' && line.length <= 8192`, `jpeg` undefined or `ArrayBuffer`, `JSON.parse` the line, replace `art` (`[imageId, distance][]`) with `describeArt` results merged with distances, then `writer.write`. The writer is created in `createHandlers` with `root = join(app.getPath('userData'), 'scan-trace')` (inject `root` through the deps object the tests already build, following how `ripCapture` is passed). Preload and `httpApi.ts` (resolving no-ops / `''`) follow the existing `debugFrame` pattern.
- [ ] **Step 7: Run** `npx vitest run --maxWorkers=2 tests/main/scan-trace.test.ts tests/main/handlers.test.ts` — expect PASS; `npm run typecheck:node` and `npm run typecheck:web` — no new errors.
- [ ] **Step 8: Commit** `feat(scan): admin scan trace writer and IPC`.

### Task 2: Renderer trace pieces (switch, lookups recorder, line builder, sampler)

**Files:**
- Create: `src/renderer/src/features/scan/scanTrace.ts`
- Test: `tests/renderer/scan-trace.test.ts`

**Interfaces:**
- Consumes: `ResolveContext['lookups']` (`resolve.ts:79`), `FrameSignals` (`engine.ts:18`), `ScanOutcome` (`resolve.ts:36`).
- Produces:
  - `scanTraceOn(): boolean`, `setScanTraceOn(on: boolean): void` — localStorage `scan.trace`, same try/catch shape as `lib/scanPing.ts`.
  - `newTraceSession(now?: Date): string` — the session id format above.
  - `type TraceCall = { m: string; args: unknown; out?: unknown; error?: string; ms: number }`
  - `recordLookups<L extends object>(lookups: L): { lookups: L; calls: TraceCall[] }` — a wrapper whose every function property records its call and passes results and errors through unchanged.
  - `interface TraceFrame { seq: number; game: GameId; setKey: string; sets: string[]; filterLanguage: string | null; finishLock: string; camera: string; size: [number, number]; raw: FrameSignals; outcome: ScanOutcome; counted: boolean; calls: TraceCall[]; reads: { language?: unknown; localName?: unknown }; fpCount: number; ms: Record<string, number> }`
  - `traceLine(f: TraceFrame): string` — JSON with: `t` (Date.now), `seq`, `game`, `setKey`, `sets`, `filterLanguage`, `finishLock`, `camera`, `size`, `found`, `quad`, `artVia`, `artBack`, `art` (top 5 `[imageId, distance]`), `fpCount`, `calls`, `reads`, `outcome` (`'none' | 'far' | 'unsure' | 'recognized'`), and for recognized `card: { cardId, printingId, rarity, finish, guess }` (from `outcome.item`), `counted`, `ms`.
  - `createTraceSampler(): { take(found: boolean, outcome: string): { line: boolean; jpeg: boolean } }` — rules below.

- [ ] **Step 1: Write failing tests** in `tests/renderer/scan-trace.test.ts`:
  - `switch round-trips`: off by default; `setScanTraceOn(true)` → `scanTraceOn()` true and `localStorage['scan.trace'] === '1'`; off removes the key.
  - `newTraceSession format`: `newTraceSession(new Date('2026-11-13T08:16:58.123Z'))` === `'2026-11-13T08-16-58-123Z'`.
  - `recordLookups records calls and results`: wrapped `matchName` resolving `{cardId:1,name:'X',score:0.9}` → `calls[0]` has `m:'matchName'`, `args:['X']`, that `out`.
  - `recordLookups passes errors through`: wrapped fn rejecting `new Error('boom')` → caller sees the same error; `calls[0].error === 'boom'`.
  - `traceLine stays under 8 KB`: a `printingsOfArt` call whose `out` is 500 printings → `traceLine(...)` length ≤ 8192 and that call's `out` is `{ count: 500, first: [...3 items] }`.
  - `traceLine outcome far`: outcome `{ kind: 'none', far: true }` → `outcome: 'far'`.
  - `sampler`: sequence of `take(false,'none')` ×3 → `line` true only on the first; then `take(true,'unsure')` ×4 → `jpeg` true on 1st (outcome changed) and 3rd (every 3rd found frame, counting found frames from 1); `take(true,'recognized')` → `jpeg` true (outcome changed); after another `take(false,'none')` → `line` true again (new no-card stretch).
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 tests/renderer/scan-trace.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** `scanTrace.ts`. Trimming: if the JSON is over 8192, replace each call's array `out` longer than 3 with `{ count, first: out.slice(0, 3) }`; if still over, drop `quad` then cut `calls` to the last 10 and set `callsCut: true`.
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat(scan): scan trace switch, lookups recorder and line builder`.

### Task 3: Wire the trace into the scan loop

**Files:**
- Modify: `src/renderer/src/features/scan/useScanLoop.ts` (loop start ~line 417 where `debugFrames: 0` is set; frame body ~1009–1150)
- Test: `tests/renderer/scan-trace-loop.test.ts` (use the fakes in `tests/renderer/scanFakes.ts` and the setup of `tests/renderer/scan-engine.test.ts` / existing `useScanLoop` tests — find the one that drives frames with `rg -l "useScanLoop" tests/renderer`)

**Interfaces:**
- Consumes: everything Task 2 produces; `api.scan.trace`, `api.scan.fingerprintStatus` (Task 1).

- [ ] **Step 1: Write failing tests:**
  - `traces each frame when the switch is on`: `setScanTraceOn(true)`, drive two frames (one found + recognized) → `api.scan.trace` called; first arg matches the session format and is the same for both; parsed line has `outcome` and `calls` including the resolver's lookups.
  - `does nothing when the switch is off`: no `trace` calls, and the lookups passed to the resolver are `api.scan` itself (identity).
  - `keeps scanning when trace is refused`: `trace` rejects → later frames still resolve (outcome shown) and no unhandled rejection.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement.** At loop start: `const trace = scanTraceOn() ? { session: newTraceSession(), sampler: createTraceSampler(), fpCount: 0 } : null`; when on, read `api.scan.fingerprintStatus(o.game)` count once per game into `fpCount`. Per frame when `trace`: `recordLookups(api.scan)` for `lookups`; wrap the `readLanguage` / `readLocalName` / `cardLanguage` callbacks to store their results in `reads`; after the outcome, `sampler.take(raw.found, kind)`; when `line`, build `traceLine` (camera label and size from the loop's existing camera/frame values; `ms` from `raw.ms` plus lookup time) and, when `jpeg`, encode the frame like `debugShot` does (but independent of `KEEP_FRAMES`) and call `void api.scan.trace(session, line, jpeg).catch(() => undefined)`. Whether a frame's JPEG is wanted is only known after analysis, but the engine takes the bitmap: so when trace is on, clone it first with `createImageBitmap(frame)` (cheap, no encode), then after `take` either encode the clone like `debugShot` (OffscreenCanvas, JPEG 0.92) or just `close()` it. This is independent of `KEEP_FRAMES`.
- [ ] **Step 4: Run** the loop tests and `tests/renderer/scan-*.test.*` — expect PASS.
- [ ] **Step 5: Commit** `feat(scan): trace scan frames when the admin switch is on`.

### Task 4: Options panel switch

**Files:**
- Create: `src/renderer/src/features/scan/ScanTraceToggle.tsx`
- Modify: `src/renderer/src/features/scan/ScanPage.tsx` (inside `<ScanOptions>`, ~line 125)
- Test: `tests/renderer/scan-trace-toggle.test.tsx`

**Interfaces:**
- Consumes: `scanTraceOn`/`setScanTraceOn` (Task 2), `api.scan.traceDir` / `openTraceDir` (Task 1), `useAccountUser()` from `@/lib/accountUser`.

- [ ] **Step 1: Write failing tests:**
  - `hidden for non-admins`: user without `admin` → no "Scan trace" button.
  - `admin toggles and sees the folder`: admin → button "Scan trace off"; click → `localStorage['scan.trace'] === '1'`, label "Scan trace on", text shows the `traceDir()` path, "Open folder" calls `openTraceDir`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** like `ScanSoundToggle.tsx` (outline `Button size="sm"`, `aria-pressed`), with a lucide `FileSearch` icon; title "Writes how each frame is identified to a folder on this computer (admin)". Under it, when on: the path in muted `text-xs` and an "Open folder" link-style button. Copy says it applies from the next time scanning starts.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(scan): admin Scan trace switch in scan options`.

### Task 5: Summary script

**Files:**
- Create: `scripts/scan/trace-summary.ts`, with the logic in an exported `summarize(lines: TraceLineJson[], hasArt: (imageId: number) => boolean, imagesOfCard: (cardId: number) => number[]): Summary`
- Test: `tests/main/scan-trace-summary.test.ts`

**Interfaces:**
- CLI: `npx tsx scripts/scan/trace-summary.ts <session dir> [--user-data ~/.config/duel-binder]` — reads `trace.jsonl`, the game's `scan/fingerprints-<game>.bin` (`fingerprints.bin` for ygo) via `src/shared/scan/fingerprintFile.ts`, and `collection.db` read-only for `card_images`.
- `Summary = { frames: number; outcomes: Record<string, number>; reasons: { reason: Reason; frames: string[]; cards?: string[] }[] }`; `Reason = 'no-outline' | 'art-not-in-file' | 'art-far' | 'unsure'`.

- [ ] **Step 1: Write failing tests** for `summarize` (my call on the rules, from what a line holds):
  - `no-outline`: `found:false` lines with `outcome:'none'` → counted under `no-outline`.
  - `art-not-in-file`: a not-recognized line whose `calls` include a `matchName` (or `printingsByCode`) result naming card 7, where `imagesOfCard(7)` are all `!hasArt` → `art-not-in-file`, `cards` includes `'7'`.
  - `art-far`: found, `outcome:'none'`, best art distance present, no named card → `art-far`.
  - `unsure`: `outcome:'unsure'` → `unsure`.
  - recognized lines only counted in `outcomes`.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 tests/main/scan-trace-summary.test.ts` — FAIL.
- [ ] **Step 3: Implement**; the CLI prints outcome counts, then each reason with its count and up to 10 frame names (the `frame` JPEG when present, else `seq`), plus `fpCount` from the last line.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(scan): trace summary script`.

### Task 6: Whole-branch check

- [ ] Run `npx vitest run --maxWorkers=2 tests/main tests/renderer` — all pass; `npm run typecheck:node`, `npm run typecheck:web`, `npm run typecheck:phone` — no new errors versus `origin/main`; `npm run lint` if the repo has it.
- [ ] Push `feat/scan-trace`, open a PR (desktop-only, no portal deploy). Hand it to the owner for the installed-build check (needs a tagged release; the switch only exists in a packaged build after release).
