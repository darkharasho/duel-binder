// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { GAMES } from '../../src/shared/games'
import { GAME_IDS } from '../../src/shared/games/types'
import { SCAN_PROFILES, scanProfile, type Box } from '../../src/shared/scan/profiles'
import {
  ART_BOXES,
  CODE_BANDS,
  NAME_BAND,
  TEXT_BOX
} from '../../src/renderer/src/features/scan/vision/regions'

const inside = (b: Box, reach = 0): boolean =>
  b.every((v) => v >= -reach && v <= 1 + reach) && b[0] < b[2] && b[1] < b[3]

describe('scan profiles', () => {
  it("ygo profile equals today's constants", () => {
    const ygo = scanProfile('ygo')
    expect(ygo.game).toBe('ygo')
    expect(ygo.artBoxes).toEqual(Object.values(ART_BOXES))
    expect(ygo.windows).toEqual(Object.values(ART_BOXES))
    expect(ygo.windowArt).toBe(false)
    expect(ygo.codeBands).toEqual(CODE_BANDS)
    expect(ygo.nameBand).toEqual(NAME_BAND)
    expect(ygo.textBox).toEqual(TEXT_BOX)
    expect(ygo.rarityLook).toBe(true)
  })

  it('a game with no profile throws', () => {
    expect(() => scanProfile('mtg' as never)).toThrow('No scan profile for mtg')
  })

  it('every scanning game has a profile of boxes on the card', () => {
    for (const game of GAME_IDS.filter((g) => GAMES[g].features.scan)) {
      const p = scanProfile(game)
      expect(p).toBe(SCAN_PROFILES[game])
      expect(p.game).toBe(game)
      expect(p.artBoxes.length).toBeGreaterThan(0)
      expect(p.codeBands.length).toBeGreaterThan(0)
      for (const b of [...p.artBoxes, p.nameBand, p.textBox]) expect(inside(b)).toBe(true)
      // A code band may reach past the outline by codeReach.
      for (const b of p.codeBands) expect(inside(b, p.codeReach ?? 0)).toBe(true)
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

  describe('op', () => {
    const op = (): ReturnType<typeof scanProfile> => scanProfile('op')
    // The printed number's box on Bandai's renders (en.onepiece-cardgame.com, 600 x 838), as
    // shares of the card: a Leader, Characters, an Event, a Stage, a promo, a premium booster, an
    // alternate art, a manga-style SP and a full-art SEC. The number is right-aligned against the
    // rarity box, so only where it starts depends on its length.
    const NUMBERS: Record<string, Box> = {
      'OP01-001 (Leader)': [0.77, 0.949, 0.873, 0.962],
      'OP01-026 (Event)': [0.77, 0.948, 0.873, 0.962],
      'ST01-017 (Stage)': [0.773, 0.948, 0.868, 0.962],
      'PRB01-001': [0.755, 0.949, 0.873, 0.962],
      'P-001': [0.811, 0.948, 0.873, 0.962],
      'OP07-109 (yellow bar)': [0.77, 0.945, 0.868, 0.958],
      'OP14-108_p3 (SP)': [0.764, 0.946, 0.873, 0.961],
      'EB04-061_p2 (full art)': [0.77, 0.947, 0.873, 0.962]
    }

    it('reads the number bottom right with room for a loose outline', () => {
      const [band] = op().codeBands
      expect(inside(band)).toBe(true)
      for (const [card, n] of Object.entries(NUMBERS)) {
        // Off by a few percent either way, the number is still inside the band.
        expect([card, band[0] <= n[0] - 0.015]).toEqual([card, true])
        expect([card, band[2] >= n[2] + 0.01]).toEqual([card, true])
        expect([card, band[1] <= n[1] - 0.01]).toEqual([card, true])
        expect([card, band[3] >= n[3] + 0.01]).toEqual([card, true])
      }
      // Under the name and the traits bar's text (which ends by 0.935), above the card's edge.
      expect(band[1]).toBeGreaterThanOrEqual(0.93)
      expect(band[3]).toBeLessThanOrEqual(0.985)
    })

    it('reads it too off an outline that stops at the bottom bar, past the outline', () => {
      const [, low] = op().codeBands
      const reach = op().codeReach ?? 0
      // Within the card and the reach around it.
      expect(low.every((v) => v >= -reach && v <= 1 + reach)).toBe(true)
      expect(low[3]).toBeGreaterThan(1)
      // Held by its long sides, a card's outline can lose its bottom strip and end at the bottom
      // bar's top edge (0.93 to 0.95 of the card): the number is then below the outline's end.
      for (const end of [0.93, 0.95])
        for (const [card, n] of Object.entries(NUMBERS)) {
          const [top, bottom] = [n[1] / end, n[3] / end]
          expect([card, end, low[1] <= top - 0.005 && low[3] >= bottom + 0.005]).toEqual([
            card,
            end,
            true
          ])
          expect([card, low[0] <= n[0] - 0.015 && low[2] >= n[2] + 0.01]).toEqual([card, true])
        }
    })

    it('scans, its art box cut above the SAMPLE stamp (0.42 to 0.57 of the height)', () => {
      expect(GAMES.op.features.scan).toBe(true)
      expect(op().game).toBe('op')
      for (const b of [...op().artBoxes, op().nameBand, op().textBox]) expect(inside(b)).toBe(true)
      for (const [, top, , bottom] of op().artBoxes) expect(top < 0.42 && bottom <= 0.42).toBe(true)
    })

    it('needs no fingerprints, foil, holder search or rarity look', () => {
      expect(op()).toMatchObject({
        rarityLook: false,
        foil: null,
        holderSearch: false,
        keepOutline: false,
        windowArt: false,
        windowShape: null,
        innerFrames: []
      })
    })
  })
})
