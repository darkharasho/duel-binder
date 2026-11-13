import { describe, expect, it, vi } from 'vitest'
import { resolveSignals, type ResolveContext, type ScanDraft } from '@/features/scan/resolve'
import type { ArtMatch, RawSignals } from '@/features/scan/engine'
import type { ScanPrinting } from '@shared/scan/types'
import { OP_ART_MIN_MARGIN, OP_SAME_ART } from '@shared/scan/thresholds'

// Shanks OP01-120: English card 1 (base 101, alternate art 102, a PRB-01 reprint 103 of the base's
// art), Japanese card 2 (base 201, its art the same as 101's). Kaido OP04-044: English card 3 (301).
const base = { frameType: 'op', price: null, variant: null }
const P = (
  printingId: number,
  cardId: number,
  language: 'en' | 'ja',
  setCode: string,
  setName: string,
  rarity: string,
  imageId: number
): ScanPrinting => ({
  ...base,
  printingId,
  cardId,
  name: cardId === 3 ? 'Kaido' : 'Shanks',
  language,
  setCode,
  setName,
  rarity,
  imageIds: [imageId]
})
const OP01 = 'ROMANCE DAWN [OP-01]'
const PRB01 = 'ONE PIECE CARD THE BEST [PRB-01]'
const PRINTINGS: ScanPrinting[] = [
  P(11, 1, 'en', 'OP01-120', OP01, 'SEC', 101),
  P(12, 1, 'en', 'OP01-120', OP01, 'SEC (Alternate Art)', 102),
  P(13, 1, 'en', 'OP01-120', PRB01, 'SEC', 103),
  P(21, 2, 'ja', 'OP01-120', 'ROMANCE DAWN [OP-01]', 'SEC', 201),
  P(31, 3, 'en', 'OP04-044', 'KINGDOMS OF INTRIGUE [OP-04]', 'SR', 301)
]

const lookups: ResolveContext['lookups'] = {
  printingsByCode: async (code) =>
    PRINTINGS.filter((p) => p.setCode.toUpperCase() === code.toUpperCase()),
  printingsByNumber: async () => [],
  printingsForCards: async (ids) => PRINTINGS.filter((p) => ids.includes(p.cardId)),
  matchName: async () => null,
  cardsForImages: async (ids) =>
    PRINTINGS.flatMap((p) =>
      p.imageIds.filter((i) => ids.includes(i)).map((imageId) => ({ imageId, cardId: p.cardId }))
    )
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
  game: 'op',
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

// The base, its PRB-01 reprint and its Japanese twin share art; the alternate art is far off.
const BASE_ART = art([101, 8], [201, 9], [103, 12], [102, 70], [301, 90])
const ALT_ART = art([102, 6], [101, 80], [201, 81], [103, 82], [301, 95])

describe('resolveOnePieceSignals', () => {
  it('takes the alternate art by its art, certain of the printing', async () => {
    const item = await recognized(raw({ art: ALT_ART }))
    expect(item).toMatchObject({
      game: 'op',
      printingId: 12,
      imageId: 102,
      setCode: 'OP01-120',
      flag: null,
      via: 'art'
    })
  })

  it('asks for the printing when a reprint shares the art', async () => {
    const item = await recognized(raw({ art: BASE_ART }))
    expect(item).toMatchObject({ printingId: 11, flag: 'pick-printing' })
    expect(item.options.map((o) => o.printingId).sort()).toEqual([11, 12, 13, 21])
  })

  it('takes the Japanese twin when the text reads Japanese, and English by default', async () => {
    const cardLanguage = vi.fn(async () => 'ja' as const)
    const ja = await recognized(raw({ art: BASE_ART }), ctx({ cardLanguage }))
    expect(ja).toMatchObject({ printingId: 21, cardId: 2, flag: null })
    const en = await recognized(raw({ art: BASE_ART }), ctx({ cardLanguage: async () => null }))
    expect(en.cardId).toBe(1)
  })

  it("takes the user's language filter over reading the text", async () => {
    const cardLanguage = vi.fn(async () => 'en' as const)
    const item = await recognized(
      raw({ art: BASE_ART }),
      ctx({ cardLanguage, filterLanguage: 'ja' })
    )
    expect(item.printingId).toBe(21)
    expect(cardLanguage).not.toHaveBeenCalled()
  })

  it('keeps to the picked set: the reprint in PRB-01, certain', async () => {
    const setPrintings = PRINTINGS.filter((p) => p.setName === PRB01)
    const item = await recognized(raw({ art: BASE_ART }), ctx({ setPrintings }))
    expect(item).toMatchObject({ printingId: 13, flag: null })
  })

  it('flags a card from another set than the picked one', async () => {
    const setPrintings = PRINTINGS.filter((p) => p.setCode === 'OP04-044')
    const item = await recognized(raw({ art: ALT_ART }), ctx({ setPrintings }))
    expect(item).toMatchObject({ printingId: 12, flag: 'other-set' })
  })

  it('reads the number, with its lookalike letters, and art picks among its printings', async () => {
    const item = await recognized(raw({ art: ALT_ART, codeTexts: ['0P01-12O SEC'] }))
    expect(item).toMatchObject({ printingId: 12, via: 'code', flag: null })
  })

  it('takes a read number with no art to go on as its plain printing, to check', async () => {
    const item = await recognized(raw({ codeTexts: ['OP04-044'] }))
    expect(item).toMatchObject({ printingId: 31, via: 'code', flag: null })
    const shanks = await recognized(raw({ codeTexts: ['OP01-120'] }))
    expect(shanks).toMatchObject({ printingId: 11, flag: 'pick-printing' })
  })

  it('is unsure when the number read names another card than confident art', async () => {
    const out = await resolveSignals(raw({ art: ALT_ART, codeTexts: ['OP04-044'] }), ctx())
    expect(out.kind).toBe('unsure')
  })

  it('takes confident art over a read one digit off it in the same set', async () => {
    // OP01-120 misread as OP01-126 (Kaido stands in for it at that number).
    const misread = PRINTINGS.map((p) => (p.cardId === 3 ? { ...p, setCode: 'OP01-126' } : p))
    const c = ctx({
      lookups: {
        ...lookups,
        printingsByCode: async (code) =>
          misread.filter((p) => p.setCode.toUpperCase() === code.toUpperCase())
      }
    })
    const item = await recognized(raw({ art: ALT_ART, codeTexts: ['OP01-126'] }), c)
    expect(item).toMatchObject({ printingId: 12, flag: null, via: 'art' })
    // Two digits off, or another set, is still a disagreement.
    const far = misread.map((p) => (p.cardId === 3 ? { ...p, setCode: 'OP01-106' } : p))
    const farCtx = ctx({
      lookups: {
        ...lookups,
        printingsByCode: async (code) =>
          far.filter((p) => p.setCode.toUpperCase() === code.toUpperCase())
      }
    })
    const out = await resolveSignals(raw({ art: ALT_ART, codeTexts: ['OP01-106'] }), farCtx)
    expect(out.kind).toBe('unsure')
  })

  it('trusts art only OP_ART_MIN_MARGIN ahead of another number', async () => {
    const close = art([102, 20], [301, 20 + OP_ART_MIN_MARGIN - 1])
    expect((await resolveSignals(raw({ art: close }), ctx())).kind).toBe('unsure')
    const clear = art([102, 20], [301, 20 + OP_ART_MIN_MARGIN])
    expect((await recognized(raw({ art: clear }))).printingId).toBe(12)
  })

  it('takes art short of the margin when a broken read hints at its number only', async () => {
    const close = art([102, 20], [301, 20 + OP_ART_MIN_MARGIN - 1])
    // "OPI-12O": no number reads, but its digits are OP01-120's.
    expect((await recognized(raw({ art: close, codeTexts: ['OPI-12O'] }))).printingId).toBe(12)
    // Hinting at the runner-up's too settles nothing, nor does a tie.
    const both = raw({ art: close, codeTexts: ['120 | 044'] })
    expect((await resolveSignals(both, ctx())).kind).toBe('unsure')
    const tie = raw({ art: art([102, 20], [301, 20]), codeTexts: ['OPI-12O'] })
    expect((await resolveSignals(tie, ctx())).kind).toBe('unsure')
  })

  it('takes confident art over a promo "P-" read with its digits (the set lost)', async () => {
    const promo = [...PRINTINGS, P(41, 4, 'en', 'P-120', 'Promotion card', 'P', 401)]
    const c = ctx({
      lookups: {
        ...lookups,
        printingsByCode: async (code) =>
          promo.filter((p) => p.setCode.toUpperCase() === code.toUpperCase())
      }
    })
    const item = await recognized(raw({ art: ALT_ART, codeTexts: ['P-120'] }), c)
    expect(item).toMatchObject({ printingId: 12, via: 'art' })
  })

  it('counts printings of one number as the same art within OP_SAME_ART', async () => {
    const apart = art([101, 10], [103, 11 + OP_SAME_ART], [301, 90])
    expect((await recognized(raw({ art: apart }))).flag).toBeNull()
    const near = art([101, 10], [103, 10 + OP_SAME_ART], [301, 90])
    expect((await recognized(raw({ art: near }))).flag).toBe('pick-printing')
  })

  it('takes something far from every artwork for no card at all', async () => {
    expect(await resolveSignals(raw({ art: art([301, 120]) }), ctx())).toEqual({
      kind: 'none',
      far: true
    })
    expect(await resolveSignals(raw({ found: false }), ctx())).toEqual({ kind: 'none' })
  })
})
