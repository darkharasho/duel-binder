import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import {
  addUser,
  fakeSender,
  memoryBucket,
  noPrintingArt,
  noPrices,
  seededServerDb
} from './helpers'
import { APPLE_NONCE, appleIdentityToken, appleTestKeys } from './appleKeys'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { APPLE_KEYS_URL, resetAppleKeys } from '../../workers/portal/src/apple'
import { EMAIL_COPY } from '../../src/shared/emailAuth'

const BASE = 'https://portal.test'
const START = new Date('2026-11-02T12:00:00.000Z')
const MIN = 60 * 1000
const EMAIL = 'duelist@x.io'
const PASSWORD = 'hunter2hunter2'
const APPLE_SUB = '000123.abc'
const VERIFIER = 'v'.repeat(43)

type Reply = Record<string, unknown> & {
  next?: string
  error?: string
  token?: string
  ticket?: string
  providers?: string[]
  user?: { id: number }
}

describe('matching a sign-up to the account that uses its email', () => {
  let db: Database.Database
  let deps: AppDeps
  let clock: Date
  let sender: ReturnType<typeof fakeSender>
  /** The Discord user the web callback sees. */
  let discordUser: { id: string; username: string; email?: string; verified?: boolean }

  beforeEach(async () => {
    resetAppleKeys()
    clock = new Date(START)
    sender = fakeSender()
    discordUser = { id: '111', username: 'kaiba' }
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
      email: sender,
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
  })

  afterEach(() => vi.restoreAllMocks())

  const advance = (ms: number): void => {
    clock = new Date(clock.getTime() + ms)
  }
  const count = (sql: string, ...args: unknown[]): number =>
    (db.prepare(sql).get(...args) as { n: number }).n
  const users = (): number => count('SELECT count(*) AS n FROM users')
  const sha = (s: string): Buffer => createHash('sha256').update(s).digest()

  async function step(
    name: string,
    body: Record<string, unknown>
  ): Promise<{ status: number; body: Reply }> {
    const res = await handle(
      new Request(`${BASE}/auth/email/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1' },
        body: JSON.stringify(body)
      }),
      deps
    )
    return { status: res.status, body: (await res.json()) as Reply }
  }

  /** A Discord account (id 111) or Apple account whose provider vouched for EMAIL. */
  function seedDiscord(email: string | null = EMAIL, id = '111'): number {
    const userId = addUser(db, id, `user${id}`)
    db.prepare("UPDATE sign_ins SET email = ? WHERE user_id = ? AND provider = 'discord'").run(
      email,
      userId
    )
    return userId
  }
  function seedApple(email: string | null = EMAIL): number {
    const userId = addUser(db, `apple:${APPLE_SUB}`, 'appleuser')
    db.prepare("UPDATE sign_ins SET email = ? WHERE user_id = ? AND provider = 'apple'").run(
      email,
      userId
    )
    return userId
  }

  /** Starts a sign-up and confirms its code; returns the confirm reply. */
  async function signUpTo(email = EMAIL): Promise<{ status: number; body: Reply }> {
    const made = await step('create', { email, password: PASSWORD })
    expect(made.body.next).toBe('code')
    return step('confirm', { ticket: made.body.ticket, code: sender.lastCode() })
  }

  /** A Discord link code, as `/auth/desktop/start?intent=link` leaves behind. */
  function discordLinkCode(subject: string, username = 'x'): string {
    const code = `code-${subject}`
    db.prepare(
      `INSERT INTO link_codes (code_hash, challenge, provider, subject, profile, expires_at)
       VALUES (?, ?, 'discord', ?, ?, ?)`
    ).run(
      sha(code).toString('hex'),
      sha(VERIFIER).toString('base64url'),
      subject,
      JSON.stringify({ username, displayName: null, avatar: null }),
      new Date(clock.getTime() + 2 * MIN).toISOString()
    )
    return code
  }

  const providersOf = (userId: number): string[] =>
    (
      db
        .prepare('SELECT provider FROM sign_ins WHERE user_id = ? ORDER BY provider')
        .all(userId) as {
        provider: string
      }[]
    ).map((r) => r.provider)

  it("a sign-up matching a Discord account's email offers to link", async () => {
    seedDiscord()
    const before = users()
    const r = await signUpTo()
    expect(r.body).toMatchObject({ next: 'match', email: EMAIL, providers: ['discord'] })
    expect(typeof r.body.ticket).toBe('string')
    expect(users()).toBe(before)
    expect(count("SELECT count(*) AS n FROM sign_ins WHERE provider = 'email'")).toBe(0)
  })

  it('link-discord attaches the email to that account and signs in', async () => {
    const discordId = seedDiscord()
    const m = await signUpTo()
    const linked = await step('link-discord', {
      ticket: m.body.ticket,
      code: discordLinkCode('111'),
      verifier: VERIFIER
    })
    expect(linked.body).toMatchObject({ next: 'signed-in', created: false })
    expect(linked.body.user!.id).toBe(discordId)
    expect(providersOf(discordId)).toEqual(['discord', 'email'])
    const again = await step('password', { email: EMAIL, password: PASSWORD })
    expect(again.body.user!.id).toBe(discordId)
    expect(count('SELECT count(*) AS n FROM email_flows')).toBe(0)
    // The ticket is spent.
    const reuse = await step('separate', { ticket: m.body.ticket })
    expect(reuse.body.error).toBe(EMAIL_COPY.codeExpired)
  })

  it('link-discord binds a pending tester invite for that Discord username', async () => {
    const discordId = seedDiscord()
    db.prepare("INSERT INTO game_testers (game, discord_username) VALUES ('op', 'Dub')").run()
    const m = await signUpTo()
    const linked = await step('link-discord', {
      ticket: m.body.ticket,
      code: discordLinkCode('111', 'dub'),
      verifier: VERIFIER
    })
    expect(linked.body).toMatchObject({ next: 'signed-in', created: false })
    expect(
      db.prepare("SELECT user_id FROM game_testers WHERE discord_username = 'Dub'").get()
    ).toEqual({ user_id: discordId })
  })

  it('link-discord with a different Discord account is refused and the choice stays', async () => {
    seedDiscord()
    const stranger = seedDiscord(null, '222')
    const m = await signUpTo()
    const before = users()
    const refused = await step('link-discord', {
      ticket: m.body.ticket,
      code: discordLinkCode('222'),
      verifier: VERIFIER
    })
    expect(refused.status).toBe(400)
    expect(refused.body.error).toBe(EMAIL_COPY.otherAccount('discord'))
    expect(providersOf(stranger)).toEqual(['discord'])
    // A Discord identity with no account at all is refused too, and makes no account.
    const nobody = await step('link-discord', {
      ticket: m.body.ticket,
      code: discordLinkCode('333'),
      verifier: VERIFIER
    })
    expect(nobody.body.error).toBe(EMAIL_COPY.otherAccount('discord'))
    expect(users()).toBe(before)
    const sep = await step('separate', { ticket: m.body.ticket })
    expect(sep.body).toMatchObject({ next: 'signed-in', created: true })
  })

  it('separate makes a new email account and leaves the Discord one alone', async () => {
    const discordId = seedDiscord()
    const m = await signUpTo()
    const before = users()
    const sep = await step('separate', { ticket: m.body.ticket })
    expect(sep.body).toMatchObject({ next: 'signed-in', created: true })
    expect(users()).toBe(before + 1)
    expect(sep.body.user!.id).not.toBe(discordId)
    expect(providersOf(discordId)).toEqual(['discord'])
    expect((await step('password', { email: EMAIL, password: PASSWORD })).body.user!.id).toBe(
      sep.body.user!.id
    )
  })

  it('separate needs a confirmed sign-up ticket', async () => {
    const made = await step('create', { email: 'new@x.io', password: PASSWORD })
    const early = await step('separate', { ticket: made.body.ticket })
    expect(early.body.error).toBe(EMAIL_COPY.codeExpired)
    expect((await step('separate', { ticket: 'nope' })).body.error).toBe(EMAIL_COPY.codeExpired)
  })

  it('an Apple-only match lists only apple, and link-apple attaches it', async () => {
    const appleId = seedApple()
    const m = await signUpTo()
    expect(m.body).toMatchObject({ next: 'match', providers: ['apple'] })
    const linked = await step('link-apple', {
      ticket: m.body.ticket,
      identityToken: appleIdentityToken(clock),
      nonce: APPLE_NONCE
    })
    expect(linked.body).toMatchObject({ next: 'signed-in', created: false })
    expect(linked.body.user!.id).toBe(appleId)
    expect(providersOf(appleId)).toEqual(['apple', 'email'])
  })

  it('link-apple with another Apple identity is refused', async () => {
    seedApple()
    const m = await signUpTo()
    const refused = await step('link-apple', {
      ticket: m.body.ticket,
      identityToken: appleIdentityToken(clock, { sub: '999.other' }),
      nonce: APPLE_NONCE
    })
    expect(refused.body.error).toBe(EMAIL_COPY.otherAccount('apple'))
    const bad = await step('link-apple', {
      ticket: m.body.ticket,
      identityToken: 'x',
      nonce: APPLE_NONCE
    })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toBe(EMAIL_COPY.linkFailed)
    expect((await step('separate', { ticket: m.body.ticket })).body.next).toBe('signed-in')
  })

  it('a bad Discord link code says so and leaves the ticket usable', async () => {
    seedDiscord()
    const m = await signUpTo()
    const bad = await step('link-discord', {
      ticket: m.body.ticket,
      code: 'nope',
      verifier: VERIFIER
    })
    expect(bad).toMatchObject({ status: 400, body: { error: EMAIL_COPY.linkFailed } })
    const spent = await step('link-discord', {
      ticket: m.body.ticket,
      code: discordLinkCode('111'),
      verifier: 'w'.repeat(43)
    })
    expect(spent.body.error).toBe(EMAIL_COPY.linkFailed)
    expect((await step('separate', { ticket: m.body.ticket })).body.next).toBe('signed-in')
  })

  it('link steps refuse an unconfirmed sign-up and attach nothing', async () => {
    const id = seedDiscord()
    seedApple('other@x.io')
    const made = await step('create', { email: EMAIL, password: PASSWORD })
    const d = await step('link-discord', {
      ticket: made.body.ticket,
      code: discordLinkCode('111'),
      verifier: VERIFIER
    })
    expect(d.body.error).toBe(EMAIL_COPY.codeExpired)
    const a = await step('link-apple', {
      ticket: made.body.ticket,
      identityToken: appleIdentityToken(clock),
      nonce: APPLE_NONCE
    })
    expect(a.body.error).toBe(EMAIL_COPY.codeExpired)
    expect(providersOf(id)).toEqual(['discord'])
    expect(count("SELECT count(*) AS n FROM sign_ins WHERE provider = 'email'")).toBe(0)
  })

  it('the account having an email by the time it links says so, and the choice stays', async () => {
    const id = seedDiscord()
    const m = await signUpTo()
    db.prepare(
      "INSERT INTO sign_ins (provider, subject, user_id, created_at, email) VALUES ('email', 'other@x.io', ?, ?, 'other@x.io')"
    ).run(id, START.toISOString())
    const r = await step('link-discord', {
      ticket: m.body.ticket,
      code: discordLinkCode('111'),
      verifier: VERIFIER
    })
    expect(r).toMatchObject({ status: 400, body: { error: EMAIL_COPY.alsoHas('email') } })
    expect(providersOf(id)).toEqual(['discord', 'email'])
    expect((await step('separate', { ticket: m.body.ticket })).body.next).toBe('signed-in')
  })

  it('an unverified Discord email never matches', async () => {
    seedDiscord(null)
    const r = await signUpTo()
    expect(r.body).toMatchObject({ next: 'signed-in', created: true })
  })

  it('a matched account that already has an email is skipped', async () => {
    const id = seedDiscord()
    db.prepare(
      "INSERT INTO sign_ins (provider, subject, user_id, created_at, email) VALUES ('email', 'other@x.io', ?, ?, 'other@x.io')"
    ).run(id, START.toISOString())
    const r = await signUpTo()
    expect(r.body).toMatchObject({ next: 'signed-in', created: true })
  })

  it('a closed account never matches', async () => {
    const id = seedDiscord()
    db.prepare('UPDATE users SET closed_at = ? WHERE id = ?').run(START.toISOString(), id)
    expect((await signUpTo()).body.next).toBe('signed-in')
  })

  it('takes the oldest matching account', async () => {
    const older = seedDiscord(EMAIL, '111')
    const newer = seedDiscord(EMAIL, '222')
    db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(
      '2026-01-01T00:00:00.000Z',
      older
    )
    const m = await signUpTo()
    const wrong = await step('link-discord', {
      ticket: m.body.ticket,
      code: discordLinkCode('222'),
      verifier: VERIFIER
    })
    expect(wrong.body.error).toBe(EMAIL_COPY.otherAccount('discord'))
    expect(providersOf(newer)).toEqual(['discord'])
    const ok = await step('link-discord', {
      ticket: m.body.ticket,
      code: discordLinkCode('111'),
      verifier: VERIFIER
    })
    expect(ok.body.user!.id).toBe(older)
  })

  it('the match ticket dies after 15 minutes', async () => {
    seedDiscord()
    const m = await signUpTo()
    advance(15 * MIN + 1000)
    const sep = await step('separate', { ticket: m.body.ticket })
    expect(sep.body.error).toBe(EMAIL_COPY.codeExpired)
    const link = await step('link-discord', {
      ticket: m.body.ticket,
      code: discordLinkCode('111'),
      verifier: VERIFIER
    })
    expect(link.body.error).toBe(EMAIL_COPY.codeExpired)
  })

  it('a reset flow never matches', async () => {
    seedDiscord()
    const id = seedDiscord(null, '222')
    db.prepare(
      "INSERT INTO sign_ins (provider, subject, user_id, created_at, email) VALUES ('email', ?, ?, ?, ?)"
    ).run(EMAIL, id, START.toISOString(), EMAIL)
    const f = await step('forgot', { email: EMAIL })
    const done = await step('confirm', { ticket: f.body.ticket, code: sender.lastCode() })
    expect(done.body.next).toBe('new-password')
    const sep = await step('separate', { ticket: f.body.ticket })
    expect(sep.body.error).toBe(EMAIL_COPY.codeExpired)
    const link = await step('link-discord', {
      ticket: f.body.ticket,
      code: discordLinkCode('111'),
      verifier: VERIFIER
    })
    expect(link.body.error).toBe(EMAIL_COPY.codeExpired)
    const apple = await step('link-apple', {
      ticket: f.body.ticket,
      identityToken: appleIdentityToken(clock),
      nonce: APPLE_NONCE
    })
    expect(apple.body.error).toBe(EMAIL_COPY.codeExpired)
    expect(providersOf(id)).toEqual(['discord', 'email'])
  })

  describe('on the web', () => {
    const cookieOf = (res: Response, name: string): string | undefined => {
      for (const c of res.headers.getSetCookie()) {
        const m = c.match(new RegExp(`^${name}=([^;]*)`))
        if (m) return m[1]
      }
      return undefined
    }
    const get = (path: string, cookie?: string): Promise<Response> =>
      handle(new Request(BASE + path, { headers: cookie ? { cookie } : {} }), deps)

    async function viaDiscord(ticket: string | null, link = true): Promise<Response> {
      const extra = ticket ? `; email_link=${ticket}` : ''
      const start = await get(
        `/auth/discord/start${link ? '?link=email' : ''}`,
        ticket ? `email_link=${ticket}` : undefined
      )
      expect(start.status).toBe(302)
      if (link)
        expect(start.headers.getSetCookie().some((c) => c.startsWith('email_link='))).toBe(false)
      const state = cookieOf(start, 'oauth_state')!
      return get(`/auth/discord/callback?code=c&state=${state}`, `oauth_state=${state}${extra}`)
    }

    it('the email_link cookie attaches on the Discord callback', async () => {
      const discordId = seedDiscord()
      const m = await signUpTo()
      const res = await viaDiscord(m.body.ticket!)
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/')
      const session = cookieOf(res, 'session')!
      const raw = res.headers.getSetCookie().find((c) => c.startsWith('email_link='))!
      expect(raw).toMatch(/Max-Age=0/)
      expect(raw).toMatch(/Path=\/auth/)
      const meRes = await get('/api/me', `session=${session}`)
      expect(meRes.status).toBe(200)
      expect(providersOf(discordId)).toEqual(['discord', 'email'])
      expect(
        (db.prepare('SELECT user_id FROM sessions').get() as { user_id: number }).user_id
      ).toBe(discordId)
      expect(count('SELECT count(*) AS n FROM email_flows')).toBe(0)
    })

    it('a different Discord account goes back to the choice and keeps the ticket', async () => {
      seedDiscord()
      discordUser = { id: '222', username: 'other' }
      seedDiscord(null, '222')
      const m = await signUpTo()
      const res = await viaDiscord(m.body.ticket!)
      expect(res.headers.get('location')).toBe('/auth/email/match?error=other-account')
      expect(cookieOf(res, 'session')).toBeUndefined()
      // The ticket stays in the HttpOnly cookie so the page can still offer the choice.
      expect(res.headers.getSetCookie().some((c) => c.startsWith('email_link='))).toBe(false)
      expect(res.headers.getSetCookie().some((c) => c.startsWith('oauth_state=;'))).toBe(true)
      expect(count('SELECT count(*) AS n FROM sessions')).toBe(0)
      const sep = await step('separate', { ticket: m.body.ticket })
      expect(sep.body.next).toBe('signed-in')
    })

    it('an account that already has an email goes to also-has and keeps the ticket', async () => {
      const id = seedDiscord()
      const m = await signUpTo()
      db.prepare(
        "INSERT INTO sign_ins (provider, subject, user_id, created_at, email) VALUES ('email', 'other@x.io', ?, ?, 'other@x.io')"
      ).run(id, START.toISOString())
      const res = await viaDiscord(m.body.ticket!)
      expect(res.headers.get('location')).toBe('/auth/email/match?error=also-has')
      expect(res.headers.getSetCookie().some((c) => c.startsWith('email_link='))).toBe(false)
    })

    it('an expired ticket goes to expired and clears the cookie', async () => {
      seedDiscord()
      const m = await signUpTo()
      advance(15 * MIN + 1000)
      const res = await viaDiscord(m.body.ticket!)
      expect(res.headers.get('location')).toBe('/auth/email/match?error=expired')
      expect(res.headers.getSetCookie().some((c) => c.startsWith('email_link=;'))).toBe(true)
      expect(cookieOf(res, 'session')).toBeUndefined()
    })

    it('success also drops a leftover signin_next', async () => {
      seedDiscord()
      const m = await signUpTo()
      const start = await get('/auth/discord/start?link=email')
      const state = cookieOf(start, 'oauth_state')!
      const res = await get(
        `/auth/discord/callback?code=c&state=${state}`,
        `oauth_state=${state}; email_link=${m.body.ticket}; signin_next=scan`
      )
      expect(res.headers.get('location')).toBe('/')
      expect(res.headers.getSetCookie().some((c) => c.startsWith('signin_next=;'))).toBe(true)
    })

    it('a Discord identity with no account makes none', async () => {
      seedDiscord()
      discordUser = { id: '333', username: 'newbie' }
      const m = await signUpTo()
      const before = users()
      const res = await viaDiscord(m.body.ticket!)
      expect(res.headers.get('location')).toBe('/auth/email/match?error=other-account')
      expect(users()).toBe(before)
    })

    it('a start without link=email drops a leftover cookie', async () => {
      const start = await get('/auth/discord/start', 'email_link=abc')
      expect(start.headers.getSetCookie().some((c) => c.startsWith('email_link=;'))).toBe(true)
    })
  })
})
