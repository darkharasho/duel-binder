# Magic scanner steps 3 and 3b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Magic a scan profile and a nightly `fingerprints-mtg` file. Let testers send Magic training photos through Contribute on desktop and phone. Scanning stays off.

**Architecture:** `MTG_PROFILE` joins `SCAN_PROFILES`. `buildFingerprints` gains an `mtg` branch: one record per artwork look, Scryfall `large` images, back faces under their own image ids. The upload is ungated, as One Piece's step 4a was. Contribute takes Magic's `SET NUMBER` codes. The existing version picker already lists each finish as its own printing (`Rare` / `Rare (Foil)`), so tapping one of those is the foil tap. The Contribute button picks the current game when it is a tester game.

**Tech Stack:** TypeScript, Electron + React (desktop), Capacitor (phone, `src/phone`), better-sqlite3, vitest, GitHub Actions (`catalog.yml`), Cloudflare Worker portal (no change needed).

**Spec:** `docs/superpowers/specs/2026-11-11-magic-scanner-design.md`

## Global Constraints

- Work in the worktree `/var/tmp/mtg-scan-wt` (branch `feat/mtg-scanner`); other sessions commit in the main checkout.
- vitest with at most 2 workers: `npx vitest run --maxWorkers=2 <files>`. Don't run the whole suite while the machine is under load; run the files a task touches.
- No heavy test data: tests use a handful of rows. Size and speed get measured in a capped standalone script, never 100k rows in vitest.
- Before pushing: `npm run typecheck:web` and `npm run typecheck:phone` separately (plain `typecheck` stops at resvg).
- Yu-Gi-Oh, Pokémon and One Piece fingerprint files, profiles and resolvers stay byte-identical; their existing tests pass unchanged.
- `features.scan` stays `false` for Magic. `MAGIC.access` stays `'testers'`.
- Scryfall: images only from `cards.scryfall.io` via `scryfallArtUrl` (`src/shared/imageSources.ts`). Fingerprint crops are never shown.
- The portal already has `scan/mtg/fingerprints.bin` keys and an 8 MB limit (`workers/portal/src/scanFiles.ts`). No portal deploy is needed for these steps.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A typed code in the printed form** (`0123`, `mh3 123`, `MH3-123`, `plst xln-217`, `123a`) must find the printing. Pinned in Task 4.
2. **A two-faced card** must hash its back face from Scryfall's `/back/` URL under `back_image_id`, never the front image twice. Pinned in Task 2.
3. **Rows that borrow art or have none** (`mtg_images.art_from` not NULL) must never get a record. That covers placeholder previews and non-English rows showing English art. Pinned in Task 2.
4. **A tester with both One Piece and Magic** who opens Contribute while on Magic must get Magic, not the first tester game. Pinned in Task 5.
5. **The One Piece number reader and guide box** must not run on a Magic Contribute screen (`game === 'op'` gates stay). Pinned in Task 5.

---

### Task 1: Magic scan profile

**Files:**
- Modify: `src/shared/scan/profiles.ts` (replace the `// mtg: scanner step` comment near line 169; add `mtg: MTG_PROFILE` to `SCAN_PROFILES`)
- Create: `scripts/scan/mtg-regions.ts` (measuring aid, not shipped)
- Test: `tests/main/scan-profiles.test.ts` (new `describe('mtg')`)

**Interfaces:**
- Produces: `scanProfile('mtg'): ScanProfile`. Task 2 relies on `artBoxes[0]` being the box references are cut to.

- [ ] **Step 1: Measure.** `scripts/scan/mtg-regions.ts <out-dir>` downloads Scryfall `large` images (via `scryfallArtUrl(id, 'full')`, 100 ms apart, `User-Agent: DuelBinder/dev`) of seven printings: a `2015`-frame creature, an instant, a planeswalker, a saga, a borderless card, an extended-art card and a full-art basic land. Pick them from `/var/tmp/scry/all-cards.jsonl.gz`, or by Scryfall id from the catalog. It also fetches one `2003`-frame and one `1997`-frame card. It draws the candidate boxes below on each and writes a contact sheet PNG. Adjust the boxes until each is true on every image it claims to cover. Starting values, as shares of the card:
  - art (`artBoxes[0]`, all art on every `2015` layout above): `[0.085, 0.115, 0.915, 0.545]`
  - windows (printed art window borders): `2015` `[0.075, 0.105, 0.925, 0.555]`, `2003` `[0.08, 0.1, 0.92, 0.545]`, `1997` `[0.105, 0.095, 0.895, 0.53]`
  - codeBands: `2015` info line `[0.03, 0.935, 0.5, 0.99]`, `2003` collector number `[0.3, 0.945, 0.7, 0.985]`
  - nameBand `[0.06, 0.04, 0.68, 0.09]`; textBox `[0.08, 0.62, 0.92, 0.9]`
  - innerFrames: the three windows plus the text box border `[0.07, 0.6, 0.93, 0.915]`
- [ ] **Step 2: Write the failing tests** in `tests/main/scan-profiles.test.ts`:
  - `it('mtg has a profile')`: `scanProfile('mtg').game === 'mtg'`.
  - `it('mtg art box sits inside every window')`: for each `windows[i]`, `artBoxes[0]` is inside it on all four sides.
  - `it('mtg reads codes at the bottom')`: every `codeBands` box has `top >= 0.9`.
  - `it('mtg flags')`: `windowArt === true`, `rarityLook === false`, `foil === null`, `holderSearch === false`, `keepOutline === true`, `codeReach === 0.06`.
  - The existing `'every scanning game has a profile of boxes on the card'` test must cover `mtg` too. If it iterates games with `features.scan`, extend it to iterate `Object.keys(SCAN_PROFILES)`.
- [ ] **Step 3: Run:** `npx vitest run --maxWorkers=2 tests/main/scan-profiles.test.ts`. Expected: the new mtg tests FAIL ("No scan profile for mtg").
- [ ] **Step 4: Add `MTG_PROFILE`** with the measured values, `windowShape: null`, and `codeGray` left out. Add a doc comment naming the printings measured, as `OP_PROFILE`'s does. Remove the `mtg: scanner step` comment in `profiles.ts` only. The ones in `resolve.ts`, `fingerprints.ts` and `build.ts` go in later tasks.
- [ ] **Step 5: Run** the same command. Expected: PASS, the ygo/pkm/op tests unchanged.
- [ ] **Step 6: Commit** `feat(scan): Magic scan profile` (profile, test, measuring script).

### Task 2: `fingerprints-mtg` build

**Files:**
- Modify: `scripts/catalog/fingerprints.ts` (`buildFingerprints`: new `mtg` branch; `MTG_HASH_VERSION = '1'`; `MTG_CONCURRENCY = 4`; `MTG_FINGERPRINT_BUDGET = 20000`)
- Test: `tests/main/catalog-fingerprints.test.ts` (new `describe('buildFingerprints for Magic')`)

**Interfaces:**
- Consumes: `scanProfile('mtg')` (Task 1); `scryfallArtUrl(scryfallId, 'full', face)`; tables `card_images`, `mtg_images (image_id, scryfall_id, illustration_id, frame, border_color, full_art, back_image_id, art_from)`, `mtg_cards (card_id, lang)`.
- Produces: `buildFingerprints({ game: 'mtg', ... })` returns the usual `FingerprintResult`, whose `bytes` is a format v2 file. Also exports `mtgLookKey(row: { illustration_id: string | null; frame: string | null; border_color: string | null; full_art: number; image_id: number }): string`. Step 4's resolver will use it to find every printing of a matched look: `` `${illustration_id}|${frame}|${border_color}|${full_art}` ``, or `` `img:${image_id}` `` when `illustration_id` is NULL.

**Rules (my calls, from the spec):**
- Candidates are `mtg_images` rows with `art_from IS NULL`.
- One record per look key. The representative is the row whose card has `mtg_cards.lang = 'en'`, else the lowest `image_id`, so the choice is stable night to night. Its front is hashed from `scryfallArtUrl(scryfall_id, 'full', 'front')` under its `image_id`.
- When the representative has `back_image_id`, its back is hashed from `scryfallArtUrl(scryfall_id, 'full', 'back')` under `back_image_id`.
- The spec's frame effects are left out of the key: `mtg_images` has no such column. Extended-art and showcase rows share their plain twin's record, and the step 4 resolver sorts them out by code read or the picker.
- The spec's "mark lowres" becomes: images of sets whose `sets.tcg_date` is within the last 21 days are hashed again every night, so preview scans get replaced as Scryfall fills them in. There is no `image_status` column to read.
- At most `MTG_FINGERPRINT_BUDGET` new hashes a night (the cache keeps progress). The file holds whatever is cached, so it grows night to night, which never trips the portal's `MIN_KEPT_SHARE`.
- The `src` table records each id's URL, as One Piece does, so a representative change re-hashes.

- [ ] **Step 1: Write the failing tests.** Use a work DB seeded with a few `mtg_images` rows and a fake `fetch` serving small generated JPEGs (follow the One Piece tests' setup in the same file):
  - `it('hashes one record per look, preferring the English row')`: two rows share illustration/frame/border/full_art (a `ja` row with the lower id and an `en` row), plus one row with another frame. Expect 2 records; the shared look is under the `en` row's `image_id`; the fetched URLs are `https://cards.scryfall.io/large/front/...`.
  - `it('hashes a back face under back_image_id from the back URL')`: one row with `back_image_id = B`. Expect a record for `B`, and that `.../large/back/...` was fetched.
  - `it('leaves out rows that borrow art or have none')`: rows with `art_from = '<uuid>'` and `art_from = 'none'` get no record and no fetch.
  - `it('gives a row with no illustration id its own record')`: two NULL-illustration rows give 2 records.
  - `it('stops at the nightly budget and carries on next run')`: with the budget passed as an option set to 1 and 3 looks, the first run hashes 1 and the second hashes 1 more (cache reused).
  - `it('hashes images of sets from the last 21 days again')`: a cached row in a set dated 5 days before `now` is fetched again; one dated 60 days before is not. Take `now` from an option, as other date-dependent code does.
  - `it('writes format v2')`: `decodeFingerprints(out.bytes)` reads back the ids (all above 2^32).
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 tests/main/catalog-fingerprints.test.ts`. Expected: the Magic tests FAIL, and the rest pass.
- [ ] **Step 3: Implement the `mtg` branch** in `buildFingerprints`. Add `budget?: number` and `now?: () => Date` to `FingerprintOptions`. Image selection replaces the `card_images` query for `mtg` only; the ygo/pkm/op paths stay untouched. Add `MTG_HASH_VERSION` to the `hashVersion` choice. Replace the two `mtg: scanner step` comments in this file with the branch.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(catalog): Magic art fingerprints, one per look`.

### Task 3: Job stage, workflow, and the real-size check

**Files:**
- Modify: `scripts/catalog/build.ts` (around lines 225, 262-347, 461, 491, 530: stage `'fingerprints-mtg'`, `magicFingerprints(upload)`, `fingerprint()` accepts `mtg` and uploads it ungated like `op`; `skipMagic` honoured)
- Modify: `.github/workflows/catalog.yml` (restore/save cache `catalog-work/fingerprints-mtg.sqlite` with key prefix `catalog-fpmtg-`; step "Magic fingerprints" with `id: fingerprints-mtg`, `continue-on-error: true` and a "Flag failed Magic fingerprints" step, mirroring the One Piece pair at lines 101-106, 161-168, 215-220)
- Create: `scripts/scan/mtg-fingerprint-size.ts` (measurement, not shipped)
- Test: `tests/main/catalog-fingerprints.test.ts` (`describe('runJob')`)

**Interfaces:**
- Consumes: `buildFingerprints({ game: 'mtg' })` (Task 2).
- Produces: `npm run catalog:job -- --stage fingerprints-mtg`.

- [ ] **Step 1: Write the failing tests** in `describe('runJob')`:
  - `it('uploads Magic fingerprints ungated with ?game=mtg')`: with a work DB holding one Magic image, the fake portal receives `PUT /admin/scan/fingerprints?game=mtg`, and the log has `Magic accuracy: no shots yet; not gated`.
  - `it('skips Magic fingerprints with --no-magic')`: no `?game=mtg` PUT.
  - `it('skips Magic fingerprints when there are no Magic cards')`: log line `Magic fingerprints: no Magic cards yet`.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 tests/main/catalog-fingerprints.test.ts`. Expected: the 3 new tests FAIL.
- [ ] **Step 3: Implement** the stage. Widen the type of `fingerprint`'s `game` parameter to `GameId`; set `what` to `'Magic fingerprints'`. Ungated branch: `game === 'op' || game === 'mtg'`, logging `Magic accuracy: no shots yet; not gated` for mtg. Fix the gate default's comment (`game === 'pkm' ? PKM_FIXTURES_DIR : FIXTURES_DIR` is never reached for mtg). Add the workflow steps.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Real-size check.** `scripts/scan/mtg-fingerprint-size.ts <catalog.sqlite>` runs the Task 2 selection on a real desktop catalog. Use a copy of `~/.config/duel-binder/catalog.sqlite`; the app may hold it open. It reads rows only and hashes nothing. It prints the look count, the back-face count, the expected file size (`11 + 44 × records`) and the time to scan a `FingerprintIndex` of that many random hashes 100 times. Expected: under 6 MB and under the 8 MB portal limit, with a scan time small enough for the spec's "≤ ~50 ms per frame on the phone". Record the numbers in the PR description. **If the file would be over 6 MB, stop and report back** (spec rule).
- [ ] **Step 6: Commit** `feat(catalog): fingerprints-mtg stage, ungated until there are Magic shots`.

### Task 4: Magic codes for typing in Contribute

**Files:**
- Create: `src/shared/scan/magicCode.ts`
- Modify: `src/shared/scan/onePieceNumber.ts` (`prefixSuggestions` gains a separator)
- Modify: `src/main/repo/scan.ts` (`numberPrefixes`, near line 469)
- Test: `tests/main/scan-magic-code.test.ts` (new); `tests/main/scan-repo.test.ts` (numberPrefixes)

**Interfaces:**
- Produces:
  - `normalizeMagicCode(text: string): string | null` turns typed text into the catalog's `set_code` form, `'<SET> <number>'`: the set uppercased, leading zeros dropped from the number, a letter suffix kept as typed (lowercase), `★` kept. Set and number may be split by spaces, `-`, `#` or `/`. The List keeps its inner dash: `plst xln-217` → `PLST XLN-217`. Returns null when there's no number. Also `normalizeMagicCode('mh3123') === null`: Magic set codes contain digits, so a separator is required.
  - `prefixSuggestions(typed, prefixes, max = 8, sep = '-')`. With `sep = ' '`, it suggests `'MH3 '` and stops once the typed text holds a space.
  - `numberPrefixes(db, scope)` returns the text before the first space of Magic `set_code`s (`MH3`, `PLST`) when the scope's game is `'mtg'`. Other games are unchanged (before the dash). The game is read the way `numberIndex` reads it (`SELECT ${scope.game} AS game`).

- [ ] **Step 1: Write the failing tests:**
  - `normalizeMagicCode`: `'mh3 123'`→`'MH3 123'`, `'MH3-0123'`→`'MH3 123'`, `'mh3 #123'`→`'MH3 123'`, `'mh3/123'`→`'MH3 123'`, `'neo 123a'`→`'NEO 123a'`, `'9ed 213★'`→`'9ED 213★'`, `'plst xln-217'`→`'PLST XLN-217'`, `'mh3123'`→`null`, `'mh3'`→`null`, `''`→`null`.
  - `prefixSuggestions('mh', ['MH1','MH2','MH3','NEO'], 8, ' ')` → `['MH1 ','MH2 ','MH3 ']`; `prefixSuggestions('mh3 ', [...], 8, ' ')` → `[]`; the default-separator One Piece cases in the existing tests are unchanged.
  - `numberPrefixes` with a Magic scope over printings `'MH3 1'`, `'MH3 2'`, `'PLST XLN-217'` → `['MH3','PLST']`. A One Piece scope still gives `['OP01']` for `'OP01-001'`.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 tests/main/scan-magic-code.test.ts tests/main/scan-repo.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the three functions. Check that the phone answers `scan:numberPrefixes` through the same repo function (`src/phone/data/store.ts`). If it has its own SQL, apply the same change there and test it in the phone store's test.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(training): type Magic set codes in Contribute`.

### Task 5: Contribute for Magic on desktop and phone

**Files:**
- Modify: `src/renderer/src/features/training/contributeContext.ts` (export `contributeGame`)
- Modify: `src/renderer/src/features/training/contribute.tsx:19`, `src/renderer/src/components/AppShell.tsx:87-190`, `src/renderer/src/features/settings/SettingsPage.tsx:112-210`, `src/phone/Settings.tsx:90-280` (use `contributeGame`)
- Modify: `src/phone/training/ContributeScreen.tsx:318-321` (code parsing and chips by game), and its placeholder and help copy (`src/phone/training/copy.ts` if the copy lives there)
- Test: `tests/renderer/contribute-game.test.ts` (new, or beside the existing Contribute tests; find them with `grep -rl ContributeScreen tests`), plus the existing ContributeScreen test file

**Interfaces:**
- Consumes: `normalizeMagicCode`, `prefixSuggestions(..., sep)` (Task 4).
- Produces: `contributeGame(current: GameId, available: readonly GameId[]): GameId | undefined`. Returns `current` when it's available with `GAMES[current].access === 'testers'`, else the first available tester game, else `undefined`.

- [ ] **Step 1: Write the failing tests:**
  - `contributeGame('mtg', ['ygo','pkm','op','mtg'])` → `'mtg'`; `contributeGame('ygo', ['ygo','op','mtg'])` → `'op'`; `contributeGame('ygo', ['ygo'])` → `undefined`.
  - ContributeScreen with `game='mtg'` and a stubbed `api.scan.printingsByCode('MH3 123')` returning a `Rare` and a `Rare (Foil)` printing: typing `mh3 123` lists both as separate versions, and neither is selected until tapped. Picking `Rare (Foil)` and taking a shot queues a label whose version is `Rare (Foil)`.
  - ContributeScreen with `game='mtg'`: the number reader isn't started (stub `engineFactory` and assert it's never called), and no guide box is rendered.
  - The typing field's placeholder reads `MH3 123` for mtg (and stays as today for op).
- [ ] **Step 2: Run** the Contribute test files with `--maxWorkers=2`. Expected: FAIL.
- [ ] **Step 3: Implement.** In ContributeScreen, set `number = game === 'mtg' ? normalizeMagicCode(text) : normalizeOpNumber(text)` and pass chips `sep = game === 'mtg' ? ' ' : '-'`. Leave every `game === 'op'` reader, snap and guide gate as is. The four entry points call `contributeGame(game, available)` instead of `available.find(...)`. The help text names the current game, `GAMES[g].name`, as it already does.
- [ ] **Step 4: Run** the same tests. Expected: PASS. Then `npm run typecheck:web` and `npm run typecheck:phone`: no errors.
- [ ] **Step 5: In the app.** Launch the desktop dev build with a slim userData copy (`DUEL_BINDER_USER_DATA`; the installed app holds the single-instance lock). Switch to Magic, open Contribute, and type `mh3 1`. Expect the `MH3 ` chip, the versions listed with their finishes, and a shot queued. Screenshot it for the PR. Don't send real uploads from a dev build; check that the outbox entry exists.
- [ ] **Step 6: Commit** `feat(training): Contribute photos for Magic, with finish picked like any version`.

### Task 6: Hand-off notes and PR

- [ ] **Step 1:** Add a "Training photos" paragraph to the spec's step 3b. Pull with `PORTAL_URL=… PORTAL_ADMIN_TOKEN=… npm run scan:pull-training -- --game mtg`, which writes `~/scan-capture/shots-mtg/` and `mtg-truth.json`. Rip-capture frames get labelled by hand into the same `TruthRow` shape (`src/shared/training.ts`), with `tester` set to `rip-<session folder>` so they can be told apart.
- [ ] **Step 2:** Open one PR from `feat/mtg-scanner`. The description covers: the Task 3 size and speed numbers; "scan stays off; first `fingerprints-mtg` upload happens on the next catalog run and fills over about 4 nights at 20k a night"; "no portal deploy needed"; and "release needs a `v*` tag for phone Contribute". Watch CI with the CI watcher card.

## Step 4 (outline only, planned once about 200 Magic photos exist)

- `src/shared/scan/magicCode.ts` grows `frameMagicCode(codeTexts)`, which reads the info line: set, number, language, and the `•`/`★` glyph for the later foil spike.
- `src/renderer/src/features/scan/resolveMagic.ts`, called from `resolve.ts:354`: code read plus art look (`mtgLookKey` → printings) plus name read, following `resolveOnePiece.ts`'s agree, misread and unsure rules. Language order as in the spec.
- Finish: non-foil by default, a Foil toggle on rows, and a session finish lock (Auto / All non-foil / All foil). Foil-only printings take foil.
- `MTG_ART_MIN_MARGIN` and `MTG_SAME_ART` in `thresholds.ts`. Add `'mtg'` to `CODE_MODE_GAMES`, and turn on `features.scan` for testers.
- Then step 5: `scan-mtg-real.test.ts` in the CI `scan-photos` matrix, `2015`-frame floor 85% and 0 wrong, older frames scored apart.
