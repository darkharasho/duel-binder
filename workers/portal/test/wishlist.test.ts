import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { SqlDb } from '../../../src/main/db/sql'
import type { WireWish, WishPullResponse, WishPushResult } from '../../../src/shared/cloud'
import type { FriendWantsCard, WishlistItem, WishOwners } from '../../../src/shared/types'
import { doSql } from '../src/doSql'
import { blockUser, removeFriend } from '../src/friends'
import { migrateServer } from '../src/migrate'

// Every route here goes through the real Store on workerd's Durable Object SQLite, which refuses
// queries better-sqlite3 runs, so the wishlist's queries have to be tried on it.

const TS = '2026-10-24T10:00:00.000Z'
/** ADMIN_DISCORD_ID in wrangler.toml: the only account that can use Pokémon for now. */
const OWNER_DISCORD = '201537071804973056'
const YGO_CARD = 1000
const PKM_CARD = 2000

async function hash(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface Store {
  db: <R>(fn: (db: SqlDb) => R) => Promise<R>
  /** Calls a route as `token`; answers the status and parsed body. */
  call: <T>(token: string, path: string, body?: unknown, game?: string) => Promise<{ status: number; data: T }>
  rpc: <T>(token: string, channel: string, args: unknown[], game?: string) => Promise<{ status: number; result: T }>
}

function store(name: string): Store {
  const stub = env.STORE.get(env.STORE.idFromName(name))
  const call: Store['call'] = async <T>(token: string, path: string, body?: unknown, game?: string) => {
    const res = await stub.fetch(`https://app.duelbinder.com${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(game ? { 'x-duel-game': game } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const text = await res.text()
    return { status: res.status, data: (text ? JSON.parse(text) : null) as T }
  }
  return {
    db: (fn) => runInDurableObject(stub, (_i, state) => fn(doSql(state.storage))),
    call,
    rpc: async <T>(token: string, channel: string, args: unknown[], game?: string) => {
      const { status, data } = await call<{ result: T }>(token, `/api/rpc/${channel}`, { args }, game)
      return { status, result: data.result }
    }
  }
}

function addUser(db: SqlDb, id: number, tokenHash: string, discord = `d${id}`): void {
  db.prepare(
    `INSERT INTO users (id, discord_id, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, discord, `user${id}`, TS, TS)
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)`
  ).run(tokenHash, id, TS, '2999-01-01T00:00:00.000Z')
}

function seedCatalog(db: SqlDb, printings: number): void {
  const card = db.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game)
     VALUES (?, ?, 'Normal Monster', 'normal', 'Dragon', '', ?, ?)`
  )
  const image = db.prepare('INSERT INTO card_images (image_id, card_id, sort_order, game) VALUES (?, ?, 0, ?)')
  const printing = db.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, game) VALUES (?, ?, ?, 'Rare', ?)`
  )
  card.run(YGO_CARD, 'Dragon', TS, 'ygo')
  image.run(YGO_CARD, YGO_CARD, 'ygo')
  for (let i = 0; i < printings; i++) printing.run(YGO_CARD, 'Set', `S-${i}`, 'ygo')
  card.run(PKM_CARD, 'Mouse', TS, 'pkm')
  image.run(PKM_CARD, PKM_CARD, 'pkm')
  printing.run(PKM_CARD, 'Base', 'B-1', 'pkm')
}

function befriend(db: SqlDb, a: number, b: number, status = 'accepted'): void {
  db.prepare(
    'INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(a, b, status, TS, TS)
}

function give(db: SqlDb, user: number, printingId: number, quantity = 1): void {
  db.prepare(
    `INSERT INTO collection_entries (user_id, uid, printing_id, image_id, quantity, created_at, updated_at, server_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(server_seq), 0) + 1 FROM collection_entries))`
  ).run(user, crypto.randomUUID(), printingId, YGO_CARD, quantity, TS, TS)
}

const pkeys = (db: SqlDb, game = 'ygo'): { id: number; pkey: string }[] =>
  db.prepare('SELECT id, pkey FROM card_printings WHERE game = ? ORDER BY id').all(game) as {
    id: number
    pkey: string
  }[]

const wish = (pkey: string, extra: Partial<WireWish> = {}): WireWish => ({
  pkey,
  game: 'ygo',
  quantity: null,
  createdAt: TS,
  updatedAt: TS,
  deletedAt: null,
  ...extra
})

/** A store with users 1 and 2 (friends), 3 (a stranger) and 4 (who has a pending request to 1). */
async function friendsStore(name: string, printings = 3): Promise<Store & { keys: { id: number; pkey: string }[] }> {
  const s = store(name)
  const hashes = await Promise.all(['me', 'pal', 'stranger', 'pending'].map(hash))
  const keys = await s.db((db) => {
    seedCatalog(db, printings)
    hashes.forEach((h, i) => addUser(db, i + 1, h, i === 0 ? OWNER_DISCORD : undefined))
    befriend(db, 1, 2)
    befriend(db, 4, 1, 'pending')
    return pkeys(db)
  })
  return { ...s, keys }
}

describe('wishlist on Durable Object SQLite', () => {
  it('server-15 applies to a store at server-14 with rows in it, and only adds', async () => {
    const s = store('server-15')
    const hashed = await hash('old')
    const out = await s.db((db) => {
      // Back to the step before, as a store that hasn't been deployed this version is.
      db.exec(`DROP TABLE wishlist_entries;
               ALTER TABLE users DROP COLUMN wishlist_hidden;
               DELETE FROM server_migrations WHERE name = 'server-15';`)
      seedCatalog(db, 2)
      addUser(db, 1, hashed)
      addUser(db, 2, 'x')
      befriend(db, 1, 2)
      const [first] = pkeys(db)
      give(db, 1, first.id)
      const before = db.prepare('SELECT * FROM collection_entries').all()
      const steps = db.prepare('SELECT COUNT(*) AS n FROM server_migrations').get() as { n: number }

      migrateServer(db)
      migrateServer(db) // a second start finds nothing to do

      return {
        before,
        after: db.prepare('SELECT * FROM collection_entries').all(),
        added: (db.prepare('SELECT COUNT(*) AS n FROM server_migrations').get() as { n: number }).n - steps.n,
        users: db.prepare('SELECT id, username, wishlist_hidden FROM users ORDER BY id').all(),
        friends: db.prepare('SELECT status FROM friendships').all(),
        indexes: (
          db
            .prepare(
              "SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'wishlist_entries' AND sql IS NOT NULL ORDER BY name"
            )
            .all() as { name: string }[]
        ).map((r) => r.name)
      }
    })
    expect(out.after).toEqual(out.before)
    expect(out.added).toBe(1)
    expect(out.users).toEqual([
      { id: 1, username: 'user1', wishlist_hidden: 0 },
      { id: 2, username: 'user2', wishlist_hidden: 0 }
    ])
    expect(out.friends).toEqual([{ status: 'accepted' }])
    expect(out.indexes).toEqual(['ix_wishlist_user_seq', 'ux_wishlist_seq'])

    // And the migrated store answers.
    const pull = await s.call<WishPullResponse>('old', '/api/sync/wishlist-pull?cursor=0&game=ygo')
    expect(pull).toEqual({ status: 200, data: { entries: [], cursor: 0, more: false } })
  })

  it('push, pull, re-add and the friends routes, with each kind of non-friend refused', async () => {
    const s = await friendsStore('routes')
    const [a, b, c] = s.keys

    const pushed = await s.call<{ results: WishPushResult[] }>('pal', '/api/sync/wishlist-push', {
      entries: [wish(a.pkey), wish(b.pkey, { quantity: 2 })]
    })
    expect(pushed.data.results.map((r) => r.status)).toEqual(['applied', 'applied'])

    // Delete, then a later add on another device: the same row, a new seq each time.
    await s.call('pal', '/api/sync/wishlist-push', {
      entries: [wish(a.pkey, { updatedAt: '2026-10-24T10:01:00.000Z', deletedAt: '2026-10-24T10:01:00.000Z' })]
    })
    const tomb = await s.call<WishPullResponse>('pal', '/api/sync/wishlist-pull?cursor=2&game=ygo')
    expect(tomb.data.entries.map((e) => e.deletedAt)).toEqual(['2026-10-24T10:01:00.000Z'])
    await s.call('pal', '/api/sync/wishlist-push', {
      entries: [wish(a.pkey, { updatedAt: '2026-10-24T10:02:00.000Z' })]
    })
    const all = await s.call<WishPullResponse>('pal', '/api/sync/wishlist-pull?cursor=0&game=ygo')
    expect(all.data.entries.map((e) => [e.pkey, e.deletedAt])).toEqual([
      [b.pkey, null],
      [a.pkey, null]
    ])
    expect(all.data.cursor).toBe(4)
    const seqs = await s.db(
      (db) => db.prepare('SELECT seq FROM wishlist_entries ORDER BY seq').all() as { seq: number }[]
    )
    expect(seqs.map((r) => r.seq)).toEqual([2, 4])

    // Others' rows stay out of a pull, and a push can't name an owner.
    expect((await s.call<WishPullResponse>('me', '/api/sync/wishlist-pull?cursor=0&game=ygo')).data.entries).toEqual([])
    await s.call('me', '/api/sync/wishlist-push', {
      entries: [{ ...wish(c.pkey), user_id: 2, userId: 2, owner: 2 }]
    })
    const owners = await s.db(
      (db) => db.prepare('SELECT user_id FROM wishlist_entries WHERE pkey = ?').all(c.pkey) as unknown[]
    )
    expect(owners).toEqual([{ user_id: 1 }])

    const list = await s.rpc<WishlistItem[]>('me', 'friends:wishlist', [2])
    expect(list.result.map((w) => w.pkey).sort()).toEqual([a.pkey, b.pkey].sort())
    expect((await s.rpc<FriendWantsCard[]>('me', 'friends:wanting', [YGO_CARD])).result.map((f) => f.id)).toEqual([2])

    for (const token of ['stranger', 'pending']) {
      expect((await s.call(token, '/api/rpc/friends:wishlist', { args: [2] })).status).toBe(400)
      expect((await s.rpc<unknown[]>(token, 'friends:wanting', [YGO_CARD])).result).toEqual([])
      expect((await s.rpc<unknown[]>(token, 'friends:owning', [[a.pkey]])).result).toEqual([])
    }

    // The list's owner hides it.
    await s.rpc('pal', 'friends:setWishlistVisible', [false])
    expect((await s.rpc<boolean>('pal', 'friends:wishlistVisible', [])).result).toBe(false)
    expect((await s.rpc<unknown[]>('me', 'friends:wishlist', [2])).result).toEqual([])
    expect((await s.rpc<unknown[]>('me', 'friends:wanting', [YGO_CARD])).result).toEqual([])
    await s.rpc('pal', 'friends:setWishlistVisible', [true])

    // A copy reaches the target: friends:owning names it, and "wants this" counts it.
    await s.db((db) => give(db, 2, b.id, 2))
    expect((await s.rpc<WishOwners[]>('me', 'friends:owning', [[a.pkey, b.pkey]])).result).toMatchObject([
      { pkey: b.pkey, friends: [{ id: 2, quantity: 2 }] }
    ])
    expect((await s.rpc<WishlistItem[]>('me', 'friends:wishlist', [2])).result.map((w) => w.pkey)).toEqual([a.pkey])

    // Unfriended, then blocked: nothing either way round.
    await s.db((db) => removeFriend(db, 1, 2))
    expect((await s.call('me', '/api/rpc/friends:wishlist', { args: [2] })).status).toBe(400)
    await s.db((db) => befriend(db, 1, 2))
    expect((await s.rpc<unknown[]>('me', 'friends:wishlist', [2])).status).toBe(200)
    await s.db((db) => blockUser(db, 2, 1, new Date(TS)))
    expect((await s.call('me', '/api/rpc/friends:wishlist', { args: [2] })).status).toBe(400)
    expect((await s.rpc<unknown[]>('me', 'friends:wanting', [YGO_CARD])).result).toEqual([])
    expect((await s.rpc<unknown[]>('me', 'friends:owning', [[b.pkey]])).result).toEqual([])
  })

  it('the web channels write, settle and remove with a seq each', async () => {
    const s = await friendsStore('rpc')
    const [a] = s.keys
    const image = (await s.db((db) => db.prepare('SELECT image_id FROM card_images LIMIT 1').get())) as {
      image_id: number
    }
    expect((await s.rpc('me', 'wishlist:set', [a.id, 1])).status).toBe(200)
    expect((await s.rpc<unknown[]>('me', 'wishlist:forCard', [YGO_CARD])).result).toEqual([
      { printingId: a.id, quantity: 1 }
    ])
    // An add that meets the target drops the want, and the feed tells the other devices.
    await s.rpc('me', 'collection:add', [{ printingId: a.id, imageId: image.image_id, quantity: 1 }])
    expect((await s.rpc<unknown[]>('me', 'wishlist:list', [])).result).toEqual([])
    const feed = await s.call<WishPullResponse>('me', '/api/sync/wishlist-pull?cursor=1&game=ygo')
    expect(feed.data.entries.map((e) => e.pkey)).toEqual([a.pkey])
    expect(feed.data.entries[0].deletedAt).not.toBeNull()

    // A want again, for more than is owned, then a plain remove.
    await s.rpc('me', 'wishlist:set', [a.id, null])
    expect((await s.rpc<WishlistItem[]>('me', 'wishlist:list', [])).result).toMatchObject([
      { pkey: a.pkey, quantity: null, owned: 1 }
    ])
    await s.rpc('me', 'wishlist:remove', [a.id])
    expect((await s.rpc<unknown[]>('me', 'wishlist:list', [])).result).toEqual([])
  })

  it('keeps the games apart', async () => {
    const s = await friendsStore('games')
    const [a] = s.keys
    const pkm = (await s.db((db) => pkeys(db, 'pkm')))[0]
    await s.call('me', '/api/sync/wishlist-push', {
      entries: [wish(a.pkey), wish(pkm.pkey, { game: 'pkm' })]
    })
    const ygo = await s.call<WishPullResponse>('me', '/api/sync/wishlist-pull?cursor=0&game=ygo')
    const pk = await s.call<WishPullResponse>('me', '/api/sync/wishlist-pull?cursor=0&game=pkm')
    expect(ygo.data.entries.map((e) => e.pkey)).toEqual([a.pkey])
    expect(pk.data.entries.map((e) => e.pkey)).toEqual([pkm.pkey])
    // Each feed's last page moves past the other game's seqs.
    expect(ygo.data.cursor).toBe(2)
    expect(pk.data.cursor).toBe(2)

    // The owner's friend, seen through each game. Pokémon is owner-only for now, so the pal's game
    // header is refused; the list reads through the owner.
    await s.db((db) => {
      db.prepare('UPDATE users SET discord_id = ? WHERE id = 1').run('swap')
      db.prepare('UPDATE users SET discord_id = ? WHERE id = 2').run(OWNER_DISCORD)
    })
    const wanted = (game: string): Promise<{ result: WishlistItem[] }> =>
      s.rpc<WishlistItem[]>('pal', 'friends:wishlist', [1], game)
    expect((await wanted('ygo')).result.map((w) => w.pkey)).toEqual([a.pkey])
    expect((await wanted('pkm')).result.map((w) => w.pkey)).toEqual([pkm.pkey])

    // A row whose game is forged never reaches the other game's views.
    await s.db((db) => {
      befriend(db, 2, 3)
      db.prepare(
        `INSERT INTO wishlist_entries (user_id, pkey, game, created_at, updated_at, seq) VALUES (3, ?, 'pkm', ?, ?, 99)`
      ).run(a.pkey, TS, TS)
    })
    expect((await s.rpc<unknown[]>('pal', 'friends:wishlist', [3], 'pkm')).result).toEqual([])
    expect((await s.rpc<unknown[]>('pal', 'friends:wanting', [YGO_CARD], 'pkm')).result).toEqual([])

    // A game the account can't use yet stays out of the table.
    const skipped = await s.call<{ results: WishPushResult[] }>('stranger', '/api/sync/wishlist-push', {
      entries: [wish(pkm.pkey, { game: 'pkm' })]
    })
    expect(skipped.data.results).toEqual([{ pkey: pkm.pkey, status: 'skipped' }])
  })

  it('takes a 500-row push, a 1,000-printing list, and the friends reads at that size', async () => {
    const s = await friendsStore('big', 1000)
    const keys = s.keys.map((k) => k.pkey)
    const batches = [keys.slice(0, 500), keys.slice(500)]
    for (const batch of batches) {
      const res = await s.call<{ results: WishPushResult[] }>('pal', '/api/sync/wishlist-push', {
        entries: batch.map((k) => wish(k, { quantity: 1 }))
      })
      expect(res.status).toBe(200)
      expect(res.data.results.every((r) => r.status === 'applied')).toBe(true)
    }
    const page = await s.call<WishPullResponse>('pal', '/api/sync/wishlist-pull?cursor=0&game=ygo')
    expect(page.data).toMatchObject({ cursor: 1000, more: false })
    expect(page.data.entries).toHaveLength(1000)

    await s.db((db) => {
      for (const k of s.keys.slice(0, 500)) give(db, 1, k.id)
    })
    expect((await s.rpc<WishlistItem[]>('me', 'friends:wishlist', [2])).result).toHaveLength(1000)
    expect((await s.rpc<FriendWantsCard[]>('me', 'friends:wanting', [YGO_CARD])).result[0].printings).toHaveLength(1000)
    expect((await s.rpc<WishOwners[]>('pal', 'friends:owning', [keys.slice(0, 500)])).result).toHaveLength(500)
    expect((await s.rpc<WishOwners[]>('pal', 'friends:owning', [keys])).result).toHaveLength(500)
    // The longest list the portal takes: 1,000 keys of the longest length.
    const long = keys.map((k) => k.padEnd(300, 'x'))
    const longest = await s.rpc<WishOwners[]>('pal', 'friends:owning', [long])
    expect(longest).toEqual({ status: 200, result: [] })
    // One past it is a clean refusal.
    expect((await s.call('pal', '/api/rpc/friends:owning', { args: [[...keys, 'x']] })).status).toBe(400)

    // Every want met at once: a statement each, so each gets its own seq.
    const wished = await s.db((db) => {
      for (const k of s.keys.slice(0, 500)) give(db, 2, k.id)
      return true
    })
    expect(wished).toBe(true)
    const image = await s.db(
      (db) => db.prepare('SELECT image_id FROM card_images LIMIT 1').get() as { image_id: number }
    )
    await s.rpc('pal', 'collection:add', [{ printingId: s.keys[0].id, imageId: image.image_id, quantity: 1 }])
    const settled = await s.db((db) => {
      const row = db
        .prepare(
          'SELECT COUNT(*) AS n, COUNT(DISTINCT seq) AS seqs, SUM(deleted_at IS NOT NULL) AS gone FROM wishlist_entries'
        )
        .get()
      return row
    })
    expect(settled).toEqual({ n: 1000, seqs: 1000, gone: 500 })
  })

  it('a deleted account takes its wishlist with it', async () => {
    const s = await friendsStore('delete')
    const [a] = s.keys
    await s.call('pal', '/api/sync/wishlist-push', { entries: [wish(a.pkey)] })
    await s.call('me', '/api/sync/wishlist-push', { entries: [wish(a.pkey)] })
    expect((await s.call('pal', '/api/account/delete', { confirm: 'delete' })).status).toBe(204)
    const rows = await s.db((db) => db.prepare('SELECT user_id FROM wishlist_entries').all())
    expect(rows).toEqual([{ user_id: 1 }])
  })
})
