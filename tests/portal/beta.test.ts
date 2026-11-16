import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'

const BASE = 'https://portal.test'
const SITE = 'https://site.test'
const TOKEN = 'admin-secret'

describe('phone beta requests', () => {
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
        ADMIN_TOKEN: TOKEN,
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => new Date('2026-11-16T12:00:00.000Z'),
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
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
})
