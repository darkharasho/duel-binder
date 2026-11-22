import { createHash } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { addUser, fakeSender, memoryBucket, noPrintingArt, noPrices } from './helpers'
import { APPLE_NONCE, appleIdentityToken, appleTestKeys } from './appleKeys'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { APPLE_KEYS_URL, APPLE_TOKEN_URL, resetAppleKeys } from '../../workers/portal/src/apple'
import { mintSession } from '../../workers/portal/src/auth'
import { mergeWithTicket } from '../../workers/portal/src/merge'
import { migrateServer } from '../../workers/portal/src/migrate'
import { joinWaitlist, seatCounts, setCap } from '../../workers/portal/src/seats'
import { EMAIL_COPY } from '../../src/shared/emailAuth'

const BASE = 'https://portal.test'
const NOW = new Date('2026-11-21T12:00:00.000Z')
const NOW_ISO = NOW.toISOString()
const FUTURE = '2026-12-01T00:00:00.000Z'
const STATE = 'state_0123456789abcdef'
const CHALLENGE = createHash('sha256')
  .update('verifier-0123456789-abcdefghijklmnopqrstuvwxyz-ABCDEFG')
  .digest('base64url')
const sha = (t: string): string => createHash('sha256').update(t).digest('hex')

describe('the seat gate', () => {
  let db: Database.Database
  let deps: AppDeps
  let sender: ReturnType<typeof fakeSender>
  let discordUser: { id: string; username: string; email?: string; verified?: boolean }
  let jwks: unknown

  beforeAll(() => {
    ;({ jwks } = appleTestKeys())
  })

  beforeEach(() => {
    resetAppleKeys()
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrateServer(db)
    sender = fakeSender()
    discordUser = { id: '111', username: 'kaiba' }
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      if (url === 'https://discord.com/api/oauth2/token')
        return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 })
      if (url === 'https://discord.com/api/users/@me')
        return new Response(JSON.stringify(discordUser), { status: 200 })
      if (url === APPLE_KEYS_URL) return new Response(JSON.stringify(jwks), { status: 200 })
      if (url === APPLE_TOKEN_URL) return new Response('no', { status: 400 })
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
        PRICE_WORKER_URL: 'https://prices.test',
        EMAIL_SIGN_IN: 'on'
      } as AppDeps['env'],
      email: sender,
      now: () => NOW,
      fetch: fetchMock as unknown as typeof fetch
    }
  })

  const accounts = (): number =>
    (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
  /** Fills every seat: the cap is the accounts open now. */
  const full = (): void => setCap(db, seatCounts(db, NOW_ISO).accounts, NOW_ISO)
  const invite = (token: string, email = 'friend@x.io'): void => {
    db.prepare(
      'INSERT INTO seat_invites (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(sha(token), email, NOW_ISO, FUTURE)
  }
  const inviteUsed = (token: string): { used_at: string | null; used_by: number | null } =>
    db
      .prepare('SELECT used_at, used_by FROM seat_invites WHERE token_hash = ?')
      .get(sha(token)) as {
      used_at: string | null
      used_by: number | null
    }

  const cookieOf = (res: Response, name: string): string | undefined =>
    res.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${name}=`))
      ?.split(';')[0]
      .slice(name.length + 1)
  const get = (path: string, cookie?: string): Promise<Response> =>
    handle(new Request(BASE + path, { headers: cookie ? { cookie } : {} }), deps)

  async function webDiscord(extraCookie = '', next = ''): Promise<Response> {
    const start = await get(`/auth/discord/start${next}`)
    const state = cookieOf(start, 'oauth_state')!
    const nextCookie = cookieOf(start, 'signin_next')
    const cookies = [`oauth_state=${state}`]
    if (nextCookie) cookies.push(`signin_next=${nextCookie}`)
    if (extraCookie) cookies.push(extraCookie)
    return get(`/auth/discord/callback?code=c&state=${state}`, cookies.join('; '))
  }
  async function desktopDiscord(): Promise<Response> {
    const start = await get(`/auth/desktop/start?port=53682&state=${STATE}&challenge=${CHALLENGE}`)
    const state = cookieOf(start, 'oauth_state')!
    const desktop = cookieOf(start, 'desktop_auth')!
    return get(
      `/auth/discord/callback?code=c&state=${state}`,
      `oauth_state=${state}; desktop_auth=${desktop}`
    )
  }
  const apple = (claims: Record<string, unknown> = {}): Promise<Response> =>
    handle(
      new Request(`${BASE}/auth/apple/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identityToken: appleIdentityToken(NOW, claims), nonce: APPLE_NONCE })
      }),
      deps
    )
  const emailJson = (step: string, body: unknown): Promise<Response> =>
    handle(
      new Request(`${BASE}/auth/email/${step}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.1.1.1' },
        body: JSON.stringify(body)
      }),
      deps
    )
  const emailForm = (
    step: string,
    fields: Record<string, string>,
    cookie?: string
  ): Promise<Response> =>
    handle(
      new Request(`${BASE}/auth/email/form/${step}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'cf-connecting-ip': '1.1.1.1',
          origin: BASE,
          ...(cookie ? { cookie } : {})
        },
        body: new URLSearchParams(fields).toString()
      }),
      deps
    )
  const ticketOf = (html: string): string => html.match(/name="ticket" value="([^"]+)"/)![1]

  describe('web Discord', () => {
    it('a new sign-in when full goes to /full and makes no account', async () => {
      addUser(db, '1', 'first')
      full()
      const res = await webDiscord()
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/full')
      expect(res.headers.getSetCookie()).toContainEqual(
        expect.stringMatching(/^oauth_state=;.*Max-Age=0/)
      )
      expect(cookieOf(res, 'session')).toBeUndefined()
      expect(accounts()).toBe(1)
    })

    it('a scan sign-in when full also goes to /full', async () => {
      addUser(db, '1', 'first')
      full()
      const res = await webDiscord('', '?next=scan')
      expect(res.headers.get('location')).toBe('/full')
      expect(accounts()).toBe(1)
    })

    it('a valid seat_invite cookie makes the account, spends the invite and clears the cookie', async () => {
      addUser(db, '1', 'first')
      full()
      invite('tok-1')
      const res = await webDiscord('seat_invite=tok-1')
      expect(res.headers.get('location')).toBe('/')
      expect(cookieOf(res, 'session')).toBeTruthy()
      expect(res.headers.getSetCookie()).toContainEqual(
        expect.stringMatching(/^seat_invite=;.*Max-Age=0/)
      )
      const user = db
        .prepare("SELECT user_id FROM sign_ins WHERE provider = 'discord' AND subject = '111'")
        .get() as {
        user_id: number
      }
      expect(inviteUsed('tok-1')).toEqual({ used_at: NOW_ISO, used_by: user.user_id })
    })

    it('reusing a spent invite for a second new user goes to /full', async () => {
      addUser(db, '1', 'first')
      full()
      invite('tok-1')
      await webDiscord('seat_invite=tok-1')
      discordUser = { id: '222', username: 'yugi' }
      const res = await webDiscord('seat_invite=tok-1')
      expect(res.headers.get('location')).toBe('/full')
      expect(accounts()).toBe(2)
    })

    it('an existing Discord user signs in even with the cap at 0', async () => {
      addUser(db, '111', 'kaiba')
      setCap(db, 0, NOW_ISO)
      const res = await webDiscord()
      expect(res.headers.get('location')).toBe('/')
      expect(cookieOf(res, 'session')).toBeTruthy()
    })
  })

  describe('desktop Discord', () => {
    it('a new sign-in when full hands the app error=full', async () => {
      addUser(db, '1', 'first')
      full()
      const res = await desktopDiscord()
      expect(res.headers.get('location')).toBe(
        `http://127.0.0.1:53682/callback?error=full&state=${STATE}`
      )
      expect(accounts()).toBe(1)
    })

    it('an existing user gets a code with the cap at 0', async () => {
      addUser(db, '111', 'kaiba')
      setCap(db, 0, NOW_ISO)
      const res = await desktopDiscord()
      expect(new URL(res.headers.get('location')!).searchParams.get('code')).toBeTruthy()
    })
  })

  describe('Apple', () => {
    it('a new sign-in when full gets 403 full', async () => {
      addUser(db, '1', 'first')
      full()
      const res = await apple()
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'full' })
      expect(accounts()).toBe(1)
    })

    it('a new sign-in whose verified email has an invite makes the account', async () => {
      addUser(db, '1', 'first')
      full()
      invite('tok-a', 'pegasus@x.io')
      const res = await apple({ email: 'Pegasus@x.io', email_verified: true })
      expect(res.status).toBe(200)
      expect(accounts()).toBe(2)
      expect(inviteUsed('tok-a').used_at).toBe(NOW_ISO)
    })

    it('an existing Apple user signs in with the cap at 0', async () => {
      addUser(db, 'apple:000123.abc', 'pegasus')
      setCap(db, 0, NOW_ISO)
      const res = await apple()
      expect(res.status).toBe(200)
    })
  })

  describe('email', () => {
    const create = {
      email: 'new@x.io',
      password: 'hunter2hunter2',
      password_confirm: 'hunter2hunter2'
    }

    it('create for a new address when full answers 403 with the full copy and sends no code', async () => {
      addUser(db, '1', 'first')
      full()
      const res = await emailJson('create', create)
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: EMAIL_COPY.full })
      expect(sender.sent).toEqual([])
    })

    it('the web form shows the full copy', async () => {
      addUser(db, '1', 'first')
      full()
      const res = await emailForm('create', create)
      expect(res.status).toBe(403)
      expect(await res.text()).toContain(EMAIL_COPY.full.replace("'", '&#39;'))
    })

    it('the web form with an invite cookie goes to the code step, and confirm makes the account', async () => {
      addUser(db, '1', 'first')
      full()
      invite('tok-e')
      const created = await emailForm('create', create, 'seat_invite=tok-e')
      expect(created.status).toBe(200)
      const ticket = ticketOf(await created.text())
      const res = await emailForm(
        'confirm',
        { ticket, email: 'new@x.io', code: sender.lastCode() },
        'seat_invite=tok-e'
      )
      expect(res.status).toBe(303)
      expect(res.headers.getSetCookie()).toContainEqual(
        expect.stringMatching(/^seat_invite=;.*Max-Age=0/)
      )
      expect(accounts()).toBe(2)
      expect(inviteUsed('tok-e').used_at).toBe(NOW_ISO)
    })

    it('confirm without the invite after the seats fill is refused with the full copy', async () => {
      addUser(db, '1', 'first')
      setCap(db, 2, NOW_ISO)
      const created = await emailForm('create', create)
      const ticket = ticketOf(await created.text())
      full()
      const res = await emailJson('confirm', { ticket, code: sender.lastCode() })
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: EMAIL_COPY.full })
      expect(accounts()).toBe(1)
    })

    it('an existing email user signs in with the cap at 0', async () => {
      const created = await emailForm('create', create)
      const ticket = ticketOf(await created.text())
      await emailForm('confirm', { ticket, email: 'new@x.io', code: sender.lastCode() })
      setCap(db, 0, NOW_ISO)
      const res = await emailJson('password', { email: 'new@x.io', password: 'hunter2hunter2' })
      expect(res.status).toBe(200)
      expect(((await res.json()) as { next: string }).next).toBe('signed-in')
    })
  })

  describe('closing an account fills a seat', () => {
    it('deleting an account invites the next waiting person', async () => {
      const a = addUser(db, '1', 'first')
      addUser(db, '2', 'second')
      full()
      joinWaitlist(db, 'waiting@x.io', NOW_ISO)
      const token = await mintSession(deps, a, 'desktop', NOW_ISO)
      const res = await handle(
        new Request(`${BASE}/api/account/delete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ confirm: 'delete' })
        }),
        deps
      )
      expect(res.status).toBe(204)
      expect(sender.sent.map((m) => m.to)).toEqual(['waiting@x.io'])
    })

    it('a failed fill does not fail the delete', async () => {
      const a = addUser(db, '1', 'first')
      full()
      const token = await mintSession(deps, a, 'desktop', NOW_ISO)
      // fillSeats throws on its first query.
      db.exec('DROP TABLE waitlist')
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      const res = await handle(
        new Request(`${BASE}/api/account/delete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ confirm: 'delete' })
        }),
        deps
      )
      expect(logged).toHaveBeenCalled()
      logged.mockRestore()
      expect(res.status).toBe(204)
      expect(accounts()).toBe(0)
    })

    it('a merge closing an account invites the next waiting person', async () => {
      const a = addUser(db, '1', 'first')
      const b = addUser(db, 'apple:sub-b', 'second')
      full()
      joinWaitlist(db, 'waiting@x.io', NOW_ISO)
      db.prepare(
        `INSERT INTO merge_tickets (ticket_hash, user_id, other_id, provider, subject, expires_at)
         VALUES (?, ?, ?, 'apple', 'sub-b', ?)`
      ).run(sha('merge-ticket'), a, b, FUTURE)
      await mergeWithTicket(deps, a, 'merge-ticket', { cards: 'sum', username: 'mine' })
      expect(sender.sent.map((m) => m.to)).toEqual(['waiting@x.io'])
    })
  })
})
