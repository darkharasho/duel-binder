// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { GAME_IDS } from '../../src/shared/games/types'
import { SCAN_PROFILES, scanProfile, type Box } from '../../src/shared/scan/profiles'
import {
  ART_BOXES,
  CODE_BANDS,
  NAME_BAND,
  TEXT_BOX
} from '../../src/renderer/src/features/scan/vision/regions'

const inside = (b: Box): boolean => b.every((v) => v >= 0 && v <= 1) && b[0] < b[2] && b[1] < b[3]

describe('scan profiles', () => {
  it("ygo profile equals today's constants", () => {
    const ygo = scanProfile('ygo')
    expect(ygo.game).toBe('ygo')
    expect(ygo.artBoxes).toEqual(Object.values(ART_BOXES))
    expect(ygo.windows).toEqual(Object.values(ART_BOXES))
    expect(ygo.codeBands).toEqual(CODE_BANDS)
    expect(ygo.nameBand).toEqual(NAME_BAND)
    expect(ygo.textBox).toEqual(TEXT_BOX)
    expect(ygo.rarityLook).toBe(true)
  })

  it('every game has a profile of boxes on the card', () => {
    for (const game of GAME_IDS) {
      const p = scanProfile(game)
      expect(p).toBe(SCAN_PROFILES[game])
      expect(p.game).toBe(game)
      expect(p.artBoxes.length).toBeGreaterThan(0)
      expect(p.codeBands.length).toBeGreaterThan(0)
      for (const b of [...p.artBoxes, ...p.codeBands, p.nameBand, p.textBox])
        expect(inside(b)).toBe(true)
    }
  })

  it("pkm outlines are scored by Pokémon art windows, each round the art box's middle", () => {
    const pkm = scanProfile('pkm')
    const [art] = pkm.artBoxes
    expect(pkm.windows.length).toBeGreaterThan(0)
    for (const w of pkm.windows) {
      expect(inside(w)).toBe(true)
      // Yu-Gi-Oh's window runs to 0.72, into a Pokémon card's attacks.
      expect(w[3]).toBeLessThan(0.6)
      expect(w[0] < art[0] + 0.05 && w[2] > art[2] - 0.05).toBe(true)
      expect(w[1] < (art[1] + art[3]) / 2 && w[3] > (art[1] + art[3]) / 2).toBe(true)
    }
  })

  it("pkm doesn't run the Yu-Gi-Oh rarity look", () => {
    expect(scanProfile('pkm').rarityLook).toBe(false)
  })
})
