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

  it("pkm doesn't run the Yu-Gi-Oh rarity look", () => {
    expect(scanProfile('pkm').rarityLook).toBe(false)
  })
})
