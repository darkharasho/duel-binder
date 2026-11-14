# Art Wash Theme (stages 1–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blurred-art background with a colour wash built from one random card on each page,
and restyle the app in dark with Bricolage Grotesque and Geist Mono type, with no boxes around page content.

**Architecture:**
- A pure colour engine in `src/renderer/src/lib/wash/` turns pixels into fitted colour pools and a CSS
  background.
- A small browser layer samples card art through a 32×32 canvas and caches the result.
- Pages hand `useArtWash` a list of candidate cards. The hook picks one at random per visit, and
  `ArtWash` cross-fades two background layers.
- Stage 2 then retokens `index.css`, restyles the shared `components/ui` files, and restyles the sidebar,
  page headers and tiles.

**Tech Stack:** React 19 + TS, Tailwind v4 tokens in `src/renderer/src/index.css`, Vitest + Testing
Library (jsdom), Electron custom protocol `ygo-img://`, Fontsource.

**Spec:** `docs/superpowers/specs/2026-11-13-art-wash-theme-design.md`. Reference mockup and engine:
main checkout `.superpowers/mockups/e-wash-collection.html` and `wash.js` (git-ignored, read-only).

## Global Constraints

- Every pool, and the base, gives ≥ 4.5:1 WCAG contrast with the theme ink: white `#ffffff` for dark, `#16121c` for light.
- Families are 1–5:
  - 20° hue bins, chroma-weighted, skipping pixels with C < 0.035 or L < 0.12.
  - A family is kept if it has ≥ 15% of the top bin's weight.
  - Bins less than 3 apart (< 60° bin distance, matching `wash.js`) are folded together.
- Grey art means mean chroma < 0.045. Grey Yu-Gi-Oh! art leads with `FRAME[frameType]`. The art's top
  family is kept at weight 0.55 if it is more than 50° away.
- Single-family art gets a second pool, with the same rule as `wash.js`.
- Text sitting on the wash is ink only and fully opaque. Coloured text appears only inside solid surfaces:
  pills, popovers, dialogs and menus.
- The random pick happens once per page visit, from the first 24 candidate cards. It skips grey art if any
  colourful card exists. Hover never changes the wash.
- `prefers-reduced-motion`: no cross-fade.
- Fonts are bundled through Fontsource, never fetched at runtime:
  - `@fontsource-variable/bricolage-grotesque` 5.3.x;
  - `@fontsource/geist-mono` 5.3.x, weights 400 and 500.
- Dark only in this plan. The phone gets the wash and the fonts, with no layout rework.
- Scan pages get no wash.
- Run vitest with `--maxWorkers=2` (`npm test` already does). Before pushing, run `npm run typecheck:web` and
  `npm run typecheck:phone` separately.
- Nothing merges until Task 12 (the end of stage 2) is approved by the owner.

## Review Focus

1. **Art that can't be read**, because it isn't downloaded yet, is offline, or would taint the canvas (phone
   WebView reading portal `/img/` cross-origin). The page shows the quiet game default and nothing throws
   or logs an error. Test in Task 2.
2. **A page whose list arrives late** (loading, then cards). It picks once the cards arrive. Infinite-scroll
   appends, filter changes and re-renders do not re-pick. Test in Task 3.
3. **Quick page switching.** A slow sample for page A that lands after page B is shown must not paint.
   Test in Task 3.
4. **A corrupt or full localStorage cache** (bad JSON, `setItem` throws). The sample is recomputed and the
   page still washes. Test in Task 2.
5. **A page whose cards are all grey, or a grey non-Yu-Gi-Oh! card.** It still gets a wash: the frame
   colour for Yu-Gi-Oh!, and the game's glow colour for the others. Test in Task 1 (frame) and Task 2 (game
   fallback).

---

## Stage 1 — wash engine

### Task 1: Pure colour engine

**Files:**
- Create: `src/renderer/src/lib/wash/color.ts`, `src/renderer/src/lib/wash/families.ts`, `src/renderer/src/lib/wash/fit.ts`, `src/renderer/src/lib/wash/field.ts`
- Test: `tests/renderer/wash-engine.test.ts`

**Interfaces:**
- Produces:
  - `type RGB = [number, number, number]`
  - `type Lab = [number, number, number]`
  - `color.ts`:
    - `toOklab(rgb: RGB): Lab`
    - `fromOklab(lab: Lab): RGB`
    - `lch(lab: Lab): [L: number, C: number, H: number]`
    - `unlch(l: [number, number, number]): Lab`
    - `contrast(a: RGB, b: RGB): number`
    - `css(rgb: RGB, alpha?: number): string`
    - `INK: Record<'dark' | 'light', RGB>`
  - `families.ts`:
    - `interface Families { fams: { lab: Lab; share: number }[]; dark: Lab; vivid: number; greyArt: boolean }`
    - `familiesFromPixels(px: RGB[], frameType?: string): Families`
    - `FRAME: Record<string, [hue: number, chroma: number]>`
    - `GREY = 0.045`
  - `fit.ts`:
    - `type WashTheme = 'dark' | 'light'`
    - `interface Fitted { pools: { rgb: RGB; share: number }[]; base: RGB; worst: number }`
    - `fit(f: Families, theme: WashTheme): Fitted`
  - `field.ts`:
    - `field(f: Fitted, opts?: { seed?: number; withBase?: boolean }): string` returns the CSS
      `background` value.
    - `GRAIN: string`

- [ ] **Step 1: Write the failing tests** (pixels built as arrays, not images)

```ts
const fill = (rgb: RGB, n = 1024): RGB[] => Array.from({ length: n }, () => rgb)
const mix = (...parts: [RGB, number][]): RGB[] => parts.flatMap(([c, n]) => fill(c, n))

it('finds one family per distinct hue, up to five', () => {
  const five = mix([[220,40,40],200],[[40,90,220],200],[[40,180,70],200],[[230,200,40],200],[[160,60,200],200],[[60,200,200],24])
  expect(familiesFromPixels(five).fams).toHaveLength(5)
  expect(familiesFromPixels(mix([[220,40,40],600],[[40,90,220],424])).fams).toHaveLength(2)
})
it('gives single-colour art a second pool', () => {
  expect(familiesFromPixels(fill([200,40,40])).fams).toHaveLength(2)
})
it('drops families under 15% of the top one', () => {
  expect(familiesFromPixels(mix([[220,40,40],950],[[40,90,220],74])).fams.length).toBe(2) // red + its second pool only
})
it('leads grey Yu-Gi-Oh! art with its frame colour', () => {
  const f = familiesFromPixels(fill([90,90,95]), 'effect')
  expect(f.greyArt).toBe(true)
  expect(Math.abs(lch(f.fams[0].lab)[2] - FRAME.effect[0])).toBeLessThan(2)
})
it('does not use a frame for grey art with an unknown frame', () => {
  expect(familiesFromPixels(fill([90,90,95]), 'pokemon').greyArt).toBe(false)
})
it.each(['dark','light'] as const)('fits every pool and the base to 4.5:1 in %s', (t) => {
  for (const px of [fill([250,240,120]), fill([20,20,30]), mix([[255,255,255],500],[[0,200,255],524])]) {
    expect(fit(familiesFromPixels(px), t).worst).toBeGreaterThanOrEqual(4.5)
  }
})
it('shares sum to 1', () => {
  const f = familiesFromPixels(mix([[220,40,40],600],[[40,90,220],424]))
  expect(f.fams.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1)
})
it('places pools the same way for the same seed, differently for another', () => {
  const fitted = fit(familiesFromPixels(mix([[220,40,40],600],[[40,90,220],424])), 'dark')
  expect(field(fitted, { seed: 7 })).toBe(field(fitted, { seed: 7 }))
  expect(field(fitted, { seed: 7 })).not.toBe(field(fitted, { seed: 8 }))
  expect(field(fitted, { withBase: false })).not.toContain(css(fitted.base))
})
```

- [ ] **Step 2: Run the tests and check they fail.**
  Run `npx vitest run tests/renderer/wash-engine.test.ts --maxWorkers=2`. Expected: FAIL, because the
  modules don't exist.
- [ ] **Step 3: Port `wash.js` into the four files** with the interfaces above.
  - The maths, `THEMES`, `SPOTS`, `jitter` and `GRAIN` are copied as they are.
  - Changes from `wash.js`:
    - `familiesFromPixels` takes pixels instead of loading an image.
    - It returns no `raw`.
    - `greyArt` is a boolean.
- [ ] **Step 4: Run the tests and check they pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(wash): colour engine for the art wash`.

### Task 2: Sampling card art, and the cache

**Files:**
- Create: `src/renderer/src/lib/wash/sample.ts`
- Modify: `src/main/images/protocol.ts`, adding `Access-Control-Allow-Origin: *` to every 200 response
  so the canvas isn't tainted.
- Test: `tests/renderer/wash-sample.test.ts`, `tests/main/image-protocol-cors.test.ts` (or extend the
  existing protocol test if there is one)

**Interfaces:**
- Consumes: `familiesFromPixels`, `Families`, `FRAME` (Task 1); `cardImageSrc` (`lib/images`).
- Produces:
  - `interface WashCard { imageId: number; frameType?: string }`
  - `ART_BOX: Record<GameId, { x: number; y: number; w: number; h: number }>`: fractions of the small
    image. `ygo` is `{0,0,1,1}`, because it samples `cropped`. For `pkm`, `op` and `mtg`, start at
    `{x:.08,y:.1,w:.84,h:.45}` and tune them against real cards.
  - `readPixels(src: string, box: ArtBox): Promise<RGB[] | null>`: an `Image` with
    `crossOrigin='anonymous'`, drawn into a 32×32 canvas. It returns null on a load error, a decode
    error or a tainted canvas (`getImageData` throws).
  - `sampleCard(card: WashCard, game: GameId): Promise<Families | null>`:
    - Yu-Gi-Oh! uses `cardImageSrc('cropped', id)`; the other games use `'small'`.
    - It caches in a memory `Map`, and in localStorage under key `wash:v1:<game>:<imageId>`.
    - The cache holds at most 600 keys, tracked in an LRU list under `wash:v1:index`. All storage
      errors are swallowed.
  - `gameFallback(game: GameId): Families`: the families made from the game's glow colours. These are
    the first two rgb values of today's `GLOW` in `ArtWash.tsx`, with shares 0.65 and 0.35.

- [ ] **Step 1: Write the failing tests.**
  - Mock `readPixels` through `vi.spyOn` on the module export, or inject it. A second
    `sampleCard({imageId:5}, 'ygo')` returns the cached value without reading again.
  - With memory cleared, it is read back from localStorage (`readPixels` is not called).
  - A localStorage entry `'not json'` is ignored and recomputed.
  - When `localStorage.setItem` throws, it still resolves to `Families`.
  - When `readPixels` resolves null, the result is null.
  - The 601st key evicts the oldest.
  - `gameFallback('pkm').fams` has length 2, and `fit(gameFallback(g),'dark').worst >= 4.5` for every game.
  - Main test: the protocol response for an existing file has the header `access-control-allow-origin: *`.
- [ ] **Step 2: Run the tests and check they fail.** Run
  `npx vitest run tests/renderer/wash-sample.test.ts tests/main/image-protocol-cors.test.ts --maxWorkers=2`.
  Expected: FAIL.
- [ ] **Step 3: Implement `sample.ts`, and add the header in `protocol.ts`.**
- [ ] **Step 4: Run the tests and check they pass.** Expected: PASS.
- [ ] **Step 5: Check by hand that the canvas isn't tainted.**
  - Run `npm run dev`. In DevTools, run `(await import('/src/lib/wash/sample.ts')).readPixels('ygo-img://cropped/46986414', {x:0,y:0,w:1,h:1})`.
    It should return 1024 pixels, not null.
  - On the web build, check that a portal `/img/` read works too. If it returns null, add
    `Access-Control-Allow-Origin: *` to the portal `/img/` responses in `workers/portal/src/images.ts`,
    in this same task. That needs a Worker deploy before release, so note it in the PR.
- [ ] **Step 6: Commit**: `feat(wash): sample card art through a cached 32×32 canvas`.

### Task 3: Random pick hook

**Files:**
- Modify: `src/renderer/src/components/artWashContext.ts`
- Test: `tests/renderer/wash-pick.test.tsx`

**Interfaces:**
- Consumes: `WashCard`, `sampleCard`, `gameFallback` (Task 2); `Families` (Task 1).
- Produces:
  - `interface WashState { families: Families; seed: number; strength: number }`
  - `ArtWashContext = createContext<((w: WashState | null) => void) | null>(null)`
  - `useArtWash(cards: WashCard[] | null | undefined, opts?: { strength?: number }): void`. Its
    behaviour:
    - `undefined` leaves the wash to a child view, as today.
    - `null` or `[]` while loading keeps whatever is showing.
    - On the first non-empty list for this mount, it shuffles the first 24 cards with `Math.random`. It
      walks the shuffled list, calling `sampleCard`, until one is not `greyArt`. If all are grey, it uses
      the first one that sampled. If none sampled, it uses `gameFallback`.
    - `seed` is the picked card's `imageId`. `strength` defaults to 1.
    - The pick is held in a ref and is not redone on later list changes. Unmount clears it, so the next
      visit picks again.
    - A result that resolves after unmount is dropped.
  - `pickOrder<T>(xs: T[], rand: () => number, limit = 24): T[]`: a pure Fisher–Yates shuffle of
    `xs.slice(0, limit)`, exported for tests.
  - Remove `cardArtUrl`, `coverArtUrl` and `setArtUrl` once Task 5 no longer uses them.

- [ ] **Step 1: Write the failing tests**, using a test provider that records the calls to `set` and a
  mocked `sampleCard`.
  - `pickOrder([1..30], seeded rand)` has length 24, and is a permutation of the first 24.
  - The hook rendered with `null` then `[a,b,c]` calls `set` once, with a `WashState`.
  - Re-rendering with `[a,b,c,d]` (an append) or `[c]` (a filter) doesn't call `set` again.
  - Unmount, then a remount with the same cards, picks again.
  - When every card samples as grey, it still sets `WashState`, using the first card.
  - When every sample is null, it sets the `gameFallback` families.
  - When `sampleCard` resolves after unmount, `set` is not called with that result.
  - When `[colourful, grey]` is picked and `rand` puts the grey card first, the colourful one wins.
- [ ] **Step 2: Run the tests and check they fail.** Run
  `npx vitest run tests/renderer/wash-pick.test.tsx --maxWorkers=2`. Expected: FAIL.
- [ ] **Step 3: Implement the hook.**
- [ ] **Step 4: Run the tests and check they pass.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(wash): pick one random card per page visit`.

### Task 4: `ArtWash` paints the field

**Files:**
- Modify: `src/renderer/src/components/ArtWash.tsx`, `src/renderer/src/components/AppShell.tsx` (the
  wash state type), `src/phone/PhoneShell.tsx`
- Test: `tests/renderer/art-wash.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `WashState` (Task 3); `fit`, `field`, `GRAIN`, `css` (Task 1); `gameFallback` (Task 2).
- Produces: `ArtWash({ wash, enabled = true }: { wash: WashState | null; enabled?: boolean })`.
  - It renders a full-size `absolute inset-0 -z-10` stack with:
    - a base layer (`css(fitted.base)`);
    - two pool layers, `data-testid="wash-a"` and `"wash-b"`, holding
      `field(fitted, {seed, withBase:false})` and cross-fading opacity over 700 ms;
    - a shade (`linear-gradient(180deg, transparent 45%, rgb(8 7 12 / .5))`);
    - a grain layer with `GRAIN` at opacity .22, `mix-blend-mode: overlay`.
  - `strength` multiplies the pool layers' opacity.
  - Theme is fixed to `'dark'` in this plan.
  - With `wash === null`, it shows `gameFallback(game)`.
  - With `enabled=false`, it renders nothing (the Scan pages).
  - When `matchMedia('(prefers-reduced-motion: reduce)')` matches, the layers get `transition: none`.
  - The old GLOW and the blurred `<img>` code are deleted. `GLOW`'s two colours move into `gameFallback`.
  - AppShell: `useState<WashState | null>`. The wash is disabled when `page === 'scan'`.
  - PhoneShell: `<ArtWash wash={wash} enabled={!scan} />`.

- [ ] **Step 1: Rewrite the test.**
  - `render(<ArtWash wash={null} />)` shows `wash-a` with a non-empty `style.background`.
  - Rerendering with a `WashState` makes the other layer have opacity 1 and the first opacity 0.
  - `enabled={false}` gives an empty container.
  - With reduced motion mocked to true, both layers have the style `transition: none`.
  - `strength: 0.5` gives the visible layer an opacity of `0.5`.
- [ ] **Step 2: Run the test and check it fails.** Run
  `npx vitest run tests/renderer/art-wash.test.tsx --maxWorkers=2`. Expected: FAIL.
- [ ] **Step 3: Implement**, including the AppShell and PhoneShell wiring.
- [ ] **Step 4: Run the test, then the shell suites, and check they pass.**
  `npx vitest run tests/renderer/art-wash.test.tsx tests/renderer/shell.test.tsx tests/renderer/web-shell.test.tsx --maxWorkers=2`.
  Expected: PASS.
- [ ] **Step 5: Commit**: `feat(wash): paint the colour field behind every page`.

### Task 5: Pages hand over their cards

**Files:** modify every `useArtWash` caller, and add new ones.
- `CollectionPage.tsx:215`: `list.map(e => ({imageId: e.imageId, frameType: e.card.frameType}))`
- `BrowsePage.tsx:125`: `cards.map(c => ({imageId: c.imageId, frameType: c.frameType}))`
- `DashboardPage.tsx:432` and `FriendDashboard.tsx:44`: from `data.topEntries`
- `SetsPage.tsx:217`:
  - The set list has no cards. Use the cover cards of the visible sets: `{imageId: s.coverImageId}`
    for each set with one.
  - An open set returns `undefined`, as today.
- `SetChecklist.tsx:235`: `data.cards`
- New callers, each from the list it already renders:
  - `BindersPage.tsx`: covers;
  - `BinderView.tsx`: the binder's cards;
  - `WishlistPage.tsx`;
  - `PokedexPage.tsx`: owned cards' images;
  - `SessionsPage.tsx`: the session cards;
  - `FriendBinders.tsx`;
  - `FriendWishlist.tsx`.
- The card detail panel and `CardDrawer` are left out. They're overlays on a page that already has a
  wash, so re-picking under an open panel would break the rule of one pick per visit.
- Strength 0.5 on table-like pages:
  - `SessionsPage`;
  - `WishlistPage` when it is in list mode;
  - Settings, Admin and Friends list (no cards; they pass `null`).
- Use memoised arrays (`useMemo`), so identity churn doesn't matter. The pick is once per mount anyway.

**Interfaces:**
- Consumes: `useArtWash(cards, {strength})`, `WashCard` (Task 3).

- [ ] **Step 1: Add one test per new caller** in its existing page test file, or `tests/renderer/wash-pages.test.tsx`.
  The test mounts the page with fixture data inside a recording `ArtWashContext.Provider` and checks it
  receives a `WashState` (with `sampleCard` mocked). Do this for Binders, Wishlist, Pokédex and Sessions.
- [ ] **Step 2: Run the tests and check they fail.** Run
  `npx vitest run tests/renderer/wash-pages.test.tsx --maxWorkers=2`. Expected: FAIL.
- [ ] **Step 3: Update all the callers.** Delete `cardArtUrl`, `coverArtUrl` and `setArtUrl`.
- [ ] **Step 4: Run the full suite, and the web and phone typechecks.**
  `npm test && npm run typecheck:web && npm run typecheck:phone`. Expected: all pass.
- [ ] **Step 5: Commit**: `feat(wash): every card page washes from its own cards`.

### Task 6: Stage 1 check with the owner

- [ ] Run `npm run dev`. Screenshot Dashboard, Collection, Browse, Sets, a set checklist, Binders and
  Settings, each opened twice to show two different picks. Also one Pokémon page and one phone page
  (`npm run dev:phone`, or the phone build used today).
- [ ] Time `sampleCard` for 24 uncached cards in DevTools: mean per card and total. Report it next to the
  screenshots.
- [ ] Send the screenshots and timings to the owner. **Wait for their OK before Stage 2.**

---

## Stage 2 — dark redesign

### Task 7: Fonts and tokens

**Files:**
- Modify: `package.json` (add `@fontsource-variable/bricolage-grotesque@^5.3.0`, `@fontsource/geist-mono@^5.3.0`;
  remove the two `@fontsource/ibm-plex-*`), `src/renderer/src/main.tsx` and the phone entry's font
  imports, `src/renderer/src/index.css`
- Test: `tests/renderer/theme-tokens.test.ts`

**Interfaces:**
- Produces, in `index.css`:
  - `--font-sans: 'Bricolage Grotesque Variable', system-ui, sans-serif`
  - `--font-mono: 'Geist Mono', ui-monospace, monospace`
  - A utility `font-display`: `font-family: var(--font-sans); font-stretch: 75%; font-weight: 800; letter-spacing: -0.03em`.
  - `--foreground: #ffffff`.
  - `--muted-foreground: #ffffff`. Muted text over the wash now differs by size and weight, not colour
    (spec); the token stays so existing classes compile.
  - `--card` and `--secondary` become `transparent`. `--border` becomes `rgb(255 255 255 / 22%)`
    (hairlines only).
  - `--popover: #17141d` (solid). `--accent`, `--input` and `--ring` stay.
  - `--chip: rgb(255 255 255 / 14%)`, `--chip-on: #ffffff`, `--chip-on-ink: #14101a`, exposed as
    `--color-chip`, `--color-chip-on` and `--color-chip-on-ink`.

- [ ] **Step 1: Write the failing test.** Read `index.css` as text and check that:
  - `--font-sans` contains `Bricolage Grotesque Variable`;
  - `--muted-foreground: #ffffff`;
  - `--popover` is not transparent;
  - `.font-display` is defined with `font-stretch: 75%`.
- [ ] **Step 2: Run the test and check it fails.** Run
  `npx vitest run tests/renderer/theme-tokens.test.ts --maxWorkers=2`. Expected: FAIL.
- [ ] **Step 3: Install the fonts, and update the imports and tokens.**
- [ ] **Step 4: Run the test, then `npm test`, and check both pass.**
- [ ] **Step 5: Commit**: `feat(theme): Bricolage Grotesque, Geist Mono and wash-first dark tokens`.

### Task 8: Shared controls

**Files:**
- Modify: `src/renderer/src/components/ui/`:
  - `button.tsx`
  - `input.tsx`
  - `select.tsx`
  - `tabs.tsx`
  - `toggle.tsx`
  - `toggle-group.tsx`
  - `badge.tsx`
  - `table.tsx`
  - `card.tsx`
- Modify the shared app components:
  - `SearchInput.tsx`
  - `FilterChip.tsx`
  - `SortControl.tsx`
  - `UnderlineTabs.tsx`
- Test: `tests/renderer/ui-look.test.tsx`

**Look (from the mockup):**
- Buttons and chips are pills (`rounded-full`). The default chip is `bg-chip`; active or primary is
  `bg-chip-on text-chip-on-ink`; the font is Geist Mono 500 12px.
- Inputs and the search field are underline only: `border-b-[1.5px] border-foreground bg-transparent`,
  with no box. The search placeholder is in italic.
- Tabs are bold or dot text tabs, with no box.
- Badges are pills. Coloured badge text sits on a solid `bg-popover`.
- Tables have no outer border, hairline row rules, and Geist Mono for numeric cells.
- `Card` loses its background and border (`bg-transparent border-0 shadow-none`).
- Dialogs, popovers, menus and selects' content stay solid `bg-popover`.

- [ ] **Step 1: Write the failing tests.**
  - `<Button>` has the class `rounded-full`.
  - `<Input>` has no `rounded-md` and has `border-b`.
  - `<Card>` has `bg-transparent`.
  - The active `<FilterChip>` has `bg-chip-on`.
  - `<TableCell>` is not a box (no `border` class besides `border-b`).
- [ ] **Step 2: Run the tests and check they fail.** Run
  `npx vitest run tests/renderer/ui-look.test.tsx --maxWorkers=2`. Expected: FAIL.
- [ ] **Step 3: Restyle the components.**
- [ ] **Step 4: Run `npm test` and check it passes.** Some snapshot or class assertions in older tests may
  need updating. Change only the class expectations, never the behaviour checks.
- [ ] **Step 5: Commit**: `feat(theme): pill and underline controls`.

### Task 9: Sidebar with the D mark

**Files:**
- Modify: `src/renderer/src/components/AppShell.tsx` (aside, `NavItem`, `GROUP_HEADING`, `ITEM`),
  `src/renderer/src/components/GameSwitch.tsx` (`SidebarGameSwitch`)
- Test: `tests/renderer/shell.test.tsx`

**Look:**
- The aside has no `border-r`. The D mark (`@/assets/logo-mark.svg`) is 46 px at the top-left, with
  `alt="Duel Binder"` and no wordmark.
- With more than one game, `SidebarGameSwitch` sits under the mark as a mono pill showing the current
  game, and is no longer next to the logo.
- Group headings are Geist Mono 10.5 px uppercase with 1.5 px tracking.
- Links are 15 px/400. The active link is 16 px/800 with a 7 px dot 14 px to its left.
- The `Add card` button becomes an outline pill. Settings and Admin keep their place at the bottom.

- [ ] **Step 1: Write the failing tests.**
  - The shell shows `getByRole('img', {name: 'Duel Binder'})`.
  - The text "Duel Binder" is not shown as text in the sidebar.
  - The active nav item has `aria-current="page"`. Add it if it is missing.
  - With two games available, both the mark and the game switch render.
- [ ] **Step 2: Run the tests and check they fail.** Run
  `npx vitest run tests/renderer/shell.test.tsx --maxWorkers=2`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the shell and web-shell suites and check they pass.**
- [ ] **Step 5: Commit**: `feat(theme): plain-text sidebar with the D mark`.

### Task 10: Page header and card tiles

**Files:**
- Modify: `src/renderer/src/components/PageHeader.tsx`, the collection, browse and set tile components
  (the ones using `tileLayout.ts`; find the tile renderers in `features/collection`, `features/browse`
  and `features/sets`), `src/renderer/src/components/TitleBar.tsx`, and the glass strip in `AppShell.tsx`
  (lines 127–131)
- Test: `tests/renderer/page-header.test.tsx`

**Look:**
- The title is `font-display`, 96 px on desktop (clamped down to 56 px under 1100 px window width), with
  `leading-[.8]`.
- Stats sit right-aligned in the header. Values are Geist Mono 500 30 px; labels are mono 10.5 px
  uppercase with 1.5 px tracking, underneath.
- The header loses its glass and blur box, and the matching title-bar strip in AppShell is removed.
- A tile is the art (soft shadow, 4 px radius), then the name at 600 weight 15 px, truncated. Below that,
  one line with the set code on the left and the price on the right, both in Geist Mono 11.5 px/500.
  The tile has no box.

- [ ] **Step 1: Write the failing tests.**
  - `<PageHeader title="Collection" stats={…}>` renders an `h1` with the class `font-display`.
  - Each stat value is in an element with `font-mono`.
  - The header has no `backdrop-blur` class.
- [ ] **Step 2: Run the tests and check they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `PageHeader`'s props. If stats are passed as children today, keep that
  and only restyle.
- [ ] **Step 4: Run `npm test` and check it passes.**
- [ ] **Step 5: Commit**: `feat(theme): big condensed headers and boxless tiles`.

### Task 11: Page pass — remove boxes, move coloured text into pills

**Files:**
- First: Dashboard, Collection, Browse and Sets (including SetChecklist).
- Then: Binders, Wishlist, Pokédex, Sessions, Friends and Settings.
- Admin pages last, and only the boxes.

**Rules for each page:**
- Section wrappers that are only there to box content (`rounded-* border bg-card`, `bg-white/[0.0x]`
  panels) are removed, and spacing carries the grouping.
- Text over the wash that uses `text-muted-foreground` stays (the token is now ink). Any `opacity-*`,
  `/60`-style alpha or coloured text class sitting directly on the wash goes:
  - coloured meaning, such as price up or down, errors and rarity colours, moves into a pill
    (`rounded-full bg-popover px-2`);
  - pure de-emphasis becomes a smaller size or a lighter weight.
- Overlays drawn on card art or photos keep their fixed colours. Mark each with `/* on art: fixed */`.
- Find each page's hits with: `grep -nE "text-muted-foreground/|opacity-[0-9]|text-(green|red|emerald|rose|amber|violet|purple)-|bg-card|bg-white/\[" <file>`.

- [ ] **Step 1: Do Dashboard, Collection, Browse and Sets.** After each page, run `npm test`, then commit:
  `feat(theme): <page> on the wash`.
- [ ] **Step 2: Do the remaining pages**, one commit per page, running `npm test` each time.
- [ ] **Step 3: Phone.** It shares `index.css`, so the fonts and tokens already apply. Check every phone
  screen in the browser at 390×844 for unreadable text, such as muted text over the camera on Scan, which
  keeps its own dark background. Fix only regressions.
- [ ] **Step 4: Run `npm test && npm run typecheck:web && npm run typecheck:phone`** and check everything passes.

### Task 11a: Add Card window

Owner, 2026-11-14: "fix the add card modal and style it properly". Today it is a small stock shadcn
command palette (`src/renderer/src/features/add-card/AddCardDialog.tsx`, 435 lines): a grey box, small text,
art thumbnails 36 px wide, sitting over the page without any of the new look.

**Files:** `src/renderer/src/features/add-card/AddCardDialog.tsx`, `src/renderer/src/components/ui/command.tsx`
and `dialog.tsx` only if the change is shared. Test: extend the existing add-card tests.

**Look:**
- A solid `bg-popover` surface (the wash is not behind it), wider (about 720 px on desktop), positioned in the
  upper third, with a soft shadow and a dimmed, blurred overlay behind it.
- The search is the underline field in Bricolage at about 22 px, placeholder in italic, with the game name in
  mono caps above it.
- Results are rows with bigger art (about 48 px wide), the name at 600 weight, and set code, rarity and price in
  Geist Mono on one line. The highlighted row is a `bg-chip` pill-shaped band, not a grey block.
- The printing step and the quantity step use the same pills (Task 8) and the same mono numbers.
- Empty and loading states are ink text in the new type, not muted grey.
- Behaviour, keyboard handling and props do not change; existing tests must keep passing with only class
  expectations updated.

Commit: `feat(theme): restyle the Add Card window`.

### Task 11b: Phone, iOS, Android and web

Owner, 2026-11-14: "make sure the ios and android app get this … and web". This replaces the spec's "phone gets
the wash and fonts only".
- **Web** is the same renderer build (`app.duelbinder.com`), so it gets stages 1 and 2 automatically. Check it
  in Task 12: build the web target, open it, confirm the wash samples art (portal `/img/` is same-origin) and
  the fonts load from the bundle.
- **iOS and Android** are the Capacitor shell around `src/phone`. Phone pages that reuse renderer pages and
  `components/ui` already change with Tasks 7–11. This task restyles the phone-only screens to match:
  `PhoneShell.tsx` navigation, `Settings.tsx`, `SignIn.tsx`, `SessionsSheet.tsx`, `PickerSheet.tsx`,
  `PrintingSheet.tsx`, `ReviewSheet.tsx`, `UpdateBanner.tsx`, `SyncProblems.tsx` and `phone.css`:
  - pills and underline fields from Task 8, `font-display` titles sized for the phone (about 44 px), mono numbers;
  - sheets keep a solid `bg-popover` surface;
  - no boxes over the wash, ink-only text over it.
- The camera / Scan screens stay as they are (dark, no wash).
- Keep layout and navigation structure; this is a look pass, not a layout rework.

Commit: `feat(theme): phone screens get the new look`.

### Task 12: Stage 2 check with the owner, then the PR

- [ ] Screenshot every desktop page, three phone screens and one Pokémon page in the real app, and send
  them to the owner. **Wait for their OK.** Fix what they flag, with one commit per fix.
- [ ] Use superpowers:finishing-a-development-branch to open the PR. It notes any Worker change from
  Task 2 Step 5 (deploy the portal before tagging).

---

Stage 3 (light theme: the `.light` token set, the sweep of about 350 hard-coded colours, and the
Settings → Appearance switch) gets its own plan after this one ships.
