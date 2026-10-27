import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { CATALOG_TABLES } from '../../src/shared/catalogTables'
import type { CatalogChange, CatalogChangesResponse } from '../../src/shared/catalogFeed'
import { addUser, seededServerDb, memoryBucket, noPrintingArt } from './helpers'

const BASE = 'https://portal.test'
const NOW = new Date('2026-10-24T12:00:00.000Z')
const TOKEN = 'Bearer alice-desktop-token'
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

describe('GET /api/catalog/changes', () => {
  let db: Database.Database
  let deps: AppDeps

  const session = (userId: number, token: string, kind: 'web' | 'desktop'): void => {
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      sha256Hex(token),
      userId,
      kind,
      NOW.toISOString(),
      new Date(NOW.getTime() + 86_400_000).toISOString()
    )
  }
  const get = (qs: string, auth: string | null = TOKEN): Promise<Response> =>
    handle(
      new Request(`${BASE}/api/catalog/changes${qs}`, {
        headers: auth ? { authorization: auth } : {}
      }),
      deps
    )
  const feed = async (since: number, limit?: number): Promise<CatalogChangesResponse> => {
    const res = await get(`?since=${since}${limit ? `&limit=${limit}` : ''}`)
    expect(res.status).toBe(200)
    return (await res.json()) as CatalogChangesResponse
  }
  const drain = async (since: number, limit: number): Promise<CatalogChange[]> => {
    const all: CatalogChange[] = []
    for (;;) {
      const page = await feed(since, limit)
      all.push(...page.changes)
      since = page.cursor
      if (!page.more) return all
    }
  }

  beforeEach(async () => {
    db = await seededServerDb()
    const alice = addUser(db, '1', 'alice')
    session(alice, 'alice-desktop-token', 'desktop')
    session(alice, 'alice-web-token', 'web')
    deps = {
      db,
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: { soon: async () => {} },
      env: {},
      now: () => NOW,
      fetch: (async () => new Response('', { status: 404 })) as typeof fetch
    } as unknown as AppDeps
  })

  it('since=0 returns every live row once, in seq order, across pages', async () => {
    const all = await drain(0, 500)
    const seqs = all.map((c) => c.seq)
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y))
    expect(new Set(seqs).size).toBe(seqs.length)
    for (const t of CATALOG_TABLES) {
      const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${t.name}`).get() as { n: number }).n
      expect(all.filter((c) => c.table === t.name).length, t.name).toBe(n)
    }
    expect(all.length).toBeGreaterThan(0)
  })

  it('since=0 carries no tombstones', async () => {
    db.prepare('DELETE FROM sets WHERE rowid = (SELECT MIN(rowid) FROM sets)').run()
    const all = await drain(0, 500)
    expect(all.some((c) => 'deleted' in c)).toBe(false)
  })

  it('returns only what changed after the cursor, tombstones included', async () => {
    const { cursor, dbVersion } = await feed(0, 5000)
    expect(dbVersion).toBe('1')
    const card = db.prepare('SELECT id FROM cards ORDER BY id LIMIT 1').get() as { id: number }
    db.prepare("UPDATE cards SET name = 'Renamed' WHERE id = ?").run(card.id)
    db.prepare(
      "INSERT INTO sets (language, set_name, set_code) VALUES ('en', 'Doomed Set', 'DS')"
    ).run()
    db.prepare("DELETE FROM sets WHERE set_name = 'Doomed Set'").run()
    const after = await feed(cursor)
    expect(after.more).toBe(false)
    expect(after.changes).toHaveLength(2)
    expect(after.changes[0]).toMatchObject({
      table: 'cards',
      row: { id: card.id, name: 'Renamed' }
    })
    expect(after.changes[0]).not.toHaveProperty('row.catalog_seq')
    expect(after.changes[1]).toMatchObject({ table: 'sets', deleted: ['en', 'Doomed Set'] })
    expect(after.cursor).toBe(after.changes[1].seq)
  })

  it('a row changed between pages comes back on a later page', async () => {
    const first = await feed(0, 3)
    expect(first.more).toBe(true)
    const target = first.changes.find((c) => c.table === 'cards' && 'row' in c)
    expect(target).toBeDefined()
    const id = (target as unknown as { row: { id: number } }).row.id
    db.prepare("UPDATE cards SET name = 'Changed Mid-Sync' WHERE id = ?").run(id)
    const rest = await drain(first.cursor, 3)
    const again = rest.find(
      (c) => c.table === 'cards' && 'row' in c && c.row.id === id
    ) as unknown as { seq: number; row: { name: string } }
    expect(again.row.name).toBe('Changed Mid-Sync')
    expect(again.seq).toBeGreaterThan(target!.seq)
  })

  it('pages stay exact when seqs sit in contiguous per-table blocks', async () => {
    const total = (await drain(0, 5000)).length
    const limit = 3
    expect(total).toBeGreaterThan(limit * 3)
    const seen: number[] = []
    let since = 0
    for (;;) {
      const page = await feed(since, limit)
      if (page.more) expect(page.changes).toHaveLength(limit)
      else expect(page.changes.length).toBeLessThanOrEqual(limit)
      seen.push(...page.changes.map((c) => c.seq))
      since = page.cursor
      if (!page.more) break
    }
    expect(seen).toHaveLength(total)
    expect(new Set(seen).size).toBe(total)
    expect(seen).toEqual([...seen].sort((x, y) => x - y))
  })

  it('builds no compound SELECT (Durable Object SQLite caps its terms)', async () => {
    const real = db
    deps.db = new Proxy(real, {
      get(target, prop) {
        if (prop === 'prepare')
          return (sql: string) => {
            if (/\b(UNION|INTERSECT|EXCEPT)\b/i.test(sql))
              throw new Error('too many terms in compound SELECT')
            return target.prepare(sql)
          }
        const v = Reflect.get(target, prop) as unknown
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
      }
    })
    const { cursor } = await feed(0, 5000)
    real.prepare("UPDATE cards SET name = 'Renamed' WHERE id = (SELECT MIN(id) FROM cards)").run()
    expect((await feed(0, 3)).more).toBe(true)
    expect((await feed(cursor)).changes).toHaveLength(1)
  })

  it('pages stay exact when changes from many tables and deletions interleave', async () => {
    const { cursor } = await feed(0, 5000)
    const cards = db.prepare('SELECT id FROM cards ORDER BY id LIMIT 2').all() as { id: number }[]
    const prints = db.prepare('SELECT id FROM card_printings ORDER BY id LIMIT 2').all() as {
      id: number
    }[]
    expect(cards.length).toBe(2)
    expect(prints.length).toBe(2)
    for (let i = 0; i < 4; i++) {
      db.prepare('UPDATE cards SET name = ? WHERE id = ?').run(`Interleaved ${i}`, cards[i % 2].id)
      db.prepare('UPDATE card_printings SET set_price = ? WHERE id = ?').run(
        `9.0${i}`,
        prints[i % 2].id
      )
      db.prepare("INSERT INTO sets (language, set_name, set_code) VALUES ('en', ?, 'TMP')").run(
        `Temp ${i}`
      )
      if (i % 2) db.prepare('DELETE FROM sets WHERE set_name = ?').run(`Temp ${i}`)
    }
    const whole = await feed(cursor, 5000)
    expect(whole.more).toBe(false)
    expect(whole.changes).toHaveLength(8)
    expect(whole.changes.some((c) => 'deleted' in c)).toBe(true)
    for (const limit of [1, 2, 5]) {
      const paged = await drain(cursor, limit)
      expect(
        paged.map((c) => c.seq),
        `limit ${limit}`
      ).toEqual(whole.changes.map((c) => c.seq))
    }
  })

  it('printing rows carry pkey, server id and contributed', async () => {
    const all = await drain(0, 500)
    const p = all.find((c) => c.table === 'card_printings' && 'row' in c) as {
      row: Record<string, unknown>
    }
    const real = db
      .prepare('SELECT id, pkey, contributed FROM card_printings WHERE pkey = ?')
      .get(p.row.pkey) as { id: number; contributed: number }
    expect(p.row.id).toBe(real.id)
    expect(p.row.contributed).toBe(real.contributed)
    expect(p.row).not.toHaveProperty('catalog_seq')
  })

  it('rejects web sessions and missing tokens', async () => {
    expect((await get('?since=0', 'Bearer alice-web-token')).status).toBe(401)
    const res = await get('?since=0', null)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'signed-out' })
  })

  it('rejects a non-numeric since', async () => {
    expect((await get('?since=abc')).status).toBe(400)
    expect((await get('')).status).toBe(400)
  })

  it('404s unknown sub-paths', async () => {
    const res = await handle(
      new Request(`${BASE}/api/catalog/nope`, { headers: { authorization: TOKEN } }),
      deps
    )
    expect(res.status).toBe(404)
  })
})
