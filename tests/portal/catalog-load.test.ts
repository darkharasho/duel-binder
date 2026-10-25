import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { searchCards } from '../../src/main/repo/cards'
import { openDatabase } from '../../src/main/db/database'
import { CATALOG_TABLES } from '../../src/shared/catalogTables'
import { addUser, memoryBucket, noPrintingArt, noPrices } from './helpers'
import { seededDb } from '../main/helpers'

const BASE = 'https://portal.test'
const TOKEN = 'admin-secret'
type Row = Record<string, unknown>

describe('admin catalog loader', () => {
  let db: Database.Database
  let deps: AppDeps
  let source: Database.Database

  beforeEach(async () => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    const { migrateServer } = await import('../../workers/portal/src/migrate')
    migrateServer(db)
    source = await seededDb()
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: noPrices,
      env: { PUBLIC_URL: BASE, SITE_URL: 'https://site.test', DISCORD_CLIENT_ID: 'c', DISCORD_CLIENT_SECRET: 's', ADMIN_TOKEN: TOKEN, PRICE_WORKER_URL: 'https://prices.test' },
      now: () => new Date('2026-10-24T12:00:00.000Z'),
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
  })

  const call = (path: string, body?: unknown, token: string | null = TOKEN) =>
    handle(
      new Request(BASE + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
          'content-type': 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      }),
      deps
    )

  const sourceRows = (table: string): Row[] => {
    const columns = CATALOG_TABLES.find((t) => t.name === table)!.columns
    return source.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM ${table}`).all() as Row[]
  }
  async function loadCatalog(): Promise<void> {
    for (const t of ['cards', 'card_images', 'card_printings']) {
      const res = await call('/admin/catalog/rows', { table: t, rows: sourceRows(t) })
      expect(res.status).toBe(200)
    }
  }
  const printingId = (pkey: string): number | undefined =>
    (db.prepare('SELECT id FROM card_printings WHERE pkey = ?').get(pkey) as { id: number } | undefined)?.id

  it('rejects without the admin token', async () => {
    expect((await call('/admin/catalog/status', undefined, null)).status).toBe(401)
    expect((await call('/admin/catalog/status', undefined, 'wrong')).status).toBe(401)
    expect((await call('/admin/catalog/status', undefined, '')).status).toBe(401)
    deps.env.ADMIN_TOKEN = ''
    expect((await call('/admin/catalog/status', undefined, '')).status).toBe(401)
  })

  it('loads cards and printings, and search finds them after finish', async () => {
    await loadCatalog()
    const fin = await call('/admin/catalog/finish', { meta: { db_version: '7', last_sync_at: 'now' } })
    expect(fin.status).toBe(200)
    const name = (sourceRows('cards')[0] as { name: string }).name
    expect(searchCards(db, name).length).toBeGreaterThan(0)
    const status = (await (await call('/admin/catalog/status')).json()) as { counts: Record<string, number> }
    expect(status.counts.cards).toBe(sourceRows('cards').length)
    expect(status.counts.card_printings).toBe(sourceRows('card_printings').length)
    expect(db.prepare("SELECT value FROM meta WHERE key = 'db_version'").get()).toEqual({ value: '7' })
  })

  it('re-uploading a printing keeps its id', async () => {
    await loadCatalog()
    const row = sourceRows('card_printings')[0]
    const pkey = (source.prepare('SELECT pkey FROM card_printings LIMIT 1').get() as { pkey: string }).pkey
    const before = printingId(pkey)!
    const res = await call('/admin/catalog/rows', {
      table: 'card_printings',
      rows: [{ ...row, set_price: 99.5 }]
    })
    expect(res.status).toBe(200)
    expect(printingId(pkey)).toBe(before)
    expect(
      (db.prepare('SELECT set_price FROM card_printings WHERE id = ?').get(before) as { set_price: number }).set_price
    ).toBe(99.5)
  })

  it('deleting an owned printing flags it missing instead', async () => {
    await loadCatalog()
    const pkeys = (source.prepare('SELECT pkey FROM card_printings LIMIT 2').all() as { pkey: string }[]).map(
      (r) => r.pkey
    )
    const [p, q] = pkeys.map((k) => printingId(k)!)
    const user = addUser(db, '1', 'kaiba')
    const img = (db.prepare('SELECT image_id FROM card_images LIMIT 1').get() as { image_id: number }).image_id
    db.prepare(
      `INSERT INTO collection_entries (user_id, uid, printing_id, image_id, quantity, created_at, updated_at)
       VALUES (?, 'u1', ?, ?, 1, 'n', 'n')`
    ).run(user, p, img)
    const res = await call('/admin/catalog/delete', { table: 'card_printings', keys: pkeys.map((k) => [k]) })
    expect(res.status).toBe(200)
    expect(db.prepare('SELECT missing_from_api FROM card_printings WHERE id = ?').get(p)).toEqual({
      missing_from_api: 1
    })
    expect(db.prepare('SELECT 1 FROM card_printings WHERE id = ?').get(q)).toBeUndefined()
    expect(db.prepare('SELECT 1 FROM collection_entries WHERE printing_id = ?').get(p)).toBeDefined()
  })

  it('deletes rows from keyed tables and ignores cards', async () => {
    await call('/admin/catalog/rows', {
      table: 'pack_art',
      rows: [{ set_name: 'A', image_url: 'u', image_key: 'k' }]
    })
    await loadCatalog()
    expect((await call('/admin/catalog/delete', { table: 'pack_art', keys: [['A']] })).status).toBe(200)
    expect(db.prepare('SELECT COUNT(*) AS n FROM pack_art').get()).toEqual({ n: 0 })
    const id = sourceRows('cards')[0].id
    expect((await call('/admin/catalog/delete', { table: 'cards', keys: [[id]] })).status).toBe(200)
    expect(db.prepare('SELECT 1 FROM cards WHERE id = ?').get(id)).toBeDefined()
  })

  it('an image_key that moves to a new set_name in one batch replaces the old row', async () => {
    for (const table of ['pack_art', 'set_logos', 'konami_logos']) {
      const first = await call('/admin/catalog/rows', {
        table,
        rows: [{ set_name: 'Old', image_url: 'u', image_key: 'K' }, { set_name: 'Other', image_url: 'u', image_key: 'L' }]
      })
      expect(first.status).toBe(200)
      const res = await call('/admin/catalog/rows', {
        table,
        rows: [{ set_name: 'New', image_url: 'u2', image_key: 'K' }]
      })
      expect(res.status, table).toBe(200)
      expect(db.prepare(`SELECT set_name, image_url, image_key FROM ${table} ORDER BY set_name`).all()).toEqual([
        { set_name: 'New', image_url: 'u2', image_key: 'K' },
        { set_name: 'Other', image_url: 'u', image_key: 'L' }
      ])
    }
  })

  it('stores a non-English printing under the V10 pkey and updates it in place', async () => {
    await loadCatalog()
    const card = sourceRows('cards')[0] as { id: number }
    const row = {
      card_id: card.id,
      set_name: 'Starter Deck: Yugi (DE)',
      set_code: 'SDY-DE001',
      set_rarity: 'Ultra Rare',
      set_rarity_code: '(UR)',
      set_price: null,
      missing_from_api: 0,
      language: 'de',
      tcg_product_id: null,
      variant: null
    }
    const pkey = `de|${card.id}|${row.set_name}|${row.set_code}|${row.set_rarity}`
    expect((await call('/admin/catalog/rows', { table: 'card_printings', rows: [row] })).status).toBe(200)
    const stored = db
      .prepare("SELECT id, pkey FROM card_printings WHERE language = 'de'")
      .all() as { id: number; pkey: string }[]
    expect(stored).toHaveLength(1)
    expect(stored[0].pkey).toBe(pkey)
    const res = await call('/admin/catalog/rows', { table: 'card_printings', rows: [{ ...row, set_price: 3.25 }] })
    expect(res.status).toBe(200)
    expect(db.prepare("SELECT id, pkey, set_price FROM card_printings WHERE language = 'de'").all()).toEqual([
      { id: stored[0].id, pkey, set_price: 3.25 }
    ])
  })

  it('rejects unknown tables and columns', async () => {
    const bad = async (path: string, body: unknown) => (await call(path, body)).status
    expect(await bad('/admin/catalog/rows', { table: 'users', rows: [{ id: 1 }] })).toBe(400)
    expect(await bad('/admin/catalog/rows', { table: 'cards', rows: [{ id: 1, nope: 1 }] })).toBe(400)
    expect(await bad('/admin/catalog/rows', { table: 'cards', rows: [{ name: 'x' }] })).toBe(400)
    expect(await bad('/admin/catalog/rows', { table: 'cards', rows: 'x' })).toBe(400)
    expect(await bad('/admin/catalog/delete', { table: 'cards; DROP', keys: [[1]] })).toBe(400)
    expect(await bad('/admin/catalog/delete', { table: 'sets', keys: 'x' })).toBe(400)
    expect(await bad('/admin/catalog/delete', { table: 'sets', keys: [['en']] })).toBe(400)
    expect(await bad('/admin/catalog/finish', { meta: { evil: 'x' } })).toBe(400)
    const many = Array.from({ length: 5001 }, (_, i) => ({ id: i }))
    expect(await bad('/admin/catalog/rows', { table: 'cards', rows: many })).toBe(400)
  })
})

describe('CATALOG_TABLES', () => {
  it('matches the desktop schema columns', () => {
    const desktop = openDatabase(':memory:')
    for (const t of CATALOG_TABLES) {
      const cols = (desktop.prepare(`PRAGMA table_info(${t.name})`).all() as { name: string }[])
        .map((c) => c.name)
        .filter((c) => !(t.name === 'card_printings' && c === 'id'))
      expect([...t.columns].sort()).toEqual([...cols].sort())
    }
  })
})
