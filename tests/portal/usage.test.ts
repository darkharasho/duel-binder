import { beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { collectStats } from '../../workers/portal/src/stats'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'

const BASE = 'https://portal.test'

describe('POST /api/usage', () => {
  let db: Database.Database
  let deps: AppDeps
  let now: Date

  beforeEach(async () => {
    db = await seededServerDb()
    now = new Date('2026-10-28T12:00:00.000Z')
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
        ADMIN_TOKEN: 't',
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => now,
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
    const id = addUser(db, '111', 'alice')
    for (const [token, kind] of [
      ['tok-desk', 'desktop'],
      ['tok-web', 'web']
    ])
      db.prepare(
        'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
      ).run(
        createHash('sha256').update(token).digest('hex'),
        id,
        kind,
        '2026-10-01T00:00:00.000Z',
        '2027-10-01T00:00:00.000Z'
      )
  })

  const post = (
    body: unknown,
    headers: Record<string, string> = { authorization: 'Bearer tok-desk' }
  ): Promise<Response> =>
    handle(
      new Request(BASE + '/api/usage', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body)
      }),
      deps
    )
  const rows = (): unknown[] =>
    db.prepare('SELECT * FROM usage_daily ORDER BY platform, event').all()

  it('adds the counts to the day, by platform, with nothing about the user', async () => {
    expect((await post({ platform: 'desktop', events: { open: 1, 'page:sets': 3 } })).status).toBe(
      204
    )
    expect((await post({ platform: 'desktop', events: { 'page:sets': 2 } })).status).toBe(204)
    const web = await post(
      { platform: 'web', events: { open: 1 } },
      { cookie: 'session=tok-web', origin: BASE }
    )
    expect(web.status).toBe(204)
    expect(rows()).toEqual([
      { day: '2026-10-28', platform: 'desktop', event: 'open', count: 1 },
      { day: '2026-10-28', platform: 'desktop', event: 'page:sets', count: 5 },
      { day: '2026-10-28', platform: 'web', event: 'open', count: 1 }
    ])
    const cols = (db.prepare('PRAGMA table_info(usage_daily)').all() as { name: string }[]).map(
      (c) => c.name
    )
    expect(cols).toEqual(['day', 'platform', 'event', 'count'])

    const usage = (collectStats(deps) as { usage: Record<string, unknown> }).usage
    expect(usage.opensByDay).toEqual([{ day: '2026-10-28', count: 2 }])
    expect(usage.totals).toContainEqual({ event: 'page:sets', platform: 'desktop', count: 5 })
  })

  it('needs a session, and the web cookie only from the app origin', async () => {
    expect((await post({ platform: 'web', events: { open: 1 } }, {})).status).toBe(401)
    expect(
      (await post({ platform: 'web', events: { open: 1 } }, { cookie: 'session=tok-web' })).status
    ).toBe(403)
    expect(rows()).toEqual([])
  })

  it('refuses events, platforms and counts outside the fixed list', async () => {
    for (const body of [
      { platform: 'desktop', events: { 'card:name:Dark Magician': 1 } },
      { platform: 'tv', events: { open: 1 } },
      { platform: 'desktop', events: { open: 0 } },
      { platform: 'desktop', events: { open: 1001 } },
      { platform: 'desktop', events: { open: 1.5 } },
      { platform: 'desktop', events: [] },
      null
    ])
      expect((await post(body)).status).toBe(400)
    expect(rows()).toEqual([])
  })

  it('caps how often one account reports', async () => {
    for (let i = 0; i < 30; i++)
      expect((await post({ platform: 'desktop', events: { open: 1 } })).status).toBe(204)
    expect((await post({ platform: 'desktop', events: { open: 1 } })).status).toBe(429)
    now = new Date(now.getTime() + 61 * 60 * 1000)
    expect((await post({ platform: 'desktop', events: { open: 1 } })).status).toBe(204)
  })
})
