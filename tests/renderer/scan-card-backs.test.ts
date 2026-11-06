import { describe, expect, it } from 'vitest'
import { cardBackDistance, hasCardBacks } from '@shared/scan/cardBacks'
import { CARD_BACK_MAX_DISTANCE } from '@shared/scan/thresholds'

// One of the Pokémon card back references, as cardBacks.ts holds it.
const BACK = '0171c683396c98bda736defb9634e8cc1da6a193c419f249ccf3e19e71b3038c'
const hash = (hex: string): Uint32Array =>
  Uint32Array.from({ length: 8 }, (_, i) => parseInt(hex.slice(i * 8, i * 8 + 8), 16))

describe('card backs', () => {
  it('Pokémon has card backs; the other games none yet', () => {
    expect(hasCardBacks('pkm')).toBe(true)
    expect(hasCardBacks('ygo')).toBe(false)
    expect(cardBackDistance('ygo', hash(BACK))).toBeNull()
  })

  it('a back is as close as its bits differ from the nearest reference', () => {
    const h = hash(BACK)
    expect(cardBackDistance('pkm', h)).toBe(0)
    // Ten bits off, as another outline of the same back might be.
    for (let i = 0; i < 10; i++) h[i % 8] ^= 1 << (i * 3)
    expect(cardBackDistance('pkm', h)).toBe(10)
  })

  it('a card that is all one thing or another is no back', () => {
    // Half the bits set, as every art hash has (it splits at the median), but nothing like a back.
    const stripes = new Uint32Array(8).fill(0x0f0f0f0f)
    expect(cardBackDistance('pkm', stripes)).toBeGreaterThan(CARD_BACK_MAX_DISTANCE)
  })
})
