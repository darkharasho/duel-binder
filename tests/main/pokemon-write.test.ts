import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { pokemonId } from '../../src/shared/games/ids'
import { refreshPokemon, type PokemonReport } from '../../scripts/catalog/pokemon/write'
import { runPokemonStep } from '../../scripts/catalog/pokemon'
import type {
  PkmLang,
  PokemonSources,
  TcGroup,
  TcPrice,
  TcProduct,
  TdCard,
  TdSet
} from '../../scripts/catalog/pokemon/types'

const FIX = join(__dirname, '..', 'fixtures', 'pokemon')
const read = <T>(p: string): T => JSON.parse(readFileSync(join(FIX, p), 'utf8')) as T
const CAT: Record<PkmLang, string> = { en: '3', ja: '85' }

interface Tweaks {
  set?: (lang: PkmLang, s: TdSet) => TdSet
  card?: (lang: PkmLang, c: TdCard) => TdCard
  groups?: (lang: PkmLang, g: TcGroup[]) => TcGroup[]
  products?: (lang: PkmLang, groupId: number, p: TcProduct[]) => TcProduct[]
  prices?: (lang: PkmLang, groupId: number, p: TcPrice[]) => TcPrice[]
}

/** PokemonSources over the checked-in fixtures, mapped the way the real clients map them. */
function fixtureSources(t: Tweaks = {}): PokemonSources & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async sets(lang) {
      calls.push(`sets ${lang}`)
      return readdirSync(join(FIX, lang))
        .filter((f) => f.startsWith('set-'))
        .map((f) => read<TdSet>(`${lang}/${f}`))
        .map((s) => (t.set ? t.set(lang, s) : s))
    },
    async cards(lang, ids) {
      calls.push(`cards ${lang}`)
      return ids
        .map((id) => read<TdCard>(`${lang}/card-${id}.json`))
        .map((c) => (t.card ? t.card(lang, c) : c))
    },
    async groups(lang) {
      calls.push(`groups ${lang}`)
      const g = read<{
        results: { groupId: number; name: string; abbreviation?: string | null }[]
      }>(`tcgcsv/${CAT[lang]}/groups.json`).results.map((r) => ({
        groupId: r.groupId,
        name: r.name,
        abbreviation: r.abbreviation ?? null
      }))
      return t.groups ? t.groups(lang, g) : g
    },
    async products(lang, groupId) {
      calls.push(`products ${lang} ${groupId}`)
      const f = `tcgcsv/${CAT[lang]}/products-${groupId}.json`
      const rows = existsSync(join(FIX, f))
        ? read<{
            results: {
              productId: number
              groupId: number
              name: string
              imageUrl?: string
              extendedData?: { name: string; value: string }[]
            }[]
          }>(f).results
        : []
      const p = rows.map((r) => ({
        productId: r.productId,
        groupId: r.groupId,
        name: r.name,
        imageUrl: r.imageUrl,
        number: r.extendedData?.find((e) => e.name === 'Number')?.value ?? null
      }))
      return t.products ? t.products(lang, groupId, p) : p
    },
    async prices(lang, groupId) {
      calls.push(`prices ${lang} ${groupId}`)
      const f = `tcgcsv/${CAT[lang]}/prices-${groupId}.json`
      const rows = existsSync(join(FIX, f))
        ? read<{
            results: { productId: number; subTypeName: string; marketPrice?: number | null }[]
          }>(f).results
        : []
      const p = rows.map((r) => ({
        productId: r.productId,
        subTypeName: r.subTypeName,
        marketPrice: r.marketPrice ?? null
      }))
      return t.prices ? t.prices(lang, groupId, p) : p
    }
  }
}

const cid = (source: string): number => pokemonId(source)

interface Printing {
  id: number
  pkey: string
  set_name: string
  set_code: string
  set_rarity: string
  market_price: number | null
  tcg_product_id: number | null
  missing_from_api: number
  variant: string | null
  set_rarity_code: string
  language: string
  game: string
}
const printings = (db: Database.Database, source: string): Printing[] =>
  db
    .prepare('SELECT * FROM card_printings WHERE card_id = ? ORDER BY set_rarity')
    .all(cid(source)) as Printing[]

/** Every catalog table's rows, for before/after comparisons. */
function snapshot(db: Database.Database): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {}
  for (const t of ['cards', 'card_printings', 'card_images', 'sets', 'pokemon_cards']) {
    out[t] = db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2, 3`).all()
  }
  return out
}

function seedYgo(db: Database.Database): void {
  db.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at)
     VALUES (89631139, 'Blue-Eyes White Dragon', 'Normal Monster', 'normal', 'Dragon', 'Legendary', '2026-01-01')`
  ).run()
  db.prepare(
    'INSERT INTO card_images (image_id, card_id, sort_order) VALUES (89631139, 89631139, 0)'
  ).run()
  db.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language, market_price)
     VALUES (89631139, 'Legend of Blue Eyes White Dragon', 'LOB-001', 'Ultra Rare', 'en', 50)`
  ).run()
  db.prepare(
    "INSERT INTO sets (language, set_name, set_code) VALUES ('en', 'Legend of Blue Eyes White Dragon', 'LOB')"
  ).run()
}
const ygoRows = (db: Database.Database): unknown[] => [
  db.prepare("SELECT * FROM cards WHERE game = 'ygo'").all(),
  db.prepare("SELECT * FROM card_images WHERE game = 'ygo'").all(),
  db.prepare("SELECT * FROM card_printings WHERE game = 'ygo'").all(),
  db.prepare("SELECT * FROM sets WHERE game = 'ygo'").all()
]

const clock = (iso: string) => (): Date => new Date(iso)

describe('refreshPokemon', () => {
  let db: Database.Database
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  describe('after one run', () => {
    let reports: PokemonReport[]
    let ygoBefore: unknown[]
    beforeEach(async () => {
      seedYgo(db)
      ygoBefore = ygoRows(db)
      reports = await refreshPokemon(db, fixtureSources(), {
        now: clock('2026-10-29T03:00:00.000Z')
      })
    })

    it('writes sv01-001 Pineco with its two priced versions', () => {
      const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cid('en/sv01-001')) as Record<
        string,
        unknown
      >
      expect(card).toMatchObject({
        game: 'pkm',
        name: 'Pineco',
        type: 'Pokemon',
        updated_at: '2026-10-29T03:00:00.000Z'
      })
      expect(card.desc).toBe(
        "Colorless Colorless Guard Press 10: During your opponent's next turn, this Pokémon takes 30 less damage from attacks (after applying Weakness and Resistance)."
      )
      const ps = printings(db, 'en/sv01-001')
      expect(ps.map((p) => [p.set_code, p.set_rarity, p.market_price, p.tcg_product_id])).toEqual([
        ['SVI 001/198', 'Normal', 0.12, 487828],
        ['SVI 001/198', 'Reverse Holofoil', 0.22, 487828]
      ])
      for (const p of ps) {
        expect(p).toMatchObject({
          game: 'pkm',
          language: 'en',
          set_name: 'Scarlet & Violet',
          set_rarity_code: '',
          missing_from_api: 0
        })
        expect(p.variant).toBeNull()
      }
      const details = db
        .prepare('SELECT * FROM pokemon_cards WHERE card_id = ?')
        .get(cid('en/sv01-001'))
      expect(details).toMatchObject({
        category: 'Pokemon',
        hp: 60,
        types: '["Grass"]',
        stage: 'Basic',
        rarity: 'Common',
        illustrator: 'Shigenori Negishi',
        source_id: 'en/sv01-001',
        image_url: 'https://assets.tcgdex.net/en/sv/sv01/001',
        local_name: null
      })
    })

    it('gives every card exactly one image row', () => {
      const cards = db.prepare("SELECT id FROM cards WHERE game = 'pkm'").all() as { id: number }[]
      expect(cards.length).toBe(11)
      for (const source of ['ja/M4-001', 'ja/PMCG1-001', 'en/base1-4']) {
        expect(
          db
            .prepare(
              'SELECT image_id, sort_order, missing_from_api, game FROM card_images WHERE card_id = ?'
            )
            .all(cid(source))
        ).toEqual([
          { image_id: pokemonId(`${source}#img`), sort_order: 0, missing_from_api: 0, game: 'pkm' }
        ])
      }
      const n = db.prepare("SELECT count(*) AS n FROM card_images WHERE game = 'pkm'").get() as {
        n: number
      }
      expect(n.n).toBe(11)
      const m4 = db
        .prepare('SELECT image_url FROM pokemon_cards WHERE card_id = ?')
        .get(cid('ja/M4-001'))
      expect(m4).toEqual({
        image_url: 'https://tcgplayer-cdn.tcgplayer.com/product/683652_200w.jpg'
      })
    })

    it('names Japanese cards and sets in English', () => {
      expect(db.prepare('SELECT name FROM cards WHERE id = ?').get(cid('ja/M4-001'))).toEqual({
        name: 'Weedle'
      })
      expect(
        db.prepare('SELECT local_name FROM pokemon_cards WHERE card_id = ?').get(cid('ja/M4-001'))
      ).toEqual({ local_name: 'ビードル' })
      const set = db
        .prepare("SELECT * FROM sets WHERE game = 'pkm' AND image_key = 'td-ja-M4'")
        .get()
      expect(set).toMatchObject({
        language: 'ja',
        set_name: 'Ninja Spinner',
        set_code: 'M4',
        tcg_date: '2026-03-13',
        image_url: null
      })
      expect(
        printings(db, 'ja/M4-001').map((p) => [
          p.set_name,
          p.set_code,
          p.set_rarity,
          p.market_price
        ])
      ).toEqual([['Ninja Spinner', 'M4 001/83', 'Normal', 0.14]])
    })

    it('writes the English set rows', () => {
      expect(
        db
          .prepare("SELECT * FROM sets WHERE game = 'pkm' AND language = 'en' ORDER BY set_name")
          .all()
      ).toEqual([
        {
          game: 'pkm',
          language: 'en',
          set_name: 'Base Set',
          set_code: 'BS',
          tcg_date: '1999-01-09',
          image_url: 'https://assets.tcgdex.net/en/base/base1/logo',
          image_key: 'td-en-base1',
          list_rows: null,
          unmatched_rows: null
        },
        {
          game: 'pkm',
          language: 'en',
          set_name: 'Scarlet & Violet',
          set_code: 'SVI',
          tcg_date: '2023-03-31',
          image_url: 'https://assets.tcgdex.net/en/sv/sv01/logo',
          image_key: 'td-en-sv01',
          list_rows: null,
          unmatched_rows: null
        }
      ])
    })

    it('keeps pkeys unique and Yu-Gi-Oh untouched', () => {
      const keys = db.prepare('SELECT pkey FROM card_printings').all() as { pkey: string }[]
      expect(new Set(keys.map((k) => k.pkey)).size).toBe(keys.length)
      expect(ygoRows(db)).toEqual(ygoBefore)
    })

    it('reports per language', () => {
      expect(reports.map((r) => r.lang)).toEqual(['en', 'ja'])
      const [en, ja] = reports
      expect(en).toMatchObject({
        sets: 2,
        cards: 4,
        unmatchedSets: [],
        unmatchedCards: 0,
        images: 4
      })
      expect(ja).toMatchObject({ sets: 4, cards: 7, unmatchedSets: [] })
      expect(en.versions).toBe(
        db
          .prepare(
            "SELECT count(*) AS n FROM card_printings WHERE game = 'pkm' AND language = 'en'"
          )
          .pluck()
          .get()
      )
      expect(en.priced).toBeGreaterThan(0)
    })

    it('fills the name index', () => {
      const hit = db.prepare("SELECT rowid FROM cards_fts WHERE cards_fts MATCH 'weedle'").all()
      expect(hit).toEqual([{ rowid: cid('ja/M4-001') }])
    })
  })

  it('fetches prices only for groups holding a matched product', async () => {
    const sources = fixtureSources()
    await refreshPokemon(db, sources)
    const priced = sources.calls.filter((c) => c.startsWith('prices')).sort()
    expect(priced).toEqual([
      'prices en 1663',
      'prices en 22873',
      'prices en 604',
      'prices ja 23605',
      'prices ja 23721',
      'prices ja 24399',
      'prices ja 24653'
    ])
  })

  it('keeps set_code and set_name of written cards', async () => {
    // Run 1: sv01 has no abbreviation and TCGCSV knows nothing of it; SV1S has no group.
    const bare = fixtureSources({
      set: (_l, s) => (s.id === 'sv01' ? { ...s, abbreviation: undefined } : s),
      groups: (_l, g) => g.filter((x) => x.groupId !== 22873 && x.groupId !== 23605),
      products: (_l, id, p) => (id === 22873 || id === 23605 ? [] : p)
    })
    const strip = (c: TdCard): TdCard => ({
      ...c,
      thirdParty: undefined,
      variants_detailed: c.variants_detailed?.map((v) => ({ ...v, thirdParty: undefined }))
    })
    const cards = bare.cards.bind(bare)
    bare.cards = async (lang, ids) =>
      (await cards(lang, ids)).map((c) =>
        c.set.id === 'sv01' || c.set.id === 'SV1S' ? strip(c) : c
      )
    await refreshPokemon(db, bare)
    const before = printings(db, 'en/sv01-001')
    expect(before.map((p) => [p.set_code, p.set_rarity, p.market_price])).toEqual([
      ['SV01 001/198', 'Normal', null],
      ['SV01 001/198', 'Reverse Holofoil', null]
    ])
    const jaBefore = printings(db, 'ja/SV1S-001')
    expect(jaBefore.map((p) => [p.set_name, p.set_code])).toEqual([
      ['スカーレットex', 'SV1S 001/78']
    ])

    await refreshPokemon(db, fixtureSources())
    const after = printings(db, 'en/sv01-001')
    expect(
      after.map((p) => [p.id, p.pkey, p.set_code, p.set_name, p.set_rarity, p.market_price])
    ).toEqual([
      [before[0].id, before[0].pkey, 'SV01 001/198', 'Scarlet & Violet', 'Normal', 0.12],
      [before[1].id, before[1].pkey, 'SV01 001/198', 'Scarlet & Violet', 'Reverse Holofoil', 0.22]
    ])
    const jaAfter = printings(db, 'ja/SV1S-001')
    expect(
      jaAfter.map((p) => [p.id, p.pkey, p.set_name, p.set_code, p.set_rarity, p.market_price])
    ).toEqual([[jaBefore[0].id, jaBefore[0].pkey, 'スカーレットex', 'SV1S 001/78', 'Normal', 0.15]])
    // The set rows keep their first name and code too, so the set still lists its printings.
    expect(
      db
        .prepare(
          "SELECT set_name, set_code FROM sets WHERE game = 'pkm' AND image_key IN ('td-en-sv01', 'td-ja-SV1S') ORDER BY image_key"
        )
        .all()
    ).toEqual([
      { set_name: 'Scarlet & Violet', set_code: 'SV01' },
      { set_name: 'スカーレットex', set_code: 'SV1S' }
    ])
    // The Japanese card now has its English name; the key doesn't depend on it.
    expect(db.prepare('SELECT name FROM cards WHERE id = ?').get(cid('ja/SV1S-001'))).not.toEqual({
      name: read<TdCard>('ja/card-SV1S-001.json').name
    })
  })

  it('keeps a version that is no longer produced (sticky)', async () => {
    await refreshPokemon(db, fixtureSources())
    const before = printings(db, 'en/sv01-001')
    const noReverse = fixtureSources({
      prices: (_l, _g, p) =>
        p.filter((r) => !(r.productId === 487828 && r.subTypeName === 'Reverse Holofoil'))
    })
    const cards = noReverse.cards.bind(noReverse)
    noReverse.cards = async (lang, ids) =>
      (await cards(lang, ids)).map((c) =>
        c.id === 'sv01-001'
          ? { ...c, variants_detailed: c.variants_detailed?.filter((v) => v.type !== 'reverse') }
          : c
      )
    await refreshPokemon(db, noReverse)
    const after = printings(db, 'en/sv01-001')
    expect(after.map((p) => [p.id, p.set_rarity, p.missing_from_api])).toEqual([
      [before[0].id, 'Normal', 0],
      [before[1].id, 'Reverse Holofoil', 1]
    ])
  })

  it('flags a card TCGdex dropped without deleting anything', async () => {
    await refreshPokemon(db, fixtureSources())
    const dropped = fixtureSources({
      set: (_l, s) =>
        s.id === 'sv01' ? { ...s, cards: s.cards.filter((c) => c.id !== 'sv01-002') } : s
    })
    await refreshPokemon(db, dropped)
    expect(printings(db, 'en/sv01-002').map((p) => p.missing_from_api)).toEqual([1, 1])
    expect(
      db
        .prepare('SELECT missing_from_api FROM card_images WHERE card_id = ?')
        .get(cid('en/sv01-002'))
    ).toEqual({ missing_from_api: 1 })
    expect(
      db.prepare('SELECT count(*) FROM cards WHERE id = ?').pluck().get(cid('en/sv01-002'))
    ).toBe(1)
    expect(printings(db, 'en/sv01-001').map((p) => p.missing_from_api)).toEqual([0, 0])
  })

  it('ignores penny moves and keeps updated_at when nothing changed (churn)', async () => {
    await refreshPokemon(db, fixtureSources(), { now: clock('2026-10-29T03:00:00.000Z') })
    const before = snapshot(db)
    const penny = fixtureSources({
      prices: (_l, _g, p) =>
        p.map((r) =>
          r.productId === 487828 && r.subTypeName === 'Normal' ? { ...r, marketPrice: 0.121 } : r
        )
    })
    await refreshPokemon(db, penny, { now: clock('2026-10-30T03:00:00.000Z') })
    expect(printings(db, 'en/sv01-001')[0].market_price).toBe(0.12)
    expect(snapshot(db)).toEqual(before)
  })

  it('writes a price that moved enough', async () => {
    await refreshPokemon(db, fixtureSources())
    const moved = fixtureSources({
      prices: (_l, _g, p) =>
        p.map((r) =>
          r.productId === 487828 && r.subTypeName === 'Normal' ? { ...r, marketPrice: 0.5 } : r
        )
    })
    await refreshPokemon(db, moved)
    expect(printings(db, 'en/sv01-001')[0].market_price).toBe(0.5)
  })

  it('never replaces an existing card image_url (sticky art)', async () => {
    await refreshPokemon(db, fixtureSources())
    const id = cid('en/sv01-001')
    db.prepare(
      "UPDATE pokemon_cards SET image_url = 'https://assets.tcgdex.net/en/sv/sv01/old' WHERE card_id = ?"
    ).run(id)
    await refreshPokemon(db, fixtureSources())
    expect(
      db.prepare('SELECT image_url FROM pokemon_cards WHERE card_id = ?').pluck().get(id)
    ).toBe('https://assets.tcgdex.net/en/sv/sv01/old')
  })

  it('gives a later set whose name is taken its code as a suffix', async () => {
    const same = fixtureSources({
      set: (_l, s) => (s.id === 'base1' ? { ...s, name: 'Scarlet & Violet' } : s)
    })
    const [en] = await refreshPokemon(db, same, { langs: ['en'] })
    const names = db
      .prepare("SELECT image_key, set_name FROM sets WHERE game = 'pkm' ORDER BY image_key")
      .all()
    expect(names).toEqual([
      { image_key: 'td-en-base1', set_name: 'Scarlet & Violet' },
      { image_key: 'td-en-sv01', set_name: 'Scarlet & Violet (SVI)' }
    ])
    expect(printings(db, 'en/sv01-001')[0].set_name).toBe('Scarlet & Violet (SVI)')
    expect(en.problems.some((p) => p.includes('is taken'))).toBe(true)
  })

  it('only refreshes the languages asked for', async () => {
    const reports = await refreshPokemon(db, fixtureSources(), { langs: ['en'] })
    expect(reports.map((r) => r.lang)).toEqual(['en'])
    expect(db.prepare("SELECT count(*) FROM cards WHERE game = 'pkm'").pluck().get()).toBe(4)
  })
})

describe('runPokemonStep', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pkm-write-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('returns a source error without writing', async () => {
    const db = openDatabase(join(dir, 'work.sqlite'))
    try {
      seedYgo(db)
      await refreshPokemon(db, fixtureSources())
      const before = snapshot(db)
      const failing = fixtureSources({
        prices: () => {
          throw new Error('TCGCSV is down')
        }
      })
      const out = await runPokemonStep(db, {
        cachePath: join(dir, 'src.sqlite'),
        version: '9.9.9',
        log: () => {},
        sources: failing
      })
      expect(out.error).toContain('TCGCSV is down')
      expect(out.reports).toEqual([])
      expect(snapshot(db)).toEqual(before)
    } finally {
      db.close()
    }
  })

  it('returns the reports on success', async () => {
    const db = openDatabase(join(dir, 'work.sqlite'))
    try {
      const out = await runPokemonStep(db, {
        cachePath: join(dir, 'src.sqlite'),
        version: '9.9.9',
        log: () => {},
        sources: fixtureSources()
      })
      expect(out.error).toBeNull()
      expect(out.reports.map((r) => r.lang)).toEqual(['en', 'ja'])
    } finally {
      db.close()
    }
  })
})

describe('Japanese card English names', () => {
  const nameOf = async (variants: { id: number; subtype?: string }[]): Promise<string> => {
    const db = openDatabase(':memory:')
    try {
      await refreshPokemon(
        db,
        fixtureSources({
          card: (lang, c) =>
            lang === 'ja' && c.id === 'M4-001'
              ? {
                  ...c,
                  variants_detailed: variants.map((v) => ({
                    type: 'normal',
                    subtype: v.subtype,
                    thirdParty: { tcgplayer: v.id }
                  }))
                }
              : c,
          products: (lang, groupId, p) =>
            lang === 'ja' && groupId === 24653
              ? [
                  ...p,
                  { productId: 683000, groupId, name: 'Zed Weedle - 001/083', number: '001/083' },
                  { productId: 683999, groupId, name: 'Late Weedle - 001/083', number: '001/083' }
                ]
              : p
        }),
        { langs: ['ja'] }
      )
      return (
        db.prepare('SELECT name FROM cards WHERE id = ?').get(cid('ja/M4-001')) as {
          name: string
        }
      ).name
    } finally {
      db.close()
    }
  }

  it('prefers a product reached without a variant subtype, whatever the order', async () => {
    const plain = { id: 683652 }
    const shadow = { id: 683000, subtype: 'shadowless' }
    expect(await nameOf([shadow, plain])).toBe('Weedle')
    expect(await nameOf([plain, shadow])).toBe('Weedle')
  })

  it('takes the lowest product id among equals, whatever the order', async () => {
    const a = { id: 683999 }
    const b = { id: 683652 }
    expect(await nameOf([a, b])).toBe('Weedle')
    expect(await nameOf([b, a])).toBe('Weedle')
  })

  it('names a card no product names by its species, keeping the Japanese name and the keys', async () => {
    const db = openDatabase(':memory:')
    try {
      const [report] = (
        await refreshPokemon(
          db,
          fixtureSources({
            // No Japanese group matches, so no product names a Japanese card.
            groups: (lang, g) => (lang === 'ja' ? [] : g),
            card: (lang, c) =>
              lang === 'ja' && c.id === 'SV1S-008'
                ? { ...c, name: 'クヌギダマex', dexId: [204] }
                : c
          })
        )
      ).filter((r) => r.lang === 'ja')
      const id = cid('ja/SV1S-008')
      expect(db.prepare('SELECT name FROM cards WHERE id = ?').get(id)).toEqual({
        name: 'Pineco ex'
      })
      expect(db.prepare('SELECT local_name FROM pokemon_cards WHERE card_id = ?').get(id)).toEqual({
        local_name: 'クヌギダマex'
      })
      // A species with no English card in the run keeps its Japanese name.
      expect(db.prepare('SELECT name FROM cards WHERE id = ?').get(cid('ja/SV1S-001'))).toEqual({
        name: 'サボネア'
      })
      expect(report.englishNamed).toBe(1)
      expect(report.japaneseNames).toBe(report.cards - 1)
      expect(printings(db, 'ja/SV1S-008').every((p) => p.pkey.includes(String(id)))).toBe(true)
    } finally {
      db.close()
    }
  })
})
