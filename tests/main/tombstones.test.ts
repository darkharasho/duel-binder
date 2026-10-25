import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type Database from 'better-sqlite3'
import { vi } from 'vitest'
import { deleteMeta, setMeta } from '../../src/main/db/meta'
import { browseCards } from '../../src/main/repo/browse'
import {
  addEntry,
  entriesForCard,
  getEntry,
  getFacets,
  listEntries,
  removeEntry,
  updateEntry
} from '../../src/main/repo/collection'
import { adjustPrinting, getChecklist, listSets } from '../../src/main/repo/sets'
import { getStats } from '../../src/main/repo/stats'
import type { PriceClient } from '../../src/main/prices/client'
import { refreshIntlPrices } from '../../src/main/prices/refresh'
import { seededDb } from './helpers'

let db: Database.Database
beforeEach(async () => {
  db = await seededDb()
  // Tombstones are kept for signed-in owners; owner 0 (never signed in) hard-deletes, tested below.
  setMeta(db, 'cloud_active_owner', '1')
})
afterEach(() => db.close())

const ROOT = join(__dirname, '../..')
const SET = 'Legend of Blue Eyes White Dragon'
const ALL = { sort: 'name', dir: 'asc' } as const
const now = new Date('2026-10-25T12:00:00.000Z')
const later = new Date('2026-10-25T13:00:00.000Z')
const pid = (code: string): number =>
  (db.prepare('SELECT id FROM card_printings WHERE set_code = ?').get(code) as { id: number }).id

interface RawRow {
  id: number
  uid: string
  quantity: number
  notes: string
  updated_at: string
  deleted_at: string | null
  dirty: number
}
const raw = (id: number): RawRow =>
  db
    .prepare('SELECT id, uid, quantity, notes, updated_at, deleted_at, dirty FROM collection_entries WHERE id = ?')
    .get(id) as RawRow

/** A: Dark Magician LOB-EN005, B: Pot of Greed LOB-EN119; both in the same set. */
const addAB = (): { a: number; b: number } => ({
  a: addEntry(db, { printingId: pid('LOB-EN005'), imageId: 46986414, quantity: 2 }, now).id,
  b: addEntry(db, { printingId: pid('LOB-EN119'), imageId: 55144522, quantity: 1 }, now).id
})

test('removing an entry keeps a dirty tombstone', () => {
  const { a } = addAB()
  db.prepare('UPDATE collection_entries SET dirty = 0').run()
  removeEntry(db, a, later)
  expect(raw(a)).toMatchObject({
    quantity: 2,
    deleted_at: later.toISOString(),
    updated_at: later.toISOString(),
    dirty: 1
  })
})

test('removing a never-signed-in (owner 0) entry deletes the row', () => {
  deleteMeta(db, 'cloud_active_owner')
  const { a, b } = addAB()
  removeEntry(db, a, later)
  expect(raw(a)).toBeUndefined()
  expect(raw(b)).toMatchObject({ deleted_at: null })
  // A merge that removes the loser also hard-deletes it.
  const c = addEntry(db, { printingId: pid('SDY-006'), imageId: 46986414, quantity: 1 }, later).id
  updateEntry(db, c, { printingId: pid('LOB-EN119'), imageId: 55144522 }, later)
  expect(raw(c)).toBeUndefined()
  expect(raw(b).quantity).toBe(2)
  expect(db.prepare('SELECT COUNT(*) AS n FROM collection_entries WHERE deleted_at IS NOT NULL').get()).toEqual({ n: 0 })
})

test('removing another owner’s entry does nothing', () => {
  const { a } = addAB()
  db.prepare('UPDATE collection_entries SET dirty = 0').run()
  setMeta(db, 'cloud_active_owner', '7')
  removeEntry(db, a, later)
  expect(raw(a)).toMatchObject({ deleted_at: null, dirty: 0, updated_at: now.toISOString() })
})

test('tombstones are invisible to every reader', () => {
  const { a, b } = addAB()
  removeEntry(db, a, later)
  expect(listEntries(db, ALL).map((e) => e.id)).toEqual([b])
  expect(getEntry(db, a)).toBeNull()
  expect(entriesForCard(db, 46986414)).toEqual([])
  expect(getFacets(db).setNames).toEqual([SET])
  expect(getFacets(db).cardTypes).toEqual(['Spell Card'])
  const stats = getStats(db)
  expect(stats.totalCards).toBe(1)
  expect(stats.uniqueCards).toBe(1)
  const browse = browseCards(db, { sort: 'name', dir: 'asc' })
  expect(browse.cards.find((c) => c.id === 46986414)?.owned).toBe(0)
  expect(browse.cards.find((c) => c.id === 55144522)?.owned).toBe(1)
  expect(browseCards(db, { sort: 'name', dir: 'asc', owned: 'owned' }).cards.map((c) => c.id)).toEqual([55144522])
  const set = listSets(db).find((s) => s.setName === SET && s.language === 'en')!
  expect(set.ownedCards).toBe(1)
  const checklist = getChecklist(db, SET, 'en')!
  expect(checklist.set.ownedCards).toBe(1)
  const dm = checklist.cards.find((c) => c.cardId === 46986414)!
  expect(dm).toMatchObject({ owned: 0, entryId: null })

  const before = raw(a)
  adjustPrinting(db, SET, 'en', pid('LOB-EN005'), -1, new Date('2026-10-25T14:00:00.000Z'))
  expect(raw(a)).toEqual(before)
})

test('re-adding a removed printing makes a new live entry', () => {
  const { a } = addAB()
  removeEntry(db, a, later)
  const tomb = raw(a)
  const again = addEntry(db, { printingId: pid('LOB-EN005'), imageId: 46986414, quantity: 1 }, later)
  expect(again.id).not.toBe(a)
  expect(again.quantity).toBe(1)
  expect(raw(again.id).uid).not.toBe(tomb.uid)
  expect(raw(again.id).deleted_at).toBeNull()
  expect(raw(a)).toEqual(tomb)
})

test('every local write marks the entry dirty', () => {
  const dirty = (action: () => void): number[] => {
    db.prepare('UPDATE collection_entries SET dirty = 0').run()
    action()
    return (db.prepare('SELECT id FROM collection_entries WHERE dirty = 1 ORDER BY id').all() as { id: number }[]).map(
      (r) => r.id
    )
  }
  const { a, b } = addAB()
  let c = 0
  // add new
  expect(
    dirty(() => {
      c = addEntry(db, { printingId: pid('SDY-006'), imageId: 46986414, quantity: 1 }, later).id
    })
  ).toEqual([c])
  // add-sum
  expect(dirty(() => addEntry(db, { printingId: pid('LOB-EN005'), imageId: 46986414, quantity: 1 }, later))).toEqual([a])
  // update in place
  expect(dirty(() => updateEntry(db, a, { notes: 'x' }, later))).toEqual([a])
  // update that merges: c (SDY-006) re-linked onto a's printing and art
  expect(dirty(() => updateEntry(db, c, { printingId: pid('LOB-EN005') }, later))).toEqual([a, c])
  expect(raw(c).deleted_at).toBe(later.toISOString())
  // adjustPrinting +1, -1 (decrement), -1 (to zero)
  expect(dirty(() => adjustPrinting(db, SET, 'en', pid('LOB-EN119'), 1, later))).toEqual([b])
  expect(dirty(() => adjustPrinting(db, SET, 'en', pid('LOB-EN119'), -1, later))).toEqual([b])
  expect(raw(b)).toMatchObject({ quantity: 1, deleted_at: null })
  expect(dirty(() => adjustPrinting(db, SET, 'en', pid('LOB-EN119'), -1, later))).toEqual([b])
  expect(raw(b).deleted_at).toBe(later.toISOString())
  // remove
  expect(dirty(() => removeEntry(db, a, later))).toEqual([a])
})

test('the price refresh ignores removed copies', async () => {
  const { a } = addAB()
  removeEntry(db, a, later)
  const lookup = vi.fn(async () => ({ price: 9, listingCount: 2, checkedAt: later.toISOString() }))
  await refreshIntlPrices(db, { lookup } as unknown as PriceClient, { now: later })
  expect(lookup.mock.calls.map((c) => (c as unknown as [{ code: string }])[0].code)).toEqual(['LOB-EN119'])
})

/** Every .ts file under `dir`, as a path relative to the repo root. */
function tsFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(join(ROOT, path)).isDirectory()) return tsFiles(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

const SCOPED = 'scoped'
const LIVE = 'live rows of any owner (deleted_at IS NULL)'
const FK = 'catalog FK check, tombstones intentionally count'
const DDL = 'schema or migration DDL'
const SYNC = 'sync, reads and writes tombstones explicitly'

/**
 * Every file under src/main and workers/portal/src that names collection_entries, with how many
 * times. A new reference must be added here with its kind; a sync file is a one-line entry.
 */
const ENTRY_REFS: Record<string, [count: number, kind: string]> = {
  'src/main/repo/browse.ts': [2, SCOPED],
  'src/main/repo/collection.ts': [6, SCOPED],
  'src/main/repo/scope.ts': [5, SCOPED],
  'src/main/repo/sets.ts': [5, SCOPED],
  'workers/portal/src/scope.ts': [3, SCOPED],
  'src/main/prices/refresh.ts': [1, LIVE],
  'src/main/dev/fakeData.ts': [2, LIVE],
  'src/main/index.ts': [1, LIVE],
  'src/main/sync/sync.ts': [1, FK],
  'src/main/sync/intl.ts': [1, FK],
  'src/main/tcgplayer/catalog.ts': [1, FK],
  'workers/portal/src/catalogLoad.ts': [1, FK],
  'workers/portal/src/sync.ts': [5, SYNC],
  'src/main/cloud/localSync.ts': [11, SYNC],
  'src/main/db/schema.ts': [9, DDL],
  'workers/portal/src/migrate.ts': [10, DDL]
}

test('every collection_entries query is accounted for', () => {
  const found: Record<string, number> = {}
  for (const file of [...tsFiles('src/main'), ...tsFiles('workers/portal/src')]) {
    const n = (readFileSync(join(ROOT, file), 'utf8').match(/collection_entries/g) ?? []).length
    if (n > 0) found[relative('.', file)] = n
  }
  const pinned = Object.fromEntries(Object.entries(ENTRY_REFS).map(([f, [n]]) => [f, n]))
  expect(found).toEqual(pinned)
})

test('every repo UPDATE of collection_entries applies scope.touch', () => {
  const repo = 'src/main/repo'
  let checked = 0
  // scope.ts is excluded: it defines touch, and LOCAL.deleteEntry spells out `dirty = 1` itself.
  for (const name of readdirSync(join(ROOT, repo)).filter((n) => n.endsWith('.ts') && n !== 'scope.ts')) {
    const src = readFileSync(join(ROOT, repo, name), 'utf8')
    for (const m of src.match(/UPDATE collection_entries SET[^`']*/g) ?? []) {
      expect(m, `${name}: ${m}`).toContain('${scope.touch}')
      checked++
    }
  }
  expect(checked).toBe(4)
})
