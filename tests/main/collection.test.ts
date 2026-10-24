import type Database from 'better-sqlite3'
import {
  CollectionError,
  addEntry,
  entriesForCard,
  getEntry,
  getFacets,
  listEntries,
  removeEntry,
  updateEntry
} from '../../src/main/repo/collection'
import { seededDb } from './helpers'

let db: Database.Database
beforeEach(async () => {
  db = await seededDb()
})
afterEach(() => db.close())

const pid = (code: string): number =>
  (db.prepare('SELECT id FROM card_printings WHERE set_code = ?').get(code) as { id: number }).id
const all = { sort: 'name', dir: 'asc' } as const

test('add then add again increments', () => {
  addEntry(db, { printingId: pid('LOB-EN005'), imageId: 46986414, quantity: 2 })
  const e = addEntry(db, { printingId: pid('LOB-EN005'), imageId: 46986414, quantity: 3 })
  expect(e.quantity).toBe(5)
  expect(listEntries(db, all)).toHaveLength(1)
})

test.each([0, -1, 1.5])('rejects quantity %s', (quantity) => {
  expect(() => addEntry(db, { printingId: pid('LOB-EN005'), imageId: 46986414, quantity })).toThrow(CollectionError)
})

test('rejects image from another card', () => {
  expect(() => addEntry(db, { printingId: pid('LOB-EN119'), imageId: 46986414, quantity: 1 })).toThrow(CollectionError)
})

test('entry value uses set price', () => {
  const e = addEntry(db, { printingId: pid('LOB-EN005'), imageId: 46986414, quantity: 2 })
  expect(e).toMatchObject({ unitPrice: 5.12, priceApproximate: false })
  expect(e.totalValue).toBeCloseTo(10.24)
})

test('entry value falls back', () => {
  const e = addEntry(db, { printingId: pid('SDY-006'), imageId: 46986414, quantity: 1 })
  expect(e).toMatchObject({ unitPrice: 7.5, priceApproximate: true, totalValue: 7.5 })
})

test('entry with no price at all', () => {
  const info = db
    .prepare(
      `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_price) VALUES (18144506, 'X', 'XXX-001', 'Common', NULL)`
    )
    .run()
  const e = addEntry(db, { printingId: Number(info.lastInsertRowid), imageId: 18144506, quantity: 3 })
  expect(e.unitPrice).toBeNull()
  expect(e.totalValue).toBe(0)
  expect(e.priceApproximate).toBe(true)
})

test('changing art onto an existing combination merges', () => {
  const a = addEntry(db, { printingId: pid('LOB-EN005'), imageId: 46986414, quantity: 1 })
  db.prepare('UPDATE collection_entries SET notes = ? WHERE id = ?').run('a', a.id)
  const b = addEntry(db, { printingId: pid('LOB-EN005'), imageId: 46986415, quantity: 2 })
  db.prepare('UPDATE collection_entries SET notes = ? WHERE id = ?').run('b', b.id)
  const merged = updateEntry(db, b.id, { imageId: 46986414 })
  expect(merged).toMatchObject({ id: a.id, quantity: 3, notes: 'a\nb' })
  expect(getEntry(db, b.id)).toBeNull()
  expect(listEntries(db, all)).toHaveLength(1)
})

test('re-link printing onto an existing combination merges', () => {
  const a = addEntry(db, { printingId: pid('LOB-EN005'), imageId: 46986414, quantity: 1 })
  const b = addEntry(db, { printingId: pid('SDY-006'), imageId: 46986414, quantity: 2 })
  const merged = updateEntry(db, b.id, { printingId: pid('LOB-EN005') })
  expect(merged).toMatchObject({ id: a.id, quantity: 3, notes: '' })
  expect(getEntry(db, b.id)).toBeNull()
})

test('update validates and edits in place', () => {
  const a = addEntry(db, { printingId: pid('LOB-EN005'), imageId: 46986414, quantity: 1 })
  expect(() => updateEntry(db, a.id, { quantity: 0 })).toThrow(CollectionError)
  expect(() => updateEntry(db, a.id, { imageId: 55144522 })).toThrow(CollectionError)
  expect(() => updateEntry(db, 9999, { quantity: 2 })).toThrow(CollectionError)
  expect(updateEntry(db, a.id, { quantity: 4, notes: 'hi' })).toMatchObject({ id: a.id, quantity: 4, notes: 'hi' })
})

test('filters and sorting', () => {
  addEntry(db, { printingId: pid('LOB-EN005'), imageId: 46986414, quantity: 1 })
  addEntry(db, { printingId: pid('SDY-006'), imageId: 46986414, quantity: 1 })
  addEntry(db, { printingId: pid('LOB-EN119'), imageId: 55144522, quantity: 1 })
  expect(listEntries(db, { ...all, rarities: ['Rare'] }).map((e) => e.card.name)).toEqual(['Pot of Greed'])
  expect(listEntries(db, { ...all, q: 'magician' })).toHaveLength(2)
  expect(listEntries(db, { ...all, q: 'lob-en1' }).map((e) => e.card.name)).toEqual(['Pot of Greed'])
  expect(() => listEntries(db, { ...all, q: '"(*' })).not.toThrow()
  const byValue = listEntries(db, { sort: 'value', dir: 'desc' }).map((e) => e.totalValue)
  expect(byValue).toEqual([...byValue].sort((x, y) => y - x))
  expect(byValue[0]).toBe(7.5)
  expect(entriesForCard(db, 46986414)).toHaveLength(2)
})

test('facets list owned values only', () => {
  addEntry(db, { printingId: pid('LOB-EN119'), imageId: 55144522, quantity: 1 })
  const f = getFacets(db)
  expect(f.rarities).toEqual(['Rare'])
  expect(f.setNames).toHaveLength(1)
  expect(f.cardTypes).toHaveLength(1)
})

test('remove deletes', () => {
  const a = addEntry(db, { printingId: pid('LOB-EN005'), imageId: 46986414, quantity: 1 })
  removeEntry(db, a.id)
  expect(getEntry(db, a.id)).toBeNull()
})
