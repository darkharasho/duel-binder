import { beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AdminCosts } from '../../src/shared/costs'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { collectCosts, flushCosts } from '../../workers/portal/src/costs'
import { createCostMeter, type CostMeter } from '../../workers/portal/src/meter'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'

const BASE = 'https://portal.test'
const TOKEN = 'admin-secret'

describe('request costs', () => {
  let db: Database.Database
  let deps: AppDeps
  let now: Date
  let meter: CostMeter

  beforeEach(async () => {
    db = await seededServerDb()
    now = new Date('2026-11-16T12:00:00.000Z')
    meter = createCostMeter(() => now.getTime())
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
        ADMIN_TOKEN: TOKEN,
        PRICE_WORKER_URL: 'https://prices.test'
      },
      meter,
      storageBytes: () => 2e9,
      now: () => now,
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
  })

  const row = (day: string, userId: number, area: string, rowsRead: number, rowsWritten = 0) => ({
    day,
    userId,
    area,
    requests: 10,
    rowsRead,
    rowsWritten,
    ms: 1000
  })

  function addSession(userId: number, token: string): void {
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)"
    ).run(
      createHash('sha256').update(token).digest('hex'),
      userId,
      '2026-10-01T00:00:00.000Z',
      '2027-10-01T00:00:00.000Z'
    )
  }

  it('adds flushed totals onto the day’s row and prunes rows older than 90 days', () => {
    db.prepare(
      "INSERT INTO request_costs (day, user_id, area, requests, rows_read, rows_written, ms) VALUES ('2026-08-01', 0, 'img', 1, 1, 1, 1)"
    ).run()
    flushCosts(db, [row('2026-11-16', 1, 'api/sync', 100, 5)], now)
    flushCosts(db, [row('2026-11-16', 1, 'api/sync', 50, 1)], now)
    expect(db.prepare('SELECT * FROM request_costs').all()).toEqual([
      {
        day: '2026-11-16',
        user_id: 1,
        area: 'api/sync',
        requests: 20,
        rows_read: 150,
        rows_written: 6,
        ms: 2000
      }
    ])
  })

  it('splits people from system work and scales one user to a month', () => {
    const a = addUser(db, '111', 'alice')
    const b = addUser(db, '222', 'bob')
    flushCosts(
      db,
      [
        row('2026-11-15', a, 'api/sync', 1000, 10),
        row('2026-11-16', a, 'rpc sets:list', 3000),
        row('2026-11-16', b, 'api/sync', 2000, 10),
        row('2026-11-16', 0, 'admin/catalog', 9000, 500),
        // Outside the 7-day window.
        row('2026-11-01', b, 'api/sync', 1e9)
      ],
      now
    )
    const c = collectCosts(deps, 7)
    expect(c.since).toBe('2026-11-10')
    expect(c.days).toBe(2)
    expect(c.activeUsers).toBe(2)
    expect(c.people).toEqual({ requests: 30, rowsRead: 6000, rowsWritten: 20, ms: 3000 })
    expect(c.system).toEqual({ requests: 10, rowsRead: 9000, rowsWritten: 500, ms: 1000 })
    // 3,000 rows read per user over 2 days → 45,000 in 30 days.
    expect(c.perUserMonth).toEqual({
      requests: 225,
      rowsRead: 45_000,
      rowsWritten: 150,
      ms: 22_500
    })
    expect(c.systemMonth.rowsRead).toBe(135_000)
    expect(c.byUser.map((u) => [u.username, u.rowsRead])).toEqual([
      ['alice', 4000],
      ['bob', 2000]
    ])
    // Each user's own split, dearest area first.
    expect(c.byUser[0].areas?.map((x) => [x.area, x.rowsRead])).toEqual([
      ['rpc sets:list', 3000],
      ['api/sync', 1000]
    ])
    expect(c.byArea[0]).toMatchObject({ area: 'admin/catalog', rowsRead: 9000 })
    expect(c.byDay.map((d) => d.day)).toEqual(['2026-11-15', '2026-11-16'])
    expect(c.projections.map((p) => p.users)).toEqual([2, 100, 500, 5000])
    expect(c.storageBytes).toBe(2e9)
  })

  it('has no per-user month before anyone signed in is measured', () => {
    const c = collectCosts(deps, 30)
    expect(c.activeUsers).toBe(0)
    expect(c.perUserMonth).toBeNull()
    expect(c.projections.map((p) => p.users)).toEqual([100, 500, 5000])
  })

  it('serves GET /admin/costs to the admin token only, with what the meter holds so far', async () => {
    const a = addUser(db, '111', 'alice')
    addSession(a, 'tok-a')
    // A signed-in request, metered as the Durable Object does: its user comes from the session.
    await meter.run('api/sync', async () => {
      await handle(
        new Request(BASE + '/api/me', { headers: { authorization: 'Bearer tok-a' } }),
        deps
      )
      meter.rows(500, 0)
    })
    expect((await handle(new Request(BASE + '/admin/costs'), deps)).status).toBe(401)
    const res = await handle(
      new Request(BASE + '/admin/costs?days=7', { headers: { authorization: `Bearer ${TOKEN}` } }),
      deps
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as AdminCosts
    expect(body.byUser[0]).toMatchObject({ username: 'alice', requests: 1, rowsRead: 500 })
  })
})
