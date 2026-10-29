import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { addEntry } from '../../src/main/repo/collection'
import { userScope } from '../../workers/portal/src/scope'
import { GAME_HEADER } from '../../src/shared/cloud'
import { addUser, seededServerDb, memoryBucket, noPrintingArt, noPrices } from './helpers'
import { seedPokemon } from '../fixtures/pokemon'

const BASE = 'https://portal.test'
const NOW = new Date('2026-10-24T12:00:00.000Z')
const OWNER_DISCORD = '999'
const F = { sort: 'added', dir: 'desc' }

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('per-user game access', () => {
  let db: Database.Database
  let deps: AppDeps
  let owner: number
  let bob: number
  let co: string
  let cb: string
  let pkm: ReturnType<typeof seedPokemon>

  async function sessionFor(userId: number, token: string): Promise<string> {
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(
      await sha256Hex(token),
      userId,
      NOW.toISOString(),
      new Date(NOW.getTime() + 3600_000).toISOString()
    )
    return `session=${token}`
  }

  const rpc = (
    channel: string,
    args: unknown[],
    cookie: string,
    game?: string
  ): Promise<Response> => {
    const headers: Record<string, string> = { 'content-type': 'application/json', cookie }
    if (game !== undefined) headers[GAME_HEADER] = game
    return handle(
      new Request(`${BASE}/api/rpc/${channel}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ args })
      }),
      deps
    )
  }

  const meFor = async (cookie: string): Promise<{ games?: string[]; admin?: true }> => {
    const res = await handle(new Request(`${BASE}/api/me`, { headers: { cookie } }), deps)
    expect(res.status).toBe(200)
    return (await res.json()) as { games?: string[]; admin?: true }
  }

  const ygoInput = (): { printingId: number; imageId: number; quantity: number } => {
    const p = db
      .prepare(
        "SELECT id, card_id FROM card_printings WHERE language = 'en' AND game = 'ygo' ORDER BY id LIMIT 1"
      )
      .get() as { id: number; card_id: number }
    const img = db
      .prepare(
        'SELECT image_id FROM card_images WHERE card_id = ? ORDER BY sort_order, image_id LIMIT 1'
      )
      .get(p.card_id) as { image_id: number }
    return { printingId: p.id, imageId: img.image_id, quantity: 2 }
  }

  const pkmInput = (
    quantity: number
  ): { printingId: number; imageId: number; quantity: number } => ({
    printingId: pkm.printingIds[0],
    imageId: pkm.cardIds[0],
    quantity
  })

  beforeEach(async () => {
    db = await seededServerDb()
    pkm = seedPokemon(db)
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
    co = await sessionFor(owner, 'to')
    cb = await sessionFor(bob, 'tb')
  })

  it('/api/me lists Pokémon only for the ADMIN_DISCORD_ID account', async () => {
    expect((await meFor(co)).games).toEqual(['ygo', 'pkm'])
    expect((await meFor(cb)).games).toEqual(['ygo'])
  })

  it('/api/me lists only Yu-Gi-Oh! when no owner is configured', async () => {
    delete deps.env.ADMIN_DISCORD_ID
    expect((await meFor(co)).games).toEqual(['ygo'])
  })

  it("refuses a game the caller isn't allowed with 403", async () => {
    for (const channel of ['collection:list', 'cards:search', 'collection:add', 'stats:get']) {
      const res = await rpc(channel, [channel === 'cards:search' ? 'pika' : F], cb, 'pkm')
      expect(res.status, channel).toBe(403)
      expect(await res.json()).toEqual({ error: 'game-not-allowed' })
    }
    // Nothing was written by the refused add.
    expect(db.prepare('SELECT COUNT(*) AS n FROM collection_entries').get()).toEqual({ n: 0 })
  })

  it('refuses an unknown game with the same 403, even for the owner', async () => {
    for (const game of ['mtg', 'YGO', "ygo' OR 1 --"]) {
      const res = await rpc('collection:list', [F], co, game)
      expect(res.status, game).toBe(403)
      expect(await res.json()).toEqual({ error: 'game-not-allowed' })
    }
  })

  it("serves the owner's Pokémon collection only under the pkm header", async () => {
    addEntry(db, ygoInput(), NOW, userScope(owner, 'ygo'))
    addEntry(db, pkmInput(5), NOW, userScope(owner, 'pkm'))

    const poke = (await (await rpc('collection:list', [F], co, 'pkm')).json()) as {
      result: { card: { id: number }; quantity: number }[]
    }
    expect(poke.result.map((e) => [e.card.id, e.quantity])).toEqual([[pkm.cardIds[0], 5]])

    const ygo = (await (await rpc('collection:list', [F], co, 'ygo')).json()) as {
      result: { quantity: number }[]
    }
    expect(ygo.result.map((e) => e.quantity)).toEqual([2])
  })

  it('writes with the header game', async () => {
    const res = await rpc('collection:add', [pkmInput(3)], co, 'pkm')
    expect(res.status).toBe(200)
    expect(db.prepare('SELECT game, quantity FROM collection_entries').all()).toEqual([
      { game: 'pkm', quantity: 3 }
    ])
  })

  it('treats a missing or empty header as Yu-Gi-Oh!, as before', async () => {
    addEntry(db, ygoInput(), NOW, userScope(bob, 'ygo'))
    addEntry(db, pkmInput(5), NOW, userScope(bob, 'pkm'))
    for (const game of [undefined, '']) {
      const res = await rpc('collection:list', [F], cb, game)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { result: { quantity: number }[] }
      expect(body.result.map((e) => e.quantity)).toEqual([2])
    }
  })

  describe("friends' binders", () => {
    beforeEach(async () => {
      await rpc('friends:request', ['bob'], co)
      await rpc('friends:accept', [owner], cb)
      addEntry(db, ygoInput(), NOW, userScope(bob, 'ygo'))
      addEntry(db, pkmInput(4), NOW, userScope(bob, 'pkm'))
      addEntry(db, ygoInput(), NOW, userScope(owner, 'ygo'))
      addEntry(db, pkmInput(7), NOW, userScope(owner, 'pkm'))
    })

    it("show the caller's header game, whatever the friend may see", async () => {
      const poke = (await (await rpc('friends:collection', [bob, F], co, 'pkm')).json()) as {
        result: { quantity: number }[]
      }
      expect(poke.result.map((e) => e.quantity)).toEqual([4])
      const ygo = (await (await rpc('friends:collection', [bob, F], co)).json()) as {
        result: { quantity: number }[]
      }
      expect(ygo.result.map((e) => e.quantity)).toEqual([2])
      const facets = await rpc('friends:facets', [bob], co, 'pkm')
      expect(facets.status).toBe(200)
    })

    it("refuse a game the caller isn't allowed", async () => {
      for (const channel of ['friends:collection', 'friends:facets']) {
        const res = await rpc(
          channel,
          channel === 'friends:facets' ? [owner] : [owner, F],
          cb,
          'pkm'
        )
        expect(res.status, channel).toBe(403)
        expect(await res.json()).toEqual({ error: 'game-not-allowed' })
      }
    })
  })
})
