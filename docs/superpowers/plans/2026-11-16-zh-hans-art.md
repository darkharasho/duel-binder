# Simplified Chinese card and pack art: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** zh-hans cards and sets show real Chinese art (PokiPair cards, official pokemon.cn packs),
copied once into R2 as hand art.

**Architecture:** A catalog-job step copies images into R2 through a new admin route and records
what it copied in `catalog-work/pokipair.json`. The Pokémon stage turns that record into
`HAND_ART_PREFIX` image URLs. Pack art goes through the weekly set-art refresh with a new `hp-`
key. Scanning stays as it is today: zh-hans stays out of the fingerprints, and twin links stay
for scanning.

**Tech Stack:** TypeScript, vitest (`--maxWorkers=2`), better-sqlite3, Cloudflare Worker portal, pngjs and jpeg-js.

**Spec:** `docs/superpowers/specs/2026-11-16-zh-hans-art-design.md`

## Global Constraints

- Requests to PokiPair and pokemon.cn: one at a time, at least 1 s apart, User-Agent
  `DuelBinder/catalog (https://github.com/darkharasho/duel-binder)`. Stop the run on a 429 or
  403.
- Nightly budget: 1,500 card images.
- A card gets art only when its set, number and name agree (numbered pages), or by position when
  the page's image count equals the set's card count exactly (Gem Packs).
- Hand-art ids match `^[a-z0-9-]+$` (the source id in lowercase, `/` to `-`).
- R2 keys: `hand/<id>/high.jpg` and `hand/<id>/low.jpg`, JPEG only.
- Scanning is unchanged: `zh-hans` is added to `UNSCANNED_SOURCES`.

## Review Focus

1. A PokiPair page whose numbering differs from ours (letters, `SV-P`-style codes): it must match
   nothing, never the wrong card.
2. A zh-hans card that gains hand art must still be found by the scanner through its English twin.
3. A run that hits a 429 must stop and leave the record consistent, so the next run resumes.
4. Older clients: art they can't use must not break their display (hand URLs already exist for
   en/me06).
5. A pokemon.cn product name that fits two sets must give no pack.

---

### Task 1: Portal hand-art upload and hand pack keys

**Files:**
- Create `workers/portal/src/handArt.ts`.
- Modify `workers/portal/src/app.ts` (route wiring, next to `opArtRoute`) and
  `workers/portal/src/images.ts` (set key `hp-`).
- Test `tests/portal/hand-art.test.ts`.

- [ ] Tests:
  - A PUT of a JPEG to `/api/admin/hand-art/zh-hans-cbb7c-0101/high` with the admin token gives
    200 and stores it at `hand/zh-hans-cbb7c-0101/high.jpg`.
  - It answers 401 without the token, 400 for a bad id (`ZH`, `a/b`, `..`), 415 for a PNG or a
    wrong content-type, and 413 over 4 MiB for `high` or over `MAX_THUMB_BYTES` for `low`.
  - `GET /img/set/hp-<key>` serves `hand/<path>` when the `pokemon_set_art` row's `image_url`
    starts with `HAND_ART_PREFIX`, and 404s an `hp-` key whose row URL is not a hand URL.
- [ ] Implement `handArtRoute(req, bucket, adminToken)` following `opArtRoute`. Add `hp-` to the
  prefix checks in `findPokemonSetArtUrl` and resolve it with `handArt()`.
- [ ] Run `npx vitest run --maxWorkers=2 tests/portal`. Expected: all pass.
- [ ] Commit.

### Task 2: PokiPair page parsing and matching (pure)

**Files:**
- Create `scripts/catalog/pokemon/pokipair.ts` and the fixtures in
  `tests/fixtures/pokipair/{hub,csv8,gem7}.html`, cut down to a few cards.
- Test `tests/main/pokipair.test.ts`.

**Interfaces (produces):**
- `parseHub(html): string[]` gives set page URLs.
- `parseSetPage(html): { title: string; cards: PpCard[] }`, where
  `PpCard = { number: string | null; variant: string; url: string; name: string | null }`.
- `setIdOf(slug: string, title: string, known: ReadonlySet<string>): string | null`.
- `matchCards(setId, page: PpCard[], cards: ZhCatalogCard[]): Map<string /*sourceId*/, string /*url*/>`,
  where `ZhCatalogCard = { sourceId: string; number: string; name: string }`.
- `handId(sourceId): string`, so `zh-hans/CBB7C-0101` gives `zh-hans-cbb7c-0101`.

- [ ] Tests:
  - The CSV8 fixture parses `006/207 · Illumise` as number `006`, variant `normal`, a full URL
    and name `Illumise`.
  - Gem7 parses with `number: null`.
  - `setIdOf` maps:
    - `bright-fantasy-csv8-card-list` to `CSV8C`;
    - `nine-colors-gathering-set-list-cs4a` to `CS4aC`;
    - `gem-pack-vol-7-card-list` to `CBB7C`;
    - `gem-pack-volume-one-card-list` to `CBB1C`;
    - an unknown slug to null.
  - `matchCards`:
    - takes `normal` over `pokeball-reverse` for one number;
    - skips a card whose name disagrees;
    - matches Gem Packs by position when counts are equal, and returns an empty map when they
      differ;
    - ignores `masterball-reverse` and `pokeball-reverse`.
- [ ] Implement. The name rule is `sameCardName` from `match.ts`. Number compare: strip `/…`,
  then leading zeros, on both sides.
- [ ] Run the tests. Commit.

### Task 3: The mirror run

**Files:**
- Create `scripts/catalog/pokemon/pokipairMirror.ts` and `scripts/catalog/zhArt.mts` (CLI).
- Modify `package.json` (`catalog:zh-art`).
- Test `tests/main/pokipair-mirror.test.ts`.

**Interfaces:**
- `mirrorZhArt({ work, record, fetch, portal?, budget, sleep, log }): Promise<{ uploaded, failed, stopped }>`.
- `record` is the JSON at `catalog-work/pokipair.json`:
  `{ done: Record<sourceId, url>, pages: Record<setId, string /*page url*/> }`.

- [ ] Tests, with a fake fetch serving the fixtures and fake PNGs, and a fake portal:
  - Uploads `high` and `low` for each matched card.
  - Records it in `done`, and skips it next run.
  - Stops at the budget.
  - Stops on a 429 with what was done so far recorded.
  - A dry run (no portal) uploads nothing and records nothing.
  - Waits between every request (`sleep` called).
- [ ] Implement:
  - Read the zh-hans cards from work.sqlite: `pokemon_cards` joined with `cards`, giving the
    source id, its number part and the English name.
  - Image to JPEG: decode the PNG with `decodeImage`, fill the corners as `onepiece/art.ts`
    `smallCopy` does, then `high` = `jpeg-js` at quality 85 and `low` = `smallJpeg`.
  - Upload with `withRetry`, as `uploadArt` does.
- [ ] Run the tests. Commit.

### Task 4: Catalog uses the record; scanning unchanged

**Files:**
- Modify:
  - `scripts/catalog/pokemon/art.ts` (`handArtUrl(sourceId, mirrored?)`)
  - `scripts/catalog/pokemon/write.ts` (pass the record; keep `art_twin_id` for zh-hans hand art)
  - `scripts/catalog/pokemon/index.ts` (read `catalog-work/pokipair.json`)
  - `src/main/repo/scan.ts` (drop `z.image_url IS NULL` in `chineseOfArt`)
  - `scripts/catalog/fingerprints.ts` (`UNSCANNED_SOURCES` + `zh-hans`)
- Test: the existing write and scan tests, plus new cases.

- [ ] Tests:
  - A zh-hans card in the record gets `image_url = HAND_ART_PREFIX + handId`.
  - Its `art_twin_id` is kept.
  - `chineseOfArt` still returns it.
  - `borrowedArt` no longer lists it, because its own art wins.
  - zh-hans images get no fingerprints.
- [ ] Implement. Run `tests/main`, `tests/renderer/scan*`. Commit.

### Task 5: Official pack art

**Files:**
- Modify `scripts/catalog/pokemon/setArt.ts` (a zh-hans pass).
- Create `scripts/catalog/pokemon/zhPacks.ts` (parse and match).
- Test `tests/main/zh-packs.test.ts`.

- [ ] Tests:
  - The product list fixture parses name and image (the `auth_key` URL is kept for download only).
  - A product matches a set by its Chinese set name with "补充包 / 强化包" and similar stripped.
  - Two candidate sets give no match.
  - A matched pack becomes a `zh-hans` `pack` row with `image_url = HAND_ART_PREFIX + 'zh-hans-pack-<set lower>'` and key `hp-<sha>`.
- [ ] Implement. Set names come from the zsjy947 `sets_index.json`, read for its Chinese
  name field. Download, downscale to at most 600 px wide, and upload through the Task 1 route
  as `high`. Fall back to PokiPair's thumbnail for sets with no product.
- [ ] Run the tests. Commit.

### Task 6: Workflow, credit, first run

- [ ] In `catalog.yml`:
  - restore and save `catalog-work/pokipair.json` (cache key `pokipair-v1-${{ github.run_id }}`
    with restore-keys);
  - add a step "Chinese art (PokiPair)" before "Refresh Pokémon", running
    `npm run catalog:zh-art`, with `continue-on-error: true` and `timeout-minutes: 60`.
- [ ] Add the About credit line.
- [ ] Locally:
  - dry run on CSV8C and CBB7C;
  - then a real run with the admin token on CBB7C only, and check
    `/img/hand/zh-hans-cbb7c-0101/low.jpg` by eye.
- [ ] Run the full verification: `npm run typecheck:node`, `:web` and `:phone`, then
  `npx vitest run --maxWorkers=2`.
- [ ] Open the PR. Once merged, deploy the Worker and dispatch the catalog.
