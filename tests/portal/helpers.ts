import Database from 'better-sqlite3'
import { runSync } from '../../src/main/sync/sync'
import type { YgoClient } from '../../src/main/ygo/client'
import type { ApiCard } from '../../src/main/ygo/mapCard'
import { migrateServer } from '../../workers/portal/src/migrate'
import fixture from '../fixtures/cardinfo.sample.json'

/** In-memory server-schema database loaded with the sample fixture through the real sync path. */
export async function seededServerDb(): Promise<Database.Database> {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateServer(db)
  const client: YgoClient = {
    fetchDbVersion: async () => ({ databaseVersion: '1', lastUpdate: '2026-10-22' }),
    fetchCardInfo: async () => fixture.data as ApiCard[],
    fetchCardSets: async () => []
  }
  await runSync(db, client, () => {}, new Date('2026-10-23T12:00:00.000Z'))
  return db
}

export function addUser(db: Database.Database, discordId: string, username: string): number {
  const now = '2026-10-23T12:00:00.000Z'
  const r = db
    .prepare('INSERT INTO users (discord_id, username, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(discordId, username, now, now)
  return Number(r.lastInsertRowid)
}
