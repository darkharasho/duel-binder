import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { runSync } from '../../src/main/sync/sync'
import type { YgoClient } from '../../src/main/ygo/client'
import type { ApiCard } from '../../src/main/ygo/mapCard'
import fixture from '../fixtures/cardinfo.sample.json'

/** In-memory database loaded with the sample fixture through the real sync path. */
export async function seededDb(): Promise<Database.Database> {
  const db = openDatabase(':memory:')
  const client: YgoClient = {
    fetchDbVersion: async () => ({ databaseVersion: '1', lastUpdate: '2026-10-22' }),
    fetchCardInfo: async () => fixture.data as ApiCard[],
    fetchCardSets: async () => []
  }
  await runSync(db, client, () => {}, new Date('2026-10-23T12:00:00.000Z'))
  return db
}
