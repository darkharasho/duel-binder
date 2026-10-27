import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { applyChanges, finishApply } from '../main/catalog/apply'
import { setMeta } from '../main/db/meta'
import { mapApiCard, type ApiCard } from '../main/ygo/mapCard'
import type { CatalogChange } from '../shared/catalogFeed'
import type { Me } from '../shared/cloud'
import fixture from '../../tests/fixtures/cardinfo.sample.json'
import { exposeStore } from './data/protocol'
import { PHONE_FORMAT } from './data/phoneSchema'
import { createPhoneStore } from './data/store'
import { openWasmDb } from './data/wasmSql'
import type { WorkerLike } from './runtime'

/**
 * Dev only (`npm run dev:phone`, then /scan/?demo): the app on the sample cards, signed in
 * with a few cards in the collection and no server, so every page can be looked at and
 * screenshotted. The store runs on the page, in memory, behind a MessageChannel in place of the
 * data worker. main.tsx loads this only when import.meta.env.DEV, so it never reaches the
 * production build (tests/main/phone-build.test.ts checks for this marker).
 */
export const DEMO_MARKER = 'duel-binder-phone-demo'

const DEMO_USER: Me = { id: 1, username: 'demo', displayName: 'Demo Duelist', avatarUrl: null }

/** The fixture as catalog feed rows. */
function fixtureChanges(): CatalogChange[] {
  const now = '2026-10-27T00:00:00.000Z'
  const changes: CatalogChange[] = []
  let seq = 0
  for (const c of fixture.data as ApiCard[]) {
    const { card, printings, images } = mapApiCard(c, now)
    changes.push({
      seq: ++seq,
      table: 'cards',
      row: {
        id: card.id,
        name: card.name,
        type: card.type,
        frame_type: card.frameType,
        race: card.race,
        attribute: card.attribute,
        level: card.level,
        linkval: card.linkval,
        atk: card.atk,
        def: card.def,
        archetype: card.archetype,
        desc: card.desc,
        tcgplayer_price: card.tcgplayerPrice,
        updated_at: now
      }
    })
    for (const p of printings)
      changes.push({
        seq: ++seq,
        table: 'card_printings',
        row: {
          card_id: p.cardId,
          set_name: p.setName,
          set_code: p.setCode,
          set_rarity: p.setRarity,
          set_rarity_code: p.setRarityCode,
          set_price: p.setPrice,
          missing_from_api: 0,
          language: 'en'
        }
      })
    for (const img of images)
      changes.push({
        seq: ++seq,
        table: 'card_images',
        row: {
          image_id: img.imageId,
          card_id: img.cardId,
          sort_order: img.sortOrder,
          missing_from_api: 0
        }
      })
  }
  return changes
}

/** Every request fails as if offline: sync waits, friends say they're offline. */
const offline = (async () => {
  throw new TypeError('Demo mode has no server')
}) as typeof fetch

/** A store on the sample data, as a stand-in for the data worker. */
export async function demoWorker(): Promise<WorkerLike> {
  console.info(`${DEMO_MARKER}: sample data, signed in, offline`)
  const sqlite3 = await sqlite3InitModule()
  const db = openWasmDb(sqlite3, {})
  db.transaction(() => {
    finishApply(db, applyChanges(db, fixtureChanges()))
    setMeta(db, 'db_version', 'demo')
    setMeta(db, 'last_sync_at', new Date().toISOString())
  })()
  const store = createPhoneStore({ db, portal: location.origin, fetch: offline })
  await store.signIn('demo-token', DEMO_USER)
  // First run is done: the catalog is "downloaded" and the collection "synced" once.
  for (const [key, value] of [
    ['format', String(PHONE_FORMAT)],
    ['catalog_loaded', '1'],
    ['catalog_filled', '1']
  ])
    db.prepare('INSERT OR REPLACE INTO phone_state (key, value) VALUES (?, ?)').run(key, value)

  const printings = db
    .prepare(
      `SELECT p.id AS printingId, i.image_id AS imageId FROM card_printings p
       JOIN card_images i ON i.card_id = p.card_id AND i.sort_order = 0
       ORDER BY p.id LIMIT 4`
    )
    .all() as { printingId: number; imageId: number }[]
  for (const [n, p] of printings.entries())
    await store.invoke('collection:add', [{ ...p, quantity: n + 1 }])

  const { port1, port2 } = new MessageChannel()
  exposeStore(store, port2)
  port2.start()
  return port1 as unknown as WorkerLike
}
