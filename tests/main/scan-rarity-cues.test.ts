import { describe, expect, it } from 'vitest'
import { nameInkOver, pickRarityByCues, type NameInk } from '../../src/shared/scan/rarity'
import type { RgbaImage } from '../../src/shared/scan/types'
import { rarityCues } from '../../src/renderer/src/features/scan/vision/rarityCues'
import { NAME_BAND } from '../../src/renderer/src/features/scan/vision/regions'

const pick = (
  available: string[],
  nameInk: NameInk | null,
  frameType: string
): ReturnType<typeof pickRarityByCues> => pickRarityByCues(available, { nameInk }, frameType)

describe('pickRarityByCues', () => {
  it('tells gold from prismatic names on any frame', () => {
    const both = ['Ultra Rare', 'Starlight Rare']
    for (const frame of ['spell', 'link', 'effect', 'synchro_pendulum']) {
      expect(pick(both, 'dark', frame)).toEqual({ rarity: 'Ultra Rare', certain: true })
      expect(pick(both, 'light', frame)).toEqual({ rarity: 'Starlight Rare', certain: true })
    }
    expect(pick(['Quarter Century Secret Rare', 'Ultra Rare'], 'light', 'normal')).toEqual({
      rarity: 'Quarter Century Secret Rare',
      certain: true
    })
  })

  it('tells plain from prismatic ink only where plain ink is dark', () => {
    const both = ['Common', 'Secret Rare']
    expect(pick(both, 'dark', 'effect')).toEqual({ rarity: 'Common', certain: true })
    expect(pick(both, 'light', 'effect')).toEqual({ rarity: 'Secret Rare', certain: true })
    expect(pick(both, 'light', 'spell')).toEqual({ rarity: 'Common', certain: false })
    // Neither should read dark on a spell: something is off, so don't guess.
    expect(pick(both, 'dark', 'spell')).toEqual({ rarity: 'Common', certain: false })
  })

  it('tells plain from gold ink only where plain ink is light', () => {
    const both = ['Super Rare', 'Ultra Rare']
    expect(pick(both, 'light', 'trap')).toEqual({ rarity: 'Super Rare', certain: true })
    expect(pick(both, 'dark', 'xyz')).toEqual({ rarity: 'Ultra Rare', certain: true })
    expect(pick(both, 'dark', 'effect')).toEqual({ rarity: 'Super Rare', certain: false })
  })

  it('never chooses between rarities that look alike', () => {
    expect(pick(['Common', 'Super Rare'], 'dark', 'effect').certain).toBe(false)
    expect(pick(['Common', 'Short Print'], 'light', 'spell').certain).toBe(false)
    expect(pick(['Secret Rare', 'Starlight Rare'], 'light', 'effect').certain).toBe(false)
    expect(
      pick(['Platinum Secret Rare', 'Quarter Century Secret Rare'], 'light', 'xyz').certain
    ).toBe(false)
    // A variant looks like its base.
    expect(pick(['Ultra Rare', 'Ultra Rare (Overframe)'], 'dark', 'effect').certain).toBe(false)
    expect(pick(['Ultra Rare (Overframe)', 'Starlight Rare'], 'dark', 'effect')).toEqual({
      rarity: 'Ultra Rare (Overframe)',
      certain: true
    })
  })

  it("declines when a candidate's look is unknown", () => {
    expect(pick(['Ultra Rare', 'Ultimate Rare'], 'dark', 'spell').certain).toBe(false)
    expect(pick(['Rare', 'Secret Rare'], 'light', 'effect').certain).toBe(false)
    expect(pick(['Common', 'Starfoil Rare'], 'dark', 'effect').certain).toBe(false)
    expect(pick(["Collector's Rare", 'Ultra Rare'], 'light', 'effect').certain).toBe(false)
  })

  it('declines without a reading or a known frame', () => {
    expect(pick(['Ultra Rare', 'Starlight Rare'], null, 'spell')).toEqual({
      rarity: 'Ultra Rare',
      certain: false
    })
    expect(pick(['Ultra Rare', 'Starlight Rare'], 'dark', 'skill').certain).toBe(false)
  })

  it('is certain of a lone rarity', () => {
    expect(pick(['Ultimate Rare', 'Ultimate Rare'], null, 'effect')).toEqual({
      rarity: 'Ultimate Rare',
      certain: true
    })
  })
})

describe('nameInkOver', () => {
  it('needs enough frames that agree', () => {
    expect(nameInkOver([])).toBeNull()
    expect(nameInkOver(['dark'])).toBeNull()
    expect(nameInkOver([null, null, 'dark'])).toBeNull()
    expect(nameInkOver(['dark', null, 'dark'])).toBe('dark')
    expect(nameInkOver(['light', 'dark'])).toBeNull()
    expect(nameInkOver(['light', 'light', 'light', 'light', 'dark'])).toBe('light')
    expect(nameInkOver(['light', 'light', 'light', 'dark'])).toBeNull()
  })
})

// Synthetic straightened cards: a name bar of one colour with a row of letter-like blocks.
type Rgb = readonly [number, number, number]
const W = 842
const H = 1228

function card(bar: Rgb, glyph: (i: number) => Rgb | null, opts: { from?: number } = {}): RgbaImage {
  const data = new Uint8ClampedArray(W * H * 4)
  const set = (x: number, y: number, [r, g, b]: Rgb): void => {
    const p = (y * W + x) * 4
    data[p] = r
    data[p + 1] = g
    data[p + 2] = b
    data[p + 3] = 255
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, bar)
  const [bx0, by0, bx1, by1] = NAME_BAND.map((v, i) => Math.round(v * (i % 2 ? H : W)))
  const top = by0 + Math.round((by1 - by0) * 0.22)
  const bottom = by1 - Math.round((by1 - by0) * 0.22)
  // Letters 20 px wide with 8 px gaps, from the band's left edge (or `from` of its width).
  const start = bx0 + 6 + Math.round((opts.from ?? 0) * (bx1 - bx0))
  for (let i = 0, x0 = start; x0 + 20 < bx1 - 40; i++, x0 += 28) {
    const ink = glyph(i)
    if (!ink) continue
    for (let y = top; y < bottom; y++)
      for (let x = x0; x < x0 + 20; x++) {
        // An "L": thin strokes like print, with no closed counter.
        if (x < x0 + 5 || y >= bottom - 5) set(x, y, ink)
      }
  }
  return { width: W, height: H, data }
}

const ORANGE: Rgb = [190, 110, 60]
const TEAL: Rgb = [40, 150, 160]
const BLACK: Rgb = [25, 20, 20]
const WHITE: Rgb = [235, 240, 245]
const DIM_GOLD: Rgb = [20, 95, 105]
const RAINBOW: Rgb[] = [
  [250, 210, 220],
  [220, 250, 215],
  [215, 225, 255],
  [255, 245, 200]
]

describe('rarityCues', () => {
  it('reads plain black and white names', () => {
    expect(rarityCues(card(ORANGE, () => BLACK))).toEqual({ nameInk: 'dark' })
    expect(rarityCues(card(TEAL, () => WHITE))).toEqual({ nameInk: 'light' })
  })

  it('reads a dim gold name on a spell as dark', () => {
    expect(rarityCues(card(TEAL, () => DIM_GOLD))).toEqual({ nameInk: 'dark' })
  })

  it('reads silver and rainbow names on a monster as light', () => {
    expect(rarityCues(card(ORANGE, () => [225, 225, 230]))).toEqual({ nameInk: 'light' })
    expect(rarityCues(card(ORANGE, (i) => RAINBOW[i % RAINBOW.length]))).toEqual({
      nameInk: 'light'
    })
  })

  it('reads nothing when dark and light ink read about as much text, as in a blurred frame', () => {
    expect(rarityCues(card([130, 130, 130], (i) => (i % 2 ? BLACK : WHITE)))).toEqual({
      nameInk: null
    })
  })

  it('reads nothing from a blank bar, a stray mark or text that is not where a name starts', () => {
    expect(rarityCues(card(ORANGE, () => null))).toEqual({ nameInk: null })
    expect(rarityCues(card(ORANGE, (i) => (i < 2 ? BLACK : null)))).toEqual({ nameInk: null })
    expect(rarityCues(card(ORANGE, () => BLACK, { from: 0.5 }))).toEqual({ nameInk: null })
  })
})
