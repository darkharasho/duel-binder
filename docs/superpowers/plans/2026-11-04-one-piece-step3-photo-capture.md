# One Piece Step 3: Photo Capture in the Phone App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tester (the friend, or the owner) opens "Contribute photos" in the phone app, types a
card number (with set-code autocomplete), taps the version in his hand, picks how it's held, and
shoots. Each full-resolution frame uploads with its own label to a private R2 prefix, queues
offline and can be deleted. `/admin` counts the photos, and a script pulls them into
`~/scan-capture/shots-op/` with a truth file the replay tests can read.

**Architecture:**
- **Shared wire module** `src/shared/training.ts`: the holders, the caps, the label and its
  validator, the R2 key, the admin row and truth-row shapes. The phone, the Worker and the pull
  script all import it, so the three can't drift apart.
- **Worker** `workers/portal/src/training.ts`: tester-only upload, delete and summary routes
  under `/api/training/`. Labels go in a new DO table, `training_photos` (migration `server-37`),
  and the JPEG goes in R2 under `training/<game>/<accountId>/<clientId>.jpg`. Admin routes under
  `/admin/training` give the stats (owner session or token) and the labels and photos (token
  only, for the script). There is a new **Photos** tab on `/admin`.
- **Phone:**
  - The store (data worker, which holds the Bearer token) gets three training calls.
  - An IndexedDB outbox on the page holds the shots until they upload. It is keyed by a
    client-made UUID, so a retry is idempotent.
  - `ContributeScreen` opens from Settings. It uses the scanner's `useCamera` (same device, same
    4K ideal constraints) and a plain `<video>`, with no scan loop.
  - Numbers are typed, normalized by `normalizeOpNumber`, and looked up through the existing
    `scan:printingsByCode` plus `cards:get`, which gives each printing's own `artImageId`.
  - A new `scan:numberPrefixes` channel feeds the autocomplete.
- **Pull script** `scripts/scan/pull-training.ts`: pages through the labels, downloads any
  missing JPEGs and writes `~/scan-capture/op-truth.json`.

**OCR scope: typed numbers only in this plan. The One Piece scan profile and number OCR move to
a follow-up ("step 3b"), replayed against the friend's first photos.** This is a **deviation from
the spec**, which puts the scan profile and number OCR in step 3 and allows typed-only only once
OCR has proven hard. It is not covered by the spec's fallback: the owner signs it off through the
hand-off note (Task 9 Step 5) and the PR body, which both name step 3b as the next step, with step
3b's acceptance being a replay against the friend's first photos. The reasons:
- The tesseract queue and band cutter can be reused as they are:
  - `CODE_CHARS` already covers `OP05-119`.
  - `analyze()` finds an outline and cuts code bands with no fingerprints.
- What isn't reusable is the op `ScanProfile`: the outline finder's windows and inner frames,
  and the number band. These have to be measured and tuned on real held-card photos, and those
  photos only exist once this feature ships.
- Reading codes outside `useScanLoop`'s resolver would also be new loop code with nothing to
  test it on tonight.
- `normalizeOpNumber` (Task 2) is the parser OCR will reuse.
- The full frames stored here are the OCR's test set.

**Tech Stack:** TypeScript, React + Tailwind (phone), sqlite-wasm (phone store), IndexedDB
(outbox), Durable Object SQLite + R2 (portal), Vitest (jsdom for the phone, better-sqlite3 for
`tests/portal`, workerd for `workers/portal/test`).

**Spec:** `docs/superpowers/specs/2026-11-04-one-piece-design.md`, section "Step 3: photo capture
in the phone app", plus "Access: owner plus testers", "Anti-goals" and "Constraints". This plan
builds on step 1 (`game_testers`, `gamesFor`, `access: 'testers'`) and step 2 (op printings with
`set_code` = printed number and `set_rarity_code` = Bandai entry id, `printingArtImageId`). Plan
against `main` after `feat/one-piece-catalog` merges.

**Test commands:**
- `npm test -- <files>`. The root script already passes `--maxWorkers=2`.
- `npm --prefix workers/portal test` (real DO SQLite and R2).
- `npm run typecheck && npm --prefix workers/portal run typecheck && npm run lint`.
- Known pre-existing noise: the portal typecheck's `POKEMON_SWEEP_DAILY_CALLS` error and about
  2,240 repo-wide lint problems. Judge only the files you touch.

## Builder's calls (final for step 3)

1. **Where the screen lives.** There is a "Contribute photos" row in phone Settings, shown only
   when the user's available games include a game whose `access` is `'testers'` (the server only
   lists such a game for its testers and the owner). Tapping it switches the active game to that
   game, the way the game switch does (`useGame().setGame`), and opens the screen full screen.
   The open state and the screen live in `Shell` (`PhoneShell.tsx`), outside `PageSwitch`:
   `PageSwitch` keys every page by game, so a screen inside Settings would unmount on the switch.
   The screen is not on the One Piece Home and is not a new `Page`, so the desktop `Page` union
   doesn't change.
2. **Other games' testers.** Contribute is off for Yu-Gi-Oh and Pokémon. Both the client and the
   server require `GAMES[game].access === 'testers'`.
3. **Holders.** The wire ids are `'bare' | 'sleeve' | 'toploader' | 'case' | 'slab'`, matching the
   holder words `pkm-truth.json` already uses (`case` is the magnetic case). The labels are "Bare",
   "Sleeve", "Top loader", "Magnetic case" and "Slab". The default is `bare`. The choice is kept in
   `localStorage` key `training.holder`, so it sticks across shots and app restarts.
4. **Caps.**
   - `MAX_TRAINING_PHOTO_BYTES = 8 * 1024 * 1024`. A 2160×3840 JPEG at quality 0.92 is about
     2–4 MB.
   - `TRAINING_DAILY_CAP = 500` per account, over a rolling 24 h (as `CONTRIBUTE_DAILY_CAP`),
     across games. The target is 200–300 photos in one or two sessions.
5. **The shot.** The whole video frame at the camera's own resolution, not the 3:4 preview crop.
   The replay tests do the app's crop themselves (scan-gate framing). It is encoded as JPEG at
   0.92, then 0.8, then 0.7 if it's over the cap.
6. **The label.** `cardId` (global hashed id) and the **server's** printing id: the phone's
   `remote_id`, from `store.printingPhotoIds`. Phone printing ids are local. A version with no
   server id can't be shot ("Sync first").
7. **A selection sticks** for repeated angles until the user types another number or taps "Next
   card". The chosen version's art and label stay visible next to the shutter, so a stale label is
   visible. Each upload still carries its own full label, fixed at the moment the shutter is
   tapped.
8. **Delete last photo** pops this screen session's shots, newest first, and can be repeated. A
   queued upload that was never sent is dropped locally. An uploaded one, one in flight, or one
   sent at least once (its response may have been lost) is deleted on the server through the
   outbox.
9. **The running count** is `"<total> photos · <waiting> waiting to upload · <today>/500 today"`.
   `total` and `today` come from the server summary, and `waiting` from the outbox.
10. **The truth file.**
    - It goes to `~/scan-capture/op-truth.json`, next to `pkm-truth.json`.
    - `file` is `shots-op/<clientId>.jpg`, `source` is `'app'`, and `sourceId` is the
      **card-level** `<language>/<number>` (`en/OP05-119`), as `pkm-truth.json`'s sourceId is
      card-level and `onePieceCardId` hashes it.
    - `version` is the printing's `set_rarity` label (`SR (Alternate Art)`), `language` is the
      printing's language, and `holder` is as above.
    - Extra keys (ignored by readers): `bandaiId` (`OP05-119_p1`, for the image),
      `tester`, `device`, `appVersion`, `takenAt`.
11. **Merges and deletes.**
    - An account merge moves the closed account's training rows to the survivor, in the merge
      transaction next to the `game_testers` move, because `purgeHolds` deletes the closed
      account after the 30-day hold and the `users` cascade would take the rows with it.
      `r2_key` stays as stored (its accountId is just a name). Undo doesn't move them back, as
      with testers. Parked: `purgeHolds` doesn't delete R2 objects of rows still left on a
      purged account.
    - Deleting an account deletes its training photos' R2 objects. The rows go with the
      `users` cascade.
12. **No foreign key on `printing_id`/`card_id`.** A catalog delete must never fail because a
    photo names the printing. The labels list LEFT JOINs.

## Global Constraints

- Vitest runs with at most 2 workers. `npm test` and the portal's test script already pass
  `--maxWorkers=2`.
- Nothing heavy in tests: no synthetic data of 100k rows or more in vitest or Miniflare. Test JPEGs
  are a few bytes starting `FF D8 FF`. The cap is tested with a body just over 8 MiB, built once.
- DO SQLite rejects compound SELECTs of about 10 terms. Use one query per table or aggregate in the
  Worker, and no UNIONs.
- Migrations are append-only. This plan adds exactly one: `server-37`.
- Deploy the portal (server-37 and the routes) before any client release that calls
  `/api/training/`.
- **Yu-Gi-Oh and Pokémon don't change:**
  - their ids, keys, wire formats, sync, prices, scan and fingerprint files stay byte-identical
  - no scan profile, `PhoneCamera` or `StreamCamera` change
  - the Settings row is hidden unless a tester game is available.
- **One Piece stays hidden** to non-testers.
  - Every `/api/training/*` route answers a non-tester, or a game whose access isn't
    `'testers'`, with `404 {error:'not-found'}`, checked right after sign-in and origin and
    before any 400, so a non-tester can't tell the routes exist.
  - The owner counts as a tester (`gamesFor`).
- **Training photos are never served publicly:**
  - nothing under `/img/` or `/api/` returns a `training/` key
  - the only reader is `/admin/training/photo/<id>`, token-only, `cache-control: no-store`.
- R2 key: `training/<game>/<accountId>/<clientId>.jpg`. Labels are per shot: card id, printing id,
  holder, device model, app version, time.
- Typing a number must always work, offline included, from the phone's local catalog.

## Review Focus

- **"Delete last photo" while that photo is mid-upload.** The photo must end up deleted on the
  server, not dropped locally while the upload lands. Pinned in Task 5
  (`forget during an in-flight upload queues a delete`, and
  `forget after a lost response queues a delete`).
- **The response to a successful upload is lost (flaky signal), and the outbox retries.** The
  server keeps one photo and one row, and the count goes up once. Pinned in Task 3
  (`same client id twice stores one photo`).
- **Shots queued, then the app is killed, or signed out and another account signed in.** The
  queue survives the restart with each shot's own label. Only the shooter's account ever uploads
  them. Pinned in Task 5 (`items survive a new outbox on the same storage`,
  `drain sends only this account's items`).
- **The daily cap is hit halfway through a stack.** The rest stay queued, the screen says so, and
  they go after the window rolls. Nothing is dropped. Pinned in Task 3 (`501st photo in 24 h is
  429`) and Task 5 (`daily cap stops the drain and keeps the rest`).
- **Someone guesses a training URL.** `/img/...` and every non-admin route never return a
  `training/` object. Pinned in Task 3 (`training keys are never served`).

---

### Task 1: The shared training module

**Files:**
- Create: `src/shared/training.ts`
- Test: `tests/main/training-shared.test.ts`

**Interfaces:**
- Produces:

  ```ts
  export const TRAINING_HOLDERS = ['bare', 'sleeve', 'toploader', 'case', 'slab'] as const
  export type TrainingHolder = (typeof TRAINING_HOLDERS)[number]
  export const HOLDER_LABELS: Record<TrainingHolder, string> // Bare, Sleeve, Top loader, Magnetic case, Slab
  export const MAX_TRAINING_PHOTO_BYTES = 8 * 1024 * 1024
  export const TRAINING_DAILY_CAP = 500
  export const CLIENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  export interface TrainingLabel {
    game: GameId; cardId: number; printingId: number; holder: TrainingHolder
    device: string; appVersion: string; takenAt: string
  }
  export interface TrainingSummary { total: number; today: number; dailyCap: number }
  export function labelParams(l: TrainingLabel): URLSearchParams // keys: game, card, printing, holder, device, app, at
  export function readLabel(q: URLSearchParams, now: Date): TrainingLabel | null
  export const trainingKey = (game: GameId, userId: number, clientId: string): string
    // `training/${game}/${userId}/${clientId}.jpg`
  export interface TrainingLabelRow {
    id: number; clientId: string; game: GameId; userId: number; username: string
    cardId: number; printingId: number; holder: TrainingHolder; device: string
    appVersion: string; takenAt: string; createdAt: string
    language: string | null; number: string | null; bandaiId: string | null; version: string | null
  }
  export interface TruthRow {
    file: string; source: 'app'; sourceId: string | null; version: string | null
    language: string | null; holder: TrainingHolder
    bandaiId: string | null; tester: string; device: string; appVersion: string; takenAt: string
  }
  export function truthRowOf(r: TrainingLabelRow): TruthRow
  ```

- `readLabel` rules:
  - `game` passes `isGameId`.
  - `card` and `printing` are safe integers > 0.
  - `holder` is in `TRAINING_HOLDERS`.
  - `device` is 1–100 characters, trimmed, with no C0/C1 control characters.
  - `app` matches `/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,20})?$/`.
  - `at` parses as a date within `[now − 30 days, now + 1 day]` and is returned as
    `toISOString()`.
  - Anything else gives `null`.
- `truthRowOf`:
  - `file` = `shots-${game}/${clientId}.jpg`.
  - `sourceId` = `${language}/${number}` when both are non-null, else `null`.
  - `bandaiId` `''` becomes `null`.
  - `tester` = `username`.

- [ ] **Step 1: Write the failing tests.**

```ts
const row: TrainingLabelRow = { id: 1, clientId: '0f8e2c1a-1b2c-4d3e-8f90-123456789abc', game: 'op',
  userId: 7, username: 'dubgrumble', cardId: 2 ** 39 + 5, printingId: 812, holder: 'bare',
  device: 'Android 15 Pixel 8', appVersion: '0.53.0', takenAt: '2026-11-05T01:59:00.000Z',
  createdAt: '2026-11-05T01:59:01.000Z', language: 'en', number: 'OP05-119', bandaiId: '',
  version: 'SR' }
const NOW = new Date('2026-11-05T02:00:00.000Z')
const label: TrainingLabel = { game: 'op', cardId: 2 ** 39 + 5, printingId: 812, holder: 'sleeve',
  device: 'Android 15 Pixel 8', appVersion: '0.53.0', takenAt: '2026-11-05T01:59:00.000Z' }
test('label round-trips through its params', () => {
  expect(readLabel(labelParams(label), NOW)).toEqual(label)
})
test.each([
  ['holder', 'binder'], ['card', '0'], ['printing', '1.5'], ['game', 'mtg'], ['app', 'v1'],
  ['device', ''], ['device', 'x'.repeat(101)], ['device', 'a\u0007b'],
  ['at', '2026-10-05T00:00:00.000Z'], ['at', '2026-11-06T03:00:00.000Z'], ['at', 'yesterday']
])('bad %s %j is refused', (k, v) => {
  const q = labelParams(label); q.set(k, v)
  expect(readLabel(q, NOW)).toBeNull()
})
test('key', () => {
  expect(trainingKey('op', 7, '0f8e2c1a-1b2c-4d3e-8f90-123456789abc'))
    .toBe('training/op/7/0f8e2c1a-1b2c-4d3e-8f90-123456789abc.jpg')
})
test('truth row is card-level with the Bandai id kept', () => {
  expect(truthRowOf({ ...row, language: 'en', number: 'OP05-119', bandaiId: 'OP05-119_p1',
    version: 'SR (Alternate Art)', holder: 'toploader', username: 'dubgrumble' })).toMatchObject({
    file: `shots-op/${row.clientId}.jpg`, source: 'app', sourceId: 'en/OP05-119',
    version: 'SR (Alternate Art)', language: 'en', holder: 'toploader', bandaiId: 'OP05-119_p1',
    tester: 'dubgrumble' })
})
test('a missing printing gives a null sourceId', () => {
  expect(truthRowOf({ ...row, language: null, number: null, bandaiId: '', version: null }))
    .toMatchObject({ sourceId: null, bandaiId: null, version: null })
})
test('holder labels', () => {
  expect(TRAINING_HOLDERS.map((h) => HOLDER_LABELS[h]))
    .toEqual(['Bare', 'Sleeve', 'Top loader', 'Magnetic case', 'Slab'])
})
```

- [ ] **Step 2: Run** `npm test -- tests/main/training-shared.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `src/shared/training.ts`.** It must have no DOM or Node imports. Its
  imports stay normal (the pull script is bundled by Vite, Task 8).
- [ ] **Step 4: Run** the test again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(training): shared label, caps and truth row for training photos`.

---

### Task 2: Typed card numbers: normalizing and set-code suggestions

**Files:**
- Create: `src/shared/scan/onePieceNumber.ts`
- Modify: `src/main/repo/scan.ts` (add `numberPrefixes`)
- Modify: `src/main/ipc/dataHandlers.ts` (add `'scan:numberPrefixes'` to `DATA_CHANNELS` and the
  handler)
- Modify: `src/shared/ipc.ts` (add `numberPrefixes(): Promise<string[]>` to `Api['scan']` and
  `'scan:numberPrefixes'` to the channel list after `'scan:chineseOfArt'`)
- Modify: `src/phone/data/store.ts` (add `'scan:numberPrefixes'` to `READ_CHANNELS`, so it
  doesn't wait behind a catalog fill or sync in `serial()`)
- Modify: `src/renderer/src/web/httpApi.ts` (`numberPrefixes: scanUnavailable` in the `scan:`
  block)
- Test: `tests/main/op-number.test.ts`; extend `tests/main/data-handlers.test.ts` (its
  `covers exactly DATA_CHANNELS` test must still pass)

**Interfaces:**
- Produces:
  - `normalizeOpNumber(text: string): string | null`. It upper-cases and removes whitespace.
    - With a dash, the input matches `^([A-Z]{1,3})(\d{1,2})?-(\d{3})$`.
    - Without a dash, it matches `^([A-Z]{1,3})(\d{2})?(\d{3})$`.
    - The output is `<letters><digits padded to 2, or none>-<3 digits>`.
  - `prefixSuggestions(typed: string, prefixes: readonly string[], max = 8): string[]`. The
    typed text is normalized as above, but not validated.
    - It returns `[]` when the text is empty, contains `-`, or ends in 3 digits.
    - Otherwise it returns `${p}-` for each prefix that starts with it, in the given order, up
      to `max`.
  - `numberPrefixes(db: SqlDb, scope: Scope = LOCAL): string[]`:
    `SELECT DISTINCT substr(set_code, 1, instr(set_code, '-') - 1) AS prefix FROM card_printings
    WHERE +game = ${scope.game} AND contributed = 0 AND instr(set_code, '-') > 1 ORDER BY prefix`.
  - `window.api.scan.numberPrefixes()`. The phone gets it because `createPhoneApi` maps every
    `DATA_CHANNELS` entry; it is a read channel there. The portal RPC does not get it (the web
    app has no Contribute screen), so httpApi answers `scanUnavailable`.

- [ ] **Step 1: Write the failing tests.**

```ts
test.each([
  ['op05-119', 'OP05-119'], ['OP05119', 'OP05-119'], ['op5-119', 'OP05-119'],
  [' st10 - 003 ', 'ST10-003'], ['prb01-001', 'PRB01-001'], ['p-084', 'P-084'], ['P084', 'P-084'],
  ['EB04-061', 'EB04-061']
])('%j reads as %s', (t, want) => expect(normalizeOpNumber(t)).toBe(want))
test.each(['', 'OP05-11', 'OP0511', 'OP05-1199', 'EB04-061_p1', 'LOB-EN001', '119'])(
  '%j is not a number', (t) => expect(normalizeOpNumber(t)).toBeNull())

const P = ['EB01', 'OP01', 'OP02', 'OP10', 'OP11', 'P', 'PRB01', 'ST01']
test('suggests set codes as typed', () => {
  expect(prefixSuggestions('op1', P)).toEqual(['OP10-', 'OP11-'])
  expect(prefixSuggestions('p', P)).toEqual(['P-', 'PRB01-'])
  expect(prefixSuggestions('', P)).toEqual([])
  expect(prefixSuggestions('OP05-1', P)).toEqual([])
  expect(prefixSuggestions('OP05119', P)).toEqual([])
  expect(prefixSuggestions('o', P, 2)).toEqual(['OP01-', 'OP02-'])
})
test('numberPrefixes lists the active game only', () => {
  // seedOnePiece (step 1 helper) + the YGO fixture db; the default active game is ygo
  setActiveGame(db, ['ygo', 'pkm', 'op'], 'op')
  expect(numberPrefixes(db)).toEqual(['OP01'])
  setActiveGame(db, ['ygo', 'pkm', 'op'], 'ygo')
  // The sample YGO fixture has no OP01 set (check; if it does, seed op as 'ZZ01-001' instead).
  expect(numberPrefixes(db)).not.toContain('OP01')
  expect(numberPrefixes(db).length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run** `npm test -- tests/main/op-number.test.ts tests/main/data-handlers.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement** the module, the repo function, the channel, the `Api` type, the
  phone read channel and the httpApi stub.
- [ ] **Step 4: Run** the tests, then `npm run typecheck`. Expected: PASS. The typecheck catches
  any `Api['scan']` mock that needs the new method (for example
  `tests/renderer/mockApi.ts`). Add `numberPrefixes: vi.fn(async () => [])` there.
- [ ] **Step 5: Commit** `feat(op): typed card numbers and set-code suggestions`.

---

### Task 3: The training routes on the portal

**Files:**
- Create: `workers/portal/src/training.ts`
- Modify: `workers/portal/src/migrate.ts` (append `server-37` after `server-36`)
- Modify: `workers/portal/src/app.ts`:
  - `AppDeps` gains `training?: TrainingBucket`
  - route `/api/training/` before `/api/rpc/`
- Modify: `workers/portal/src/index.ts` (pass `training: this.env.IMAGES`)
- Modify: `workers/portal/src/account.ts`. `deleteAccountRoute` collects the `r2_key`s of the user
  and of its held merged accounts before the transaction, and deletes them from
  `deps.training` after it, best effort and logged on failure.
- Modify: `workers/portal/src/merge.ts`. In the merge transaction, right after the
  `game_testers` move, `UPDATE OR IGNORE training_photos SET user_id = ? WHERE user_id = ?`
  (`a.survivor`, `a.closed`). Undo leaves them.
- Modify: `tests/portal/helpers.ts`. `memoryBucket()` gains
  `async delete(key) { store.delete(key) }`, and its return type widens to
  `ImageBucket & TrainingBucket & { store: … }`.
- Test: `tests/portal/training.test.ts` (better-sqlite3), `workers/portal/test/training.test.ts`
  (DO SQLite + R2), one case in `tests/portal/merge.test.ts` and one in
  `tests/portal/edge-image.test.ts`.

**Interfaces:**
- Consumes: Task 1 (`readLabel`, `trainingKey`, `CLIENT_ID_RE`, caps, `TrainingSummary`);
  `currentUser`, `fromPublicOrigin`, `gamesFor` (auth.ts); `GAMES`, `GAME_IDS`.
- Migration `server-37`:

  ```sql
  CREATE TABLE training_photos (id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL, game TEXT NOT NULL, card_id INTEGER NOT NULL, printing_id INTEGER NOT NULL,
    holder TEXT NOT NULL, device TEXT NOT NULL, app_version TEXT NOT NULL, taken_at TEXT NOT NULL,
    created_at TEXT NOT NULL, bytes INTEGER NOT NULL, r2_key TEXT NOT NULL);
  CREATE UNIQUE INDEX ux_training_photos_client ON training_photos(user_id, client_id);
  CREATE INDEX ix_training_photos_user_created ON training_photos(user_id, created_at);
  CREATE INDEX ix_training_photos_game ON training_photos(game, id);
  ```

- Produces:
  - `interface TrainingBucket { put(key: string, value: ArrayBuffer, opts: { httpMetadata: { contentType: string } }): Promise<unknown>; get(key: string): Promise<{ body: ReadableStream } | null>; delete(key: string): Promise<void> }`
  - `mayContribute(deps: AppDeps, userId: number, game: string): game is GameId`. This is
    `isGameId(game) && GAMES[game].access === 'testers' && gamesFor(deps, userId, game).includes(game)`.
  - `trainingRoute(req: Request, deps: AppDeps, rest: string): Promise<Response>`, which handles:
    - `POST photos/<clientId>?<labelParams>` with an `image/jpeg` body. Success is `200`
      `TrainingSummary`.
    - `DELETE photos/<clientId>`. The checks are 401, then the same `403 bad-origin` as the
      upload, then `404` unless `GAME_IDS.some((g) => mayContribute(deps, userId, g))`. The
      answer is `204`, idempotent, and it touches only the caller's own row.
    - `GET summary?game=<g>`. 401, then `404` when `!mayContribute`. Success is `200`
      `TrainingSummary`.
  - The upload's checks, in order. Each failure gives the status shown:
    1. `401 signed-out`
    2. a web session not from `PUBLIC_URL`: `403 bad-origin`
    3. read `game` from the query; `!mayContribute`: `404 not-found`
    4. `clientId` fails `CLIENT_ID_RE`: `400 bad-id`
    5. `readLabel` null: `400 bad-label`
    6. the printing is missing, isn't `label.cardId`'s, or its card's game ≠ `label.game`:
       `400 bad-printing`
    7. a row already exists for (user, clientId): `200` summary, with no put
    8. content-type isn't `image/jpeg`: `415`
    9. `content-length` > cap: `413 too-big`, before the body is read
    10. read `req.body` with a reader, counting bytes; past the cap, cancel the stream and
        answer `413 too-big` (never `req.arrayBuffer()`, which buffers up to 100 MB in the one
        DO). A body not starting `FF D8 FF`: `415`
    11. the rows created in the last 24 h are ≥ `TRAINING_DAILY_CAP`: `429 daily-cap`
    12. no `deps.training`: `503`
    13. `await training.put(key, body, image/jpeg)`
    14. re-check the cap (over it: delete the object just put, then `429 daily-cap`), then
        `INSERT OR IGNORE` the row (`created_at` = `deps.now()`)
    15. `200` summary
  - Summary: `total` = this user's rows for the game, `today` = this user's rows in the last
    24 h (all games), `dailyCap` = 500. These are two `COUNT(*)` statements.
  - All responses carry `cache-control: no-store`. A GET on `photos/<id>` is `404`.

- [ ] **Step 1: Write the failing tests** in `tests/portal/training.test.ts`, with
  `seededServerDb`, `addUser`, a session token per user (as `usage.test.ts` does), `memoryBucket`,
  an op card and printing via step 1's `seedOnePiece`, and the owner set up through
  `ADMIN_DISCORD_ID`. The tests:
  - `tester uploads a photo`
    - Expect `200 {total:1, today:1, dailyCap:500}`.
    - R2 holds the key `training/op/<uid>/<cid>.jpg` with type `image/jpeg`.
    - The row has the label fields.
  - `owner counts as a tester`: the owner, with no `game_testers` row, gets 200.
  - `non-tester gets 404`: 404 `not-found`, and R2 stays empty.
  - `ygo and pkm are refused`: with `game=pkm` and a pkm printing, 404.
  - `printing of another game is rejected`: a ygo printing id with `game=op`, 400 `bad-printing`.
  - `same client id twice stores one photo`: two POSTs, both 200 with `total:1`, one row, one
    R2 put.
  - `too big is 413 before the body`: `content-length: 8388609`, 413, and no put. Then a real
    8 MiB + 1 byte body without the header, 413 (this pins the counting reader).
  - `not a jpeg is 415`: a body `89 50 4E 47`.
  - `501st photo in 24 h is 429`. Insert 500 rows directly, with `created_at` = now − 1 h, then
    POST: 429 `daily-cap`. With the rows moved to now − 25 h, it is 200.
  - `bad label is 400`: a tester with `holder=binder`. A non-tester with `holder=binder` gets
    404 `not-found`, not 400.
  - `delete removes the row and the object`: 204, the row is gone, the key is gone. A second
    DELETE is 204. Another tester's DELETE of the same id leaves it. A non-tester's DELETE is
    404. A web-session DELETE from another origin is 403 `bad-origin`.
  - `summary`: `GET summary?game=op` gives `{total, today, dailyCap}`. A non-tester gets 404.
  - `account deletion removes its training photos`: POST `/api/account/delete`, then the R2
    key is gone.
  - `training keys are never served`. Use **one** `memoryBucket` (its `get` wrapped to record
    keys) as both `images` and `training`, and upload a real training photo first. Then
    `GET /img/training/op/<uid>/<cid>.jpg`, `/img/full/training`, `/img/printing/training`,
    `GET /api/training/photos/<cid>` and `/api/admin/thumbs/photo?key=training/…` (with the
    admin token) all return no body bytes, and no recorded `get` starts with `training/`.
  - `merge.test.ts`, `a merge moves training photos to the survivor`: rows of the closed
    account have `user_id` = survivor and their `r2_key` unchanged after the merge, and still
    after an undo.
  - `edge-image.test.ts`: `/img/training/op/<uid>/<cid>.jpg` doesn't read the bucket.

- [ ] **Step 2: Run** `npm test -- tests/portal/training.test.ts tests/portal/merge.test.ts
  tests/portal/edge-image.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the migration, `training.ts`, the routing, the deps wiring, the
  account-delete cleanup and the merge move.
- [ ] **Step 4: Write the DO test** `workers/portal/test/training.test.ts`, in the style of
  `favourites.test.ts`. Through `stub.fetch` it covers: upload, the summary, the 24 h count,
  delete and account delete, on workerd SQLite and the `IMAGES` R2 binding (already bound in
  `wrangler.toml`).
- [ ] **Step 5: Run** the Step 2 files and `npm --prefix workers/portal
  test -- training`. Expected: PASS. Then run all of `tests/portal` and `workers/portal/test`.
  Expected: PASS (migrations still apply on DO SQLite: `do.test.ts`).
- [ ] **Step 6: Commit** `feat(portal): tester-only training photo upload, delete and summary`.

---

### Task 4: `/admin` counts, the label list and the photo download

**Files:**
- Modify: `workers/portal/src/training.ts` (add `adminTrainingRoute`; the token check is
  `adminAuthorized(req, deps.env.ADMIN_TOKEN)` from `thumbs.ts`, and `catalogLoad.ts` is left alone)
- Modify: `workers/portal/src/app.ts`. Route `/admin/training` and `/admin/training/*` **before**
  the `/admin/` catch-all.
- Modify: `workers/portal/src/adminPage.ts`:
  - add `'photos'` to `TABS`
  - add a nav link `<a href="#photos">Photos</a>` after Testers
  - add `<section data-tab id="photos">`
  - add a panel that fetches `/admin/training` with `credentials: 'same-origin'` on load, like
    the testers panel. The inline script can't import, so inline
    `JSON.stringify(HOLDER_LABELS)` into it, and render usernames with `textContent`, as the
    existing panels do
- Test: extend `tests/portal/training.test.ts` and `tests/portal/admin-page.test.ts`, and the DO
  test from Task 3.

**Interfaces:**
- Produces:
  - `GET /admin/training`, for an owner session or the token. It returns `TrainingStats`:

    ```ts
    interface TrainingStats {
      games: { game: GameId; photos: number; testers: number; cards: number; versions: number }[]
      testers: { game: GameId; userId: number; username: string; photos: number; today: number; lastAt: string }[]
      holders: { game: GameId; holder: TrainingHolder; photos: number; versions: number }[]
    }
    ```

    This is three separate `GROUP BY` statements over `training_photos`, with no UNION:
    - `games`: `COUNT(*)`, `COUNT(DISTINCT user_id)`, `COUNT(DISTINCT card_id)` and
      `COUNT(DISTINCT printing_id)`, `GROUP BY game`.
    - `testers`: JOIN `users`, `SUM(created_at > ?)` for the last 24 h, `MAX(created_at)`,
      `GROUP BY game, user_id ORDER BY game, photos DESC`.
    - `holders`: `GROUP BY game, holder`.
    Put the type in `src/shared/training.ts`.
  - `GET /admin/training/labels?game=op&after=<id>&limit=<n>`, token only. `limit` is at most
    500, default 500. It returns `{ labels: TrainingLabelRow[], more: boolean }` from one SELECT:
    `training_photos t JOIN users u LEFT JOIN card_printings p ON p.id = t.printing_id WHERE
    t.game = ? AND t.id > ? ORDER BY t.id LIMIT limit+1`. `language` is `p.language`, `number`
    is `p.set_code`, `bandaiId` is `p.set_rarity_code`, `version` is `p.set_rarity` and
    `username` is `u.username`.
  - `GET /admin/training/photo/<id>`, token only. It returns the R2 object as `image/jpeg` with
    `cache-control: no-store`. An unknown id is 404.
  - Without the right auth, all three answer as the catch-all does (401). An owner **session** on
    `labels` or `photo` is also 401. Those two are for the script only, so a stolen browser
    session can't bulk-download.
  - Photos panel copy:
    - A table per game: Photos, Testers, Cards, Versions.
    - Then "By tester": Tester, Photos, Last 24 h, Last photo.
    - Then "By holder", using `HOLDER_LABELS`: Holder, Photos, Versions.
    - With no rows: "No photos yet."

- [ ] **Step 1: Write the failing tests.**
  - `stats count games, testers and holders`: 3 photos by A (2 versions of one card, holders
    bare and sleeve) and 1 by B of the base version. Expect
    `games[0]` = `{game:'op', photos:4, testers:2, cards:1, versions:2}` and holders by
    holder.
  - `stats need the owner or the token`: a tester's session gets 401.
  - `labels page by id and carry the printing`. `seedOnePiece` leaves `set_rarity_code` as
    `''`, so first `UPDATE` the parallel's to `OP01-001_p1`.
    - with `limit=2`, `more:true`, then `after=<2nd id>`
    - row fields `language:'en'`, `number:'OP01-001'`, `bandaiId:'OP01-001_p1'`, `version`,
      `username`.
  - `labels and photo are token-only`: an owner session gets 401, the token gets 200.
  - `photo streams the jpeg privately`: the body equals the uploaded bytes, and
    `cache-control: no-store`.
  - Admin page: `has a Photos tab`. The HTML contains `href="#photos"`, `id="photos"` and
    `fetch('/admin/training'`, and the script still parses (the existing test).
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the stats queries to the DO test, so they run on workerd SQLite.
- [ ] **Step 4: Run** the tests in `tests/portal` and `workers/portal/test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(admin): training photo counts, label list and private download`.

---

### Task 5: The phone side: store calls and the outbox

**Files:**
- Modify: `src/phone/data/store.ts` (three methods on `PhoneStore` and their implementation)
- Modify: `src/phone/data/protocol.ts` (add them to `STORE_METHODS`; the compile-time check
  enforces it). The page-side client posts `trainingUpload` with a copy of the JPEG
  (`jpeg.slice(0)`) in the transfer list, so the 8 MB buffer isn't structured-cloned and the
  outbox's own buffer stays usable.
- Create: `src/phone/training/outbox.ts`
- Modify: `src/phone/PhoneShell.tsx`. In `useReadyChecks`, drain the outbox once on start; the
  `online` listener is registered in its own effect, with cleanup.
- Modify: `tests/renderer/phoneFakes.ts` (`fakeStore()` implements `trainingUpload`,
  `trainingDelete` and `trainingSummary`)
- Modify: `package.json` (devDependency `fake-indexeddb`)
- Test: extend `tests/main/phone-store.test.ts`; create `tests/renderer/phone-outbox.test.ts`

**Interfaces:**
- Consumes: Task 1 (`TrainingLabel`, `labelParams`, `TrainingSummary`).
- Produces (store):

  ```ts
  type TrainingSend =
    | { ok: true; summary: TrainingSummary | null }
    | { ok: false; retry: boolean; reason: 'offline' | 'signed-out' | 'daily-cap' | 'too-big' | 'rejected' }
  trainingUpload(clientId: string, label: TrainingLabel, jpeg: ArrayBuffer): Promise<TrainingSend>
  trainingDelete(clientId: string): Promise<TrainingSend>
  trainingSummary(game: GameId): Promise<TrainingSummary | null> // null when signed out/offline/refused
  ```

  - These calls don't use `serial()`, because a catalog fill must not hold an upload. They use the
    stored Bearer token directly, against `${base}/api/training/...`.
  - Timeouts: the upload uses `AbortSignal.timeout(60_000)` and the others `15_000`.
  - Answers:
    - a fetch throw or a 5xx: `offline`, retry
    - 401: `signed-out`, retry, and also the store's existing `serverSignedOut()` path
    - 429: `daily-cap`, retry
    - 413: `too-big`, no retry
    - any other 4xx: `rejected`, no retry
    - 200 or 204: ok
    - no token: `signed-out`, retry
- Produces (outbox):

  ```ts
  interface OutboxItem {
    key: string            // `${kind}:${id}`
    id: string             // client id (UUID)
    userId: number
    kind: 'upload' | 'delete'
    label?: TrainingLabel  // upload only
    jpeg?: ArrayBuffer     // upload only
    attempts?: number      // upload only: sends started; > 0 means the server may hold it
    queuedAt: string
  }
  interface OutboxStorage { all(): Promise<OutboxItem[]>; put(i: OutboxItem): Promise<void>; remove(key: string): Promise<void> }
  function memoryOutboxStorage(): OutboxStorage
  function idbOutboxStorage(dbName = 'duel-binder-training'): OutboxStorage // object store 'outbox', keyPath 'key'
  interface Sender { upload: PhoneStore['trainingUpload']; remove: PhoneStore['trainingDelete'] }
  type DrainResult = {
    sent: number; dropped: { id: string; reason: string }[]
    stopped: null | 'offline' | 'signed-out' | 'daily-cap'; summary: TrainingSummary | null
  }
  interface Outbox {
    addUpload(userId: number, id: string, label: TrainingLabel, jpeg: ArrayBuffer): Promise<void>
    /** Drops a queued upload never sent ('dropped'); else removes any upload item and queues a server delete ('queued'). */
    forget(userId: number, id: string): Promise<'dropped' | 'queued'>
    waiting(userId: number): Promise<number> // queued uploads
    drain(userId: number, send: Sender): Promise<DrainResult>
    onChange(cb: () => void): () => void
  }
  function createOutbox(storage: OutboxStorage, now: () => Date): Outbox
  /** The app's one outbox, on IndexedDB, created on first call (tests never touch it). */
  export function trainingOutbox(): Outbox
  ```

  - `drain`:
    - It sends this user's items oldest first (`queuedAt`), one at a time.
    - Before each upload send it stores `attempts + 1` on the item.
    - `ok` removes the item.
    - `retry: false` removes the item and lists it in `dropped`.
    - `retry: true` stops the drain with that reason.
    - Concurrent `drain` calls **for the same `userId`** share one run; another user's drain
      gets its own.
    - It remembers the id currently being sent (`inFlight`).
  - `idbOutboxStorage` opens the database lazily, on first use. `all()` returns `[]` without
    creating anything when the database doesn't exist yet, so YGO- and Pokémon-only users never
    get one.
  - The shell drain does nothing when `typeof indexedDB === 'undefined'`, and catches any error.
  - The outbox stores JPEGs as ArrayBuffers, not Blobs (older WebKit IndexedDB Blob bugs).

- [ ] **Step 1: Write the failing tests.**
  - Store (`phone-store.test.ts`, with its fetch fake):
    - `training upload sends the label as params and the jpeg as body`: the URL is
      `/api/training/photos/<cid>?game=op&card=…&holder=sleeve…`, the body bytes are equal, and
      the headers have `authorization: Bearer …` and `content-type: image/jpeg`.
    - `training answers map to retry or drop`, table-driven:
      - 200 gives `{ok:true}`
      - 429 gives `{ok:false, retry:true, reason:'daily-cap'}`
      - 413 gives `{ok:false, retry:false, reason:'too-big'}`
      - 404 gives `{retry:false, 'rejected'}`
      - 503 gives `{retry:true, 'offline'}`
      - a fetch throw gives `offline`
      - signed out gives `signed-out` with no fetch made
    - `training upload doesn't wait for a catalog fill`: hold a `fillCatalog` fetch open; the
      upload still resolves.
  - Outbox (`phone-outbox.test.ts`, `memoryOutboxStorage`, a fake sender):
    - `drain uploads oldest first and empties`
    - `drain sends only this account's items`: items for users 1 and 2. A drain for 1 leaves 2's
      item in place.
    - `items survive a new outbox on the same storage`: `createOutbox(s)`, add, then a new
      `createOutbox(s)` sends it with the original label and id.
    - `daily cap stops the drain and keeps the rest`: the sender answers 429 on the 2nd item.
      `sent:1`, `stopped:'daily-cap'`, and 2 items still waiting.
    - `a refused shot is dropped and reported`: 404 gives `dropped:[{id, reason:'rejected'}]`.
    - `forget drops a queued upload`: 'dropped', and the sender is never called for it.
    - `forget after upload queues a delete`: 'queued', the next drain calls `remove(id)`.
    - `forget during an in-flight upload queues a delete`: the sender's upload is held on a
      deferred; `forget` gives 'queued'; release the upload; the drain then calls `remove(id)`
      once.
    - `forget after a lost response queues a delete`: the sender stores the photo, then
      answers `{ok:false, retry:true, reason:'offline'}`; `forget` gives 'queued'; the next
      drain calls `remove(id)` once and `upload` is not called again.
    - `concurrent drains share one run`: two `drain(1)` calls, and each item is sent once.
      `drain(1)` and `drain(2)` together each send only their own user's items and get their
      own results.
    - `idbOutboxStorage round-trips` (with `import 'fake-indexeddb/auto'`): `put` an upload
      item with a JPEG, then a **new** `idbOutboxStorage()` on the same name gives it back from
      `all()` with equal bytes; `remove(key)` empties it.
  - Shell: the existing `phone-app*.test.tsx` suites still pass with no `indexedDB` in jsdom.
- [ ] **Step 2: Run** `npm test -- tests/main/phone-store.test.ts tests/renderer/phone-outbox.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement** the store methods, the protocol entries, `outbox.ts`, the
  `fakeStore` methods and the `useReadyChecks` drain. The `useReadyChecks` drain is fire and
  forget, with errors swallowed, and only when signed in: use `usePhone().user.id`.
- [ ] **Step 4: Run** the tests, `npm test -- tests/renderer/phone-app`, then
  `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(phone): training photo outbox with offline retry`.

---

### Task 6: Capture helpers: the frame grab and the device model

**Files:**
- Create: `src/phone/training/capture.ts`
- Test: `tests/renderer/phone-capture.test.ts`

**Interfaces:**
- Produces:
  - `encodeWithinCap(encode: (quality: number) => Promise<Blob>, cap = MAX_TRAINING_PHOTO_BYTES): Promise<ArrayBuffer>`.
    It tries qualities `[0.92, 0.8, 0.7]` in order and returns the first encoding of at most
    `cap`. Otherwise it throws `new Error('photo-too-big')`.
  - `grabFrame(video: HTMLVideoElement): Promise<ArrayBuffer>`.
    - It throws `new Error('no-frame')` when `videoWidth` is 0.
    - Otherwise it draws the whole frame at `videoWidth × videoHeight` on a canvas and runs
      `encodeWithinCap(q => canvas.toBlob(..., 'image/jpeg', q))`.
  - `deviceFromUa(ua: string): string`:
    - Android: `Android <ver> <model>` from `/Android ([\d.]+); ([^;)]+)/`, with the model
      dropped when it is `K` (Chrome's reduced UA).
    - iPhone and iPad: `iPhone iOS <ver>` / `iPad iOS <ver>` from `OS (\d+[_\d]*)`, with `_`
      turned into `.`.
    - Otherwise the first 100 characters of the UA.
    - An empty UA gives `'unknown'`.
  - `deviceModel(): Promise<string>`.
    - It uses `navigator.userAgentData?.getHighEntropyValues(['model', 'platform',
      'platformVersion'])` → `${platform} ${platformVersion} ${model}`, trimmed with spaces
      collapsed, when that resolves non-empty.
    - Otherwise `deviceFromUa(navigator.userAgent)`.
    - The result is always 1–100 characters (it passes `readLabel`), and it is computed once
      and memoized.
  - `newClientId(): string` = `crypto.randomUUID()`. The test checks it matches `CLIENT_ID_RE`.
  - `appVersion(): string` = `typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev'`
    (vitest doesn't define `__APP_VERSION__`; the fallback passes `readLabel`'s semver rule, where
    `UpdateBanner`'s `'dev'` would be refused).
  - `grabFrame` treats a `null` from `toBlob` as a failed encode (`new Error('no-frame')`).

- [ ] **Step 1: Write the failing tests.**

```ts
test('first quality under the cap wins', async () => {
  const sizes: Record<number, number> = { 0.92: 9e6, 0.8: 7e6, 0.7: 5e6 }
  const asked: number[] = []
  const out = await encodeWithinCap(async (q) => { asked.push(q); return new Blob([new Uint8Array(sizes[q])]) })
  expect(asked).toEqual([0.92, 0.8]); expect(out.byteLength).toBe(7e6)
})
test('still too big throws', async () => {
  await expect(encodeWithinCap(async () => new Blob([new Uint8Array(10)]), 5)).rejects.toThrow('photo-too-big')
})
test.each([
  ['Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36', 'Android 15 Pixel 8'],
  ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36', 'Android 10'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X)', 'iPhone iOS 26.1'],
  ['', 'unknown']
])('device of %j', (ua, want) => expect(deviceFromUa(ua)).toBe(want))
test('client ids are v4 UUIDs', () => expect(newClientId()).toMatch(CLIENT_ID_RE))
test('app version passes the label rule', () => {
  expect(appVersion()).toBe('0.0.0-dev')
  vi.stubGlobal('__APP_VERSION__', '0.53.0'); expect(appVersion()).toBe('0.53.0')
  vi.unstubAllGlobals()
})
```

- [ ] **Step 2: Run** `npm test -- tests/renderer/phone-capture.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(phone): frame grab under the photo cap, and the device model`.

---

### Task 7: The Contribute photos screen and its Settings row

**Files:**
- Create: `src/phone/training/ContributeScreen.tsx`
- Create: `src/phone/training/copy.ts` (the strings below)
- Modify: `src/phone/Settings.tsx`. It takes a prop `onContribute?: (game: GameId) => void` and
  adds a "Contribute photos" section/row shown only when `onContribute` is set and
  `useGame().available.some(g => GAMES[g].access === 'testers')`. Tapping it calls
  `onContribute(g)` for the first such game.
- Modify: `src/phone/PhoneShell.tsx`. `Shell` holds the `contribute: GameId | null` state and
  `openContribute(g)`, which does `await setGame(g)` and then sets the state. It passes
  `settings={<Settings onContribute={openContribute} />}` and renders
  `<ContributeScreen game={contribute} onClose=…/>`, while `contribute` is set, as a `fixed inset-0 z-50` sibling of
  `<main>`, so it is outside `PageSwitch`'s `<Fragment key={game}>` and the scrolling main.
  `useBackHandler(contribute !== null, close)` closes it.
- Test: create `tests/renderer/phone-contribute.test.tsx`; extend `tests/renderer/phone-app.test.tsx`

**Interfaces:**
- Consumes:
  - Task 1 (holders, `TrainingLabel`, `TrainingSummary`) and Task 2 (`normalizeOpNumber`,
    `prefixSuggestions`, `api.scan.numberPrefixes`)
  - Task 5 (`trainingOutbox`, the store's `trainingSummary`, `trainingUpload`,
    `trainingDelete`) and Task 6 (`grabFrame`, `deviceModel`, `newClientId`)
  - from the app: `useCamera(useScanHub().settings.deviceId, 'environment')`,
    `api.scan.printingsByCode`, `api.cards.get`, `store.printingPhotoIds`, `cardImageSrc`,
    `appVersion()` (Task 6)
- Produces:

  ```ts
  function ContributeScreen(props: {
    game: GameId
    onClose(): void
    /** Tests. Default `trainingOutbox()`. */ outbox?: Outbox
    /** Tests. */ grab?: (video: HTMLVideoElement) => Promise<ArrayBuffer>
    /** Tests. */ now?: () => Date
  }): React.JSX.Element
  ```

- Behaviour:
  - **Number box.**
    - Its label is "Card number" and its placeholder is `OP05-119`, with
      `autocapitalize="characters"` and `inputmode="text"`.
    - The suggestions are `prefixSuggestions(text, prefixes)` as tappable chips. Tapping one fills
      in `OP05-`.
    - When `normalizeOpNumber(text)` is non-null:
      1. `printingsByCode(number)`
      2. the distinct `cardId`s, then `cards.get(cardId)` for each
      3. that card's printings whose `setCode === number`, shown as tiles with
         `cardImageSrc('small', p.artImageId ?? images[0].imageId)`, the `setRarity` label and
         the set name
    - With none, show "No card with that number in your card data."
  - **Version.**
    - Tapping a tile selects it, and the screen then maps its id with
      `store.printingPhotoIds([id])`.
    - With no server id, show "This version isn't synced yet. Sync, then try again." and keep
      the shutter disabled.
    - The selection shows as a small art thumbnail and label beside the shutter.
  - **Holder.** A five-button segmented control (`HOLDER_LABELS`, `aria-pressed`). Its initial
    value is `localStorage['training.holder']` if valid, else `bare`, and it is written on change.
  - **Shutter.**
    - The button is labelled "Take photo" and is disabled until a version with a server id is
      chosen and the camera has a stream.
    - On tap, it captures `takenAt = now().toISOString()` first, then
      `grab(video)` → `outbox.addUpload(user.id, newClientId(), label, jpeg)`, pushes the id on
      the session stack, then `outbox.drain(...)`.
    - It shows a brief "Saved" flash.
    - A grab error shows "Couldn't take the photo. Try again."
  - **Count line** (Builder's call 9):
    - The numbers come from `trainingSummary(game)` (on open and after each drain) plus
      `outbox.waiting`.
    - When stopped on `daily-cap`, it adds "Daily limit reached. The rest upload tomorrow."
    - When stopped on `offline`, it adds "Offline: photos upload when you're back online."
    - The screen drains again every 30 s while open and anything waits.
    - A dropped item shows "A photo was refused by the server and removed."
  - **Delete last photo** is enabled when the session stack isn't empty. It calls
    `outbox.forget(user.id, stack.pop())` and then a drain.
  - **Next card** clears the number box and the selection, and keeps the holder.
  - **What to shoot**, a collapsible note with exact copy:
    "A spread of sets and rarities: Leaders, Characters, Events, Stages and DON!!.",
    "Every version you have of the same number, side by side: alternate arts and the base card,
    plain Parallel foils, SP, manga, Treasure Rare.",
    "Sleeves and top loaders too, since that's how you'll stream.",
    "A few angles of each: straight on, tilted, under a light."
  - **Close** (X, top-left, `aria-label="Close"`) calls `onClose`. Uploads continue through the
    shell's drain.

- [ ] **Step 1: Write the failing tests** (`phone-contribute.test.tsx`, with `mockApi` and
  `phoneFakes`, a `memoryOutboxStorage` outbox, a fake `grab` returning `new Uint8Array([0xff,0xd8,0xff]).buffer`,
  a fake camera stream, `vi.stubGlobal('__APP_VERSION__', '0.53.0')`, and an op card with base
  `OP01-001` and parallel `OP01-001_p1`):
  - `typed number lists its versions`: typing `op01001` shows two tiles labelled `L` and
    `L (Alternate Art)`, and the parallel's img src uses its `artImageId`.
  - `set-code chips complete the prefix`: with `numberPrefixes` → `['OP01','OP02','ST01']`,
    typing `op` shows chips `OP01-` and `OP02-`, and tapping `OP01-` sets the box to `OP01-`.
  - `shutter waits for a synced version`: it is disabled at first. Choosing a version whose
    `printingPhotoIds` is `[]` shows the not-synced copy, still disabled.
  - `each shot carries its own label`:
    - Choose `L (Alternate Art)` (server id 9001) and Sleeve, then tap twice.
    - Expect the outbox to hold 2 uploads, each with label
      `{game:'op', cardId, printingId:9001, holder:'sleeve', device:<deviceModel>,
      appVersion:'0.53.0', takenAt:<now>}` and different ids.
    - Then choose Top loader and tap: that label's holder is `toploader`, and the earlier two
      are unchanged.
  - `holder sticks across a remount`: choose Slab, unmount, mount, and Slab has
    `aria-pressed=true`.
  - `delete last photo forgets the newest shot`: after 2 shots, Delete last calls `forget` with
    the 2nd id, then the 1st. The count's waiting number drops each time.
  - `count shows server total and waiting`: the summary is `{total:12,today:3,dailyCap:500}`,
    with 1 queued, so the text is `12 photos · 1 waiting to upload · 3/500 today`.
  - `daily cap message`: the sender returns 429, and the daily-limit copy shows.
  - Settings row (`phone-app.test.tsx`, through the real `PhoneShell` and `GameProvider`, with
    `fakeStore`'s games answering available `['ygo','pkm']` or `['ygo','pkm','op']` and active
    `'ygo'`; More → Settings):
    - `contribute row only for tester games`: with `['ygo','pkm']` there is no
      "Contribute photos". With `['ygo','pkm','op']` it is present.
    - `contribute survives the game switch`: starting on ygo, tapping the row sets the active
      game to `'op'`, and after the switch has rendered, the Contribute screen (its "Card
      number" box) is still shown.
- [ ] **Step 2: Run** `npm test -- tests/renderer/phone-contribute.test.tsx tests/renderer/phone-app.test.tsx`.
  Expected: FAIL.
- [ ] **Step 3: Implement** the screen, the copy, the Settings row and the shell's overlay. Use the phone's existing
  Tailwind idiom: dark frosted panels and 44 px minimum touch targets, as `PhoneCamera`'s buttons
  are.
- [ ] **Step 4: Run** the tests, then the whole phone suite `npm test -- tests/renderer/phone-*`
  and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Visual check (controller).** Run `npm run dev:phone` in a browser at 320 and 390
  px, signed in to the demo account with the `op` game. Screenshot the screen with a version
  chosen. Check that the shutter, the holder control and the count line fit with no overlap at
  320 px. The camera can be the browser's fake device.
- [ ] **Step 6: Commit** `feat(phone): Contribute photos screen for testers`.

---

### Task 8: The pull script

**Files:**
- Create: `scripts/scan/pull-training.ts`
- Modify: `scripts/catalog/vite.config.ts` (add
  `'pull-training': \`${root}scripts/scan/pull-training.ts\`` to `rollupOptions.input`)
- Modify: `package.json` (add a script
  `"scan:pull-training": "vite build --config scripts/catalog/vite.config.ts && node out/catalog/pull-training.mjs"`,
  as `catalog:thumbs` is built)
- Test: `tests/main/pull-training.test.ts` (the pure parts, through `src/shared/training.ts`, plus
  `planPull` exported from the script)

**Interfaces:**
- Consumes: Task 1 (`truthRowOf`, `TrainingLabelRow`), Task 4 (`/admin/training/labels`,
  `/admin/training/photo/<id>`).
- Produces:
  - CLI: `PORTAL_URL=… PORTAL_ADMIN_TOKEN=… npm run scan:pull-training -- [--game op] [--out ~/scan-capture]`.
    - The defaults are `op` and `~/scan-capture`, with `~` expanded via `homedir()`.
    - Missing env throws `PORTAL_URL and PORTAL_ADMIN_TOKEN must both be set` (as `thumbs.ts`
      does).
  - `planPull(labels: TrainingLabelRow[], have: ReadonlySet<string>): { download: TrainingLabelRow[]; truth: TruthRow[]; stale: string[] }`:
    - Each `clientId` is re-checked against `CLIENT_ID_RE` before it names a file; a label that
      fails is left out of `download` and `truth`, with a warning (defence in depth).
    - `download` is the labels whose `<clientId>.jpg` isn't in `have`.
    - `truth` is every label's `truthRowOf`, in id order.
    - `stale` is the names in `have` that no label names. These are photos deleted by the tester.
      They are reported and **not** deleted.
  - Steps:
    1. Page `labels?game=…&after=…&limit=500` until `more` is false.
    2. `mkdir -p <out>/shots-<game>`.
    3. Download each missing photo, 2 at a time, writing to `<name>.part` and then renaming, so
       an interrupted run never leaves a half file under the real name.
    4. Write `<out>/<game>-truth.json` (2-space JSON) only after every download succeeds.
    5. Print `N labels, D downloaded, S stale, by holder: bare 40, sleeve 12, …`.
  - It imports app modules normally; the Vite bundle resolves them (Node's type stripping can't
    follow `src/shared/games`' extensionless imports).
  - `source: 'app'` stays. The Pokémon replay groups only `owner` and `ebay`, so step 4's One
    Piece replay must treat `'app'` like `'owner'`.

- [ ] **Step 1: Write the failing tests.**

```ts
const A = '0f8e2c1a-1b2c-4d3e-8f90-00000000000a', B = A.replace(/a$/, 'b'), C = A.replace(/a$/, 'c')
const row = (id: number, clientId: string): TrainingLabelRow => ({ id, clientId, game: 'op',
  userId: 7, username: 'dubgrumble', cardId: 2 ** 39 + 5, printingId: 812, holder: 'bare',
  device: 'Android 15 Pixel 8', appVersion: '0.53.0', takenAt: '2026-11-05T01:59:00.000Z',
  createdAt: '2026-11-05T01:59:01.000Z', language: 'en', number: 'OP05-119', bandaiId: null,
  version: 'SR' })
test('plans only missing photos and keeps id order', () => {
  const p = planPull([row(1, A), row(2, B), row(3, C)], new Set([`${B}.jpg`, 'z.jpg']))
  expect(p.download.map((r) => r.clientId)).toEqual([A, C])
  expect(p.truth.map((t) => t.file)).toEqual([`shots-op/${A}.jpg`, `shots-op/${B}.jpg`, `shots-op/${C}.jpg`])
  expect(p.stale).toEqual(['z.jpg'])
})
test('truth rows have the pkm-truth keys', () => {
  const t = planPull([row(1, A)], new Set()).truth[0]
  for (const k of ['file', 'source', 'sourceId', 'version', 'language', 'holder']) expect(t).toHaveProperty(k)
})
test('a client id that isn\'t a UUID never names a file', () => {
  const p = planPull([row(1, '../../x'), row(2, A)], new Set())
  expect(p.download.map((r) => r.clientId)).toEqual([A])
  expect(p.truth.map((t) => t.file)).toEqual([`shots-op/${A}.jpg`])
})
```

- [ ] **Step 2: Run** `npm test -- tests/main/pull-training.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the script. Guard `main()` behind `import.meta.url ===
  pathToFileURL(process.argv[1]).href`, so importing it in the test doesn't run it (the guard
  still holds in the bundle).
- [ ] **Step 4: Run** the test. Expected: PASS. Then run the script against an empty local
  `wrangler dev`, or skip this if it isn't feasible headless. Expected: `0 labels` and an empty
  `op-truth.json` (`[]`).
- [ ] **Step 5: Commit** `feat(scan): pull training photos and their truth file`.

---

### Task 9: Release check and order (controller, not dispatched)

- [ ] **Step 1: Full check.** Run `npm test`, `npm --prefix workers/portal test`,
  `npm run typecheck`, `npm --prefix workers/portal run typecheck` and lint on the touched files.
  Check with `git diff main --stat` that the diff doesn't touch these:
  - `src/shared/scan/profiles.ts`, `PhoneCamera.tsx` or `StreamCamera.tsx`
  - the fingerprint or catalog stages
  - any ygo/pkm wire type
- [ ] **Step 2: Deploy the portal first.** `server-37` is one-way. Before the deploy, confirm the
  `duel-binder-images` bucket (which now also holds `training/`) has no r2.dev public URL and no
  custom domain. After the deploy:
  - `GET /api/training/summary?game=op` with the owner's token gives `{total:0,today:0,dailyCap:500}`
  - with a non-tester's token it gives 404
  - `/admin#photos` shows "No photos yet."
  Record the Worker version id.
- [ ] **Step 3: Owner smoke test of the upload path,** on the deployed portal, with the owner's
  token and a small JPEG:
  1. POST one photo.
  2. Check `/admin#photos` shows 1 photo.
  3. Run `npm run scan:pull-training` and check that the file and the truth row appear.
  4. DELETE it.
  5. Pull again: the file shows as stale and the truth file is `[]`.
- [ ] **Step 4: Client release.** Bump the next minor version, tag `v*`. Android AAB uploads to
  Play internal testing through CI. Merge and release follow the owner's overnight grant. The PR
  body states the typed-only deviation from the spec (OCR scope above) for the owner to sign off,
  and names step 3b (One Piece scan profile and number OCR, accepted by a replay against the
  friend's first photos) as the next step.
- [ ] **Step 5: Hand-off note for the owner** to pass to the friend:
  - where the screen is (Settings → Contribute photos)
  - the "What to shoot" list
  - the 200–300 target
  - that typed numbers are the way in this release
  For the owner alone: typed-only is a deviation from the spec awaiting his sign-off, with step
  3b next (as in the PR body). Parked: `purgeHolds` R2 cleanup for training rows left on a
  purged account.
  Record the open device checks: real camera resolution on his Android, IndexedDB queue across an
  app kill, the upload time per shot on mobile data.
