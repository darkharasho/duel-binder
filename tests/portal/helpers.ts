import Database from 'better-sqlite3'
import { runSync } from '../../src/main/sync/sync'
import type { YgoClient } from '../../src/main/ygo/client'
import type { ApiCard } from '../../src/main/ygo/mapCard'
import { migrateServer } from '../../workers/portal/src/migrate'
import type { ImageBucket } from '../../workers/portal/src/images'
import type { PrintingArtResolver } from '../../src/main/yugipedia/artResolver'
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

/** In-memory stand-in for the R2 bucket; `store` is exposed so tests can look inside. */
export function memoryBucket(): ImageBucket & { store: Map<string, { bytes: ArrayBuffer; contentType: string }> } {
  const store = new Map<string, { bytes: ArrayBuffer; contentType: string }>()
  return {
    store,
    async get(key) {
      const hit = store.get(key)
      if (!hit) return null
      return { body: new Response(hit.bytes).body!, httpMetadata: { contentType: hit.contentType } }
    },
    async put(key, value, opts) {
      store.set(key, { bytes: value, contentType: opts.httpMetadata.contentType })
    }
  }
}

/** Printing-art stand-in that finds no photo for anything. */
export const noPrintingArt: PrintingArtResolver = { url: async () => null }
