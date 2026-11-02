import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { browseCards, browseFacets, browseFacetsFast } from '../../src/main/repo/browse'
import { addEntry } from '../../src/main/repo/collection'
import { pokemonId } from '../../src/shared/games'
import { seedPokemon } from '../fixtures/pokemon'
import { seededDb } from './helpers'

const names = (p: { cards: { name: string }[] }): string[] => p.cards.map((c) => c.name)

const cardId = (db: Database.Database, name: string): number =>
  (db.prepare('SELECT id FROM cards WHERE name = ?').get(name) as { id: number }).id

/**
 * The seeded cards plus foreign printings: Pot of Greed in German (a set dated only in English),
 * Harpie's Feather Duster (no English printing) in Japanese (a dated set) and in German (undated).
 */
async function multilingualDb(): Promise<Database.Database> {
  const db = await seededDb()
  const set = db.prepare(
    "INSERT OR REPLACE INTO sets (game, language, set_name, set_code, tcg_date) VALUES ('ygo', ?, ?, ?, ?)"
  )
  set.run('en', 'Legendary Collection', 'LCYW', '2010-10-05')
  set.run('de', 'Legendary Collection', 'LCYW', null)
  set.run('ja', 'Dark Beginning', 'DB1', '2004-12-01')
  set.run('de', 'Undated Set', 'UND', null)
  const printing = db.prepare(
    "INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity) VALUES ('ygo', ?, ?, ?, ?, ?)"
  )
  printing.run(
    cardId(db, 'Pot of Greed'),
    'de',
    'Legendary Collection',
    'LCYW-DE001',
    'Secret Rare'
  )
  printing.run(cardId(db, "Harpie's Feather Duster"), 'ja', 'Dark Beginning', 'DB1-JP001', 'Rare')
  printing.run(cardId(db, "Harpie's Feather Duster"), 'de', 'Undated Set', 'UND-DE001', 'Common')
  return db
}

describe('browseCards', () => {
  it('lists every card, owned or not, sorted by name', async () => {
    const db = await seededDb()
    const page = browseCards(db, { sort: 'name', dir: 'asc' })
    expect(page.total).toBe(3)
    expect(names(page)).toEqual(['Dark Magician', "Harpie's Feather Duster", 'Pot of Greed'])
    expect(page.cards[0]).toMatchObject({ owned: 0, price: 7.5, atk: 2500, level: 7 })
    expect(page.cards[0].defaultPrintingId).not.toBeNull()
    expect(page.cards[1].defaultPrintingId).toBeNull()
  })

  it('searches names and set codes, and filters by type and set', async () => {
    const db = await seededDb()
    expect(names(browseCards(db, { q: 'pot', sort: 'name', dir: 'asc' }))).toEqual(['Pot of Greed'])
    expect(names(browseCards(db, { q: 'SDY', sort: 'name', dir: 'asc' }))).toEqual([
      'Dark Magician'
    ])
    expect(names(browseCards(db, { cardTypes: ['Spell Card'], sort: 'name', dir: 'asc' }))).toEqual(
      ["Harpie's Feather Duster", 'Pot of Greed']
    )
    expect(
      names(browseCards(db, { setNames: ['Starter Deck: Yugi'], sort: 'name', dir: 'asc' }))
    ).toEqual(['Dark Magician'])
  })

  it('falls back to name for a sort value that is a prototype key', async () => {
    const db = await seededDb()
    for (const sort of ['__proto__', 'constructor', 'toString']) {
      const page = browseCards(db, { sort: sort as 'name', dir: 'asc' })
      expect(names(page)).toEqual(['Dark Magician', "Harpie's Feather Duster", 'Pot of Greed'])
    }
  })

  it('sorts by price with unpriced cards last either way', async () => {
    const db = await seededDb()
    expect(names(browseCards(db, { sort: 'price', dir: 'desc' }))).toEqual([
      'Dark Magician',
      'Pot of Greed',
      "Harpie's Feather Duster"
    ])
    expect(names(browseCards(db, { sort: 'price', dir: 'asc' }))[2]).toBe("Harpie's Feather Duster")
  })

  it('splits owned from not owned and counts copies', async () => {
    const db = await seededDb()
    const dm = browseCards(db, { q: 'dark magician', sort: 'name', dir: 'asc' }).cards[0]
    addEntry(db, { printingId: dm.defaultPrintingId as number, imageId: dm.imageId, quantity: 2 })
    const owned = browseCards(db, { owned: 'owned', sort: 'name', dir: 'asc' })
    expect(owned.total).toBe(1)
    expect(owned.cards[0]).toMatchObject({ name: 'Dark Magician', owned: 2 })
    expect(browseCards(db, { owned: 'missing', sort: 'name', dir: 'asc' }).total).toBe(2)
  })

  it('pages with offset and limit', async () => {
    const db = await seededDb()
    const page = browseCards(db, { sort: 'name', dir: 'asc', offset: 1, limit: 1 })
    expect(page.total).toBe(3)
    expect(names(page)).toEqual(["Harpie's Feather Duster"])
  })
})

describe('browseCards by language', () => {
  const BY_NAME = { sort: 'name', dir: 'asc' } as const

  it('lists the cards with a printing in the language; none is every language', async () => {
    const db = await multilingualDb()
    expect(names(browseCards(db, { ...BY_NAME, language: 'en' }))).toEqual([
      'Dark Magician',
      'Pot of Greed'
    ])
    expect(names(browseCards(db, { ...BY_NAME, language: 'de' }))).toEqual([
      "Harpie's Feather Duster",
      'Pot of Greed'
    ])
    expect(names(browseCards(db, { ...BY_NAME, language: 'ja' }))).toEqual([
      "Harpie's Feather Duster"
    ])
    expect(browseCards(db, { ...BY_NAME, language: 'ko' }).total).toBe(0)
    expect(browseCards(db, BY_NAME).total).toBe(3)
    // A code that isn't a language counts as every language rather than reaching the SQL.
    expect(browseCards(db, { ...BY_NAME, language: "en' OR 1=1 --" as 'en' }).total).toBe(3)
  })

  it("set, rarity and set-code search match the language's printings", async () => {
    const db = await multilingualDb()
    const secret = { ...BY_NAME, rarities: ['Secret Rare'] }
    expect(names(browseCards(db, { ...secret, language: 'de' }))).toEqual(['Pot of Greed'])
    expect(browseCards(db, { ...secret, language: 'en' }).total).toBe(0)
    expect(names(browseCards(db, secret))).toEqual(['Pot of Greed'])
    const set = { ...BY_NAME, setNames: ['Legendary Collection'] }
    expect(browseCards(db, { ...set, language: 'en' }).total).toBe(0)
    expect(names(browseCards(db, { ...set, language: 'de' }))).toEqual(['Pot of Greed'])
    expect(browseCards(db, { ...BY_NAME, q: 'LCYW', language: 'en' }).total).toBe(0)
    expect(names(browseCards(db, { ...BY_NAME, q: 'LCYW', language: 'de' }))).toEqual([
      'Pot of Greed'
    ])
  })

  it("dates and preselects the language's printings, an undated set taking its English date", async () => {
    const db = await multilingualDb()
    const de = browseCards(db, { sort: 'released', dir: 'desc', language: 'de' }).cards
    // Pot of Greed's German set has no date of its own; Harpie's is dated nowhere, so it goes last.
    expect(de.map((c) => [c.name, c.releasedAt])).toEqual([
      ['Pot of Greed', '2010-10-05'],
      ["Harpie's Feather Duster", null]
    ])
    const lang = (id: number | null): string =>
      (
        db.prepare('SELECT language FROM card_printings WHERE id = ?').get(id) as {
          language: string
        }
      ).language
    expect(de.map((c) => lang(c.defaultPrintingId))).toEqual(['de', 'de'])
    const ja = browseCards(db, { ...BY_NAME, language: 'ja' }).cards[0]
    expect(ja.releasedAt).toBe('2004-12-01')
    // With every language, an English printing is preselected when there is one.
    const all = browseCards(db, BY_NAME).cards
    expect(all.map((c) => lang(c.defaultPrintingId))).toEqual(['en', 'ja', 'en'])
  })

  it('works for Pokémon languages', async () => {
    const db = await seededDb()
    seedPokemon(db)
    const zh = pokemonId('zh-hans/test-001')
    db.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
       VALUES (?, 'pkm', '皮卡丘', 'Pokémon', 'pokemon', '', '', '2026-10-29')`
    ).run(zh)
    db.prepare(
      `INSERT INTO pokemon_cards (card_id, category, hp, types, stage, rarity, illustrator, source_id)
       VALUES (?, 'Pokémon', 60, '[]', 'Basic', 'Common', 'x', 'zh-hans/test-001')`
    ).run(zh)
    db.prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
       VALUES ('pkm', ?, 'zh-hans', '测试', 'CS1 001/100', 'Normal')`
    ).run(zh)
    db.prepare("INSERT INTO meta (key, value) VALUES ('active_game', 'pkm')").run()
    expect(names(browseCards(db, { ...BY_NAME, language: 'en' }))).toEqual(['Pikachu'])
    expect(names(browseCards(db, { ...BY_NAME, language: 'ja' }))).toEqual(['ピカチュウ'])
    expect(names(browseCards(db, { ...BY_NAME, language: 'zh-hans' }))).toEqual(['皮卡丘'])
    expect(browseCards(db, BY_NAME).total).toBe(3)
    expect(browseFacets(db, undefined, 'zh-hans').setNames).toEqual(['测试'])
    expect(browseFacets(db).languages).toEqual(['en', 'ja', 'zh-hans'])
  })
})

describe('browseFacets', () => {
  it("lists the language's sets and rarities, and the languages with printings", async () => {
    const db = await multilingualDb()
    const de = browseFacets(db, undefined, 'de')
    expect(de.setNames).toEqual(['Legendary Collection', 'Undated Set'])
    expect(de.rarities).toEqual(['Common', 'Secret Rare'])
    const en = browseFacets(db, undefined, 'en')
    expect(en.setNames).not.toContain('Legendary Collection')
    expect(en.rarities).toEqual(['Rare', 'Ultra Rare'])
    expect(browseFacets(db).rarities).toEqual(['Common', 'Rare', 'Secret Rare', 'Ultra Rare'])
    expect(browseFacets(db).languages).toEqual(['en', 'ja', 'de'])
    // Each language keeps its own rollup.
    expect(browseFacetsFast(db, undefined, 'de')).toEqual(de)
    expect(browseFacetsFast(db, undefined, 'en')).toEqual(en)
  })

  it('lists options from the whole database', async () => {
    const db = await seededDb()
    const f = browseFacets(db)
    expect(f.cardTypes).toEqual(['Normal Monster', 'Spell Card'])
    expect(f.races).toContain('Spellcaster')
    expect(f.setNames).toContain('Starter Deck: Yugi')
    expect(f.rarities).toEqual(['Rare', 'Ultra Rare'])
  })
})
