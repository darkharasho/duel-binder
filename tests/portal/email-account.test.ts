import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import {
  addUser,
  fakeSender,
  memoryBucket,
  noPrintingArt,
  noPrices,
  seededServerDb
} from './helpers'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { EMAIL_COPY } from '../../src/shared/emailAuth'

const BASE = 'https://portal.test'
const START = new Date('2026-11-02T12:00:00.000Z')
const MIN = 60 * 1000
const DAY = 24 * 60 * MIN
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

type Reply = Record<string, unknown> & { error?: string; result?: unknown }

describe('email sign-in in Settings', () => {
  let db: Database.Database
  let deps: AppDeps
  let clock: Date
  let sender: ReturnType<typeof fakeSender>
  let ann: number

  beforeEach(async () => {
    clock = new Date(START)
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
    ann = addUser(db, '111', 'Ann')
    session('ann', ann)
  })

  const advance = (ms: number): void => {
    clock = new Date(clock.getTime() + ms)
  }
  function session(token: string, userId: number): void {
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      sha256Hex(token),
      userId,
      'desktop',
      START.toISOString(),
      new Date(START.getTime() + 30 * DAY).toISOString()
    )
  }
  const alive = (token: string): boolean =>
    db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').get(sha256Hex(token)) !== undefined

  async function rpc(
    token: string,
    channel: string,
    args: unknown[]
  ): Promise<{ status: number; body: Reply }> {
    const res = await handle(
      new Request(`${BASE}/api/rpc/${channel}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'cf-connecting-ip': '1.1.1.1'
        },
        body: JSON.stringify({ args })
      }),
      deps
    )
    return { status: res.status, body: (await res.json()) as Reply }
  }
  async function emailStep(
    name: string,
    body: Record<string, unknown>
  ): Promise<{ status: number; body: Reply }> {
    const res = await handle(
      new Request(`${BASE}/auth/email/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '2.2.2.2' },
        body: JSON.stringify(body)
      }),
      deps
    )
    return { status: res.status, body: (await res.json()) as Reply }
  }
  const signInWith = async (email: string, password: string): Promise<Reply> =>
    (await emailStep('password', { email, password })).body

  /** Adds an email sign-in to a user straight through the RPCs. */
  async function addEmailTo(token: string, email: string, password: string): Promise<void> {
    const added = await rpc(token, 'account:addEmail', [email, password])
    expect(added.body.result).toMatchObject({ status: 'code' })
    const ticket = (added.body.result as { ticket: string }).ticket
    const done = await rpc(token, 'account:confirmEmail', [ticket, sender.lastCode()])
    expect(done.body.result).toEqual({ status: 'linked' })
    advance(2 * MIN)
  }
  /** A separate account that signs in with only this email. */
  async function emailAccount(email: string, password: string): Promise<number> {
    const made = await emailStep('create', { email, password })
    const done = await emailStep('confirm', { ticket: made.body.ticket, code: sender.lastCode() })
    expect(done.body.next).toBe('signed-in')
    advance(2 * MIN)
    return (done.body.user as { id: number }).id
  }
  const count = (sql: string, ...args: unknown[]): number =>
    (db.prepare(sql).get(...args) as { n: number }).n

  it('addEmail sends a code and confirmEmail attaches it', async () => {
    const added = await rpc('ann', 'account:addEmail', [' Ann@X.io ', 'hunter2hunter2'])
    expect(added.status).toBe(200)
    expect(added.body.result).toMatchObject({ status: 'code' })
    expect(sender.sent[0].to).toBe('ann@x.io')
    expect(count("SELECT count(*) AS n FROM sign_ins WHERE provider = 'email'")).toBe(0)
    const ticket = (added.body.result as { ticket: string }).ticket
    const wrong = await rpc('ann', 'account:confirmEmail', [ticket, '000000'])
    expect(wrong.status).toBe(400)
    expect(wrong.body.error).toBe(EMAIL_COPY.codeWrong)
    const done = await rpc('ann', 'account:confirmEmail', [ticket, sender.lastCode()])
    expect(done.body.result).toEqual({ status: 'linked' })
    const reply = await signInWith('ann@x.io', 'hunter2hunter2')
    expect(reply.next).toBe('signed-in')
    expect((reply.user as { id: number }).id).toBe(ann)
  })

  it('every channel is refused when email sign-in is off', async () => {
    deps.env.EMAIL_SIGN_IN = undefined
    const r = await rpc('ann', 'account:addEmail', ['a@x.io', 'hunter2hunter2'])
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('Email sign-in is off')
    for (const [channel, args] of [
      ['account:confirmEmail', ['t', '123456']],
      ['account:resendEmailCode', ['t']],
      ['account:changePassword', ['a', 'b']],
      ['account:changeEmail', ['a', 'b@x.io']]
    ] as const)
      expect((await rpc('ann', channel, [...args])).body.error).toBe('Email sign-in is off')
  })

  it('addEmail refuses a bad address or password', async () => {
    expect((await rpc('ann', 'account:addEmail', ['nope', 'hunter2hunter2'])).status).toBe(400)
    expect((await rpc('ann', 'account:addEmail', ['a@x.io', 'short'])).status).toBe(400)
    expect(sender.sent).toHaveLength(0)
  })

  it("addEmail for another account's email sign-in needs its password and returns a merge", async () => {
    await emailAccount('bob@x.io', 'bobs-password-1')
    const wrong = await rpc('ann', 'account:addEmail', ['bob@x.io', 'not-his-password'])
    expect(wrong.status).toBe(400)
    expect(wrong.body.error).toBe(EMAIL_COPY.wrongPassword)
    const right = await rpc('ann', 'account:addEmail', ['bob@x.io', 'bobs-password-1'])
    expect(right.status).toBe(200)
    const result = right.body.result as { status: string; ticket: string; preview: unknown }
    expect(result.status).toBe('merge')
    expect(result.preview).toBeTruthy()
  })

  it('addEmail counts wrong passwords against the address', async () => {
    await emailAccount('bob@x.io', 'bobs-password-1')
    for (let i = 0; i < 10; i++)
      expect((await rpc('ann', 'account:addEmail', ['bob@x.io', 'guess'])).body.error).toBe(
        EMAIL_COPY.wrongPassword
      )
    const locked = await rpc('ann', 'account:addEmail', ['bob@x.io', 'bobs-password-1'])
    expect(locked.status).toBe(429)
    expect(locked.body.error).toBe(EMAIL_COPY.tooManyTries)
  })

  it('addEmail when the other account also has Discord answers has-provider with provider discord', async () => {
    const bob = await emailAccount('bob@x.io', 'bobs-password-1')
    db.prepare(
      "INSERT INTO sign_ins (provider, subject, user_id, created_at) VALUES ('discord', '222', ?, 'x')"
    ).run(bob)
    const r = await rpc('ann', 'account:addEmail', ['bob@x.io', 'bobs-password-1'])
    expect(r.body.result).toEqual({ status: 'has-provider', provider: 'discord' })
  })

  it("addEmail matching only another account's Discord email attaches with a code, with no offer", async () => {
    const bob = addUser(db, '222', 'Bob')
    db.prepare("UPDATE sign_ins SET email = 'shared@x.io' WHERE user_id = ?").run(bob)
    const added = await rpc('ann', 'account:addEmail', ['shared@x.io', 'hunter2hunter2'])
    expect(added.body.result).toMatchObject({ status: 'code' })
    const ticket = (added.body.result as { ticket: string }).ticket
    const done = await rpc('ann', 'account:confirmEmail', [ticket, sender.lastCode()])
    expect(done.body.result).toEqual({ status: 'linked' })
    expect(
      count("SELECT count(*) AS n FROM sign_ins WHERE provider = 'email' AND user_id = ?", ann)
    ).toBe(1)
  })

  it('addEmail refuses a second email', async () => {
    await addEmailTo('ann', 'ann@x.io', 'hunter2hunter2')
    const r = await rpc('ann', 'account:addEmail', ['other@x.io', 'hunter2hunter2'])
    expect(r.body.result).toEqual({ status: 'has-provider', provider: 'email' })
  })

  it("confirmEmail and resendEmailCode answer codeExpired for another user's ticket", async () => {
    const bob = addUser(db, '222', 'Bob')
    session('bob', bob)
    const added = await rpc('ann', 'account:addEmail', ['ann@x.io', 'hunter2hunter2'])
    const ticket = (added.body.result as { ticket: string }).ticket
    const code = sender.lastCode()
    const theirs = await rpc('bob', 'account:confirmEmail', [ticket, code])
    expect(theirs.body.error).toBe(EMAIL_COPY.codeExpired)
    advance(2 * MIN)
    expect((await rpc('bob', 'account:resendEmailCode', [ticket])).body.error).toBe(
      EMAIL_COPY.codeExpired
    )
    // The owner's code still works.
    expect((await rpc('ann', 'account:confirmEmail', [ticket, code])).body.result).toEqual({
      status: 'linked'
    })
  })

  it('a code dies after 5 wrong tries, expires after 15 minutes, and a resend replaces it', async () => {
    const added = await rpc('ann', 'account:addEmail', ['ann@x.io', 'hunter2hunter2'])
    const ticket = (added.body.result as { ticket: string }).ticket
    const first = sender.lastCode()
    advance(2 * MIN)
    const again = await rpc('ann', 'account:resendEmailCode', [ticket])
    expect(again.body.result).toEqual({ status: 'code', ticket })
    const second = sender.lastCode()
    if (second !== first)
      expect((await rpc('ann', 'account:confirmEmail', [ticket, first])).body.error).toBe(
        EMAIL_COPY.codeWrong
      )
    for (let i = 0; i < 4; i++) await rpc('ann', 'account:confirmEmail', [ticket, 'x'])
    const dead = await rpc('ann', 'account:confirmEmail', [ticket, second])
    expect(dead.body.error).toBe(EMAIL_COPY.codeExpired)
    advance(2 * MIN)
    await rpc('ann', 'account:resendEmailCode', [ticket])
    advance(16 * MIN)
    const late = await rpc('ann', 'account:confirmEmail', [ticket, sender.lastCode()])
    expect(late.body.error).toBe(EMAIL_COPY.codeExpired)
  })

  it("changePassword keeps the caller's session", async () => {
    await addEmailTo('ann', 'ann@x.io', 'hunter2hunter2')
    session('ann2', ann)
    session('ann3', ann)
    const bad = await rpc('ann', 'account:changePassword', ['wrong-password', 'brand-new-pass'])
    expect(bad.body.error).toBe(EMAIL_COPY.wrongPassword)
    const short = await rpc('ann', 'account:changePassword', ['hunter2hunter2', 'short'])
    expect(short.status).toBe(400)
    const ok = await rpc('ann', 'account:changePassword', ['hunter2hunter2', 'brand-new-pass'])
    expect(ok.status).toBe(200)
    expect(alive('ann')).toBe(true)
    expect(alive('ann2')).toBe(false)
    expect(alive('ann3')).toBe(false)
    expect((await signInWith('ann@x.io', 'hunter2hunter2')).error).toBe(EMAIL_COPY.wrongPassword)
    expect((await signInWith('ann@x.io', 'brand-new-pass')).next).toBe('signed-in')
  })

  it('changePassword and changeEmail need an email sign-in', async () => {
    const a = await rpc('ann', 'account:changePassword', ['hunter2hunter2', 'brand-new-pass'])
    expect(a).toMatchObject({ status: 400, body: { error: 'No email sign-in on this account' } })
    const b = await rpc('ann', 'account:changeEmail', ['hunter2hunter2', 'new@x.io'])
    expect(b).toMatchObject({ status: 400, body: { error: 'No email sign-in on this account' } })
  })

  it('changeEmail confirms on the new address and tells the old one', async () => {
    await addEmailTo('ann', 'ann@x.io', 'hunter2hunter2')
    sender.sent.length = 0
    const wrong = await rpc('ann', 'account:changeEmail', ['nope-nope-nope', 'new@x.io'])
    expect(wrong.body.error).toBe(EMAIL_COPY.wrongPassword)
    const started = await rpc('ann', 'account:changeEmail', ['hunter2hunter2', ' New@X.io '])
    expect(started.body.result).toMatchObject({ status: 'code' })
    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0].to).toBe('new@x.io')
    // The old address still works until the confirm.
    expect((await signInWith('ann@x.io', 'hunter2hunter2')).next).toBe('signed-in')
    const ticket = (started.body.result as { ticket: string }).ticket
    const done = await rpc('ann', 'account:confirmEmail', [ticket, sender.lastCode()])
    expect(done.body.result).toEqual({ status: 'linked' })
    expect(sender.sent).toHaveLength(2)
    expect(sender.sent[1].to).toBe('ann@x.io')
    expect(sender.sent[1].subject).toBe('Your Duel Binder sign-in email was changed')
    expect((await signInWith('ann@x.io', 'hunter2hunter2')).error).toBe(EMAIL_COPY.wrongPassword)
    const reply = await signInWith('new@x.io', 'hunter2hunter2')
    expect((reply.user as { id: number }).id).toBe(ann)
    const row = db
      .prepare("SELECT subject, email FROM sign_ins WHERE provider = 'email' AND user_id = ?")
      .get(ann)
    expect(row).toEqual({ subject: 'new@x.io', email: 'new@x.io' })
  })

  it('a failed notice to the old address is only logged', async () => {
    await addEmailTo('ann', 'ann@x.io', 'hunter2hunter2')
    const started = await rpc('ann', 'account:changeEmail', ['hunter2hunter2', 'new@x.io'])
    const ticket = (started.body.result as { ticket: string }).ticket
    const code = sender.lastCode()
    sender.failNext()
    const done = await rpc('ann', 'account:confirmEmail', [ticket, code])
    expect(done.body.result).toEqual({ status: 'linked' })
    expect((await signInWith('new@x.io', 'hunter2hunter2')).next).toBe('signed-in')
  })

  it('changeEmail to a taken address is refused', async () => {
    await addEmailTo('ann', 'ann@x.io', 'hunter2hunter2')
    await emailAccount('bob@x.io', 'bobs-password-1')
    const r = await rpc('ann', 'account:changeEmail', ['hunter2hunter2', 'bob@x.io'])
    expect(r.status).toBe(400)
    expect(r.body.error).toBe(EMAIL_COPY.emailTaken)
  })

  it('a change taken meanwhile is refused at the confirm', async () => {
    await addEmailTo('ann', 'ann@x.io', 'hunter2hunter2')
    const started = await rpc('ann', 'account:changeEmail', ['hunter2hunter2', 'new@x.io'])
    const ticket = (started.body.result as { ticket: string }).ticket
    const code = sender.lastCode()
    advance(2 * MIN)
    await emailAccount('new@x.io', 'bobs-password-1')
    const done = await rpc('ann', 'account:confirmEmail', [ticket, code])
    expect(done.body.error).toBe(EMAIL_COPY.emailTaken)
    expect(count("SELECT count(*) AS n FROM sign_ins WHERE subject = 'ann@x.io'")).toBe(1)
  })

  it("removeSignIn('email') drops the password; not when it's the last", async () => {
    await addEmailTo('ann', 'ann@x.io', 'hunter2hunter2')
    const pending = await rpc('ann', 'account:changeEmail', ['hunter2hunter2', 'new@x.io'])
    expect(pending.status).toBe(200)
    expect(count('SELECT count(*) AS n FROM email_flows WHERE user_id = ?', ann)).toBe(1)
    const removed = await rpc('ann', 'account:removeSignIn', ['email'])
    expect(removed.status).toBe(200)
    expect(count("SELECT count(*) AS n FROM sign_ins WHERE provider = 'email'")).toBe(0)
    expect(count('SELECT count(*) AS n FROM email_flows WHERE user_id = ?', ann)).toBe(0)
    expect((await signInWith('ann@x.io', 'hunter2hunter2')).error).toBeTruthy()
    // An email-only account can't drop its only sign-in.
    const solo = await emailAccount('solo@x.io', 'solo-password-1')
    session('solo', solo)
    const last = await rpc('solo', 'account:removeSignIn', ['email'])
    expect(last.status).toBe(400)
    expect(count('SELECT count(*) AS n FROM sign_ins WHERE user_id = ?', solo)).toBe(1)
  })

  it('listSignIns shows the address', async () => {
    await addEmailTo('ann', 'ann@x.io', 'hunter2hunter2')
    const r = await rpc('ann', 'account:signIns', [])
    expect(r.body.result).toEqual([
      expect.objectContaining({ provider: 'discord' }),
      expect.objectContaining({ provider: 'email', email: 'ann@x.io' })
    ])
  })
})
