import { describe, expect, it, vi } from 'vitest'
import { resolveSignals, type ResolveContext, type ScanDraft } from '@/features/scan/resolve'
import { finishTwin } from '@/features/scan/resolveMagic'
import type { ArtMatch, RawSignals } from '@/features/scan/engine'
import type { ScanPrinting } from '@shared/scan/types'

// Lightning Strike: English card 1, FRA 107 (look 1001) reprinted with the same look as XYZ 5,
// a borderless FRA 346 (look 1003), and Japanese card 2's FRA 107 borrowing look 1001.
// Goblin Guide FRA 108 (card 3, look 1005). Sheoldred FRA 300, foil only (card 4, look 1006).
// Delver ISD 51, two-faced (card 5, front 1007, back 1008). Plains FRA 280, non-foil only (card 6, 1009).
const P = (
  printingId: number,
  cardId: number,
  name: string,
  language: 'en' | 'ja',
  setCode: string,
  rarity: string,
  imageId: number,
  artIds: number[]
): ScanPrinting => ({
  printingId,
  cardId,
  name,
  frameType: 'mtg',
  setName: setCode.startsWith('XYZ') ? 'Xyz' : setCode.startsWith('ISD') ? 'Innistrad' : 'Reality Fracture',
  setCode,
  rarity,
  variant: null,
  language,
  price: null,
  imageIds: [imageId],
  artIds
})
const S = 'Lightning Strike'
const PRINTINGS: ScanPrinting[] = [
  P(101, 1, S, 'en', 'FRA 107', 'Uncommon', 2001, [1001]),
  P(102, 1, S, 'en', 'FRA 107', 'Uncommon (Foil)', 2001, [1001]),
  P(103, 1, S, 'en', 'XYZ 5', 'Uncommon', 2002, [1001]),
  P(104, 1, S, 'en', 'XYZ 5', 'Uncommon (Foil)', 2002, [1001]),
  P(105, 1, S, 'en', 'FRA 346', 'Uncommon', 2003, [1003]),
  P(106, 1, S, 'en', 'FRA 346', 'Uncommon (Foil)', 2003, [1003]),
  P(107, 2, S, 'ja', 'FRA 107', 'Uncommon', 2004, [1001]),
  P(108, 2, S, 'ja', 'FRA 107', 'Uncommon (Foil)', 2004, [1001]),
  P(109, 3, 'Goblin Guide', 'en', 'FRA 108', 'Common', 2005, [1005]),
  P(110, 3, 'Goblin Guide', 'en', 'FRA 108', 'Common (Foil)', 2005, [1005]),
  P(111, 4, 'Sheoldred', 'en', 'FRA 300', 'Mythic (Foil)', 2006, [1006]),
  P(112, 5, 'Delver of Secrets', 'en', 'ISD 51', 'Common', 2007, [1007, 1008]),
  P(113, 6, 'Plains', 'en', 'FRA 280', 'Common', 2009, [1009])
]

const lookups: ResolveContext['lookups'] = {
  printingsByCode: async (code) =>
    PRINTINGS.filter((p) => p.setCode.toUpperCase() === code.toUpperCase()),
  printingsByNumber: async () => [],
  printingsForCards: async (ids) => PRINTINGS.filter((p) => ids.includes(p.cardId)),
  printingsOfArt: async (ids) => PRINTINGS.filter((p) => p.artIds!.some((id) => ids.includes(id))),
  matchName: async () => null,
  cardsForImages: async () => []
}

const raw = (r: Partial<RawSignals>): RawSignals => ({
  found: true,
  quad: null,
  art: [],
  codeTexts: [],
  nameTexts: [],
  textBands: [],
  cues: null,
  look: null,
  ...r
})
const art = (...pairs: [number, number][]): ArtMatch[] =>
  pairs.map(([imageId, distance]) => ({ imageId, distance }))
const ctx = (over: Partial<ResolveContext> = {}): ResolveContext => ({
  game: 'mtg',
  setPrintings: null,
  defaultRarity: null,
  lookups,
  ...over
})

async function recognized(r: RawSignals, c: ResolveContext = ctx()): Promise<ScanDraft> {
  const out = await resolveSignals(r, c)
  if (out.kind !== 'recognized') throw new Error(`expected recognized, got ${out.kind}`)
  return out.item
}

const STRIKE = art([1001, 10], [1005, 70], [1009, 90])
const BORDERLESS = art([1003, 10], [1005, 70], [1009, 90])

describe('resolveMagicSignals', () => {
  it('names the printing when the read and the art agree', async () => {
    const item = await recognized(raw({ art: STRIKE, codeTexts: ['U 0107\nFRA • EN'] }))
    expect(item).toMatchObject({
      game: 'mtg',
      printingId: 101,
      setCode: 'FRA 107',
      rarity: 'Uncommon',
      imageId: 2001,
      flag: null,
      via: 'code'
    })
  })

  it('takes a read one digit off the art as the art', async () => {
    const item = await recognized(raw({ art: STRIKE, codeTexts: ['U 0108\nFRA • EN'] }))
    expect(item).toMatchObject({ printingId: 101, setCode: 'FRA 107', flag: null })
  })

  it('is unsure when the read names another card than confident art', async () => {
    const out = await resolveSignals(raw({ art: STRIKE, codeTexts: ['M 0300\nFRA • EN'] }), ctx())
    expect(out).toEqual({ kind: 'unsure' })
  })

  it('is unsure when the art is a reprint in two sets and nothing else tells them apart', async () => {
    const item = await recognized(raw({ art: STRIKE }))
    expect(item.flag).toBe('pick-printing')
    expect(new Set(item.options.map((o) => o.setCode))).toEqual(new Set(['FRA 107', 'XYZ 5']))
    expect(item.options.every((o) => o.language === 'en')).toBe(true)
  })

  it("takes the picked set among a reprint's sets", async () => {
    const setPrintings = PRINTINGS.filter((p) => p.setCode === 'XYZ 5')
    const item = await recognized(raw({ art: STRIKE }), ctx({ setPrintings }))
    expect(item).toMatchObject({ printingId: 103, setCode: 'XYZ 5', flag: null, via: 'art' })
  })

  it('does not count a reprint of the same card as a rival art', async () => {
    // The borderless look first, the regular one of the same card 10 behind, no other card near.
    const close = await recognized(raw({ art: art([1003, 10], [1001, 20], [1005, 90]) }))
    expect(close.name).toBe(S)
    expect(close.flag).toBe('pick-printing')
    expect(close.options.map((o) => o.setCode)).toContain('FRA 346')
    const apart = await recognized(raw({ art: art([1003, 10], [1001, 60], [1005, 90]) }))
    expect(apart).toMatchObject({ printingId: 105, setCode: 'FRA 346', flag: null })
  })

  it('defaults to non-foil when both finishes exist', async () => {
    expect((await recognized(raw({ art: BORDERLESS }))).printingId).toBe(105)
  })

  it('takes the only finish a printing has', async () => {
    const item = await recognized(raw({ art: art([1006, 10], [1005, 70]) }))
    expect(item).toMatchObject({ printingId: 111, rarity: 'Mythic (Foil)', flag: null })
  })

  it('takes foil under the All foil lock', async () => {
    const item = await recognized(raw({ art: BORDERLESS }), ctx({ finishLock: 'foil' }))
    expect(item).toMatchObject({ printingId: 106, rarity: 'Uncommon (Foil)' })
  })

  it('ignores the lock for a single-finish printing', async () => {
    const item = await recognized(raw({ art: art([1009, 10], [1005, 70]) }), ctx({ finishLock: 'foil' }))
    expect(item).toMatchObject({ printingId: 113, rarity: 'Common' })
    const foilOnly = await recognized(
      raw({ art: art([1006, 10], [1005, 70]) }),
      ctx({ finishLock: 'nonfoil' })
    )
    expect(foilOnly.printingId).toBe(111)
  })

  it('takes the info line language over the filter', async () => {
    const item = await recognized(
      raw({ art: STRIKE, codeTexts: ['U 0107\nFRA • JP'] }),
      ctx({ filterLanguage: 'en' })
    )
    expect(item).toMatchObject({ printingId: 107, flag: null })
  })

  it('names a card back up from its back face', async () => {
    const item = await recognized(raw({ art: art([1008, 12], [1005, 80]) }))
    expect(item).toMatchObject({ printingId: 112, setCode: 'ISD 51', imageId: 2007, flag: null })
  })

  it('names a card from its read alone', async () => {
    const item = await recognized(raw({ codeTexts: ['C 0108\nFRA • EN'] }))
    expect(item).toMatchObject({ printingId: 109, flag: null, via: 'code' })
  })

  it('is none when nothing reads and the closest art is far', async () => {
    expect(await resolveSignals(raw({ art: art([1001, 120]) }), ctx())).toEqual({
      kind: 'none',
      far: true
    })
  })

  it('leaves other games alone', async () => {
    const printingsOfArt = vi.fn(lookups.printingsOfArt!)
    await resolveSignals(raw({ art: STRIKE }), ctx({ game: 'op', lookups: { ...lookups, printingsOfArt } }))
    expect(printingsOfArt).not.toHaveBeenCalled()
  })
})

describe('finishTwin', () => {
  it('is the same printing in the other finish', () => {
    expect(finishTwin(PRINTINGS[0], PRINTINGS)?.printingId).toBe(102)
    expect(finishTwin(PRINTINGS[1], PRINTINGS)?.printingId).toBe(101)
    expect(finishTwin(PRINTINGS[6], PRINTINGS)?.printingId).toBe(108)
  })

  it('is null for a printing with one finish', () => {
    expect(finishTwin(PRINTINGS[10], PRINTINGS)).toBeNull()
    expect(finishTwin(PRINTINGS[12], PRINTINGS)).toBeNull()
  })
})
