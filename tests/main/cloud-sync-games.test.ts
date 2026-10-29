import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCloudClient, CloudOfflineError, type CloudClient } from '../../src/main/cloud/client'
import { syncOnce } from '../../src/main/cloud/engine'
import { accountState, ensureAccount, saveAccountState, setActiveOwner } from '../../src/main/cloud/localSync'
import { getMeta, setMeta } from '../../src/main/db/meta'
import type {
  Me,
  PriceChangesResponse,
  PullResponse,
  PulledEntry
} from '../../src/shared/cloud'
import type { GameId } from '../../src/shared/games'
import { seedPokemon } from '../fixtures/pokemon'
import { seededDb } from './helpers'

const OWNER = 7
const NOW = (): Date => new Date('2026-10-29T12:00:00.000Z')
const T0 = '2026-10-29T10:00:00.000Z'

/** A fake portal: answers `me` with `games`, and serves per-game entry and price feeds. */
function fakeServer(feeds: {
  entries: Partial<Record<GameId, PulledEntry[]>>
  prices: Partial<Record<GameId, PriceChangesResponse['prices']>>
}): {
  client: CloudClient
  games: GameId[] | undefined
  meFails: boolean
  pulls: [number, GameId | undefined][]
  priceAsks: [number, GameId | undefined][]
} {
  const state = {
    games: ['ygo'] as GameId[] | undefined,
    meFails: false,
    pulls: [] as [number, GameId | undefined][],
    priceAsks: [] as [number, GameId | undefined][],
    client: undefined as unknown as CloudClient
  }
  state.client = {
    me: async (): Promise<Me> => {
      if (state.meFails) throw new CloudOfflineError()
      return {
        id: OWNER,
        username: 'owner',
        displayName: null,
        avatarUrl: null,
        ...(state.games ? { games: state.games } : {})
      }
    },
    push: async () => [],
    pull: async (cursor: number, game?: GameId): Promise<PullResponse> => {
      state.pulls.push([cursor, game])
      const rows = (feeds.entries[game ?? 'ygo'] ?? []).filter((e) => e.seq > cursor)
      return { entries: rows, cursor: rows.at(-1)?.seq ?? cursor, more: false }
    },
    priceChanges: async (since: number, game?: GameId): Promise<PriceChangesResponse> => {
      state.priceAsks.push([since, game])
      const rows = (feeds.prices[game ?? 'ygo'] ?? []).filter((p) => p.seq > since)
      return { prices: rows, cursor: rows.at(-1)?.seq ?? since, more: false }
    },
    prices: async () => ({ prices: [], status: null })
  } as unknown as CloudClient
  return state
}

const gameCursors = (db: Database.Database): unknown[] =>
  db
    .prepare('SELECT owner_id, game, stream, cursor FROM cloud_game_cursors ORDER BY game, stream')
    .all()

describe('per-game syncOnce', () => {
  let db: Database.Database
  let pkm: ReturnType<typeof seedPokemon>
  let pkmPkey: string

  beforeEach(async () => {
    db = await seededDb()
    pkm = seedPokemon(db)
    pkmPkey = (
      db.prepare('SELECT pkey FROM card_printings WHERE id = ?').get(pkm.printingIds[0]) as {
        pkey: string
      }
    ).pkey
    ensureAccount(db, OWNER, 'owner')
    setActiveOwner(db, OWNER)
  })
  afterEach(() => db.close())

  const pkmEntry = (seq: number): PulledEntry => ({
    uid: crypto.randomUUID(),
    pkey: pkmPkey,
    imageId: pkm.cardIds[0],
    quantity: 2,
    notes: '',
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    seq
  })

  it('keeps a cursor per game, and pulls Pokémon from 0 when it first appears', async () => {
    saveAccountState(db, OWNER, { cursor: 900 })
    setMeta(db, 'price_feed_cursor', '800')
    const e = pkmEntry(5)
    const server = fakeServer({
      entries: { pkm: [e] },
      prices: { pkm: [{ pkey: pkmPkey, price: 3, listingCount: 1, checkedAt: T0, seq: 4 }] }
    })

    await syncOnce(db, OWNER, server.client, NOW)
    expect(server.pulls).toEqual([[900, 'ygo']])
    expect(server.priceAsks).toEqual([[800, 'ygo']])
    expect(gameCursors(db)).toEqual([])

    server.games = ['ygo', 'pkm']
    server.pulls.length = 0
    server.priceAsks.length = 0
    const outcome = await syncOnce(db, OWNER, server.client, NOW)
    expect(server.pulls).toEqual([
      [900, 'ygo'],
      [0, 'pkm']
    ])
    expect(server.priceAsks).toEqual([
      [800, 'ygo'],
      [0, 'pkm']
    ])
    expect(outcome.pulled).toBe(1)
    expect(accountState(db, OWNER).cursor).toBe(900)
    expect(getMeta(db, 'price_feed_cursor')).toBe('800')
    expect(gameCursors(db)).toEqual([
      { owner_id: OWNER, game: 'pkm', stream: 'entries', cursor: 5 },
      { owner_id: OWNER, game: 'pkm', stream: 'prices', cursor: 4 }
    ])
    // The pulled entry lands under its game, and so does its price.
    expect(
      db.prepare('SELECT game, quantity FROM collection_entries WHERE uid = ?').get(e.uid)
    ).toEqual({ game: 'pkm', quantity: 2 })
    expect(
      db.prepare('SELECT price FROM intl_prices WHERE printing_id = ?').get(pkm.printingIds[0])
    ).toEqual({ price: 3 })

    server.pulls.length = 0
    server.priceAsks.length = 0
    await syncOnce(db, OWNER, server.client, NOW)
    expect(server.pulls).toEqual([
      [900, 'ygo'],
      [5, 'pkm']
    ])
    expect(server.priceAsks).toEqual([
      [800, 'ygo'],
      [4, 'pkm']
    ])
  })

  it('an old server (no games in me) or a failing me() syncs Yu-Gi-Oh! only', async () => {
    const server = fakeServer({ entries: {}, prices: {} })
    server.games = undefined
    await syncOnce(db, OWNER, server.client, NOW)
    server.meFails = true
    await syncOnce(db, OWNER, server.client, NOW)
    expect(server.pulls).toEqual([
      [0, 'ygo'],
      [0, 'ygo']
    ])
    expect(server.priceAsks).toEqual([
      [0, 'ygo'],
      [0, 'ygo']
    ])
  })

  it('the client names the game on pulls and price changes', async () => {
    const seen: string[] = []
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input))
      return new Response(JSON.stringify({ entries: [], prices: [], cursor: 0, more: false }))
    }) as unknown as typeof globalThis.fetch
    const c = createCloudClient({ baseUrl: 'https://portal.test', token: 't', fetch })
    await c.pull(3)
    await c.pull(4, 'pkm')
    await c.priceChanges(5)
    await c.priceChanges(6, 'pkm')
    expect(seen).toEqual([
      'https://portal.test/api/sync/pull?cursor=3&game=ygo',
      'https://portal.test/api/sync/pull?cursor=4&game=pkm',
      'https://portal.test/api/sync/price-changes?since=5&game=ygo',
      'https://portal.test/api/sync/price-changes?since=6&game=pkm'
    ])
  })
})
