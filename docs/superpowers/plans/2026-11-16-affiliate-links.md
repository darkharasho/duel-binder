# Affiliate Buy Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Buy on TCGplayer" and "Buy on eBay" affiliate links on the card panel and Wishlist rows (desktop, web, phone).

**Architecture:** Pure link builders + affiliate ids in `src/shared/affiliate.ts`. The printing's TCGplayer product id is carried on `Printing` from the existing `card_printings.tcg_product_id` column (shared repo code, so desktop and the portal's web/phone reads both get it). One `BuyLinks` React component renders plain `<a target="_blank">` links (Electron's window-open handler already sends https to the browser; web/phone open normally) and counts clicks as anonymous usage events.

**Tech Stack:** TypeScript, React, better-sqlite3 / DO SQLite via shared repo, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-16-affiliate-links-design.md`

## Global Constraints

- Affiliate ids live in code constants; a blank id hides that store's link entirely.
- Disclosure copy, verbatim: `Affiliate links: we may earn a commission.`
- No Cardmarket, no regional stores.
- Links open outside the app; nothing is sold or traded in-app.
- Usage events are anonymous counts only (no card, user or URL sent).
- Release order: deploy the portal (new usage events) **before** tagging a client release; an older portal refuses the whole usage report on an unknown event.
- vitest with `--maxWorkers=2`.

## Review Focus

- Card name with `&`, `"`, `/` or non-Latin script (Japanese/Chinese names): URLs must be fully encoded, never broken. → Task 1 test.
- Printing with no set code (some Pokémon promos, contributed rows): eBay query is just the name (+ language word), no stray spaces/"undefined". → Task 1 test.
- Non-English Yu-Gi-Oh! printing without a product id: no TCGplayer link (TCGplayer doesn't sell OCG), eBay link only. → Task 1 test.
- Both ids blank (today, before approval): `BuyLinks` renders nothing at all, including no disclosure line. → Task 3 test.
- Card panel before a printing is selected / still loading: no links, no crash. → Task 3 test.

---

### Task 1: Link builders

**Files:**
- Create: `src/shared/affiliate.ts`
- Test: `tests/shared/affiliate.test.ts`

**Interfaces:**
- Produces:
  - `export const AFFILIATE: { ebayCampaignId: string; tcgplayerImpactBase: string }` (both `''` for now)
  - `export interface BuyTarget { game: GameId; name: string; setCode: string; setRarity: string; language: Language; tcgProductId?: number | null }`
  - `export function tcgplayerUrl(t: BuyTarget, ids?: typeof AFFILIATE): string | null`
  - `export function ebayUrl(t: BuyTarget, ids?: typeof AFFILIATE): string | null`
  - `export function buyLinks(t: BuyTarget, ids?: typeof AFFILIATE): { store: 'tcgplayer' | 'ebay'; label: string; url: string }[]` (TCGplayer first; labels `Buy on TCGplayer`, `Buy on eBay`)

Rules (exact):
- TCGplayer target URL: product id → `https://www.tcgplayer.com/product/<id>`; else if `language === 'en'` → `https://www.tcgplayer.com/search/<line>/product?q=<encoded "name setCode">` with `<line>` = `yugioh` | `pokemon` | `magic` | `one-piece-card-game`; else `null`. Wrapped as `` `${tcgplayerImpactBase}?u=${encodeURIComponent(target)}` ``; `null` when `tcgplayerImpactBase` is `''`. (If the owner's Impact link turns out to be a different shape, only this wrapping line changes.)
- eBay query: `name`, `setCode`, untoned `setRarity` (strip a trailing `(…, Color|Monochrome)` like the worker's `untoned`), plus the language word for non-`en` (copy `EBAY_WORDS` values from `workers/ebay-prices/src/price.js`), joined by single spaces with empties dropped. URL: `https://www.ebay.com/sch/i.html?_nkw=<encoded query>&mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=<campaignId>&toolid=10001&mkevt=1`. `null` when `ebayCampaignId` is `''`.

- [ ] **Step 1: Write the failing tests** (pass explicit ids `{ ebayCampaignId: '5338000000', tcgplayerImpactBase: 'https://tcgplayer.pxf.io/c/1/2/3' }`)
  - `exact product link when the printing has a TCGplayer id` → `tcgplayerUrl({game:'pkm', name:'Pikachu', setCode:'SV1-025', setRarity:'Common', language:'en', tcgProductId: 12345}, ids)` equals `'https://tcgplayer.pxf.io/c/1/2/3?u=' + encodeURIComponent('https://www.tcgplayer.com/product/12345')`.
  - `English printing without id searches TCGplayer by name and set code` → ygo `Dark Magician` / `LOB-005` decodes to `https://www.tcgplayer.com/search/yugioh/product?q=Dark%20Magician%20LOB-005`.
  - `non-English printing without id has no TCGplayer link` → ygo `ja` → `null`; but pkm `ja` with `tcgProductId: 9` → non-null.
  - `eBay query carries code, untoned rarity and the language word` → ygo ko `"Ultra Rare (Manga-Style, Color)"` `RV01-KR005` name `Blue-Eyes` → decoded `_nkw` is `Blue-Eyes RV01-KR005 Ultra Rare Korean`, and URL contains `campid=5338000000`.
  - `eBay query with no set code is just the name` → `_nkw` decodes to `Pikachu` (no double spaces, no `undefined`).
  - `names with & " / and CJK survive the round trip` → `new URL(url).searchParams.get('_nkw')` starts with the exact name `Dragon & "Fire"/炎`.
  - `blank ids give no links` → `buyLinks(target, { ebayCampaignId: '', tcgplayerImpactBase: '' })` equals `[]`.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/shared/affiliate.test.ts --maxWorkers=2` → module not found.
- [ ] **Step 3: Implement `src/shared/affiliate.ts`** per the rules above.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(affiliate): TCGplayer and eBay buy-link builders`

### Task 2: Carry the TCGplayer product id on printings

**Files:**
- Modify: `src/shared/types.ts:69-86` (`Printing`)
- Modify: `src/main/repo/cards.ts:161-179` (`PrintingDbRow`), `:220-235` (`rowToPrinting`), `:483-486` (`getCardDetail` select)
- Modify: `src/main/repo/collection.ts:56-63` (`cardPriceColumns` — feeds collection and wishlist rows)
- Test: `tests/main/cards.test.ts`, `tests/main/wishlist.test.ts`

**Interfaces:**
- Produces: `Printing.tcgProductId?: number` (present only when the column is selected and non-null); `PrintingDbRow.tcg_product_id?: number | null`.

- [ ] **Step 1: Write failing tests**
  - cards.test.ts `card details give each printing its TCGplayer product id` — insert a printing with `tcg_product_id = 777` and one with NULL; `getCardDetail(...).printings` → first has `tcgProductId: 777`, second has no `tcgProductId` key.
  - wishlist.test.ts `wishlist rows carry the TCGplayer product id` — wish a printing with `tcg_product_id = 777`; `listWishlist(db)[0].printing.tcgProductId === 777`.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/main/cards.test.ts tests/main/wishlist.test.ts --maxWorkers=2`.
- [ ] **Step 3: Implement** — add the optional field; `rowToPrinting` spreads `...(row.tcg_product_id != null ? { tcgProductId: row.tcg_product_id } : {})`; add `p.tcg_product_id` to the `getCardDetail` printing select and to `cardPriceColumns` (next to `p.market_price`).
- [ ] **Step 4: Run, expect PASS**; then `npx vitest run tests/main tests/portal --maxWorkers=2` (portal RPC reuses this repo code against DO SQLite, whose `card_printings` already has the column — see `workers/portal/src/migrate.ts`).
- [ ] **Step 5: Commit** — `feat(affiliate): printings carry their TCGplayer product id`

### Task 3: BuyLinks on the card panel and Wishlist, with click counts

**Files:**
- Create: `src/renderer/src/components/BuyLinks.tsx`
- Modify: `src/shared/usage.ts:9-25` (add `'buy:tcgplayer'`, `'buy:ebay'` to `USAGE_EVENTS`)
- Modify: `src/renderer/src/features/card/CardPanel.tsx:~275` (below `<PanelPrice …/>`), `src/renderer/src/features/wishlist/WishlistRows.tsx` (each row, under the price)
- Test: `tests/renderer/buy-links.test.tsx`; one case each in `tests/renderer/card-panel.test.tsx` and `tests/renderer/wishlist.test.tsx`; `tests/portal` usage test if one asserts the event list

**Interfaces:**
- Consumes: `buyLinks`, `BuyTarget`, `AFFILIATE` (Task 1); `Printing.tcgProductId` (Task 2); `track` from `@/lib/usage`; `gameOfId` from `@shared/games/ids`.
- Produces: `export function BuyLinks({ card: { id: number; name: string }, printing: Printing | null | undefined, ids?: typeof AFFILIATE, compact?: boolean }): React.JSX.Element | null`

Behaviour: builds the `BuyTarget` from `gameOfId(card.id)`, card name and printing; renders nothing when `printing` is missing or `buyLinks` is empty. Otherwise a row of small outline links (`target="_blank" rel="noreferrer sponsored"`), each `onClick` → `track('buy:tcgplayer' | 'buy:ebay')`, then the disclosure line `Affiliate links: we may earn a commission.` in `text-xs text-muted-foreground`. `compact` (Wishlist) shows the short labels `TCGplayer` / `eBay` and puts the disclosure in the link `title` instead of a line; the Wishlist page shows the disclosure line once under its header.

- [ ] **Step 1: Write failing tests** (`buy-links.test.tsx`, ids passed explicitly)
  - `renders both links with the affiliate urls` — hrefs equal `buyLinks(...)` urls; both `target="_blank"`; disclosure text present.
  - `renders nothing when both ids are blank` — `container` is empty, disclosure text absent.
  - `renders nothing without a printing` — `printing={undefined}` → empty.
  - `counts a click per store` — mock `@/lib/usage`; clicking `Buy on eBay` calls `track('buy:ebay')`.
  - card-panel.test: `shows buy links for the selected printing` (mock `@shared/affiliate`'s `AFFILIATE` with non-blank ids) → a link whose href contains the selected printing's set code.
  - wishlist.test: `each wishlist row links to eBay` → row contains a link named `eBay`.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/renderer/buy-links.test.tsx tests/renderer/card-panel.test.tsx tests/renderer/wishlist.test.tsx --maxWorkers=2`.
- [ ] **Step 3: Implement** `BuyLinks`, the two usage events, and the two placements (CardPanel passes `shown`; WishlistRows passes `item.printing`).
- [ ] **Step 4: Run, expect PASS**; then `npx vitest run tests/renderer tests/shared --maxWorkers=2`, `npm run typecheck:web`, `npm run typecheck:phone`, and the node typecheck (see local-typecheck note: `npm run typecheck` stops at resvg).
- [ ] **Step 5: Commit** — `feat(affiliate): buy links on the card panel and Wishlist`

### Task 4: Disclosure on the site's terms

**Files:**
- Modify: `workers/portal/src/site/terms.ts` (new section "Affiliate links")
- Modify: `workers/portal/src/site/privacy.ts` (one sentence in the usage-counts section)

Copy (terms section body): `Some links to TCGplayer and eBay are affiliate links. If you buy something after following one, we may earn a commission, at no extra cost to you. Duel Binder doesn't sell cards or see what you buy.` Privacy sentence: `The app counts how often its buy links are opened, with no account, card or device attached.`

- [ ] **Step 1:** Add both; run `cd workers/portal && npx vitest run --maxWorkers=2` (no regressions) and `npx tsc --noEmit -p .`.
- [ ] **Step 2: Commit** — `docs(site): affiliate links in terms and privacy`

### Release (owner-gated, after review)

1. PR → merge to main.
2. Deploy portal from a fresh worktree (`npm ci` at root and `workers/portal`, then `npm run deploy`) — new usage events must be live first.
3. Tag the client release. Links stay hidden until ids are filled into `AFFILIATE` in a follow-up commit + release.
