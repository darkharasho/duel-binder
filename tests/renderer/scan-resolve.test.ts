import { describe, expect, it } from 'vitest'
import { resolveSignals, type ResolveContext, type ScanDraft } from '@/features/scan/resolve'
import type { ArtMatch, RawSignals } from '@/features/scan/engine'
import type { ScanPrinting } from '@shared/scan/types'
import {
  ART_MATCH_DEPTH,
  ART_MAX_DISTANCE,
  ART_MAX_DISTANCE_IN_SET,
  ART_MIN_MARGIN
} from '@shared/scan/thresholds'

const LOB = 'Legend of Blue Eyes White Dragon'
const SDY = 'Starter Deck: Yugi'

// Dark Magician (card 1) has two artworks, Blue-Eyes (card 2) one.
const DM = { cardId: 1, name: 'Dark Magician', frameType: 'normal', imageIds: [101, 102] }
const BEWD = { cardId: 2, name: 'Blue-Eyes White Dragon', frameType: 'normal', imageIds: [201] }
const PRINTINGS: ScanPrinting[] = [
  {
    ...DM,
    printingId: 11,
    setName: LOB,
    setCode: 'LOB-EN005',
    rarity: 'Ultra Rare',
    language: 'en'
  },
  {
    ...DM,
    printingId: 12,
    setName: LOB,
    setCode: 'LOB-EN005',
    rarity: 'Secret Rare',
    language: 'en'
  },
  { ...DM, printingId: 13, setName: SDY, setCode: 'SDY-EN006', rarity: 'Common', language: 'en' },
  {
    ...BEWD,
    printingId: 21,
    setName: LOB,
    setCode: 'LOB-EN001',
    rarity: 'Ultra Rare',
    language: 'en'
  }
]
const inSet = (setName: string): ScanPrinting[] => PRINTINGS.filter((p) => p.setName === setName)

const lookups: ResolveContext['lookups'] = {
  printingsByCode: async (code) =>
    PRINTINGS.filter((p) => p.setCode.toUpperCase() === code.toUpperCase()),
  printingsForCards: async (ids) => PRINTINGS.filter((p) => ids.includes(p.cardId)),
  matchName: async (text) =>
    text === 'Dark Magician' ? { cardId: 1, name: 'Dark Magician', score: 1 } : null,
  cardsForImages: async (ids) =>
    [DM, BEWD].flatMap((c) =>
      c.imageIds.filter((i) => ids.includes(i)).map((imageId) => ({ imageId, cardId: c.cardId }))
    )
}

const raw = (r: Partial<RawSignals>): RawSignals => ({
  found: true,
  quad: null,
  art: [],
  codeTexts: [],
  nameText: null,
  ...r
})
const noSet = { setName: null, setPrintings: null, defaultRarity: null, lookups }
const withSet = (setName: string): ResolveContext => ({
  setName,
  setPrintings: inSet(setName),
  defaultRarity: null,
  lookups
})

async function recognized(r: RawSignals, ctx: ResolveContext = noSet): Promise<ScanDraft> {
  const out = await resolveSignals(r, ctx)
  if (out.kind !== 'recognized') throw new Error(`expected recognized, got ${out.kind}`)
  return out.item
}

describe('resolveSignals', () => {
  it('not found gives none', async () => {
    expect(await resolveSignals(raw({ found: false, codeTexts: ['LOB-EN005'] }), noSet)).toEqual({
      kind: 'none'
    })
  })

  it('nothing gives unsure', async () => {
    expect(await resolveSignals(raw({}), noSet)).toEqual({ kind: 'unsure' })
    expect(await resolveSignals(raw({ codeTexts: ['garbage'], nameText: 'zz' }), noSet)).toEqual({
      kind: 'unsure'
    })
  })

  it('code wins over art', async () => {
    // Weak art of another card doesn't stand in the way.
    const weak = [{ imageId: 201, distance: ART_MAX_DISTANCE + 1 }]
    const item = await recognized(raw({ codeTexts: ['SDY-EN006'], art: weak }))
    expect(item).toMatchObject({ via: 'code', cardId: 1, printingId: 13, imageId: 101 })
    // Agreeing art picks which of the card's artworks it is.
    const alt = await recognized(
      raw({ codeTexts: ['SDY-EN006'], art: [{ imageId: 102, distance: 5 }] })
    )
    expect(alt).toMatchObject({ via: 'code', printingId: 13, imageId: 102 })
  })

  it('code contradicting confident art is unsure', async () => {
    const art = [{ imageId: 201, distance: 5 }]
    expect(await resolveSignals(raw({ codeTexts: ['SDY-EN006'], art }), noSet)).toEqual({
      kind: 'unsure'
    })
  })

  it('region-less code retries with EN', async () => {
    const item = await recognized(raw({ codeTexts: ['SDY-006'] }))
    expect(item).toMatchObject({ via: 'code', setCode: 'SDY-EN006', printingId: 13 })
  })

  it('code from another set is flagged other-set', async () => {
    const item = await recognized(raw({ codeTexts: ['SDY-EN006'] }), withSet(LOB))
    expect(item).toMatchObject({ via: 'code', printingId: 13, flag: 'other-set' })
    const own = await recognized(raw({ codeTexts: ['LOB-EN001'] }), withSet(LOB))
    expect(own.flag).toBeNull()
  })

  it('single-rarity code is certain', async () => {
    const item = await recognized(raw({ codeTexts: ['SDY-EN006'] }))
    expect(item).toMatchObject({
      name: 'Dark Magician',
      rarity: 'Common',
      setCode: 'SDY-EN006',
      flag: null
    })
    expect(item.options.map((o) => o.printingId)).toEqual([13])
  })

  it('multi-rarity code uses default rarity when available else flags check-rarity', async () => {
    const preferred = await recognized(raw({ codeTexts: ['LOB-EN005'] }), {
      ...noSet,
      defaultRarity: 'Secret Rare'
    })
    expect(preferred).toMatchObject({ rarity: 'Secret Rare', printingId: 12, flag: null })
    const guessed = await recognized(raw({ codeTexts: ['LOB-EN005'] }))
    expect(guessed).toMatchObject({ rarity: 'Ultra Rare', printingId: 11, flag: 'check-rarity' })
    expect(guessed.options.map((o) => o.printingId)).toEqual([11, 12])
  })

  it('art match without set needs pick-printing', async () => {
    const item = await recognized(raw({ art: [{ imageId: 102, distance: 20 }] }))
    expect(item).toMatchObject({
      via: 'art',
      cardId: 1,
      imageId: 102,
      printingId: null,
      setCode: null,
      flag: 'pick-printing'
    })
    expect(item.options.map((o) => o.printingId)).toEqual([11, 12, 13])
  })

  it('art match within the set offers the cards set printings', async () => {
    const item = await recognized(raw({ art: [{ imageId: 101, distance: 20 }] }), withSet(LOB))
    expect(item).toMatchObject({ via: 'art', setCode: 'LOB-EN005', flag: 'check-rarity' })
    expect(item.options.map((o) => o.printingId)).toEqual([11, 12])
  })

  it('off-set art lookalike is unsure', async () => {
    const art = [{ imageId: 101, distance: ART_MAX_DISTANCE_IN_SET + 1 }]
    expect(await resolveSignals(raw({ art }), withSet(LOB))).toEqual({ kind: 'unsure' })
    const loose = [{ imageId: 101, distance: ART_MAX_DISTANCE }]
    expect((await resolveSignals(raw({ art: loose }), noSet)).kind).toBe('recognized')
  })

  it('an alternate artwork of the same card does not kill the margin', async () => {
    const art = [
      { imageId: 101, distance: 20 },
      { imageId: 102, distance: 22 },
      { imageId: 201, distance: 20 + ART_MIN_MARGIN }
    ]
    expect((await recognized(raw({ art }))).cardId).toBe(1)
  })

  it('a different card inside the margin is unsure', async () => {
    const art = [
      { imageId: 101, distance: 20 },
      { imageId: 201, distance: 20 + ART_MIN_MARGIN - 1 }
    ]
    expect(await resolveSignals(raw({ art }), noSet)).toEqual({ kind: 'unsure' })
  })

  it('a full list of one card measures the margin to its last match', async () => {
    const full = (last: number): ArtMatch[] =>
      Array.from({ length: ART_MATCH_DEPTH }, (_, i) => ({
        imageId: i % 2 ? 102 : 101,
        distance: i === ART_MATCH_DEPTH - 1 ? last : 20
      }))
    expect(await resolveSignals(raw({ art: full(21) }), noSet)).toEqual({ kind: 'unsure' })
    expect((await resolveSignals(raw({ art: full(20 + ART_MIN_MARGIN) }), noSet)).kind).toBe(
      'recognized'
    )
  })

  it('name fallback within set', async () => {
    const item = await recognized(raw({ nameText: 'Dark Magician' }), withSet(LOB))
    expect(item).toMatchObject({
      via: 'name',
      cardId: 1,
      imageId: 101,
      setCode: 'LOB-EN005',
      flag: 'check-rarity'
    })
    expect(item.printingId).not.toBeNull()
  })

  it('name fallback outside the set needs pick-printing', async () => {
    const item = await recognized(raw({ nameText: 'Dark Magician' }), withSet(SDY + ' 2'))
    expect(item).toMatchObject({
      via: 'name',
      imageId: 101,
      printingId: null,
      flag: 'pick-printing'
    })
  })
})
