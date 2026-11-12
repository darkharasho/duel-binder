# Magic Scanner Step 4 (the resolver) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the scanner name Magic cards (printing, language, finish) for the owner and testers, built and tuned on the owner's 435 Reality Fracture photos.

**Architecture:** `resolveMagic.ts` combines three signals the engine already produces for `MTG_PROFILE`: the closest art looks (`fingerprints-mtg`), the info line read from `codeBands`, and the name band. A Magic fingerprint record stands for a *look* (`mtgLookKey`), so a new lookup turns matched look ids into every printing showing that look. Finish defaults to non-foil (owner's call), with a per-row Foil toggle and a session finish lock.

**Tech Stack:** TypeScript, React, better-sqlite3 (desktop) / the phone's SqlDb, tesseract.js, OpenCV.js, vitest.

**Spec:** `docs/superpowers/specs/2026-11-11-magic-scanner-design.md` (sections "Step 4: the resolver" and "Finish"). Steps 3/3b plan: `docs/superpowers/plans/2026-11-11-magic-scanner-steps-3-3b.md`.

## What the photos showed (2026-11-12, measured on the corpus)

- Corpus: private repo `duel-binder-scan-corpus` at `mtg/` (commit 593127b): `shots-mtg/` (448 shots, 1920×1080, Facecam 4K, bare card held in one hand on a wood desk), `mtg-truth.json` (435 rows, `TruthRow` shape, `sourceId` `en/<set_code>` e.g. `en/FRA 81`, `version` = `set_rarity` e.g. `Common (Foil)`, plus `name`, `confidence`, `note`), `mtg-truth.skip.json` (13). Local copy: `/var/tmp/duel-binder-scan-corpus/mtg` or `~/scan-capture/` (`shots-mtg/`, `mtg-fra-truth.json`).
- 256 printings, 33 foils, 10 borderless, 10 full-art lands, 16 tokens (`TFRA n`), one `SPG 164`. All English, all `2015` frame.
- The card is about 630 px tall in the frame. The name is ~20 px high and reads cleanly. The info line is ~8 px high and prints **rarity first**: `C 0081` over `FRA • EN` (the older `078/279 C` order also exists on 2015–2022 cards). Foils print `★` for `•`. It was readable by eye on most shots, blurry on a handful.
- **No `fingerprints-mtg.bin` exists yet**: the stage first runs in catalog run 43173068810 with a 20k nightly budget. Task 2 builds a slim one for the corpus.

## Global Constraints

- 0 wrong is the bar; thresholds are never loosened to raise the score if that adds a wrong one (spec).
- A foil never shows the non-foil price unless that is the owner's non-foil default; a lock never picks a printing that doesn't exist (spec, Finish).
- Yu-Gi-Oh, Pokémon and One Piece don't regress: their resolvers, profiles and gate results stay as they are. `scan-op-real`, `scan-pkm-real`, `scan-real` numbers unchanged.
- Magic stays hidden (`MAGIC.access` unchanged); only `features.scan` turns on, which reaches testers alone.
- Speed: report median and slow-case time per card; Magic must not add more than ~50 ms per frame on the phone (spec).
- No heavy test data: unit tests seed a few rows; the corpus run is env-gated (`SCAN_MTG_DIR`) like `scan-op-real`.
- vitest always with `--maxWorkers=2`. Run `npm run typecheck:web` and `npm run typecheck:phone` separately before pushing.
- Work in the worktree `/var/tmp/mtg-step4-wt` (branch `feat/mtg-resolver`); other sessions commit in the main checkout.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pushing the corpus repo or this branch needs the owner's go.

## Review Focus

1. **A printing that borrows art** (`mtg_images.art_from` = another printing's Scryfall id, most non-English rows): it must be found through the look of the image it borrows, else every foreign printing is invisible to art. Test in Task 1.
2. **A two-faced card shown back side up:** the matched id is a `back_image_id`; it must lead to the same printings as the front. Test in Task 1.
3. **A reprint with the same look in another set** (same illustration, frame, border): art alone must not name a set. With no code read and no picked set, unsure with all printings as options. Test in Task 5.
4. **A code read that names a printing of a different card than confident art:** unsure, never either one. And a read one character off the art's printing in the same set is the art's. Tests in Task 5.
5. **Finish lock on a foil-only or non-foil-only printing:** the lock is ignored for that card. Test in Task 5.

---

### Task 1: Magic looks to printings

**Files:**
- Create: `src/shared/scan/magicLook.ts` (move `MagicLookRow`, `mtgLookKey` here from `scripts/catalog/fingerprints.ts`, which re-imports them; add `lookRepresentative`)
- Modify: `scripts/catalog/fingerprints.ts` (`magicFingerprintTargets` uses `lookRepresentative`)
- Modify: `src/main/repo/scan.ts` (new `printingsOfArt`), `src/shared/scan/types.ts` (`artIds?: number[]`), `src/shared/ipc.ts` (`scan:printingsOfArt` in `Api['scan']` and the channel list), `src/main/ipc/dataHandlers.ts`, `src/phone/data/store.ts` (`READ_CHANNELS`), `src/renderer/src/web/httpApi.ts` (`scanUnavailable`)
- Test: `tests/main/scan-repo.test.ts`, `tests/main/catalog-fingerprints.test.ts` (existing Magic tests must still pass)

**Interfaces:**
- Produces: `lookRepresentative<R extends MagicLookRow & { lang: string }>(rows: R[]): Map<string, R>` — per look key, the English row, else the lowest `image_id` (the rule `magicFingerprintTargets` uses today, now shared so the app and the nightly file agree).
- Produces: `printingsOfArt(db: SqlDb, imageIds: number[], scope?: Scope): ScanPrinting[]` — for Magic fingerprint ids (look representatives' fronts or their `back_image_id`s), every printing, all languages and finishes, whose own image has that look. Each returned printing has `imageIds = [its own image id]` (so the UI shows its own art) and `artIds = [look representative front id, back id if any]` (what `raw.art` ids are compared against).
- A printing's own image: the `mtg_images` row whose `scryfall_id` = `card_printings.set_rarity_code`; when that row's `art_from` is a Scryfall id, the look is that row's look; `art_from = 'none'` has no look and is never returned.
- Api: `scan.printingsOfArt(imageIds: number[]): Promise<ScanPrinting[]>`, a read channel on the phone.

- [ ] **Step 1: Write the failing tests** in `tests/main/scan-repo.test.ts`, `describe('printingsOfArt')`, seeding `cards`/`card_printings`/`card_images`/`mtg_cards`/`mtg_images` for one card printed in two sets with the same look (`FRA 107` en, `XYZ 5` en reprint), a borderless `FRA 346` (other look), a `ja` printing whose image has `art_from` = the `FRA 107` Scryfall id, and a transform card with `back_image_id`:
  - `it('finds every printing of a look from its representative id')` → `FRA 107` both finishes, `XYZ 5` both finishes, the `ja` one; not `FRA 346`.
  - `it('reaches a printing that borrows its art')` → the `ja` printing is in the result for the English representative id, with `imageIds` = its own image id.
  - `it('leads a back face id to the same printings as the front')`.
  - `it('gives each printing the look ids it is matched by')` → `artIds` equals `[front rep, back rep]` / `[front rep]`.
  - `it('ignores ids that are not Magic looks')` → `[]` for a Yu-Gi-Oh image id.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 tests/main/scan-repo.test.ts`. Expected: the new tests FAIL (`printingsOfArt` not exported).
- [ ] **Step 3: Implement** `lookRepresentative`, `printingsOfArt` (indexed lookups by `illustration_id` and `back_image_id`; chunk ids by 500 as the file does) and the channel plumbing.
- [ ] **Step 4: Run** `npx vitest run --maxWorkers=2 tests/main/scan-repo.test.ts tests/main/catalog-fingerprints.test.ts tests/main/phone-store.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scan): Magic art looks to printings`.

### Task 2: A Magic work folder for the corpus

**Files:**
- Create: `scripts/scan/mtg-corpus-work.ts` (built through `scripts/catalog/vite.config.ts`, run like `mtg-fingerprint-size.ts`)
- Modify: `scripts/catalog/vite.config.ts` (entry), corpus `README.md` (how `mtg-work/` is made)

**Interfaces:**
- Consumes: `buildFingerprints({ game: 'mtg', work, cachePath, budget, userAgent })`.
- Produces: `<out>/catalog.sqlite` (a Magic-only copy of the desktop catalog's rows for the chosen cards, same schema) and `<out>/fingerprints-mtg.bin`, the `mtg-work/` folder the gate reads.

Which cards (my call): every card (`card_id`, all printings, all languages) named by the truth file; every card with a printing in `FRA`, `TFRA`, `SPG`; and 2,000 other Magic cards picked with a fixed seed (`--seed 1`), so art faces realistic competition. Usage: `mtg-corpus-work.mjs <collection.db> <truth.json> <out dir> [--others 2000]`. Hash cache kept at `<out>/fingerprints-mtg.sqlite` (not committed) so a rerun fetches nothing new. Budget unlimited for this run; Scryfall pacing as the stage's.

- [ ] **Step 1: Build and run it** on a copy of `~/.config/duel-binder/collection.db` with out `/var/tmp/duel-binder-scan-corpus/mtg/mtg-work`. Expected: it logs card, look and record counts; `fingerprints-mtg.bin` under 1 MB; `catalog.sqlite` opens and has the 4,872 `FRA` printings.
- [ ] **Step 2: Commit** the script `chore(scan): build a Magic work folder for the photo corpus`. The corpus `mtg-work/` is committed in that repo with Task 7, after the owner's go.

### Task 3: The corpus run, report only

**Files:**
- Create: `tests/main/scan-mtg-real.test.ts` (modelled on `tests/main/scan-op-real.test.ts`: same env names with `MTG`, same per-photo path, `localScope("'mtg'")`, lookups incl. `printingsOfArt`)

**Scoring (spec, Step 5 and Finish):**
- Truth printing = the `card_printings` row with `language` and `set_code` from `sourceId` and `set_rarity` = `version`.
- **right:** recognized with that `set_code` and language, and the finish right *or* defaulted to non-foil on a truth foil (counted on its own line, `foil defaulted`).
- **wrong:** another set code, card or language, or a claimed finish that is wrong.
- **unsure** (with whether the truth printing is among the options), **none**.
- Report groups: all, `2015` frame, tokens (no floor; spec non-goal), plus `own look in top` and median / 90th-percentile ms per photo. Write per-photo rows (code reads, name reads, top art and its distance, own look's rank) to `SCAN_MTG_OUT`.
- No floor asserted yet (step 5). Assert only that it ran on every truth row not in the skip file.

- [ ] **Step 1: Write the test.** Until Task 5 lands, `resolveSignals` has no Magic branch, so this task's run only reports signals.
- [ ] **Step 2: Run** `SCAN_MTG_DIR=/var/tmp/duel-binder-scan-corpus/mtg SCAN_MTG_OUT=/var/tmp/mtg-baseline.json npx vitest run --maxWorkers=2 --silent=false tests/main/scan-mtg-real.test.ts`. Expected: 435 rows. Record in the ledger: own look in top-1 / top-5, the share of photos whose code bands read anything, and 20 example code reads (these feed Task 4's tests).
- [ ] **Step 3: Run** without `SCAN_MTG_DIR`. Expected: skipped, as the One Piece one is.
- [ ] **Step 4: Commit** `test(scan): Magic real-photo run (report only)`.

### Task 4: Reading the info line

**Files:**
- Modify: `src/shared/scan/magicCode.ts` (add `frameMagicCode`)
- Test: `tests/main/scan-magic-code.test.ts`

**Interfaces:**
- Produces: `frameMagicCode(codeTexts: string[]): MagicCodeRead[]`, candidates best first, where `interface MagicCodeRead { code: string /* "FRA 81", normalizeMagicCode's form */; language: Language | null; foil: boolean | null }`. The resolver keeps the first candidate `printingsByCode` knows.
- Accepts both layouts, across one or two lines of a band's text: `C 0081` / `FRA • EN` and `078/279 C` / `XLN • EN`. Rarity letters `C U R M S L T P`. The set code is 3–5 characters next to the dot or star; the number is the digits before or after the rarity letter.
- Confusions (start here, extend only from Task 3's reads): in the number `O o D → 0`, `I l | ! → 1`, `S → 5`, `B → 8`, `Z → 2`; in the set code a candidate with each digit-for-letter swap (`0↔O`, `1↔I`, `5↔S`, `8↔B`), since set codes mix both (`MH3`, `9ED`). Language tag map: `EN en, DE de, FR fr, IT it, ES es, PT pt, RU ru, JP ja, KR ko, CS zh-hans, CT zh-hant` (check JP/KR/CS/CT on one Scryfall image each and fix the map if they differ). `★` (or `*`) → `foil: true`, `•` (or `·`, `-`, `.`) → `false`, unread → `null`.

- [ ] **Step 1: Write the failing tests:**
  - `frameMagicCode(['C 0081\nFRA • EN'])[0]` → `{ code: 'FRA 81', language: 'en', foil: false }`
  - `frameMagicCode(['R 0107', 'FRA ★ EN'])[0]` → `{ code: 'FRA 107', language: 'en', foil: true }`
  - `frameMagicCode(['078/279 C\nXLN • EN'])[0].code` → `'XLN 78'`
  - `frameMagicCode(['C OO8I\nFRA • EN'])[0].code` → `'FRA 81'`
  - `frameMagicCode(['U 0012\nMH5 • EN']).map(r => r.code)` contains `'MHS 12'` after `'MH5 12'`
  - `frameMagicCode(['M 0291 FRA • JP'])[0].language` → `'ja'`
  - `frameMagicCode(['', 'Wizards of the Coast'])` → `[]`
  - plus five of Task 3's real reads with their truth, as `it.each`.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 tests/main/scan-magic-code.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS (and `normalizeMagicCode`'s tests unchanged).
- [ ] **Step 5: Commit** `feat(scan): read Magic's info line`.

### Task 5: `resolveMagic.ts`

**Files:**
- Create: `src/renderer/src/features/scan/resolveMagic.ts`
- Modify: `src/renderer/src/features/scan/resolve.ts:359-360` (`if (ctx.game === 'mtg') return resolveMagicSignals(raw, ctx)`, replacing the `mtg: scanner step` comment; `ResolveContext` gains `finishLock?: FinishLock` and `printingsOfArt` in `lookups`, optional so other games' callers don't change), `src/shared/scan/thresholds.ts` (`MTG_ART_MIN_MARGIN = 24`, `MTG_SAME_ART = 24` to start, One Piece's)
- Test: `tests/renderer/scan-resolve-magic.test.ts` (fakes as in `tests/renderer/scan-resolve-onepiece.test.ts`)

**Interfaces:**
- Consumes: `frameMagicCode` (Task 4), `lookups.printingsOfArt` (Task 1), `lookups.printingsByCode`, `lookups.matchName`.
- Produces: `resolveMagicSignals(raw: RawSignals, ctx: ResolveContext): Promise<ScanOutcome>`; `export type FinishLock = 'auto' | 'nonfoil' | 'foil'`; `finishTwin(p: ScanPrinting, all: ScanPrinting[]): ScanPrinting | null` (same `set_code` and language, the other finish; `rarity` with/without ` (Foil)`), used by Task 6's toggle. Drafts are `game: 'mtg'` with `options` = every printing of the look (all finishes) for the picker.

**Rules** (spec step 4, in this order):
1. `read` = the first `frameMagicCode` candidate whose `printingsByCode` is non-empty; its printings are `byRead`.
2. `artLook` = the closest art's look when within `ART_MAX_DISTANCE` (`ART_MAX_DISTANCE_IN_SET` with a picked set) and `MTG_ART_MIN_MARGIN` ahead of the closest match whose look leads to a *different card* (`cardId`); a reprint of the same card is not a rival. Its printings come from `printingsOfArt`.
3. Read and art agree (a `byRead` printing has the matched look) → recognized, that printing, `via: 'code'`.
4. Read one character off (number or set code, same length) a printing of `artLook` in the same set → misread; art stands. Read names another card than confident art → `unsure`.
5. Read only → recognized from `byRead`. Art only → among `artLook`'s printings: the read language (none here), else the picked set's, else `filterLanguage`, else `cardLanguage`, else English; then the picked set's printings; then, if a name read matches (`matchName`) one card, that card's. One set code left → recognized. Several set codes left → **unsure**, with those printings as the options (spec: "unsure, with the user picking the printing"; the overlay shows "not sure" and their price range, the existing rule).
6. Finish among the chosen set code + language: only one finish exists → that one; else `finishLock` `'foil'` → foil, otherwise non-foil. The info line's `★` is **not** used to claim foil in step 4 (spec non-goal; Task 3 records how often it read, for the later spike).
7. Nothing confident and top art beyond `ART_FAR_DISTANCE` → `{ kind: 'none', far: true }`, else `unsure`.

- [ ] **Step 1: Write the failing tests:**
  - `it('names the printing when the read and the art agree')`
  - `it('takes a read one digit off the art as the art')` (`FRA 108` read, art `FRA 107`)
  - `it('is unsure when the read names another card than confident art')`
  - `it('is unsure when the art is a reprint in two sets and nothing else tells them apart')` (Review Focus 3)
  - `it('takes the picked set among a reprint\'s sets')`
  - `it('does not count a reprint of the same card as a rival art')` (two looks of one card close together, no other card near → confident)
  - `it('defaults to non-foil when both finishes exist')`, `it('takes the only finish a printing has')`, `it('takes foil under the All foil lock')`, `it('ignores the lock for a single-finish printing')` (Review Focus 5)
  - `it('takes the info line language over the filter')`
  - `it('names a card back up from its back face')` (Review Focus 2, art id = back rep)
  - `it('leaves other games alone')`: `resolveSignals` with `game: 'op'` never calls `printingsOfArt`.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 tests/renderer/scan-resolve-magic.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it plus `tests/renderer/scan-resolve*.test.ts`. Expected: PASS.
- [ ] **Step 5: Tune on the corpus.** Run Task 3's command. Expected: 0 wrong. Then raise `MTG_ART_MIN_MARGIN`/`MTG_SAME_ART` only if a wrong appears, and lower them only while wrong stays 0. Record right / unsure / none, `foil defaulted`, and timings in the ledger. If the `2015` group is under the spec's 85% with 0 wrong, write down the top three causes from `SCAN_MTG_OUT` before going on; don't loosen.
- [ ] **Step 6: Commit** `feat(scan): name Magic cards from art, info line and name`.

### Task 6: Foil toggle and finish lock

**Files:**
- Modify: `src/renderer/src/features/scan/ScanHub.tsx` (hub settings gain `finishLock: FinishLock`, default `'auto'`, kept out of whatever the hub persists), `useHubScan.ts` (passes it into `ResolveContext`), `ScanRowItem.tsx` and the scan window's last row (`window/ScanWindowApp.tsx`), the phone's last-scan card and its settings sheet (next to the set picker; find them from `src/phone/PrintingSheet.tsx`'s callers), the overlay (`Foil` tag while the lock is `'foil'`)
- Test: `tests/renderer/scan-foil-toggle.test.tsx`

**Interfaces:**
- Consumes: `finishTwin`, `FinishLock` (Task 5); the existing "pick a printing" path the rows use (`PrintingPicker`, the phone's tap-last-scan sheet), so the toggle is a printing switch and moves the collection entry and price as picking does.

Copy (my call): the toggle reads **Foil** (off/on); the lock is a three-way control **Auto · Non-foil · Foil** labelled **Finish**. Only shown for Magic, and the toggle only on a row whose printing has a finish twin.

- [ ] **Step 1: Write the failing tests:** `it('switches a Magic row to its foil printing and back')` (row's `printingId` and price change); `it('hides the toggle when the printing has one finish')`; `it('hides finish controls for other games')`; `it('starts every session at Auto')`.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 tests/renderer/scan-foil-toggle.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same plus `tests/renderer/phone-scanner.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scan): Magic foil toggle and session finish lock`.

### Task 7: Turn it on for testers, and hand off

**Files:**
- Modify: `src/shared/games/magic.ts:71` (`scan: true`), `src/renderer/src/features/scan/codeMode.ts:18` (`'mtg'` in `CODE_MODE_GAMES`) and `:233` (`if (game === 'mtg') return frameMagicCode([text])[0]?.code ?? null`, or the shape that function returns), the spec's step 4 section (an "As built" paragraph with the corpus numbers)
- Test: `tests/renderer/scan-code-mode.test.ts` (a Magic aim-box read), existing game-feature tests

- [ ] **Step 1: Write the failing test** `it('reads a Magic code in code mode')` → `'FRA 81'` from `'C 0081 FRA • EN'`.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 tests/renderer/scan-code-mode.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, then run the same. Expected: PASS.
- [ ] **Step 4: Full check.** `npx vitest run --maxWorkers=2`, `npm run typecheck:web`, `npm run typecheck:phone`, then the One Piece and Pokémon corpus runs. Expected: all green, their numbers unchanged.
- [ ] **Step 5: Commit** `feat(magic): scanning on for testers`, then ask the owner before pushing the branch, opening the PR (with the corpus numbers and timings) and pushing `mtg/mtg-work/` to the corpus repo.

Step 5 of the spec (CI gate with floors, fixture gate on upload, swap the slim fingerprints for the nightly file) follows in its own plan once this has run on the owner's machine.
