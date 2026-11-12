import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { GAME_SET_INDEX } from '../../workers/portal/src/catalogLoad'
import { userScope } from '../../workers/portal/src/scope'
import { addEntry } from '../../src/main/repo/collection'
import { browseFacets, browseFacetsFast, facetsRollupKey } from '../../src/main/repo/browse'
import {
  catalogSets,
  listSetNames,
  listSets,
  listSetsFast,
  setNamesRollupKey,
  setsRollupKey
} from '../../src/main/repo/sets'
import { ROLLUP_CHUNK_CHARS, readRollup, splitJson, storeRollup } from '../../src/main/repo/rollup'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'
import { ROLLUP_QUIET_MS, settleRollups } from '../../workers/portal/src/rollups'

const BASE = 'https://portal.test'
const TOKEN = 'admin-secret'
const NOW = new Date('2026-10-24T12:00:00.000Z')

const keys = (db: Database.Database): string[] =>
  (db.prepare('SELECT key FROM catalog_rollups ORDER BY key').all() as { key: string }[]).map(
    (r) => r.key
  )

/** A Yu-Gi-Oh! printing of the first card in a new set. */
function addPrinting(db: Database.Database, setName: string, contributed = 0): void {
  const { card_id } = db.prepare('SELECT card_id FROM card_printings LIMIT 1').get() as {
    card_id: number
  }
  db.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language, game, contributed)
     VALUES (?, ?, 'NEW-EN001', 'Common', 'en', 'ygo', ?)`
  ).run(card_id, setName, contributed)
}

describe('server catalog rollups (server-44)', () => {
  let db: Database.Database
  let deps: AppDeps
  let alice: number

  beforeEach(async () => {
    db = await seededServerDb()
    // Seeding the catalog was a change; start each test settled.
    db.exec('DELETE FROM catalog_rollup_changes')
    alice = addUser(db, '1', 'alice')
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        ADMIN_TOKEN: TOKEN,
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => NOW,
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
  })

  const admin = (path: string, body: unknown): Promise<Response> =>
    handle(
      new Request(BASE + path, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }),
      deps
    )

  /** A signed-in RPC call as alice, answering its result. */
  const rpcAs = async (channel: string): Promise<unknown> => {
    const token = 'tok'
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
    ]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    db.prepare(
      'INSERT OR IGNORE INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(hash, alice, NOW.toISOString(), new Date(NOW.getTime() + 3600_000).toISOString())
    const res = await handle(
      new Request(`${BASE}/api/rpc/${channel}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `session=${token}` },
        body: JSON.stringify({ args: [] })
      }),
      deps
    )
    expect(res.status).toBe(200)
    return ((await res.json()) as { result: unknown }).result
  }

  it('listSetsFast matches listSets, with the caller own counts on top', () => {
    const scope = userScope(alice, 'ygo')
    const p = db
      .prepare("SELECT id FROM card_printings WHERE game = 'ygo' ORDER BY id LIMIT 1")
      .get() as { id: number }
    const { image_id } = db
      .prepare(
        'SELECT image_id FROM card_images WHERE card_id = (SELECT card_id FROM card_printings WHERE id = ?)'
      )
      .get(p.id) as { image_id: number }
    addEntry(db, { printingId: p.id, imageId: image_id, quantity: 2 }, NOW, scope)
    expect(listSetsFast(db, scope)).toEqual(listSets(db, scope))
    expect(listSetsFast(db, scope).some((s) => s.ownedCards > 0)).toBe(true)
    // A second read comes from the stored rollup and still counts what's owned.
    expect(keys(db)).toContain(setsRollupKey('ygo'))
    expect(listSetsFast(db, scope)).toEqual(listSets(db, scope))
  })

  const changed = (): string[] =>
    (
      db.prepare('SELECT game FROM catalog_rollup_changes ORDER BY game').all() as {
        game: string
      }[]
    ).map((r) => r.game)

  it('a catalog change keeps the rollups but notes its game; settling drops that game only', () => {
    const scope = userScope(alice, 'ygo')
    listSetsFast(db, scope)
    browseFacetsFast(db, scope)
    storeRollup(db, setsRollupKey('mtg'), 'mtg', [])
    addPrinting(db, 'Brand New Set')
    expect(changed()).toEqual(['ygo'])
    // Still the old list: served until settled.
    expect(listSetsFast(db, scope).map((s) => s.setName)).not.toContain('Brand New Set')
    // Changed only now: not quiet long enough yet.
    settleRollups(db, 'ygo', new Date())
    expect(keys(db)).toContain(setsRollupKey('ygo'))
    settleRollups(db, 'ygo', new Date(Date.now() + ROLLUP_QUIET_MS + 1000))
    expect(keys(db)).toEqual([setsRollupKey('mtg')])
    expect(changed()).toEqual([])
    expect(listSetsFast(db, scope).map((s) => s.setName)).toContain('Brand New Set')
    expect(browseFacetsFast(db, scope).setNames).toContain('Brand New Set')
    expect(browseFacetsFast(db, scope)).toEqual(browseFacets(db, scope))
  })

  it('a contributed printing or a price change notes nothing', () => {
    addPrinting(db, 'Someone Added This', 1)
    db.prepare(
      "UPDATE card_printings SET market_price = 12.5, set_price = 3 WHERE game = 'ygo'"
    ).run()
    expect(changed()).toEqual([])
    // Un-contributing it (a source upsert) is a catalog change.
    db.prepare(
      "UPDATE card_printings SET contributed = 0 WHERE set_name = 'Someone Added This'"
    ).run()
    expect(changed()).toEqual(['ygo'])
  })

  it('a change to a set row or a Pokémon set art row notes that game', () => {
    db.prepare(
      "INSERT INTO sets (game, language, set_name, set_code) VALUES ('ygo', 'en', 'S', 'S')"
    ).run()
    expect(changed()).toEqual(['ygo'])
    db.prepare(
      "INSERT INTO pokemon_set_art (language, set_name, kind, sort_order, image_url, image_key) VALUES ('en', 'Base', 'logo', 0, 'u', 'k')"
    ).run()
    expect(changed()).toEqual(['pkm', 'ygo'])
  })

  it('a catalog upload keeps serving the old rollups between batches, and finish drops them once', async () => {
    const scope = userScope(alice, 'ygo')
    listSetNames(db, scope)
    expect(keys(db)).toEqual([setNamesRollupKey('ygo'), setsRollupKey('ygo')].sort())
    const { card_id } = db.prepare('SELECT card_id FROM card_printings LIMIT 1').get() as {
      card_id: number
    }
    const batch = (from: number): Record<string, unknown>[] =>
      Array.from({ length: 25 }, (_, i) => ({
        card_id,
        set_name: 'Uploaded Set',
        set_code: `UPL-EN${String(from + i).padStart(3, '0')}`,
        set_rarity: 'Common',
        language: 'en'
      }))
    const names = (): Promise<{ setName: string }[]> =>
      rpcAs('sets:names') as Promise<{ setName: string }[]>
    expect(
      (await admin('/admin/catalog/rows', { table: 'card_printings', rows: batch(0) })).status
    ).toBe(200)
    // A request between batches: the stored rollup as it was, nothing rebuilt.
    expect((await names()).map((n) => n.setName)).not.toContain('Uploaded Set')
    expect(
      (await admin('/admin/catalog/rows', { table: 'card_printings', rows: batch(25) })).status
    ).toBe(200)
    expect(keys(db)).toEqual([setNamesRollupKey('ygo'), setsRollupKey('ygo')].sort())
    expect((await admin('/admin/catalog/finish', { meta: {} })).status).toBe(200)
    expect(keys(db)).toEqual([])
    expect(changed()).toEqual([])
    expect(await names()).toContainEqual({
      language: 'en',
      setName: 'Uploaded Set',
      setCode: 'UPL'
    })
  })

  it('/admin/catalog/warm builds a game rollups; an unknown game is refused', async () => {
    expect((await admin('/admin/catalog/warm', { game: 'ygo' })).status).toBe(200)
    expect(keys(db)).toEqual(
      [facetsRollupKey('ygo'), setNamesRollupKey('ygo'), setsRollupKey('ygo')].sort()
    )
    expect((await admin('/admin/catalog/warm', { game: 'nope' })).status).toBe(400)
  })

  it('/admin/catalog/game-index builds the game index, and again is a no-op', async () => {
    expect((await admin('/admin/catalog/game-index', {})).status).toBe(200)
    expect((await admin('/admin/catalog/game-index', {})).status).toBe(200)
    expect(
      db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'ix_printings_game_set'").get()
    ).toBeTruthy()
  })

  it('with the game index, the Sets list reads it, never the feed index', () => {
    const scope = userScope(alice, 'ygo')
    const before = catalogSets(db, scope)
    db.exec(GAME_SET_INDEX)
    const plans: string[] = []
    const real = db.prepare.bind(db)
    const spy = {
      prepare: (sql: string) => {
        if (sql.includes('FROM card_printings p')) {
          for (const r of real(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[])
            plans.push(r.detail)
        }
        return real(sql)
      },
      exec: (sql: string) => void db.exec(sql),
      transaction: <A extends unknown[], R>(fn: (...a: A) => R) => db.transaction(fn)
    }
    expect(catalogSets(spy, scope)).toEqual(before)
    expect(plans.some((d) => /ix_printings_game_set/.test(d))).toBe(true)
    expect(plans.filter((d) => /^SEARCH .*\bix_\w+_game_seq\b/.test(d))).toEqual([])
  })

  it('sets:names and sets:list answer over RPC', async () => {
    const scope = userScope(alice, 'ygo')
    const names = (await rpcAs('sets:names')) as { setName: string }[]
    expect(names).toEqual(
      listSets(db, scope).map((s) => ({
        language: s.language,
        setName: s.setName,
        setCode: s.setCode
      }))
    )
    expect(names.length).toBeGreaterThan(0)
    expect(Object.keys(names[0]).sort()).toEqual(['language', 'setCode', 'setName'])
    expect(await rpcAs('sets:list')).toEqual(listSets(db, scope))
  })
})

describe('rollup pieces', () => {
  let db: Database.Database
  beforeEach(async () => {
    db = await seededServerDb()
  })

  it('a value over the row cap is stored in pieces under it and read back whole', () => {
    const big = Array.from({ length: 30_000 }, (_, i) => ({
      setName: `Set ${i} 日本語 🎴`,
      n: i
    }))
    storeRollup(db, 'big', 'ygo', big)
    const rows = db
      .prepare('SELECT key, length(value) AS n FROM catalog_rollups ORDER BY key')
      .all() as { key: string; n: number }[]
    expect(rows.length).toBeGreaterThan(2)
    expect(rows.every((r) => r.n <= ROLLUP_CHUNK_CHARS)).toBe(true)
    expect(readRollup(db, 'big')).toEqual(big)
    // Stored again small: the old pieces go.
    storeRollup(db, 'big', 'ygo', [1])
    expect(keys(db)).toEqual(['big'])
    expect(readRollup(db, 'big')).toEqual([1])
  })

  it('a missing piece reads as no rollup, and settling drops every piece', () => {
    const big = 'x'.repeat(ROLLUP_CHUNK_CHARS * 2)
    storeRollup(db, 'big', 'ygo', big)
    db.prepare("DELETE FROM catalog_rollups WHERE key = 'big#0001'").run()
    expect(readRollup(db, 'big')).toBeUndefined()
    storeRollup(db, 'big', 'ygo', big)
    db.prepare(
      "INSERT INTO sets (game, language, set_name, set_code) VALUES ('ygo', 'en', 'T', 'T')"
    ).run()
    settleRollups(db, 'ygo', new Date(), true)
    expect(keys(db)).toEqual([])
  })

  it('splitJson never cuts a surrogate pair', () => {
    const text = 'ab🎴cd🎴'
    for (let size = 2; size < text.length; size++) {
      const pieces = splitJson(text, size)
      expect(pieces.join('')).toBe(text)
      for (const p of pieces) expect(/[\uD800-\uDBFF]$/.test(p)).toBe(false)
    }
  })
})
