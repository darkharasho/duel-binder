import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { sha256Hex } from '../../workers/portal/src/auth'
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
  const rows = (): number => (db.prepare('SELECT COUNT(*) AS n FROM waitlist').get() as { n: number }).n

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
      downloads: async () => ({ version: null, windows: null, mac: null, linux: null, android: null })
    })
    return { status: res.status, body: await res.text() }
  }

  it('the site /waitlist posts to the app and the privacy page mentions it', async () => {
    const page = await site('/waitlist')
    expect(page.status).toBe(200)
    expect(page.body).toContain(`action="${BASE}/waitlist"`)
    expect((await site('/waitlist?sent=1')).body).toContain('on the list')
    expect((await site('/privacy')).body.toLowerCase()).toContain('waitlist')
  })
})
