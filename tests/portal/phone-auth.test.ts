import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { withOwnerOnlyPokemon } from '../fixtures/ownerOnlyGame'

withOwnerOnlyPokemon()

const BASE = 'https://portal.test'
const DAY = 24 * 60 * 60 * 1000
const WEB_TOKEN = 'alice-web-session-token'
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

let clock = new Date('2026-10-24T12:00:00.000Z')

describe('phone sign-in', () => {
  let db: Database.Database
  let deps: AppDeps
  let alice: number

  beforeEach(async () => {
    clock = new Date('2026-10-24T12:00:00.000Z')
    db = await seededServerDb()
    alice = addUser(db, '111', 'alice')
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'web', ?, ?)"
    ).run(
      sha256Hex(WEB_TOKEN),
      alice,
      clock.toISOString(),
      new Date(clock.getTime() + 30 * DAY).toISOString()
    )
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://discord.com/api/oauth2/token')
        return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 })
      if (url === 'https://discord.com/api/users/@me')
        return new Response(
          JSON.stringify({ id: '111', username: 'alice', global_name: 'Alice', avatar: 'abc' }),
          { status: 200 }
        )
      return new Response('?', { status: 404 })
    })
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'cid',
        DISCORD_CLIENT_SECRET: 'secret',
        ADMIN_TOKEN: 'admin',
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => clock,
      fetch: fetchMock as unknown as typeof fetch
    }
  })

  const cookieOf = (res: Response, name: string): string | undefined => {
    for (const c of res.headers.getSetCookie()) {
      const m = c.match(new RegExp(`^${name}=([^;]*)`))
      if (m) return m[1]
    }
    return undefined
  }
  const rawCookie = (res: Response, name: string): string | undefined =>
    res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))
  const get = (path: string, headers: Record<string, string> = {}): Promise<Response> =>
    handle(new Request(BASE + path, { headers }), deps)
  const exchange = (headers: Record<string, string>): Promise<Response> =>
    handle(new Request(BASE + '/auth/phone/token', { method: 'POST', headers, body: '{}' }), deps)
  const good = { origin: BASE, 'content-type': 'application/json', cookie: `session=${WEB_TOKEN}` }

  it('exchanges a web session for a Bearer token that sync accepts', async () => {
    const res = await exchange(good)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as { token: string; user: unknown }
    expect(body.user).toEqual({ id: alice, username: 'alice', displayName: null, avatarUrl: null, games: ['ygo'] })
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.token).not.toBe(WEB_TOKEN)

    const row = db
      .prepare('SELECT user_id, kind, expires_at FROM sessions WHERE token_hash = ?')
      .get(sha256Hex(body.token)) as { user_id: number; kind: string; expires_at: string }
    expect(row).toEqual({
      user_id: alice,
      kind: 'desktop',
      expires_at: new Date(clock.getTime() + 365 * DAY).toISOString()
    })

    const pull = await get('/api/sync/pull?cursor=0', { authorization: `Bearer ${body.token}` })
    expect(pull.status).toBe(200)
    // The web session still works; the exchange does not spend it.
    expect((await get('/api/me', { cookie: `session=${WEB_TOKEN}` })).status).toBe(200)
  })

  it('accepts a charset on the JSON content type', async () => {
    const res = await exchange({ ...good, 'content-type': 'application/json; charset=utf-8' })
    expect(res.status).toBe(200)
  })

  it('rejects a missing cookie (401) and a foreign Origin (403)', async () => {
    const count = (): unknown =>
      db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE kind = 'desktop'").get()
    const noCookie = await exchange({ origin: BASE, 'content-type': 'application/json' })
    expect(noCookie.status).toBe(401)
    expect(await noCookie.json()).toEqual({ error: 'signed-out' })

    const badCookie = await exchange({ ...good, cookie: 'session=nope' })
    expect(badCookie.status).toBe(401)
    expect(await badCookie.json()).toEqual({ error: 'signed-out' })

    for (const origin of [
      'https://evil.test',
      'null',
      'https://portal.test.evil.test',
      'http://portal.test'
    ]) {
      const res = await exchange({ ...good, origin })
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'bad-origin' })
    }
    const missing = await exchange({ 'content-type': 'application/json', cookie: good.cookie })
    expect(missing.status).toBe(403)
    expect(await missing.json()).toEqual({ error: 'bad-origin' })
    expect(count()).toEqual({ n: 0 })
  })

  it('rejects a form post, an expired web session and a Bearer token in place of the cookie', async () => {
    const form = await exchange({ ...good, 'content-type': 'application/x-www-form-urlencoded' })
    expect(form.status).toBe(415)
    const plain = await exchange({ ...good, 'content-type': 'text/plain' })
    expect(plain.status).toBe(415)

    const first = (await (await exchange(good)).json()) as { token: string }
    // A desktop token cannot mint another one, even with the web cookie alongside it.
    const bearer = await exchange({ ...good, authorization: `Bearer ${first.token}` })
    expect(bearer.status).toBe(401)

    clock = new Date(clock.getTime() + 31 * DAY)
    const expired = await exchange(good)
    expect(expired.status).toBe(401)
    expect(await expired.json()).toEqual({ error: 'signed-out' })
  })

  it('only answers POST', async () => {
    const res = await get('/auth/phone/token', good)
    expect(res.status).toBe(404)
  })

  async function signInVia(startPath: string, extraCookie = ''): Promise<Response> {
    const start = await get(startPath)
    expect(start.status).toBe(302)
    const state = cookieOf(start, 'oauth_state')!
    const next = cookieOf(start, 'signin_next')
    const cookies = [`oauth_state=${state}`]
    if (next) cookies.push(`signin_next=${next}`)
    if (extraCookie) cookies.push(extraCookie)
    return get(`/auth/discord/callback?code=c&state=${state}`, { cookie: cookies.join('; ') })
  }

  it('next=scan returns to /scan/ after Discord', async () => {
    const start = await get('/auth/discord/start?next=scan')
    expect(rawCookie(start, 'signin_next')).toBe(
      'signin_next=scan; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600'
    )
    const res = await signInVia('/auth/discord/start?next=scan')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/scan/')
    expect(cookieOf(res, 'session')).toBeTruthy()
    expect(rawCookie(res, 'signin_next')).toMatch(/^signin_next=; .*Max-Age=0$/)
  })

  it('next=scan sends a failed sign-in to /scan/?signin=failed', async () => {
    const start = await get('/auth/discord/start?next=scan')
    const res = await get('/auth/discord/callback?code=c&state=x', {
      cookie: `oauth_state=${cookieOf(start, 'oauth_state')}; signin_next=scan`
    })
    expect(res.headers.get('location')).toBe('/scan/?signin=failed')
    expect(rawCookie(res, 'signin_next')).toMatch(/Max-Age=0$/)
    expect(cookieOf(res, 'session')).toBeUndefined()
  })

  it('next=scan survives the bounce to PUBLIC_URL', async () => {
    const res = await handle(
      new Request('https://portal.example.workers.dev/auth/discord/start?next=scan'),
      deps
    )
    expect(res.headers.get('location')).toBe(`${BASE}/auth/discord/start?next=scan`)
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it('ignores other next values', async () => {
    for (const next of ['/evil', 'https://evil.test', 'SCAN', 'scan/', '']) {
      const start = await get(`/auth/discord/start?next=${encodeURIComponent(next)}`)
      expect(cookieOf(start, 'signin_next')).toBeUndefined()
    }
    const res = await signInVia('/auth/discord/start?next=https%3A%2F%2Fevil.test')
    expect(res.headers.get('location')).toBe('/')
    // A forged or stale cookie with another value does nothing either.
    const forged = await signInVia('/auth/discord/start', 'signin_next=https://evil.test')
    expect(forged.headers.get('location')).toBe('/')
  })

  it('a plain sign-in clears a leftover next=scan cookie', async () => {
    const start = await get('/auth/discord/start', { cookie: 'signin_next=scan' })
    expect(rawCookie(start, 'signin_next')).toMatch(/^signin_next=; .*Max-Age=0$/)
    // Without a leftover cookie the start response is as before.
    const clean = await get('/auth/discord/start')
    expect(rawCookie(clean, 'signin_next')).toBeUndefined()
  })

  it('desktop sign-in ignores signin_next', async () => {
    const res = await get('/auth/discord/callback?code=c&state=s', {
      cookie: `oauth_state=s; desktop_auth=50123.state_0123456789abcdef.${'a'.repeat(43)}; signin_next=scan`
    })
    expect(res.headers.get('location')).toMatch(/^http:\/\/127\.0\.0\.1:50123\/callback\?code=/)
  })
})
