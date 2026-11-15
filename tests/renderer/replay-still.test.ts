import { describe, it, expect } from 'vitest'
import { CARD_ASPECT, REPLAY_H, REPLAY_W } from '@/features/scan/replay/draw'
import type { ReplayPull } from '@/features/scan/replay/pulls'
import {
  drawHighlights,
  ellipsize,
  podiumLayout,
  priceLine,
  type StillScene,
  type StillSlot
} from '@/features/scan/replay/still'
import { formatUsd } from '@/lib/format'
import { recordingContext, textsOf } from './replayCanvas'

const pull = (price: number | null, over: Partial<ReplayPull> = {}): ReplayPull => ({
  key: `k${price}`,
  name: `Card ${price}`,
  imageId: price ?? 0,
  photoId: null,
  rarity: 'Secret Rare',
  setCode: 'X',
  price,
  quantity: 1,
  addedAt: price ?? 0,
  ...over
})

const still = (pulls: ReplayPull[]): StillScene => ({
  pulls,
  art: pulls.map((p, i) => ({ id: `${p.key}-${i}` }) as unknown as ImageBitmap),
  header: 'Nov 4 · 3 cards · $20.00'
})

const overlaps = (a: StillSlot, b: StillSlot): boolean => {
  const ah = a.w * CARD_ASPECT
  const bh = b.w * CARD_ASPECT
  return (
    a.cx - a.w / 2 < b.cx + b.w / 2 &&
    b.cx - b.w / 2 < a.cx + a.w / 2 &&
    a.top < b.top + bh &&
    b.top < a.top + ah
  )
}

describe('podiumLayout', () => {
  it.each([1, 2, 3, 5, 8])('%i pulls: one slot each, inside the frame, no overlaps', (n) => {
    const { slots, totalY } = podiumLayout(n)
    expect(slots.map((s) => s.index).sort((a, b) => a - b)).toEqual([...Array(n).keys()])
    for (const s of slots) {
      const h = s.w * CARD_ASPECT
      expect(s.cx - s.w / 2).toBeGreaterThanOrEqual(24)
      expect(s.cx + s.w / 2).toBeLessThanOrEqual(REPLAY_W - 24)
      expect(s.top).toBeGreaterThanOrEqual(80)
      expect(s.top + h).toBeLessThan(totalY - 60)
    }
    expect(totalY).toBeLessThan(REPLAY_H - 60)
    for (const a of slots) for (const b of slots) if (a !== b) expect(overlaps(a, b)).toBe(false)
  })

  it('the dearest pull is the centred best; #2 left, #3 right', () => {
    const { slots } = podiumLayout(5)
    const by = (i: number): StillSlot => slots.find((s) => s.index === i)!
    expect(by(4)).toMatchObject({ tier: 'best', cx: REPLAY_W / 2 })
    expect(by(3).tier).toBe('side')
    expect(by(3).cx).toBeLessThan(REPLAY_W / 2)
    expect(by(2).tier).toBe('side')
    expect(by(2).cx).toBeGreaterThan(REPLAY_W / 2)
    expect(by(1).tier).toBe('row')
    expect(by(1).cx).toBeLessThan(by(0).cx)
  })

  it("side captions end above the best card's rarity pill", () => {
    const { slots } = podiumLayout(5)
    const best = slots.find((s) => s.tier === 'best')!
    const pillTop = best.top + best.w * CARD_ASPECT + 40 - 24
    for (const s of slots.filter((x) => x.tier === 'side'))
      expect(s.top + s.w * CARD_ASPECT + 50).toBeLessThanOrEqual(pillTop)
  })

  it('the total sits clear of the row captions', () => {
    const { slots, totalY } = podiumLayout(8)
    const row = slots.find((s) => s.tier === 'row')!
    // The price baseline is 40 below the card; the total's capitals rise about 27 above its own.
    expect(row.top + row.w * CARD_ASPECT + 40 + 20).toBeLessThanOrEqual(totalY - 27)
  })

  it('row cards use the spare width', () => {
    const row = podiumLayout(8).slots.filter((s) => s.tier === 'row')
    expect(row[0].w).toBeGreaterThanOrEqual(105)
  })

  it('with no row the podium sits lower', () => {
    const best = (n: number): number => podiumLayout(n).slots.find((s) => s.tier === 'best')!.top
    expect(best(3)).toBeGreaterThan(best(5))
  })
})

describe('ellipsize', () => {
  const m = (s: string): number => s.length * 10
  it('keeps text that fits', () => expect(ellipsize('Pikachu', 100, m)).toBe('Pikachu'))
  it('cuts with … to fit', () => {
    const out = ellipsize('Mega Charizard X ex Special', 100, m)
    expect(out.endsWith('…')).toBe(true)
    expect(m(out)).toBeLessThanOrEqual(100)
  })
})

describe('priceLine', () => {
  it('price, then ×n for copies', () =>
    expect(priceLine(pull(12, { quantity: 2 }))).toBe(`${formatUsd(12)} · ×2`))
  it('a rarity pull shows its rarity', () =>
    expect(priceLine(pull(null, { rarity: 'Secret Rare' }))).toBe('Secret Rare'))
  it('a rarity pull with copies keeps its rarity', () =>
    expect(priceLine(pull(null, { rarity: 'Secret Rare', quantity: 2 }))).toBe('Secret Rare · ×2'))
  it('under $1 counts as no price', () =>
    expect(priceLine(pull(0.5, { rarity: 'Ultra Rare' }))).toBe('Ultra Rare'))
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
    drawHighlights(ctx, still([pull(null), pull(null, { key: 'b' })]))
    expect(textsOf(calls)).toContain('2 hits')
  })

  it("draws each pull's art", () => {
    const s = still([pull(2), pull(12)])
    const { ctx, calls } = recordingContext()
    drawHighlights(ctx, s)
    for (const a of s.art) expect(calls.some((c) => c[0] === 'drawImage' && c[1] === a)).toBe(true)
  })
})
