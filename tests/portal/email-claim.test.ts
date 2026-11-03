import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { fakeSender, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'
import { APPLE_NONCE, appleIdentityToken, appleTestKeys } from './appleKeys'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { APPLE_KEYS_URL, APPLE_TOKEN_URL, resetAppleKeys } from '../../workers/portal/src/apple'
import { EMAIL_COPY } from '../../src/shared/emailAuth'
import { hashPassword } from '../../workers/portal/src/password'

const BASE = 'https://portal.test'
const START = new Date('2026-11-02T12:00:00.000Z')
const MIN = 60 * 1000
const EMAIL = 'duelist@x.io'
const PASSWORD = 'hunter2hunter2'
const VERIFIER = 'v'.repeat(43)
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')
const STATE = 's'.repeat(24)

type Reply = Record<string, unknown> & {
  next?: string
  error?: string
  token?: string
  user?: { id: number }
}

describe('offering a first Discord or Apple sign-in the email account that uses its email', () => {
  let db: Database.Database
  let deps: AppDeps
  let clock: Date
  let discordUser: { id: string; username: string; email?: string; verified?: boolean }
  let emailUser: number

  beforeEach(async () => {
    resetAppleKeys()
    clock = new Date(START)
    discordUser = { id: '111', username: 'kaiba', email: EMAIL, verified: true }
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
        DISCORD_CLIENT_ID: 'cid',
        DISCORD_CLIENT_SECRET: 'secret',
        ADMIN_TOKEN: 'admin',
        PRICE_WORKER_URL: 'https://prices.test',
        EMAIL_SIGN_IN: 'on'
      } as AppDeps['env'],
      email: fakeSender(),
      now: () => clock,
      fetch: (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === APPLE_KEYS_URL) return new Response(JSON.stringify(appleTestKeys().jwks))
        if (url === 'https://discord.com/api/oauth2/token')
          return new Response(JSON.stringify({ access_token: 'at' }))
        if (url === 'https://discord.com/api/users/@me')
          return new Response(JSON.stringify(discordUser))
        return new Response('?', { status: 404 })
      }) as unknown as typeof fetch
    }
    // The email account.
    const now = START.toISOString()
    emailUser = Number(
      db
        .prepare(
          'INSERT INTO users (discord_id, username, created_at, updated_at) VALUES (?, ?, ?, ?)'
        )
        .run('user:0', 'emailer', now, now).lastInsertRowid
    )
    db.prepare(
      "INSERT INTO sign_ins (provider, subject, user_id, created_at, email, password_hash) VALUES ('email', ?, ?, ?, ?, ?)"
    ).run(EMAIL, emailUser, now, EMAIL, await hashPassword(PASSWORD))
  })

  afterEach(() => vi.restoreAllMocks())

  const count = (sql: string, ...args: unknown[]): number =>
    (db.prepare(sql).get(...args) as { n: number }).n
  const users = (): number => count('SELECT count(*) AS n FROM users')
  const providersOf = (userId: number): string[] =>
    (
      db
        .prepare('SELECT provider FROM sign_ins WHERE user_id = ? ORDER BY provider')
        .all(userId) as { provider: string }[]
    ).map((r) => r.provider)
  const cookieOf = (res: Response, name: string): string | undefined => {
    for (const c of res.headers.getSetCookie()) {
      const m = c.match(new RegExp(`^${name}=([^;]*)`))
      if (m) return m[1]
    }
    return undefined
  }
  const get = (path: string, cookie?: string): Promise<Response> =>
    handle(new Request(BASE + path, { headers: cookie ? { cookie } : {} }), deps)
  const post = async (
    path: string,
    body: unknown,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; body: Reply }> => {
    const res = await handle(
      new Request(BASE + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1', ...headers },
        body: JSON.stringify(body)
      }),
      deps
    )
    return { status: res.status, body: (await res.json()) as Reply }
  }
  const step = (name: string, body: Record<string, unknown>) => post(`/auth/email/${name}`, body)

  async function desktopCallback(offer: boolean): Promise<URL> {
    const start = await get(
      `/auth/desktop/start?port=53682&state=${STATE}&challenge=${CHALLENGE}${offer ? '&offer=email' : ''}`
    )
    const oauth = cookieOf(start, 'oauth_state')!
    const desktop = cookieOf(start, 'desktop_auth')!
    const res = await get(
      `/auth/discord/callback?code=c&state=${oauth}`,
      `oauth_state=${oauth}; desktop_auth=${desktop}`
    )
    return new URL(res.headers.get('location')!)
  }
  async function desktopClaim(): Promise<string> {
    const loc = await desktopCallback(true)
    return loc.searchParams.get('claim')!
  }

  it('desktop Discord sign-in with offer=email and a matching email account hands back a claim', async () => {
    const before = users()
    const loc = await desktopCallback(true)
    expect(loc.origin + loc.pathname).toBe('http://127.0.0.1:53682/callback')
    expect(loc.searchParams.get('state')).toBe(STATE)
    expect(loc.searchParams.get('code')).toBeNull()
    expect(loc.searchParams.get('email')).toBe(EMAIL)
    expect(loc.searchParams.get('claim')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(users()).toBe(before)
    expect(count("SELECT count(*) AS n FROM sign_ins WHERE provider = 'discord'")).toBe(0)
  })

  it('with the email switch off a desktop offer=email gets a plain sign-in, no claim', async () => {
    deps.env.EMAIL_SIGN_IN = 'off'
    const before = users()
    const loc = await desktopCallback(true)
    expect(loc.searchParams.get('claim')).toBeNull()
    expect(loc.searchParams.get('code')).not.toBeNull()
    expect(users()).toBe(before + 1)
  })

  it('with the email switch off a web Discord sign-in is not sent to the claim page', async () => {
    deps.env.EMAIL_SIGN_IN = 'off'
    const start = await get('/auth/discord/start')
    const oauth = cookieOf(start, 'oauth_state')!
    const res = await get(`/auth/discord/callback?code=c&state=${oauth}`, `oauth_state=${oauth}`)
    expect(res.headers.get('location') ?? '').not.toContain('/auth/email/claim')
    expect(cookieOf(res, 'email_claim')).toBeUndefined()
    expect(count("SELECT count(*) AS n FROM sign_ins WHERE provider = 'discord'")).toBe(1)
  })

  it('no offer without offer=email', async () => {
    const before = users()
    const loc = await desktopCallback(false)
    expect(loc.searchParams.get('code')).not.toBeNull()
    expect(loc.searchParams.get('claim')).toBeNull()
    expect(users()).toBe(before + 1)
  })

  it('an unverified email or no matching account offers nothing', async () => {
    discordUser.verified = false
    expect((await desktopCallback(true)).searchParams.get('code')).not.toBeNull()
    discordUser = { id: '222', username: 'x', email: 'other@x.io', verified: true }
    expect((await desktopCallback(true)).searchParams.get('code')).not.toBeNull()
  })

  it('a closed email account is not offered', async () => {
    db.prepare('UPDATE users SET closed_at = ? WHERE id = ?').run(START.toISOString(), emailUser)
    expect((await desktopCallback(true)).searchParams.get('code')).not.toBeNull()
  })

  it('a Discord user who already has an account just signs in', async () => {
    await desktopCallback(false)
    const loc = await desktopCallback(true)
    expect(loc.searchParams.get('code')).not.toBeNull()
  })

  it('claim with the right password links Discord to the email account', async () => {
    const claim = await desktopClaim()
    const before = users()
    const r = await step('claim', { ticket: claim, password: PASSWORD, verifier: VERIFIER })
    expect(r.body).toMatchObject({ next: 'signed-in', created: false })
    expect(r.body.user!.id).toBe(emailUser)
    expect(users()).toBe(before)
    expect(providersOf(emailUser)).toEqual(['discord', 'email'])
    expect(db.prepare("SELECT email FROM sign_ins WHERE provider = 'discord'").get()).toEqual({
      email: EMAIL
    })
    expect(db.prepare('SELECT discord_id FROM users WHERE id = ?').get(emailUser)).toEqual({
      discord_id: '111'
    })
    const me = await handle(
      new Request(`${BASE}/api/me`, { headers: { authorization: `Bearer ${r.body.token}` } }),
      deps
    )
    expect(((await me.json()) as { id: number }).id).toBe(emailUser)
    // A later Discord sign-in reaches it, and the claim is spent.
    const again = await desktopCallback(true)
    expect(again.searchParams.get('code')).not.toBeNull()
    expect(users()).toBe(before)
    expect(count('SELECT count(*) AS n FROM provider_claims')).toBe(0)
    const reuse = await step('claim', { ticket: claim, password: PASSWORD, verifier: VERIFIER })
    expect(reuse.body.error).toBe(EMAIL_COPY.codeExpired)
  })

  it('claim needs the PKCE verifier', async () => {
    const claim = await desktopClaim()
    for (const verifier of ['w'.repeat(43), undefined, 'short']) {
      const r = await step('claim', { ticket: claim, password: PASSWORD, verifier })
      expect(r.status).toBe(400)
      expect(r.body.error).toBe(EMAIL_COPY.codeExpired)
    }
    const sep = await step('claim-separate', { ticket: claim, verifier: 'w'.repeat(43) })
    expect(sep.body.error).toBe(EMAIL_COPY.codeExpired)
    expect(providersOf(emailUser)).toEqual(['email'])
    expect(
      (await step('claim', { ticket: claim, password: PASSWORD, verifier: VERIFIER })).body.next
    ).toBe('signed-in')
  })

  it('a wrong password keeps the claim; the limit applies', async () => {
    const claim = await desktopClaim()
    for (let i = 0; i < 10; i++) {
      const r = await step('claim', {
        ticket: claim,
        password: 'nope-nope-nope',
        verifier: VERIFIER
      })
      expect(r).toMatchObject({ status: 400, body: { error: EMAIL_COPY.wrongPassword } })
    }
    expect(count('SELECT count(*) AS n FROM provider_claims')).toBe(1)
    const limited = await step('claim', { ticket: claim, password: PASSWORD, verifier: VERIFIER })
    expect(limited).toMatchObject({ status: 429, body: { error: EMAIL_COPY.tooManyTries } })
    expect(providersOf(emailUser)).toEqual(['email'])
    clock = new Date(clock.getTime() + 16 * MIN)
    // The claim itself lasts 15 minutes only.
    expect(
      (await step('claim', { ticket: claim, password: PASSWORD, verifier: VERIFIER })).body.error
    ).toBe(EMAIL_COPY.codeExpired)
  })

  it('a right password after some wrong ones signs in and forgets the attempt', async () => {
    const claim = await desktopClaim()
    await step('claim', { ticket: claim, password: 'nope-nope-nope', verifier: VERIFIER })
    const ok = await step('claim', { ticket: claim, password: PASSWORD, verifier: VERIFIER })
    expect(ok.body.next).toBe('signed-in')
    expect(count("SELECT count(*) AS n FROM auth_limits WHERE kind = 'password-email'")).toBe(1)
  })

  it('an account that already has this provider refuses the link', async () => {
    const claim = await desktopClaim()
    db.prepare(
      "INSERT INTO sign_ins (provider, subject, user_id, created_at) VALUES ('discord', '999', ?, ?)"
    ).run(emailUser, START.toISOString())
    const r = await step('claim', { ticket: claim, password: PASSWORD, verifier: VERIFIER })
    expect(r).toMatchObject({ status: 400, body: { error: EMAIL_COPY.alsoHas('discord') } })
    expect(providersOf(emailUser)).toEqual(['discord', 'email'])
    expect((await step('claim-separate', { ticket: claim, verifier: VERIFIER })).body.created).toBe(
      true
    )
  })

  it('claim-separate makes the Discord account', async () => {
    const claim = await desktopClaim()
    const before = users()
    const r = await step('claim-separate', { ticket: claim, verifier: VERIFIER })
    expect(r.body).toMatchObject({ next: 'signed-in', created: true })
    expect(users()).toBe(before + 1)
    expect(r.body.user!.id).not.toBe(emailUser)
    expect(providersOf(r.body.user!.id)).toEqual(['discord'])
    expect(providersOf(emailUser)).toEqual(['email'])
    expect(db.prepare('SELECT username FROM users WHERE id = ?').get(r.body.user!.id)).toEqual({
      username: 'kaiba'
    })
    expect(count('SELECT count(*) AS n FROM provider_claims')).toBe(0)
  })

  it('a claim dies after 15 minutes', async () => {
    const claim = await desktopClaim()
    clock = new Date(clock.getTime() + 15 * MIN + 1000)
    const r = await step('claim', { ticket: claim, password: PASSWORD, verifier: VERIFIER })
    expect(r.body.error).toBe(EMAIL_COPY.codeExpired)
    const s = await step('claim-separate', { ticket: claim, verifier: VERIFIER })
    expect(s.body.error).toBe(EMAIL_COPY.codeExpired)
  })

  it('a right password that is then refused does not count against the limits', async () => {
    const claim = await desktopClaim()
    db.prepare(
      "INSERT INTO sign_ins (provider, subject, user_id, created_at) VALUES ('discord', '999', ?, ?)"
    ).run(emailUser, START.toISOString())
    const r = await step('claim', { ticket: claim, password: PASSWORD, verifier: VERIFIER })
    expect(r.body.error).toBe(EMAIL_COPY.alsoHas('discord'))
    expect(count('SELECT count(*) AS n FROM auth_limits')).toBe(0)
  })

  it('a desktop ticket used as a web one is expired', async () => {
    const claim = await desktopClaim()
    const { runEmailStep } = await import('../../workers/portal/src/emailAuth')
    await expect(
      runEmailStep(
        deps,
        'claim',
        { password: PASSWORD },
        {
          ip: '1.1.1.1',
          claimKind: 'web',
          claimTicket: claim
        }
      )
    ).rejects.toMatchObject({ message: EMAIL_COPY.codeExpired, code: 'expired' })
    expect(providersOf(emailUser)).toEqual(['email'])
  })

  it('12 parallel wrong passwords: exactly 10 are answered, the rest are limited', async () => {
    const claim = await desktopClaim()
    const all = await Promise.all(
      Array.from({ length: 12 }, () =>
        step('claim', { ticket: claim, password: 'nope-nope-nope', verifier: VERIFIER })
      )
    )
    expect(all.filter((r) => r.status === 400)).toHaveLength(10)
    expect(all.filter((r) => r.status === 429)).toHaveLength(2)
  })

  it('an email account closed after the claim was made is not linked', async () => {
    const claim = await desktopClaim()
    db.prepare('UPDATE users SET closed_at = ? WHERE id = ?').run(START.toISOString(), emailUser)
    const r = await step('claim', { ticket: claim, password: PASSWORD, verifier: VERIFIER })
    expect(r.status).toBe(400)
    expect(r.body.token).toBeUndefined()
    expect(providersOf(emailUser)).toEqual(['email'])
  })

  it('a link flow ignores offer=email', async () => {
    const start = await get(
      `/auth/desktop/start?port=53682&state=${STATE}&challenge=${CHALLENGE}&intent=link&offer=email`
    )
    const cookie = cookieOf(start, 'desktop_auth')!
    expect(cookie).toBe(`53682.${STATE}.${CHALLENGE}.link`)
    const oauth = cookieOf(start, 'oauth_state')!
    const res = await get(
      `/auth/discord/callback?code=c&state=${oauth}`,
      `oauth_state=${oauth}; desktop_auth=${cookie}`
    )
    const loc = new URL(res.headers.get('location')!)
    expect(loc.searchParams.get('code')).not.toBeNull()
    expect(loc.searchParams.get('claim')).toBeNull()
    expect(count('SELECT count(*) AS n FROM link_codes')).toBe(1)
    expect(count('SELECT count(*) AS n FROM provider_claims')).toBe(0)
  })

  describe('Apple', () => {
    const appleBody = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
      identityToken: appleIdentityToken(clock, { email: EMAIL, email_verified: true }),
      nonce: APPLE_NONCE,
      ...extra
    })

    it('offerLink returns a claim without a verifier, and claim works without one', async () => {
      const before = users()
      const r = await post('/auth/apple/token', appleBody({ offerLink: true }))
      expect(r.status).toBe(200)
      expect(r.body).toMatchObject({ email: EMAIL, provider: 'apple' })
      expect(r.body.token).toBeUndefined()
      expect(JSON.stringify(r.body)).not.toContain('refresh')
      expect(users()).toBe(before)
      const claim = r.body.claim as string
      const done = await step('claim', { ticket: claim, password: PASSWORD })
      expect(done.body).toMatchObject({ next: 'signed-in', created: false })
      expect(done.body.user!.id).toBe(emailUser)
      expect(providersOf(emailUser)).toEqual(['apple', 'email'])
    })

    it('a successful claim keeps the refresh token in apple_tokens, never returned', async () => {
      const { signinPem } = appleTestKeys()
      deps.env = {
        ...deps.env,
        APPLE_TEAM_ID: 'TEAM123456',
        APPLE_SIGNIN_KEY_ID: 'KEY1234567',
        APPLE_SIGNIN_KEY: signinPem
      }
      const inner = deps.fetch
      deps.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === APPLE_TOKEN_URL) {
          const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url')
          return new Response(
            JSON.stringify({
              refresh_token: 'rt-claim',
              access_token: 'at',
              id_token: `${b64({ alg: 'RS256' })}.${b64({ sub: '000123.abc' })}.sig`
            })
          )
        }
        return inner(input, init)
      }) as typeof fetch
      const r = await post(
        '/auth/apple/token',
        appleBody({ offerLink: true, authorizationCode: 'c0de' })
      )
      expect(JSON.stringify(r.body)).not.toContain('rt-claim')
      expect(count('SELECT count(*) AS n FROM apple_tokens')).toBe(0)
      await step('claim', { ticket: r.body.claim, password: PASSWORD })
      expect(db.prepare('SELECT user_id, refresh_token FROM apple_tokens').get()).toEqual({
        user_id: emailUser,
        refresh_token: 'rt-claim'
      })
    })

    it('without offerLink the sign-in makes an account as before', async () => {
      const r = await post('/auth/apple/token', appleBody())
      expect(r.body.token).toBeTruthy()
      expect(r.body.claim).toBeUndefined()
    })

    it('with the email switch off offerLink gets a token, no claim', async () => {
      deps.env.EMAIL_SIGN_IN = 'off'
      const r = await post('/auth/apple/token', appleBody({ offerLink: true }))
      expect(r.body.claim).toBeUndefined()
      expect(r.body.token).toBeTruthy()
    })

    it('claim-separate makes the Apple account', async () => {
      const r = await post('/auth/apple/token', appleBody({ offerLink: true }))
      const s = await step('claim-separate', { ticket: r.body.claim })
      expect(s.body).toMatchObject({ next: 'signed-in', created: true })
      expect(providersOf(s.body.user!.id)).toEqual(['apple'])
    })
  })

  describe('on the web', () => {
    it('a Discord callback with a match sets email_claim and redirects to /auth/email/claim', async () => {
      const start = await get('/auth/discord/start')
      const state = cookieOf(start, 'oauth_state')!
      const before = users()
      const res = await get(`/auth/discord/callback?code=c&state=${state}`, `oauth_state=${state}`)
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/auth/email/claim')
      const set = res.headers.getSetCookie().find((c) => c.startsWith('email_claim='))!
      expect(set).toMatch(/HttpOnly/)
      expect(set).toMatch(/Secure/)
      expect(set).toMatch(/SameSite=Lax/)
      expect(set).toMatch(/Path=\/auth/)
      expect(set).toMatch(/Max-Age=900/)
      expect(cookieOf(res, 'session')).toBeUndefined()
      expect(users()).toBe(before)
    })

    it('runEmailStep reads the web ticket from the cookie value, not the body', async () => {
      const start = await get('/auth/discord/start')
      const state = cookieOf(start, 'oauth_state')!
      const res = await get(`/auth/discord/callback?code=c&state=${state}`, `oauth_state=${state}`)
      const ticket = cookieOf(res, 'email_claim')!
      const { runEmailStep } = await import('../../workers/portal/src/emailAuth')
      const ctx = { ip: '1.1.1.1', claimKind: 'web' as const, claimTicket: ticket }
      // A web ticket is no good to the JSON route, which asks for a desktop one.
      const viaJson = await step('claim', { ticket, password: PASSWORD })
      expect(viaJson.body.error).toBe(EMAIL_COPY.codeExpired)
      const out = await runEmailStep(deps, 'claim', { password: PASSWORD }, ctx)
      expect(out).toMatchObject({ next: 'signed-in', userId: emailUser, created: false })
    })
  })
})
