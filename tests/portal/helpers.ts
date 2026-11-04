import Database from 'better-sqlite3'
import { runSync } from '../../src/main/sync/sync'
import type { YgoClient } from '../../src/main/ygo/client'
import type { ApiCard } from '../../src/main/ygo/mapCard'
import { migrateServer } from '../../workers/portal/src/migrate'
import type { ImageBucket } from '../../workers/portal/src/images'
import type { TrainingBucket } from '../../workers/portal/src/training'
import type { PrintingArtResolver } from '../../src/main/yugipedia/artResolver'
import type { PriceQueue } from '../../workers/portal/src/prices'
import type { EmailMessage, EmailSender } from '../../workers/portal/src/emailSend'
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
  const id = Number(r.lastInsertRowid)
  // Its sign-in, as server-30 backfills one from discord_id.
  const apple = discordId.startsWith('apple:')
  db.prepare(
    'INSERT INTO sign_ins (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)'
  ).run(apple ? 'apple' : 'discord', apple ? discordId.slice('apple:'.length) : discordId, id, now)
  return id
}

/** In-memory stand-in for the R2 bucket; `store` is exposed so tests can look inside. */
export function memoryBucket(): ImageBucket &
  TrainingBucket & { store: Map<string, { bytes: ArrayBuffer; contentType: string; etag: string }> } {
  const store = new Map<string, { bytes: ArrayBuffer; contentType: string; etag: string }>()
  let writes = 0
  return {
    store,
    async get(key) {
      const hit = store.get(key)
      if (!hit) return null
      return { body: new Response(hit.bytes).body!, httpMetadata: { contentType: hit.contentType }, httpEtag: hit.etag }
    },
    async put(key, value, opts) {
      store.set(key, { bytes: value, contentType: opts.httpMetadata.contentType, etag: `"v${++writes}"` })
    },
    async delete(keys) {
      for (const key of typeof keys === 'string' ? [keys] : keys) store.delete(key)
    }
  }
}

/** Printing-art stand-in that finds no photo for anything. */
export const noPrintingArt: PrintingArtResolver = { url: async () => null }

/** Price queue stand-in that queues nothing. */
export const noPrices: PriceQueue = { soon: async () => {} }

/** Records the emails the Worker would send; `failNext()` makes the next send reject. */
export function fakeSender(): EmailSender & {
  sent: EmailMessage[]
  failNext(): void
  lastCode(): string
} {
  let fail = false
  const sent: EmailMessage[] = []
  return {
    sent,
    failNext() {
      fail = true
    },
    lastCode() {
      const m = sent[sent.length - 1]
      const code = m?.subject.match(/(\d{6})$/)?.[1]
      if (!code) throw new Error('no code email sent')
      return code
    },
    async send(m) {
      if (fail) {
        fail = false
        throw new Error('send failed')
      }
      sent.push(m)
    }
  }
}
