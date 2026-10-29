// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { scanProfile } from '../../src/shared/scan/profiles'
import {
  VERSION_ART_FOIL_MIN,
  VERSION_ART_PLAIN_MAX,
  VERSION_FRAME_FOIL_MIN,
  VERSION_FRAME_PLAIN_MAX
} from '../../src/shared/scan/thresholds'
import type { RgbaImage } from '../../src/shared/scan/types'
import {
  pokemonVersion,
  pokemonVersionCues,
  type VersionCues
} from '../../src/renderer/src/features/scan/vision/pokemonVersion'

const cues = (frame: number, art: number): VersionCues => ({ frame, art, firstEdition: 'unknown' })
const FRAME_HIGH = VERSION_FRAME_FOIL_MIN * 2
const FRAME_LOW = VERSION_FRAME_PLAIN_MAX / 2
const ART_HIGH = VERSION_ART_FOIL_MIN * 2
const ART_LOW = VERSION_ART_PLAIN_MAX / 2

describe('pokemonVersion', () => {
  it('frame foil picks Reverse Holofoil', () => {
    expect(pokemonVersion(cues(FRAME_HIGH, ART_LOW), ['Normal', 'Reverse Holofoil'])).toBe(
      'Reverse Holofoil'
    )
  })

  it('art foil picks Holofoil', () => {
    expect(pokemonVersion(cues(FRAME_LOW, ART_HIGH), ['Normal', 'Holofoil'])).toBe('Holofoil')
  })

  it('ambiguous cues give null', () => {
    const both = ['Normal', 'Holofoil', 'Reverse Holofoil']
    expect(pokemonVersion(cues(FRAME_HIGH, ART_HIGH), both)).toBeNull()
    expect(pokemonVersion(cues(FRAME_LOW, ART_LOW), both)).toBeNull()
    expect(pokemonVersion(cues(VERSION_FRAME_FOIL_MIN * 0.8, ART_LOW), both)).toBeNull()
    expect(pokemonVersion(null, both)).toBeNull()
  })

  it('label not in options gives null', () => {
    expect(pokemonVersion(cues(FRAME_HIGH, ART_LOW), ['Normal', 'Holofoil'])).toBeNull()
    expect(pokemonVersion(cues(FRAME_LOW, ART_HIGH), ['Normal', 'Reverse Holofoil'])).toBeNull()
  })

  it('never names a version that has a 1st Edition twin, as the stamp is not read', () => {
    expect(
      pokemonVersion(cues(FRAME_LOW, ART_HIGH), ['Holofoil', '1st Edition Holofoil'])
    ).toBeNull()
  })
})

/** A card of mid-grey, with deterministic sparkle noise painted over each box in sparkle. */
function card(sparkle: readonly (readonly [number, number, number, number])[]): RgbaImage {
  const width = 842
  const height = 1228
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set([120, 120, 120, 255], i)
  let seed = 7
  const rand = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (const [x0, y0, x1, y1] of sparkle)
    for (let y = Math.round(y0 * height); y < Math.round(y1 * height); y++)
      for (let x = Math.round(x0 * width); x < Math.round(x1 * width); x++) {
        const v = 120 + (rand() - 0.5) * 140
        data.set([v, v, v], (y * width + x) * 4)
      }
  return { width, height, data }
}

describe('pokemonVersionCues', () => {
  const profile = scanProfile('pkm')
  const { frame, art } = profile.foil!

  it('sparkle on the frame only reads as frame foil, and picks Reverse Holofoil', () => {
    const c = pokemonVersionCues(card(frame), profile)!
    expect(c.frame).toBeGreaterThan(c.art)
    expect(c.frame).toBeGreaterThanOrEqual(VERSION_FRAME_FOIL_MIN)
    expect(pokemonVersion(c, ['Normal', 'Reverse Holofoil'])).toBe('Reverse Holofoil')
  })

  it('sparkle on the art only reads as art foil, and picks Holofoil', () => {
    const c = pokemonVersionCues(card([art]), profile)!
    expect(c.art).toBeGreaterThan(c.frame)
    expect(pokemonVersion(c, ['Normal', 'Holofoil'])).toBe('Holofoil')
  })

  it('a plain card names nothing, and the stamp is not read', () => {
    const c = pokemonVersionCues(card([]), profile)!
    expect(c.firstEdition).toBe('unknown')
    expect(pokemonVersion(c, ['Normal', 'Holofoil', 'Reverse Holofoil'])).toBeNull()
  })

  it('a game with no foil boxes has no cues', () => {
    expect(pokemonVersionCues(card([]), scanProfile('ygo'))).toBeNull()
  })
})
