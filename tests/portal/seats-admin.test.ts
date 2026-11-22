import { createHash } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { adminPage } from '../../workers/portal/src/adminPage'
import type { EmailMessage } from '../../workers/portal/src/emailSend'
import { joinWaitlist, setCap } from '../../workers/portal/src/seats'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'

const BASE = 'https://portal.test'
const NOW = '2026-11-21T12:00:00.000Z'
const TOKEN = 'tok-owner'
const FUTURE = '2026-12-01T00:00:00.000Z'

describe('admin seats routes', () => {
  let db: Database.Database
  let deps: AppDeps
  let sent: EmailMessage[]
  let failNext: number

  beforeEach(async () => {
    db = await seededServerDb()
    sent = []
    failNext = 0
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
      email: {
        send: async (m) => {
          if (failNext > 0) {
            failNext--
            throw new Error('boom')
          }
          sent.push(m)
        }
      },
      now: () => new Date(NOW),
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

  const call = (
    path: string,
    body?: unknown,
    opts: { auth?: boolean; type?: string } = {}
  ): Promise<Response> =>
    handle(
      new Request(BASE + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(opts.auth === false ? {} : { authorization: `Bearer ${TOKEN}` }),
          ...(body === undefined ? {} : { 'content-type': opts.type ?? 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      }),
      deps
    )
  const wait = (email: string, at: string): number => {
    joinWaitlist(db, email, at)
    return (db.prepare('SELECT id FROM waitlist WHERE email = ?').get(email) as { id: number }).id
  }
  const list = async (): Promise<{
    counts: { cap: number; accounts: number; invited: number; free: number; waiting: number }
    waitlist: { id: number; email: string; status: string }[]
  }> => (await call('/admin/seats')).json() as never

  it('is a 404 for everyone but the admin, on every route', async () => {
    const id = wait('a@example.com', '2026-11-01T00:00:00.000Z')
    expect((await call('/admin/seats', undefined, { auth: false })).status).toBe(404)
    for (const [path, body] of [
      ['cap', { cap: 5 }],
      ['fill', {}],
      ['invite', { id }],
      ['resend', { id }],
      ['cancel', { id }],
      ['delete', { id }]
    ] as const)
      expect((await call('/admin/seats/' + path, body, { auth: false })).status).toBe(404)
    expect(sent).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM waitlist').get()).toEqual({ n: 1 })
  })

  it('sets the cap and invites the waiting entries', async () => {
    setCap(db, 1, NOW)
    wait('a@example.com', '2026-11-01T00:00:00.000Z')
    wait('b@example.com', '2026-11-02T00:00:00.000Z')
    const res = await call('/admin/seats/cap', { cap: 101 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, invited: 2, left: 0 })
    expect(sent.map((m) => m.to)).toEqual(['a@example.com', 'b@example.com'])
    expect((await list()).counts).toMatchObject({ cap: 101, invited: 2, waiting: 0 })
  })

  it('refuses a bad cap', async () => {
    for (const cap of [-1, 1.5, 100001, '5', null])
      expect((await call('/admin/seats/cap', { cap })).status).toBe(400)
    expect((await list()).counts.cap).toBe(100)
  })

  it('a cap below the accounts in use removes no one and invites no one', async () => {
    addUser(db, '1', 'x')
    addUser(db, '2', 'y')
    wait('a@example.com', '2026-11-01T00:00:00.000Z')
    const res = await call('/admin/seats/cap', { cap: 1 })
    expect(await res.json()).toEqual({ ok: true, invited: 0, left: 0 })
    const l = await list()
    expect(l.counts).toMatchObject({ cap: 1, accounts: 3, free: 0, waiting: 1 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM users WHERE closed_at IS NULL').get()).toEqual({
      n: 3
    })
    expect((await call('/admin/seats/fill', {})).status).toBe(200)
    expect(sent).toEqual([])
  })

  it('lists without sending, waiting first, then invited, then joined', async () => {
    const waiting = wait('w@example.com', '2026-11-03T00:00:00.000Z')
    const invited = wait('i@example.com', '2026-11-01T00:00:00.000Z')
    const expired = wait('e@example.com', '2026-11-02T00:00:00.000Z')
    const joined = wait('j@example.com', '2026-10-30T00:00:00.000Z')
    const row = (id: number, hash: string, expires: string, used: string | null): void => {
      db.prepare('UPDATE waitlist SET invited_at = ? WHERE id = ?').run('2026-11-10T00:00:00.000Z', id)
      db.prepare(
        'INSERT INTO seat_invites (token_hash, waitlist_id, email, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(hash, id, 'x', '2026-11-10T00:00:00.000Z', expires, used)
    }
    row(invited, 'h1', FUTURE, null)
    row(expired, 'h2', '2026-11-15T00:00:00.000Z', null)
    row(joined, 'h3', FUTURE, '2026-11-11T00:00:00.000Z')
    const l = await list()
    expect(l.waitlist.map((e) => [e.id, e.status])).toEqual([
      [expired, 'expired'],
      [waiting, 'waiting'],
      [invited, 'invited'],
      [joined, 'joined']
    ])
    expect(sent).toEqual([])
    // The lapsed invite counts as waiting again, beside the never-invited entry.
    expect(l.counts).toMatchObject({ invited: 1, waiting: 2 })
  })

  it('invite, resend, cancel and delete change state as named', async () => {
    const id = wait('a@example.com', '2026-11-01T00:00:00.000Z')
    const status = async (): Promise<string | undefined> =>
      (await list()).waitlist.find((e) => e.id === id)?.status
    expect(await (await call('/admin/seats/invite', { id })).json()).toEqual({
      ok: true,
      emailed: true
    })
    expect(await status()).toBe('invited')
    expect(sent).toHaveLength(1)
    expect(await (await call('/admin/seats/resend', { id })).json()).toEqual({
      ok: true,
      emailed: true
    })
    expect(sent).toHaveLength(2)
    expect(db.prepare('SELECT COUNT(*) AS n FROM seat_invites').get()).toEqual({ n: 1 })
    expect(await (await call('/admin/seats/cancel', { id })).json()).toEqual({ ok: true })
    expect(await status()).toBe('waiting')
    expect(await (await call('/admin/seats/delete', { id })).json()).toEqual({ ok: true })
    expect(await status()).toBeUndefined()
  })

  it('gives 404 for an unknown id and 502 when the email fails', async () => {
    for (const a of ['invite', 'resend', 'cancel', 'delete'])
      expect((await call('/admin/seats/' + a, { id: 9999 })).status).toBe(404)
    expect((await call('/admin/seats/invite', { id: 'x' })).status).toBe(400)
    const id = wait('a@example.com', '2026-11-01T00:00:00.000Z')
    failNext = 1
    const res = await call('/admin/seats/invite', { id })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'email' })
    expect((await list()).waitlist[0].status).toBe('waiting')
  })

  it('does not send a second seat to someone whose invite was used', async () => {
    const id = wait('a@example.com', '2026-11-01T00:00:00.000Z')
    db.prepare('UPDATE waitlist SET invited_at = ? WHERE id = ?').run('2026-11-10T00:00:00.000Z', id)
    db.prepare(
      'INSERT INTO seat_invites (token_hash, waitlist_id, email, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('h', id, 'a@example.com', '2026-11-10T00:00:00.000Z', FUTURE, '2026-11-11T00:00:00.000Z')
    for (const a of ['invite', 'resend', 'cancel']) {
      const res = await call('/admin/seats/' + a, { id })
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'joined' })
    }
    expect(sent).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM seat_invites').get()).toEqual({ n: 1 })
    expect((await list()).waitlist[0].status).toBe('joined')
    expect((await list()).counts.waiting).toBe(0)
    // Delete is still allowed: it only drops the list entry.
    expect(await (await call('/admin/seats/delete', { id })).json()).toEqual({ ok: true })
    expect((await list()).waitlist).toEqual([])
  })

  it('a fill stops at 25 invites and says how many are left', async () => {
    for (let i = 0; i < 27; i++)
      wait(`u${i}@example.com`, `2026-11-01T00:00:${String(i).padStart(2, '0')}.000Z`)
    expect(await (await call('/admin/seats/fill', {})).json()).toEqual({
      ok: true,
      invited: 25,
      left: 2
    })
    expect(await (await call('/admin/seats/fill', {})).json()).toEqual({
      ok: true,
      invited: 2,
      left: 0
    })
  })

  it('the web Save refuses an empty or non-number cap', async () => {
    const posts: string[] = []
    const alerts: string[] = []
    let loads = 0
    const seats = await (await call('/admin/seats')).json()
    const html = await adminPage().text()
    const dom = new JSDOM(html, {
      url: BASE + '/admin#seats',
      runScripts: 'dangerously',
      beforeParse(window) {
        ;(window as unknown as { fetch: unknown }).fetch = async (path: string, init?: RequestInit) => {
          if (String(path).startsWith('https:')) throw new Error('offline')
          if (init?.method === 'POST') posts.push(String(path))
          else if (path === '/admin/seats') loads++
          return new Response(JSON.stringify(path === '/admin/seats' ? seats : {}))
        }
        window.alert = (m: string) => void alerts.push(m)
      }
    })
    const doc = dom.window.document
    await expect
      .poll(() => doc.querySelector('#seats input[aria-label="Seat cap"]'), { timeout: 2000 })
      .not.toBeNull()
    const input = doc.querySelector('#seats input[aria-label="Seat cap"]') as HTMLInputElement
    const form = input.form!
    for (const v of ['', '  ']) {
      input.value = v
      form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
    }
    // A number box drops text it can't parse, so 'abc' reads as '' too.
    input.value = 'abc'
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
    expect(posts).toEqual([])
    expect(alerts.length).toBe(3)
    input.value = '120'
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
    await expect.poll(() => posts).toEqual(['/admin/seats/cap'])
    // Let the reload after the save finish before the window goes.
    await expect.poll(() => loads).toBe(2)
    await expect.poll(() => doc.querySelector('#seats input[aria-label="Seat cap"]')).not.toBe(input)
    dom.window.close()
  })

  it('needs the Bearer token or the right origin for a write, and JSON', async () => {
    const body = JSON.stringify({ cap: 7 })
    const post = (headers: Record<string, string>): Promise<Response> =>
      handle(new Request(BASE + '/admin/seats/cap', { method: 'POST', headers, body }), deps)
    // Signed in by cookie only, no Bearer and a foreign origin.
    db.prepare("UPDATE sessions SET kind = 'web'").run()
    const cookie = { cookie: `session=${TOKEN}`, 'content-type': 'application/json' }
    expect((await post({ ...cookie, origin: 'https://evil.test' })).status).toBe(404)
    expect((await post(cookie)).status).toBe(404)
    const cap = (): unknown => db.prepare('SELECT cap FROM seat_settings').get()
    expect(cap()).toEqual({ cap: 100 })
    // The same cookie from the portal's own origin is allowed, so the 404s above were the origin check.
    expect((await post({ ...cookie, origin: BASE })).status).toBe(200)
    expect(cap()).toEqual({ cap: 7 })
    db.prepare("UPDATE sessions SET kind = 'desktop'").run()
    expect((await call('/admin/seats/cap', { cap: 7 }, { type: 'text/plain' })).status).toBe(415)
    expect((await call('/admin/seats/cap', { cap: 7 })).status).toBe(200)
  })

  it('the admin page has a Seats tab', async () => {
    const html = await adminPage().text()
    expect(html).toContain('<section data-tab id="seats" hidden></section>')
    expect(html).toContain('href="#seats"')
  })
})
