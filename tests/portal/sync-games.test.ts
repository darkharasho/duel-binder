import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import type {
  PriceChangesResponse,
  PricesResponse,
  PullResponse,
  PushResult,
  WireEntry
} from '../../src/shared/cloud'
import { addUser, seededServerDb, memoryBucket, noPrintingArt, noPrices } from './helpers'
import { seedPokemon } from '../fixtures/pokemon'
import { withOwnerOnlyPokemon } from '../fixtures/ownerOnlyGame'

withOwnerOnlyPokemon()

const BASE = 'https://portal.test'
const NOW = new Date('2026-10-24T12:00:00.000Z')
const T0 = '2026-10-24T10:00:00.000Z'
const T1 = '2026-10-24T11:00:00.000Z'
const OWNER_DISCORD = '999'
const OWNER = 'Bearer owner-desktop'
const BOB = 'Bearer bob-desktop'

interface Printing {
  id: number
  pkey: string
  imageId: number
}

describe('per-game sync', () => {
  let db: Database.Database
  let deps: AppDeps
  let owner: number
  let bob: number
  let ygo: Printing
  let pkm: Printing

  const session = (userId: number, bearer: string): void => {
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)"
    ).run(
      createHash('sha256').update(bearer.slice('Bearer '.length)).digest('hex'),
      userId,
      NOW.toISOString(),
      new Date(NOW.getTime() + 86_400_000).toISOString()
    )
  }

  const printing = (game: string): Printing =>
    db
      .prepare(
        `SELECT p.id, p.pkey, i.image_id AS imageId FROM card_printings p
         JOIN card_images i ON i.card_id = p.card_id
         WHERE p.game = ? AND p.language = 'en' ORDER BY p.id, i.sort_order LIMIT 1`
      )
      .get(game) as Printing

  const entry = (p: Printing, overrides: Partial<WireEntry> = {}): WireEntry => ({
    uid: crypto.randomUUID(),
    pkey: p.pkey,
    imageId: p.imageId,
    quantity: 1,
    notes: '',
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    ...overrides
  })

  const send = (path: string, auth: string, init: RequestInit = {}): Promise<Response> =>
    handle(
      new Request(BASE + path, {
        ...init,
        headers: { 'content-type': 'application/json', authorization: auth }
      }),
      deps
    )
  const push = async (entries: WireEntry[], auth = OWNER): Promise<PushResult[]> => {
    const res = await send('/api/sync/push', auth, {
      method: 'POST',
      body: JSON.stringify({ entries })
    })
    expect(res.status).toBe(200)
    return ((await res.json()) as { results: PushResult[] }).results
  }
  const pull = async (query: string, auth = OWNER): Promise<PullResponse> => {
    const res = await send(`/api/sync/pull?${query}`, auth)
    expect(res.status).toBe(200)
    return (await res.json()) as PullResponse
  }
  const serverRow = (uid: string): { game: string; quantity: number } | undefined =>
    db.prepare('SELECT game, quantity FROM collection_entries WHERE uid = ?').get(uid) as
      | { game: string; quantity: number }
      | undefined

  beforeEach(async () => {
    db = await seededServerDb()
    seedPokemon(db)
    owner = addUser(db, OWNER_DISCORD, 'owner')
    bob = addUser(db, '2', 'bob')
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
        ADMIN_TOKEN: 'a',
        PRICE_WORKER_URL: 'https://prices.test',
        ADMIN_DISCORD_ID: OWNER_DISCORD
      },
      now: () => NOW,
      fetch: (() => {
        throw new Error('no network')
      }) as unknown as typeof fetch
    }
    session(owner, OWNER)
    session(bob, BOB)
    ygo = printing('ygo')
    pkm = printing('pkm')
  })

  it('stores each pushed entry under its printing’s game', async () => {
    const y = entry(ygo)
    const p = entry(pkm)
    expect(await push([y, p])).toEqual([
      { uid: y.uid, status: 'applied' },
      { uid: p.uid, status: 'applied' }
    ])
    expect(serverRow(y.uid)?.game).toBe('ygo')
    expect(serverRow(p.uid)?.game).toBe('pkm')
  })

  it('a pull without a game returns only Yu-Gi-Oh!, its cursor past the Pokémon seq', async () => {
    const y = entry(ygo)
    const p = entry(pkm)
    await push([y])
    await push([p])
    const pkmSeq = (
      db.prepare('SELECT server_seq FROM collection_entries WHERE uid = ?').get(p.uid) as {
        server_seq: number
      }
    ).server_seq

    const legacy = await pull('cursor=0')
    expect(legacy.entries.map((e) => e.uid)).toEqual([y.uid])
    expect(legacy.more).toBe(false)
    expect(legacy.cursor).toBe(pkmSeq)
    // game=ygo is the same as no game.
    expect(await pull('cursor=0&game=ygo')).toEqual(legacy)
    // Nothing more once caught up.
    expect(await pull(`cursor=${legacy.cursor}`)).toEqual({
      entries: [],
      cursor: legacy.cursor,
      more: false
    })
  })

  it('a game=pkm pull from 0 returns only the Pokémon entry', async () => {
    const y = entry(ygo)
    const p = entry(pkm)
    await push([p])
    await push([y])
    const page = await pull('cursor=0&game=pkm')
    expect(page.entries.map((e) => e.uid)).toEqual([p.uid])
    expect(page.entries[0]).toMatchObject({ pkey: pkm.pkey, imageId: pkm.imageId })
    expect(page.more).toBe(false)
    // Past the later Yu-Gi-Oh! seq too.
    expect((await pull(`cursor=${page.cursor}&game=pkm`)).entries).toEqual([])
    expect((await pull('cursor=0')).entries.map((e) => e.uid)).toEqual([y.uid])
  })

  it("refuses a game the user isn't allowed, or an unknown one, with 403", async () => {
    for (const path of ['pull?cursor=0&game=pkm', 'price-changes?since=0&game=pkm']) {
      const res = await send(`/api/sync/${path}`, BOB)
      expect(res.status, path).toBe(403)
      expect(await res.json()).toEqual({ error: 'game-not-allowed' })
    }
    const res = await send('/api/sync/pull?cursor=0&game=mtg', OWNER)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'game-not-allowed' })
  })

  it('a non-owner’s Pokémon push is unknown-printing and changes nothing', async () => {
    const before = db.prepare('SELECT * FROM collection_entries ORDER BY id').all()
    const p = entry(pkm)
    expect(await push([p], BOB)).toEqual([{ uid: p.uid, status: 'unknown-printing' }])
    expect(db.prepare('SELECT * FROM collection_entries ORDER BY id').all()).toEqual(before)

    // An existing Pokémon row of the owner's isn't touched by Bob re-using its uid either.
    const mine = entry(pkm)
    await push([mine])
    expect(await push([{ ...mine, quantity: 9, updatedAt: T1 }], BOB)).toEqual([
      { uid: mine.uid, status: 'unknown-printing' }
    ])
    expect(serverRow(mine.uid)).toEqual({ game: 'pkm', quantity: 1 })
  })

  it('a legacy push and pull of a Yu-Gi-Oh! entry still work', async () => {
    const y = entry(ygo, { quantity: 3 })
    expect(await push([y], BOB)).toEqual([{ uid: y.uid, status: 'applied' }])
    expect(serverRow(y.uid)).toEqual({ game: 'ygo', quantity: 3 })
    const page = await pull('cursor=0', BOB)
    expect(page.entries).toEqual([expect.objectContaining({ ...y, seq: expect.any(Number) })])
  })

  it('records a value snapshot for each game a push touched', async () => {
    await push([entry(ygo), entry(pkm)])
    expect(
      db.prepare('SELECT game FROM value_snapshots WHERE user_id = ? ORDER BY game').all(owner)
    ).toEqual([{ game: 'pkm' }, { game: 'ygo' }])
    await push([entry(ygo)], BOB)
    expect(
      db.prepare('SELECT game FROM value_snapshots WHERE user_id = ? ORDER BY game').all(bob)
    ).toEqual([{ game: 'ygo' }])
  })

  describe('prices', () => {
    beforeEach(() => {
      const add = db.prepare(
        'INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, 1, ?)'
      )
      add.run(ygo.id, 1.5, T1)
      add.run(pkm.id, 2.5, T1)
    })
    const changes = async (query: string, auth = OWNER): Promise<PriceChangesResponse> => {
      const res = await send(`/api/sync/price-changes?${query}`, auth)
      expect(res.status).toBe(200)
      return (await res.json()) as PriceChangesResponse
    }
    const pkmSeq = (): number =>
      (
        db.prepare('SELECT price_seq FROM intl_prices WHERE printing_id = ?').get(pkm.id) as {
          price_seq: number
        }
      ).price_seq

    it('price changes are per game; the legacy feed is Yu-Gi-Oh! only and moves past Pokémon', async () => {
      const legacy = await changes('since=0')
      expect(legacy.prices.map((p) => p.pkey)).toEqual([ygo.pkey])
      expect(legacy.cursor).toBe(pkmSeq())
      expect(await changes('since=0&game=ygo')).toEqual(legacy)
      const pk = await changes('since=0&game=pkm')
      expect(pk.prices.map((p) => p.pkey)).toEqual([pkm.pkey])
    })

    it('prices leave out pkeys of games the user isn’t allowed', async () => {
      const ask = async (auth: string): Promise<string[]> => {
        const res = await send('/api/sync/prices', auth, {
          method: 'POST',
          body: JSON.stringify({ pkeys: [ygo.pkey, pkm.pkey] })
        })
        expect(res.status).toBe(200)
        return ((await res.json()) as PricesResponse).prices.map((p) => p.pkey).sort()
      }
      expect(await ask(OWNER)).toEqual([ygo.pkey, pkm.pkey].sort())
      expect(await ask(BOB)).toEqual([ygo.pkey])
    })
  })
})
