import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { HANDOFF_SESSION_SECONDS } from '../../workers/portal/src/adminHandoff'

const BASE = 'https://portal.test'
const DAY = 24 * 60 * 60 * 1000
const START = new Date('2026-11-05T12:00:00.000Z')
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

describe('admin handoff', () => {
  let db: Database.Database
  let deps: AppDeps
  let now: Date

  beforeEach(async () => {
    db = await seededServerDb()
    now = START
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
        ADMIN_TOKEN: 'admin',
        PRICE_WORKER_URL: 'https://prices.test',
        ADMIN_DISCORD_ID: '999'
      },
      now: () => now,
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
    const owner = addUser(db, '999', 'owner')
    const kaiba = addUser(db, '111', 'kaiba')
    session(owner, 'tok-owner', 'desktop')
    session(kaiba, 'tok-kaiba', 'desktop')
    session(owner, 'web-owner', 'web')
  })

  function session(userId: number, token: string, kind: 'web' | 'desktop'): void {
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      sha256Hex(token),
      userId,
      kind,
      START.toISOString(),
      new Date(START.getTime() + 30 * DAY).toISOString()
    )
  }

  const askLink = (headers: Record<string, string>): Promise<Response> =>
    handle(new Request(`${BASE}/api/admin/handoff`, { method: 'POST', headers }), deps)
  const open = (url: string): Promise<Response> => handle(new Request(url), deps)

  async function link(): Promise<string> {
    const res = await askLink({ authorization: 'Bearer tok-owner' })
    expect(res.status).toBe(200)
    return ((await res.json()) as { url: string }).url
  }

  it("opens the dashboard once, on a short web session, for the owner's app", async () => {
    const url = await link()
    expect(url).toMatch(/^https:\/\/portal\.test\/admin\/open\?code=[A-Za-z0-9_-]{43}$/)
    // Only the code's hash is kept.
    const code = new URL(url).searchParams.get('code')!
    expect(db.prepare('SELECT code_hash FROM admin_handoffs').pluck().all()).toEqual([
      sha256Hex(code)
    ])

    const res = await open(url)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/admin')
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toContain(`Max-Age=${HANDOFF_SESSION_SECONDS}`)
    expect(cookie).toContain('HttpOnly')
    const secret = /^session=([^;]+)/.exec(cookie)![1]
    const page = await handle(
      new Request(`${BASE}/admin`, { headers: { cookie: `session=${secret}` } }),
      deps
    )
    expect(page.status).toBe(200)

    // Spent: the same link opens nothing again.
    expect((await open(url)).status).toBe(404)
  })

  it('answers 404 to anyone else, and to a web session', async () => {
    expect((await askLink({ authorization: 'Bearer tok-kaiba' })).status).toBe(404)
    expect((await askLink({})).status).toBe(404)
    expect((await askLink({ cookie: 'session=web-owner' })).status).toBe(404)
    expect(db.prepare('SELECT COUNT(*) FROM admin_handoffs').pluck().get()).toBe(0)
  })

  it('refuses a link after a minute, a made-up code, and a GET for a link', async () => {
    const url = await link()
    now = new Date(START.getTime() + 61_000)
    expect((await open(url)).status).toBe(404)
    expect((await open(`${BASE}/admin/open?code=${'a'.repeat(43)}`)).status).toBe(404)
    expect((await open(`${BASE}/admin/open`)).status).toBe(404)
    const get = await handle(
      new Request(`${BASE}/api/admin/handoff`, { headers: { authorization: 'Bearer tok-owner' } }),
      deps
    )
    expect(get.status).toBe(404)
  })

  it('refuses a link when the account is no longer an admin', async () => {
    const url = await link()
    db.prepare('DELETE FROM admins').run()
    deps.env.ADMIN_DISCORD_ID = undefined
    expect((await open(url)).status).toBe(404)
  })
})

describe('admin accounts', () => {
  let db: Database.Database
  let deps: AppDeps
  let owner: number
  let kaiba: number

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
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        ADMIN_TOKEN: 'admin',
        PRICE_WORKER_URL: 'https://prices.test',
        ADMIN_DISCORD_ID: '999'
      },
      now: () => START,
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
    owner = addUser(db, '999', 'owner')
    kaiba = addUser(db, '111', 'kaiba')
    for (const [id, token] of [
      [owner, 'web-owner'],
      [kaiba, 'web-kaiba']
    ] as const)
      db.prepare(
        "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'web', ?, ?)"
      ).run(
        sha256Hex(token),
        id,
        START.toISOString(),
        new Date(START.getTime() + 30 * DAY).toISOString()
      )
  })

  const page = (token: string): Promise<Response> =>
    handle(new Request(`${BASE}/admin`, { headers: { cookie: `session=${token}` } }), deps)
  const post = (path: string, token: string, body: unknown): Promise<Response> =>
    handle(
      new Request(`${BASE}${path}`, {
        method: 'POST',
        headers: { cookie: `session=${token}`, origin: BASE, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }),
      deps
    )
  const admins = (): number[] =>
    db.prepare('SELECT user_id FROM admins ORDER BY user_id').pluck().all() as number[]

  it('belongs to the account: removing the Discord sign-in keeps it', async () => {
    expect((await page('web-owner')).status).toBe(200)
    expect(admins()).toEqual([owner])
    db.prepare('DELETE FROM sign_ins WHERE user_id = ?').run(owner)
    db.prepare(
      "INSERT INTO sign_ins (provider, subject, user_id, created_at) VALUES ('email', 'me@example.com', ?, ?)"
    ).run(owner, START.toISOString())
    expect((await page('web-owner')).status).toBe(200)
  })

  it('reads ADMIN_DISCORD_ID only to seed an empty list', async () => {
    expect((await page('web-owner')).status).toBe(200)
    deps.env.ADMIN_DISCORD_ID = '111'
    expect((await page('web-kaiba')).status).toBe(404)
    expect((await page('web-owner')).status).toBe(200)
  })

  it('adds another account by username, and never removes the last admin', async () => {
    expect((await page('web-kaiba')).status).toBe(404)
    expect((await post('/admin/admins', 'web-kaiba', { username: 'kaiba' })).status).toBe(404)

    const added = await post('/admin/admins', 'web-owner', { username: '@Kaiba' })
    expect(added.status).toBe(200)
    expect(admins()).toEqual([owner, kaiba])
    expect((await page('web-kaiba')).status).toBe(200)
    expect((await post('/admin/admins', 'web-owner', { username: 'nobody' })).status).toBe(404)

    const listed = await handle(
      new Request(`${BASE}/admin/admins`, { headers: { cookie: 'session=web-kaiba' } }),
      deps
    )
    const body = (await listed.json()) as { admins: { username: string; signIns: string }[] }
    expect(body.admins.map((a) => [a.username, a.signIns])).toEqual([
      ['owner', 'discord'],
      ['kaiba', 'discord']
    ])

    expect((await post('/admin/admins/remove', 'web-kaiba', { userId: owner })).status).toBe(200)
    expect(admins()).toEqual([kaiba])
    expect((await page('web-owner')).status).toBe(404)
    const last = await post('/admin/admins/remove', 'web-kaiba', { userId: kaiba })
    expect(last.status).toBe(400)
    expect(admins()).toEqual([kaiba])
  })

  it('needs the dashboard origin to change the list', async () => {
    await page('web-owner')
    const res = await handle(
      new Request(`${BASE}/admin/admins`, {
        method: 'POST',
        headers: { cookie: 'session=web-owner', 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'kaiba' })
      }),
      deps
    )
    expect(res.status).toBe(404)
    expect(admins()).toEqual([owner])
  })
})
