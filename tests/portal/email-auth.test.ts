import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { fakeSender, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { sendCode } from '../../workers/portal/src/emailAuth'
import { EMAIL_COPY } from '../../src/shared/emailAuth'

const BASE = 'https://portal.test'
const START = new Date('2026-11-02T12:00:00.000Z')
const MIN = 60 * 1000
const HOUR = 60 * MIN

type Reply = Record<string, unknown> & {
  next?: string
  error?: string
  token?: string
  ticket?: string
}

describe('email sign-up, sign-in and reset', () => {
  let db: Database.Database
  let deps: AppDeps
  let clock: Date
  let sender: ReturnType<typeof fakeSender>
  let ip: string
  let bodies: string[]

  beforeEach(async () => {
    clock = new Date(START)
    ip = '1.1.1.1'
    bodies = []
    sender = fakeSender()
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

  afterEach(() => vi.restoreAllMocks())

  const advance = (ms: number): void => {
    clock = new Date(clock.getTime() + ms)
  }
  const count = (sql: string, ...args: unknown[]): number =>
    (db.prepare(sql).get(...args) as { n: number }).n
  const users = (): number => count('SELECT count(*) AS n FROM users')

  async function step(
    name: string,
    body: Record<string, unknown>
  ): Promise<{ status: number; body: Reply }> {
    const res = await handle(
      new Request(`${BASE}/auth/email/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
        body: JSON.stringify(body)
      }),
      deps
    )
    const text = await res.text()
    bodies.push(text)
    return { status: res.status, body: JSON.parse(text) as Reply }
  }
  const me = (token: string): Promise<Response> =>
    handle(new Request(`${BASE}/api/me`, { headers: { authorization: `Bearer ${token}` } }), deps)

  /** Creates and confirms an account; returns its token and id. */
  async function signUp(email: string, password: string): Promise<{ token: string; id: number }> {
    const made = await step('create', { email, password })
    expect(made.body.next).toBe('code')
    const done = await step('confirm', { ticket: made.body.ticket, code: sender.lastCode() })
    expect(done.body.next).toBe('signed-in')
    advance(2 * MIN)
    const user = done.body.user as { id: number }
    return { token: done.body.token as string, id: user.id }
  }

  it('status reports enabled only with the var and a sender', async () => {
    const status = async (): Promise<unknown> =>
      (await handle(new Request(`${BASE}/auth/email/status`), deps)).json()
    expect(await status()).toEqual({ enabled: true })
    deps.email = undefined
    expect(await status()).toEqual({ enabled: false })
    deps.email = sender
    deps.env.EMAIL_SIGN_IN = undefined
    expect(await status()).toEqual({ enabled: false })
  })

  it('routes answer 404 email-off when disabled', async () => {
    deps.env.EMAIL_SIGN_IN = undefined
    const r = await step('check', { email: 'a@x.io' })
    expect(r.status).toBe(404)
    expect(r.body.error).toBe('email-off')
  })

  it('a new email goes to create, then a code, then a signed-in new account', async () => {
    const checked = await step('check', { email: ' New@X.io ' })
    expect(checked.body).toEqual({ next: 'create', email: 'new@x.io' })
    const made = await step('create', { email: ' New@X.io ', password: 'hunter2hunter2' })
    expect(made.body).toMatchObject({ next: 'code', email: 'new@x.io', purpose: 'signup' })
    const msg = sender.sent[0]
    expect(msg.to).toBe('new@x.io')
    expect(msg.subject).toBe(`Your Duel Binder code: ${sender.lastCode()}`)
    const done = await step('confirm', { ticket: made.body.ticket, code: sender.lastCode() })
    expect(done.status).toBe(200)
    expect(done.body).toMatchObject({ next: 'signed-in', created: true })
    const res = await me(done.body.token as string)
    expect(res.status).toBe(200)
    expect(((await res.json()) as { usernameChosen: boolean }).usernameChosen).toBe(false)
    const rpc = await handle(
      new Request(`${BASE}/api/rpc/account:signIns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${done.body.token}` },
        body: JSON.stringify({ args: [] })
      }),
      deps
    )
    const { result } = (await rpc.json()) as { result: { provider: string; email?: string }[] }
    expect(result).toEqual([expect.objectContaining({ provider: 'email', email: 'new@x.io' })])
  })

  it('signs in with a differently-cased email', async () => {
    const ann = await signUp('ann@x.io', 'correct horse')
    const r = await step('password', { email: ' ANN@x.io ', password: 'correct horse' })
    expect(r.body.next).toBe('signed-in')
    expect((r.body.user as { id: number }).id).toBe(ann.id)
    expect(r.body.created).toBe(false)
  })

  it('a wrong password answers the copy and counts', async () => {
    await signUp('ann@x.io', 'correct horse')
    const first = await step('password', { email: 'ann@x.io', password: 'nope nope nope' })
    expect(first.status).toBe(400)
    expect(first.body.error).toBe(EMAIL_COPY.wrongPassword)
    for (let i = 1; i < 10; i++)
      await step('password', { email: 'ann@x.io', password: 'nope nope nope' })
    const over = await step('password', { email: 'ann@x.io', password: 'correct horse' })
    expect(over.status).toBe(429)
    expect(over.body.error).toBe(EMAIL_COPY.tooManyTries)
  })

  it("the account doesn't exist before the code", async () => {
    const before = users()
    await step('create', { email: 'pending@x.io', password: 'hunter2hunter2' })
    expect((await step('check', { email: 'pending@x.io' })).body.next).toBe('create')
    expect(users()).toBe(before)
  })

  it('a wrong code five times kills it', async () => {
    const made = await step('create', { email: 'a@x.io', password: 'hunter2hunter2' })
    const code = sender.lastCode()
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 4; i++) {
      const r = await step('confirm', { ticket: made.body.ticket, code: wrong })
      expect(r.body.error).toBe(EMAIL_COPY.codeWrong)
    }
    const fifth = await step('confirm', { ticket: made.body.ticket, code: wrong })
    expect(fifth.body.error).toBe(EMAIL_COPY.codeExpired)
    const right = await step('confirm', { ticket: made.body.ticket, code })
    expect(right.body.error).toBe(EMAIL_COPY.codeExpired)
  })

  it('a code past 15 minutes is refused', async () => {
    const made = await step('create', { email: 'a@x.io', password: 'hunter2hunter2' })
    advance(15 * MIN + 1000)
    const r = await step('confirm', { ticket: made.body.ticket, code: sender.lastCode() })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe(EMAIL_COPY.codeExpired)
  })

  it('resend replaces the code', async () => {
    const draws = [111111, 222222]
    const real = crypto.getRandomValues.bind(crypto)
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((a: ArrayBufferView) => {
      if (a instanceof Uint32Array && draws.length > 0) {
        a[0] = draws.shift()!
        return a
      }
      return real(a as Uint8Array)
    }) as typeof crypto.getRandomValues)
    const made = await step('create', { email: 'a@x.io', password: 'hunter2hunter2' })
    expect(sender.lastCode()).toBe('111111')
    advance(61 * 1000)
    const again = await step('resend', { ticket: made.body.ticket })
    expect(again.body).toMatchObject({ next: 'code', purpose: 'signup' })
    expect(sender.lastCode()).toBe('222222')
    const old = await step('confirm', { ticket: made.body.ticket, code: '111111' })
    expect(old.body.error).toBe(EMAIL_COPY.codeWrong)
    const ok = await step('confirm', { ticket: made.body.ticket, code: '222222' })
    expect(ok.body.next).toBe('signed-in')
  })

  it('a refused create leaves the pending sign-up and its code alone', async () => {
    const one = await step('create', { email: 'a@x.io', password: 'hunter2hunter2' })
    const code = sender.lastCode()
    const two = await step('create', { email: 'a@x.io', password: 'hunter2hunter2' })
    expect(two.status).toBe(429)
    expect(two.body.error).toBe(EMAIL_COPY.tooManyCodes)
    const ok = await step('confirm', { ticket: one.body.ticket, code })
    expect(ok.body.next).toBe('signed-in')
  })

  it('a limited create is refused before any password is hashed', async () => {
    await step('create', { email: 'a@x.io', password: 'hunter2hunter2' })
    const derive = vi.spyOn(crypto.subtle, 'deriveBits')
    const two = await step('create', { email: 'a@x.io', password: 'hunter2hunter2' })
    expect(two.status).toBe(429)
    expect(two.body.error).toBe(EMAIL_COPY.tooManyCodes)
    expect(derive).not.toHaveBeenCalled()
  })

  it('a refused forgot leaves the pending reset and its code alone', async () => {
    await signUp('ann@x.io', 'old password 1')
    advance(HOUR)
    const one = await step('forgot', { email: 'ann@x.io' })
    const code = sender.lastCode()
    const two = await step('forgot', { email: 'ann@x.io' })
    expect(two.status).toBe(429)
    expect(two.body.error).toBe(EMAIL_COPY.tooManyCodes)
    const ok = await step('confirm', { ticket: one.body.ticket, code })
    expect(ok.body.next).toBe('new-password')
  })

  it('parallel wrong passwords cannot get past the cap', async () => {
    await signUp('ann@x.io', 'correct horse')
    const results = await Promise.all(
      Array.from({ length: 15 }, () =>
        step('password', { email: 'ann@x.io', password: 'wrong wrong' })
      )
    )
    expect(results.filter((r) => r.status === 400)).toHaveLength(10)
    expect(results.filter((r) => r.status === 429)).toHaveLength(5)
  })

  it('a right password does not use up the allowance', async () => {
    await signUp('ann@x.io', 'correct horse')
    for (let i = 0; i < 12; i++)
      expect(
        (await step('password', { email: 'ann@x.io', password: 'correct horse' })).status
      ).toBe(200)
  })

  it('forgot is limited per client like check', async () => {
    let last = 0
    for (let i = 0; i < 101; i++) last = (await step('forgot', { email: `g${i}@x.io` })).status
    expect(last).toBe(429)
  })

  it('sendCode sends nothing when the flow is gone', async () => {
    await expect(
      sendCode(deps, { ticketHash: 'gone', email: 'a@x.io', purpose: 'signup' }, ip, clock)
    ).rejects.toMatchObject({ message: EMAIL_COPY.codeExpired, status: 400 })
    expect(sender.sent).toHaveLength(0)
  })

  it('a second code within a minute is refused, and so is a sixth in an hour', async () => {
    const made = await step('create', { email: 'a@x.io', password: 'hunter2hunter2' })
    const fast = await step('resend', { ticket: made.body.ticket })
    expect(fast.status).toBe(429)
    expect(fast.body.error).toBe(EMAIL_COPY.tooManyCodes)
    for (let i = 0; i < 4; i++) {
      advance(61 * 1000)
      expect((await step('resend', { ticket: made.body.ticket })).status).toBe(200)
    }
    advance(61 * 1000)
    const sixth = await step('resend', { ticket: made.body.ticket })
    expect(sixth.status).toBe(429)
    expect(sixth.body.error).toBe(EMAIL_COPY.tooManyCodes)
    expect(sender.sent).toHaveLength(5)
  })

  it('a send failure answers sendFailed and logs', async () => {
    sender.failNext()
    const r = await step('create', { email: 'a@x.io', password: 'hunter2hunter2' })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe(EMAIL_COPY.sendFailed)
    expect(count("SELECT count(*) AS n FROM error_reports WHERE platform = 'server'")).toBe(1)
  })

  it('a newer sign-up replaces the older one', async () => {
    const one = await step('create', { email: 'a@x.io', password: 'hunter2hunter2' })
    const codeOne = sender.lastCode()
    advance(61 * 1000)
    const two = await step('create', { email: 'a@x.io', password: 'another password' })
    const codeTwo = sender.lastCode()
    const old = await step('confirm', { ticket: one.body.ticket, code: codeOne })
    expect(old.body.error).toBe(EMAIL_COPY.codeExpired)
    const ok = await step('confirm', { ticket: two.body.ticket, code: codeTwo })
    expect(ok.body.next).toBe('signed-in')
    advance(MIN)
    expect(
      (await step('password', { email: 'a@x.io', password: 'another password' })).body.next
    ).toBe('signed-in')
  })

  it("a second pending sign-up for a taken email can't confirm", async () => {
    const made = await step('create', { email: 'a@x.io', password: 'hunter2hunter2' })
    const other = Number(
      db
        .prepare(
          "INSERT INTO users (discord_id, username, created_at, updated_at) VALUES ('d1', 'someone', 'x', 'x')"
        )
        .run().lastInsertRowid
    )
    db.prepare(
      "INSERT INTO sign_ins (provider, subject, user_id, created_at, email, password_hash) VALUES ('email', 'a@x.io', ?, 'x', 'a@x.io', 'h')"
    ).run(other)
    const before = users()
    const r = await step('confirm', { ticket: made.body.ticket, code: sender.lastCode() })
    expect(r.body.error).toBe(EMAIL_COPY.emailTaken)
    expect(users()).toBe(before)
  })

  it('forgot, code, new password signs in and reset signs out every other session', async () => {
    const ann = await signUp('ann@x.io', 'old password 1')
    const second = await step('password', { email: 'ann@x.io', password: 'old password 1' })
    const other = second.body.token as string
    expect((await me(ann.token)).status).toBe(200)
    expect((await me(other)).status).toBe(200)

    const forgot = await step('forgot', { email: 'ann@x.io' })
    expect(forgot.body).toMatchObject({ next: 'code', purpose: 'reset' })
    const confirmed = await step('confirm', { ticket: forgot.body.ticket, code: sender.lastCode() })
    expect(confirmed.body).toEqual({ next: 'new-password', ticket: forgot.body.ticket })
    const reset = await step('reset', { ticket: forgot.body.ticket, password: 'new password 2' })
    expect(reset.body.next).toBe('signed-in')

    expect((await me(ann.token)).status).toBe(401)
    expect((await me(other)).status).toBe(401)
    expect((await me(reset.body.token as string)).status).toBe(200)
    expect((await step('password', { email: 'ann@x.io', password: 'old password 1' })).status).toBe(
      400
    )
    expect(
      (await step('password', { email: 'ann@x.io', password: 'new password 2' })).body.next
    ).toBe('signed-in')
  })

  it('reset needs a confirmed code', async () => {
    await signUp('ann@x.io', 'old password 1')
    const forgot = await step('forgot', { email: 'ann@x.io' })
    const r = await step('reset', { ticket: forgot.body.ticket, password: 'new password 2' })
    expect(r.body.error).toBe(EMAIL_COPY.codeExpired)
  })

  it('forgot for an unknown email answers noAccount', async () => {
    const r = await step('forgot', { email: 'ghost@x.io' })
    expect(r.status).toBe(404)
    expect(r.body.error).toBe(EMAIL_COPY.noAccount)
  })

  it('pending sign-ups expire after 24 hours', async () => {
    const made = await step('create', { email: 'a@x.io', password: 'hunter2hunter2' })
    const code = sender.lastCode()
    advance(24 * HOUR + 1000)
    const r = await step('confirm', { ticket: made.body.ticket, code })
    expect(r.body.error).toBe(EMAIL_COPY.codeExpired)
  })

  it('the password is never in a response or the sent mail', async () => {
    const pw = 'sekrit-pass-phrase'
    await signUp('ann@x.io', pw)
    await step('password', { email: 'ann@x.io', password: pw })
    await step('password', { email: 'ann@x.io', password: `${pw}x` })
    const forgot = await step('forgot', { email: 'ann@x.io' })
    expect(forgot.status).toBe(200)
    for (const b of bodies) expect(b).not.toContain(pw)
    for (const m of sender.sent) expect(JSON.stringify(m)).not.toContain(pw)
  })
})
