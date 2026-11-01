import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { memoryBucket, noPrintingArt, noPrices } from './helpers'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { migrateServer } from '../../workers/portal/src/migrate'
import { withOwnerOnlyPokemon } from '../fixtures/ownerOnlyGame'

withOwnerOnlyPokemon()

const BASE = 'https://portal.test'
let clock = new Date('2026-10-24T12:00:00.000Z')

interface Discord {
  tokenStatus: number
  user: { id: string; username: string; global_name?: string | null; avatar?: string | null }
}

describe('Discord sign-in and sessions', () => {
  let db: Database.Database
  let discord: Discord
  let fetchMock: ReturnType<typeof vi.fn>
  let deps: AppDeps
  let assetsFetch: ReturnType<typeof vi.fn<(r: Request) => Promise<Response>>>

  beforeEach(() => {
    clock = new Date('2026-10-24T12:00:00.000Z')
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrateServer(db)
    discord = {
      tokenStatus: 200,
      user: { id: '111', username: 'kaiba', global_name: 'Seto', avatar: 'abc' }
    }
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://discord.com/api/oauth2/token') {
        return discord.tokenStatus === 200
          ? new Response(JSON.stringify({ access_token: 'at' }), { status: 200 })
          : new Response('boom', { status: discord.tokenStatus })
      }
      if (url === 'https://discord.com/api/users/@me')
        return new Response(JSON.stringify(discord.user), { status: 200 })
      return new Response('?', { status: 404 })
    })
    assetsFetch = vi.fn(async (_r: Request) => new Response('nope', { status: 404 }))
    deps = {
      db,
      assets: { fetch: assetsFetch },
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
  const get = (path: string, cookie?: string) =>
    handle(new Request(BASE + path, { headers: cookie ? { cookie } : {} }), deps)

  async function startState(): Promise<string> {
    const res = await get('/auth/discord/start')
    return cookieOf(res, 'oauth_state')!
  }
  async function signIn(): Promise<string> {
    const state = await startState()
    const res = await get(`/auth/discord/callback?code=c&state=${state}`, `oauth_state=${state}`)
    expect(res.headers.get('location')).toBe('/')
    return cookieOf(res, 'session')!
  }

  it('start redirects to Discord with state cookie', async () => {
    const res = await get('/auth/discord/start')
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('location')!)
    expect(loc.origin + loc.pathname).toBe('https://discord.com/oauth2/authorize')
    expect(loc.searchParams.get('scope')).toBe('identify')
    expect(loc.searchParams.get('client_id')).toBe('cid')
    expect(loc.searchParams.get('redirect_uri')).toBe(`${BASE}/auth/discord/callback`)
    const state = cookieOf(res, 'oauth_state')
    expect(state).toBeTruthy()
    expect(loc.searchParams.get('state')).toBe(state)
    const raw = res.headers.getSetCookie().find((c) => c.startsWith('oauth_state='))!
    expect(raw).toMatch(/HttpOnly/)
    expect(raw).toMatch(/Secure/)
    expect(raw).toMatch(/SameSite=Lax/)
    expect(raw).toMatch(/Max-Age=600/)
  })

  it('start on another host redirects to PUBLIC_URL before setting a cookie', async () => {
    const res = await handle(
      new Request('https://portal.example.workers.dev/auth/discord/start'),
      deps
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${BASE}/auth/discord/start`)
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it('callback creates user and session, then /api/me returns them', async () => {
    const state = await startState()
    const res = await get(`/auth/discord/callback?code=c&state=${state}`, `oauth_state=${state}`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/')
    const raw = res.headers.getSetCookie().find((c) => c.startsWith('session='))!
    expect(raw).toMatch(/HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=2592000/)
    expect(
      res.headers.getSetCookie().some((c) => c.startsWith('oauth_state=;') && /Max-Age=0/.test(c))
    ).toBe(true)

    const tokenCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/oauth2/token'))!
    const body = new URLSearchParams(String((tokenCall[1] as RequestInit).body))
    expect(Object.fromEntries(body)).toMatchObject({
      client_id: 'cid',
      client_secret: 'secret',
      grant_type: 'authorization_code',
      code: 'c',
      redirect_uri: `${BASE}/auth/discord/callback`
    })

    const me = await get('/api/me', `session=${cookieOf(res, 'session')}`)
    expect(me.status).toBe(200)
    const user = db.prepare('SELECT id FROM users WHERE discord_id = ?').get('111') as {
      id: number
    }
    expect(await me.json()).toEqual({
      id: user.id,
      username: 'kaiba',
      displayName: 'Seto',
      avatarUrl: 'https://cdn.discordapp.com/avatars/111/abc.png',
      games: ['ygo']
    })
  })

  it('signing in again updates the username, keeps the user id', async () => {
    await signIn()
    const before = db.prepare('SELECT id FROM users').get() as { id: number }
    discord.user = { id: '111', username: 'kaiba2', global_name: 'Seto K', avatar: null }
    const token = await signIn()
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 })
    const me = await (await get('/api/me', `session=${token}`)).json()
    expect(me).toEqual({
      id: before.id,
      username: 'kaiba2',
      displayName: 'Seto K',
      avatarUrl: null,
      games: ['ygo']
    })
  })

  it('renaming into a username held by a stale row moves the stale row aside', async () => {
    await signIn() // discord 111 = kaiba
    discord.user = { id: '222', username: 'yugi' }
    await signIn()
    // 111 still holds 'kaiba' (stale); 222 now takes it
    discord.user = { id: '222', username: 'Kaiba' }
    await signIn()
    const rows = db.prepare('SELECT discord_id, username FROM users ORDER BY discord_id').all()
    expect(rows).toEqual([
      { discord_id: '111', username: 'Kaiba#111' },
      { discord_id: '222', username: 'Kaiba' }
    ])
  })

  it('state mismatch → /?signin=failed and no user', async () => {
    const state = await startState()
    const res = await get(`/auth/discord/callback?code=c&state=${state}`, 'oauth_state=other')
    expect(res.headers.get('location')).toBe('/?signin=failed')
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('error=access_denied → /?signin=failed', async () => {
    const state = await startState()
    const res = await get(
      `/auth/discord/callback?error=access_denied&state=${state}`,
      `oauth_state=${state}`
    )
    expect(res.headers.get('location')).toBe('/?signin=failed')
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 })
  })

  it('Discord token exchange 500 → /?signin=failed', async () => {
    discord.tokenStatus = 500
    const state = await startState()
    const res = await get(`/auth/discord/callback?code=c&state=${state}`, `oauth_state=${state}`)
    expect(res.headers.get('location')).toBe('/?signin=failed')
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 })
  })

  it("tells only the site's origin who's signed in, and just their name and picture", async () => {
    const token = await signIn()
    const ask = (cookie: string | null, origin: string): Promise<Response> =>
      handle(
        new Request(`${BASE}/api/site-account`, {
          headers: { origin, ...(cookie ? { cookie } : {}) }
        }),
        deps
      )
    const site = 'https://site.test'

    const res = await ask(`session=${token}`, site)
    expect(res.headers.get('access-control-allow-origin')).toBe(site)
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(['avatarUrl', 'name'])

    const other = await ask(`session=${token}`, 'https://evil.test')
    expect(other.headers.get('access-control-allow-origin')).toBeNull()
    expect(other.headers.get('access-control-allow-credentials')).toBeNull()

    const out = await ask(null, site)
    expect(out.status).toBe(204)
    expect(out.headers.getSetCookie()).toEqual([])
  })

  it('expired session → 401 and Set-Cookie clears session', async () => {
    const token = await signIn()
    clock = new Date('2026-11-24T12:00:00.000Z') // past 30 days
    const res = await get('/api/me', `session=${token}`)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'signed-out' })
    const raw = res.headers.getSetCookie().find((c) => c.startsWith('session=;'))!
    expect(raw).toMatch(/Max-Age=0/)
  })

  it('no cookie → 401', async () => {
    expect((await get('/api/me')).status).toBe(401)
  })

  it('logout deletes the session row', async () => {
    const token = await signIn()
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 })
    const res = await handle(
      new Request(BASE + '/auth/logout', {
        method: 'POST',
        headers: { cookie: `session=${token}` }
      }),
      deps
    )
    expect(res.status).toBe(204)
    expect(
      res.headers.getSetCookie().some((c) => c.startsWith('session=;') && /Max-Age=0/.test(c))
    ).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 })
  })

  it('logout from the page form goes back to the front page', async () => {
    const token = await signIn()
    const res = await handle(
      new Request(BASE + '/auth/logout', {
        method: 'POST',
        headers: {
          cookie: `session=${token}`,
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: ''
      }),
      deps
    )
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 })
  })

  it('front page offers sign-in when signed out', async () => {
    const res = await get('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const html = await res.text()
    expect(html).toContain('href="/auth/discord/start"')
    expect(html).toContain('Sign in with Discord to open your binder in the browser.')
    expect(html).not.toContain('on its way')
    expect(html).toContain('href="https://site.test/site.css"')
    expect(html).not.toContain("didn't go through")
  })

  it('front page says when sign-in failed', async () => {
    expect(await (await get('/?signin=failed')).text()).toContain("Sign-in didn't go through")
  })

  it('front page greets a signed-in user by display name, escaped', async () => {
    discord.user.global_name = 'Seto <Kaiba>'
    const token = await signIn()
    const html = await (await get('/', `session=${token}`)).text()
    expect(html).toContain('Signed in as Seto &lt;Kaiba&gt;.')
    expect(html).toContain('action="/auth/logout"')
    expect(html).not.toContain('/auth/discord/start')
  })

  it('front page serves the web app to a signed-in user', async () => {
    assetsFetch.mockImplementation(async (r: Request) =>
      new URL(r.url).pathname === '/app/web.html'
        ? new Response('<!doctype html><div id="root">', { status: 200 })
        : new Response('nope', { status: 404 })
    )
    const token = await signIn()
    const res = await get('/', `session=${token}`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('id="root"')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('content-security-policy')).toContain(
      "img-src 'self' data: https://cdn.discordapp.com"
    )
  })

  it("front page falls back to the placeholder when the app isn't built", async () => {
    const token = await signIn()
    const html = await (await get('/', `session=${token}`)).text()
    expect(html).toContain('Signed in as')
    expect(html).toContain(
      "The web app couldn't load. Try refreshing; your collection is safe in the desktop app."
    )
  })

  it('front page answers HEAD with no body', async () => {
    const res = await handle(new Request(BASE + '/', { method: 'HEAD' }), deps)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  it('session token is not stored in plaintext', async () => {
    const token = await signIn()
    const row = db.prepare('SELECT token_hash FROM sessions').get() as { token_hash: string }
    expect(row.token_hash).not.toBe(token)
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
  })
})
