import { describe, expect, it } from 'vitest'
import {
  lookCandidate,
  lookOdds,
  LOOK_FEATURES,
  pickRarityByLook,
  withFrame,
  type LookModel
} from '../../src/shared/scan/look'
import { LOOK_MODEL } from '../../src/shared/scan/lookModel'
import type { RarityCues } from '../../src/shared/scan/rarity'
import type { RgbaImage } from '../../src/shared/scan/types'
import { findTextLine } from '../../src/renderer/src/features/scan/vision/bands'
import { rarityLook } from '../../src/renderer/src/features/scan/vision/rarityCues'
import { TEXT_AREA } from '../../src/renderer/src/features/scan/vision/foil'
import { rarityFeatures } from '../../src/renderer/src/features/scan/vision/rarityFeatures'
import { crop, NAME_BAND } from '../../src/renderer/src/features/scan/vision/regions'

const at = (name: string): number => LOOK_FEATURES.indexOf(name)

/**
 * A model that reads one feature, the art's colour noise: Secret Rare and Starlight rise with it
 * (Starlight faster), Common falls, Ultimate stays.
 */
const MODEL: LookModel = {
  features: LOOK_FEATURES,
  logOffset: LOOK_FEATURES.map(() => 0),
  mean: LOOK_FEATURES.map(() => 0),
  spread: LOOK_FEATURES.map(() => 1),
  classes: [
    'Common',
    "Prismatic Collector's Rare",
    'Prismatic Ultimate Rare',
    'Secret Rare',
    'Starlight Rare',
    'Ultimate Rare'
  ],
  weights: [-4, 0, 0, 4, 6, 0].map((w) =>
    LOOK_FEATURES.map((_, j) => (j === at('art.chromaFine') ? w : 0))
  ),
  bias: [0, 0, 0, 0, -4, 0],
  temperature: 1,
  minProbability: 0.99
}

/** Features of a frame whose art's colour noise is v. */
const frame = (v: number): number[] =>
  LOOK_FEATURES.map((_, j) => (j === at('art.chromaFine') ? v : 0))

const cues = (c: Partial<RarityCues> = {}): RarityCues => ({
  nameInk: 'light',
  nameTint: 'silver',
  nameContrast: -0.2,
  surface: null,
  ...c
})

describe('withFrame', () => {
  it('turns the name the way plain names read on the frame and sets the frame groups', () => {
    const f = LOOK_FEATURES.map(() => 0)
    f[at('name.polarity')] = 1
    f[at('name.contrast')] = 0.3
    const spell = withFrame(f, 'spell')
    expect(spell[at('name.polarity')]).toBe(-1)
    expect(spell[at('name.contrast')]).toBe(-0.3)
    expect(spell[at('frame.whiteName')]).toBe(1)
    expect(spell[at('frame.blackName')]).toBe(0)
    const xyz = withFrame(f, 'xyz_pendulum')
    expect([at('frame.xyz'), at('frame.pendulum')].map((j) => xyz[j])).toEqual([1, 1])
    expect(withFrame(f, 'effect')[at('name.polarity')]).toBe(1)
  })
})

describe('lookOdds', () => {
  const scores = [0, 0, 0, 2, 0, 0]

  it('spreads probability over the card’s own families only', () => {
    const odds = lookOdds(MODEL, scores, ['Common', 'Secret Rare', 'Secret Rare (Alternate Art)'])!
    expect([...odds.keys()]).toEqual(['Common', 'Secret Rare'])
    expect(odds.get('Secret Rare')).toBeCloseTo(Math.exp(2) / (1 + Math.exp(2)))
    // Short Prints look like Commons.
    expect(lookOdds(MODEL, scores, ['Short Print', 'Secret Rare'])!.get('Common')).toBeCloseTo(
      odds.get('Common')!
    )
  })

  it('knows nothing of a rarity it was not fitted on, or of art over the frame', () => {
    expect(lookOdds(MODEL, scores, ['Common', 'Ghost Rare'])).toBeNull()
    expect(lookOdds(MODEL, scores, ['Ultra Rare', 'Ultra Rare (Overframe)'])).toBeNull()
  })

  it('counts the rarities a many-rarity set leaves out of the catalog against the listed ones', () => {
    const ra = ["Collector's Rare", 'Ultimate Rare', 'Platinum Secret Rare', 'Secret Rare']
    const model = {
      ...MODEL,
      classes: [...MODEL.classes, "Collector's Rare", 'Ultimate Rare', 'Platinum Secret Rare']
    }
    const odds = lookOdds(model, [0, 0, 0, 0, 0, 0, 0, 0, 0], ra)!
    // Six equal scores, four of them listed.
    expect(odds.get('Secret Rare')).toBeCloseTo(1 / 6)
  })
})

describe('pickRarityByLook', () => {
  // A light silver name fits Secret; Ultimate has no known name look, so the rules can't decide.
  const options = ['Secret Rare', 'Ultimate Rare']

  it('picks what the model is sure of when the name fits it', () => {
    expect(pickRarityByLook(MODEL, options, cues(), [frame(2)], 'effect')).toEqual({
      rarity: 'Secret Rare',
      certain: true
    })
    // Not sure enough.
    expect(pickRarityByLook(MODEL, options, cues(), [frame(0.3)], 'effect').certain).toBe(false)
  })

  it('averages the log-odds of the frames of a showing', () => {
    expect(
      lookCandidate(MODEL, options, cues(), [frame(2), frame(0)], 'effect')!.probability
    ).toBeCloseTo(1 / (1 + Math.exp(-4)))
  })

  it('leaves the rules first and never picks against them or without them', () => {
    // A light silver name on an effect frame: the rules take it for Secret themselves.
    expect(pickRarityByLook(MODEL, ['Common', 'Secret Rare'], cues(), [], 'effect')).toEqual({
      rarity: 'Secret Rare',
      certain: true
    })
    // The model is sure of Secret but the name wasn't read: nothing positively fits it.
    const unread = cues({ nameInk: null, nameTint: null, nameContrast: null })
    expect(pickRarityByLook(MODEL, options, unread, [frame(3)], 'effect').certain).toBe(false)
    // Dark black ink rules Secret out, so the model can't pick it.
    const black = cues({ nameInk: 'dark', nameTint: null, nameContrast: 0.3 })
    expect(
      pickRarityByLook(MODEL, ['Secret Rare', 'Starlight Rare'], black, [frame(3)], 'effect')
        .certain
    ).toBe(false)
  })

  it('reads whole-card foils on Link and Xyz frames as the rules do', () => {
    const starlight = ['Secret Rare', 'Starlight Rare']
    // Sure of Starlight, but a Link frame's pattern reads as glitter.
    expect(lookCandidate(MODEL, starlight, cues(), [frame(5)], 'link')!).toMatchObject({
      family: 'Starlight Rare',
      allowed: false
    })
    expect(lookCandidate(MODEL, starlight, cues(), [frame(5)], 'effect')!.allowed).toBe(true)
  })
})

describe('the fitted model', () => {
  it('has a weight per feature and class', () => {
    expect(LOOK_MODEL.features).toEqual(LOOK_FEATURES)
    expect(LOOK_MODEL.weights).toHaveLength(LOOK_MODEL.classes.length)
    for (const w of LOOK_MODEL.weights) expect(w).toHaveLength(LOOK_FEATURES.length)
    expect(LOOK_MODEL.minProbability).toBeGreaterThanOrEqual(0.9)
  })
})

// A synthetic straightened card: an orange frame, a cream text box and a black name.
const W = 842
const H = 1228

function card(cast: readonly [number, number, number] = [1, 1, 1]): RgbaImage {
  const data = new Uint8ClampedArray(W * H * 4)
  const inside = (x: number, y: number, [x0, y0, x1, y1]: readonly number[]): boolean =>
    x >= x0 * W && x < x1 * W && y >= y0 * H && y < y1 * H
  const [bx0, by0, bx1, by1] = NAME_BAND.map((v, i) => Math.round(v * (i % 2 ? H : W)))
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let rgb = [190, 110, 60]
      if (inside(x, y, TEXT_AREA))
        rgb = (x >> 3) % 4 === 0 && (y >> 2) % 3 === 0 ? [30, 30, 30] : [235, 225, 200]
      // Letter-like strokes in the name band.
      const top = by0 + Math.round((by1 - by0) * 0.22)
      const bottom = by1 - Math.round((by1 - by0) * 0.22)
      if (x > bx0 + 6 && x < bx1 - 60 && y >= top && y < bottom) {
        const dx = (x - bx0 - 6) % 28
        if (dx < 5 || (dx < 20 && y >= bottom - 5)) rgb = [25, 20, 20]
      }
      const p = (y * W + x) * 4
      for (let c = 0; c < 3; c++) data[p + c] = rgb[c] * cast[c]
      data[p + 3] = 255
    }
  return { width: W, height: H, data }
}

describe('rarityFeatures', () => {
  const measure = (img: RgbaImage): number[] => {
    const line = findTextLine(img, NAME_BAND, 1)
    return rarityFeatures(img, line, crop(img, NAME_BAND))
  }

  it('measures every feature', () => {
    const f = measure(card())
    expect(f).toHaveLength(LOOK_FEATURES.length)
    expect(f.every(Number.isFinite)).toBe(true)
    expect(f[at('name.read')]).toBe(1)
    expect(f[at('name.polarity')]).toBe(1)
    expect(f[at('name.contrast')]).toBeGreaterThan(0.2)
  })

  it('reads colour against the effect text’s paper, so a blue cast barely moves it', () => {
    const plain = measure(card())
    const blue = measure(card([0.8, 0.9, 1]))
    for (const name of ['frame.a', 'frame.b', 'frame.sat', 'art.l', 'name.barSat'])
      expect(Math.abs(blue[at(name)] - plain[at(name)])).toBeLessThan(0.03)
  })
})

describe('the fitted model on the phone path', () => {
  // The synthetic card is plain card stock with black ink: whatever its code's other rarity, the
  // rules then the shipped model (as the phone scanner runs them) take it for Common or abstain.
  const FOILS = [
    'Super Rare',
    'Ultra Rare',
    'Secret Rare',
    'Starlight Rare',
    'Quarter Century Secret Rare',
    "Collector's Rare"
  ]

  it('never picks a foil for a plain card, under a blue cast or not, on one frame or several', () => {
    for (const img of [card(), card([0.8, 0.9, 1])]) {
      const { cues: c, features } = rarityLook(img, true)
      expect(features).toHaveLength(LOOK_FEATURES.length)
      for (const frameType of ['effect', 'normal'])
        for (const foil of FOILS)
          for (const frames of [[features!], [features!, features!, features!]]) {
            const pick = pickRarityByLook(LOOK_MODEL, ['Common', foil], c, frames, frameType)
            if (pick.certain) expect(pick.rarity).toBe('Common')
          }
    }
  })
})
