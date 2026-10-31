import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { refreshPokemon } from '../../scripts/catalog/pokemon/write'
import { createPokemonSources } from '../../scripts/catalog/pokemon/sources'
import {
  toSimplified,
  traditionalCard,
  traditionalNamer,
  traditionalSets,
  type JapaneseTwin
} from '../../scripts/catalog/pokemon/traditional'
import { TRADITIONAL_SET_NAMES } from '../../scripts/catalog/pokemon/traditionalNames'
import type { PkmLang, PokemonSources, TdCard, TdSet } from '../../scripts/catalog/pokemon/types'
import { cardVersions } from '../../scripts/catalog/pokemon/versions'
import { pokemonId } from '../../src/shared/games/ids'
import { hasNativeScript } from '../../src/shared/setNames'
import { matchDexRows, type DexCatalogPrinting } from '../../src/shared/dex/match'
import type { DexRow } from '../../src/shared/dex/parse'

const card = (id: string, name: string, extra: Partial<TdCard> = {}): TdCard => ({
  id,
  localId: id.slice(id.lastIndexOf('-') + 1),
  name,
  category: 'Pokemon',
  set: { id: id.slice(0, id.lastIndexOf('-')), name: '?' },
  ...extra
})
const en = (name: string, dex: number): TdCard => card(`sv01-${dex}`, name, { dexId: [dex] })
const twinsOf = (...list: [TdCard, string][]): Map<string, JapaneseTwin> =>
  new Map(list.map(([c, name]) => [c.id, { card: c, name }]))

describe('traditionalSets', () => {
  const set = (id: string, cards: number): TdSet => ({
    id,
    name: '三連音爆',
    cards: Array.from({ length: cards }, (_, i) => ({
      id: `${id}-${i}`,
      localId: `${i}`,
      name: 'x'
    }))
  })
  it('leaves out a set with no cards, and names the rest in English', () => {
    expect(traditionalSets([set('CS2b', 0), set('S11', 1)]).map((s) => [s.id, s.name])).toEqual([
      ['S11', 'Lost Abyss']
    ])
  })
  it("leaves out Taiwan's promos, whose cards TCGdex mixes up with Japan's of that number", () => {
    expect(traditionalSets([set('SV-P', 2)])).toEqual([])
  })
  it('falls back on the id, never the Chinese name', () => {
    expect(traditionalSets([set('NEW1', 1)])[0].name).toBe('NEW1')
  })
  it('has one English name per set', () => {
    const names = Object.values(TRADITIONAL_SET_NAMES)
    expect(new Set(names).size).toBe(names.length)
    expect(names.filter(hasNativeScript)).toEqual([])
  })
})

describe('traditionalCard', () => {
  const generated = { type: 'normal', variantId: 'generated' }
  const labels = (c: TdCard): string[] =>
    cardVersions(traditionalCard(c), [], new Map()).versions.map((v) => v.label)

  it('reads "None" as no rarity', () => {
    expect(traditionalCard(card('S4-1', '皮卡丘', { rarity: 'None' })).rarity).toBeNull()
  })
  it('reads a generated Normal on a foil tag as Holofoil, still unverified', () => {
    const c = card('SC1a-1', '妙蛙花VMAX', { variants_detailed: [generated] })
    expect(labels(c)).toEqual(['Holofoil'])
    expect(cardVersions(traditionalCard(c), [], new Map()).unverified).toBe(true)
  })
  it('keeps a generated Normal on a plain card, unverified', () => {
    const c = traditionalCard(card('SC1a-2', '皮卡丘', { variants_detailed: [generated] }))
    expect(cardVersions(c, [], new Map())).toMatchObject({
      unverified: true,
      versions: [{ label: 'Normal' }]
    })
  })
  it('keeps a curated variant as TCGdex has it, and makes up no mirror', () => {
    const c = card('SV5K-5', '土台龜ex', {
      variants_detailed: [{ type: 'normal', variantId: 'abc', thirdParty: { tcgplayer: 568339 } }]
    })
    expect(labels(c)).toEqual(['Normal'])
  })
  it('takes no product or price from a variant that points at a Japanese product', () => {
    const c = card('SV5K-5', '土台龜ex', {
      variants_detailed: [{ type: 'holo', variantId: 'abc', thirdParty: { tcgplayer: 568339 } }]
    })
    expect(cardVersions(traditionalCard(c), [], new Map()).versions).toEqual([
      { label: 'Holofoil', productId: null, subTypeName: null, price: null }
    ])
  })
})

describe('traditionalNamer', () => {
  const ja = card('S4-1', 'フシギバナV', { dexId: [3], illustrator: 'A', hp: 220 })

  it('takes the name of the Japanese card of the same id', () => {
    const zh = card('S4-1', '妙蛙花V', { dexId: [3], illustrator: 'A', hp: 220 })
    expect(traditionalNamer([zh], twinsOf([ja, 'Venusaur V']), []).nameOf(zh)).toEqual({
      name: 'Venusaur V',
      by: 'japanese'
    })
  })
  it.each([
    ['species', { dexId: [6] }],
    ['illustrator', { illustrator: 'B' }],
    ['hp', { hp: 60 }],
    ['category', { category: 'Trainer' }]
  ])('refuses a Japanese card that differs by %s', (_, change) => {
    const zh = card('S4-1', '妙蛙花V', { dexId: [3], illustrator: 'A', hp: 220, ...change })
    expect(traditionalNamer([zh], twinsOf([ja, 'Venusaur V']), []).nameOf(zh)).toBeNull()
  })
  it('refuses a Japanese card still named in Japanese', () => {
    const zh = card('S4-1', '妙蛙花V', { dexId: [3], illustrator: 'A', hp: 220 })
    expect(traditionalNamer([zh], twinsOf([ja, 'フシギバナV']), []).nameOf(zh)).toBeNull()
  })

  describe('with no Japanese card', () => {
    const trainerJa = card('S4-90', 'ボスの指令', { category: 'Trainer' })
    const trainerZh = card('S4-90', '老大的指令', { category: 'Trainer' })
    const plainJa = card('S4-1', 'フシギバナ')
    const plainZh = card('S4-1', '妙蛙花')
    const namer = traditionalNamer(
      [plainZh, trainerZh],
      twinsOf([plainJa, 'Venusaur'], [trainerJa, "Boss's Orders"]),
      []
    )
    it('reads an exact Chinese name another card taught, within its category', () => {
      const other = card('SC1a-90', '老大的指令', { category: 'Trainer' })
      expect(namer.nameOf(other)).toEqual({ name: "Boss's Orders", by: 'pair' })
      expect(namer.nameOf({ ...other, category: 'Energy' })).toBeNull()
    })
    it('puts the tag and a regional form back on a taught name', () => {
      expect(namer.nameOf(card('SC1a-1', '妙蛙花VMAX'))?.name).toBe('Venusaur VMAX')
      expect(namer.nameOf(card('SC1a-2', '阿羅拉妙蛙花V'))?.name).toBe('Alolan Venusaur V')
    })
    it('leaves a name with an unknown prefix unnamed', () => {
      expect(namer.nameOf(card('SC1a-3', '火箭隊的妙蛙花'))).toBeNull()
    })
    it('reads a basic Energy with or without the brackets', () => {
      const energy = (name: string): string | undefined =>
        namer.nameOf(card('SI-1', name, { category: 'Energy' }))?.name
      expect(energy('基本【鬥】能量')).toBe('Basic Fighting Energy')
      expect(energy('基本草能量')).toBe('Basic Grass Energy')
      expect(energy('極光能量')).toBeUndefined()
    })
    it('leaves a split vote unnamed', () => {
      const a = card('A-1', '某卡', { category: 'Trainer' })
      const b = card('B-1', '某卡', { category: 'Trainer' })
      const split = traditionalNamer(
        [a, b],
        twinsOf(
          [card('A-1', 'x', { category: 'Trainer' }), 'One'],
          [card('B-1', 'y', { category: 'Trainer' }), 'Two']
        ),
        []
      )
      expect(split.nameOf(card('C-1', '某卡', { category: 'Trainer' }))).toBeNull()
    })
  })

  describe('from the Simplified list', () => {
    const list = [
      { chinese: '超级球', english: 'Great Ball', category: 'Trainer' },
      { chinese: '瓜瓜', english: 'One', category: 'Pokemon' },
      { chinese: '瓜瓜', english: 'Two', category: 'Pokemon' },
      { chinese: '巨翅飞鱼', english: 'Mantine', category: 'Pokemon' }
    ]
    const namer = traditionalNamer([], new Map(), [], list)
    it('maps the characters it knows', () => {
      expect(toSimplified('巨翅飛魚')).toBe('巨翅飞鱼')
    })
    it('matches on the Simplified spelling, in its category, with the tag put back', () => {
      expect(namer.nameOf(card('SC1a-1', '巨翅飛魚'))).toEqual({
        name: 'Mantine',
        by: 'simplified'
      })
      expect(namer.nameOf(card('SC1a-2', '巨翅飛魚V'))).toEqual({
        name: 'Mantine V',
        by: 'simplified'
      })
      expect(namer.nameOf(card('SC1a-3', '超级球', { category: 'Energy' }))).toBeNull()
    })
    it('leaves a name the list splits unnamed, and one it lacks a character of', () => {
      expect(namer.nameOf(card('SC1a-4', '瓜瓜'))).toBeNull()
      expect(namer.nameOf(card('SC1a-5', '巨翅䶮魚'))).toBeNull()
    })
    it('prefers what a Japanese card taught', () => {
      const zh = card('S4-1', '巨翅飛魚')
      const taught = traditionalNamer(
        [zh],
        twinsOf([card('S4-1', 'マンタイン'), 'Taught']),
        [],
        list
      )
      expect(taught.nameOf(card('SC1a-1', '巨翅飛魚'))).toEqual({ name: 'Taught', by: 'pair' })
    })
  })

  describe('by species', () => {
    const plain = card('SC-1', '九尾', { dexId: [38] })
    const alolan = card('SC-2', '阿羅拉九尾', { dexId: [38] })
    const onlyForm = card('SC-3', '阿羅拉六尾', { dexId: [37] })
    const styles = [
      card('SC-4', '連擊武道熊師', { dexId: [892] }),
      card('SC-5', '一擊武道熊師', { dexId: [892] })
    ]
    const namer = traditionalNamer([plain, alolan, onlyForm, ...styles], new Map(), [
      en('Ninetales', 38),
      en('Vulpix', 37),
      en('Urshifu', 892)
    ])
    it('names the plain species, with its tag', () => {
      expect(namer.nameOf(plain)).toEqual({ name: 'Ninetales', by: 'species' })
      expect(namer.nameOf(card('SC-6', '九尾V', { dexId: [38] }))?.name).toBe('Ninetales V')
    })
    it('never drops a form the species name would hide', () => {
      expect(namer.nameOf(alolan)).toBeNull()
      expect(namer.nameOf(onlyForm)).toBeNull()
      expect(namer.nameOf(styles[0])).toBeNull()
    })
  })
})

describe('the Traditional Chinese step', () => {
  const zhSet: TdSet = {
    id: 'S4',
    name: 'Amazing Volt Tackle',
    cardCount: { official: 100 },
    cards: [
      { id: 'S4-001', localId: '001', name: '皮卡丘V' },
      { id: 'S4-002', localId: '002', name: '神秘卡' }
    ]
  }
  const zhCards: Record<string, TdCard> = {
    'S4-001': card('S4-001', '皮卡丘V', {
      dexId: [25],
      image: 'https://assets.tcgdex.net/zh-tw/S/S4/001',
      variants_detailed: [{ type: 'holo', variantId: 'k', thirdParty: { tcgplayer: 7 } }]
    }),
    'S4-002': card('S4-002', '神秘卡', {
      category: 'Trainer',
      variants_detailed: [{ type: 'normal', variantId: 'generated' }]
    })
  }
  const jaSet: TdSet = {
    id: 'S4',
    name: '仰天のボルテッカー',
    cards: [{ id: 'S4-001', localId: '001', name: 'ピカチュウV' }]
  }
  const sources = (langs: Partial<Record<PkmLang, TdSet[]>>): PokemonSources => ({
    sets: async (l) => langs[l] ?? [],
    cards: async (l, ids) =>
      ids.map((id) =>
        l === 'zh-hant'
          ? zhCards[id]
          : card(id, 'ピカチュウV', {
              dexId: [25],
              variants_detailed: [{ type: 'holo', variantId: 'j' }]
            })
      ),
    groups: async () => [],
    products: async () => [],
    prices: async () => []
  })

  it('writes the cards under zh-hant, in English, with no price', async () => {
    const db = openDatabase(':memory:')
    try {
      const [ja, zh] = await refreshPokemon(db, sources({ ja: [jaSet], 'zh-hant': [zhSet] }), {
        langs: ['ja', 'zh-hant']
      })
      expect(ja.lang).toBe('ja')
      expect(zh).toMatchObject({ lang: 'zh-hant', sets: 1, cards: 2, priced: 0, unverified: 1 })
      expect(zh).toMatchObject({ images: 1, englishNamed: 0, japaneseNames: 2 })
      expect(
        db
          .prepare(
            `SELECT p.set_name, p.set_code, p.set_rarity, p.language, p.tcg_product_id, p.market_price
             FROM card_printings p WHERE p.card_id = ?`
          )
          .all(pokemonId('zh-hant/S4-002'))
      ).toEqual([
        {
          set_name: 'Amazing Volt Tackle',
          set_code: 'S4 002/100',
          set_rarity: 'Normal',
          language: 'zh-hant',
          tcg_product_id: null,
          market_price: null
        }
      ])
      const named = db.prepare(
        `SELECT c.name, d.local_name, d.image_url FROM cards c
           JOIN pokemon_cards d ON d.card_id = c.id WHERE c.id = ?`
      )
      // The Japanese card here has no English name, so both cards fall to set and number.
      expect(named.get(pokemonId('zh-hant/S4-001'))).toEqual({
        name: 'S4 001',
        local_name: '皮卡丘V',
        image_url: 'https://assets.tcgdex.net/zh-tw/S/S4/001'
      })
      expect(named.get(pokemonId('zh-hant/S4-002'))).toMatchObject({
        name: 'S4 002',
        local_name: '神秘卡'
      })
    } finally {
      db.close()
    }
  })

  it('names a card from the Japanese card of its id, as the catalog names that card', async () => {
    const db = openDatabase(':memory:')
    try {
      const withProduct: PokemonSources = {
        ...sources({ ja: [jaSet], 'zh-hant': [zhSet] }),
        groups: async (l) =>
          l === 'ja' ? [{ groupId: 1, name: 'S4: Amazing Volt Tackle', abbreviation: 'S4' }] : [],
        products: async (l) =>
          l === 'ja'
            ? [{ productId: 9, groupId: 1, name: 'Pikachu V - 001/100', number: '001/100' }]
            : [],
        prices: async (l) =>
          l === 'ja' ? [{ productId: 9, subTypeName: 'Holofoil', marketPrice: 5 }] : []
      }
      const [, zh] = await refreshPokemon(db, withProduct, { langs: ['ja', 'zh-hant'] })
      expect(zh).toMatchObject({ englishNamed: 1, japaneseNames: 1, priced: 0 })
      expect(
        db.prepare('SELECT name FROM cards WHERE id = ?').get(pokemonId('zh-hant/S4-001'))
      ).toEqual({
        name: 'Pikachu V'
      })
      expect(
        db
          .prepare('SELECT tcg_product_id, market_price FROM card_printings WHERE card_id = ?')
          .all(pokemonId('zh-hant/S4-001'))
      ).toEqual([{ tcg_product_id: null, market_price: null }])
    } finally {
      db.close()
    }
  })

  it('leaves the other languages as they were without it', async () => {
    const run = async (langs: PkmLang[]): Promise<unknown[]> => {
      const db = openDatabase(':memory:')
      try {
        await refreshPokemon(db, sources({ ja: [jaSet], 'zh-hant': [zhSet] }), {
          langs,
          now: () => new Date('2026-10-31T00:00:00Z')
        })
        return db
          .prepare(
            `SELECT p.pkey, p.set_name, p.set_code, p.set_rarity, c.name FROM card_printings p
             JOIN cards c ON c.id = p.card_id WHERE p.language = 'ja' ORDER BY p.pkey`
          )
          .all()
      } finally {
        db.close()
      }
    }
    expect(await run(['ja', 'zh-hant'])).toEqual(await run(['ja']))
  })
})

describe('Traditional Chinese sources', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pkm-tw-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const fake = (): { fetch: typeof fetch; urls: string[] } => {
    const urls: string[] = []
    const f = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      urls.push(url)
      const body = url.endsWith('/sets')
        ? [{ id: 'S4' }, { id: 'CS2b' }]
        : url.endsWith('/sets/S4')
          ? {
              id: 'S4',
              name: '驚天伏特攻擊',
              cards: [{ id: 'S4-001', localId: '001', name: '皮卡丘' }]
            }
          : url.endsWith('/sets/CS2b')
            ? { id: 'CS2b', name: '三連音爆', cards: [] }
            : { ...card('S4-001', '皮卡丘'), rarity: 'None' }
      return new Response(JSON.stringify(body), { status: 200 })
    }
    return { fetch: f as typeof fetch, urls }
  }

  it('asks TCGdex for zh-tw, never TCGCSV, and caches a card with no art for seven days', async () => {
    const http = fake()
    let now = new Date('2026-10-31T00:00:00Z')
    const s = createPokemonSources({
      cachePath: join(dir, 'cache.db'),
      fetch: http.fetch,
      version: '9.9.9',
      now: () => now,
      retryDelayMs: 1
    })
    try {
      expect((await s.sets('zh-hant')).map((x) => x.name)).toEqual(['Amazing Volt Tackle'])
      expect(await s.groups('zh-hant')).toEqual([])
      expect((await s.cards('zh-hant', ['S4-001']))[0].rarity).toBeNull()
      expect(http.urls.every((u) => u.startsWith('https://api.tcgdex.net/v2/zh-tw/'))).toBe(true)
      const count = http.urls.length
      now = new Date('2026-11-06T00:00:00Z')
      expect((await s.cards('zh-hant', ['S4-001']))[0].rarity).toBeNull()
      expect(http.urls.length).toBe(count)
      now = new Date('2026-11-08T00:00:00Z')
      await s.cards('zh-hant', ['S4-001'])
      expect(http.urls.length).toBe(count + 1)
    } finally {
      s.close()
    }
  })
})

describe('a Dex export of Traditional Chinese cards', () => {
  const printing = (id: number, language: string, source: string): DexCatalogPrinting => ({
    id,
    cardId: id,
    sourceId: `${language}/${source}`,
    setName: 'Shiny Treasure ex',
    version: 'Normal',
    cardName: 'Pikachu',
    language
  })
  const row: DexRow = {
    locale: 'Traditional Chinese',
    series: 'Scarlet & Violet',
    set: 'Shiny Treasure ex',
    id: 'tcn_sv4a-57',
    number: '57/190',
    name: 'Pikachu',
    variant: 'Normal',
    quantity: 1
  }
  const catalog = [
    printing(1, 'zh-hant', 'SV4a-057'),
    printing(2, 'ja', 'SV4a-057'),
    printing(3, 'zh-hans', 'SV4a-057')
  ]

  it('lands by set name on the Traditional Chinese printing alone', () => {
    expect([...matchDexRows([row], catalog).wanted.keys()]).toEqual([1])
  })
  it('never falls back on another language', () => {
    expect(matchDexRows([row], catalog.slice(1)).missing[0].reason).toBe('language')
  })
})
