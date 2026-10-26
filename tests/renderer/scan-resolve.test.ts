import { describe, expect, it } from 'vitest'
import {
  resolveSignals,
  withRarityByLook,
  type ResolveContext,
  type ScanDraft
} from '@/features/scan/resolve'
import type { ArtMatch, RawSignals } from '@/features/scan/engine'
import type { ScanPrinting } from '@shared/scan/types'
import {
  ART_FAR_DISTANCE,
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
  cues: null,
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

  it('a card-shaped thing whose art is nothing like any card counts as nothing in view', async () => {
    // A book or the deck on the desk: its closest artwork is far off, and nothing reads.
    const far = [{ imageId: 201, distance: ART_FAR_DISTANCE + 1 }]
    expect(await resolveSignals(raw({ art: far }), noSet)).toEqual({ kind: 'none' })
    expect(await resolveSignals(raw({ art: far, codeTexts: ['garbage'] }), withSet(LOB))).toEqual({
      kind: 'none'
    })
    // A code or name read still counts it.
    expect(await recognized(raw({ art: far, codeTexts: ['SDY-EN006'] }))).toMatchObject({
      via: 'code',
      cardId: 1
    })
    expect(await recognized(raw({ art: far, nameText: 'Dark Magician' }))).toMatchObject({
      via: 'name',
      cardId: 1
    })
  })

  it('a near miss on the art is unsure', async () => {
    const near = [{ imageId: 201, distance: ART_FAR_DISTANCE }]
    expect(await resolveSignals(raw({ art: near }), noSet)).toEqual({ kind: 'unsure' })
    const justOver = [{ imageId: 201, distance: ART_MAX_DISTANCE + 1 }]
    expect(await resolveSignals(raw({ art: justOver }), noSet)).toEqual({ kind: 'unsure' })
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

  it('art match without set assumes the lowest rarity, to be checked', async () => {
    const item = await recognized(raw({ art: [{ imageId: 102, distance: 20 }] }))
    expect(item).toMatchObject({
      via: 'art',
      cardId: 1,
      imageId: 102,
      printingId: 13,
      setCode: 'SDY-EN006',
      rarity: 'Common',
      flag: 'pick-printing'
    })
    expect(item.options.map((o) => o.printingId)).toEqual([11, 12, 13])
  })

  it('an assumed printing takes New scans as when the card came in it', async () => {
    const item = await recognized(raw({ art: [{ imageId: 101, distance: 20 }] }), {
      ...noSet,
      defaultRarity: 'Secret Rare'
    })
    expect(item).toMatchObject({ printingId: 12, rarity: 'Secret Rare', flag: 'pick-printing' })
  })

  it('an assumed printing is English when the card has one', async () => {
    const de: ScanPrinting = {
      ...PRINTINGS[2],
      printingId: 14,
      setCode: 'AAA-DE001',
      language: 'de'
    }
    const item = await recognized(raw({ art: [{ imageId: 101, distance: 20 }] }), {
      ...noSet,
      lookups: { ...lookups, printingsForCards: async () => [de, ...PRINTINGS.slice(0, 3)] }
    })
    expect(item).toMatchObject({ printingId: 13, rarity: 'Common' })
  })

  it('a card printed once is not flagged', async () => {
    const item = await recognized(raw({ art: [{ imageId: 201, distance: 20 }] }))
    expect(item).toMatchObject({ printingId: 21, rarity: 'Ultra Rare', flag: null })
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

  it('name fallback outside the set assumes a printing, to be checked', async () => {
    const item = await recognized(raw({ nameText: 'Dark Magician' }), withSet(SDY + ' 2'))
    expect(item).toMatchObject({
      via: 'name',
      imageId: 101,
      printingId: 13,
      rarity: 'Common',
      flag: 'pick-printing'
    })
  })
})

describe('withRarityByLook', () => {
  // Dark Magician is a Normal Monster, whose plain name is black: a gold Ultra Rare name reads
  // dark and gold on camera, and a prismatic Secret Rare one light and silver.
  const LIGHT = { nameInk: 'light', nameTint: 'silver' } as const
  const DARK = { nameInk: 'dark', nameTint: 'gold' } as const
  const PLAIN = { nameInk: 'dark', nameTint: null } as const
  const guessed = (ctx: ResolveContext = noSet): Promise<ScanDraft> =>
    recognized(raw({ codeTexts: ['LOB-EN005'] }), ctx)
  /** The guessed draft as if LOB-EN005 had been printed as Common (11) and Secret Rare (12). */
  const commonOrSecret = async (ctx?: ResolveContext): Promise<ScanDraft> => {
    const item = await guessed(ctx)
    const [ultra, secret] = item.options
    return { ...item, rarity: 'Common', options: [{ ...ultra, rarity: 'Common' }, secret] }
  }

  it("under Auto, picks the code's rarity the name's look settles and drops the flag", async () => {
    const item = await commonOrSecret()
    expect(withRarityByLook(item, LIGHT, null)).toEqual({
      ...item,
      rarity: 'Secret Rare',
      printingId: 12,
      flag: null
    })
    expect(withRarityByLook(item, PLAIN, null)).toEqual({ ...item, flag: null })
    const ultraOrSecret = await guessed()
    expect(withRarityByLook(ultraOrSecret, DARK, null)).toMatchObject({
      rarity: 'Ultra Rare',
      printingId: 11,
      flag: null
    })
  })

  it('keeps the guess and its flag without a settling look', async () => {
    const item = await guessed()
    expect(withRarityByLook(item, null, null)).toBe(item)
    // Gold can read light in glare, so a light name doesn't rule out Ultra.
    expect(withRarityByLook(item, LIGHT, null)).toBe(item)
    const other = await commonOrSecret()
    expect(withRarityByLook(other, { nameInk: 'light', nameTint: null }, null)).toBe(other)
  })

  it("switches to the rarity's printing that shows the draft's artwork", async () => {
    const item = await commonOrSecret()
    const secret = item.options[1]
    const otherArt = { ...secret, imageIds: [999] }
    const withArt = { ...secret, printingId: 15, imageIds: [101, 102] }
    const draft = { ...item, options: [item.options[0], otherArt, withArt] }
    expect(withRarityByLook(draft, LIGHT, null)).toMatchObject({ printingId: 15 })
  })

  it('leaves the rarity to New scans as when it names one', async () => {
    const chosen = await guessed({ ...noSet, defaultRarity: 'Secret Rare' })
    expect(withRarityByLook(chosen, DARK, 'Secret Rare')).toBe(chosen)
    const missing = await guessed({ ...noSet, defaultRarity: 'Common' })
    expect(withRarityByLook(missing, DARK, 'Common')).toBe(missing)
  })

  it('leaves certain rarities and unpicked printings alone', async () => {
    const single = await recognized(raw({ codeTexts: ['SDY-EN006'] }))
    expect(withRarityByLook(single, LIGHT, null)).toBe(single)
    const unpicked = await recognized(raw({ art: [{ imageId: 101, distance: 20 }] }))
    expect(withRarityByLook(unpicked, LIGHT, null)).toBe(unpicked)
  })

  it('picks the rarity of a card from another set but keeps that flag', async () => {
    const item = await commonOrSecret(withSet(SDY))
    expect(item.flag).toBe('other-set')
    expect(withRarityByLook(item, LIGHT, null)).toMatchObject({
      rarity: 'Secret Rare',
      printingId: 12,
      flag: 'other-set'
    })
  })
})
