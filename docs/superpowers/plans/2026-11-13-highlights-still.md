# Highlights Still Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Save image** button next to **Make replay**. It saves a 1080×1350 PNG of the
session's best pulls in the Podium layout.

**Architecture:**
- A new `still.ts` in the replay folder does three things:
  - works out the Podium layout as plain numbers,
  - draws it once with the replay's own canvas helpers (exported from `draw.ts`),
  - and saves the PNG through the existing `saveReplay`.
- `MakeReplay.tsx` gets the button.
- The desktop save handler starts accepting `.png`.

**Tech Stack:** TypeScript, React, Canvas 2D, Vitest + Testing Library, Electron IPC.

**Spec:** `docs/superpowers/specs/2026-11-13-highlights-still-design.md`

## Global Constraints

- Output: PNG, **1080×1350**. Draw in the replay's 720×900 coordinates with `ctx.scale(1.5, 1.5)`.
- File name: `replayFileName('png')`, which gives `rip-replay-YYYY-MM-DD.png`.
- The pulls are exactly `ReplaySource.pulls`, the same ones the replay shows.
- Look: the replay palette (BG `#111113`, FG `#ecebe8`, MUTED `#8f8d88`, GOLD `#e8c477`), IBM Plex
  Sans, the session chip at the top left, and the watermark "DUEL BINDER · RIP REPLAY" with the logo.
- Copy:
  - Button: `Save image`. While running: `Saving…`.
  - Toast on success: `Image saved` (description = where, when known).
  - Toast on error: `Couldn't save the image`.
- Names never overlap or overflow their slot: they are cut with `…`.
- Vitest: `npm test -- <file>` (the script already passes `--maxWorkers=2`).
- Before pushing, run `npm run typecheck:web` and `npm run typecheck:phone`. Plain `typecheck`
  stops early.
- Work in the worktree `/var/tmp/still` on branch `feat/highlights-still`.

## Review Focus

1. A pull with no price (it earned its place by rarity): its price line shows its rarity instead,
   never "$0.00". When every pull is like that, the total line reads just "3 hits".
2. A very long card name (60+ characters) in a row slot or side slot: cut with `…` inside the slot
   width.
3. Only 1–3 hits: no empty row area, and the podium moves down so the picture still looks balanced.
4. Art that won't load: `loadReplayArt` drops that pull. If none load, show the error toast
   "Couldn't load the card art", never a blank PNG.
5. A double tap while saving: the button is disabled, so only one save runs.

---

### Task 1: Podium layout and drawing

**Files:**
- Modify: `src/renderer/src/features/scan/replay/draw.ts`:
  - export `backdrop`, `drawCard`, `chip`, `watermark`, `rarityPill`, `centredText`, `setFont`,
    `glowOf`;
  - export the constants `FG`, `MUTED`, `GOLD`, `CARD_ASPECT`;
  - widen `backdrop`'s `scene` parameter to `Pick<ReplayScene, 'backdrop'>`.
- Create: `src/renderer/src/features/scan/replay/still.ts`
- Test: `tests/renderer/replay-still.test.ts`. Use `recordingContext` and `textsOf` from
  `./replayCanvas`.

**Interfaces:**
- Produces:
  - `export type StillScene = Pick<ReplayScene, 'pulls' | 'art' | 'header' | 'backdrop' | 'logo'>`
  - `export const STILL_W = 1080`, `export const STILL_H = 1350`
  - `export interface StillSlot { index: number; tier: 'best' | 'side' | 'row'; cx: number; top: number; w: number }`
    - `index` is into `pulls`.
    - `top` is the card's top edge.
    - All values are in 720×900 coordinates.
  - `export function podiumLayout(n: number): { slots: StillSlot[]; totalY: number }`
  - `export function ellipsize(text: string, maxWidth: number, measure: (s: string) => number): string`
  - `export function priceLine(pull: ReplayPull): string`
  - `export function drawHighlights(ctx: CanvasRenderingContext2D, scene: StillScene): void`
    - The caller has already scaled `ctx` to 720×900.

- [ ] **Step 1: Write the failing tests**

```ts
describe('podiumLayout', () => {
  it.each([1, 2, 3, 5, 8])('%i pulls: one slot each, inside the frame, no overlaps', (n) => {
    const { slots, totalY } = podiumLayout(n)
    expect(slots.map((s) => s.index).sort((a, b) => a - b)).toEqual([...Array(n).keys()])
    for (const s of slots) {
      const h = s.w * CARD_ASPECT
      expect(s.cx - s.w / 2).toBeGreaterThanOrEqual(24)
      expect(s.cx + s.w / 2).toBeLessThanOrEqual(REPLAY_W - 24)
      expect(s.top).toBeGreaterThanOrEqual(80) // clear of the chip
      expect(s.top + h).toBeLessThan(totalY - 60) // room for captions above the total
    }
    expect(totalY).toBeLessThan(REPLAY_H - 60) // clear of the watermark
    // No two card rectangles intersect.
    for (const a of slots) for (const b of slots) if (a !== b) expect(overlaps(a, b)).toBe(false)
  })
  it('the dearest pull is the centred best; #2 left, #3 right', () => {
    const { slots } = podiumLayout(5)
    const by = (i: number) => slots.find((s) => s.index === i)!
    expect(by(4)).toMatchObject({ tier: 'best', cx: REPLAY_W / 2 })
    expect(by(3).tier).toBe('side'); expect(by(3).cx).toBeLessThan(REPLAY_W / 2)
    expect(by(2).tier).toBe('side'); expect(by(2).cx).toBeGreaterThan(REPLAY_W / 2)
    // The row reads dearest first, left to right.
    expect(by(1).cx).toBeLessThan(by(0).cx)
  })
  it('with no row the podium sits lower', () => {
    const best = (n: number) => podiumLayout(n).slots.find((s) => s.tier === 'best')!.top
    expect(best(3)).toBeGreaterThan(best(5))
  })
})

describe('ellipsize', () => {
  const m = (s: string) => s.length * 10
  it('keeps text that fits', () => expect(ellipsize('Pikachu', 100, m)).toBe('Pikachu'))
  it('cuts with … to fit', () => {
    const out = ellipsize('Mega Charizard X ex Special', 100, m)
    expect(out.endsWith('…')).toBe(true)
    expect(m(out)).toBeLessThanOrEqual(100)
  })
})

describe('priceLine', () => {
  it('price, then ×n for copies', () => expect(priceLine(pull(12, { quantity: 2 }))).toBe(`${formatUsd(12)} · ×2`))
  it('a rarity pull shows its rarity', () => expect(priceLine(pull(null, { rarity: 'Secret Rare' }))).toBe('Secret Rare'))
  it('under $1 counts as no price', () => expect(priceLine(pull(0.5, { rarity: 'Ultra Rare' }))).toBe('Ultra Rare'))
})

describe('drawHighlights', () => {
  it('names and prices every pull and totals them', () => {
    const { ctx, calls } = recordingContext()
    drawHighlights(ctx, still([pull(2), pull(5), pull(9), pull(30)]))
    const t = textsOf(calls).join('\n')
    for (const p of ['Card 2', 'Card 5', 'Card 9', 'Card 30']) expect(t).toContain(p)
    expect(t).toContain(formatUsd(30))
    expect(t).toContain(`4 hits · ${formatUsd(46)}`)
    expect(t).toContain('Nov 4 · 3 cards · $20.00')
  })
  it('all rarity pulls: the total line has no dollars', () => {
    const { ctx, calls } = recordingContext()
    drawHighlights(ctx, still([pull(null), pull(null)]))
    expect(textsOf(calls)).toContain('2 hits')
  })
  it("draws each pull's art", () => {
    const s = still([pull(2), pull(12)])
    const { ctx, calls } = recordingContext()
    drawHighlights(ctx, s)
    for (const a of s.art) expect(calls.some((c) => c[0] === 'drawImage' && c[1] === a)).toBe(true)
  })
})
```

The `pull` helper is the same as in `replay-draw.test.ts`. `still(pulls)` is the `scene` helper
from that file without `timeline`. `overlaps` checks whether two slots' card rectangles intersect;
the card height is `w * CARD_ASPECT`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- tests/renderer/replay-still.test.ts`
Expected: FAIL. The imports from `still` don't resolve.

- [ ] **Step 3: Implement `still.ts` and the `draw.ts` exports**

Layout. All sizes are in 720×900 coordinates; scaled from the approved mockup.

| Tier | Card width | Where |
|---|---|---|
| best | 250 | Centred, `top` 92. |
| side | 165 | `cx` = 360 ∓ 223. Bottoms level with the best card's bottom. |
| row | 92 | Up to 5 in one row, gap 14, centred. `top` = best bottom + 136. |

- `totalY` is 806.
- With 3 pulls or fewer, there is no row. Add 100 to every `top` and set `totalY` to 760.

Index mapping (pulls run cheapest first):
- best = `n-1`
- left side = `n-2`
- right side = `n-3`
- row, left to right = `n-4` down to `0`

Drawing, in order:
1. `backdrop(ctx, scene, [{ art: best art, alpha: 0.72 }], 0)`.
2. Each card with `drawCard(ctx, art, { cx, cy: top + h/2, w, rot: 0, sx: 1, face: true, alpha: 1, glow: glowOf(art), glowBlur: best ? 100 : 18, sheen: null }, 1.5)`.
3. Captions under each card.
   - **best:**
     - `rarityPill` (when `rarity` is set) at bottom + 40;
     - the name at 700 / 30 px FG, with `ellipsize` to 600 px;
     - `priceLine` at 600 / 26 px GOLD.
   - **side:** the name at 600 / 18 px FG and `priceLine` at 600 / 18 px GOLD, each cut with
     `ellipsize` to the card width + 20.
   - **row:** the name at 500 / 13 px FG and `priceLine` at 600 / 14 px GOLD, each cut with
     `ellipsize` to the card width + 12.
4. The total line, centred at `totalY`, 700 / 36 px FG:
   `plural(hits, 'hit', 'hits') + (total > 0 ? ' · ' + formatUsd(total) : '')`, using
   `replayValue`.
5. `chip(ctx, scene.header)`, then `watermark(ctx, scene.logo)`.

Text notes:
- Set the font with `setFont` before calling `ellipsize`.
- Pass `(s) => ctx.measureText(s).width` as the measure.
- `priceLine` matches `pullText`'s rule:
  - `formatUsd(price)` when the price is ≥ `REPLAY_MIN_PRICE`;
  - `×q` when the quantity is above 1;
  - the parts joined with ` · `;
  - when that is empty, `rarity ?? ''`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- tests/renderer/replay-still.test.ts tests/renderer/replay-draw.test.ts`
Expected: PASS. The replay's own draw tests are unchanged and still green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/features/scan/replay/still.ts src/renderer/src/features/scan/replay/draw.ts tests/renderer/replay-still.test.ts
git commit -m "feat(replay): draw a podium still of a session's best pulls"
```

### Task 2: Save image button and PNG saving

**Files:**
- Modify: `src/renderer/src/features/scan/replay/still.ts`: add `makeHighlights`.
- Modify: `src/renderer/src/features/scan/replay/MakeReplay.tsx`: add the button and the `still`
  prop.
- Modify: `src/main/ipc/handlers.ts:379`: the regex becomes `/^[\w.-]+\.(mp4|webm|gif|png)$/`.
- Modify: `src/main/index.ts` (the `saveReplay` dialog): the filter name is `'GIF'` for gif,
  `'PNG image'` for png, and `'Video'` otherwise.
- Test: `tests/renderer/replay-button.test.tsx` and `tests/main/handlers.test.ts`

**Interfaces:**
- Consumes: from Task 1, `drawHighlights`, `StillScene`, `STILL_W` and `STILL_H`. From the replay
  code, `loadReplayArt`, `loadReplayLogo`, `loadReplayFonts`, `saveReplay`, `replayFileName` and
  `SaveResult`.
- Produces:
  - `export type Still = (source: ReplaySource) => Promise<SaveResult>`
  - `export const makeHighlights: Still`
    1. Loads the art, logo and fonts in parallel.
    2. Throws `Error("Couldn't load the card art")` when no art loads.
    3. Draws on a `document.createElement('canvas')` sized `STILL_W`×`STILL_H` with
       `ctx.scale(1.5, 1.5)` and `backdrop: 'deep'`.
    4. Saves the result of `canvas.toBlob(…, 'image/png')`, wrapped in a promise, with
       `saveReplay(blob, replayFileName('png'))`.
  - `MakeReplay` takes a new optional prop `still?: Still`, which defaults to `makeHighlights`.

- [ ] **Step 1: Write the failing tests**

In `replay-button.test.tsx`:

```ts
it('Save image saves the same source and says so', async () => {
  const still = vi.fn(async () => ({ saved: true as const, where: '/x.png' }))
  const source = src(row(5))
  render(<MakeReplay source={source} variant="desktop" make={vi.fn()} still={still} />)
  await userEvent.click(screen.getByRole('button', { name: 'Save image' }))
  expect(still).toHaveBeenCalledWith(source)
  expect(toast.success).toHaveBeenCalledWith('Image saved', { description: '/x.png' })
})
it('Save image is disabled with no pulls', () => {
  render(<MakeReplay source={{ pulls: [], header: 'Nov 4' }} variant="phone" make={vi.fn()} still={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Save image' })).toBeDisabled()
})
it('shows Saving… and takes no second tap while it runs', async () => {
  let done!: (r: { saved: false }) => void
  const still = vi.fn(() => new Promise<{ saved: false }>((r) => (done = r)))
  render(<MakeReplay source={src(row(5))} variant="desktop" make={vi.fn()} still={still} />)
  await userEvent.click(screen.getByRole('button', { name: 'Save image' }))
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Saving…' }))
  expect(still).toHaveBeenCalledTimes(1)
  await act(async () => done({ saved: false }))
  expect(toast.success).not.toHaveBeenCalled()
})
it('a failed save says why', async () => {
  const still = vi.fn(async () => { throw new Error("Couldn't load the card art") })
  render(<MakeReplay source={src(row(5))} variant="desktop" make={vi.fn()} still={still} />)
  await userEvent.click(screen.getByRole('button', { name: 'Save image' }))
  expect(toast.error).toHaveBeenCalledWith("Couldn't load the card art")
})
```

In `handlers.test.ts`, add `'rip-replay-2026-11-13.png'` to the accepted names, with a matching
`saveReplay` call. Add `'rip.svg'` to the `bad` list.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- tests/renderer/replay-button.test.tsx tests/main/handlers.test.ts`
Expected: FAIL. There is no "Save image" button yet, and the `.png` name is rejected.

- [ ] **Step 3: Implement the button, `makeHighlights` and the handler change**

The button:
- It goes after the format toggle.
- Desktop styling: `<Button variant="outline" size="sm">`. Phone styling: `PHONE_CONTROL`.
- Saving state:
  - It keeps its own `saving` boolean, separate from the replay's `progress`.
  - The label is `Saving…` and the button is disabled while `saving` is true.
- Results:
  - Success: `toast.success('Image saved', where ? { description: where } : undefined)`, as in
    `start`.
  - Error: `toast.error(e.message)`, falling back to `"Couldn't save the image"`.
- It is disabled when `empty`.
- While the replay is being made (`progress !== null`), the whole control already shows only the
  progress line, so leave that as it is.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test -- tests/renderer/replay-button.test.tsx tests/main/handlers.test.ts tests/renderer/replay-still.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, then commit**

Run: `npm run typecheck:web && npm run typecheck:phone && npm run typecheck:node`
Expected: no errors.

```bash
git add src/renderer/src/features/scan/replay/still.ts src/renderer/src/features/scan/replay/MakeReplay.tsx src/main/ipc/handlers.ts src/main/index.ts tests/renderer/replay-button.test.tsx tests/main/handlers.test.ts
git commit -m "feat(replay): Save image button saves the highlights still as PNG"
```

### Task 3: Check it by eye

- [ ] **Step 1: Render real stills**

Write a throwaway script outside the repo, or use the `run` skill to launch the desktop app. Save
stills for sessions with 1, 3, 5 and 8 hits. Include one long name and one pull with no price.

- [ ] **Step 2: Compare with the approved Podium mockup**

Check:
- Nothing overlaps.
- The names are readable.
- The total is clear of the row.
- The image is 1080×1350.

Fix the spacing in `podiumLayout` if needed. Re-run Task 1's tests and commit.
