import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { createCloudClient, type CloudClient } from '../../src/main/cloud/client'
import { syncOnce } from '../../src/main/cloud/engine'
import {
  adoptLocalData,
  ensureAccount,
  hasLocalData,
  setActiveOwner
} from '../../src/main/cloud/localSync'
import { setMeta } from '../../src/main/db/meta'
import { MIGRATIONS } from '../../src/main/db/schema'
import { browseCards } from '../../src/main/repo/browse'
import { addEntry, listEntries } from '../../src/main/repo/collection'
import { listFavourites, setFavourite } from '../../src/main/repo/favourites'
import { seedPokemon } from '../fixtures/pokemon'
import { withOwnerOnlyPokemon } from '../fixtures/ownerOnlyGame'
import { inProcessPortal, PORTAL } from './cloudHelpers'
import { databaseAt, seededDb } from './helpers'

withOwnerOnlyPokemon()

const T1 = new Date('2026-10-25T11:00:00.000Z')
const T2 = new Date('2026-10-25T12:00:00.000Z')
const T3 = new Date('2026-10-25T13:00:00.000Z')
const NOW = (): Date => new Date('2026-10-25T20:00:00.000Z')

interface PrintingRow {
  id: number
  card_id: number
  image_id: number
}

/** The first printing of the first `n` cards of a game, one per card. */
const printings = (db: Database.Database, n = 2, game = 'ygo'): PrintingRow[] =>
  db
    .prepare(
      `SELECT MIN(p.id) AS id, p.card_id, MIN(i.image_id) AS image_id FROM card_printings p
       JOIN card_images i ON i.card_id = p.card_id WHERE p.game = ?
       GROUP BY p.card_id ORDER BY p.card_id LIMIT ?`
    )
    .all(game, n) as PrintingRow[]

const rows = (db: Database.Database): Record<string, unknown>[] =>
  db
    .prepare('SELECT owner_id, card_id, game, deleted_at, dirty FROM favourites ORDER BY card_id')
    .all() as Record<string, unknown>[]

describe('favourites repo', () => {
  let db: Database.Database
  let a: PrintingRow
  let b: PrintingRow

  beforeEach(async () => {
    db = await seededDb()
    ;[a, b] = printings(db)
  })

  it('migration 37 stays desktop-only and keeps what was there', () => {
    const at = MIGRATIONS.findIndex((m) => m.version === 37)
    expect(MIGRATIONS[at]).toMatchObject({ version: 37, server: false })
    const old = databaseAt(34)
    old
      .prepare(
        `INSERT INTO wishlist_entries (owner_id, pkey, game, quantity, created_at, updated_at) VALUES (0, 'k', 'ygo', 2, 't', 't')`
      )
      .run()
    MIGRATIONS.filter((m) => m.version === 37).forEach((m) => old.exec(m.sql))
    expect(old.prepare('SELECT COUNT(*) AS n FROM wishlist_entries').get()).toEqual({ n: 1 })
    expect(old.prepare('SELECT COUNT(*) AS n FROM favourites').get()).toEqual({ n: 0 })
    old.close()
  })

  it('hearts a card once, unhearts it as a tombstone, and hearts it again', () => {
    setFavourite(db, a.card_id, true, T1)
    setFavourite(db, a.card_id, true, T2)
    expect(listFavourites(db)).toEqual([a.card_id])
    expect(rows(db)).toEqual([
      { owner_id: 0, card_id: a.card_id, game: 'ygo', deleted_at: null, dirty: 1 }
    ])
    expect(db.prepare('SELECT updated_at FROM favourites').get()).toEqual({
      updated_at: T1.toISOString()
    })
    setFavourite(db, a.card_id, false, T2)
    expect(listFavourites(db)).toEqual([])
    expect(rows(db)).toEqual([expect.objectContaining({ deleted_at: T2.toISOString() })])
    setFavourite(db, a.card_id, true, T3)
    expect(listFavourites(db)).toEqual([a.card_id])
  })

  it('refuses an unknown card or a non-boolean', () => {
    expect(() => setFavourite(db, 999_999_999, true, T1)).toThrow('not found')
    expect(() => setFavourite(db, a.card_id, 'yes', T1)).toThrow('true or false')
    // Unhearting a card that isn't hearted writes nothing.
    setFavourite(db, a.card_id, false, T1)
    expect(rows(db)).toEqual([])
  })

  it('favourites are per game', () => {
    seedPokemon(db)
    setFavourite(db, a.card_id, true, T1)
    setMeta(db, 'active_game', 'pkm')
    expect(listFavourites(db)).toEqual([])
    const [pk] = printings(db, 1, 'pkm')
    setFavourite(db, pk.card_id, true, T1)
    expect(listFavourites(db)).toEqual([pk.card_id])
    // A card of the other game isn't this game's to heart.
    expect(() => setFavourite(db, a.card_id, true, T1)).toThrow('not found')
  })

  it('the Favourites filter limits the collection and Browse, every printing of the card included', () => {
    for (const p of [a, b]) addEntry(db, { printingId: p.id, imageId: p.image_id, quantity: 1 }, T1)
    setFavourite(db, a.card_id, true, T1)
    const all = listEntries(db, { sort: 'name', dir: 'asc' })
    const hearted = listEntries(db, { sort: 'name', dir: 'asc', favourites: true })
    expect(all.length).toBeGreaterThan(hearted.length)
    expect(new Set(hearted.map((e) => e.card.id))).toEqual(new Set([a.card_id]))
    const browsed = browseCards(db, { sort: 'name', dir: 'asc', favourites: true })
    expect(browsed.cards.map((c) => c.id)).toEqual([a.card_id])
    // Off (or anything but true), the filter does nothing.
    expect(listEntries(db, { sort: 'name', dir: 'asc', favourites: false })).toHaveLength(
      all.length
    )
  })

  it('a favourite outlives its card leaving the catalog and shows again when it returns', () => {
    setFavourite(db, a.card_id, true, T1)
    db.pragma('foreign_keys = OFF')
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(a.card_id) as Record<
      string,
      unknown
    >
    db.prepare('DELETE FROM cards WHERE id = ?').run(a.card_id)
    expect(rows(db)).toHaveLength(1)
    const cols = Object.keys(card)
    db.prepare(
      `INSERT INTO cards (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    ).run(...cols.map((c) => card[c]))
    expect(listFavourites(db)).toEqual([a.card_id])
  })

  it('never-signed-in favourites count as local data and move to the first account, dirty', () => {
    expect(hasLocalData(db)).toBe(false)
    setFavourite(db, a.card_id, true, T1)
    expect(hasLocalData(db)).toBe(true)
    adoptLocalData(db, 7)
    expect(rows(db)).toEqual([expect.objectContaining({ owner_id: 7, dirty: 1 })])
  })
})

describe('favourites sync', () => {
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
      .prepare('SELECT card_id, game, deleted_at FROM favourites WHERE user_id = ?')
      .all(user) as Record<string, unknown>[]

  beforeEach(async () => {
    portal = await inProcessPortal()
    user = portal.addUser('owner')
    a = await device()
    ;[p] = printings(a, 1)
  })

  it('pushes a heart, reaches a fresh install, and an unheart follows', async () => {
    setFavourite(a, p.card_id, true, T1)
    await sync(a)
    expect(server()).toEqual([{ card_id: p.card_id, game: 'ygo', deleted_at: null }])
    expect(rows(a)).toEqual([expect.objectContaining({ dirty: 0 })])

    const b = await device()
    await sync(b)
    expect(listFavourites(b)).toEqual([p.card_id])
    expect(rows(b)).toEqual([expect.objectContaining({ dirty: 0 })])

    setFavourite(a, p.card_id, false, T2)
    await sync(a)
    await sync(b)
    expect(listFavourites(b)).toEqual([])
    // The server keeps the tombstone for other devices; each device forgets it once it's clean.
    expect(server()).toEqual([expect.objectContaining({ deleted_at: T2.toISOString() })])
    expect(rows(a)).toEqual([])
    expect(rows(b)).toEqual([])
  })

  it('the latest edit wins between two devices', async () => {
    const b = await device()
    setFavourite(a, p.card_id, true, T1)
    await sync(a)
    await sync(b)
    // b unhearts later than a hearts again; whichever syncs first, b's edit stands.
    setFavourite(b, p.card_id, false, T3)
    setFavourite(a, p.card_id, false, T2)
    setFavourite(a, p.card_id, true, T2)
    await sync(b)
    await sync(a)
    await sync(b)
    expect(listFavourites(a)).toEqual([])
    expect(listFavourites(b)).toEqual([])
  })

  it('a portal without favourites (404) leaves them queued and the run whole', async () => {
    const calls: string[] = []
    const old = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      const path = new URL(req.url).pathname
      if (path.startsWith('/api/sync/favourites')) {
        calls.push(path)
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        })
      }
      return portal.fetch(req)
    }) as typeof fetch
    setFavourite(a, p.card_id, true, T1)
    const client = createCloudClient({
      baseUrl: PORTAL,
      token: await portal.desktopToken(user),
      fetch: old
    })
    await expect(syncOnce(a, user, client, NOW)).resolves.toBeDefined()
    expect(calls).toEqual(['/api/sync/favourites-pull'])
    expect(rows(a)).toEqual([expect.objectContaining({ dirty: 1 })])
    await sync(a)
    expect(server()).toHaveLength(1)
  })
})
