import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { SqlDb } from '../../../src/main/db/sql'
import type {
  FavouritePullResponse,
  FavouritePushResult,
  WireFavourite
} from '../../../src/shared/cloud'
import type { BrowsePage, EntryView } from '../../../src/shared/types'
import { doSql } from '../src/doSql'
import { migrateServer } from '../src/migrate'

// The favourites' queries on workerd's Durable Object SQLite, which refuses some that
// better-sqlite3 runs: the routes, the RPC channels and the Favourites filter.

const TS = '2026-11-02T10:00:00.000Z'
const LATER = '2026-11-02T10:01:00.000Z'
const CARDS = [1000, 1001, 1002]

async function hash(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface Store {
  db: <R>(fn: (db: SqlDb) => R) => Promise<R>
  call: <T>(token: string, path: string, body?: unknown) => Promise<{ status: number; data: T }>
  rpc: <T>(
    token: string,
    channel: string,
    args: unknown[]
  ) => Promise<{ status: number; result: T }>
}

function store(name: string): Store {
  const stub = env.STORE.get(env.STORE.idFromName(name))
  const call: Store['call'] = async <T>(token: string, path: string, body?: unknown) => {
    const res = await stub.fetch(`https://app.duelbinder.com${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const text = await res.text()
    return { status: res.status, data: (text ? JSON.parse(text) : null) as T }
  }
  return {
    db: (fn) => runInDurableObject(stub, (_i, state) => fn(doSql(state.storage))),
    call,
    rpc: async <T>(token: string, channel: string, args: unknown[]) => {
      const { status, data } = await call<{ result: T }>(token, `/api/rpc/${channel}`, { args })
      return { status, result: data.result }
    }
  }
}

function addUser(db: SqlDb, id: number, tokenHash: string): void {
  db.prepare(
    `INSERT INTO users (id, discord_id, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, `d${id}`, `user${id}`, TS, TS)
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)`
  ).run(tokenHash, id, TS, '2999-01-01T00:00:00.000Z')
}

/** Three cards with a printing each, all owned by users 1 and 2, who are friends. */
async function seeded(name: string): Promise<Store> {
  const s = store(name)
  const hashes = await Promise.all(['me', 'pal'].map(hash))
  await s.db((db) => {
    const card = db.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game)
       VALUES (?, ?, 'Normal Monster', 'normal', 'Dragon', '', ?, 'ygo')`
    )
    const image = db.prepare(
      "INSERT INTO card_images (image_id, card_id, sort_order, game) VALUES (?, ?, 0, 'ygo')"
    )
    const printing = db.prepare(
      `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, game) VALUES (?, 'Set', ?, 'Rare', 'ygo')`
    )
    hashes.forEach((h, i) => addUser(db, i + 1, h))
    db.prepare(
      `INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at) VALUES (1, 2, 'accepted', ?, ?)`
    ).run(TS, TS)
    const give = db.prepare(
      `INSERT INTO collection_entries (user_id, uid, printing_id, image_id, quantity, created_at, updated_at, server_seq)
       VALUES (?, ?, ?, ?, 1, ?, ?, (SELECT COALESCE(MAX(server_seq), 0) + 1 FROM collection_entries))`
    )
    for (const id of CARDS) {
      card.run(id, `Card ${id}`, TS)
      image.run(id, id)
      const p = Number(printing.run(id, `S-${id}`).lastInsertRowid)
      for (const user of [1, 2]) give.run(user, crypto.randomUUID(), p, id, TS, TS)
    }
  })
  return s
}

const fav = (cardId: number, extra: Partial<WireFavourite> = {}): WireFavourite => ({
  cardId,
  game: 'ygo',
  createdAt: TS,
  updatedAt: TS,
  deletedAt: null,
  ...extra
})

describe('favourites on Durable Object SQLite', () => {
  it('server-29 applies to a store without it and only adds', async () => {
    const s = store('server-29')
    const hashed = await hash('old')
    const out = await s.db((db) => {
      // Back to the step before, as a store that hasn't been deployed this version is.
      db.exec(`DROP TABLE favourites; DELETE FROM server_migrations WHERE name = 'server-29';`)
      addUser(db, 1, hashed)
      const steps = db.prepare('SELECT COUNT(*) AS n FROM server_migrations').get() as { n: number }
      migrateServer(db)
      migrateServer(db) // a second start finds nothing to do
      return {
        added:
          (db.prepare('SELECT COUNT(*) AS n FROM server_migrations').get() as { n: number }).n -
          steps.n,
        users: db.prepare('SELECT id FROM users').all(),
        indexes: (
          db
            .prepare(
              "SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'favourites' AND sql IS NOT NULL ORDER BY name"
            )
            .all() as { name: string }[]
        ).map((r) => r.name)
      }
    })
    expect(out).toEqual({
      added: 1,
      users: [{ id: 1 }],
      indexes: ['ix_favourites_user_seq', 'ux_favourites_seq']
    })
    const pull = await s.call<FavouritePullResponse>(
      'old',
      '/api/sync/favourites-pull?cursor=0&game=ygo'
    )
    expect(pull).toEqual({ status: 200, data: { entries: [], cursor: 0, more: false } })
  })

  it('push, pull, tombstone and re-heart, each with its own seq; no one else sees them', async () => {
    const s = await seeded('routes')
    const [a, b] = CARDS
    const pushed = await s.call<{ results: FavouritePushResult[] }>(
      'pal',
      '/api/sync/favourites-push',
      { entries: [fav(a), fav(b)] }
    )
    expect(pushed.data.results.map((r) => r.status)).toEqual(['applied', 'applied'])
    await s.call('pal', '/api/sync/favourites-push', {
      entries: [fav(a, { updatedAt: LATER, deletedAt: LATER })]
    })
    const all = await s.call<FavouritePullResponse>(
      'pal',
      '/api/sync/favourites-pull?cursor=0&game=ygo'
    )
    expect(all.data.entries.map((e) => [e.cardId, e.deletedAt])).toEqual([
      [b, null],
      [a, LATER]
    ])
    expect(all.data.cursor).toBe(3)
    expect(
      (await s.call<FavouritePullResponse>('me', '/api/sync/favourites-pull?cursor=0&game=ygo'))
        .data.entries
    ).toEqual([])
  })

  it('the web channels, the Favourites filter, and a friend never filtered by theirs', async () => {
    const s = await seeded('rpc')
    const [a, , c] = CARDS
    expect((await s.rpc('me', 'favourites:set', [a, true])).status).toBe(200)
    await s.rpc('me', 'favourites:set', [c, true])
    await s.rpc('me', 'favourites:set', [c, false])
    expect((await s.rpc<number[]>('me', 'favourites:list', [])).result).toEqual([a])
    expect((await s.rpc<number[]>('pal', 'favourites:list', [])).result).toEqual([])

    const filters = { sort: 'name', dir: 'asc', favourites: true }
    const mine = await s.rpc<EntryView[]>('me', 'collection:list', [filters])
    expect(mine.result.map((e) => e.card.id)).toEqual([a])
    const browsed = await s.rpc<BrowsePage>('me', 'cards:browse', [filters])
    expect(browsed.result.cards.map((x) => x.id)).toEqual([a])

    // Pal reads my collection with the filter on: my favourites stay private, so all three show.
    const seen = await s.rpc<EntryView[]>('pal', 'friends:collection', [1, filters])
    expect(seen.status).toBe(200)
    expect(seen.result.map((e) => e.card.id).sort()).toEqual([...CARDS].sort())
  })

  it('a deleted account takes its favourites with it', async () => {
    const s = await seeded('delete')
    await s.call('pal', '/api/sync/favourites-push', { entries: [fav(CARDS[0])] })
    await s.call('me', '/api/sync/favourites-push', { entries: [fav(CARDS[0])] })
    expect((await s.call('pal', '/api/account/delete', { confirm: 'delete' })).status).toBe(204)
    const rows = await s.db((db) => db.prepare('SELECT user_id FROM favourites').all())
    expect(rows).toEqual([{ user_id: 1 }])
  })
})
