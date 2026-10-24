import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { seededDb } from './helpers'
import { getMeta } from '../../src/main/db/meta'
import { SYNC_INTERVAL_MS, getSyncStatus, runSync, shouldSync } from '../../src/main/sync/sync'
import type { YgoClient } from '../../src/main/ygo/client'
import type { ApiCard } from '../../src/main/ygo/mapCard'
import fixture from '../fixtures/cardinfo.sample.json'

const cards = fixture.data as ApiCard[]
const NOW = new Date('2026-10-23T12:00:00.000Z')
const HOUR = 60 * 60 * 1000

const okClient = (data: ApiCard[] = cards): YgoClient => ({
  fetchCardSets: async () => [],
  fetchDbVersion: async () => ({ databaseVersion: '123.45', lastUpdate: '2026-10-22' }),
  fetchCardInfo: async () => data
})

let db: Database.Database
beforeEach(() => {
  db = openDatabase(':memory:')
})
afterEach(() => db.close())

const count = (table: string): number =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
const printingIds = (): Record<string, number> =>
  Object.fromEntries(
    (db.prepare('SELECT id, set_code FROM card_printings').all() as { id: number; set_code: string }[]).map(
      (r) => [r.set_code, r.id]
    )
  )

test('shouldSync honours the 24 hour threshold', () => {
  expect(SYNC_INTERVAL_MS).toBe(24 * HOUR)
  expect(shouldSync(null, NOW)).toBe(true)
  expect(shouldSync(new Date(NOW.getTime() - 23 * HOUR).toISOString(), NOW)).toBe(false)
  expect(shouldSync(new Date(NOW.getTime() - 25 * HOUR).toISOString(), NOW)).toBe(true)
})

test('first sync loads fixture', async () => {
  const status = await runSync(db, okClient(), () => {}, NOW)
  expect(status).toMatchObject({ state: 'idle', cardCount: 3, error: null, dbVersion: '123.45' })
  expect(count('cards')).toBe(3)
  expect(count('card_printings')).toBe(3)
  expect(count('card_images')).toBe(4)
  expect(getMeta(db, 'last_sync_at')).toBe(NOW.toISOString())
  expect(getSyncStatus(db).lastSyncAt).toBe(NOW.toISOString())
})

test('resync keeps printing ids stable', async () => {
  await runSync(db, okClient(), () => {}, NOW)
  const before = printingIds()
  await runSync(db, okClient(), () => {}, new Date(NOW.getTime() + 25 * HOUR))
  expect(printingIds()).toEqual(before)
})

test('vanished printing referenced by an entry is flagged, unreferenced one deleted', async () => {
  await runSync(db, okClient(), () => {}, NOW)
  const ids = printingIds()
  const img = db.prepare('SELECT image_id, card_id FROM card_images LIMIT 1').get() as { image_id: number }
  db.prepare(
    `INSERT INTO collection_entries (printing_id, image_id, quantity, created_at, updated_at) VALUES (?, ?, 1, 'x', 'x')`
  ).run(ids['LOB-EN119'], img.image_id)
  const trimmed = cards.map((c) => ({
    ...c,
    card_sets: c.card_sets?.filter((s) => s.set_code !== 'SDY-006' && s.set_code !== 'LOB-EN119')
  }))
  const status = await runSync(db, okClient(trimmed), () => {}, NOW)
  expect(status.state).toBe('idle')
  const rows = db.prepare('SELECT set_code, missing_from_api FROM card_printings ORDER BY set_code').all()
  expect(rows).toEqual([
    { set_code: 'LOB-EN005', missing_from_api: 0 },
    { set_code: 'LOB-EN119', missing_from_api: 1 }
  ])
  expect(printingIds()['LOB-EN119']).toBe(ids['LOB-EN119'])
})

test('failure leaves data intact', async () => {
  await runSync(db, okClient(), () => {}, NOW)
  const bad: YgoClient = {
    fetchCardSets: async () => [],
    fetchDbVersion: async () => ({ databaseVersion: '9', lastUpdate: '' }),
    fetchCardInfo: async () => {
      throw new Error('HTTP 500')
    }
  }
  const later = new Date(NOW.getTime() + 25 * HOUR)
  const status = await runSync(db, bad, () => {}, later)
  expect(status.state).toBe('error')
  expect(status.error).toBe('HTTP 500')
  expect(count('cards')).toBe(3)
  expect(getMeta(db, 'last_sync_at')).toBe(NOW.toISOString())
  expect((await runSync(db, okClient(), () => {}, later)).state).toBe('idle')
  expect(getMeta(db, 'last_sync_at')).toBe(later.toISOString())
})

test('malformed payload elements are skipped and an empty payload is an error', async () => {
  const junk = [null, { name: 'no id' }, { id: 1 }, cards[0]] as unknown as ApiCard[]
  expect((await runSync(db, okClient(junk), () => {}, NOW)).cardCount).toBe(1)
  const status = await runSync(db, okClient([]), () => {}, NOW)
  expect(status.state).toBe('error')
  expect(count('cards')).toBe(1)
})

test('concurrent calls share one run', async () => {
  let calls = 0
  const client: YgoClient = {
    fetchCardSets: async () => [],
    fetchDbVersion: async () => ({ databaseVersion: '1', lastUpdate: '' }),
    fetchCardInfo: async () => (calls++, cards)
  }
  const [a, b] = await Promise.all([
    runSync(db, client, () => {}, NOW),
    runSync(db, client, () => {}, NOW)
  ])
  expect(calls).toBe(1)
  expect(a).toBe(b)
})

test('progress order', async () => {
  const states: string[] = []
  await runSync(db, okClient(), (s) => states.push(s.state), NOW)
  expect(states).toEqual(['checking', 'downloading', 'saving', 'idle'])
})

test('FTS finds synced names', async () => {
  await runSync(db, okClient(), () => {}, NOW)
  const rows = db.prepare(`SELECT rowid FROM cards_fts WHERE cards_fts MATCH 'magician'`).all()
  expect(rows).toEqual([{ rowid: 46986414 }])
})

test('getSyncStatus is live mid-sync and keeps the last error until the next success', async () => {
  let midSync: string | null = null
  const slow: YgoClient = {
    fetchCardSets: async () => [],
    fetchDbVersion: async () => ({ databaseVersion: '1', lastUpdate: '' }),
    fetchCardInfo: async () => {
      midSync = getSyncStatus(db).state
      return cards
    }
  }
  await runSync(db, slow, () => {}, NOW)
  expect(midSync).toBe('downloading')
  expect(getSyncStatus(db)).toMatchObject({ state: 'idle', error: null })

  const failing: YgoClient = {
    fetchCardSets: async () => [],
    fetchDbVersion: async () => {
      throw new Error('offline')
    },
    fetchCardInfo: async () => cards
  }
  await runSync(db, failing, () => {}, NOW)
  expect(getSyncStatus(db)).toMatchObject({ state: 'error', error: 'offline', cardCount: 3 })

  await runSync(db, okClient(), () => {}, NOW)
  expect(getSyncStatus(db)).toMatchObject({ state: 'idle', error: null })
})

test('malformed API records are skipped without failing the sync', async () => {
  const bad = [
    { id: 1, name: 'No Strings' },
    { id: Number.NaN, name: 'NaN id', card_images: [] },
    { id: 2 },
    ...cards
  ] as unknown as ApiCard[]
  const status = await runSync(db, okClient(bad), () => {}, NOW)
  expect(status).toMatchObject({ state: 'idle', cardCount: 4 })
  expect(db.prepare('SELECT type, frame_type, race, "desc" FROM cards WHERE id = 1').get()).toEqual({
    type: '',
    frame_type: '',
    race: '',
    desc: ''
  })
})

test('keeps non-English printings across a YGOPRODeck sync', async () => {
  const sdb = await seededDb()
  try {
    const ja = sdb
      .prepare(
        `INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity)
         VALUES (46986414, 'ja', 'Legend of Blue Eyes White Dragon', 'LB-05', 'Ultra Rare') RETURNING id`
      )
      .get() as { id: number }
    const bare = sdb
      .prepare(
        `INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity)
         VALUES (46986414, 'ja', 'Vol.1', '', 'Ultra Rare') RETURNING id`
      )
      .get() as { id: number }
    sdb
      .prepare(
        `INSERT INTO collection_entries (printing_id, image_id, quantity, created_at, updated_at)
         VALUES (?, 46986414, 1, 'x', 'x')`
      )
      .run(ja.id)
    sdb
      .prepare(`INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 12.5, 4, 'x')`)
      .run(ja.id)
    const status = await runSync(sdb, okClient(), () => {}, new Date(NOW.getTime() + 25 * HOUR))
    expect(status.state).toBe('idle')
    expect(sdb.prepare('SELECT missing_from_api FROM card_printings WHERE id = ?').get(ja.id)).toEqual({
      missing_from_api: 0
    })
    expect(sdb.prepare('SELECT count(*) AS n FROM collection_entries WHERE printing_id = ?').get(ja.id)).toEqual({
      n: 1
    })
    expect(sdb.prepare('SELECT price FROM intl_prices WHERE printing_id = ?').get(ja.id)).toEqual({ price: 12.5 })
    expect(sdb.prepare('SELECT missing_from_api FROM card_printings WHERE id = ?').get(bare.id)).toEqual({
      missing_from_api: 0
    })
  } finally {
    sdb.close()
  }
})
