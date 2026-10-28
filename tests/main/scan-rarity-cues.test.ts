import { describe, expect, it } from 'vitest'
import {
  cuesOver,
  pickRarityByCues,
  type NameInk,
  type NameTint,
  type RarityCues
} from '../../src/shared/scan/rarity'
import { surfaceLook, type SurfaceReading } from '../../src/shared/scan/surface'
import type { RgbaImage } from '../../src/shared/scan/types'
import { rarityCues } from '../../src/renderer/src/features/scan/vision/rarityCues'
import { NAME_BAND } from '../../src/renderer/src/features/scan/vision/regions'

const pick = (
  available: string[],
  nameInk: NameInk | null,
  frameType: string,
  nameTint: NameTint | null = null
): ReturnType<typeof pickRarityByCues> =>
  pickRarityByCues(available, { nameInk, nameTint }, frameType)

describe('pickRarityByCues', () => {
  it('picks gold only when the ink reads dark and is gold-coloured', () => {
    const both = ['Ultra Rare', 'Starlight Rare']
    for (const frame of ['spell', 'link', 'effect', 'fusion'])
      expect(pick(both, 'dark', frame, 'gold')).toEqual({ rarity: 'Ultra Rare', certain: true })
    // Dark but not gold-coloured: maybe a gold name, maybe not; silver reading dark is off.
    expect(pick(both, 'dark', 'spell').certain).toBe(false)
    expect(pick(both, 'dark', 'effect', 'silver').certain).toBe(false)
    // On a pale bar a prismatic name can read dark too.
    expect(pick(both, 'dark', 'synchro_pendulum').certain).toBe(false)
    // ...unless it reads gold.
    expect(pick(both, 'dark', 'synchro_pendulum', 'gold').rarity).toBe('Ultra Rare')
  })

  it('rules glittery gold out by nothing, since glare can make it read light', () => {
    const both = ['Ultra Rare', 'Starlight Rare']
    expect(pick(['Premium Gold Rare', 'Starlight Rare'], 'light', 'effect', 'silver').certain).toBe(
      false
    )
    // Gold-coloured ink reading light is glare on gold.
    expect(pick(both, 'light', 'effect', 'gold').certain).toBe(false)
    expect(pick(['Common', 'Ultra Rare'], 'light', 'spell').certain).toBe(false)
  })

  it('tells plain from prismatic ink where plain ink is dark', () => {
    const both = ['Common', 'Secret Rare']
    expect(pick(both, 'dark', 'effect')).toEqual({ rarity: 'Common', certain: true })
    expect(pick(both, 'light', 'effect', 'silver')).toEqual({
      rarity: 'Secret Rare',
      certain: true
    })
    // Light but not silver: not plainly prismatic.
    expect(pick(both, 'light', 'effect').certain).toBe(false)
    expect(pick(both, 'light', 'spell', 'silver')).toEqual({ rarity: 'Common', certain: false })
    // Neither should read dark on a spell: something is off, so don't guess.
    expect(pick(both, 'dark', 'spell')).toEqual({ rarity: 'Common', certain: false })
  })

  it('takes a dark name on a white-name frame for gold only when it is gold-coloured', () => {
    // Old prints have black names on spells: a dark, uncoloured name proves nothing.
    expect(pick(['Common', 'Ultra Rare'], 'dark', 'spell')).toEqual({
      rarity: 'Common',
      certain: false
    })
    expect(pick(['Super Rare', 'Ultra Rare'], 'dark', 'xyz', 'gold')).toEqual({
      rarity: 'Ultra Rare',
      certain: true
    })
    expect(pick(['Super Rare', 'Ultra Rare'], 'dark', 'effect', 'gold').certain).toBe(false)
  })

  it('never chooses between rarities that look alike', () => {
    expect(pick(['Common', 'Super Rare'], 'dark', 'effect').certain).toBe(false)
    expect(pick(['Common', 'Short Print'], 'light', 'spell').certain).toBe(false)
    expect(pick(['Secret Rare', 'Starlight Rare'], 'light', 'effect', 'silver').certain).toBe(false)
    expect(
      pick(['Platinum Secret Rare', 'Quarter Century Secret Rare'], 'light', 'xyz', 'silver')
        .certain
    ).toBe(false)
    // A variant looks like its base.
    expect(pick(['Ultra Rare', 'Ultra Rare (Overframe)'], 'dark', 'spell', 'gold').certain).toBe(
      false
    )
    expect(pick(['Ultra Rare (Overframe)', 'Starlight Rare'], 'dark', 'effect', 'gold')).toEqual({
      rarity: 'Ultra Rare (Overframe)',
      certain: true
    })
  })

  it("declines when a candidate's look is unknown", () => {
    expect(pick(['Ultra Rare', 'Ultimate Rare'], 'dark', 'spell', 'gold').certain).toBe(false)
    expect(pick(['Rare', 'Secret Rare'], 'light', 'effect', 'silver').certain).toBe(false)
    expect(pick(['Common', 'Starfoil Rare'], 'dark', 'effect').certain).toBe(false)
    expect(pick(["Collector's Rare", 'Common'], 'dark', 'effect').certain).toBe(false)
  })

  it('declines without a reading or a known frame', () => {
    expect(pick(['Common', 'Secret Rare'], null, 'effect')).toEqual({
      rarity: 'Common',
      certain: false
    })
    expect(pick(['Common', 'Secret Rare'], 'dark', 'skill').certain).toBe(false)
  })

  it('is certain of a lone rarity', () => {
    expect(pick(['Ultimate Rare', 'Ultimate Rare'], null, 'effect')).toEqual({
      rarity: 'Ultimate Rare',
      certain: true
    })
  })
})

// Frame readings well inside each side of the surface thresholds.
const PLAIN_FRAME: SurfaceReading = {
  frameFloor: 0.25,
  frameCoarse: 1,
  textEdges: 40,
  textFine: 10
}
const FOIL_FRAME: SurfaceReading = { frameFloor: 6, frameCoarse: 15, textEdges: 10, textFine: 3 }
const UNCLEAR_FRAME: SurfaceReading = { frameFloor: 1, frameCoarse: 4, textEdges: 12, textFine: 3 }

describe('pickRarityByCues with the frame', () => {
  const look = (
    available: string[],
    nameInk: NameInk | null,
    frameType: string,
    nameTint: NameTint | null,
    surface: SurfaceReading | null
  ): ReturnType<typeof pickRarityByCues> =>
    pickRarityByCues(available, { nameInk, nameTint, surface }, frameType)

  it('has readings on each side of the thresholds', () => {
    expect(surfaceLook(PLAIN_FRAME, 'effect')).toBe('plain')
    expect(surfaceLook(FOIL_FRAME, 'effect')).toBe('foil')
    expect(surfaceLook(UNCLEAR_FRAME, 'effect')).toBeNull()
  })

  it('tells Starlight from Secret by the frame', () => {
    const both = ['Secret Rare', 'Starlight Rare']
    expect(look(both, 'light', 'effect', 'silver', FOIL_FRAME)).toEqual({
      rarity: 'Starlight Rare',
      certain: true
    })
    expect(look(both, 'light', 'effect', 'silver', PLAIN_FRAME)).toEqual({
      rarity: 'Secret Rare',
      certain: true
    })
    expect(look(both, 'light', 'effect', 'silver', UNCLEAR_FRAME).certain).toBe(false)
    expect(look(both, 'light', 'effect', 'silver', null).certain).toBe(false)
    const qcs = ['Quarter Century Secret Rare', 'Ultra Rare']
    expect(look(qcs, 'light', 'spell', 'silver', FOIL_FRAME).rarity).toBe(
      'Quarter Century Secret Rare'
    )
  })

  it('takes a plain frame and a dark name for Ultra over Starlight', () => {
    const both = ['Ultra Rare', 'Starlight Rare']
    expect(look(both, 'dark', 'effect', null, PLAIN_FRAME)).toEqual({
      rarity: 'Ultra Rare',
      certain: true
    })
    // Without the frame, a dark name rules Starlight out but doesn't show gold.
    expect(look(both, 'dark', 'effect', null, null).certain).toBe(false)
  })

  it('reads the frame only when the name was read too', () => {
    const both = ['Secret Rare', 'Starlight Rare']
    expect(look(both, null, 'effect', null, FOIL_FRAME).certain).toBe(false)
  })

  it('ignores the frame where artwork covers it', () => {
    const both = ['Secret Rare', 'Starlight Rare']
    expect(look(both, 'light', 'effect_pendulum', 'silver', FOIL_FRAME).certain).toBe(false)
    const overframe = ['Ultra Rare (Overframe)', 'Secret Rare', 'Starlight Rare']
    expect(look(overframe, 'light', 'effect', 'silver', FOIL_FRAME).certain).toBe(false)
  })

  it("doesn't rule out rarities whose frame has no known look", () => {
    const both = ['Platinum Secret Rare', 'Starlight Rare']
    expect(look(both, 'light', 'effect', 'silver', FOIL_FRAME).certain).toBe(false)
    // A plain frame still rules Starlight out.
    expect(look(both, 'light', 'effect', 'silver', PLAIN_FRAME).rarity).toBe('Platinum Secret Rare')
  })
})

describe('pickRarityByCues by the name alone', () => {
  it('rules smooth Ultra gold out by a light silver name where plain names are black', () => {
    expect(pick(['Ultra Rare', 'Starlight Rare'], 'light', 'effect', 'silver')).toEqual({
      rarity: 'Starlight Rare',
      certain: true
    })
    // Premium Gold's glittery gold can read silver; on a white-name frame so can plain ink.
    expect(pick(['Premium Gold Rare', 'Secret Rare'], 'light', 'effect', 'silver').certain).toBe(
      false
    )
    expect(pick(['Ultra Rare', 'Starlight Rare'], 'light', 'spell', 'silver').certain).toBe(false)
  })

  it('takes a dark name on an Xyz or Link frame for gold', () => {
    for (const frame of ['xyz', 'link'])
      expect(pick(['Super Rare', 'Ultra Rare'], 'dark', frame)).toEqual({
        rarity: 'Ultra Rare',
        certain: true
      })
    // Not on a spell: old prints have black names there.
    expect(pick(['Super Rare', 'Ultra Rare'], 'dark', 'spell').certain).toBe(false)
  })

  it("doesn't rule prismatic out by a dark name on a pale bar", () => {
    expect(pick(['Common', 'Secret Rare'], 'dark', 'synchro').certain).toBe(false)
    expect(pick(['Common', 'Secret Rare'], 'dark', 'normal').certain).toBe(false)
    expect(pick(['Common', 'Secret Rare'], 'dark', 'effect')).toEqual({
      rarity: 'Common',
      certain: true
    })
  })
})

describe('cuesOver', () => {
  const c = (nameInk: NameInk | null, nameTint: NameTint | null = null): RarityCues => ({
    nameInk,
    nameTint
  })
  const none = { nameInk: null, nameTint: null, surface: null }
  const out = (nameInk: NameInk | null, nameTint: NameTint | null = null): RarityCues => ({
    ...c(nameInk, nameTint),
    surface: null
  })

  it('needs enough frames that agree on the ink', () => {
    expect(cuesOver([])).toEqual(none)
    expect(cuesOver([c('dark')])).toEqual(none)
    expect(cuesOver([c(null), c(null), c('dark')])).toEqual(none)
    expect(cuesOver([c('dark'), c(null), c('dark')])).toEqual(out('dark'))
    expect(cuesOver([c('light'), c('dark')])).toEqual(none)
    expect(cuesOver([c('light'), c('light'), c('light'), c('light'), c('dark')])).toEqual(
      out('light')
    )
    expect(cuesOver([c('light'), c('light'), c('light'), c('dark')])).toEqual(none)
  })

  it('takes the median surface once enough frames measured one', () => {
    const at = (frameFloor: number): RarityCues => ({
      ...c('light', 'silver'),
      surface: { frameFloor, frameCoarse: 1, textEdges: 20, textFine: 5 }
    })
    expect(cuesOver([at(1)]).surface).toBeNull()
    expect(cuesOver([at(1), c('light', 'silver'), at(5), at(2)]).surface?.frameFloor).toBe(2)
    // The surface counts even when the name never read.
    expect(
      cuesOver([
        { ...at(1), nameInk: null },
        { ...at(3), nameInk: null }
      ])
    ).toEqual({
      nameInk: null,
      nameTint: null,
      surface: { frameFloor: 2, frameCoarse: 1, textEdges: 20, textFine: 5 }
    })
  })

  it('keeps a tint only when the frames that agree on the ink agree on it too', () => {
    expect(cuesOver([c('light', 'silver'), c('light', 'silver')])).toEqual(out('light', 'silver'))
    expect(cuesOver([c('light', 'silver'), c('light')])).toEqual(out('light'))
    expect(cuesOver([c('dark', 'gold'), c('dark', 'gold'), c('light', 'silver')])).toEqual(none)
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
const GOLD: Rgb = [110, 85, 20]
const BRIGHT_GOLD: Rgb = [250, 215, 110]
const DARK_BAR: Rgb = [60, 55, 50]
const PALE_BAR: Rgb = [235, 235, 238]
const NOTHING = { nameInk: null, nameTint: null }
/** The name part of a reading. */
const name = (cues: RarityCues): Pick<RarityCues, 'nameInk' | 'nameTint'> => ({
  nameInk: cues.nameInk,
  nameTint: cues.nameTint
})
const RAINBOW: Rgb[] = [
  [250, 210, 220],
  [220, 250, 215],
  [215, 225, 255],
  [255, 245, 200]
]

describe('rarityCues', () => {
  it('reads plain black and white names', () => {
    expect(name(rarityCues(card(ORANGE, () => BLACK)))).toEqual({ nameInk: 'dark', nameTint: null })
    expect(rarityCues(card(TEAL, () => WHITE)).nameInk).toBe('light')
  })

  it('reads a dim gold name that takes the bar colour as dark but not gold', () => {
    expect(name(rarityCues(card(TEAL, () => DIM_GOLD)))).toEqual({
      nameInk: 'dark',
      nameTint: null
    })
  })

  it('reads a gold-coloured name as gold', () => {
    expect(name(rarityCues(card(TEAL, () => GOLD)))).toEqual({ nameInk: 'dark', nameTint: 'gold' })
  })

  it('reads silver and rainbow names on a monster as light silver', () => {
    const silver = { nameInk: 'light', nameTint: 'silver' }
    expect(name(rarityCues(card(ORANGE, () => [225, 225, 230])))).toEqual(silver)
    expect(name(rarityCues(card(ORANGE, (i) => RAINBOW[i % RAINBOW.length])))).toEqual(silver)
  })

  it('declines gold against prismatic for glare on gold and for silver reading dark', () => {
    const both = ['Ultra Rare', 'Starlight Rare']
    const glare = rarityCues(card(DARK_BAR, () => BRIGHT_GOLD))
    expect(name(glare)).toEqual({ nameInk: 'light', nameTint: 'gold' })
    expect(pickRarityByCues(both, glare, 'effect').certain).toBe(false)
    const silverDark = rarityCues(card(PALE_BAR, () => [150, 150, 155]))
    expect(name(silverDark)).toEqual({ nameInk: 'dark', nameTint: null })
    expect(pickRarityByCues(both, silverDark, 'synchro').certain).toBe(false)
  })

  it('declines a dark, uncoloured name on a spell between Common and Ultra', () => {
    const oldPrint = rarityCues(card(TEAL, () => BLACK))
    expect(oldPrint.nameInk).toBe('dark')
    expect(pickRarityByCues(['Common', 'Ultra Rare'], oldPrint, 'spell').certain).toBe(false)
  })

  it('reads nothing when dark and light ink read about as much text, as in a blurred frame', () => {
    expect(name(rarityCues(card([130, 130, 130], (i) => (i % 2 ? BLACK : WHITE))))).toEqual(NOTHING)
  })

  it('reads nothing from a blank bar, a stray mark or text that is not where a name starts', () => {
    expect(name(rarityCues(card(ORANGE, () => null)))).toEqual(NOTHING)
    expect(name(rarityCues(card(ORANGE, (i) => (i < 2 ? BLACK : null))))).toEqual(NOTHING)
    expect(name(rarityCues(card(ORANGE, () => BLACK, { from: 0.5 })))).toEqual(NOTHING)
  })
})
