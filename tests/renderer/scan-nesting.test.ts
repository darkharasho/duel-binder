import { describe, expect, it } from 'vitest'
import { preferOuter } from '@/features/scan/vision/candidates'
import type { Quad } from '@/features/scan/vision/detect'

/** An upright rectangle as a quad, corners clockwise from top left. */
const rect = (x: number, y: number, w: number, h: number): Quad => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h]
]

// A card 590x860 (aspect 0.686) at (100, 100), and its inner frames.
const card = rect(100, 100, 590, 860)
/** Art top to text box bottom: 0.9 of the width, 0.77 of the height (about 1.5x smaller). */
const artAndText = rect(130, 245, 531, 662)
const artBox = rect(160, 245, 470, 470)

describe('preferOuter', () => {
  it('takes the card around an inner frame that ranked first', () => {
    expect(preferOuter([artAndText, rect(400, 50, 300, 437), card])).toEqual(card)
  })

  it('works whichever way the outer quad winds', () => {
    const anticlockwise = [card[0], card[3], card[2], card[1]] as unknown as Quad
    expect(preferOuter([artAndText, anticlockwise])).toEqual(anticlockwise)
  })

  it('keeps the first when the outer one is much bigger, not card-shaped, or not around it', () => {
    // The art box is square-ish, the card about 2.4x its area: too big a jump.
    expect(preferOuter([artBox, card])).toEqual(artBox)
    // Around it, but square.
    expect(preferOuter([artAndText, rect(100, 200, 760, 760)])).toEqual(artAndText)
    // Card-shaped and close in size, but beside it.
    expect(preferOuter([artAndText, rect(700, 100, 590, 860)])).toEqual(artAndText)
  })

  it('keeps the card when the outer one is only its sleeve', () => {
    // A sleeve: about 4.5% bigger per side and a little squarer (aspect 0.725), 1.18x the area.
    const sleeve = rect(65, 75, 659, 909)
    expect(preferOuter([card, sleeve])).toEqual(card)
    // The card around its inner frame still wins over the sleeve around that.
    expect(preferOuter([artAndText, card, sleeve])).toEqual(card)
  })

  it('takes the card around a frame that starts well below its top, though not much smaller', () => {
    // From the type line down, 0.84 of the card's area: too little growth alone.
    const belowName = rect(100, 238, 590, 722)
    expect(preferOuter([belowName, card])).toEqual(card)
    // Upside down, the inset is at the other end.
    expect(preferOuter([rect(100, 100, 590, 722), card])).toEqual(card)
  })

  it('allows corners just outside the outer one', () => {
    const tilted: Quad = [
      [101, 104],
      [690, 100],
      [690, 960],
      [100, 960]
    ]
    const nearlyInside = rect(98, 245, 531, 662)
    expect(preferOuter([nearlyInside, tilted])).toEqual(tilted)
  })

  it('is null without candidates and keeps a lone one', () => {
    expect(preferOuter([])).toBeNull()
    expect(preferOuter([card])).toEqual(card)
  })
})
