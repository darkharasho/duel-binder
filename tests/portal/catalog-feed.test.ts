import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { CATALOG_TABLES } from '../../src/shared/catalogTables'
import type { CatalogChange, CatalogChangesResponse } from '../../src/shared/catalogFeed'
import { addUser, seededServerDb, memoryBucket, noPrintingArt } from './helpers'
import { migrateServer } from '../../workers/portal/src/migrate'
import { PKM_ID_MIN } from '../../src/shared/games'
import { seedPokemon, SHARED_SET_NAME } from '../fixtures/pokemon'

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
  const feed = async (
    since: number,
    limit?: number,
    tables?: string
  ): Promise<CatalogChangesResponse> => {
    const res = await get(
      `?since=${since}${limit ? `&limit=${limit}` : ''}${tables ? `&tables=${tables}` : ''}`
    )
    expect(res.status).toBe(200)
    return (await res.json()) as CatalogChangesResponse
  }
  const drain = async (since: number, limit: number, tables?: string): Promise<CatalogChange[]> => {
    const all: CatalogChange[] = []
    for (;;) {
      const page = await feed(since, limit, tables)
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

  it('tables limits rows and tombstones to the named tables', async () => {
    const { cursor } = await feed(0, 5000)
    db.prepare("UPDATE cards SET name = 'Renamed' WHERE id = (SELECT MIN(id) FROM cards)").run()
    db.prepare(
      "INSERT INTO sets (language, set_name, set_code) VALUES ('en', 'Doomed Set', 'DS')"
    ).run()
    db.prepare("DELETE FROM sets WHERE set_name = 'Doomed Set'").run()
    const cards = await feed(cursor, undefined, 'cards')
    expect(cards.changes.map((c) => c.table)).toEqual(['cards'])
    const sets = await feed(cursor, undefined, 'sets,card_images')
    expect(sets.changes).toHaveLength(1)
    expect(sets.changes[0]).toMatchObject({ table: 'sets', deleted: ['en', 'Doomed Set'] })
    db.prepare(
      "INSERT INTO sets (language, set_name, set_code) VALUES ('en', 'Kept Set', 'KS')"
    ).run()
    const snapshot = await drain(0, 500, 'cards,sets')
    expect(new Set(snapshot.map((c) => c.table))).toEqual(new Set(['cards', 'sets']))
  })

  it('paging with tables reaches every requested row exactly once', async () => {
    const whole = await drain(0, 5000, 'cards,sets')
    const paged = await drain(0, 2, 'cards,sets')
    const key = (c: CatalogChange): string => `${c.seq}:${c.table}`
    expect(paged.map(key)).toEqual(whole.map(key))
    expect(new Set(paged.map(key)).size).toBe(paged.length)
    expect(paged.length).toBeGreaterThan(2)
  })

  it('unknown, empty or repeated table names are a 400', async () => {
    for (const t of ['nope', 'cards,', ',cards', 'cards,cards', 'cards,,sets', '']) {
      const res = await get(`?since=0&tables=${t}`)
      expect(res.status, t).toBe(400)
      expect(await res.json()).toHaveProperty('error')
    }
  })

  it('latest is the catalog clock', async () => {
    const clock = (): number =>
      (db.prepare('SELECT seq FROM catalog_clock').get() as { seq: number }).seq
    expect((await feed(0, 2)).latest).toBe(clock())
    expect((await feed(0, 2, 'cards')).latest).toBe(clock())
    db.prepare("UPDATE cards SET name = 'X' WHERE id = (SELECT MIN(id) FROM cards)").run()
    expect((await feed(0)).latest).toBe(clock())
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

describe('per-game catalog feed', () => {
  let db: Database.Database
  let deps: AppDeps
  const OWNER = 'Bearer owner-desktop-token'
  const BOB = 'Bearer bob-desktop-token'

  const call = (path: string, auth: string, body?: unknown): Promise<Response> =>
    handle(
      new Request(`${BASE}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: auth, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      }),
      deps
    )
  const feed = async (qs: string, auth = OWNER): Promise<CatalogChangesResponse> => {
    const res = await call(`/api/catalog/changes${qs}`, auth)
    expect(res.status, qs).toBe(200)
    return (await res.json()) as CatalogChangesResponse
  }
  const drain = async (game: string | null, since = 0, limit = 3): Promise<CatalogChange[]> => {
    const all: CatalogChange[] = []
    for (;;) {
      const page = await feed(`?since=${since}&limit=${limit}${game ? `&game=${game}` : ''}`)
      all.push(...page.changes)
      since = page.cursor
      if (!page.more) return all
    }
  }
  const admin = async (path: string, body: unknown): Promise<void> => {
    const res = await call(path, 'Bearer admin-secret', body)
    expect(res.status, await res.clone().text()).toBe(200)
  }

  /** The seedPokemon rows, read from a scratch server and loaded here through the loader. */
  async function loadPokemon(): Promise<void> {
    const scratch = new Database(':memory:')
    migrateServer(scratch)
    seedPokemon(scratch)
    for (const name of ['cards', 'card_images', 'card_printings', 'sets', 'pokemon_cards']) {
      const t = CATALOG_TABLES.find((x) => x.name === name)!
      const rows = scratch
        .prepare(`SELECT ${t.columns.map((c) => `"${c}"`).join(', ')} FROM ${name}`)
        .all()
      await admin('/admin/catalog/rows', { table: name, rows })
    }
    scratch.close()
  }

  beforeEach(async () => {
    db = await seededServerDb()
    const owner = addUser(db, 'owner-discord', 'owner')
    const bob = addUser(db, 'bob-discord', 'bob')
    for (const [id, token] of [
      [owner, 'owner-desktop-token'],
      [bob, 'bob-desktop-token']
    ] as const)
      db.prepare(
        "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)"
      ).run(sha256Hex(token), id, NOW.toISOString(), '2099-01-01T00:00:00.000Z')
    db.prepare("INSERT INTO sets (language, set_name, set_code) VALUES ('en', ?, 'LOB')").run(
      SHARED_SET_NAME
    )
    deps = {
      db,
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: { soon: async () => {} },
      env: { ADMIN_TOKEN: 'admin-secret', ADMIN_DISCORD_ID: 'owner-discord' },
      now: () => NOW,
      fetch: (async () => new Response('', { status: 404 })) as typeof fetch
    } as unknown as AppDeps
    await loadPokemon()
  })

  it('the loader stores Pokémon rows with their game, and rows without one as Yu-Gi-Oh!', () => {
    expect(
      db.prepare('SELECT game, count(*) AS n FROM cards GROUP BY game ORDER BY game').all()
    ).toEqual([
      { game: 'pkm', n: 2 },
      { game: 'ygo', n: expect.any(Number) }
    ])
    expect(db.prepare('SELECT count(*) AS n FROM pokemon_cards').get()).toEqual({ n: 2 })
    expect(
      db.prepare('SELECT game FROM sets WHERE set_name = ? ORDER BY game').all(SHARED_SET_NAME)
    ).toEqual([{ game: 'pkm' }, { game: 'ygo' }])
  })

  it('the legacy feed from 0 holds no Pokémon row, no game column and no pokemon_cards', async () => {
    const all = await drain(null)
    expect(all.length).toBeGreaterThan(0)
    expect(all.some((c) => c.table === ('pokemon_cards' as never))).toBe(false)
    for (const c of all) {
      if (!('row' in c)) continue
      expect(c.row).not.toHaveProperty('game')
      const ids = c.table === 'cards' ? ['id'] : ['card_id', 'image_id']
      for (const col of ids) expect(Number(c.row[col] ?? 0)).toBeLessThan(PKM_ID_MIN)
    }
    const sets = all.filter(
      (c) => c.table === 'sets' && 'row' in c && c.row.set_name === SHARED_SET_NAME
    )
    expect(sets).toHaveLength(1)
  })

  it('game=pkm from 0 returns exactly the Pokémon rows', async () => {
    const all = await drain('pkm')
    const got = all.map((c) => {
      if (!('row' in c)) throw new Error('no tombstones from 0')
      const t = CATALOG_TABLES.find((x) => x.name === c.table)!
      expect(t.games).toContain('pkm')
      if (t.columns.includes('game')) expect(c.row.game).toBe('pkm')
      return `${c.table}:${JSON.stringify(t.key.map((k) => c.row[k]))}`
    })
    const expected: string[] = []
    for (const t of CATALOG_TABLES.filter((x) => x.games.includes('pkm'))) {
      const where = t.columns.includes('game') ? " WHERE game = 'pkm'" : ''
      for (const r of db
        .prepare(`SELECT ${t.key.map((k) => `"${k}"`).join(', ')} FROM ${t.name}${where}`)
        .all() as Record<string, unknown>[])
        expected.push(`${t.name}:${JSON.stringify(t.key.map((k) => r[k]))}`)
    }
    expect(got.sort()).toEqual(expected.sort())
    expect(expected.filter((k) => k.startsWith('pokemon_cards:'))).toHaveLength(2)
  })

  it('game=ygo serves only Yu-Gi-Oh! rows, with their game', async () => {
    const legacy = await drain(null)
    const ygo = await drain('ygo')
    expect(ygo.map((c) => c.seq)).toEqual(legacy.map((c) => c.seq))
    for (const c of ygo) if ('row' in c && c.table === 'cards') expect(c.row.game).toBe('ygo')
  })

  it('deleting a Pokémon set shows up only in the pkm feed', async () => {
    const since = (db.prepare('SELECT seq FROM catalog_clock').get() as { seq: number }).seq
    await admin('/admin/catalog/delete', { table: 'sets', keys: [['pkm', 'en', SHARED_SET_NAME]] })
    expect(db.prepare('SELECT game FROM sets WHERE set_name = ?').all(SHARED_SET_NAME)).toEqual([
      { game: 'ygo' }
    ])
    expect((await feed(`?since=${since}`)).changes).toEqual([])
    expect((await feed(`?since=${since}&game=ygo`)).changes).toEqual([])
    const pkm = await feed(`?since=${since}&game=pkm`)
    expect(pkm.changes).toEqual([
      { seq: since + 1, table: 'sets', deleted: ['pkm', 'en', SHARED_SET_NAME] }
    ])
  })

  it('a legacy two-part sets delete from the loader removes only the Yu-Gi-Oh! set', async () => {
    const since = (db.prepare('SELECT seq FROM catalog_clock').get() as { seq: number }).seq
    await admin('/admin/catalog/delete', { table: 'sets', keys: [['en', SHARED_SET_NAME]] })
    expect(db.prepare('SELECT game FROM sets WHERE set_name = ?').all(SHARED_SET_NAME)).toEqual([
      { game: 'pkm' }
    ])
    expect((await feed(`?since=${since}`)).changes).toEqual([
      { seq: since + 1, table: 'sets', deleted: ['en', SHARED_SET_NAME] }
    ])
    expect((await feed(`?since=${since}&game=ygo`)).changes).toEqual([
      { seq: since + 1, table: 'sets', deleted: ['ygo', 'en', SHARED_SET_NAME] }
    ])
    expect((await feed(`?since=${since}&game=pkm`)).changes).toEqual([])
  })

  it('pokemon_cards tombstones stay off the legacy feed', async () => {
    const since = (db.prepare('SELECT seq FROM catalog_clock').get() as { seq: number }).seq
    const id = (
      db.prepare('SELECT card_id FROM pokemon_cards LIMIT 1').get() as { card_id: number }
    ).card_id
    db.prepare('DELETE FROM pokemon_cards WHERE card_id = ?').run(id)
    expect((await feed(`?since=${since}`)).changes).toEqual([])
    expect((await feed(`?since=${since}&game=pkm`)).changes).toEqual([
      { seq: since + 1, table: 'pokemon_cards', deleted: [id] }
    ])
  })

  it('tables with a game may name pokemon_cards; tables of another game are left out', async () => {
    const tables = 'cards,pack_art,pokemon_cards'
    const pkm = await feed(`?since=0&game=pkm&tables=${tables}`)
    expect(new Set(pkm.changes.map((c) => c.table))).toEqual(new Set(['cards', 'pokemon_cards']))
    const ygo = await feed(`?since=0&game=ygo&tables=${tables}`)
    expect(ygo.changes.some((c) => c.table === ('pokemon_cards' as never))).toBe(false)
    expect((await call(`/api/catalog/changes?since=0&tables=pokemon_cards`, OWNER)).status).toBe(
      400
    )
  })

  it('a user without Pokémon asking for game=pkm gets 403', async () => {
    const res = await call('/api/catalog/changes?since=0&game=pkm', BOB)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'game-not-allowed' })
    expect((await call('/api/catalog/changes?since=0&game=nope', OWNER)).status).toBe(403)
    expect((await call('/api/catalog/changes?since=0&game=ygo', BOB)).status).toBe(200)
  })

  it('builds no compound SELECT on a per-game feed', async () => {
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
    expect((await drain('pkm', 0, 2)).length).toBeGreaterThan(2)
    expect((await feed('?since=1&game=pkm')).changes.length).toBeGreaterThan(0)
  })
})
