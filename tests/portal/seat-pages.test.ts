import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { sha256Hex } from '../../workers/portal/src/auth'
import { setCap } from '../../workers/portal/src/seats'
import { handleSite } from '../../workers/portal/src/site/handler'
import { addUser, memoryBucket, noPrices, noPrintingArt, seededServerDb } from './helpers'

const BASE = 'https://portal.test'
const SITE = 'https://site.test'
const NOW = new Date('2026-11-21T12:00:00.000Z')

describe('seat cap public pages', () => {
  let db: Database.Database
  let deps: AppDeps

  beforeEach(async () => {
    db = await seededServerDb()
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
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => NOW,
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
    addUser(db, '999', 'owner')
    // Full by default (the owner holds the one seat), so a join goes on the list.
    setCap(db, 1, NOW.toISOString())
  })

  const post = (fields: Record<string, string>, origin = SITE, ip = '1.1.1.1'): Promise<Response> =>
    handle(
      new Request(`${BASE}/waitlist`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/x-www-form-urlencoded',
          'cf-connecting-ip': ip
        },
        body: new URLSearchParams(fields).toString()
      }),
      deps
    )
  const rows = (): number =>
    (db.prepare('SELECT COUNT(*) AS n FROM waitlist').get() as { n: number }).n

  it('adds a waitlist row from the site and redirects with sent=1', async () => {
    const res = await post({ email: 'A@Example.com' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${SITE}/waitlist?sent=1`)
    expect(db.prepare('SELECT email FROM waitlist').all()).toEqual([{ email: 'a@example.com' }])
  })

  it('redirects back to /full when the form came from the app host', async () => {
    const res = await post({ email: 'a@example.com' }, BASE)
    expect(res.headers.get('location')).toBe(`${BASE}/full?sent=1`)
    expect(rows()).toBe(1)
  })

  it('refuses a foreign origin', async () => {
    expect((await post({ email: 'a@example.com' }, 'https://evil.test')).status).toBe(403)
    expect(rows()).toBe(0)
  })

  it('ignores the honeypot and a bad email', async () => {
    const trap = await post({ email: 'a@example.com', website: 'x' })
    expect(trap.headers.get('location')).toBe(`${SITE}/waitlist?sent=1`)
    expect(rows()).toBe(0)
    expect((await post({ email: 'nope' })).headers.get('location')).toBe(
      `${SITE}/waitlist?error=email`
    )
  })

  it('limits one IP to five new emails a day', async () => {
    for (let i = 0; i < 5; i++) await post({ email: `u${i}@example.com` })
    const res = await post({ email: 'u5@example.com' })
    expect(res.headers.get('location')).toBe(`${SITE}/waitlist?error=limit`)
    expect(rows()).toBe(5)
  })

  it('answers a duplicate with sent=1 and keeps one row, without using the limit', async () => {
    await post({ email: 'a@example.com' })
    for (let i = 0; i < 6; i++) {
      const res = await post({ email: 'a@example.com' })
      expect(res.headers.get('location')).toBe(`${SITE}/waitlist?sent=1`)
    }
    expect(rows()).toBe(1)
  })

  it('says sign up instead of joining while seats are open and no one waits', async () => {
    const sent: string[] = []
    deps.email = { send: async (m) => void sent.push(m.to) }
    setCap(db, 100, NOW.toISOString())
    for (let i = 0; i < 7; i++) {
      const res = await post({ email: `u${i}@example.com` })
      expect(res.headers.get('location')).toBe(`${SITE}/waitlist?open=1`)
    }
    expect((await post({ email: 'a@example.com' }, BASE)).headers.get('location')).toBe(
      `${BASE}/full?open=1`
    )
    expect(rows()).toBe(0)
    expect(sent).toEqual([])
    expect(db.prepare('SELECT COUNT(*) AS n FROM seat_invites').get()).toEqual({ n: 0 })
  })

  it('answers an email already on the list with sent=1 even while seats are open', async () => {
    await post({ email: 'a@example.com' })
    db.prepare('DELETE FROM users').run()
    db.prepare(
      `INSERT INTO seat_invites (token_hash, email, waitlist_id, created_at, expires_at)
       VALUES ('h', 'a@example.com', (SELECT id FROM waitlist), '2026-11-20T00:00:00.000Z', '2026-12-04T00:00:00.000Z')`
    ).run()
    setCap(db, 5, NOW.toISOString())
    expect((await post({ email: 'a@example.com' })).headers.get('location')).toBe(
      `${SITE}/waitlist?sent=1`
    )
  })

  it('does not count someone who already joined as waiting', async () => {
    await post({ email: 'first@example.com' })
    db.prepare(
      `INSERT INTO seat_invites (token_hash, email, waitlist_id, created_at, expires_at, used_at)
       VALUES ('h', 'first@example.com', (SELECT id FROM waitlist), '2026-11-01T00:00:00.000Z',
               '2026-11-15T00:00:00.000Z', '2026-11-02T00:00:00.000Z')`
    ).run()
    setCap(db, 5, NOW.toISOString())
    expect((await post({ email: 'second@example.com' })).headers.get('location')).toBe(
      `${SITE}/waitlist?open=1`
    )
  })

  it('joins behind people already waiting even with a seat free, and invites no one', async () => {
    const sent: string[] = []
    deps.email = { send: async (m) => void sent.push(m.to) }
    await post({ email: 'first@example.com' })
    setCap(db, 5, NOW.toISOString())
    const res = await post({ email: 'second@example.com' })
    expect(res.headers.get('location')).toBe(`${SITE}/waitlist?sent=1`)
    expect(rows()).toBe(2)
    expect(sent).toEqual([])
  })

  it('counts an entry whose invite lapsed as waiting', async () => {
    await post({ email: 'first@example.com' })
    const id = (db.prepare('SELECT id FROM waitlist').get() as { id: number }).id
    db.prepare(
      `INSERT INTO seat_invites (token_hash, email, waitlist_id, created_at, expires_at)
       VALUES ('h', 'first@example.com', ?, '2026-11-01T00:00:00.000Z', '2026-11-15T00:00:00.000Z')`
    ).run(id)
    db.prepare("UPDATE waitlist SET invited_at = '2026-11-01T00:00:00.000Z'").run()
    setCap(db, 5, NOW.toISOString())
    expect((await post({ email: 'second@example.com' })).headers.get('location')).toBe(
      `${SITE}/waitlist?sent=1`
    )
    expect(rows()).toBe(2)
  })

  it('says sign up when the only entry holds a live invite', async () => {
    await post({ email: 'first@example.com' })
    const id = (db.prepare('SELECT id FROM waitlist').get() as { id: number }).id
    db.prepare(
      `INSERT INTO seat_invites (token_hash, email, waitlist_id, created_at, expires_at)
       VALUES ('h', 'first@example.com', ?, '2026-11-20T00:00:00.000Z', '2026-12-04T00:00:00.000Z')`
    ).run(id)
    setCap(db, 5, NOW.toISOString())
    expect((await post({ email: 'second@example.com' })).headers.get('location')).toBe(
      `${SITE}/waitlist?open=1`
    )
  })

  it('shows the open state on /full', async () => {
    const full = await (await handle(new Request(`${BASE}/full?open=1`), deps)).text()
    expect(full).toContain('Seats are open')
    expect(full).toContain('href="/auth/discord/start"')
    expect(full).not.toContain('name="email"')
  })

  it('serves /full with the form', async () => {
    const res = await handle(new Request(`${BASE}/full`), deps)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('Duel Binder is full for now')
    expect(body).toContain(`action="${BASE}/waitlist"`)
    expect(body).toContain('name="email"')
    const sent = await (await handle(new Request(`${BASE}/full?sent=1`), deps)).text()
    expect(sent).toContain('on the list')
    const err = await (await handle(new Request(`${BASE}/full?error=limit`), deps)).text()
    expect(err).toContain('Too many requests')
  })

  const invite = async (token: string, expiresAt: string, usedAt: string | null = null) => {
    db.prepare(
      `INSERT INTO seat_invites (token_hash, email, created_at, expires_at, used_at)
       VALUES (?, 'a@example.com', ?, ?, ?)`
    ).run(await sha256Hex(token), NOW.toISOString(), expiresAt, usedAt)
  }

  it('a valid invite sets the cookie for its remaining life and links to sign-in', async () => {
    await invite('tok-good', new Date(NOW.getTime() + 3600_000).toISOString())
    const res = await handle(new Request(`${BASE}/invite/tok-good`), deps)
    expect(res.status).toBe(200)
    const set = res.headers.get('set-cookie') ?? ''
    expect(set).toContain('seat_invite=tok-good')
    expect(set).toContain('Max-Age=3600')
    const body = await res.text()
    expect(body).toContain('/auth/discord/start')
    expect(body).toContain('/auth/email')
  })

  it('an expired, used or unknown invite is 410 with no cookie and the form', async () => {
    await invite('tok-old', new Date(NOW.getTime() - 1000).toISOString())
    await invite('tok-used', new Date(NOW.getTime() + 3600_000).toISOString(), NOW.toISOString())
    for (const t of ['tok-old', 'tok-used', 'garbage']) {
      const res = await handle(new Request(`${BASE}/invite/${t}`), deps)
      expect(res.status).toBe(410)
      expect(res.headers.get('set-cookie')).toBeNull()
      expect(await res.text()).toContain('name="email"')
    }
  })

  const site = async (path: string): Promise<{ status: number; body: string }> => {
    const res = await handleSite(new Request(SITE + path), {
      appUrl: BASE,
      assets: { fetch: async () => new Response('asset', { status: 404 }) },
      downloads: async () => ({
        version: null,
        windows: null,
        mac: null,
        linux: null,
        android: null
      })
    })
    return { status: res.status, body: await res.text() }
  }

  it('the site /waitlist posts to the app and the privacy page mentions it', async () => {
    const page = await site('/waitlist')
    expect(page.status).toBe(200)
    expect(page.body).toContain(`action="${BASE}/waitlist"`)
    expect((await site('/waitlist?sent=1')).body).toContain('on the list')
    const open = (await site('/waitlist?open=1')).body
    expect(open).toContain('Seats are open')
    expect(open).toContain(`href="${BASE}/"`)
    expect(open).not.toContain('name="email"')
    expect((await site('/privacy')).body.toLowerCase()).toContain('waitlist')
    const privacy = (await site('/privacy')).body
    expect(privacy).toContain('make your account')
    expect(privacy).toContain('until we remove you from the list')
    expect(privacy).not.toContain('is kept until then')
  })
})
