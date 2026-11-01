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

const draft = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Mine',
  rules: { version: 1, rules: [{ field: 'name', op: 'contains', value: 'a' }] },
  goal: 'card',
  languages: [],
  friendsVisible: true,
  ...over
})

describe('binders RPC', () => {
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

  it('saves and reads a binder for the caller', async () => {
    const uid = (await result('binders:save', [draft()])) as string
    expect(typeof uid).toBe('string')
    expect(await result('binders:list', [])).toHaveLength(1)
    expect(await result('binders:get', [uid])).toMatchObject({ uid, name: 'Mine' })
    expect(await result('binders:fieldValues', ['rarity', ''])).toBeInstanceOf(Array)
    await result('binders:remove', [uid])
    expect(await result('binders:list', [])).toEqual([])
  })

  it('answers 400 to bad arguments', async () => {
    const bad: [string, unknown[]][] = [
      ['binders:save', [draft({ name: '' })]],
      [
        'binders:save',
        [draft({ rules: { version: 1, rules: [{ field: 'bogus', values: ['x'] }] } })]
      ],
      ['binders:save', [draft({ uid: 'x'.repeat(65) })]],
      ['binders:save', [draft({ uid: 5 })]],
      ['binders:save', ['nope']],
      ['binders:get', ['']],
      ['binders:get', [5]],
      ['binders:remove', ['x'.repeat(65)]],
      ['binders:edit', ['u', { level: 'set', target: '1' }, 'add']],
      ['binders:edit', ['u', { level: 'card', target: '' }, 'add']],
      ['binders:edit', ['u', { level: 'card', target: 'x'.repeat(301) }, 'add']],
      ['binders:edit', ['u', { level: 'card', target: '1' }, 'toggle']],
      ['binders:forCard', [0]],
      ['binders:fieldValues', ['bogus', '']],
      ['binders:fieldValues', ['rarity', 'x'.repeat(1000)]],
      ['binders:fieldValues', ['rarity', 5]]
    ]
    for (const [channel, args] of bad)
      expect([channel, (await rpc(channel, args)).status]).toEqual([channel, 400])
  })

  it('answers 400 to a preview of an incomplete rule', async () => {
    const res = await rpc('binders:preview', [
      draft({ rules: { version: 1, rules: [{ field: 'rarity', values: [] }] } })
    ])
    expect(res.status).toBe(400)
  })
})
