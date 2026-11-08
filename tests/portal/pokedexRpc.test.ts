import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { addUser, seededServerDb, memoryBucket, noPrintingArt, noPrices } from './helpers'

const BASE = 'https://portal.test'
const NOW = new Date('2026-11-01T12:00:00.000Z')

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('pokedex RPC', () => {
  let db: Database.Database
  let deps: AppDeps
  let cookie: string

  const rpc = (channel: string, args: unknown[]): Promise<Response> =>
    handle(
      new Request(`${BASE}/api/rpc/${channel}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ args })
      }),
      deps
    )
  const result = async (channel: string, args: unknown[]): Promise<unknown> => {
    const res = await rpc(channel, args)
    expect(res.status).toBe(200)
    return ((await res.json()) as { result: unknown }).result
  }

  beforeEach(async () => {
    db = await seededServerDb()
    const alice = addUser(db, '1', 'alice')
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(
      await sha256Hex('ta'),
      alice,
      NOW.toISOString(),
      new Date(NOW.getTime() + 3600_000).toISOString()
    )
    cookie = 'session=ta'
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
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => NOW,
      fetch: (() => {
        throw new Error('no network')
      }) as unknown as typeof fetch
    }
  })

  it('answers summary and species for a signed-in caller', async () => {
    expect(await result('pokedex:summary', [])).toEqual({ caught: [] })
    expect(await result('pokedex:species', [25])).toEqual({ dexNo: 25, owned: [], missing: [] })
  })

  it('answers 400 to a bad species number', async () => {
    for (const arg of [0, 1026, '6', 1.5])
      expect([arg, (await rpc('pokedex:species', [arg])).status]).toEqual([arg, 400])
  })
})
