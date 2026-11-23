import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import type { EmailMessage } from '../../workers/portal/src/emailSend'
import { DAILY_REPORT_LIMIT, REPORTS_TO } from '../../workers/portal/src/reports'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'

const BASE = 'https://portal.test'
const NOW = new Date('2026-11-22T12:00:00.000Z')
const sha = (t: string): string => createHash('sha256').update(t).digest('hex')

describe('user reports', () => {
  let db: Database.Database
  let deps: AppDeps
  let sent: EmailMessage[]
  let now: Date
  let alice: number
  let bob: number
  let carol: number

  const session = (userId: number, token: string): void => {
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)"
    ).run(sha(token), userId, '2026-11-01T00:00:00.000Z', '2027-11-01T00:00:00.000Z')
  }

  const req = (path: string, token: string, body?: unknown): Promise<Response> =>
    handle(
      new Request(BASE + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      }),
      deps
    )
  const call = async (
    channel: string,
    args: unknown[],
    token = 'ta'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ status: number; body: any }> => {
    const res = await req(`/api/rpc/${channel}`, token, { args })
    return { status: res.status, body: await res.json() }
  }
  const rows = (): Record<string, unknown>[] =>
    db.prepare('SELECT * FROM user_reports ORDER BY id').all() as Record<string, unknown>[]

  beforeEach(async () => {
    db = await seededServerDb()
    sent = []
    now = NOW
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
        ADMIN_DISCORD_ID: '999',
        PRICE_WORKER_URL: 'https://prices.test'
      },
      email: { send: async (m) => void sent.push(m) },
      now: () => now,
      fetch: (() => {
        throw new Error('no network')
      }) as unknown as typeof fetch
    }
    alice = addUser(db, '1', 'alice')
    bob = addUser(db, '2', 'bob')
    carol = addUser(db, '3', 'carol')
    session(alice, 'ta')
    session(bob, 'tb')
    session(addUser(db, '999', 'owner'), 'to')
    await call('friends:request', ['bob'], 'ta')
    await call('friends:accept', [alice], 'tb')
  })

  it('saves a report about a friend and emails it to support', async () => {
    const r = await call('friends:report', [bob, { reason: 'photo', note: '  rude pic <b> ' }])
    expect(r.status).toBe(200)
    expect(rows()).toEqual([
      expect.objectContaining({
        reporter_id: alice,
        reporter_name: 'alice',
        reported_id: bob,
        reported_name: 'bob',
        reason: 'photo',
        note: 'rude pic <b>',
        created_at: NOW.toISOString(),
        handled_at: null
      })
    ])
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe(REPORTS_TO)
    expect(sent[0].subject).toBe('Report: @bob (Inappropriate photos)')
    expect(sent[0].text).toContain('@alice reported @bob')
    expect(sent[0].text).toContain(`${BASE}/admin#reports`)
    expect(sent[0].html).toContain('rude pic &lt;b&gt;')
    // Not blocked unless asked.
    expect((await call('friends:overview', [])).body.result.friends).toHaveLength(1)
  })

  it('blocks them too when asked', async () => {
    expect(
      (await call('friends:report', [bob, { reason: 'harassment', block: true }])).status
    ).toBe(200)
    const o = (await call('friends:overview', [])).body.result
    expect(o.friends).toEqual([])
    expect(o.blocked.map((u: { username: string }) => u.username)).toEqual(['bob'])
  })

  it('can report someone you blocked or who sent you a request', async () => {
    await call('friends:block', [bob])
    expect((await call('friends:report', [bob, { reason: 'name' }])).status).toBe(200)
    session(carol, 'tc')
    await call('friends:request', ['alice'], 'tc')
    expect((await call('friends:report', [carol, { reason: 'other', note: 'spam' }])).status).toBe(
      200
    )
    expect(rows()).toHaveLength(2)
  })

  it('refuses strangers, yourself, unknown users and bad reports', async () => {
    const bad = async (args: unknown[], error: string): Promise<void> => {
      expect(await call('friends:report', args)).toEqual({ status: 400, body: { error } })
    }
    await bad([carol, { reason: 'name' }], "You can't report this user")
    await bad([alice, { reason: 'name' }], "You can't report yourself")
    await bad([9999, { reason: 'name' }], 'No such user')
    await bad([bob, { reason: 'mean' }], 'Pick a reason for the report')
    await bad([bob, 'name'], 'Report must be an object')
    await bad(
      [bob, { reason: 'name', note: 'x'.repeat(501) }],
      'Keep the note under 500 characters'
    )
    await bad([bob, { reason: 'name', block: 'yes' }], 'block must be true or false')
    expect(rows()).toEqual([])
    expect(sent).toEqual([])
  })

  it(`allows ${DAILY_REPORT_LIMIT} reports a day`, async () => {
    for (let i = 0; i < DAILY_REPORT_LIMIT; i++)
      expect((await call('friends:report', [bob, { reason: 'other' }])).status).toBe(200)
    expect((await call('friends:report', [bob, { reason: 'other' }])).status).toBe(400)
    now = new Date(NOW.getTime() + 24 * 3600_000 + 1)
    expect((await call('friends:report', [bob, { reason: 'other' }])).status).toBe(200)
  })

  it('keeps the report when the email fails', async () => {
    deps.email = {
      send: async () => {
        throw new Error('down')
      }
    }
    expect((await call('friends:report', [bob, { reason: 'name' }])).status).toBe(200)
    expect(rows()).toHaveLength(1)
  })

  it('lists reports for the owner and marks them handled', async () => {
    await call('friends:report', [bob, { reason: 'name', note: 'n' }])
    expect((await req('/admin/reports', 'ta')).status).toBe(404)
    const list = async (): Promise<{ reports: Record<string, unknown>[] }> =>
      (await req('/admin/reports', 'to')).json() as never
    const [r] = (await list()).reports
    expect(r).toMatchObject({
      reporterName: 'alice',
      reportedName: 'bob',
      reportedId: bob,
      reason: 'name',
      note: 'n',
      handledAt: null
    })
    expect((await req('/admin/reports/handle', 'ta', { id: r.id })).status).toBe(404)
    expect((await req('/admin/reports/handle', 'to', { id: r.id })).status).toBe(200)
    expect((await list()).reports[0].handledAt).toBe(NOW.toISOString())
    expect((await req('/admin/reports/handle', 'to', { id: r.id, handled: false })).status).toBe(
      200
    )
    expect((await list()).reports[0].handledAt).toBeNull()
    expect((await req('/admin/reports/handle', 'to', { id: 'x' })).status).toBe(400)
    expect((await req('/admin/reports/handle', 'to', { id: 12345 })).status).toBe(404)
  })
})
