import { describe, expect, it, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createCloudClient, CloudAuthError, type CloudClient } from '../../src/main/cloud/client'
import { syncOnce } from '../../src/main/cloud/engine'
import {
  adoptLocalData,
  ensureAccount,
  gameCursor,
  hasLocalData,
  setActiveOwner
} from '../../src/main/cloud/localSync'
import { setMeta } from '../../src/main/db/meta'
import { MIGRATIONS } from '../../src/main/db/schema'
import { createDataHandlers } from '../../src/main/ipc/dataHandlers'
import { addEntry, updateEntry } from '../../src/main/repo/collection'
import {
  listWishlist,
  removeWish,
  setWish,
  settleWishlist,
  wishesForCard
} from '../../src/main/repo/wishlist'
import { seedPokemon } from '../fixtures/pokemon'
import { inProcessPortal, PORTAL } from './cloudHelpers'
import { seededDb } from './helpers'

const T1 = new Date('2026-10-25T11:00:00.000Z')
const T2 = new Date('2026-10-25T12:00:00.000Z')
const T3 = new Date('2026-10-25T13:00:00.000Z')
const NOW = (): Date => new Date('2026-10-25T20:00:00.000Z')

interface PrintingRow {
  id: number
  pkey: string
  card_id: number
  image_id: number
}

const first = (db: Database.Database, game = 'ygo'): PrintingRow =>
  db
    .prepare(
      `SELECT p.id, p.pkey, p.card_id, i.image_id FROM card_printings p
       JOIN card_images i ON i.card_id = p.card_id WHERE p.game = ? ORDER BY p.id LIMIT 1`
    )
    .get(game) as PrintingRow

const rows = (db: Database.Database): Record<string, unknown>[] =>
  db
    .prepare(
      'SELECT owner_id, pkey, quantity, deleted_at, dirty FROM wishlist_entries ORDER BY pkey'
    )
    .all() as Record<string, unknown>[]

const give = (db: Database.Database, p: PrintingRow, quantity: number, at = T2): number =>
  addEntry(db, { printingId: p.id, imageId: p.image_id, quantity }, at).id

describe('wishlist repo', () => {
  let db: Database.Database
  let p: PrintingRow

  beforeEach(async () => {
    db = await seededDb()
    p = first(db)
  })

  it('migration 25 follows 24 and stays desktop-only', () => {
    expect(MIGRATIONS.at(-1)).toMatchObject({ version: 25, server: false })
    expect(MIGRATIONS.at(-2)?.version).toBe(24)
  })

  it('lists a wanted printing with its card, art and price', () => {
    db.prepare('UPDATE card_printings SET market_price = 12.5 WHERE id = ?').run(p.id)
    setWish(db, p.id, null, T1)
    const [item, ...rest] = listWishlist(db)
    expect(rest).toEqual([])
    expect(item).toMatchObject({
      pkey: p.pkey,
      imageId: p.image_id,
      quantity: null,
      owned: 0,
      unitPrice: 12.5,
      addedAt: T1.toISOString()
    })
    expect(item.card.id).toBe(p.card_id)
    expect(wishesForCard(db, p.card_id)).toEqual([{ printingId: p.id, quantity: null }])
  })

  it('wanting a printing twice writes once, and a removed one comes back', () => {
    setWish(db, p.id, null, T1)
    db.prepare('UPDATE wishlist_entries SET dirty = 0').run()
    setWish(db, p.id, null, T2)
    expect(rows(db)).toEqual([expect.objectContaining({ dirty: 0 })])
    removeWish(db, p.id, T2)
    expect(listWishlist(db)).toEqual([])
    expect(rows(db)).toEqual([expect.objectContaining({ deleted_at: T2.toISOString(), dirty: 1 })])
    setWish(db, p.id, 2, T3)
    expect(listWishlist(db)).toMatchObject([{ quantity: 2, addedAt: T3.toISOString() }])
  })

  it('refuses a bad quantity or an unknown printing', () => {
    for (const bad of [0, -1, 1.5, 1000, '2']) expect(() => setWish(db, p.id, bad)).toThrow()
    expect(() => setWish(db, 999_999_999, null)).toThrow('not found')
  })

  it('keeps a target above the copies owned', () => {
    give(db, p, 2)
    setWish(db, p.id, 1, T3)
    expect(listWishlist(db)).toMatchObject([{ quantity: 3, owned: 2 }])
  })

  it('a want with no target stays, marked owned, however many copies land', () => {
    setWish(db, p.id, null, T1)
    give(db, p, 3)
    expect(settleWishlist(db, undefined, T3)).toBe(0)
    expect(listWishlist(db)).toMatchObject([{ quantity: null, owned: 3 }])
  })

  it('a target stays until the owned count reaches it, then goes as a tombstone', () => {
    setWish(db, p.id, 3, T1)
    const id = give(db, p, 2)
    expect(settleWishlist(db, undefined, T2)).toBe(0)
    expect(listWishlist(db)).toMatchObject([{ quantity: 3, owned: 2 }])
    updateEntry(db, id, { quantity: 3 }, T3)
    expect(settleWishlist(db, undefined, T3)).toBe(1)
    expect(listWishlist(db)).toEqual([])
    expect(rows(db)).toEqual([expect.objectContaining({ deleted_at: T3.toISOString(), dirty: 1 })])
  })

  it('the edit handlers settle: a target met by an add goes at once', async () => {
    setWish(db, p.id, 1, T1)
    const handlers = createDataHandlers({
      db,
      onEdit: () => {},
      availableGames: () => ['ygo'],
      onGameChanged: () => {}
    })
    await handlers['collection:add']({ printingId: p.id, imageId: p.image_id, quantity: 1 })
    expect(await handlers['wishlist:list']()).toEqual([])
  })

  it('wishes are per game', async () => {
    seedPokemon(db)
    setWish(db, p.id, null, T1)
    setMeta(db, 'active_game', 'pkm')
    expect(listWishlist(db)).toEqual([])
    const pk = first(db, 'pkm')
    setWish(db, pk.id, null, T1)
    expect(listWishlist(db)).toMatchObject([{ pkey: pk.pkey }])
    expect(rows(db)).toHaveLength(2)
    // A printing of the other game isn't this game's to want.
    expect(() => setWish(db, p.id, null, T1)).toThrow('not found')
  })

  it('a Pokémon want is priced in its own language only, in USD, with no cross-language fallback', async () => {
    seedPokemon(db)
    setMeta(db, 'active_game', 'pkm')
    const ja = db
      .prepare("SELECT id FROM card_printings WHERE game = 'pkm' AND language <> 'en' LIMIT 1")
      .get() as { id: number } | undefined
    expect(ja).toBeDefined()
    db.prepare(
      "UPDATE card_printings SET market_price = 40 WHERE game = 'pkm' AND language = 'en'"
    ).run()
    db.prepare('UPDATE card_printings SET market_price = NULL WHERE id = ?').run(ja!.id)
    setWish(db, ja!.id, null, T1)
    expect(listWishlist(db)).toMatchObject([{ unitPrice: null, priceApproximate: false }])
  })

  it('a want outlives its printing leaving the catalog and shows again when it returns', () => {
    setWish(db, p.id, null, T1)
    db.prepare("UPDATE card_printings SET set_code = 'ZZ-GONE' WHERE id = ?").run(p.id)
    expect(listWishlist(db)).toEqual([])
    expect(rows(db)).toHaveLength(1)
    const code = p.pkey.split('|')[2]
    db.prepare('UPDATE card_printings SET set_code = ? WHERE id = ?').run(code, p.id)
    expect(listWishlist(db)).toHaveLength(1)
  })

  it('never-signed-in wishes count as local data and move to the first account, dirty', () => {
    expect(hasLocalData(db)).toBe(false)
    setWish(db, p.id, 2, T1)
    expect(hasLocalData(db)).toBe(true)
    adoptLocalData(db, 7)
    expect(rows(db)).toEqual([expect.objectContaining({ owner_id: 7, quantity: 2, dirty: 1 })])
  })
})

describe('wishlist sync', () => {
  let portal: Awaited<ReturnType<typeof inProcessPortal>>
  let user: number
  let a: Database.Database
  let p: PrintingRow

  const device = async (): Promise<Database.Database> => {
    const db = await seededDb()
    ensureAccount(db, user, 'owner')
    setActiveOwner(db, user)
    return db
  }
  const clientFor = async (): Promise<CloudClient> =>
    createCloudClient({
      baseUrl: PORTAL,
      token: await portal.desktopToken(user),
      fetch: portal.fetch
    })
  const sync = async (db: Database.Database): Promise<void> => {
    await syncOnce(db, user, await clientFor(), NOW)
  }
  const server = (): Record<string, unknown>[] =>
    portal.serverDb
      .prepare('SELECT pkey, game, quantity, deleted_at FROM wishlist_entries WHERE user_id = ?')
      .all(user) as Record<string, unknown>[]

  beforeEach(async () => {
    portal = await inProcessPortal()
    user = portal.addUser('owner')
    a = await device()
    p = first(a)
  })

  it('pushes a want, reaches a fresh install, and a removal follows', async () => {
    setWish(a, p.id, 2, T1)
    await sync(a)
    expect(server()).toEqual([{ pkey: p.pkey, game: 'ygo', quantity: 2, deleted_at: null }])
    expect(rows(a)).toEqual([expect.objectContaining({ dirty: 0 })])

    const b = await device()
    await sync(b)
    expect(listWishlist(b)).toMatchObject([{ pkey: p.pkey, quantity: 2 }])
    expect(rows(b)).toEqual([expect.objectContaining({ dirty: 0 })])

    removeWish(a, p.id, T2)
    await sync(a)
    await sync(b)
    expect(listWishlist(b)).toEqual([])
    // The server keeps the tombstone for other devices; each device forgets it once it's clean.
    expect(server()).toEqual([expect.objectContaining({ deleted_at: T2.toISOString() })])
    expect(rows(a)).toEqual([])
    expect(rows(b)).toEqual([])
  })

  it('wishes queue offline and go up on the next run', async () => {
    setWish(a, p.id, null, T1)
    const down = createCloudClient({
      baseUrl: PORTAL,
      token: 'x',
      fetch: (async () => {
        throw new Error('offline')
      }) as typeof fetch
    })
    await expect(syncOnce(a, user, down, NOW)).rejects.toThrow()
    expect(rows(a)).toEqual([expect.objectContaining({ dirty: 1 })])
    await sync(a)
    expect(server()).toHaveLength(1)
    expect(rows(a)).toEqual([expect.objectContaining({ dirty: 0 })])
  })

  it('wants stay with their account when another signs in on this computer', async () => {
    setWish(a, p.id, 2, T1) // queued, not yet up, when the account changes
    const other = portal.addUser('other')
    ensureAccount(a, other, 'other')
    setActiveOwner(a, other)
    expect(listWishlist(a)).toEqual([])
    await syncOnce(
      a,
      other,
      createCloudClient({
        baseUrl: PORTAL,
        token: await portal.desktopToken(other),
        fetch: portal.fetch
      }),
      NOW
    )
    expect(listWishlist(a)).toEqual([])
    expect(server()).toEqual([])
    expect(rows(a)).toEqual([expect.objectContaining({ owner_id: user, dirty: 1 })])

    setActiveOwner(a, user)
    await sync(a)
    expect(listWishlist(a)).toMatchObject([{ pkey: p.pkey, quantity: 2 }])
    expect(server()).toHaveLength(1)
  })

  it('a removal and a re-add before the next sync reach the server as a want', async () => {
    setWish(a, p.id, null, T1)
    await sync(a)
    removeWish(a, p.id, T2)
    setWish(a, p.id, 3, T3)
    await sync(a)
    expect(server()).toEqual([{ pkey: p.pkey, game: 'ygo', quantity: 3, deleted_at: null }])
    const b = await device()
    await sync(b)
    expect(listWishlist(b)).toMatchObject([{ pkey: p.pkey, quantity: 3 }])
  })

  it('the latest edit wins between two devices, either way round', async () => {
    const b = await device()
    setWish(a, p.id, 2, T1)
    await sync(a)
    await sync(b)
    setWish(a, p.id, 4, T3)
    setWish(b, p.id, 3, T2)
    await sync(b)
    await sync(a)
    await sync(b)
    expect(listWishlist(a)).toMatchObject([{ quantity: 4 }])
    expect(listWishlist(b)).toMatchObject([{ quantity: 4 }])
  })

  it('an older edit that reaches the server late takes the server row', async () => {
    const b = await device()
    setWish(a, p.id, 4, T3)
    setWish(b, p.id, 3, T2)
    await sync(a)
    await sync(b)
    expect(listWishlist(b)).toMatchObject([{ quantity: 4 }])
    expect(rows(b)).toEqual([expect.objectContaining({ dirty: 0 })])
    expect(server()).toEqual([expect.objectContaining({ quantity: 4 })])
  })

  it('both devices wanting one printing make one row', async () => {
    const b = await device()
    setWish(a, p.id, null, T1)
    setWish(b, p.id, null, T2)
    await sync(a)
    await sync(b)
    await sync(a)
    expect(server()).toHaveLength(1)
  })

  it('a target met by copies from another device settles in the sync', async () => {
    const b = await device()
    setWish(a, p.id, 2, T1)
    await sync(a)
    addEntry(b, { printingId: p.id, imageId: p.image_id, quantity: 2 }, T2)
    await sync(b)
    await sync(a)
    await sync(b)
    expect(listWishlist(a)).toEqual([])
    expect(server()).toEqual([expect.objectContaining({ deleted_at: expect.any(String) })])
  })

  it('keeps Yu-Gi-Oh! entry cursors apart from the wishlist cursor', async () => {
    setWish(a, p.id, null, T1)
    give(a, p, 1)
    await sync(a)
    await sync(a)
    const stored = a
      .prepare("SELECT game, cursor FROM cloud_game_cursors WHERE stream = 'wishlist'")
      .all()
    expect(stored).toEqual([{ game: 'ygo', cursor: gameCursor(a, user, 'ygo', 'wishlist') }])
    expect(gameCursor(a, user, 'ygo', 'wishlist')).toBeGreaterThan(0)
    expect(
      a.prepare("SELECT 1 FROM cloud_game_cursors WHERE stream = 'entries'").get()
    ).toBeUndefined()
  })

  it('leaves the collection push byte-identical: no wishlist field in a sync body', async () => {
    const bodies: string[] = []
    const spy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      if (req.url.endsWith('/api/sync/push')) bodies.push(await req.clone().text())
      return portal.fetch(req)
    }) as typeof fetch
    setWish(a, p.id, 2, T1)
    give(a, p, 1)
    const client = createCloudClient({
      baseUrl: PORTAL,
      token: await portal.desktopToken(user),
      fetch: spy
    })
    await syncOnce(a, user, client, NOW)
    expect(bodies).toHaveLength(1)
    const { entries } = JSON.parse(bodies[0]) as { entries: Record<string, unknown>[] }
    expect(Object.keys(entries[0]).sort()).toEqual(
      ['createdAt', 'deletedAt', 'imageId', 'notes', 'pkey', 'quantity', 'uid', 'updatedAt'].sort()
    )
    expect(Object.keys(JSON.parse(bodies[0]))).toEqual(['entries'])
  })

  describe('against an old portal', () => {
    /** The real portal with the wishlist routes answering as an older one does. */
    const oldPortal = (calls: string[]): typeof fetch =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init)
        const path = new URL(req.url).pathname
        if (path.startsWith('/api/sync/wishlist')) {
          calls.push(path)
          return new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' }
          })
        }
        return portal.fetch(req)
      }) as typeof fetch

    it('treats a 404 as not syncing yet: the run succeeds, wishes stay queued', async () => {
      const calls: string[] = []
      setWish(a, p.id, 2, T1)
      give(a, p, 1)
      const client = createCloudClient({
        baseUrl: PORTAL,
        token: await portal.desktopToken(user),
        fetch: oldPortal(calls)
      })
      const outcome = await syncOnce(a, user, client, NOW)
      expect(outcome).toMatchObject({ pushed: 1, unsynced: 0 })
      expect(calls).toEqual(['/api/sync/wishlist-pull'])
      expect(rows(a)).toEqual([expect.objectContaining({ dirty: 1, quantity: 2 })])
      // The collection's own run finished, and the account's sync time moved.
      expect(a.prepare('SELECT synced_at FROM cloud_accounts').get()).toEqual({
        synced_at: NOW().toISOString()
      })

      // Once the portal is updated, what queued goes up with no further action.
      await sync(a)
      expect(server()).toEqual([expect.objectContaining({ pkey: p.pkey, quantity: 2 })])
    })

    it('another failure in the wishlist step leaves the collection sync whole', async () => {
      const fails = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init)
        if (new URL(req.url).pathname.startsWith('/api/sync/wishlist'))
          return new Response('nope', { status: 502 })
        return portal.fetch(req)
      }) as typeof fetch
      setWish(a, p.id, null, T1)
      const client = createCloudClient({
        baseUrl: PORTAL,
        token: await portal.desktopToken(user),
        fetch: fails
      })
      await expect(syncOnce(a, user, client, NOW)).resolves.toBeDefined()
      expect(rows(a)).toEqual([expect.objectContaining({ dirty: 1 })])
    })

    it('a signed-out answer still ends the run', async () => {
      const fails = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init)
        if (new URL(req.url).pathname.startsWith('/api/sync/wishlist'))
          return new Response('{}', { status: 401 })
        return portal.fetch(req)
      }) as typeof fetch
      const client = createCloudClient({
        baseUrl: PORTAL,
        token: await portal.desktopToken(user),
        fetch: fails
      })
      await expect(syncOnce(a, user, client, NOW)).rejects.toBeInstanceOf(CloudAuthError)
    })
  })
})
