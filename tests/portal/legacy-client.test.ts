import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import type {
  PriceChangesResponse,
  PullResponse,
  PushResult,
  WireEntry
} from '../../src/shared/cloud'
import type { CatalogChangesResponse } from '../../src/shared/catalogFeed'
import { addUser, seededServerDb, memoryBucket, noPrintingArt, noPrices } from './helpers'
import { seedPokemon } from '../fixtures/pokemon'

const BASE = 'https://portal.test'
const NOW = new Date('2026-10-24T12:00:00.000Z')
const T0 = '2026-10-24T10:00:00.000Z'
const T1 = '2026-10-24T11:00:00.000Z'
const OWNER_DISCORD = '999'
const AUTH = 'Bearer owner-desktop'

interface Printing {
  id: number
  pkey: string
  imageId: number
}

/**
 * A v0.20 client against the multi-game portal: no `game` parameter, no `x-duel-game` header.
 * The account is the owner's (allowed Pokémon), and holds entries in both games.
 */
describe('v0.20 client against the multi-game portal', () => {
  it('sees only Yu-Gi-Oh! and leaves Pokémon entries untouched', async () => {
    const db = await seededServerDb()
    seedPokemon(db)
    const owner = addUser(db, OWNER_DISCORD, 'owner')
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)"
    ).run(
      createHash('sha256').update('owner-desktop').digest('hex'),
      owner,
      NOW.toISOString(),
      '2099-01-01T00:00:00.000Z'
    )
    const deps = {
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
    } as unknown as AppDeps
    const send = (path: string, init: RequestInit = {}): Promise<Response> =>
      handle(
        new Request(BASE + path, {
          ...init,
          headers: { 'content-type': 'application/json', authorization: AUTH }
        }),
        deps
      )
    const printing = (game: string): Printing =>
      db
        .prepare(
          `SELECT p.id, p.pkey, i.image_id AS imageId FROM card_printings p
           JOIN card_images i ON i.card_id = p.card_id
           WHERE p.game = ? AND p.language = 'en' ORDER BY p.id, i.sort_order LIMIT 1`
        )
        .get(game) as Printing
    const entry = (p: Printing): WireEntry => ({
      uid: crypto.randomUUID(),
      pkey: p.pkey,
      imageId: p.imageId,
      quantity: 1,
      notes: '',
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null
    })
    const push = async (entries: WireEntry[]): Promise<PushResult[]> => {
      const res = await send('/api/sync/push', { method: 'POST', body: JSON.stringify({ entries }) })
      expect(res.status).toBe(200)
      return ((await res.json()) as { results: PushResult[] }).results
    }
    const ygo = printing('ygo')
    const pkm = printing('pkm')

    // The owner's account holds one entry in each game (Pokémon pushed by a newer client).
    const y = entry(ygo)
    const p = entry(pkm)
    await push([y, p])
    db.prepare('INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, 1, ?)')
      .run(ygo.id, 1.5, T1)
    db.prepare('INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, 1, ?)')
      .run(pkm.id, 2.5, T1)
    const pkmRows = (): unknown[] =>
      db
        .prepare("SELECT * FROM collection_entries WHERE game = 'pkm' ORDER BY id")
        .all()
    const pkmBefore = pkmRows()
    expect(pkmBefore).toHaveLength(1)

    // Pull: Yu-Gi-Oh! only, in today's shape (no game field), cursor past the Pokémon seq.
    const pulled = (await (await send('/api/sync/pull?cursor=0')).json()) as PullResponse
    expect(pulled.entries.map((e) => e.uid)).toEqual([y.uid])
    expect(Object.keys(pulled.entries[0]).sort()).toEqual(
      [...Object.keys(y), 'seq'].sort()
    )
    expect(pulled.more).toBe(false)
    const pkmSeq = (
      db.prepare('SELECT server_seq FROM collection_entries WHERE uid = ?').get(p.uid) as {
        server_seq: number
      }
    ).server_seq
    expect(pulled.cursor).toBe(pkmSeq)

    // Push: an edit to the Yu-Gi-Oh! entry.
    expect(await push([{ ...y, quantity: 4, updatedAt: T1 }])).toEqual([
      { uid: y.uid, status: 'applied' }
    ])
    const again = (await (await send(`/api/sync/pull?cursor=${pulled.cursor}`)).json()) as PullResponse
    expect(again.entries.map((e) => [e.uid, e.quantity])).toEqual([[y.uid, 4]])

    // Price changes: Yu-Gi-Oh! only.
    const prices = (await (await send('/api/sync/price-changes?since=0')).json()) as PriceChangesResponse
    expect(prices.prices.map((x) => x.pkey)).toEqual([ygo.pkey])

    // Catalog feed: no Pokémon rows, no game field.
    const feedRes = await send('/api/catalog/changes?since=0')
    expect(feedRes.status).toBe(200)
    const feedText = await feedRes.text()
    const feed = JSON.parse(feedText) as CatalogChangesResponse
    expect(feed).toBeTruthy()
    expect(feedText).not.toContain('"game"')
    expect(feedText).not.toContain('Pikachu')
    expect(feedText).not.toContain('ピカチュウ')

    // The Pokémon entry is exactly as it was: same server_seq, not deleted.
    expect(pkmRows()).toEqual(pkmBefore)
  })
})
