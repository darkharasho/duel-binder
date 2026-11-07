import { describe, expect, it, vi } from 'vitest'
import { resolveSignals, type ResolveContext, type ScanDraft } from '@/features/scan/resolve'
import type { RawSignals } from '@/features/scan/engine'
import type { ScanPrinting } from '@shared/scan/types'
import {
  ART_FAR_DISTANCE,
  ART_MAX_DISTANCE,
  CARD_BACK_MAX_DISTANCE,
  PKM_ART_MIN_MARGIN,
  PKM_GUESS_REPRINT_LEAD,
  PKM_PHOTO_REPRINT_LEAD
} from '@shared/scan/thresholds'
import { printing } from './scanFakes'

type Read = 'en' | 'ja' | 'other' | 'kanji' | null

// Pikachu in English (A) and its Japanese twin (B) share art; C is an English reprint of A's art
// in another set; D has two versions; R is Raichu, in English and Japanese.
const PKM: ScanPrinting[] = [
  printing({
    printingId: 11,
    cardId: 1,
    name: 'Pikachu',
    frameType: 'pokemon',
    setName: '151',
    setCode: 'SV3 045/193',
    rarity: 'Holofoil',
    language: 'en',
    price: 3,
    imageIds: [101]
  }),
  printing({
    printingId: 21,
    cardId: 2,
    name: 'ピカチュウ',
    frameType: 'pokemon',
    setName: 'ポケモンカード151',
    setCode: 'SV2a 025/165',
    rarity: 'Normal',
    language: 'ja',
    price: 1,
    imageIds: [201]
  }),
  printing({
    printingId: 31,
    cardId: 3,
    name: 'Pikachu',
    frameType: 'pokemon',
    setName: 'Paradox Rift',
    setCode: 'SV4 201/182',
    rarity: 'Holofoil',
    language: 'en',
    price: 40,
    imageIds: [301]
  }),
  printing({
    printingId: 41,
    cardId: 4,
    name: 'Eevee',
    frameType: 'pokemon',
    setName: 'Prismatic Evolutions',
    setCode: 'PRE 074/131',
    rarity: 'Reverse Holofoil',
    language: 'en',
    price: 2,
    imageIds: [401]
  }),
  printing({
    printingId: 42,
    cardId: 4,
    name: 'Eevee',
    frameType: 'pokemon',
    setName: 'Prismatic Evolutions',
    setCode: 'PRE 074/131',
    rarity: 'Normal',
    language: 'en',
    price: 0.5,
    imageIds: [401]
  }),
  printing({
    printingId: 51,
    cardId: 5,
    name: 'Raichu',
    frameType: 'pokemon',
    setName: '151',
    setCode: 'SV3 026/165',
    rarity: 'Normal',
    language: 'en',
    price: 0.25,
    imageIds: [501]
  }),
  printing({
    printingId: 61,
    cardId: 6,
    name: 'ライチュウ',
    frameType: 'pokemon',
    setName: 'ポケモンカード151',
    setCode: 'SV2a 026/165',
    rarity: 'Normal',
    language: 'ja',
    price: 0.5,
    imageIds: [601]
  })
]

const lookups: ResolveContext['lookups'] = {
  printingsByCode: async () => [],
  printingsByNumber: async (n) =>
    PKM.filter((p) => {
      const [abbrev, num] = p.setCode.split(' ')
      const [number, total] = num.split('/')
      return (
        number === n.number &&
        (n.total === null || total === n.total) &&
        (n.setAbbrev === null || abbrev.toUpperCase() === n.setAbbrev)
      )
    }),
  printingsForCards: async (ids) => PKM.filter((p) => ids.includes(p.cardId)),
  matchName: async (text) => {
    const p = PKM.find((q) => q.name.toLowerCase() === text.toLowerCase())
    return p ? { cardId: p.cardId, name: p.name, score: 1 } : null
  },
  cardsForImages: async (ids) =>
    PKM.flatMap((p) => p.imageIds.map((imageId) => ({ imageId, cardId: p.cardId })))
      .filter((c) => ids.includes(c.imageId))
      .filter((c, i, all) => all.findIndex((d) => d.imageId === c.imageId) === i)
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

const pkm = (read: Read): ResolveContext & { readLanguage: ReturnType<typeof vi.fn> } => ({
  game: 'pkm',
  setName: null,
  setPrintings: null,
  defaultRarity: null,
  // What's certain; the rules are on in the best-guess tests below.
  guessRules: [],
  readLanguage: vi.fn(async () => read),
  lookups
})

/** The app's context: PKM_GUESS_RULES on. */
const guessing = (read: Read, names: string[] = []): ResolveContext => ({
  ...pkm(read),
  guessRules: undefined,
  readLocalName: async () => names
})

async function recognized(r: RawSignals, ctx: ResolveContext): Promise<ScanDraft> {
  const out = await resolveSignals(r, ctx)
  if (out.kind !== 'recognized') throw new Error(`expected recognized, got ${out.kind}`)
  return out.item
}

// A's art (d 30) and its twin B's (d 31).
const twins = [
  { imageId: 101, distance: 30 },
  { imageId: 201, distance: 31 }
]

describe('resolvePokemonSignals', () => {
  it('not found gives none, without reading the language', async () => {
    const ctx = pkm('en')
    expect(await resolveSignals(raw({ found: false, art: twins }), ctx)).toEqual({ kind: 'none' })
    expect(ctx.readLanguage).not.toHaveBeenCalled()
  })

  it('en/ja twins resolve by language read', async () => {
    expect(await recognized(raw({ art: twins }), pkm('ja'))).toMatchObject({
      cardId: 2,
      via: 'art',
      game: 'pkm'
    })
    expect(await recognized(raw({ art: twins }), pkm('en'))).toMatchObject({
      cardId: 1,
      via: 'art'
    })
    expect(await resolveSignals(raw({ art: twins }), pkm(null))).toEqual({ kind: 'unsure' })
  })

  it('unread text: the Japanese twin is named when its name band reads as the printed name', async () => {
    const withName = (read: Read, names: string[]): ResolveContext => ({
      ...pkm(read),
      readLocalName: vi.fn(async () => names)
    })
    expect(await recognized(raw({ art: twins }), withName(null, ['ピカチユウ HP']))).toMatchObject({
      cardId: 2,
      via: 'art'
    })
    // By the number too.
    expect(
      await recognized(raw({ art: twins, codeTexts: ['025/165'] }), withName(null, ['ピカチュウ']))
    ).toMatchObject({ cardId: 2, via: 'code' })
    // Another name, or none: unsure. The English twin is never named by it.
    expect(await resolveSignals(raw({ art: twins }), withName(null, ['ライチュウ']))).toEqual({
      kind: 'unsure'
    })
    expect(await resolveSignals(raw({ art: twins }), withName(null, []))).toEqual({
      kind: 'unsure'
    })
    // A Chinese read of the text still says no, whatever the name band shows.
    expect(await resolveSignals(raw({ art: twins }), withName('other', ['ピカチュウ']))).toEqual({
      kind: 'unsure'
    })
    // Text read as English: the name isn't asked for.
    const en = withName('en', ['ピカチュウ'])
    expect(await recognized(raw({ art: twins }), en)).toMatchObject({ cardId: 1 })
    expect(en.readLocalName).not.toHaveBeenCalled()
  })

  it('unread text: the English twin is named when the name band reads its name', async () => {
    expect(
      await recognized(raw({ art: twins, nameTexts: ['~ Pikachu .'] }), pkm(null))
    ).toMatchObject({ cardId: 1, via: 'art' })
    // Not when the text reads as another language (a European card shares many names).
    expect(await resolveSignals(raw({ art: twins, nameTexts: ['Pikachu'] }), pkm('other'))).toEqual(
      { kind: 'unsure' }
    )
    // Not when both names read: the twins can't both be in view.
    const both: ResolveContext = { ...pkm(null), readLocalName: async () => ['ピカチュウ'] }
    expect(await resolveSignals(raw({ art: twins, nameTexts: ['Pikachu'] }), both)).toEqual({
      kind: 'unsure'
    })
    // A name too short to tell from noise says nothing.
    expect(await resolveSignals(raw({ art: twins, nameTexts: ['Pika'] }), pkm(null))).toEqual({
      kind: 'unsure'
    })
  })

  it('text read as kanji alone leaves the English name to decide, never the Japanese', async () => {
    // The Japanese model's kanji of a blurred English text box (owner shots of Drilbur, Thievul).
    expect(
      await recognized(raw({ art: twins, nameTexts: ['Pikachu'] }), pkm('kanji'))
    ).toMatchObject({ cardId: 1 })
    const ja: ResolveContext = { ...pkm('kanji'), readLocalName: async () => ['ピカチュウ'] }
    expect(await resolveSignals(raw({ art: twins }), ja)).toEqual({ kind: 'unsure' })
    expect(await resolveSignals(raw({ art: twins }), pkm('kanji'))).toEqual({ kind: 'unsure' })
  })

  it('a Japanese card named in English is matched by its printed name', async () => {
    const local: ScanPrinting = { ...PKM[1], name: 'Pikachu', localName: 'ピカチュウ' }
    const ctx: ResolveContext = {
      ...pkm(null),
      readLocalName: async () => ['ピカチュウ'],
      lookups: {
        ...lookups,
        printingsForCards: async (ids) =>
          PKM.map((p) => (p.cardId === 2 ? local : p)).filter((p) => ids.includes(p.cardId))
      }
    }
    expect(await recognized(raw({ art: twins }), ctx)).toMatchObject({ cardId: 2 })
  })

  it('a read number tells a card from its unseen twin, unless the twin prints the same number', async () => {
    const ctx = (code: string): ResolveContext => ({
      ...pkm('en'),
      lookups: {
        ...lookups,
        printingsForCards: async (ids) =>
          PKM.filter((p) => ids.includes(p.cardId)).map((p) =>
            p.cardId === 1 ? { ...p, unseenTwin: true as const, unseenTwinCodes: [code] } : p
          )
      }
    })
    const own = PKM.find((p) => p.cardId === 1 && p.language === 'en')!.setCode
    const signals = raw({ art: [twins[0]], codeTexts: [own] })
    expect(await recognized(signals, ctx('SVP 223/225'))).toMatchObject({ cardId: 1, via: 'code' })
    // A Classic Collection reprint prints its original's number.
    const original = own.split(' ').at(-1)!
    expect(await resolveSignals(signals, ctx(`CLC ${original}`))).toEqual({ kind: 'unsure' })
  })

  it("a read of a card's own number with a misread total still tells it from its twin", async () => {
    const ctx = (code: string): ResolveContext => ({
      ...pkm('en'),
      lookups: {
        ...lookups,
        printingsForCards: async (ids) =>
          PKM.filter((p) => ids.includes(p.cardId)).map((p) =>
            p.cardId === 1 ? { ...p, unseenTwin: true as const, unseenTwinCodes: [code] } : p
          )
      }
    })
    const own = PKM.find((p) => p.cardId === 1 && p.language === 'en')!.setCode
    const [number] = own.split(' ').at(-1)!.split('/')
    // "003/903" for 003/103: no printing has it, but 003 isn't the promo's 111.
    const signals = raw({ art: [twins[0]], codeTexts: [`FF ${number}/903`] })
    expect(await recognized(signals, ctx('MEP 111'))).toMatchObject({ cardId: 1 })
    // A twin of the same number (a Classic Collection reprint) still can't be told.
    expect(await resolveSignals(signals, ctx(`CLC ${number}/999`))).toEqual({ kind: 'unsure' })
  })

  it('a twin whose product photo is other art does not stop a card', async () => {
    const ctx = (distance: number): ResolveContext => ({
      ...pkm('en'),
      artDistance: async () => distance,
      lookups: {
        ...lookups,
        printingsForCards: async (ids) =>
          PKM.filter((p) => ids.includes(p.cardId)).map((p) =>
            p.cardId === 1
              ? { ...p, unseenTwin: true as const, unseenTwinCodes: ['X 1'], unseenTwinImages: [7] }
              : p
          )
      }
    })
    expect(await recognized(raw({ art: [twins[0]] }), ctx(136))).toMatchObject({ cardId: 1 })
    expect(await resolveSignals(raw({ art: [twins[0]] }), ctx(96))).toEqual({ kind: 'unsure' })
    // Close enough to be either: named, but only as a best guess.
    const maybe = { ...ctx(110), guessRules: ['twin-maybe' as const] }
    expect(await recognized(raw({ art: [twins[0]] }), maybe)).toMatchObject({
      cardId: 1,
      guess: true
    })
  })

  it('never names a card whose reprint of the art has no artwork to match', async () => {
    const ctx = (twinned: boolean): ResolveContext => ({
      ...pkm('en'),
      lookups: {
        ...lookups,
        printingsForCards: async (ids) =>
          PKM.filter((p) => ids.includes(p.cardId)).map((p) =>
            twinned && p.cardId === 1 ? { ...p, unseenTwin: true as const } : p
          )
      }
    })
    // A Classic Collection reprint matches its original's art, and has none of its own.
    expect(await resolveSignals(raw({ art: twins }), ctx(true))).toEqual({ kind: 'unsure' })
    expect(await recognized(raw({ art: twins }), ctx(false))).toMatchObject({ cardId: 1 })
    // Nor with its number read: a Classic Collection reprint prints its original's number (an
    // eBay Celebrations Tapu Lele GX read 60/145, the original's).
    expect(await resolveSignals(raw({ art: twins, codeTexts: ['045/193'] }), ctx(true))).toEqual({
      kind: 'unsure'
    })
  })

  it('zh text with ja art match is unsure', async () => {
    const art = [{ imageId: 201, distance: 20 }]
    expect(await resolveSignals(raw({ art }), pkm('other'))).toEqual({ kind: 'unsure' })
    // Even with the number agreeing: Chinese prints share Japanese numbers.
    expect(await resolveSignals(raw({ art, codeTexts: ['SV2a 025/165'] }), pkm('other'))).toEqual({
      kind: 'unsure'
    })
  })

  it('art alone takes one card in the read language, not a reprint with the same art', async () => {
    const reprints = [
      { imageId: 101, distance: 30 },
      { imageId: 301, distance: 32 }
    ]
    expect(await resolveSignals(raw({ art: reprints }), pkm('en'))).toEqual({ kind: 'unsure' })
    // Reprints' reference scans of one artwork differ by 20 bits and more: a real base set
    // Charmander matched its Legendary Collection reprint at 36 and itself at 58.
    const scans = [
      { imageId: 101, distance: 36 },
      { imageId: 301, distance: 58 }
    ]
    expect(await resolveSignals(raw({ art: scans }), pkm('en'))).toEqual({ kind: 'unsure' })
    // Far enough ahead, past PKM_ART_MIN_MARGIN, the closer card is taken over another card's art.
    const ahead = [
      { imageId: 101, distance: 30 },
      { imageId: 501, distance: 30 + PKM_ART_MIN_MARGIN + 2 }
    ]
    expect(await recognized(raw({ art: ahead }), pkm('en'))).toMatchObject({ cardId: 1 })
    // But not over a card of the same name still close enough to match: a reprint whose
    // reference is a poor product photo (a McDonald's Porygon matched itself at 60 and its
    // original at 28, a trainer kit's Pikachu Libre 74 against 34).
    const reprint = [
      { imageId: 101, distance: 30 },
      { imageId: 301, distance: 30 + PKM_ART_MIN_MARGIN + 2 }
    ]
    expect(await resolveSignals(raw({ art: reprint }), pkm('en'))).toEqual({ kind: 'unsure' })
    const past = [
      { imageId: 101, distance: 30 },
      { imageId: 301, distance: ART_MAX_DISTANCE + 1 }
    ]
    expect(await recognized(raw({ art: past }), pkm('en'))).toMatchObject({ cardId: 1 })
  })

  it('number decides between reprints', async () => {
    const reprints = [
      { imageId: 101, distance: 30 },
      { imageId: 301, distance: 31 }
    ]
    const item = await recognized(raw({ art: reprints, codeTexts: ['045/193'] }), pkm('en'))
    expect(item).toMatchObject({
      cardId: 1,
      via: 'code',
      setCode: 'SV3 045/193',
      printingId: 11,
      game: 'pkm'
    })
    expect(
      await recognized(raw({ art: reprints, codeTexts: ['201/182'] }), pkm('en'))
    ).toMatchObject({ cardId: 3, via: 'code' })
    // Not with the language unread: Traditional Chinese and European prints share number and art.
    expect(await resolveSignals(raw({ art: reprints, codeTexts: ['201/182'] }), pkm(null))).toEqual(
      { kind: 'unsure' }
    )
  })

  it('offers the reprints of its art in other sets, in its language, to switch to', async () => {
    const reprints = [
      { imageId: 101, distance: 30 },
      { imageId: 201, distance: 31 },
      { imageId: 301, distance: 32 }
    ]
    const item = await recognized(raw({ art: reprints, codeTexts: ['045/193'] }), pkm('en'))
    expect(item).toMatchObject({ cardId: 1, printingId: 11 })
    // Not the Japanese twin, nor Raichu: only Pikachu reprints in English.
    expect(item.options.map((o) => o.printingId)).toEqual([11, 31])
    // A card with no reprint near offers only its own versions.
    const alone = await recognized(raw({ art: [{ imageId: 401, distance: 20 }] }), pkm('en'))
    expect(alone.options.map((o) => o.printingId)).toEqual([41, 42])
  })

  it("offers an unseen twin's printings when they have an artwork", async () => {
    const withTwin = (withArt: boolean): ResolveContext => ({
      ...pkm('en'),
      guessRules: ['twin'],
      lookups: {
        ...lookups,
        printingsForCards: async (ids) =>
          (await lookups.printingsForCards(ids)).map((p) =>
            p.cardId === 1
              ? { ...p, unseenTwin: true as const, unseenTwinCodes: ['SV4 201/182'] }
              : p
          ),
        printingsByNumber: async (n) =>
          (await lookups.printingsByNumber(n)).map((p) => (withArt ? p : { ...p, imageIds: [] }))
      }
    })
    const art = [{ imageId: 101, distance: 20 }]
    const item = await recognized(raw({ art }), withTwin(true))
    expect(item.options.map((o) => o.printingId)).toEqual([11, 31])
    const bare = await recognized(raw({ art }), withTwin(false))
    expect(bare.options.map((o) => o.printingId)).toEqual([11])
  })

  it('number and art disagree is unsure', async () => {
    const art = [{ imageId: 101, distance: 20 }]
    const ctx = pkm('en')
    expect(await resolveSignals(raw({ art, codeTexts: ['026/165'] }), ctx)).toEqual({
      kind: 'unsure'
    })
    expect(ctx.readLanguage).not.toHaveBeenCalled()
  })

  it('number alone needs the name to agree', async () => {
    const number = { codeTexts: ['026/165'] }
    expect(await recognized(raw({ ...number, nameTexts: ['Raichu'] }), pkm('en'))).toMatchObject({
      cardId: 5,
      via: 'code'
    })
    expect(await resolveSignals(raw({ ...number, nameTexts: ['Pikachu'] }), pkm('en'))).toEqual({
      kind: 'unsure'
    })
    expect(await resolveSignals(raw(number), pkm('en'))).toEqual({ kind: 'unsure' })
    // Japanese names, which have no Latin letters to compare, are compared as they are.
    const ja = { codeTexts: ['025/165'] }
    expect(await recognized(raw({ ...ja, nameTexts: ['ピカチュウ'] }), pkm('ja'))).toMatchObject({
      cardId: 2,
      via: 'code'
    })
    expect(await resolveSignals(raw({ ...ja, nameTexts: ['ライチュウ'] }), pkm('ja'))).toEqual({
      kind: 'unsure'
    })
    // Nor without the language read.
    expect(await resolveSignals(raw({ ...number, nameTexts: ['Raichu'] }), pkm(null))).toEqual({
      kind: 'unsure'
    })
  })

  it('single version is sure, several give pick-printing', async () => {
    const one = await recognized(raw({ art: [{ imageId: 301, distance: 10 }] }), pkm('en'))
    expect(one).toMatchObject({
      cardId: 3,
      printingId: 31,
      rarity: 'Holofoil',
      setCode: 'SV4 201/182',
      flag: null
    })
    const several = await recognized(raw({ art: [{ imageId: 401, distance: 10 }] }), pkm('en'))
    expect(several).toMatchObject({
      cardId: 4,
      printingId: 42,
      rarity: 'Normal',
      setCode: 'PRE 074/131',
      flag: 'check-rarity'
    })
    expect(several.options.map((o) => o.printingId)).toEqual([41, 42])
  })

  it('art past the far distance is nothing in view; a near miss is unsure', async () => {
    const ctx = pkm('en')
    expect(
      await resolveSignals(raw({ art: [{ imageId: 101, distance: ART_FAR_DISTANCE + 1 }] }), ctx)
    ).toEqual({ kind: 'none', far: true })
    expect(
      await resolveSignals(raw({ art: [{ imageId: 101, distance: ART_MAX_DISTANCE + 1 }] }), ctx)
    ).toEqual({ kind: 'unsure' })
    // An empty art group and no number has nothing to name.
    expect(await resolveSignals(raw({}), ctx)).toEqual({ kind: 'unsure' })
    expect(ctx.readLanguage).not.toHaveBeenCalled()
  })

  it('a language read that fails is unread: unsure, not a throw', async () => {
    const ctx: ResolveContext = {
      ...pkm('en'),
      readLanguage: async () => {
        throw new Error('OCR failed')
      }
    }
    expect(await resolveSignals(raw({ art: twins }), ctx)).toEqual({ kind: 'unsure' })
    expect(await resolveSignals(raw({ art: twins, codeTexts: ['045/193'] }), ctx)).toEqual({
      kind: 'unsure'
    })
  })

  it('an artwork missing from the catalog in the art group is unsure', async () => {
    const art = [
      { imageId: 101, distance: 30 },
      { imageId: 999, distance: 32 }
    ]
    expect(await resolveSignals(raw({ art }), pkm('en'))).toEqual({ kind: 'unsure' })
  })

  it('a card back in view is nothing, though its art came near a card', async () => {
    // A pile of backs on the desk: outlined with the desk around it, the closest art is a card's
    // under the art limit, and the back's own outline, over it, came close to a card back.
    const art = [
      { imageId: 101, distance: 74 },
      { imageId: 201, distance: 76 }
    ]
    const ctx = guessing('en')
    expect(await recognized(raw({ art }), ctx)).toMatchObject({ cardId: 1 })
    expect(await resolveSignals(raw({ art, artBack: 22 }), ctx)).toEqual({ kind: 'none' })
    // Not even a number read names it.
    expect(await resolveSignals(raw({ art, artBack: 22, codeTexts: ['045/193'] }), ctx)).toEqual({
      kind: 'none'
    })
  })

  it('a card is named when no back came close, or its own art came closer', async () => {
    const ctx = pkm('en')
    const far = [
      { imageId: 101, distance: 74 },
      { imageId: 201, distance: 76 }
    ]
    expect(
      await recognized(raw({ art: far, artBack: CARD_BACK_MAX_DISTANCE + 1 }), ctx)
    ).toMatchObject({ cardId: 1 })
    // A card held over a pile of backs: its art matched closer than the backs.
    expect(await recognized(raw({ art: twins, artBack: 40 }), ctx)).toMatchObject({ cardId: 1 })
  })
})

describe('Simplified Chinese, as the user said', () => {
  // MEGA Expansion 30th Celebration (ja) and 30th Celebration (zh-hans) share every number and
  // name; the Chinese cards have no art of their own. Gengar's Classic Collection reprint prints
  // 150/103 with Base Set's art. Two Chinese sets print an Eevee at 020/103. Chinese Pikachu has
  // its own art.
  const p = (
    printingId: number,
    cardId: number,
    name: string,
    language: 'en' | 'ja' | 'zh-hans',
    setName: string,
    setCode: string,
    imageId: number
  ): ScanPrinting =>
    printing({
      printingId,
      cardId,
      name,
      frameType: 'pokemon',
      setName,
      setCode,
      rarity: 'Holofoil',
      language,
      price: 1,
      imageIds: [imageId]
    })
  const ZH: ScanPrinting[] = [
    p(911, 91, 'Gengar', 'ja', 'MEGA Expansion 30th Celebration', 'M6A 150/103', 901),
    p(921, 92, 'Gengar', 'en', 'Base Set', 'BS 5/102', 902),
    p(931, 93, 'Gengar', 'zh-hans', '30th Celebration', '30thC 150/103', 903),
    p(941, 94, 'Exeggcute', 'zh-hans', '30th Celebration', '30thC 001/103', 904),
    p(951, 95, 'Exeggcute', 'ja', 'MEGA Expansion 30th Celebration', 'M6A 001/103', 905),
    p(961, 96, 'Pikachu', 'zh-hans', 'Gem Pack', 'CBB1C 010/100', 906),
    p(971, 97, 'Eevee', 'zh-hans', '30th Celebration', '30thC 020/103', 907),
    p(981, 98, 'Eevee', 'zh-hans', 'Other Set', 'CSV9C 020/103', 908),
    p(991, 99, 'Eevee', 'ja', 'MEGA Expansion 30th Celebration', 'M6A 020/103', 909),
    p(1001, 100, 'Mew', 'ja', 'MEGA Expansion 30th Celebration', 'M6A 151/103', 910),
    p(1011, 101, 'Poke Pad', 'ja', 'MEGA Expansion 30th Celebration', 'M6A 102/103', 911),
    p(1021, 102, 'Poké Pad', 'zh-hans', '30th Celebration', '30thC 102/103', 912)
  ]
  const zhLookups: ResolveContext['lookups'] = {
    printingsByCode: async () => [],
    printingsByNumber: async (n) =>
      ZH.filter((q) => {
        const [abbrev, num] = q.setCode.split(' ')
        const [number, total] = num.split('/')
        return (
          Number(number) === Number(n.number) &&
          (n.total === null || Number(total) === Number(n.total)) &&
          (n.setAbbrev === null || abbrev.toUpperCase() === n.setAbbrev)
        )
      }),
    printingsForCards: async (ids) => ZH.filter((q) => ids.includes(q.cardId)),
    matchName: async () => null,
    cardsForImages: async (ids) =>
      ZH.map((q) => ({ imageId: q.imageIds[0], cardId: q.cardId })).filter((c) =>
        ids.includes(c.imageId)
      )
  }
  const zh = (setPrintings: ScanPrinting[] | null = null): ResolveContext => ({
    game: 'pkm',
    setName: setPrintings ? '30th Celebration' : null,
    setPrintings,
    defaultRarity: null,
    guessRules: undefined,
    readLanguage: async () => 'zh-hans',
    readLocalName: async () => [],
    lookups: zhLookups
  })
  const set = ZH.filter((q) => q.setName === '30th Celebration')

  it("names the Chinese card that prints its Japanese twin's number and name", async () => {
    const art = [{ imageId: 905, distance: 20 }]
    expect(await recognized(raw({ art }), zh())).toMatchObject({
      cardId: 94,
      printingId: 941,
      setCode: '30thC 001/103',
      via: 'art'
    })
    // In the picked set too.
    expect(await recognized(raw({ art }), zh(set))).toMatchObject({ cardId: 94 })
  })

  it('names a Classic Collection card, whose art its original shares', async () => {
    const art = [
      { imageId: 901, distance: 20 },
      { imageId: 902, distance: 22 }
    ]
    expect(await recognized(raw({ art }), zh())).toMatchObject({ cardId: 93, via: 'art' })
    expect(await recognized(raw({ art, codeTexts: ['150/103'] }), zh(set))).toMatchObject({
      cardId: 93,
      via: 'code'
    })
  })

  it("names a Chinese card whose name the twin's spells without its accent", async () => {
    const art = [{ imageId: 911, distance: 20 }]
    expect(await recognized(raw({ art }), zh())).toMatchObject({ cardId: 102 })
  })

  it('names a Chinese card by its own art', async () => {
    const art = [{ imageId: 906, distance: 20 }]
    expect(await recognized(raw({ art }), zh())).toMatchObject({ cardId: 96 })
  })

  it('never names the twin itself, nor a card with no Chinese twin', async () => {
    // Mew has no Chinese card at its number.
    expect(await resolveSignals(raw({ art: [{ imageId: 910, distance: 20 }] }), zh())).toEqual({
      kind: 'unsure'
    })
    // Exeggcute's twin is outside the picked set.
    const other = ZH.filter((q) => q.setName === 'Other Set')
    expect(await resolveSignals(raw({ art: [{ imageId: 905, distance: 20 }] }), zh(other))).toEqual(
      { kind: 'unsure' }
    )
  })

  it("is unsure when two Chinese cards print the twin's name and number", async () => {
    const art = [{ imageId: 909, distance: 20 }]
    expect(await resolveSignals(raw({ art }), zh())).toEqual({ kind: 'unsure' })
    // The picked set tells them apart.
    expect(await recognized(raw({ art }), zh(set))).toMatchObject({ cardId: 97 })
  })

  describe("a main set's card, renumbered, through the English card whose art the catalog shows", () => {
    // Ardent Obsidian (CSV5C) gathers Obsidian Flames and Paradox Rift cards under its own
    // numbers. Its Kingambit shows OBF Kingambit's art; Deoxys is reprinted in another Chinese set.
    const MAIN: ScanPrinting[] = [
      p(2011, 201, 'Kingambit', 'en', 'Obsidian Flames', 'OBF 150/197', 2001),
      p(2021, 202, 'Kingambit', 'zh-hans', 'Ardent Obsidian', 'CSV5C 098', 2002),
      p(2031, 203, 'Deoxys', 'en', 'Paradox Rift', 'PAR 074/182', 2003),
      p(2041, 204, 'Deoxys', 'zh-hans', 'Ardent Obsidian', 'CSV5C 055', 2004),
      p(2051, 205, 'Deoxys', 'zh-hans', 'Other Set', 'CSVH3C 014', 2005),
      p(2061, 206, 'Deoxys', 'ja', 'Ancient Roar', 'SV4K 040/66', 2006)
    ]
    const ALL = [...ZH, ...MAIN]
    const links: Record<number, number> = { 202: 201, 204: 203, 205: 203 }
    const mainLookups: ResolveContext['lookups'] = {
      ...zhLookups,
      printingsForCards: async (ids) => ALL.filter((q) => ids.includes(q.cardId)),
      cardsForImages: async (ids) =>
        ALL.map((q) => ({ imageId: q.imageIds[0], cardId: q.cardId })).filter((c) =>
          ids.includes(c.imageId)
        ),
      chineseOfArt: async (ids) =>
        MAIN.filter((q) => ids.includes(links[q.cardId])).map((q) => ({
          twinId: links[q.cardId],
          printing: q
        }))
    }
    const main = (setPrintings: ScanPrinting[] | null = null): ResolveContext => ({
      ...zh(setPrintings),
      setName: setPrintings?.[0]?.setName ?? null,
      lookups: mainLookups
    })
    const ardent = MAIN.filter((q) => q.setName === 'Ardent Obsidian')

    it('names the Chinese card the English art is linked to', async () => {
      const art = [{ imageId: 2001, distance: 20 }]
      expect(await recognized(raw({ art }), main())).toMatchObject({
        cardId: 202,
        setCode: 'CSV5C 098',
        via: 'art'
      })
      expect(await recognized(raw({ art }), main(ardent))).toMatchObject({ cardId: 202 })
    })

    it('is unsure across two Chinese reprints until their set is picked', async () => {
      // The Japanese print's art is closest; the English one, just behind, carries the link.
      const art = [
        { imageId: 2006, distance: 18 },
        { imageId: 2003, distance: 20 }
      ]
      expect(await resolveSignals(raw({ art }), main())).toEqual({ kind: 'unsure' })
      expect(await recognized(raw({ art }), main(ardent))).toMatchObject({ cardId: 204 })
    })

    it('stands in only by number without the link lookup', async () => {
      const art = [{ imageId: 2001, distance: 20 }]
      const unlinked = { ...mainLookups, chineseOfArt: undefined }
      expect(await resolveSignals(raw({ art }), { ...main(), lookups: unlinked })).toEqual({
        kind: 'unsure'
      })
    })
  })
})

describe('art found only by the holder search', () => {
  // More quads looked at mean more chances of a chance match, so such a match must also clear
  // PKM_ART_MIN_MARGIN against the next card of another name, over every match ranked.
  const holder = (r: Partial<RawSignals>): RawSignals => raw({ ...r, artVia: 'holder' })

  it('names nothing when a card of another name is within the margin, even past the art limit', async () => {
    // Raichu past ART_MAX_DISTANCE is outside the art group, so the first search names Pikachu.
    const art = [
      { imageId: 101, distance: 70 },
      { imageId: 501, distance: ART_MAX_DISTANCE + 10 }
    ]
    expect(await recognized(raw({ art }), pkm('en'))).toMatchObject({ cardId: 1 })
    expect(await resolveSignals(holder({ art }), pkm('en'))).toEqual({ kind: 'unsure' })
    // Exactly the margin behind isn't past it.
    const edge = [
      { imageId: 101, distance: 30 },
      { imageId: 501, distance: 30 + PKM_ART_MIN_MARGIN }
    ]
    expect(await resolveSignals(holder({ art: edge }), pkm('en'))).toEqual({ kind: 'unsure' })
  })

  it('names the card when the next of another name is past the margin', async () => {
    const art = [
      { imageId: 101, distance: 60 },
      { imageId: 501, distance: 60 + PKM_ART_MIN_MARGIN + 1 }
    ]
    expect(await recognized(holder({ art }), pkm('en'))).toMatchObject({ cardId: 1, via: 'art' })
  })

  it("doesn't count a reprint of the same name, which the number still tells apart", async () => {
    const art = [
      { imageId: 101, distance: 30 },
      { imageId: 301, distance: 40 },
      { imageId: 501, distance: 30 + PKM_ART_MIN_MARGIN + 1 }
    ]
    expect(await recognized(holder({ art, codeTexts: ['045/193'] }), pkm('en'))).toMatchObject({
      cardId: 1,
      via: 'code'
    })
  })

  it('names nothing when a match ranked before another name is missing from the catalog', async () => {
    const art = [
      { imageId: 101, distance: 30 },
      { imageId: 999, distance: 90 },
      { imageId: 501, distance: 100 }
    ]
    expect(await recognized(raw({ art }), pkm('en'))).toMatchObject({ cardId: 1 })
    expect(await resolveSignals(holder({ art }), pkm('en'))).toEqual({ kind: 'unsure' })
  })
})

describe('best guesses', () => {
  const unsure = { kind: 'unsure' }

  it('a certain card carries no guess', async () => {
    const item = await recognized(raw({ art: twins }), guessing('en'))
    expect(item).toMatchObject({ cardId: 1 })
    expect('guess' in item).toBe(false)
  })

  it('language: a name band that nearly reads a name picks its card and language', async () => {
    const en = raw({ art: twins, nameTexts: ['Pikch'] })
    expect(await recognized(en, guessing(null))).toMatchObject({ cardId: 1, guess: true })
    const ja = await recognized(raw({ art: twins }), guessing('kanji', ['ピカチ']))
    expect(ja).toMatchObject({ cardId: 2, guess: true })
  })

  it('language: never with nothing like a name read, as a Chinese card reads', async () => {
    const zh = raw({ art: twins, nameTexts: ['ZERIT', 'al NL'] })
    expect(await resolveSignals(zh, guessing(null, ['空 宋 中 管']))).toEqual(unsure)
    expect(await resolveSignals(zh, guessing('kanji', ['空 宋 中 管']))).toEqual(unsure)
  })

  it('language: never against text read as another language', async () => {
    const r = raw({ art: twins, nameTexts: ['Pikachu'] })
    expect(await resolveSignals(r, guessing('other', ['ピカチュウ']))).toEqual(unsure)
  })

  it('reprint: the closest art, given enough of a lead', async () => {
    const art = (lead: number): RawSignals =>
      raw({
        art: [
          { imageId: 301, distance: 30 },
          { imageId: 101, distance: 30 + lead }
        ]
      })
    expect(await recognized(art(PKM_GUESS_REPRINT_LEAD), guessing('en'))).toMatchObject({
      cardId: 3,
      guess: true
    })
  })

  it('reprint: a photo asks for a lead the live frames do not', async () => {
    const tied = raw({
      art: [
        { imageId: 301, distance: 30 },
        { imageId: 101, distance: 30 }
      ]
    })
    expect(await recognized(tied, guessing('en'))).toMatchObject({ cardId: 3, guess: true })
    const photo = { ...guessing('en'), reprintLead: PKM_PHOTO_REPRINT_LEAD }
    expect((await resolveSignals(tied, photo)).kind).toBe('unsure')
  })

  it('reprint: never among cards of different names', async () => {
    const art = [
      { imageId: 101, distance: 30 },
      { imageId: 501, distance: 50 }
    ]
    expect(await resolveSignals(raw({ art }), guessing('en'))).toEqual(unsure)
  })

  it('misread: a number naming nothing in the art group is ignored', async () => {
    const art = [{ imageId: 101, distance: 20 }]
    const item = await recognized(raw({ art, codeTexts: ['026/165'] }), guessing('en'))
    expect(item).toMatchObject({ cardId: 1, via: 'art', guess: true })
  })

  it('holder: art with another name close is a guess', async () => {
    const art = [
      { imageId: 101, distance: 70 },
      { imageId: 501, distance: ART_MAX_DISTANCE + 10 }
    ]
    const item = await recognized(raw({ art, artVia: 'holder' }), guessing('en'))
    expect(item).toMatchObject({ cardId: 1, guess: true })
  })

  it('left off: a reprint behind the margin or with no artwork stays unsure', async () => {
    const behind = [
      { imageId: 101, distance: 30 },
      { imageId: 301, distance: 30 + PKM_ART_MIN_MARGIN + 2 }
    ]
    expect(await resolveSignals(raw({ art: behind }), guessing('en'))).toEqual(unsure)
    const seenTwin: ResolveContext = {
      ...guessing('en'),
      lookups: {
        ...lookups,
        printingsForCards: async (ids) =>
          (await lookups.printingsForCards(ids)).map((p) => ({ ...p, unseenTwin: true as const }))
      }
    }
    expect(await resolveSignals(raw({ art: twins }), seenTwin)).toEqual(unsure)
  })

  it('a rule left out of guessRules guesses nothing', async () => {
    const art = [{ imageId: 101, distance: 20 }]
    const ctx = { ...guessing('en'), guessRules: ['language' as const] }
    expect(await resolveSignals(raw({ art, codeTexts: ['026/165'] }), ctx)).toEqual(unsure)
  })
})

describe('ygo path unchanged', () => {
  // Two cases from scan-resolve.test.ts, with the game said and left out.
  const DM = {
    cardId: 1,
    name: 'Dark Magician',
    frameType: 'normal',
    price: null,
    imageIds: [101, 102]
  }
  const LOB = 'Legend of Blue Eyes White Dragon'
  const YGO: ScanPrinting[] = [
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
    {
      ...DM,
      printingId: 13,
      setName: 'Starter Deck: Yugi',
      setCode: 'SDY-EN006',
      rarity: 'Common',
      language: 'en'
    }
  ]
  const ygoLookups: ResolveContext['lookups'] = {
    printingsByCode: async (code) => YGO.filter((p) => p.setCode === code),
    printingsByNumber: async () => [],
    printingsForCards: async (ids) => YGO.filter((p) => ids.includes(p.cardId)),
    matchName: async () => null,
    cardsForImages: async (ids) =>
      DM.imageIds.filter((i) => ids.includes(i)).map((imageId) => ({ imageId, cardId: 1 }))
  }
  const base = { setName: null, setPrintings: null, defaultRarity: null, lookups: ygoLookups }

  it.each([
    ['left out', base],
    ['ygo', { ...base, game: 'ygo' as const }]
  ])('game %s', async (_, ctx) => {
    const code = await recognized(
      raw({ codeTexts: ['SDY-EN006'], art: [{ imageId: 102, distance: 5 }] }),
      ctx
    )
    expect(code).toEqual({
      cardId: 1,
      name: 'Dark Magician',
      imageId: 102,
      printingId: 13,
      setCode: 'SDY-EN006',
      rarity: 'Common',
      options: [YGO[2]],
      flag: null,
      via: 'code'
    })
    const art = await recognized(raw({ art: [{ imageId: 102, distance: 20 }] }), ctx)
    expect(art).toEqual({
      cardId: 1,
      name: 'Dark Magician',
      imageId: 102,
      printingId: 13,
      setCode: 'SDY-EN006',
      rarity: 'Common',
      options: YGO,
      flag: 'pick-printing',
      via: 'art'
    })
    expect('game' in art || 'slab' in art).toBe(false)
  })
})

describe('Pokémon version cues (rule 7)', () => {
  const art = [{ imageId: 401, distance: 10 }]
  const sure = (frame: number, art: number): RawSignals['version'] => ({
    frame,
    art,
    reference: 0,
    firstEdition: 'unknown'
  })

  /** Card 4 with its versions replaced by labels (priced 2, 3, ...). */
  const withVersions = (labels: string[], printedRarity?: string): ResolveContext => {
    const ctx = pkm('en')
    const [base] = PKM.filter((p) => p.cardId === 4)
    return {
      ...ctx,
      lookups: {
        ...ctx.lookups,
        printingsForCards: async (ids) =>
          ids[0] === 4
            ? labels.map((rarity, i) => ({
                ...base,
                printingId: 900 + i,
                rarity,
                price: 2 + i,
                printedRarity
              }))
            : ctx.lookups.printingsForCards(ids)
      }
    }
  }

  it('a decisive cue that names one of the versions picks it, with no flag', async () => {
    const out = await recognized(
      raw({ art, version: sure(0, 99) }),
      withVersions(['Normal', 'Holofoil'])
    )
    expect(out).toMatchObject({ flag: null, printingId: 901, rarity: 'Holofoil' })
  })

  it('frame foil never names Reverse Holofoil: a webcam frame reads alike either way', async () => {
    const out = await recognized(raw({ art, version: sure(99, 0) }), pkm('en'))
    expect(out).toMatchObject({ flag: 'check-rarity', printingId: 42 })
  })

  it('a decisive cue for a version the card lacks keeps pick-printing', async () => {
    const out = await recognized(raw({ art, version: sure(0, 99) }), pkm('en'))
    expect(out).toMatchObject({ flag: 'check-rarity', printingId: 42 })
  })

  it('an undecided cue keeps pick-printing on the cheapest', async () => {
    const out = await recognized(raw({ art, version: sure(0.1, 0.1) }), pkm('en'))
    expect(out).toMatchObject({ flag: 'check-rarity', printingId: 42 })
  })

  it('an unnamed version falls on Normal, though a reverse holo is cheaper', async () => {
    const out = await recognized(
      raw({ art, version: sure(0.1, 0.1) }),
      withVersions(['Reverse Holofoil', 'Normal', 'Holofoil'])
    )
    expect(out).toMatchObject({ flag: 'check-rarity', printingId: 901, rarity: 'Normal' })
  })

  it.each([
    ['Holo Rare', 'Holofoil'],
    ['Ultra Rare', 'Holofoil'],
    ['Common', 'Normal'],
    ['Uncommon', 'Normal'],
    ['Rare', 'Normal'],
    ['None', 'Normal'],
    [undefined, 'Normal']
  ])('a card printed %s falls on its %s version', async (printedRarity, rarity) => {
    const out = await recognized(
      raw({ art, version: sure(0.1, 0.1) }),
      withVersions(['Reverse Holofoil', 'Normal', 'Holofoil'], printedRarity)
    )
    expect(out).toMatchObject({ flag: 'check-rarity', rarity })
  })

  it('an unnamed version falls on Holofoil where there is no Normal', async () => {
    const out = await recognized(
      raw({ art, version: sure(0.1, 0.1) }),
      withVersions(['Reverse Holofoil', 'Holofoil'])
    )
    expect(out).toMatchObject({ flag: 'check-rarity', printingId: 901, rarity: 'Holofoil' })
  })

  it('a 1st Edition twin or a repeated label keeps pick-printing', async () => {
    for (const labels of [
      ['Reverse Holofoil', '1st Edition Reverse Holofoil'],
      ['Reverse Holofoil', 'Reverse Holofoil']
    ]) {
      const out = await recognized(raw({ art, version: sure(99, 0) }), withVersions(labels))
      expect(out).toMatchObject({ flag: 'pick-printing', printingId: 900 })
    }
  })

  it('slab flag rides on the draft', async () => {
    const art = [{ imageId: 101, distance: 30 }]
    expect(await recognized(raw({ art, slab: true }), pkm('en'))).toMatchObject({ slab: true })
    const bare = await recognized(raw({ art, slab: false }), pkm('en'))
    expect('slab' in bare).toBe(false)
    expect('slab' in (await recognized(raw({ art }), pkm('en')))).toBe(false)
  })
})

describe('the name read, in a picked set the art matched nothing in', () => {
  // 30th Celebration's two Lapras (017 and the full-art 131) and its Snorlax.
  const SET: ScanPrinting[] = [
    [71, '30th 017/128', 'Holofoil', 701, 'Lapras'],
    [72, '30th 131/128', 'Illustration Rare', 702, 'Lapras'],
    [73, '30th 051/128', 'Normal', 703, 'Snorlax']
  ].map(([cardId, setCode, rarity, imageId, name]) =>
    printing({
      printingId: (cardId as number) * 10,
      cardId: cardId as number,
      name: name as string,
      frameType: 'pokemon',
      setName: '30th Celebration',
      setCode: setCode as string,
      rarity: rarity as string,
      language: 'en',
      imageIds: [imageId as number]
    })
  )
  const ALL = [...PKM, ...SET]
  const inSet = (picked: boolean): ResolveContext => ({
    ...pkm(null),
    guessRules: undefined,
    readLocalName: async () => [],
    setName: picked ? '30th Celebration' : null,
    setPrintings: picked ? SET : null,
    lookups: {
      ...lookups,
      printingsForCards: async (ids) => ALL.filter((p) => ids.includes(p.cardId)),
      cardsForImages: async (ids) =>
        ALL.flatMap((p) => p.imageIds.map((imageId) => ({ imageId, cardId: p.cardId }))).filter(
          (c, i, all) =>
            ids.includes(c.imageId) && all.findIndex((d) => d.imageId === c.imageId) === i
        )
    }
  })
  /** Every artwork searched, none within ART_MAX_DISTANCE. */
  const far = (lapras131: number, lapras017: number, snorlax = 120) =>
    [
      { imageId: 702, distance: lapras131 },
      { imageId: 701, distance: lapras017 },
      { imageId: 703, distance: snorlax }
    ].sort((a, b) => a.distance - b.distance)

  it('names the one card of the name, a misread letter and all', async () => {
    const out = await recognized(
      raw({ art: far(110, 110, 104), nameTexts: ['Snorlex HP'] }),
      inSet(true)
    )
    expect(out).toMatchObject({ cardId: 73, via: 'name' })
    expect(out.guess).toBeFalsy()
  })

  it('names nothing when another card of the set is closer by art (a card of another set)', async () => {
    for (const nameTexts of [['Snorlax'], ['Lapras']]) {
      const art = nameTexts[0] === 'Snorlax' ? far(100, 110, 104) : far(110, 112, 100)
      expect((await resolveSignals(raw({ art, nameTexts }), inSet(true))).kind).not.toBe(
        'recognized'
      )
    }
  })

  it('tells two cards of the name by the art, as a guess, only when it leads clearly', async () => {
    const out = await recognized(
      raw({ art: far(108, 124), nameTexts: ['LaAprase vr'] }),
      inSet(true)
    )
    expect(out).toMatchObject({ cardId: 72, via: 'name', guess: true })
    expect(
      (await resolveSignals(raw({ art: far(116, 120), nameTexts: ['Lapras'] }), inSet(true))).kind
    ).not.toBe('recognized')
  })

  it('names nothing on a read near no name of the set, or as near two', async () => {
    for (const nameTexts of [['Lapa'], ['Lapras Snorlax']])
      expect(
        (await resolveSignals(raw({ art: far(110, 120), nameTexts }), inSet(true))).kind
      ).not.toBe('recognized')
  })

  it('names nothing with no set picked, or a name no card of the set has', async () => {
    expect(
      (await resolveSignals(raw({ art: far(108, 124), nameTexts: ['Lapras'] }), inSet(false))).kind
    ).not.toBe('recognized')
    expect(
      (await resolveSignals(raw({ art: far(108, 124), nameTexts: ['Pikachu'] }), inSet(true))).kind
    ).not.toBe('recognized')
  })

  it('leaves a card the art matched to the art', async () => {
    const out = await recognized(
      raw({ art: [{ imageId: 701, distance: 40 }], nameTexts: ['Snorlax'] }),
      { ...inSet(true), readLanguage: vi.fn(async () => 'en' as const) }
    )
    expect(out).toMatchObject({ cardId: 71, via: 'art' })
  })
})
