import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { borrowedArt } from '../../src/main/repo/cards'
import { pokemonId } from '../../src/shared/games/ids'
import { englishTwins, type EnglishPlan } from '../../scripts/catalog/pokemon/artTwins'
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
  const find = (sets: EnglishPlan[], card: TdCard, name: string, set = ZH_SET): string =>
    englishTwins(sets, () => '').find(card, name, set).outcome

  it('links a regular print whose set, number and name agree, whatever the number padding', () => {
    const r = englishTwins([enSet([en('001', 'Oddish', 'Common')])], () => '').find(
      zh('1', 'C'),
      'ODDISH',
      ZH_SET
    )
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

  it('leaves out AR and SAR: their twin is the plain card, CSV5C 130 and 155 among them', () => {
    const sets = [enSet([en('002', 'Gloom', 'Common'), en('125', 'Charizard ex', 'Double rare')])]
    expect(find(sets, zh('2', 'AR'), 'Gloom')).toBe('special rarity')
    expect(find(sets, zh('125', 'SAR'), 'Charizard ex')).toBe('special rarity')
  })

  it('leaves out cards with no mark', () => {
    expect(find([enSet([en('001', 'Oddish', 'Common')])], zh('1', '无标记'), 'Oddish')).toBe('unmarked')
  })

  it("leaves out a mark the English rarity isn't the tier of", () => {
    expect(find([enSet([en('125', 'Charizard ex', 'Double rare')])], zh('125', 'U'), 'Charizard ex')).toBe(
      'rarity mismatch'
    )
  })

  it('leaves out a twin from another series, as a Scarlet & Violet Nest Ball pointing at Sun & Moon', () => {
    const sm = enSet([en('123', 'Nest Ball', 'Uncommon')], { serie: { id: 'sm' } })
    expect(find([sm], zh('123', 'U'), 'Nest Ball')).toBe('other series')
  })

  it('leaves out a number past the printed count', () => {
    expect(find([enSet([en('223', 'Charizard ex', 'Common')])], zh('223', 'C'), 'Charizard ex')).toBe(
      'secret number'
    )
  })

  it('leaves out rules with another regular print of different or unknown art', () => {
    const a = en('010', 'Pikachu', 'Common')
    const other = en('020', 'Pikachu', 'Common', { illustrator: 'B' })
    const same = en('020', 'Pikachu', 'Common')
    const unknown = en('020', 'Pikachu', 'Common', { illustrator: undefined })
    expect(find([enSet([a, other])], zh('10', 'C'), 'Pikachu')).toBe('other art of these rules')
    expect(find([enSet([a, unknown])], zh('10', 'C'), 'Pikachu')).toBe('other art of these rules')
    expect(find([enSet([a, same])], zh('10', 'C'), 'Pikachu')).toBe('linked')
  })

  it('is not put off by a full art past the count, or a print of other rules', () => {
    const a = en('010', 'Pikachu', 'Double rare')
    const full = en('220', 'Pikachu', 'Double rare', { illustrator: 'B' })
    const hp = en('020', 'Pikachu', 'Double rare', { illustrator: 'B', hp: 70 })
    expect(find([enSet([a, full, hp])], zh('10', 'RR'), 'Pikachu')).toBe('linked')
  })

  it('counts a twin with no art, and a card with no twin', () => {
    expect(find([enSet([en('001', 'Oddish', 'Common', { image: undefined })])], zh('1', 'C'), 'Oddish')).toBe(
      'no English art'
    )
    expect(find([enSet([])], { ...zh('1', 'C'), englishTwin: undefined }, 'Oddish')).toBe('no twin')
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
    await run([{ ...zhCard(), englishTwin: { setCode: 'OBF', number: '1', mark: 'AR' } }])
    expect(row().art_twin_id).toBeNull()
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
