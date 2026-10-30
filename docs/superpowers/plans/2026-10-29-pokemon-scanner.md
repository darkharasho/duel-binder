# Pokémon Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Yu-Gi-Oh scanner (Scan page, scan window overlay, phone) works the same way for Pokémon English and Japanese cards, passes a zero-wrong / ≥85% bar on real photos, and then Pokémon opens to everyone.

**Architecture:** A per-game *scan profile* (card regions, art boxes, fingerprint file) feeds the existing camera → detect → warp → fingerprint → OCR → resolve pipeline. Pokémon gets its own fingerprint file (DBFP v2, 8-byte ids), its own resolver (`resolvePokemonSignals`: art + collector number + language must agree), a conservative version detector and a slab detector. Everything downstream (tracker, session list, outbox, overlay) is reused, with a price range for unsure versions and a "Raw" tag on slabs.

**Tech Stack:** Electron + React + TS, OpenCV.js in a worker, tesseract.js, better-sqlite3, Cloudflare Worker portal (R2), vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-pokemon-scanner-design.md` (parent: `docs/superpowers/specs/2026-10-29-multi-game-pokemon-design.md`).

## Global Constraints

- Yu-Gi-Oh keys, wire format and the Yu-Gi-Oh fingerprint file stay **byte-identical** (same R2 key `scan/fingerprints.bin`, same `GET /scan/fingerprints` with no query, DBFP v1 bytes). Existing Yu-Gi-Oh scan tests and `tests/main/scan-accuracy-gate.test.ts` pass unchanged.
- No cross-language price fallback for Pokémon; always USD; a version's price never shows for another version.
- Pokémon stays owner-only (`access: 'owner'` in `src/shared/games/pokemon.ts`) until Task 14. Rip stays Yu-Gi-Oh only (`features.rip: false`).
- Run vitest with `--maxWorkers=2`. No heavy synthetic test data in vitest; benchmarks only in a capped standalone script (≤50k rows).
- Owner photos and eBay photos never enter the repo, an upload, or the app. They live under `~/scan-capture/` (owner: `shots-pkm/`, eBay: `ebay-pkm/`, labels: `pkm-truth.json`).
- Deploy the portal (`cd workers/portal && npm run deploy`) before any release; deploys are one-way. Local `gh` needs `env -u GITHUB_TOKEN`. Never bare `git stash`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Overlay timings, hit price setting (default $20), `STABLE_FRAMES` 2, `ABSENT_MS` 600 are reused, not copied.
- The bar: **zero wrong, ≥85% recognized** (`MIN_RIGHT_SHARE = 0.85`). A correct card shown as `pick-printing` with a price range counts as recognized. "Wrong" = wrong card, wrong language, or wrong version with `flag: null`. A Chinese (or any non-EN/JA) card that is recognized at all is wrong.

## Review Focus

1. **A Simplified Chinese card under a Japanese twin's art** (same art, different text): must be `unsure`, never the Japanese card. Pinned in Task 6 (`'zh text with ja art match is unsure'`) and scored in Task 12.
2. **English and Japanese prints of the same card side by side in the fingerprint file** (same art, different card ids): the art margin rule must not make every Pokémon card `unsure`, and must not pick the other language. Pinned in Task 6 (`'en/ja twins resolve by language read'`).
3. **Switching game while the scan window is open or the outbox holds pulls:** pulls from one game must never be added while the other game is active, and the window must reload the other game's fingerprints. Pinned in Task 10 (`'hub leaves other-game drafts unacked'`) and Task 9 (`'scan loop re-inits when the game changes'`).
4. **A card with several versions and no readable version cue** (most holo/reverse pairs): overlay shows `low – high`, no hit banner, session row asks for the version. Pinned in Task 10 (`'pkm pick-printing pull shows range and is never a hit'`).
5. **An older Yu-Gi-Oh-only client or phone build fetching fingerprints** after the portal deploy: `GET /scan/fingerprints` with no query keeps returning the Yu-Gi-Oh file with the same ETag. Pinned in Task 2 (`'no game query serves the ygo file unchanged'`).

---

### Task 1: DBFP v2 — fingerprint ids above 2^32

**Files:**
- Modify: `src/shared/scan/fingerprintFile.ts`
- Test: `tests/main/scan-core.test.ts` (or a new `tests/main/scan-fingerprint-file.test.ts`)

**Interfaces:**
- Produces: `encodeFingerprints(entries)` writes **v1** (u32 ids, bytes identical to today) when every id ≤ 0xFFFFFFFF, else **v2**: same header with version byte `2`, then per record a u64 little-endian id (low u32, high u32) plus 32 hash bytes, sorted by id. `decodeFingerprints(bytes)` reads both. `FingerprintIndex.ids` becomes `Float64Array` (ids ≤ 2^53 are exact). `nearest()` behavior unchanged.

- [ ] **Step 1: Failing tests**
  - `'v1 bytes are unchanged for ygo ids'`: encode three entries with ids `46986414, 89631139, 4294967295`, assert `bytes[4] === 1` and the bytes equal a golden `Uint8Array` captured from the current implementation before editing (write the golden first, from `main`).
  - `'pokemon ids round-trip in v2'`: ids `pokemonId('en/sv03-045#img')`, `pokemonId('ja/SV1S-001#img')`; assert `bytes[4] === 2`, decoded `index.ids` contains both exactly, and `index.nearest(hash, 1)[0].imageId` equals the id whose hash was queried.
  - `'decoder rejects version 3'`: throws.
- [ ] **Step 2:** Run `npx vitest run --maxWorkers=2 tests/main/scan-core.test.ts` → the v2 tests FAIL.
- [ ] **Step 3:** Implement; keep `encodeFingerprints`/`decodeFingerprints`/`FingerprintIndex` names and signatures.
- [ ] **Step 4:** Run the file plus `tests/main/scan-accuracy-gate.test.ts tests/main/catalog-fingerprints.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(scan): DBFP v2 for fingerprint ids above 32 bits`.

### Task 2: Per-game fingerprint file on the portal, desktop and phone

**Files:**
- Modify: `workers/portal/src/scanFiles.ts`, `workers/portal/src/app.ts` (routes), `src/main/scan/fingerprints.ts`, `src/main/index.ts`, `src/main/ipc/handlers.ts`, `src/shared/ipc.ts`, `src/renderer/src/web/httpApi.ts`, `src/phone/data/store.ts`, `src/phone/FirstRun.tsx`, `src/phone/Settings.tsx`, `src/phone/PhoneShell.tsx`, `scripts/catalog/fingerprints.ts` (`uploadFingerprints`)
- Test: `tests/portal/scan-files.test.ts`, `tests/main/scan-fingerprints.test.ts`, `tests/main/phone-store.test.ts`

**Interfaces:**
- Produces:
  - Portal: `GET /scan/fingerprints?game=pkm` and `PUT /admin/scan/fingerprints?game=pkm` (and rollback) use R2 keys `scan/pkm/fingerprints.bin` / `scan/pkm/fingerprints.prev.bin`. No `game` or `game=ygo` → today's keys. Unknown game → 400. The pkm GET is public like ygo's (art hashes reveal nothing about access).
  - Desktop: `createFingerprintStore({ dir, portal, game, ... })`; files `fingerprints.bin`/`.json` for ygo (unchanged), `fingerprints-pkm.bin`/`.json` for pkm. Main holds one store per game.
  - IPC (`src/shared/ipc.ts`): `fingerprints(game: GameId): Promise<ArrayBuffer | null>`, `refreshFingerprints(game: GameId, opts?: { force?: boolean }): Promise<FingerprintStatus>`.
  - Phone: `phone_files` name `'fingerprints'` for ygo (unchanged), `'fingerprints:pkm'` for pkm; `store.fingerprints(game)`, `store.refreshFingerprints({ game, force })`; first run and Settings refresh every game in `games()`.
  - `uploadFingerprints({ url, token, bytes, game, fetch? })` appends `?game=pkm` only for pkm.

- [ ] **Step 1: Failing tests**
  - portal `'no game query serves the ygo file unchanged'`: seed `scan/fingerprints.bin`, GET with no query and with `?game=ygo` → same body and ETag; GET `?game=pkm` → 404 until a pkm file is put; PUT `?game=pkm` writes `scan/pkm/fingerprints.bin` and leaves the ygo object untouched; the shrink guard applies per game; `?game=xx` → 400.
  - desktop store `'pkm store uses its own files'`: a pkm store fetches `${portal}/scan/fingerprints?game=pkm` and writes `fingerprints-pkm.bin`; the ygo store's request URL is exactly `${portal}/scan/fingerprints`.
  - phone `'refresh pulls each game's fingerprints'`: owner portal with both files; after `refreshFingerprints({ force: true })` for each game, `fingerprints('ygo')` and `fingerprints('pkm')` return their own bytes.
- [ ] **Step 2:** Run the three test files → FAIL.
- [ ] **Step 3:** Implement. Callers that don't know a game yet pass `'ygo'` (Task 9 wires the real game).
- [ ] **Step 4:** `npm run typecheck` and the three files → PASS; `tests/portal/legacy-client.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(scan): per-game fingerprint file`.

### Task 3: Scan profiles and Pokémon card regions

**Files:**
- Create: `src/shared/scan/profiles.ts`
- Modify: `src/renderer/src/features/scan/vision/regions.ts`, `vision/analyze.ts`, `vision/detect.ts` (`rankArt`), `vision/candidates.ts` (`recognizeArt`), `vision/vision.worker.ts`, `engine.ts`, `src/shared/scan/fingerprint.ts` (`fingerprintSource`)
- Test: `tests/main/scan-vision-detect.test.ts`, `tests/renderer/scan-engine.test.ts`, new `tests/main/scan-profiles.test.ts`

**Interfaces:**
- Produces (`src/shared/scan/profiles.ts`):
  ```ts
  export type Box = readonly [x0: number, y0: number, x1: number, y1: number] // fractions of the warped card
  export interface ScanProfile {
    game: GameId
    artBoxes: readonly Box[]   // ygo: Object.values(ART_BOXES) as today
    codeBands: readonly Box[]  // ygo: CODE_BANDS; pkm: the bottom-left collector-number strip(s)
    nameBand: Box              // ygo: NAME_BAND; pkm: the name at the top-left
    textBox: Box               // ygo: TEXT_BOX; pkm: the attack/ability text area (language read)
    rarityLook: boolean        // ygo true, pkm false (the Yu-Gi-Oh rarity cues/look model don't run)
  }
  export const SCAN_PROFILES: Record<GameId, ScanProfile>
  export function scanProfile(game: GameId): ScanProfile
  ```
- `analyze(cv, img, index, candidates, wantBands, wantLook, profile)`, `rankArt(..., profile)`, `recognizeArt(..., profile)` take the profile (ygo default keeps every existing call site's behavior). Worker `init` message gains `game: GameId`. `createScanEngine` deps gain `game: GameId`.
- `fingerprintSource(img, frameType, profile)` crops the reference image to `profile.artBoxes[0]` for pkm (references are full-card images); ygo unchanged (references are already cropped art).

- [ ] **Step 1: Failing tests**
  - `'ygo profile equals today's constants'`: `scanProfile('ygo')` boxes deep-equal `ART_BOXES`/`CODE_BANDS`/`NAME_BAND`/`TEXT_BOX`.
  - `'pkm art box crops the reference and the warped card alike'`: take one full-card Pokémon fixture image (from Task 11's `tests/fixtures/scan-pkm/full/`; for now commit one TCGdex `low.jpg` there), warp-free: `artHash(fingerprintSource(img,'pokemon',pkm))` vs `artHash(crop(resize(img, CARD_W, CARD_H), pkm.artBoxes[0]))` hamming ≤ 20.
  - Engine: `'engine posts game in worker init'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Measure the pkm boxes on the standard card layout (63×88 mm; art window, name strip, bottom collector-number strip, text area) and on full-art/illustration rares, which share the outer layout. One art box is the default; add a second only if Task 13 shows full-arts miss.
- [ ] **Step 4:** Run the new tests and every `tests/**/scan-*` file → PASS (ygo unchanged).
- [ ] **Step 5:** Commit `feat(scan): per-game scan profiles with Pokémon regions`.

### Task 4: Pokémon fingerprint build

**Files:**
- Modify: `scripts/catalog/fingerprints.ts`
- Test: `tests/main/catalog-fingerprints.test.ts`

**Interfaces:**
- Consumes: Task 1 v2 encoding, Task 3 `fingerprintSource(img, 'pokemon', scanProfile('pkm'))`.
- Produces: `buildFingerprints({ ...opts, game: GameId })`. For `pkm`: every `card_images` row of `game = 'pkm'`, image URL `${pokemon_cards.image_url}/low.jpg` (TCGdex; jpeg-js decodes it), and for a `tcgplayer-cdn` base the `_200w.jpg` URL as-is; same `fp` cache table but keyed in a separate cache file (`fingerprints-pkm.sqlite`) with its own `HASH_VERSION`. ygo output bytes unchanged.

- [ ] **Step 1: Failing test** `'pkm build hashes full-card art and writes v2'`: a work db with two pkm cards (`pokemonId('en/sv03-045')`, `pokemonId('ja/SV1S-001')`) and `image_url`s served by the injected `fetch` from fixture JPEGs; result `count === 2`, `bytes[4] === 2`, decoded ids equal the two `card_images.image_id`s; no request goes to `images.ygoprodeck.com`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (first confirm `low.jpg` exists on TCGdex for one en and one ja card with `curl -sI`; if not, use `low.png` and add `pngjs` as a devDependency to decode it). **Step 4:** PASS, plus existing ygo cases. **Step 5:** Commit `feat(catalog): Pokémon fingerprint build`.

### Task 5: Collector number reading and lookup

**Files:**
- Create: `src/shared/scan/collectorNumber.ts`
- Modify: `src/main/repo/scan.ts`, `src/main/ipc/dataHandlers.ts`, `src/shared/ipc.ts`, `src/phone/data/store.ts` (channel list), `src/renderer/src/web/httpApi.ts`
- Test: new `tests/main/scan-collector-number.test.ts`, `tests/main/scan-repo.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CollectorNumber { setAbbrev: string | null; number: string; total: string | null }
  export function parseCollectorNumber(text: string): CollectorNumber | null
  export function collectorNumberCandidates(text: string): CollectorNumber[] // OCR confusions (O↔0, l/I↔1, S↔5, B↔8) like setCodeCandidates
  ```
  `number` keeps letters (`TG05`, `SV049`, `GG12`, `RC3`) and strips leading zeros only for comparison (`045` ≡ `45`).
- Repo: `printingsByNumber(db, n: CollectorNumber, scope = LOCAL): ScanPrinting[]` — matches Pokémon `set_code` (`"{abbrev} {localId}/{official}"` or `"{abbrev} {localId}"`) on number, plus total and abbrev when read. IPC `scan.printingsByNumber(n)`; `ResolveContext.lookups` gains it.

- [ ] **Step 1: Failing tests**
  - parser: `'045/193'` → `{setAbbrev:null, number:'045', total:'193'}`; `'PAL EN 045/193'` → `{setAbbrev:'PAL', ...}`; `'SV1S 001/078'` → `{setAbbrev:'SV1S', number:'001', total:'078'}`; `'TG05/TG30'` → `{number:'TG05', total:'TG30'}`; `'O45/l93'` candidates include `045/193`; `'HP 70'` → null.
  - repo: two pkm cards with `set_code` `'SV3 045/193'` (en) and `'SV1S 045/078'` (ja): `{number:'45', total:'193'}` → only the en printings; `{number:'045', total:null}` → both; a ygo card is never returned.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(scan): Pokémon collector number reading`.

### Task 6: Pokémon language read and resolver

**Files:**
- Create: `src/shared/scan/pokemonLanguage.ts`, `src/renderer/src/features/scan/resolvePokemon.ts`
- Modify: `src/renderer/src/features/scan/resolve.ts` (dispatch), `src/shared/scan/types.ts`
- Test: new `tests/renderer/scan-resolve-pokemon.test.ts`, new `tests/main/scan-pokemon-language.test.ts`

**Interfaces:**
- Produces:
  - `pokemonLanguage(text: string): 'en' | 'ja' | 'other' | null` — kana present → `ja`; CJK ideographs with no kana, or Hangul → `other`; mostly Latin → `en`; too little text → `null`. IPC `scan.language` is reused for the OCR (`jpn` + `chi_sim` + `eng` bands); the classification is this function.
  - `ResolveContext` gains `game: GameId` and `readLanguage?: () => Promise<'en'|'ja'|'other'|null>`; `resolveSignals` calls `resolvePokemonSignals(raw, ctx)` when `ctx.game === 'pkm'`, else today's path untouched.
  - `ScanDraft` gains optional `game?: 'pkm'` (absent for ygo, so ygo drafts serialize identically) and `slab?: true` (Task 8).
- Rules for `resolvePokemonSignals` (the algorithm the tests pin):
  1. `!raw.found` → `none`.
  2. Art group = cards (via `cardsForImages`) of matches with `distance ≤ ART_MAX_DISTANCE` and `distance ≤ best + ART_MIN_MARGIN`. Language is a property of the card's printings.
  3. Language read `other` → `unsure`.
  4. Number read (any `collectorNumberCandidates` hit via `printingsByNumber`): candidates = art group ∩ number cards (or number cards alone when the art group is empty **and** `matchName` agrees with that card). Filter by language when read. Exactly one card → recognized, `via: 'code'`. Zero or several → `unsure`.
  5. No number: the art group filtered to the read language must be exactly one card, and the language must have been read (`en`/`ja`, not `null`). Else `unsure`. (A Chinese card's art matches its Japanese and English twins; only a read language may decide.)
  6. Nothing matched and best distance > `ART_FAR_DISTANCE` → `none, far`.
  7. Version: options = the card's printings (versions). One option → `flag: null`. Else (Task 7 adds a version answer here; until then there is none) `flag: 'pick-printing'` with `printingId` = the lowest-priced option (the overlay shows the range, not this).
  8. Draft: `rarity` = version label, `setCode` = printing `set_code`, `game: 'pkm'`.

- [ ] **Step 1: Failing tests** (fakes from `tests/renderer/scanFakes.ts`, pkm printings with `language` en/ja):
  - `'en/ja twins resolve by language read'`: art matches en card A (d 30) and ja card B (d 31); read `ja` → B; read `en` → A; read `null` → `unsure`.
  - `'zh text with ja art match is unsure'`: art matches ja card only (d 20), read `other` → `unsure`.
  - `'number decides between reprints'`: art matches en cards A (`SV3 045/193`) and C (`SV4 201/182`, same art); number `045/193` → A, `via:'code'`.
  - `'number and art disagree is unsure'`.
  - `'number alone needs the name to agree'`.
  - `'single version is sure, several give pick-printing'`: card with only `Holofoil` → `flag:null`, `rarity:'Holofoil'`; card with `Normal`+`Reverse Holofoil` and no version answer → `pick-printing`, `printingId` = cheaper.
  - `'ygo path unchanged'`: `ctx.game === 'ygo'` returns exactly what `resolveSignals` returned before (reuse two existing `scan-resolve.test.ts` cases).
  - language: `'ピカチュウ HP 60 ワザ'` → `ja`; `'皮卡丘 HP 60 招式'` → `other`; `'Pikachu HP 60 Gnaw'` → `en`; `'HP'` → `null`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, and `tests/renderer/scan-resolve.test.ts` unchanged → PASS. **Step 5:** Commit `feat(scan): Pokémon resolver (art, number and language must agree)`.

### Task 7: Version detector (conservative)

**Files:**
- Create: `src/renderer/src/features/scan/vision/pokemonVersion.ts`
- Modify: `vision/analyze.ts` (emit version cues for pkm), `engine.ts` (`RawSignals.version`)
- Test: new `tests/main/scan-pokemon-version.test.ts`

**Interfaces:**
- Wires into Task 6 rule 7: when `pokemonVersion(raw.version, labels)` names one of the options, that option is chosen with `flag: null`.
- Produces: `pokemonVersionCues(cv, card: Mat, profile): VersionCues` (foil sparkle on the frame vs on the art window, measured like `vision/foil.ts`; a 1st Edition stamp check left of the art) and `pokemonVersion(cues: VersionCues | null, options: string[]): string | null`. It returns a label only when the cue is decisive **and** the label is among `options`; otherwise `null`. `RawSignals.version?: VersionCues`.
- Ruling built in: if Task 13 can't get it to zero wrong, `pokemonVersion` returns `null` for that distinction (ranges everywhere are acceptable; range counts as recognized).

- [ ] **Step 1: Failing tests:** `'frame foil picks Reverse Holofoil'` (cues: frame high, art low; options `['Normal','Reverse Holofoil']`) → `'Reverse Holofoil'`; `'art foil picks Holofoil'`; `'ambiguous cues give null'`; `'label not in options gives null'`; plus a synthetic-image test using `tests/main/scanCase.ts`-style drawing: a card image with a sparkle texture painted on the frame only → frame cue > art cue.
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(scan): conservative Pokémon version cues`.

### Task 8: Slab detection

**Files:**
- Create: `src/renderer/src/features/scan/vision/holder.ts`
- Modify: `vision/analyze.ts`, `engine.ts`, `resolvePokemon.ts` (sets `draft.slab = true`)
- Test: new `tests/main/scan-holder.test.ts`

**Interfaces:**
- Produces: `isSlab(cv, frame: Mat, quad: Quad): boolean` — true only when a graded label block (a bright rectangle with text, width ≈ card width, above the card inside a clear holder edge) is found. Toploaders and magnetic cases read as not-slab and are scanned like bare cards (detection inside cases already works, see `tests/main/scanCase.ts`). `RawSignals.slab?: boolean`.

- [ ] **Step 1: Failing tests:** synthetic frames built with the `scanCase.ts` helpers: bare card → false; `TIGHT_CASE` toploader → false; card with a white label block drawn above it inside a wider plastic outline → true; resolver test `'slab flag rides on the draft'`.
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(scan): detect graded slabs`.

### Task 9: Wire Pokémon into the scan loop, Scan page, scan window and phone

**Files:**
- Modify: `src/renderer/src/features/scan/useScanLoop.ts`, `ScanPage.tsx`, `InPageScanner.tsx`, `useHubScan.ts`, `pickerOptions.ts`, `ScanRowItem.tsx`, `window/ScanWindowApp.tsx`, `src/phone/ScannerScreen.tsx`, `src/phone/PhoneCamera.tsx` (look model only for ygo), `src/shared/games/pokemon.ts` (`features.scan: true`, `access` stays `'owner'`)
- Test: `tests/renderer/scan-page.test.tsx`, `tests/renderer/scan-window.test.tsx`, `tests/renderer/phone-scanner.test.tsx`, `tests/renderer/scan-session.test.ts`

**Interfaces:**
- Consumes: `useGame()` (`{ game, def }`), Tasks 2/3/6.
- `ScanLoopOptions` gains `game: GameId`; the loop loads `api.scan.fingerprints(game)`, inits the engine with `game`, passes `game` in `ResolveContext`, skips `withLook` when `!scanProfile(game).rarityLook`, and tears down/re-inits when `game` changes.
- Row and picker copy uses `def.vocab`: flag text `'Check version'` for pkm `pick-printing` (ygo strings unchanged); version picker label `` `${rarity} · ${formatUsd(price)}` `` for pkm.
- The scan window reads the active game the same way the main window does and reloads on `games` change.

- [ ] **Step 1: Failing tests:**
  - `'scan loop re-inits when the game changes'`: render the loop with `game:'ygo'`, rerender `'pkm'` → `api.scan.fingerprints` called with `'pkm'` and the engine re-inited with `game:'pkm'`.
  - `'pkm scan page shows the version picker'`: a `pick-printing` pkm row shows `Check version` and options `Normal · $1.00`, `Reverse Holofoil · $3.50`.
  - `'phone scanner runs without the look model for pkm'`.
  - `'scan tab shows for pkm when owner'` (phone and desktop, `pageInGame`).
- [ ] **Step 2–4:** FAIL → implement → PASS plus every `tests/renderer/scan-*` and `phone-*` file. **Step 5:** Commit `feat(scan): Pokémon on the Scan page, scan window and phone (owner only)`.

### Task 10: Overlay, hub and session for Pokémon

**Files:**
- Modify: `src/renderer/src/features/scan/window/overlay.ts`, `window/PullOverlay.tsx`, `ScanHub.tsx`, `session.ts`
- Test: `tests/renderer/scan-overlay.test.ts`, `tests/renderer/scan-window.test.tsx`, `tests/renderer/scan-session.test.ts`

**Interfaces:**
- `Pull` gains `raw: boolean` (`d.slab === true`). `pullOf` is unchanged otherwise: `pick-printing` → range, `hit:false`; sure → version price, `hit` when ≥ hit price — **slabs included**.
- `PullOverlay` shows a small "Raw" tag next to the price in both the Bar and the Hit when `raw`, styled like the existing range text.
- `ScanHub` acks and adds a draft only when `(draft.game ?? 'ygo') === active game`; other-game drafts stay in the outbox (unacked) until that game is active.

- [ ] **Step 1: Failing tests:**
  - `'pkm pick-printing pull shows range and is never a hit'`: options priced 2 and 45, hit price 20 → `range {2,45}`, `hit:false`, `price` = the picked option's price is not rendered as a single price (`PullOverlay` shows `$2.00 – $45.00` and no lone price).
  - `'slab pull shows Raw and can be a hit'`: sure version priced 120, `slab:true` → `raw:true`, `hit:true`; rendered Hit contains `Raw`.
  - `'hub leaves other-game drafts unacked'`: active game ygo, a draft with `game:'pkm'` arrives → no `ack`, no session row; switch to pkm → row added and acked.
- [ ] **Step 2–5:** FAIL → implement → PASS → commit `feat(scan): Pokémon pulls in the overlay, hub and session`.

### Task 11: Synthetic Pokémon fixtures, CI gate and nightly upload

**Files:**
- Modify: `scripts/scan/make-fixtures.ts` (a `--game pkm` mode), `scripts/catalog/accuracy.ts`, `scripts/catalog/build.ts`, `.github/workflows/catalog.yml` (cache `fingerprints-pkm.sqlite`)
- Create: `tests/fixtures/scan-pkm/` (shots, `full/` reference images, `manifest.json`), `tests/main/scan-pkm-accuracy-gate.test.ts`
- Test: `tests/main/catalog-job.test.ts`

**Interfaces:**
- `make-fixtures.ts --game pkm`: 16 targets — 8 en, 8 ja, including at least two en/ja twin pairs, two reverse-holo-capable cards, one full-art, one Trainer, one Energy — three synthetic shots each, plus distractors; reference images from TCGdex `low.jpg`; manifest shot adds `language` and `version|null`.
- `checkAccuracy(work, fingerprints, dir = FIXTURES_DIR, game: GameId = 'ygo')`: pkm uses `localScope("'pkm'")`, `resolvePokemonSignals`, and scores wrong card, wrong language, and wrong version with `flag:null` as wrong. Fixture shots have no OCR text, so language comes from the manifest via `readLanguage` (the art + language rule is what's under test). ygo scoring unchanged.
- Job: after the Pokémon step, `buildFingerprints({ game:'pkm' })` → `checkAccuracy(work, bytes, 'tests/fixtures/scan-pkm', 'pkm')` → `accuracyProblem` → `uploadFingerprints({ game:'pkm' })`, held back with `problem("Pokémon fingerprints held back: …")` on failure; skipped with `--no-pokemon`.

- [ ] **Step 1: Failing tests:** `scan-pkm-accuracy-gate.test.ts` `'pkm fixtures pass with zero wrong'` (builds fingerprints from `full/` like the ygo gate test, asserts `accuracyProblem(report) === null`) and `'a twin with the other language read is wrong'` (manifest language flipped for one shot → report.wrong has it); `catalog-job.test.ts` `'failing pkm gate holds back only the pkm file'`.
- [ ] **Step 2:** Generate fixtures: `node --experimental-strip-types scripts/scan/make-fixtures.ts --game pkm` (keep `tests/fixtures/scan-pkm` under 6 MB, like `tests/fixtures/scan`). **Step 3–4:** implement → PASS. **Step 5:** Commit `feat(scan): Pokémon accuracy gate in CI and the nightly job`.

### Task 12: Real-photo corpus and gate (local only)

**Files:**
- Create: `scripts/scan/pokemon-corpus/ebay.mjs` (fork of `scripts/scan/rarity-corpus/ebay.mjs`), `scripts/scan/pokemon-corpus/prep.ts`, `tests/main/scan-pkm-real.test.ts`
- Data (outside the repo): `~/scan-capture/ebay-pkm/`, `~/scan-capture/pkm-truth.json`, `~/scan-capture/pkm-work/` (catalog db + full pkm fingerprint file)

**Interfaces:**
- `pkm-truth.json`: `{ file: string /* relative to ~/scan-capture */, source: 'owner' | 'ebay', sourceId: string | null /* 'en/sv03-045', the TCGdex-derived id pokemonId() takes */, version: string | null, language: 'en' | 'ja' | 'zh' | 'other', holder: 'bare' | 'toploader' | 'case' | 'slab', unclear?: 'card' | 'version' }[]`.
- `ebay.mjs`: same credentials, caching and safety rules as the rarity corpus (Pokémon singles category, US; title must name a catalog card number), ~400 photos spread over eras, en and ja, holders; one-off run, small batches, its own search cap (`--max-searches 600`) so the nightly price sweep's quota is untouched; only main images; stock images flagged and dropped.
- `prep.ts`: copies the desktop catalog db's pkm rows (or builds from the catalog job's `work.sqlite`) into `pkm-work/catalog.sqlite` and runs `buildFingerprints({ game:'pkm' })` into `pkm-work/fingerprints-pkm.bin` (the full catalog, so distractors are real).
- `scan-pkm-real.test.ts`: env-gated on `SCAN_PKM_DIR` (= `~/scan-capture`); runs the full pipeline per photo (detect, warp, art, OCR via node tesseract as `scan-real.test.ts` does, language, number, version, slab, `resolvePokemonSignals`); prints a per-photo table; asserts **zero wrong** and **recognized ≥ 85%** over scorable shots (exclude `unclear:'card'`; don't score version for `unclear:'version'`; `zh`/`other` shots count only toward wrong), on the combined set **and** on `source:'owner'` alone; slab rows also check `slab === true` is never set on a non-slab (a false Raw tag is a wrong label).

- [ ] **Step 1: Label the owner's 226 photos** (controller, by eye, opening each image): card, version, language, holder; mark `unclear` rather than guess; batch labels in `~/scan-capture/shots-pkm/labels.jsonl` are hints only. Cross-check each label's `sourceId` exists in the catalog and its versions include `version`.
- [ ] **Step 2: Gather eBay photos** with `ebay.mjs`, then label/verify them the same way (title is a hint; the image decides; drop anything unclear).
- [ ] **Step 3:** `prep.ts`, then run `SCAN_PKM_DIR=~/scan-capture npx vitest run --maxWorkers=2 --silent=false tests/main/scan-pkm-real.test.ts` and record the baseline numbers in the ledger.
- [ ] **Step 4:** Commit the scripts and the env-gated test (no data) `test(scan): Pokémon real-photo gate (local)`.

### Task 13: Tune until the bar passes

**Files:** whichever of `profiles.ts` (boxes), `thresholds.ts` (only new pkm-specific constants; ygo values untouched), `collectorNumber.ts`, `pokemonLanguage.ts`, `pokemonVersion.ts`, `holder.ts`, `resolvePokemon.ts` the failures point at.

- [ ] **Step 1:** Sort the Task 12 failures: wrong (fix first; every wrong becomes a unit test in the owning task's test file before the fix) vs missed (by cause: detection, art, number OCR, language).
- [ ] **Step 2:** Iterate fix → unit test → real gate until **0 wrong and ≥85% recognized** on combined and owner-only. Allowed levers: boxes, pkm thresholds, OCR band preprocessing, the number parser, a second art box, turning a version distinction off. Not allowed: loosening the agreement rules in Task 6 steps 3–5.
- [ ] **Step 3:** Re-run the ygo gate and `SCAN_REAL_DIR` ygo real test → unchanged. Commit each fix separately (`fix(scan): …`).

### Task 14: Open Pokémon to everyone and ship

**Files:**
- Modify: `src/shared/games/pokemon.ts` (`access: 'everyone'`), `tests/portal/games-access.test.ts`, `tests/portal/sync-games.test.ts`, any test pinning owner-only Pokémon
- Test: the portal and phone tests above

- [ ] **Step 1:** Only after Task 13's gate passes (record the final numbers in the PR body). Update the access tests: a non-owner user's `/api/me` `games` is `['ygo','pkm']`; legacy clients still get Yu-Gi-Oh only where they did.
- [ ] **Step 2:** `npm run typecheck && npm test` → PASS.
- [ ] **Step 3:** PR, CI green, merge; deploy the portal; confirm `GET /scan/fingerprints?game=pkm` serves a file (run `npm run catalog:job` once by hand if the nightly hasn't uploaded one yet); then tag the release.
- [ ] **Step 4:** Commit `feat(pokemon): open Pokémon and its scanner to everyone`.
