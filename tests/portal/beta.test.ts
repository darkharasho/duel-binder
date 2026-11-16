import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { pruneExpired } from '../../workers/portal/src/auth'
import type { EmailMessage } from '../../workers/portal/src/emailSend'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'

const BASE = 'https://portal.test'
const SITE = 'https://site.test'
// The owner's desktop session; the admin routes go by the signed-in account, like the Testers tab.
const TOKEN = 'tok-owner'
const OPT_IN = 'https://play.google.com/apps/internaltest/123'

describe('phone beta requests', () => {
  let db: Database.Database
  let deps: AppDeps
  let sent: EmailMessage[]

  beforeEach(async () => {
    db = await seededServerDb()
    sent = []
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
        SITE_URL: SITE,
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        ADMIN_TOKEN: 'admin-secret',
        ADMIN_DISCORD_ID: '999',
        PRICE_WORKER_URL: 'https://prices.test',
        BETA_ANDROID_OPTIN_URL: OPT_IN
      },
      email: { send: async (m) => void sent.push(m) },
      now: () => new Date('2026-11-16T12:00:00.000Z'),
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
    const owner = addUser(db, '999', 'owner')
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)"
    ).run(
      createHash('sha256').update(TOKEN).digest('hex'),
      owner,
      '2026-11-01T00:00:00.000Z',
      '2027-11-01T00:00:00.000Z'
    )
  })

  const sam = {
    agree: 'on',
    platform: 'android',
    email: ' Sam@Example.com ',
    name: 'Sam',
    referred: 'Dub'
  }

  function post(
    fields: Record<string, string>,
    origin: string | null = SITE,
    ip = '1.2.3.4'
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      'cf-connecting-ip': ip
    }
    if (origin !== null) headers.origin = origin
    return handle(
      new Request(BASE + '/beta', {
        method: 'POST',
        headers,
        body: new URLSearchParams(fields).toString()
      }),
      deps
    )
  }

  const rows = (): Record<string, unknown>[] =>
    db.prepare('SELECT * FROM beta_requests ORDER BY id').all() as Record<string, unknown>[]

  it("stores a request and sends the person back to the site's thank-you", async () => {
    const res = await post(sam)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(SITE + '/beta?sent=1')
    expect(rows()).toEqual([
      expect.objectContaining({
        email: 'sam@example.com',
        platform: 'android',
        name: 'Sam',
        referred_by: 'Dub',
        status: 'pending',
        created_at: '2026-11-16T12:00:00.000Z',
        decided_at: null
      })
    ])
  })

  it('keeps one row when the same email asks twice for the same platform', async () => {
    for (const email of ['SAM@example.com', 'sam@example.com']) {
      const res = await post({ ...sam, email })
      expect(res.headers.get('location')).toBe(SITE + '/beta?sent=1')
    }
    expect(rows()).toHaveLength(1)
    await post({ ...sam, platform: 'ios' })
    expect(rows()).toHaveLength(2)
  })

  it('sends errors back without storing', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ ...sam, agree: '' }, 'agree'],
      [{ ...sam, platform: 'web' }, 'platform'],
      [{ ...sam, email: 'nope' }, 'email'],
      [{ ...sam, email: 'a@b.co'.padStart(201, 'x') }, 'email'],
      [{ ...sam, name: '' }, 'name'],
      [{ ...sam, name: 'x'.repeat(201) }, 'name'],
      [{ ...sam, referred: 'x'.repeat(201) }, 'referred']
    ]
    for (const [fields, code] of cases) {
      const res = await post(fields)
      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe(`${SITE}/beta?error=${code}`)
    }
    const { agree: _, ...noAgree } = sam
    expect((await post(noAgree)).headers.get('location')).toBe(SITE + '/beta?error=agree')
    expect(rows()).toEqual([])
  })

  it('pretends to accept a filled honeypot', async () => {
    const res = await post({ ...sam, website: 'http://spam' })
    expect(res.headers.get('location')).toBe(SITE + '/beta?sent=1')
    expect(rows()).toEqual([])
  })

  it('refuses posts not from the site', async () => {
    expect((await post(sam, 'https://evil.test')).status).toBe(403)
    expect((await post(sam, null)).status).toBe(403)
    expect(rows()).toEqual([])
  })

  it('limits one address to five requests a day', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await post({ ...sam, email: `p${i}@example.com` })
      expect(res.headers.get('location')).toBe(SITE + '/beta?sent=1')
    }
    const res = await post({ ...sam, email: 'p5@example.com' })
    expect(res.headers.get('location')).toBe(SITE + '/beta?error=limit')
    expect(rows()).toHaveLength(5)
    // Another address is still welcome.
    const other = await post({ ...sam, email: 'q@example.com' }, SITE, '5.6.7.8')
    expect(other.headers.get('location')).toBe(SITE + '/beta?sent=1')
  })

  const admin = (path: string, body?: unknown, auth = true): Promise<Response> =>
    handle(
      new Request(BASE + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      }),
      deps
    )
  const list = async (): Promise<{
    requests: { id: number; email: string; platform: string; status: string; referredBy: string }[]
    androidAdded: number
  }> => (await admin('/admin/beta')).json() as never
  const decide = async (id: number, status: string): Promise<{ status: number; body: unknown }> => {
    const res = await admin('/admin/beta/decide', { id, status })
    return { status: res.status, body: await res.json() }
  }
  const idOf = (email: string, platform = 'android'): number =>
    (
      db
        .prepare('SELECT id FROM beta_requests WHERE email = ? AND platform = ?')
        .get(email, platform) as {
        id: number
      }
    ).id

  it('lists requests for the admin only, pending first', async () => {
    await post({ ...sam, email: 'a@example.com' })
    await post({ ...sam, email: 'b@example.com', platform: 'ios' })
    expect((await admin('/admin/beta', undefined, false)).status).toBe(404)
    await decide(idOf('a@example.com'), 'declined')
    const l = await list()
    expect(l.requests.map((r) => [r.email, r.status])).toEqual([
      ['b@example.com', 'pending'],
      ['a@example.com', 'declined']
    ])
    expect(l.requests[0]).toMatchObject({ platform: 'ios', referredBy: 'Dub' })
    expect(l.androidAdded).toBe(0)
  })

  it('marking added emails the Play link once', async () => {
    await post(sam)
    const id = idOf('sam@example.com')
    expect(await decide(id, 'added')).toEqual({ status: 200, body: { ok: true, emailed: true } })
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('sam@example.com')
    expect(sent[0].text).toContain(OPT_IN)
    expect(sent[0].html).toContain(OPT_IN)
    expect((await list()).androidAdded).toBe(1)
    expect(await decide(id, 'added')).toEqual({ status: 200, body: { ok: true, emailed: false } })
    expect(sent).toHaveLength(1)
    const row = db.prepare('SELECT status, decided_at FROM beta_requests WHERE id = ?').get(id)
    expect(row).toEqual({ status: 'added', decided_at: '2026-11-16T12:00:00.000Z' })
  })

  it('tells iPhone testers to watch for the TestFlight invite', async () => {
    await post({ ...sam, platform: 'ios' })
    await decide(idOf('sam@example.com', 'ios'), 'added')
    expect(sent[0].text).toContain('TestFlight')
    expect(sent[0].text).not.toContain(OPT_IN)
  })

  it('declining sends nothing; bad ids and statuses are refused', async () => {
    await post(sam)
    const id = idOf('sam@example.com')
    expect(await decide(id, 'declined')).toEqual({
      status: 200,
      body: { ok: true, emailed: false }
    })
    expect(sent).toEqual([])
    expect((await decide(9999, 'added')).status).toBe(404)
    expect((await decide(id, 'pending')).status).toBe(400)
    expect((await admin('/admin/beta/decide', { id, status: 'added' }, false)).status).toBe(404)
  })

  it('still marks added without an email binding', async () => {
    deps.email = undefined
    await post(sam)
    const id = idOf('sam@example.com')
    expect(await decide(id, 'added')).toEqual({ status: 200, body: { ok: true, emailed: false } })
    expect((await list()).androidAdded).toBe(1)
  })

  it('still marks added when sending fails', async () => {
    deps.email = { send: async () => Promise.reject(new Error('down')) }
    await post(sam)
    expect(await decide(idOf('sam@example.com'), 'added')).toEqual({
      status: 200,
      body: { ok: true, emailed: false }
    })
  })

  it("keeps the day's limit when sign-ins prune old attempts", async () => {
    let now = new Date('2026-11-16T12:00:00.000Z')
    deps.now = () => now
    for (let i = 0; i < 5; i++) await post({ ...sam, email: `p${i}@example.com` })
    now = new Date('2026-11-16T14:00:00.000Z')
    // Every sign-in prunes; the hour-long sign-in limits go, the beta form's day stays.
    pruneExpired(deps, now.toISOString())
    expect((await post({ ...sam, email: 'late@example.com' })).headers.get('location')).toBe(
      SITE + '/beta?error=limit'
    )
    now = new Date('2026-11-17T12:30:00.000Z')
    pruneExpired(deps, now.toISOString())
    expect((await post({ ...sam, email: 'late@example.com' })).headers.get('location')).toBe(
      SITE + '/beta?sent=1'
    )
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM auth_limits WHERE kind = 'beta-ip'").get() as {
          n: number
        }
      ).n
    ).toBe(1)
  })
})
