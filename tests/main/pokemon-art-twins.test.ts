import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { borrowedArt, traditionalArt } from '../../src/main/repo/cards'
import { listSets } from '../../src/main/repo/sets'
import { setMeta } from '../../src/main/db/meta'
import { pokemonId } from '../../src/shared/games/ids'
import {
  englishTwins,
  traditionalTwins,
  type EnglishPlan,
  type TraditionalPlan
} from '../../scripts/catalog/pokemon/artTwins'
import { chineseListSets, type ZhCard } from '../../scripts/catalog/pokemon/chinese'
import { refreshPokemon } from '../../scripts/catalog/pokemon/write'
import type { PkmLang, PokemonSources, TdCard, TdSet } from '../../scripts/catalog/pokemon/types'

const OBF = { id: 'sv03', name: 'Obsidian Flames' }

const en = (localId: string, name: string, rarity: string, over: Partial<TdCard> = {}): TdCard => ({
  id: `sv03-${localId}`,
  localId,
  name,
  rarity,
  category: 'Pokemon',
  hp: 60,
  illustrator: 'A',
  image: `https://assets.tcgdex.net/en/sv/sv03/${localId}`,
  set: OBF,
  ...over
})

const enSet = (cards: TdCard[], over: Partial<TdSet> = {}): EnglishPlan => ({
  set: {
    ...OBF,
    serie: { id: 'sv' },
    abbreviation: { official: 'OBF' },
    cardCount: { official: 197 },
    cards: [],
    ...over
  },
  cards: cards.map((card) => ({ card, imageUrl: card.image ?? null }))
})

const ZH_SET: TdSet = { id: 'CSV5C', name: 'x', serie: { id: 'Scarlet & Violet' }, cards: [] }

const zh = (number: string, mark: string, setCode = 'OBF'): TdCard => ({
  id: `CSV5C-${number}`,
  localId: number,
  name: 'x',
  englishTwin: { setCode, number, mark },
  set: { id: 'CSV5C', name: 'x' }
})

describe('englishTwins', () => {
  const find = (sets: EnglishPlan[], card: TdCard, name: string): string =>
    englishTwins(sets).find(card, name).outcome

  it('links a card whose set, number and name agree, whatever the number padding', () => {
    const r = englishTwins([enSet([en('001', 'Oddish', 'Common')])]).find(zh('1', 'C'), 'ODDISH')
    expect(r.outcome).toBe('linked')
    expect(r.twin?.id).toBe('sv03-001')
  })

  it('matches names across accents and spacing, not across a different name', () => {
    const sets = [enSet([en('001', 'Flabébé', 'Common')])]
    expect(find(sets, zh('1', 'C'), 'Flabebe')).toBe('linked')
    expect(find(sets, zh('1', 'C'), 'Floette')).toBe('name mismatch')
  })

  it('counts a set no English set has, and a code two sets share, as unmapped', () => {
    expect(find([enSet([en('001', 'Oddish', 'Common')])], zh('1', 'C', 'XXX'), 'Oddish')).toBe('unmapped set')
    const two = [enSet([en('001', 'Oddish', 'Common')]), enSet([en('001', 'Oddish', 'Common')])]
    expect(find(two, zh('1', 'C'), 'Oddish')).toBe('unmapped set')
  })

  it('never reads a set id as a code: "SP" is not TCGdex\'s Sample set', () => {
    const sample = enSet([en('1', 'Oddish', 'Common')], { id: 'sp', abbreviation: undefined })
    expect(find([sample], zh('1', 'C', 'SP'), 'Oddish')).toBe('unmapped set')
  })

  it('counts a number the English set lacks', () => {
    expect(find([enSet([en('001', 'Oddish', 'Common')])], zh('2', 'C'), 'Oddish')).toBe('number missing')
  })

  it('links whatever the print: the label says the art is English', () => {
    const sets = [enSet([en('002', 'Gloom', 'Common'), en('125', 'Charizard ex', 'Double rare')])]
    expect(find(sets, zh('2', 'AR'), 'Gloom')).toBe('linked')
    expect(find(sets, zh('125', 'SAR'), 'Charizard ex')).toBe('linked')
    expect(find(sets, zh('2', '无标记'), 'Gloom')).toBe('linked')
    expect(find(sets, zh('125', 'U'), 'Charizard ex')).toBe('linked')
  })

  it('links a twin from another series, or past the printed count', () => {
    const sm = enSet([en('123', 'Nest Ball', 'Uncommon')], { serie: { id: 'sm' } })
    expect(find([sm], zh('123', 'U'), 'Nest Ball')).toBe('linked')
    expect(find([enSet([en('223', 'Charizard ex', 'Common')])], zh('223', 'C'), 'Charizard ex')).toBe('linked')
  })

  it('links one of several prints of the same rules', () => {
    const a = en('010', 'Pikachu', 'Common')
    const other = en('020', 'Pikachu', 'Common', { illustrator: 'B' })
    expect(find([enSet([a, other])], zh('10', 'C'), 'Pikachu')).toBe('linked')
  })

  it('counts a twin with no art, and a card with no twin', () => {
    expect(find([enSet([en('001', 'Oddish', 'Common', { image: undefined })])], zh('1', 'C'), 'Oddish')).toBe(
      'no English art'
    )
    expect(find([enSet([])], { ...zh('1', 'C'), englishTwin: undefined }, 'Oddish')).toBe('no twin')
  })
})

describe('traditionalTwins', () => {
  const hant = (
    localId: string,
    name: string,
    over: Partial<TdCard> = {},
    imageUrl: string | null = `https://assets.tcgdex.net/zh-tw/${localId}`
  ): TraditionalPlan['cards'][number] => ({
    card: { id: `SV8-${localId}`, localId, name: '走路草', category: 'Pokemon', set: { id: 'SV8', name: 'x' }, ...over },
    name,
    imageUrl
  })
  const plans = (...cards: TraditionalPlan['cards']): TraditionalPlan[] => [
    { set: { id: 'SV8', name: 'x', serie: { id: 'sv' }, cards: [] }, cards }
  ]
  const hans = (over: Partial<TdCard> = {}): TdCard => ({
    id: 'CSV5C-001',
    localId: '001',
    name: 'Oddish',
    category: 'Pokemon',
    set: { id: 'CSV5C', name: 'x' },
    ...over
  })
  const find = (
    list: TraditionalPlan[],
    card: TdCard = hans(),
    name = 'Oddish'
  ): ReturnType<ReturnType<typeof traditionalTwins>['find']> =>
    traditionalTwins(list).find(card, name, 'CSV5C')

  it('links the one card of the name and category, across case and accents', () => {
    const r = find(plans(hant('001', 'ODDISH')))
    expect(r.outcome).toBe('linked')
    expect(r.twin?.id).toBe('SV8-001')
    expect(find(plans(hant('001', 'Flabébé')), hans(), 'Flabebe').outcome).toBe('linked')
  })

  it('counts a name no Traditional card has', () => {
    expect(find(plans(hant('001', 'Gloom'))).outcome).toBe('no candidate')
  })

  it('never takes a card of another category', () => {
    const r = find(plans(hant('001', 'Oddish', { category: 'Trainer' })))
    expect(r).toEqual({ outcome: 'category mismatch', twin: null })
  })

  it('takes no candidate with no category, nor a card with none', () => {
    expect(find(plans(hant('001', 'Oddish', { category: undefined }))).twin).toBeNull()
    expect(find(plans(hant('001', 'Oddish')), hans({ category: undefined })).twin).toBeNull()
  })

  it('rarities agree across case, and a difference rules the candidate out', () => {
    const triple = hans({ rarity: 'Triple rare' })
    expect(find(plans(hant('001', 'Oddish', { rarity: 'Triple Rare' })), triple).outcome).toBe('linked')
    expect(find(plans(hant('001', 'Oddish', { rarity: 'Common' })), triple)).toEqual({
      outcome: 'rarity mismatch',
      twin: null
    })
  })

  it('rarity only rules when both cards have one', () => {
    expect(find(plans(hant('001', 'Oddish')), hans({ rarity: 'Common' })).outcome).toBe('linked')
    expect(find(plans(hant('001', 'Oddish', { rarity: 'Common' }))).outcome).toBe('linked')
  })

  it('rarity can leave one candidate of several', () => {
    const r = find(
      plans(hant('001', 'Oddish', { rarity: 'Common' }), hant('002', 'Oddish', { rarity: 'Rare' })),
      hans({ rarity: 'Rare' })
    )
    expect(r.twin?.id).toBe('SV8-002')
  })

  it('two candidates left are ambiguous, even if one has no rarity', () => {
    const both = plans(hant('001', 'Oddish'), hant('002', 'Oddish'))
    expect(find(both)).toEqual({ outcome: 'ambiguous', twin: null })
    const unrated = plans(hant('001', 'Oddish', { rarity: 'Rare' }), hant('002', 'Oddish'))
    expect(find(unrated, hans({ rarity: 'Rare' })).outcome).toBe('ambiguous')
  })

  it('a card without an image is no candidate, and leaves the other alone', () => {
    expect(find(plans(hant('001', 'Oddish', {}, null))).outcome).toBe('no candidate')
    const one = plans(hant('001', 'Oddish', {}, null), hant('002', 'Oddish'))
    expect(find(one).twin?.id).toBe('SV8-002')
  })

  it('a card named by its set and number is no candidate, and finds none', () => {
    expect(find(plans(hant('023', 'SV8 023')), hans(), 'SV8 023').outcome).toBe('no candidate')
    expect(find(plans(hant('001', 'CSV5C 001')), hans(), 'CSV5C 001').outcome).toBe('unnamed')
  })
})

describe('the list keeps its twin fields', () => {
  it('carries the code, number and the corrected mark', () => {
    const row: ZhCard = {
      cardIndex: '035',
      cardName: '走路草',
      rarity: 'C',
      cardType: 'Pokemon',
      nameEn: 'Oddish',
      setCodeEn: 'OBF',
      cardIndexEn: '1'
    }
    const { sets } = chineseListSets(
      [{ id: 'CSV5C', code: 'CSV5C', series: 'Scarlet & Violet', count: 1 }],
      new Map([['CSV5C', [row]]])
    )
    expect(sets[0].cards[0].englishTwin).toEqual({ setCode: 'OBF', number: '1', mark: 'U' })
  })
})

describe('refreshPokemon with English art', () => {
  let dir: string
  let db: Database.Database

  const enCard = en('001', 'Oddish', 'Common')
  const zhCard = (image?: string): TdCard => ({
    ...zh('001', 'C'),
    localId: '001',
    name: 'Oddish',
    localName: '走路草',
    englishTwin: { setCode: 'OBF', number: '1', mark: 'C' },
    image,
    variants_detailed: [{ type: 'normal' }]
  })
  const sources = (zhCards: TdCard[]): PokemonSources => ({
    async sets(lang: PkmLang) {
      if (lang === 'en') {
        const { set } = enSet([])
        return [{ ...set, cards: [{ id: enCard.id, localId: '001', name: enCard.name }] }]
      }
      return lang === 'zh-hans'
        ? [{ ...ZH_SET, cards: zhCards.map((c) => ({ id: c.id, localId: c.localId, name: c.name })) }]
        : []
    },
    async cards(lang: PkmLang) {
      return lang === 'en' ? [enCard] : zhCards
    },
    groups: async () => [],
    products: async () => [],
    prices: async () => []
  })
  const row = (): { image_url: string | null; art_twin_id: number | null } =>
    db
      .prepare('SELECT image_url, art_twin_id FROM pokemon_cards WHERE card_id = ?')
      .get(pokemonId('zh-hans/CSV5C-001')) as { image_url: string | null; art_twin_id: number | null }
  const run = (cards: TdCard[]): ReturnType<typeof refreshPokemon> =>
    refreshPokemon(db, sources(cards), { langs: ['en', 'zh-hans'] })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'art-twins-'))
    db = openDatabase(join(dir, 'work.sqlite'))
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('links the card without touching image_url, and reports it', async () => {
    const reports = await run([zhCard()])
    expect(row()).toEqual({ image_url: null, art_twin_id: pokemonId('en/sv03-001') })
    expect(reports.find((r) => r.lang === 'zh-hans')!.artTwins).toEqual({ linked: 1 })
    expect(reports.find((r) => r.lang === 'en')!.artTwins).toEqual({})
    expect(borrowedArt(db)).toEqual([
      [pokemonId('zh-hans/CSV5C-001#img'), pokemonId('en/sv03-001#img')]
    ])
  })

  it('own art ends the link when it arrives, and a later night keeps it ended', async () => {
    await run([zhCard()])
    const own = 'https://example.com/zh/001'
    await run([zhCard(own)])
    expect(row()).toEqual({ image_url: own, art_twin_id: null })
    expect(borrowedArt(db)).toEqual([])
    await run([zhCard()])
    expect(row()).toEqual({ image_url: own, art_twin_id: null })
  })

  it('a link that no longer holds is cleared', async () => {
    await run([zhCard()])
    await run([{ ...zhCard(), englishTwin: { setCode: 'OBF', number: '99', mark: 'C' } }])
    expect(row().art_twin_id).toBeNull()
  })

  describe('with Traditional Chinese art', () => {
    const hantCard = (over: Partial<TdCard> = {}): TdCard => ({
      id: 'SV8-001',
      localId: '001',
      name: '走路草',
      category: 'Pokemon',
      image: 'https://assets.tcgdex.net/zh-tw/SV/SV8/001',
      variants_detailed: [{ type: 'normal' }],
      set: { id: 'SV8', name: 'x' },
      ...over
    })
    const hanted = (zhCards: TdCard[], hantCards: TdCard[]): PokemonSources => {
      const base = sources(zhCards)
      return {
        ...base,
        async sets(lang: PkmLang) {
          if (lang !== 'zh-hant') return base.sets(lang)
          const cards = hantCards.map((c) => ({ id: c.id, localId: c.localId, name: c.name }))
          return [{ id: 'SV8', name: 'x', serie: { id: 'sv' }, cards }]
        },
        async cards(lang: PkmLang, ids: string[]) {
          return lang === 'zh-hant' ? hantCards : base.cards(lang, ids)
        }
      }
    }
    // The name comes from the Simplified list: same Chinese name, one English name.
    const named = { ...zhCard(), category: 'Pokemon', localName: '走路草' }
    const links = (id = 'zh-hans/CSV5C-001'): unknown =>
      db
        .prepare('SELECT art_twin_id, traditional_twin_id, image_url FROM pokemon_cards WHERE card_id = ?')
        .get(pokemonId(id))
    const go = (zhCards: TdCard[], hantCards: TdCard[]): ReturnType<typeof refreshPokemon> =>
      refreshPokemon(db, hanted(zhCards, hantCards), { langs: ['en', 'zh-hans', 'zh-hant'] })

    it('links Traditional art beside the English twin, which old apps keep reading', async () => {
      const reports = await go([named], [hantCard()])
      expect(links()).toEqual({
        art_twin_id: pokemonId('en/sv03-001'),
        traditional_twin_id: pokemonId('zh-hant/SV8-001'),
        image_url: null
      })
      const report = reports.find((r) => r.lang === 'zh-hans')!
      expect(report.artTwins).toEqual({ linked: 1 })
      expect(report.artTraditional).toEqual({ linked: 1 })
      const own = pokemonId('zh-hans/CSV5C-001#img')
      expect(borrowedArt(db)).toEqual([[own, pokemonId('en/sv03-001#img')]])
      expect(traditionalArt(db)).toEqual([[own, pokemonId('zh-hant/SV8-001#img')]])
    })

    it('fills a card with no English twin', async () => {
      await go([{ ...named, englishTwin: undefined }], [hantCard()])
      expect(links()).toMatchObject({
        art_twin_id: null,
        traditional_twin_id: pokemonId('zh-hant/SV8-001')
      })
    })

    it('ambiguous keeps the English twin alone', async () => {
      const reports = await go([named], [hantCard(), hantCard({ id: 'SV8-002', localId: '002' })])
      expect(links()).toMatchObject({
        art_twin_id: pokemonId('en/sv03-001'),
        traditional_twin_id: null
      })
      expect(reports.find((r) => r.lang === 'zh-hans')!.artTraditional).toEqual({ ambiguous: 1 })
    })

    it('own art ends both links and is never looked at', async () => {
      await go([named], [hantCard()])
      const own = 'https://example.com/zh/001'
      const reports = await go([{ ...named, image: own }], [hantCard()])
      expect(links()).toEqual({ art_twin_id: null, traditional_twin_id: null, image_url: own })
      expect(reports.find((r) => r.lang === 'zh-hans')!.artTraditional).toEqual({})
      expect(traditionalArt(db)).toEqual([])
    })

    it("the Traditional card's own image_url is untouched, and no Simplified row copies it", async () => {
      await go([named], [hantCard()])
      expect(links('zh-hant/SV8-001')).toEqual({
        art_twin_id: null,
        traditional_twin_id: null,
        image_url: 'https://assets.tcgdex.net/zh-tw/SV/SV8/001'
      })
    })

    it('a Traditional card that loses its candidacy clears the link', async () => {
      await go([named], [hantCard()])
      await go([named], [hantCard({ category: 'Trainer' })])
      expect(links()).toMatchObject({ traditional_twin_id: null })
    })

    it('a set cover prefers a card showing Traditional art over one with none', async () => {
      const blank = { ...named, id: 'CSV5C-001', localId: '001', name: 'Nothing', localName: '无', englishTwin: undefined }
      const linked = { ...named, id: 'CSV5C-002', localId: '002', englishTwin: undefined }
      await go([blank, linked], [hantCard()])
      setMeta(db, 'active_game', 'pkm')
      const set = listSets(db).find((s) => s.language === 'zh-hans')!
      expect(set.coverImageId).toBe(pokemonId('zh-hans/CSV5C-002#img'))
    })

    it('a rerun of unchanged input writes nothing', async () => {
      await go([named], [hantCard()])
      const before = db.prepare('SELECT total_changes() AS n').get() as { n: number }
      await go([named], [hantCard()])
      expect(links()).toMatchObject({ traditional_twin_id: pokemonId('zh-hant/SV8-001') })
      const after = db.prepare('SELECT total_changes() AS n').get() as { n: number }
      expect(after.n).toBe(before.n)
    })
  })

  it('borrowedArt ignores a link left on a card with art of its own', async () => {
    await run([zhCard()])
    db.prepare('UPDATE pokemon_cards SET image_url = ? WHERE card_id = ?').run(
      'https://example.com/own',
      pokemonId('zh-hans/CSV5C-001')
    )
    expect(borrowedArt(db)).toEqual([])
  })
})
