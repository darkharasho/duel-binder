import type Database from 'better-sqlite3'
import type { SyncStatus } from '@shared/types'
import { getMeta, setMeta } from '../db/meta'
import type { YgoClient } from '../ygo/client'
import { refreshSets } from './sets'
import { mapApiCard, type ApiCard } from '../ygo/mapCard'

export const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000

export function shouldSync(lastSyncAt: string | null, now: Date): boolean {
  if (!lastSyncAt) return true
  const last = Date.parse(lastSyncAt)
  if (Number.isNaN(last)) return true
  return now.getTime() - last >= SYNC_INTERVAL_MS
}

/** Live state per database: the in-flight phase, or the last error until the next success. */
const live = new WeakMap<Database.Database, { state: SyncStatus['state']; error: string | null }>()

export function getSyncStatus(db: Database.Database): SyncStatus {
  const { n } = db.prepare('SELECT count(*) AS n FROM cards').get() as { n: number }
  const l = live.get(db)
  return {
    state: l?.state ?? 'idle',
    lastSyncAt: getMeta(db, 'last_sync_at'),
    dbVersion: getMeta(db, 'db_version'),
    cardCount: n,
    error: l?.error ?? null
  }
}

const inFlight = new WeakMap<Database.Database, Promise<SyncStatus>>()

export function runSync(
  db: Database.Database,
  client: YgoClient,
  onProgress: (s: SyncStatus) => void,
  now: Date = new Date()
): Promise<SyncStatus> {
  const existing = inFlight.get(db)
  if (existing) return existing
  const promise = doSync(db, client, onProgress, now).finally(() => inFlight.delete(db))
  inFlight.set(db, promise)
  return promise
}

async function doSync(
  db: Database.Database,
  client: YgoClient,
  onProgress: (s: SyncStatus) => void,
  now: Date
): Promise<SyncStatus> {
  const emit = (state: SyncStatus['state']): SyncStatus => {
    live.set(db, { state, error: null })
    const status = getSyncStatus(db)
    onProgress(status)
    return status
  }
  try {
    emit('checking')
    const version = await client.fetchDbVersion()
    emit('downloading')
    const payload = await client.fetchCardInfo()
    emit('saving')
    saveCards(db, payload, now.toISOString(), version.databaseVersion)
    await refreshSets(db, client)
    live.delete(db)
    const done = getSyncStatus(db)
    onProgress(done)
    return done
  } catch (err) {
    live.set(db, {
      state: 'error',
      error: (err instanceof Error && err.message) || 'Card database sync failed'
    })
    const status = getSyncStatus(db)
    onProgress(status)
    return status
  }
}

function saveCards(
  db: Database.Database,
  payload: ApiCard[],
  nowIso: string,
  dbVersion: string
): void {
  const valid = payload.filter(
    (c) => c && Number.isInteger(c.id) && typeof c.name === 'string' && c.name !== ''
  )
  if (valid.length === 0) throw new Error('The card database response contained no cards')

  const upsertCard = db.prepare(`
    INSERT INTO cards (id, name, type, frame_type, race, attribute, level, linkval, atk, def, archetype,
      "desc", tcgplayer_price, updated_at)
    VALUES (@id, @name, @type, @frameType, @race, @attribute, @level, @linkval, @atk, @def, @archetype,
      @desc, @tcgplayerPrice, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type,
      frame_type = excluded.frame_type, race = excluded.race, attribute = excluded.attribute,
      level = excluded.level, linkval = excluded.linkval, atk = excluded.atk, def = excluded.def,
      archetype = excluded.archetype, "desc" = excluded."desc",
      tcgplayer_price = excluded.tcgplayer_price, updated_at = excluded.updated_at`)
  const upsertPrinting = db.prepare(`
    INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, set_rarity_code, set_price,
      missing_from_api, language)
    VALUES (@cardId, @setName, @setCode, @setRarity, @setRarityCode, @setPrice, 0, 'en')
    ON CONFLICT(card_id, set_code, set_rarity) WHERE language = 'en' DO UPDATE SET set_name = excluded.set_name,
      set_rarity_code = excluded.set_rarity_code, set_price = excluded.set_price, missing_from_api = 0
    RETURNING id`)
  const upsertImage = db.prepare(`
    INSERT INTO card_images (image_id, card_id, sort_order, missing_from_api)
    VALUES (@imageId, @cardId, @sortOrder, 0)
    ON CONFLICT(image_id) DO UPDATE SET card_id = excluded.card_id, sort_order = excluded.sort_order,
      missing_from_api = 0`)

  db.transaction(() => {
    const seenPrintings = new Set<number>()
    const seenImages = new Set<number>()
    for (const apiCard of valid) {
      const { card, printings, images } = mapApiCard(apiCard, nowIso)
      upsertCard.run({ ...card, updatedAt: nowIso })
      for (const p of printings) {
        const row = upsertPrinting.get(p) as { id: number }
        seenPrintings.add(row.id)
      }
      for (const img of images) {
        upsertImage.run(img)
        seenImages.add(img.imageId)
      }
    }
    // Only English printings come from YGOPRODeck; other languages belong to the Yugipedia sync,
    // and art variants to the TCGplayer catalog.
    prune(
      db,
      'card_printings',
      'id',
      'printing_id',
      seenPrintings,
      "language = 'en' AND tcg_product_id IS NULL"
    )
    prune(db, 'card_images', 'image_id', 'image_id', seenImages)
    db.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`)
    setMeta(db, 'last_sync_at', nowIso)
    setMeta(db, 'db_version', dbVersion)
  })()
}

/** Rows absent from the payload: delete when unreferenced by entries, else flag as missing. */
function prune(
  db: Database.Database,
  table: 'card_printings' | 'card_images',
  idCol: string,
  entryCol: string,
  seen: Set<number>,
  where = '1'
): void {
  const ids = (db.prepare(`SELECT ${idCol} AS id FROM ${table} WHERE ${where}`).all() as { id: number }[])
    .map((r) => r.id)
    .filter((id) => !seen.has(id))
  const del = db.prepare(
    `DELETE FROM ${table} WHERE ${idCol} = ? AND NOT EXISTS
       (SELECT 1 FROM collection_entries WHERE ${entryCol} = ${table}.${idCol})`
  )
  const flag = db.prepare(`UPDATE ${table} SET missing_from_api = 1 WHERE ${idCol} = ?`)
  for (const id of ids) {
    del.run(id)
    flag.run(id) // no-op for rows already deleted
  }
}
