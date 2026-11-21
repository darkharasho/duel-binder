import type Database from 'better-sqlite3'
import { searchCards } from '../../src/main/repo/cards'
import { editDistance, nearNameWords } from '../../src/main/repo/nearNames'
import { seededDb } from './helpers'

let db: Database.Database
beforeAll(async () => {
  db = await seededDb()
})
afterAll(() => db.close())

test('edit distance counts a swap as one', () => {
  expect(editDistance('charzard', 'charizard', 2)).toBe(1)
  expect(editDistance('abcd', 'badc', 2)).toBe(2)
  expect(editDistance('abc', 'abcdefg', 2)).toBe(3)
})

test('a misspelt name finds its near words, closest first', () => {
  expect(nearNameWords(db, 'majician')).toContain('magician')
  expect(nearNameWords(db, 'MAGICIAN')).toEqual([]) // spelt right
  expect(nearNameWords(db, 'magi')).toEqual([]) // a start of a name
  expect(nearNameWords(db, 'xq')).toEqual([])
  expect(nearNameWords(db, 'zzzzzz')).toEqual([])
})

test('a misspelt name returns the card rows marked nearMiss', () => {
  const rows = searchCards(db, 'dark magican')
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.every((r) => r.nearMiss === "dark magician")).toBe(true)
  expect(rows.map((r) => r.name)).toContain('Dark Magician')
  expect(searchCards(db, 'xq')).toEqual([])
})

test('a query with results never reads the vocab', () => {
  const sqls: string[] = []
  const real = db.prepare.bind(db)
  const spy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
    sqls.push(sql)
    return real(sql)
  }) as typeof db.prepare)
  const rows = searchCards(db, 'dark magician')
  spy.mockRestore()
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.some((r) => r.nearMiss)).toBe(false)
  expect(sqls.some((s) => s.includes('cards_fts_vocab'))).toBe(false)
})
