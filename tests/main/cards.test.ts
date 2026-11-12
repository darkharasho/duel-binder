import type Database from 'better-sqlite3'
import { buildFtsQuery, getCardDetail, searchCards } from '../../src/main/repo/cards'
import { seededDb } from './helpers'
import { seedPokemon } from '../fixtures/pokemon'

let db: Database.Database
beforeAll(async () => {
  db = await seededDb()
})
afterAll(() => db.close())

test('buildFtsQuery', () => {
  expect(buildFtsQuery("Harpie's")).toBe('"Harpie"* "s"*')
  expect(buildFtsQuery(' - " ')).toBeNull()
})

test('name prefix search', () =>
  expect(searchCards(db, 'dark mag').map((r) => r.id)).toEqual([46986414]))
test("other games' results carry no language or printed name", () =>
  expect(Object.keys(searchCards(db, 'dark mag')[0]).sort()).toEqual([
    'defaultImageId',
    'id',
    'matchedSetCode',
    'name',
    'type'
  ]))
test('apostrophes and FTS syntax never throw', () => {
  expect(searchCards(db, "Harpie's").map((r) => r.id)).toEqual([18144506])
  for (const q of ['"', '*', '-', '(', 'NOT', 'a AND', '  ', 'pot"of'])
    expect(() => searchCards(db, q)).not.toThrow()
  expect(searchCards(db, '   ')).toEqual([])
})
test('set code search', () =>
  expect(searchCards(db, 'lob-en1')[0]).toMatchObject({
    id: 55144522,
    matchedSetCode: 'LOB-EN119'
  }))
test('LIKE wildcards are literal', () => expect(searchCards(db, 'LOB-%')).toEqual([]))
test('getCardDetail', () => {
  const d = getCardDetail(db, 46986414)!
  expect(d.printings.map((p) => p.setCode)).toEqual(['LOB-EN005', 'SDY-006'])
  expect(d.images).toHaveLength(2)
  // Only a Magic image can have a back face; the others keep exactly this shape.
  for (const i of d.images)
    expect(Object.keys(i).sort()).toEqual(['cardId', 'imageId', 'sortOrder'])
  expect(d.card.name).toBe('Dark Magician')
  expect(getCardDetail(db, 1)).toBeNull()
})

test("getCardDetail dates a printing by its set, else the English set's", () => {
  db.prepare(
    "INSERT OR REPLACE INTO sets (game, language, set_name, set_code, tcg_date) VALUES ('ygo','en','Legend of Blue Eyes White Dragon','LOB','2002-03-08')"
  ).run()
  const d = getCardDetail(db, 46986414)!
  expect(d.printings.find((p) => p.setCode === 'LOB-EN005')?.releaseDate).toBe('2002-03-08')
})
test('getCardDetail leaves releaseDate out when the set has no date', () => {
  const d = getCardDetail(db, 46986414)!
  expect(d.printings.find((p) => p.setCode === 'SDY-006')).not.toHaveProperty('releaseDate')
})
test("getCardDetail dates a non-English printing by the English set's date when its own set row is missing", () => {
  db.prepare(
    "INSERT OR REPLACE INTO sets (game, language, set_name, set_code, tcg_date) VALUES ('ygo','en','Legend of Blue Eyes White Dragon','LOB','2002-03-08')"
  ).run()
  db.prepare(
    "INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language) VALUES (46986414, 'Legend of Blue Eyes White Dragon', 'LOB-DE005', 'Common', 'de')"
  ).run()
  const d = getCardDetail(db, 46986414)!
  expect(d.printings.find((p) => p.setCode === 'LOB-DE005')?.releaseDate).toBe('2002-03-08')
  db.prepare("DELETE FROM card_printings WHERE set_code = 'LOB-DE005'").run()
})

test('Pokémon cards are not found by name or number from a Yu-Gi-Oh! search', async () => {
  const other = await seededDb()
  seedPokemon(other)
  expect(searchCards(other, 'Pikachu')).toEqual([])
  expect(searchCards(other, '045')).toEqual([])
  expect(searchCards(other, '45/193')).toEqual([])
  other.close()
})

describe('name search order', () => {
  const ids: Record<string, number> = {}
  beforeAll(() => {
    let next = 9000
    const add = (name: string, sets: [string, string][]): void => {
      const id = next++
      ids[name] = id
      db.prepare(
        `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at) VALUES (?, ?, 'Normal Monster', 'normal', 'Warrior', '', '2026-10-01')`
      ).run(id, name)
      for (const [setName, code] of sets)
        db.prepare(
          `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language) VALUES (?, ?, ?, 'Common', 'en')`
        ).run(id, setName, code)
    }
    const dates = [
      ['Old Set', '2002-01-01'],
      ['Mid Set', '2010-01-01'],
      ['New Set', '2024-01-01']
    ]
    for (const [n, d] of dates)
      db.prepare(
        "INSERT INTO sets (language, set_name, set_code, tcg_date) VALUES ('en', ?, 'ZZ', ?)"
      ).run(n, d)
    add('Zorbo Old', [['Old Set', 'ZZ-EN001']])
    add('Zorbo Newest', [
      ['Old Set', 'ZZ-EN002'],
      ['New Set', 'ZZ-EN003']
    ])
    add('Zorbo Mid', [['Mid Set', 'ZZ-EN004']])
    add('Zorbo Undated', [['Unknown Set', 'ZZ-EN005']])
    add('Zorbo', [['Old Set', 'ZZ-EN006']])
    db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')")
  })

  test('exact name first, then newest printing first, undated last', () => {
    expect(searchCards(db, 'zorbo').map((r) => r.id)).toEqual(
      ['Zorbo', 'Zorbo Newest', 'Zorbo Mid', 'Zorbo Old', 'Zorbo Undated'].map((n) => ids[n])
    )
  })

  test('a partial name has no exact match, so the newest leads', () => {
    expect(searchCards(db, 'zorb').map((r) => r.id)[0]).toBe(ids['Zorbo Newest'])
  })
})
