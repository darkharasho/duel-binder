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

test('name prefix search', () => expect(searchCards(db, 'dark mag').map((r) => r.id)).toEqual([46986414]))
test('apostrophes and FTS syntax never throw', () => {
  expect(searchCards(db, "Harpie's").map((r) => r.id)).toEqual([18144506])
  for (const q of ['"', '*', '-', '(', 'NOT', 'a AND', '  ', 'pot"of']) expect(() => searchCards(db, q)).not.toThrow()
  expect(searchCards(db, '   ')).toEqual([])
})
test('set code search', () =>
  expect(searchCards(db, 'lob-en1')[0]).toMatchObject({ id: 55144522, matchedSetCode: 'LOB-EN119' }))
test('LIKE wildcards are literal', () => expect(searchCards(db, 'LOB-%')).toEqual([]))
test('getCardDetail', () => {
  const d = getCardDetail(db, 46986414)!
  expect(d.printings.map((p) => p.setCode)).toEqual(['LOB-EN005', 'SDY-006'])
  expect(d.images).toHaveLength(2)
  expect(d.card.name).toBe('Dark Magician')
  expect(getCardDetail(db, 1)).toBeNull()
})

test('Pokémon cards are not found by name or number from a Yu-Gi-Oh! search', async () => {
  const other = await seededDb()
  seedPokemon(other)
  expect(searchCards(other, 'Pikachu')).toEqual([])
  expect(searchCards(other, '045')).toEqual([])
  expect(searchCards(other, '45/193')).toEqual([])
  other.close()
})
