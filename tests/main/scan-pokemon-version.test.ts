// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { scanProfile } from '../../src/shared/scan/profiles'
import {
  VERSION_ART_FOIL_MIN,
  VERSION_FRAME_FOIL_MIN,
  VERSION_FRAME_PLAIN_MAX
} from '../../src/shared/scan/thresholds'
import type { RgbaImage } from '../../src/shared/scan/types'
import {
  pokemonVersion,
  pokemonVersionCues,
  type VersionCues
} from '../../src/renderer/src/features/scan/vision/pokemonVersion'

const cues = (frame: number, art: number, reference = 0): VersionCues => ({
  frame,
  art,
  reference,
  firstEdition: 'unknown'
})
const FRAME_HIGH = VERSION_FRAME_FOIL_MIN * 2
const FRAME_LOW = VERSION_FRAME_PLAIN_MAX / 2
const ART_HIGH = VERSION_ART_FOIL_MIN * 2
const ART_LOW = 0

describe('pokemonVersion', () => {
  it('frame foil never names Reverse Holofoil', () => {
    // On real photos a Normal card's frame reads as foil as often as a reverse holo's does (an
    // eBay Pawniard, Normal, was named Reverse Holofoil), so its price is left a range.
    expect(pokemonVersion(cues(FRAME_HIGH, ART_LOW), ['Normal', 'Reverse Holofoil'])).toBeNull()
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

  it('never names a version with a stamped twin, as the stamp is not read', () => {
    const art = cues(FRAME_LOW, ART_HIGH)
    const frame = cues(FRAME_HIGH, ART_LOW)
    expect(pokemonVersion(art, ['Holofoil', '1st Edition Holofoil'])).toBeNull()
    expect(pokemonVersion(art, ['Holofoil', 'Pokémon Center Stamp Holofoil'])).toBeNull()
    expect(pokemonVersion(frame, ['Reverse Holofoil', '1st Edition Reverse Holofoil'])).toBeNull()
  })

  it("a foil no more than the card's own text box is noise or detail, not foil", () => {
    const both = ['Normal', 'Holofoil', 'Reverse Holofoil']
    expect(pokemonVersion(cues(FRAME_HIGH, ART_LOW, FRAME_HIGH), both)).toBeNull()
    expect(pokemonVersion(cues(FRAME_LOW, ART_HIGH, ART_HIGH), both)).toBeNull()
  })

  it('a frame not well over the art is not reverse foil', () => {
    expect(
      pokemonVersion(cues(FRAME_HIGH, FRAME_HIGH * 0.8), ['Normal', 'Reverse Holofoil'])
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

  it('sparkle on the frame only reads as frame foil, and names no version', () => {
    const c = pokemonVersionCues(card(frame), profile)!
    expect(c.frame).toBeGreaterThan(c.art)
    expect(c.frame).toBeGreaterThanOrEqual(VERSION_FRAME_FOIL_MIN)
    expect(pokemonVersion(c, ['Normal', 'Reverse Holofoil'])).toBeNull()
  })

  it('sparkle on the art only reads as art foil, and picks Holofoil', () => {
    const c = pokemonVersionCues(card([art]), profile)!
    expect(c.art).toBeGreaterThan(c.frame)
    expect(pokemonVersion(c, ['Normal', 'Holofoil'])).toBe('Holofoil')
  })

  it('detailed art on a plain frame, with an equally detailed text box, names nothing', () => {
    const c = pokemonVersionCues(card([art, profile.foil!.reference]), profile)!
    expect(pokemonVersion(c, ['Normal', 'Holofoil', 'Reverse Holofoil'])).toBeNull()
  })

  it('noise all over the card names nothing', () => {
    const c = pokemonVersionCues(card([[0, 0, 1, 1]]), profile)!
    expect(pokemonVersion(c, ['Normal', 'Holofoil', 'Reverse Holofoil'])).toBeNull()
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
