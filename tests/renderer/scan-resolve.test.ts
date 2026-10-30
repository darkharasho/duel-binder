import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  resolveSignals,
  withRarityByLook,
  type ResolveContext,
  type ScanDraft
} from '@/features/scan/resolve'
import type { ArtMatch, RawSignals } from '@/features/scan/engine'
import type { CardLanguage } from '@shared/scan/language'
import { LOOK_FEATURES, type LookModel } from '@shared/scan/look'
import type { ScanPrinting } from '@shared/scan/types'
import {
  ART_FAR_DISTANCE,
  ART_MATCH_DEPTH,
  ART_MAX_DISTANCE,
  ART_MAX_DISTANCE_IN_SET,
  ART_MIN_MARGIN,
  ART_REF_MIN_MARGIN
} from '@shared/scan/thresholds'

const LOB = 'Legend of Blue Eyes White Dragon'
const SDY = 'Starter Deck: Yugi'

// Dark Magician (card 1) has two artworks, Blue-Eyes (card 2) one.
const DM = {
  cardId: 1,
  name: 'Dark Magician',
  frameType: 'normal',
  price: null,
  imageIds: [101, 102]
}
const BEWD = {
  cardId: 2,
  name: 'Blue-Eyes White Dragon',
  frameType: 'normal',
  price: null,
  imageIds: [201]
}
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
  nameTexts: [],
  textBands: [],
  cues: null,
  look: null,
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
    expect(await resolveSignals(raw({ codeTexts: ['garbage'], nameTexts: ['zz'] }), noSet)).toEqual(
      {
        kind: 'unsure'
      }
    )
  })

  it('a card-shaped thing whose art is nothing like any card counts as nothing in view', async () => {
    // A book or the deck on the desk: its closest artwork is far off, and nothing reads.
    const far = [{ imageId: 201, distance: ART_FAR_DISTANCE + 1 }]
    expect(await resolveSignals(raw({ art: far }), noSet)).toEqual({ kind: 'none', far: true })
    expect(await resolveSignals(raw({ art: far, codeTexts: ['garbage'] }), withSet(LOB))).toEqual({
      kind: 'none',
      far: true
    })
    // A code or name read still counts it.
    expect(await recognized(raw({ art: far, codeTexts: ['SDY-EN006'] }))).toMatchObject({
      via: 'code',
      cardId: 1
    })
    expect(await recognized(raw({ art: far, nameTexts: ['Dark Magician'] }))).toMatchObject({
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

  describe('the language its text reads as', () => {
    const foreign = (language: ScanPrinting['language'], printingId: number): ScanPrinting => ({
      ...PRINTINGS[2],
      printingId,
      setCode: `AAA-${language.toUpperCase()}001`,
      language
    })
    const printed = [
      foreign('ja', 15),
      foreign('zh-hant', 16),
      foreign('de', 14),
      ...PRINTINGS.slice(0, 3)
    ]
    const art = raw({ art: [{ imageId: 101, distance: 20 }] })
    const read = (
      language: CardLanguage | null,
      options = printed
    ): ResolveContext & { cardLanguage: Mock } => ({
      ...noSet,
      cardLanguage: vi.fn(async () => language),
      lookups: { ...lookups, printingsForCards: async () => options }
    })

    it('assumes a printing in that language, offering every printing', async () => {
      const ctx = read('ja')
      const item = await recognized(art, ctx)
      expect(item).toMatchObject({ printingId: 15, setCode: 'AAA-JA001', flag: 'pick-printing' })
      expect(item.options).toHaveLength(6)
      expect(ctx.cardLanguage).toHaveBeenCalledWith(1)
    })

    it('takes Chinese text for whichever Chinese the card was printed in', async () => {
      expect(await recognized(art, read('zh'))).toMatchObject({ printingId: 16 })
    })

    it('stays with English when the text cannot be told or the card has no such printing', async () => {
      expect(await recognized(art, read(null))).toMatchObject({ printingId: 13 })
      expect(await recognized(art, read('ko'))).toMatchObject({ printingId: 13 })
    })

    it('does not read a card printed in one language', async () => {
      const ctx = read('ja', PRINTINGS.slice(0, 3))
      expect(await recognized(art, ctx)).toMatchObject({ printingId: 13 })
      expect(ctx.cardLanguage).not.toHaveBeenCalled()
    })

    it('does not read a card whose code was read', async () => {
      const ctx = read('ja')
      expect(await recognized(raw({ codeTexts: ['SDY-EN006'] }), ctx)).toMatchObject({
        printingId: 13
      })
      expect(ctx.cardLanguage).not.toHaveBeenCalled()
    })
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
    const item = await recognized(raw({ nameTexts: ['Dark Magician'] }), withSet(LOB))
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
    const item = await recognized(raw({ nameTexts: ['Dark Magician'] }), withSet(SDY + ' 2'))
    expect(item).toMatchObject({
      via: 'name',
      imageId: 101,
      printingId: 13,
      rarity: 'Common',
      flag: 'pick-printing'
    })
  })

  it('tries each name read, as when the card was read both ways up', async () => {
    const item = await recognized(raw({ nameTexts: ['zz', 'Dark Magician'] }))
    expect(item).toMatchObject({ via: 'name', cardId: 1 })
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
    // A Normal Monster's pale bar can make a prismatic name read dark, so dark ink doesn't settle it.
    expect(withRarityByLook(item, PLAIN, null)).toBe(item)
    const ultraOrSecret = await guessed()
    expect(withRarityByLook(ultraOrSecret, DARK, null)).toMatchObject({
      rarity: 'Ultra Rare',
      printingId: 11,
      flag: null
    })
  })

  it('rules smooth Ultra gold out by a light silver name on a black-name frame', async () => {
    expect(withRarityByLook(await guessed(), LIGHT, null)).toMatchObject({
      rarity: 'Secret Rare',
      flag: null
    })
  })

  it('keeps the guess and its flag without a settling look', async () => {
    const item = await guessed()
    expect(withRarityByLook(item, null, null)).toBe(item)
    // Gold can read light in glare, so a light name alone doesn't rule out Ultra...
    expect(withRarityByLook(item, { nameInk: 'light', nameTint: null }, null)).toBe(item)
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

describe('withRarityByLook with the look model (the phone scanner)', () => {
  const at = LOOK_FEATURES.indexOf('art.chromaFine')
  /**
   * A model that reads one feature, the art's colour noise: Secret Rare rises with it and
   * Starlight faster, Ultimate stays. At its threshold, 0.99.
   */
  const MODEL: LookModel = {
    features: LOOK_FEATURES,
    logOffset: LOOK_FEATURES.map(() => 0),
    mean: LOOK_FEATURES.map(() => 0),
    spread: LOOK_FEATURES.map(() => 1),
    classes: ['Secret Rare', 'Starlight Rare', 'Ultimate Rare'],
    weights: [4, 6, 0].map((w) => LOOK_FEATURES.map((_, j) => (j === at ? w : 0))),
    bias: [0, -4, 0],
    temperature: 1,
    minProbability: 0.99
  }
  /** One frame's features, with the art's colour noise at v. */
  const frame = (v: number): number[] => LOOK_FEATURES.map((_, j) => (j === at ? v : 0))
  const look = (...frames: number[][]): { model: LookModel; frames: number[][] } => ({
    model: MODEL,
    frames
  })
  const LIGHT = { nameInk: 'light', nameTint: 'silver', nameContrast: -0.3 } as const

  /**
   * LOB-EN005 as if printed in `rarities` (printings 11, 12...) on a frameType frame. A light
   * silver name fits Secret and Starlight but tells neither from Ultimate, whose name has no
   * known look, so the rules alone can't pick.
   */
  const draft = async (rarities: string[], frameType = 'normal'): Promise<ScanDraft> => {
    const item = await recognized(raw({ codeTexts: ['LOB-EN005'] }))
    const [first] = item.options
    const options = rarities.map((rarity, i) => ({
      ...first,
      printingId: 11 + i,
      rarity,
      frameType
    }))
    return { ...item, printingId: 11, rarity: rarities[0], options, flag: 'check-rarity' }
  }
  const secretOrUltimate = (): Promise<ScanDraft> => draft(['Ultimate Rare', 'Secret Rare'])

  it('picks what the model is sure of when the rules abstain', async () => {
    const item = await secretOrUltimate()
    expect(withRarityByLook(item, LIGHT, null)).toBe(item)
    expect(withRarityByLook(item, LIGHT, null, look(frame(2)))).toEqual({
      ...item,
      printingId: 12,
      rarity: 'Secret Rare',
      flag: null
    })
  })

  it('without the model, as on the desktop webcam, keeps to the rules', async () => {
    const item = await secretOrUltimate()
    expect(withRarityByLook(item, LIGHT, null, null)).toBe(item)
    // The rules still pick where they can, with or without it.
    const ultraOrSecret = await draft(['Ultra Rare', 'Secret Rare'])
    for (const l of [null, look(frame(-5))])
      expect(withRarityByLook(ultraOrSecret, LIGHT, null, l)).toMatchObject({
        rarity: 'Secret Rare',
        flag: null
      })
  })

  it('keeps the guess and its flag when the model is not sure enough or has no frames', async () => {
    const item = await secretOrUltimate()
    // Secret against Ultimate at e^1.2 : 1, about 0.77.
    expect(withRarityByLook(item, LIGHT, null, look(frame(0.3)))).toBe(item)
    // A glared frame pulls a showing's mean below the threshold.
    expect(withRarityByLook(item, LIGHT, null, look(frame(2), frame(-1.5)))).toBe(item)
    expect(withRarityByLook(item, LIGHT, null, look())).toBe(item)
  })

  describe('makes no wrong pick the guards stop', () => {
    it('when the name was not read, so nothing positively fits the pick', async () => {
      const item = await secretOrUltimate()
      const unread = { nameInk: null, nameTint: null, nameContrast: null }
      expect(withRarityByLook(item, unread, null, look(frame(3)))).toBe(item)
    })

    it('when the name rules the pick out', async () => {
      // Plain black ink well darker than an Effect bar: not a prismatic Secret, whatever the model says.
      const item = await draft(['Ultimate Rare', 'Secret Rare'], 'effect')
      const black = { nameInk: 'dark', nameTint: null, nameContrast: 0.35 } as const
      expect(withRarityByLook(item, black, null, look(frame(3)))).toBe(item)
      expect(withRarityByLook(item, LIGHT, null, look(frame(3)))).toMatchObject({
        rarity: 'Secret Rare'
      })
    })

    it('when a Link frame would be taken for a whole-card foil', async () => {
      // Sure of Starlight (e^6 : 1 over Secret) on both, but a Link frame's pattern reads as glitter.
      const onEffect = await draft(['Secret Rare', 'Starlight Rare'], 'effect')
      expect(withRarityByLook(onEffect, LIGHT, null, look(frame(5)))).toMatchObject({
        rarity: 'Starlight Rare'
      })
      const onLink = await draft(['Secret Rare', 'Starlight Rare'], 'link')
      expect(withRarityByLook(onLink, LIGHT, null, look(frame(5)))).toBe(onLink)
    })

    it('when art runs over the frame, or a rarity is one the model does not know', async () => {
      const overframe = await draft(['Secret Rare', 'Secret Rare (Overframe)'])
      expect(withRarityByLook(overframe, LIGHT, null, look(frame(5)))).toBe(overframe)
      const ghost = await draft(['Ghost Rare', 'Secret Rare'])
      expect(withRarityByLook(ghost, LIGHT, null, look(frame(5)))).toBe(ghost)
    })

    it('when the user said what the stack is', async () => {
      const item = await secretOrUltimate()
      expect(withRarityByLook(item, LIGHT, 'Ultimate Rare', look(frame(3)))).toBe(item)
    })
  })
})

describe('printings told by a reference scan of their art', () => {
  // YAC1-JP006 in five printings: plain Ultra and Secret, and an overframe family of three.
  const YAC1 = 'Original Artwork Collection'
  const card = {
    cardId: 3,
    name: 'Relinquished the Wicked Eye of Illusion',
    frameType: 'fusion',
    price: null,
    setName: YAC1,
    setCode: 'YAC1-JP006',
    language: 'ja'
  } as const
  const OWN: ScanPrinting[] = [
    { ...card, imageIds: [301], printingId: 31, rarity: 'Ultra Rare' },
    { ...card, imageIds: [301], printingId: 32, rarity: 'Secret Rare' },
    {
      ...card,
      imageIds: [301],
      printingId: 33,
      rarity: 'Prismatic Secret Rare',
      variant: 'Overframe'
    },
    { ...card, imageIds: [301], printingId: 34, rarity: 'Grand Master Rare', variant: 'Overframe' },
    { ...card, imageIds: [301], printingId: 35, rarity: 'Ultra Rare (Overframe)' }
  ]
  const ctx: ResolveContext = {
    ...noSet,
    lookups: {
      ...lookups,
      printingsByCode: async (code) => (code === 'YAC1-JP006' ? OWN : []),
      printingsForCards: async (ids) => (ids.includes(3) ? OWN : []),
      cardsForImages: async (ids) =>
        ids.filter((i) => i === 301).map((imageId) => ({ imageId, cardId: 3 }))
    }
  }
  /** The photo's art match: its card art `base` off, the PScR's overframe scan `ref` off. */
  const art = (base: number, ref: number, printingIds = [33]): ArtMatch[] => [
    {
      imageId: 301,
      distance: Math.min(base, ref),
      base,
      refs: [{ h: 'a'.repeat(64), printingIds, distance: ref }]
    }
  ]
  const OVERFRAME = [33, 34, 35]
  const coded = (a: ArtMatch[]): RawSignals => raw({ codeTexts: ['YAC1-JP006'], art: a })

  it("takes a code's printing from its art family when an overframe scan beats the card art", async () => {
    const item = await recognized(coded(art(70, 30)), ctx)
    expect(item).toMatchObject({
      printingId: 35,
      rarity: 'Ultra Rare (Overframe)',
      flag: 'check-rarity',
      artPrintings: OVERFRAME
    })
    expect(item.options).toEqual(OWN)
  })

  it("picks a one-rarity family's printing, still to be checked against the code's others", async () => {
    const three = OWN.filter((p) => p.printingId !== 34 && p.printingId !== 35)
    const item = await recognized(coded(art(70, 30)), {
      ...ctx,
      lookups: { ...ctx.lookups, printingsByCode: async () => three }
    })
    expect(item).toMatchObject({ printingId: 33, flag: 'check-rarity', artPrintings: [33] })
  })

  it('ignores a scan that more than one art variant took', async () => {
    const alt: ScanPrinting = {
      ...OWN[0],
      printingId: 36,
      rarity: 'Ultra Rare',
      variant: 'Alternate art'
    }
    const item = await recognized(coded(art(70, 30, [33, 36])), {
      ...ctx,
      lookups: { ...ctx.lookups, printingsByCode: async () => [...OWN, alt] }
    })
    expect(item).toMatchObject({ printingId: 31, flag: 'check-rarity' })
    expect(item.artPrintings).toBeUndefined()
  })

  it('keeps to the lowest rarity when the scan is not clearly closer than the card art', async () => {
    const item = await recognized(coded(art(30 + ART_REF_MIN_MARGIN - 1, 30)), ctx)
    expect(item).toMatchObject({ printingId: 31, flag: 'check-rarity' })
    expect(item.artPrintings).toBeUndefined()
  })

  it("ignores a scan of printings the code doesn't have, or that aren't another art", async () => {
    for (const ids of [[99], [32]]) {
      const item = await recognized(coded(art(70, 30, ids)), ctx)
      expect(item).toMatchObject({ printingId: 31, flag: 'check-rarity' })
      expect(item.artPrintings).toBeUndefined()
    }
  })

  it('leaves a match without its card art distance alone', async () => {
    const [match] = art(70, 30)
    const item = await recognized(coded([{ ...match, base: undefined }]), ctx)
    expect(item.printingId).toBe(31)
  })

  it('keeps the rarity the user said the stack is', async () => {
    const item = await recognized(coded(art(70, 30)), { ...ctx, defaultRarity: 'Secret Rare' })
    expect(item).toMatchObject({ printingId: 32, flag: null })
  })

  it('takes the family by art within a picked set and with no code read', async () => {
    const inYac1 = await recognized(raw({ art: art(70, 30) }), {
      ...ctx,
      setName: YAC1,
      setPrintings: OWN
    })
    expect(inYac1).toMatchObject({ printingId: 35, artPrintings: OVERFRAME })
    const anywhere = await recognized(raw({ art: art(70, 30) }), ctx)
    expect(anywhere).toMatchObject({ printingId: 35, artPrintings: OVERFRAME })
  })

  it("lets the look pick only among the art family's rarities", async () => {
    // LOB-EN005 as if a scan had told its Secret Rare (12) from its Ultra Rare (11): a dark gold
    // name, which says Ultra Rare, doesn't move it.
    const item = { ...(await recognized(raw({ codeTexts: ['LOB-EN005'] }))), printingId: 12 }
    const dark = { nameInk: 'dark', nameTint: 'gold' } as const
    expect(withRarityByLook(item, dark, null).printingId).toBe(11)
    expect(withRarityByLook({ ...item, artPrintings: [12] }, dark, null).printingId).toBe(12)
  })
})
