import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { memoryBucket, noPrintingArt, noPrices } from './helpers'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { migrateServer } from '../../workers/portal/src/migrate'
import { withOwnerOnlyPokemon } from '../fixtures/ownerOnlyGame'

withOwnerOnlyPokemon()

const BASE = 'https://portal.test'
const DAY = 24 * 60 * 60 * 1000
const STATE = 'state_0123456789abcdef'
const VERIFIER = 'verifier-0123456789-abcdefghijklmnopqrstuvwxyz-ABCDEFG'
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

let clock = new Date('2026-10-24T12:00:00.000Z')

describe('desktop sign-in and bearer tokens', () => {
  let db: Database.Database
  let tokenStatus: number
  let deps: AppDeps

  beforeEach(() => {
    clock = new Date('2026-10-24T12:00:00.000Z')
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrateServer(db)
    tokenStatus = 200
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://discord.com/api/oauth2/token') {
        return tokenStatus === 200
          ? new Response(JSON.stringify({ access_token: 'at' }), { status: 200 })
          : new Response('discord secret detail', { status: tokenStatus })
      }
      if (url === 'https://discord.com/api/users/@me') {
        return new Response(
          JSON.stringify({ id: '111', username: 'kaiba', global_name: 'Seto', avatar: 'abc' }),
          {
            status: 200
          }
        )
      }
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
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {}
  ): Promise<Response> =>
    handle(
      new Request(BASE + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body)
      }),
      deps
    )
  const startPath = (port = '53682', state = STATE, challenge = CHALLENGE): string =>
    `/auth/desktop/start?port=${port}&state=${state}&challenge=${challenge}`

  /** Runs the browser half of the desktop flow and returns the loopback redirect. */
  async function desktopCallback(): Promise<Response> {
    const start = await get(startPath())
    const oauthState = cookieOf(start, 'oauth_state')!
    const desktop = cookieOf(start, 'desktop_auth')!
    return get(`/auth/discord/callback?code=c&state=${oauthState}`, {
      cookie: `oauth_state=${oauthState}; desktop_auth=${desktop}`
    })
  }
  async function desktopCode(): Promise<string> {
    const res = await desktopCallback()
    return new URL(res.headers.get('location')!).searchParams.get('code')!
  }
  async function desktopToken(): Promise<string> {
    const res = await post('/auth/desktop/token', { code: await desktopCode(), verifier: VERIFIER })
    expect(res.status).toBe(200)
    return ((await res.json()) as { token: string }).token
  }
  async function webToken(): Promise<string> {
    const start = await get('/auth/discord/start')
    const state = cookieOf(start, 'oauth_state')!
    const res = await get(`/auth/discord/callback?code=c&state=${state}`, {
      cookie: `oauth_state=${state}`
    })
    return cookieOf(res, 'session')!
  }
  const sessionRow = (token: string): { kind: string; expires_at: string } | undefined =>
    db
      .prepare('SELECT kind, expires_at FROM sessions WHERE token_hash = ?')
      .get(sha256Hex(token)) as { kind: string; expires_at: string } | undefined

  it('desktop start validates its parameters', async () => {
    for (const path of [
      startPath('80'),
      startPath('abc'),
      startPath('70000'),
      startPath('53682', 'short'),
      `/auth/desktop/start?port=53682&state=${STATE}`,
      startPath('53682', STATE, CHALLENGE.slice(0, 42))
    ]) {
      const res = await get(path)
      expect(res.status, path).toBe(400)
      expect(res.headers.getSetCookie()).toEqual([])
    }
  })

  it('desktop start bounces to PUBLIC_URL first', async () => {
    const res = await handle(new Request('https://portal.example.workers.dev' + startPath()), deps)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(BASE + startPath())
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it('desktop start sets the desktop cookie and asks Discord for consent', async () => {
    const res = await get(startPath())
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('location')!)
    expect(loc.origin + loc.pathname).toBe('https://discord.com/oauth2/authorize')
    expect(loc.searchParams.get('prompt')).toBe('consent')
    expect(loc.searchParams.get('redirect_uri')).toBe(`${BASE}/auth/discord/callback`)
    expect(loc.searchParams.get('state')).toBe(cookieOf(res, 'oauth_state'))
    expect(cookieOf(res, 'desktop_auth')).toBe(`53682.${STATE}.${CHALLENGE}`)
    expect(rawCookie(res, 'desktop_auth')).toMatch(
      /HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=600/
    )
  })

  it('desktop callback hands a one-time code to the loopback address', async () => {
    const res = await desktopCallback()
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('location')!)
    expect(loc.origin + loc.pathname).toBe('http://127.0.0.1:53682/callback')
    expect(loc.searchParams.get('state')).toBe(STATE)
    const code = loc.searchParams.get('code')!
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(cookieOf(res, 'session')).toBeUndefined()
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 })
    expect(rawCookie(res, 'desktop_auth')).toMatch(/Max-Age=0/)
    expect(rawCookie(res, 'oauth_state')).toMatch(/Max-Age=0/)
    const row = db.prepare('SELECT code_hash, challenge, expires_at FROM desktop_codes').get() as {
      code_hash: string
      challenge: string
      expires_at: string
    }
    expect(row.code_hash).not.toBe(code)
    expect(row.code_hash).toBe(sha256Hex(code))
    expect(row.challenge).toBe(CHALLENGE)
    expect(row.expires_at).toBe(new Date(clock.getTime() + 120_000).toISOString())
  })

  it('failed Discord callback in the desktop flow tells the app', async () => {
    tokenStatus = 500
    const res = await desktopCallback()
    expect(res.status).toBe(302)
    const location = res.headers.get('location')!
    expect(location).toBe(`http://127.0.0.1:53682/callback?error=signin-failed&state=${STATE}`)
    expect(location).not.toContain('discord')
    expect(db.prepare('SELECT COUNT(*) AS n FROM desktop_codes').get()).toEqual({ n: 0 })
    expect(rawCookie(res, 'desktop_auth')).toMatch(/Max-Age=0/)
  })

  const iosStartPath = (state = STATE, challenge = CHALLENGE): string =>
    `/auth/desktop/start?app=ios&state=${state}&challenge=${challenge}`
  async function iosCallback(): Promise<Response> {
    const start = await get(iosStartPath())
    const oauthState = cookieOf(start, 'oauth_state')!
    const desktop = cookieOf(start, 'desktop_auth')!
    return get(`/auth/discord/callback?code=c&state=${oauthState}`, {
      cookie: `oauth_state=${oauthState}; desktop_auth=${desktop}`
    })
  }

  it('the iOS app starts the desktop flow without a port', async () => {
    const res = await get(iosStartPath())
    expect(res.status).toBe(302)
    expect(cookieOf(res, 'desktop_auth')).toBe(`ios.${STATE}.${CHALLENGE}`)
    for (const path of [
      `/auth/desktop/start?app=android&state=${STATE}&challenge=${CHALLENGE}`,
      `/auth/desktop/start?app=ios&port=53682&state=${STATE}&challenge=${CHALLENGE}`,
      iosStartPath('short')
    ]) {
      const bad = await get(path)
      expect(bad.status, path).toBe(400)
      expect(bad.headers.getSetCookie()).toEqual([])
    }
  })

  it("the iOS app's code comes back on its own URL scheme and trades like a desktop code", async () => {
    const res = await iosCallback()
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('location')!)
    expect(loc.protocol + loc.host + loc.pathname).toBe('duelbinder:auth/callback')
    expect(loc.searchParams.get('state')).toBe(STATE)
    const code = loc.searchParams.get('code')!
    const token = await post('/auth/desktop/token', { code, verifier: VERIFIER })
    expect(token.status).toBe(200)
  })

  it('a failed iOS sign-in tells the app on its URL scheme', async () => {
    tokenStatus = 500
    const res = await iosCallback()
    expect(res.headers.get('location')).toBe(
      `duelbinder://auth/callback?error=signin-failed&state=${STATE}`
    )
  })

  it('token exchange returns a desktop token for the right verifier only', async () => {
    const code = await desktopCode()
    const wrong = await post('/auth/desktop/token', { code, verifier: VERIFIER + 'x' })
    expect(wrong.status).toBe(400)
    expect(await wrong.json()).toEqual({ error: 'invalid-code' })
    const reused = await post('/auth/desktop/token', { code, verifier: VERIFIER })
    expect(reused.status).toBe(400)
    expect(await reused.json()).toEqual({ error: 'invalid-code' })

    const res = await post('/auth/desktop/token', { code: await desktopCode(), verifier: VERIFIER })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string; user: unknown }
    const user = db.prepare('SELECT id FROM users').get() as { id: number }
    expect(body.user).toEqual({
      id: user.id,
      username: 'kaiba',
      displayName: 'Seto',
      avatarUrl: 'https://cdn.discordapp.com/avatars/111/abc.png',
      games: ['ygo']
    })
    expect(sessionRow(body.token)).toEqual({
      kind: 'desktop',
      expires_at: new Date(clock.getTime() + 365 * DAY).toISOString()
    })
    expect(db.prepare('SELECT COUNT(*) AS n FROM desktop_codes').get()).toEqual({ n: 0 })
  })

  it('token exchange refuses malformed bodies', async () => {
    expect((await post('/auth/desktop/token', { code: 1, verifier: VERIFIER })).status).toBe(400)
    expect((await post('/auth/desktop/token', null)).status).toBe(400)
    const res = await handle(
      new Request(BASE + '/auth/desktop/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{'
      }),
      deps
    )
    expect(res.status).toBe(400)
  })

  it('a missing, non-string or malformed verifier still spends the code', async () => {
    for (const bad of [
      {},
      { verifier: 42 },
      { verifier: 'short' },
      { verifier: VERIFIER.replace('-', '+') }
    ]) {
      const code = await desktopCode()
      const res = await post('/auth/desktop/token', { code, ...bad })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid-code' })
      expect(db.prepare('SELECT COUNT(*) AS n FROM desktop_codes').get()).toEqual({ n: 0 })
      expect((await post('/auth/desktop/token', { code, verifier: VERIFIER })).status).toBe(400)
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 })
  })

  it('a verifier outside RFC 7636 is refused even when its hash matches', async () => {
    await desktopCode() // creates the user
    const userId = (db.prepare('SELECT id FROM users').get() as { id: number }).id
    for (const verifier of ['short-but-matching', 'x'.repeat(129), 'has space'.padEnd(50, 'y')]) {
      const code = `forged-${verifier.length}`
      db.prepare(
        'INSERT INTO desktop_codes (code_hash, user_id, challenge, expires_at) VALUES (?, ?, ?, ?)'
      ).run(
        sha256Hex(code),
        userId,
        createHash('sha256').update(verifier).digest('base64url'),
        new Date(clock.getTime() + 60_000).toISOString()
      )
      expect((await post('/auth/desktop/token', { code, verifier })).status).toBe(400)
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 })
  })

  it('a forged desktop cookie falls through to the web flow', async () => {
    for (const forged of [
      `53682.evil.com/x.${CHALLENGE}`,
      `53682.${STATE}.${CHALLENGE}.extra`,
      `80.${STATE}.${CHALLENGE}`,
      `android.${STATE}.${CHALLENGE}`
    ]) {
      const start = await get('/auth/discord/start')
      const oauthState = cookieOf(start, 'oauth_state')!
      const res = await get(`/auth/discord/callback?code=c&state=${oauthState}`, {
        cookie: `oauth_state=${oauthState}; desktop_auth=${forged}`
      })
      expect(res.status).toBe(302)
      const location = res.headers.get('location')!
      expect(location).not.toContain('127.0.0.1')
      expect(location).toBe('/')
      expect(cookieOf(res, 'session')).toBeTruthy()
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM desktop_codes').get()).toEqual({ n: 0 })
  })

  it('an expired code is refused', async () => {
    const code = await desktopCode()
    clock = new Date(clock.getTime() + 121_000)
    const res = await post('/auth/desktop/token', { code, verifier: VERIFIER })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid-code' })
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 })
  })

  it("bearer tokens and cookies don't cross over", async () => {
    const desktop = await desktopToken()
    const web = await webToken()
    expect((await get('/api/me', { authorization: `Bearer ${desktop}` })).status).toBe(200)
    expect(
      (
        await post(
          '/api/rpc/collection:list',
          { args: [{}] },
          { authorization: `Bearer ${desktop}` }
        )
      ).status
    ).toBe(200)
    expect((await get('/api/me', { cookie: `session=${desktop}` })).status).toBe(401)
    expect((await get('/api/me', { authorization: `Bearer ${web}` })).status).toBe(401)
    expect(
      (await post('/api/rpc/collection:list', { args: [{}] }, { authorization: `Bearer ${web}` }))
        .status
    ).toBe(401)
    // A Bearer header wins over a valid web cookie.
    expect(
      (await get('/api/me', { authorization: `Bearer ${web}`, cookie: `session=${web}` })).status
    ).toBe(401)
    expect((await get('/api/me', { cookie: `session=${web}` })).status).toBe(200)
  })

  it('revoke deletes only that desktop session', async () => {
    const a = await desktopToken()
    const b = await desktopToken()
    const web = await webToken()
    expect((await post('/auth/desktop/revoke', {})).status).toBe(401)
    expect((await post('/auth/desktop/revoke', {}, { cookie: `session=${web}` })).status).toBe(401)
    const res = await post('/auth/desktop/revoke', {}, { authorization: `Bearer ${a}` })
    expect(res.status).toBe(204)
    expect(sessionRow(a)).toBeUndefined()
    expect(sessionRow(b)?.kind).toBe('desktop')
    expect(sessionRow(web)?.kind).toBe('web')
    expect((await get('/api/me', { authorization: `Bearer ${a}` })).status).toBe(401)
    expect((await post('/auth/desktop/revoke', {}, { authorization: `Bearer ${a}` })).status).toBe(
      401
    )
  })

  it('desktop expiry slides on use', async () => {
    const token = await desktopToken()
    const issued = sessionRow(token)!.expires_at
    clock = new Date(clock.getTime() + 12 * 60 * 60 * 1000) // half a day: still within 364 days of expiry
    await get('/api/me', { authorization: `Bearer ${token}` })
    expect(sessionRow(token)!.expires_at).toBe(issued)

    clock = new Date(new Date('2026-10-24T12:00:00.000Z').getTime() + 2 * DAY)
    expect((await get('/api/me', { authorization: `Bearer ${token}` })).status).toBe(200)
    expect(sessionRow(token)!.expires_at).toBe(new Date(clock.getTime() + 365 * DAY).toISOString())
  })

  it('web sign-in clears a stale desktop cookie', async () => {
    const res = await get('/auth/discord/start', {
      cookie: `desktop_auth=53682.${STATE}.${CHALLENGE}`
    })
    expect(res.status).toBe(302)
    expect(rawCookie(res, 'desktop_auth')).toMatch(/^desktop_auth=;.*Max-Age=0/)
  })

  it('expired sessions are pruned at sign-in', async () => {
    const web = await webToken()
    await desktopCode() // left unused
    clock = new Date(clock.getTime() + 31 * DAY)
    await webToken()
    expect(sessionRow(web)).toBeUndefined()
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM desktop_codes').get()).toEqual({ n: 0 })
  })
})
