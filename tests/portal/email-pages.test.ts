import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { fakeSender, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { makeClaim } from '../../workers/portal/src/emailClaim'
import { renderHome } from '../../workers/portal/src/home'
import { EMAIL_COPY } from '../../src/shared/emailAuth'

const BASE = 'https://portal.test'
const START = new Date('2026-11-02T12:00:00.000Z')

describe('email sign-in pages', () => {
  let db: Database.Database
  let deps: AppDeps
  let sender: ReturnType<typeof fakeSender>
  let clock: Date

  beforeEach(async () => {
    sender = fakeSender()
    clock = new Date(START)
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
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
  })

  const get = (path: string, cookie?: string): Promise<Response> =>
    handle(new Request(`${BASE}${path}`, { headers: cookie ? { cookie } : {} }), deps)

  const post = (
    step: string,
    fields: Record<string, string>,
    opts: { origin?: string | null; cookie?: string } = {}
  ): Promise<Response> => {
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      'cf-connecting-ip': '1.1.1.1'
    }
    if (opts.origin !== null) headers.origin = opts.origin ?? BASE
    if (opts.cookie) headers.cookie = opts.cookie
    return handle(
      new Request(`${BASE}/auth/email/form/${step}`, {
        method: 'POST',
        headers,
        body: new URLSearchParams(fields).toString()
      }),
      deps
    )
  }

  const ticketOf = (html: string): string => html.match(/name="ticket" value="([^"]+)"/)![1]
  const cookieOf = (res: Response, name: string): string | undefined =>
    res.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${name}=`))
      ?.split(';')[0]
      .slice(name.length + 1)

  async function signUp(email: string, next?: string): Promise<Response> {
    const created = await post('create', {
      email,
      password: 'hunter2hunter2',
      password_confirm: 'hunter2hunter2',
      ...(next ? { next } : {})
    })
    const ticket = ticketOf(await created.text())
    return post('confirm', { ticket, email, code: sender.lastCode(), ...(next ? { next } : {}) })
  }

  it('the email page posts to form/check', async () => {
    const res = await get('/auth/email')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('action="/auth/email/form/check"')
    expect(html).toContain(EMAIL_COPY.oneBox.replace("'", '&#39;'))
    expect(html).not.toContain('<script')
  })

  it('is off when email sign-in is off', async () => {
    deps.env.EMAIL_SIGN_IN = 'off'
    expect((await get('/auth/email')).status).toBe(404)
    expect((await post('check', { email: 'a@b.io' })).status).toBe(404)
  })

  it('a full browser sign-up ends with a session cookie on /', async () => {
    const check = await post('check', { email: 'New@Example.io' })
    const html = await check.text()
    expect(html).toContain('action="/auth/email/form/create"')
    expect(html).toContain('value="new@example.io"')
    const res = await signUp('new@example.io')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/')
    expect(cookieOf(res, 'session')).toBeTruthy()
    const row = db.prepare('SELECT kind FROM sessions').get() as { kind: string }
    expect(row.kind).toBe('web')
  })

  it('next=scan ends on /scan/, and any other next is ignored', async () => {
    const res = await signUp('scan@example.io', 'scan')
    expect(res.headers.get('location')).toBe('/scan/')
    const other = await signUp('other@example.io', 'https://evil.test')
    expect(other.headers.get('location')).toBe('/')
  })

  it('a known email asks for the password, and signing in works', async () => {
    await signUp('known@example.io')
    const page = await (await post('check', { email: 'known@example.io' })).text()
    expect(page).toContain('action="/auth/email/form/password"')
    const res = await post('password', { email: 'known@example.io', password: 'hunter2hunter2' })
    expect(res.status).toBe(303)
    expect(cookieOf(res, 'session')).toBeTruthy()
  })

  it('a POST from another origin is refused', async () => {
    expect((await post('check', { email: 'a@b.io' }, { origin: 'https://evil.test' })).status).toBe(
      403
    )
    expect((await post('check', { email: 'a@b.io' }, { origin: null })).status).toBe(403)
  })

  it('user input is escaped', async () => {
    const res = await post('check', { email: '<b>@x.io' })
    const html = await res.text()
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>@x.io')
  })

  it('errors show the copy on the same step', async () => {
    await signUp('known@example.io')
    const res = await post('password', { email: 'known@example.io', password: 'wrong-wrong' })
    expect(res.status).toBe(400)
    const html = await res.text()
    expect(html).toContain('That password doesn&#39;t match.')
    expect(html).toContain('Forgot password?')
    expect(html).toContain('value="known@example.io"')
    expect(html).toContain('action="/auth/email/form/password"')
  })

  it("a sign-up whose passwords don't match stays on the create page", async () => {
    const check = await post('check', { email: 'pair@example.io' })
    expect(await check.text()).toContain('name="password_confirm"')
    const res = await post('create', {
      email: 'pair@example.io',
      password: 'hunter2hunter2',
      password_confirm: 'hunter2hunter3'
    })
    expect(res.status).toBe(400)
    const html = await res.text()
    expect(html).toContain('Passwords don&#39;t match')
    expect(html).toContain('action="/auth/email/form/create"')
    expect(html).toContain('value="pair@example.io"')
    expect(sender.sent).toHaveLength(0)
  })

  it('the code page takes a 6-digit code and shows a wrong code on the same step', async () => {
    const created = await post('create', {
      email: 'c@example.io',
      password: 'hunter2hunter2',
      password_confirm: 'hunter2hunter2'
    })
    const html = await created.text()
    expect(html).toContain('inputmode="numeric"')
    expect(html).toContain('autocomplete="one-time-code"')
    expect(html).toContain('maxlength="6"')
    const wrong = await post('confirm', {
      ticket: ticketOf(html),
      email: 'c@example.io',
      code: '000000'
    })
    expect(wrong.status).toBe(400)
    expect(await wrong.text()).toContain('That code doesn&#39;t match.')
  })

  it('forgot password runs the reset and signs in', async () => {
    await signUp('forgot@example.io')
    clock = new Date(clock.getTime() + 2 * 60 * 1000)
    const forgot = await post('forgot', { email: 'forgot@example.io' })
    const ticket = ticketOf(await forgot.text())
    const confirmed = await post('confirm', {
      ticket,
      email: 'forgot@example.io',
      code: sender.lastCode(),
      purpose: 'reset'
    })
    const html = await confirmed.text()
    expect(html).toContain('action="/auth/email/form/reset"')
    expect(html).toContain('name="password_confirm"')
    const differ = await post('reset', {
      ticket: ticketOf(html),
      password: 'brand-new-pass',
      password_confirm: 'brand-new-pas'
    })
    expect(differ.status).toBe(400)
    const again = await differ.text()
    expect(again).toContain('Passwords don&#39;t match')
    expect(again).toContain('action="/auth/email/form/reset"')
    const res = await post('reset', {
      ticket: ticketOf(again),
      password: 'brand-new-pass',
      password_confirm: 'brand-new-pass'
    })
    expect(res.status).toBe(303)
    expect(cookieOf(res, 'session')).toBeTruthy()
  })

  describe('matching an existing Discord account', () => {
    const discord = (): number => {
      const r = db
        .prepare(
          'INSERT INTO users (discord_id, username, created_at, updated_at) VALUES (?, ?, ?, ?)'
        )
        .run('d-1', 'kaiba', START.toISOString(), START.toISOString())
      const id = Number(r.lastInsertRowid)
      db.prepare(
        "INSERT INTO sign_ins (provider, subject, user_id, created_at, email) VALUES ('discord', 'd-1', ?, ?, 'm@example.io')"
      ).run(id, START.toISOString())
      return id
    }

    it('offers Discord linking and a separate account', async () => {
      discord()
      const res = await signUp('m@example.io')
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('Sign in with Discord to link')
      expect(html).toContain('action="/auth/email/form/link-discord"')
      expect(html).toContain('action="/auth/email/form/separate"')
    })

    it('link-discord sets the email_link cookie and starts Discord', async () => {
      discord()
      const html = await (await signUp('m@example.io')).text()
      const res = await post('link-discord', { ticket: ticketOf(html) })
      expect(res.status).toBe(303)
      expect(res.headers.get('location')).toBe('/auth/discord/start?link=email')
      expect(cookieOf(res, 'email_link')).toBe(ticketOf(html))
    })

    it('the match page reads the ticket from the cookie and shows the refusal copy', async () => {
      discord()
      const ticket = ticketOf(await (await signUp('m@example.io')).text())
      const res = await get('/auth/email/match?error=other-account', `email_link=${ticket}`)
      const html = await res.text()
      expect(html).toContain('m@example.io')
      expect(html).toContain(EMAIL_COPY.otherAccount('discord').replace("'", '&#39;'))
      expect(html).not.toContain(ticket)
      const sep = await post('separate', {}, { cookie: `email_link=${ticket}` })
      expect(sep.status).toBe(303)
      expect(cookieOf(sep, 'session')).toBeTruthy()
    })

    it('the match page without a live ticket starts over', async () => {
      const res = await get('/auth/email/match?error=expired')
      const html = await res.text()
      expect(html).toContain('action="/auth/email/form/check"')
      expect(html).toContain(EMAIL_COPY.codeExpired)
    })

    it('an Apple-only match offers only a separate account', async () => {
      const r = db
        .prepare(
          'INSERT INTO users (discord_id, username, created_at, updated_at) VALUES (?, ?, ?, ?)'
        )
        .run('apple:a1', 'ap', START.toISOString(), START.toISOString())
      db.prepare(
        "INSERT INTO sign_ins (provider, subject, user_id, created_at, email) VALUES ('apple', 'a1', ?, ?, 'ap@example.io')"
      ).run(Number(r.lastInsertRowid), START.toISOString())
      const html = await (await signUp('ap@example.io')).text()
      expect(html).not.toContain('form/link-discord')
      expect(html).toContain('action="/auth/email/form/separate"')
      expect(html).toContain('You can link them later from the Duel Binder iPhone app.')
    })
  })

  describe('claim page', () => {
    async function claim(): Promise<string> {
      await signUp('own@example.io')
      const userId = (
        db.prepare("SELECT user_id AS id FROM sign_ins WHERE provider = 'email'").get() as {
          id: number
        }
      ).id
      return makeClaim(deps, {
        provider: 'discord',
        subject: 'd-9',
        profile: { username: 'x', displayName: 'X', avatar: null, email: 'own@example.io' },
        email: 'own@example.io',
        appleRefreshToken: null,
        userId,
        challenge: null,
        kind: 'web'
      })
    }

    it('claim page uses the cookie, never a ticket field', async () => {
      const ticket = await claim()
      const res = await get('/auth/email/claim', `email_claim=${ticket}`)
      const html = await res.text()
      expect(html).toContain('action="/auth/email/form/claim"')
      expect(html).toContain('Link Discord to it')
      expect(html).toContain('Forgot password?')
      expect(html).toContain('Make a separate account')
      expect(html).not.toContain('name="ticket"')
      expect(html).not.toContain(ticket)
    })

    it('a body ticket is ignored; the cookie claim links and the cookie is cleared', async () => {
      const ticket = await claim()
      const noCookie = await post('claim', { password: 'hunter2hunter2', ticket })
      expect(noCookie.status).toBe(400)
      expect(await noCookie.text()).toContain(EMAIL_COPY.codeExpired)
      const wrong = await post(
        'claim',
        { password: 'nope-nope-nope' },
        { cookie: `email_claim=${ticket}` }
      )
      expect(await wrong.text()).toContain('That password doesn&#39;t match.')
      const ok = await post(
        'claim',
        { password: 'hunter2hunter2' },
        { cookie: `email_claim=${ticket}` }
      )
      expect(ok.status).toBe(303)
      expect(cookieOf(ok, 'session')).toBeTruthy()
      expect(ok.headers.getSetCookie().some((c) => c.startsWith('email_claim=;'))).toBe(true)
    })

    it('claim-separate makes a separate account', async () => {
      const ticket = await claim()
      const res = await post('claim-separate', {}, { cookie: `email_claim=${ticket}` })
      expect(res.status).toBe(303)
      expect(cookieOf(res, 'session')).toBeTruthy()
    })

    it('without a claim the claim page starts over', async () => {
      const html = await (await get('/auth/email/claim')).text()
      expect(html).toContain('action="/auth/email/form/check"')
    })
  })

  it('home shows Continue with email only when enabled', () => {
    const v = { siteUrl: 'https://site.test', name: null, signInFailed: false }
    expect(renderHome({ ...v, emailEnabled: true })).toContain('href="/auth/email"')
    expect(renderHome({ ...v, emailEnabled: true })).toContain('Continue with email')
    expect(renderHome(v)).not.toContain('Continue with email')
  })
})
