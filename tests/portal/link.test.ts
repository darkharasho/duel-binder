import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'
import { APPLE_NONCE, appleIdentityToken, appleTestKeys } from './appleKeys'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { APPLE_KEYS_URL, APPLE_TOKEN_URL, resetAppleKeys } from '../../workers/portal/src/apple'
import { cardTotal, planCardMerge } from '../../workers/portal/src/mergePlan'
import type { LinkResult } from '../../src/shared/account'

const BASE = 'https://portal.test'
const DAY = 24 * 60 * 60 * 1000
const START = new Date('2026-11-02T12:00:00.000Z')
const STATE = 'state_0123456789abcdef'
const VERIFIER = 'verifier-0123456789-abcdefghijklmnopqrstuvwxyz-ABCDEFG'
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')
const APPLE_SUB = '000123.abc'
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')
const b64url = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url')

describe('linking a sign-in', () => {
  let db: Database.Database
  let deps: AppDeps
  let clock: Date
  /** Who Discord says signed in. */
  let discordUser: Record<string, unknown>
  let printings: number[]
  let image: number
  let seq = 0

  beforeEach(async () => {
    resetAppleKeys()
    clock = new Date(START)
    discordUser = { id: '111', username: 'kaiba', global_name: 'Seto', avatar: 'abc' }
    db = await seededServerDb()
    printings = (
      db.prepare('SELECT id FROM card_printings ORDER BY id LIMIT 3').all() as { id: number }[]
    ).map((r) => r.id)
    image = (db.prepare('SELECT image_id FROM card_images LIMIT 1').get() as { image_id: number })
      .image_id
    const { jwks, signinPem } = appleTestKeys()
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      if (url === 'https://discord.com/api/oauth2/token')
        return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 })
      if (url === 'https://discord.com/api/users/@me')
        return new Response(JSON.stringify(discordUser), { status: 200 })
      if (url === APPLE_KEYS_URL) return new Response(JSON.stringify(jwks), { status: 200 })
      if (url === APPLE_TOKEN_URL)
        return new Response(
          JSON.stringify({
            refresh_token: 'rt-link',
            access_token: 'at-1',
            id_token: `${b64url({ alg: 'RS256' })}.${b64url({ sub: APPLE_SUB })}.sig`
          }),
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
        PRICE_WORKER_URL: 'https://prices.test',
        APPLE_TEAM_ID: 'TEAM123456',
        APPLE_SIGNIN_KEY_ID: 'KEY1234567',
        APPLE_SIGNIN_KEY: signinPem
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
  const get = (path: string, headers: Record<string, string> = {}): Promise<Response> =>
    handle(new Request(BASE + path, { headers }), deps)
  const count = (sql: string, ...args: unknown[]): number =>
    (db.prepare(sql).get(...args) as { n: number }).n

  const addSession = (token: string, userId: number): void => {
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)"
    ).run(
      sha256Hex(token),
      userId,
      START.toISOString(),
      new Date(START.getTime() + 60 * DAY).toISOString()
    )
  }
  const addCard = (userId: number, printingId: number, quantity: number): void => {
    db.prepare(
      `INSERT INTO collection_entries (user_id, uid, printing_id, image_id, quantity, created_at,
         updated_at, server_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, `uid-${++seq}`, printingId, image, quantity, 'x', 'x', 1000 + seq)
  }
  const addAppleSignIn = (userId: number, subject = APPLE_SUB): void => {
    db.prepare(
      "INSERT INTO sign_ins (provider, subject, user_id, created_at) VALUES ('apple', ?, ?, ?)"
    ).run(subject, userId, START.toISOString())
  }

  const rpc = (token: string, channel: string, args: unknown[]): Promise<Response> =>
    handle(
      new Request(`${BASE}/api/rpc/${channel}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ args })
      }),
      deps
    )
  const result = async (res: Response): Promise<LinkResult> => {
    expect(res.status).toBe(200)
    return ((await res.json()) as { result: LinkResult }).result
  }

  /** The browser half of a link: start with intent=link, then Discord's callback. */
  async function linkCallback(query = 'port=53682'): Promise<Response> {
    const start = await get(
      `/auth/desktop/start?${query}&state=${STATE}&challenge=${CHALLENGE}&intent=link`
    )
    expect(start.status).toBe(302)
    const oauthState = cookieOf(start, 'oauth_state')!
    const desktop = cookieOf(start, 'desktop_auth')!
    return get(`/auth/discord/callback?code=c&state=${oauthState}`, {
      cookie: `oauth_state=${oauthState}; desktop_auth=${desktop}`
    })
  }
  async function linkCode(query?: string): Promise<string> {
    const res = await linkCallback(query)
    expect(res.status).toBe(302)
    return new URL(res.headers.get('location')!).searchParams.get('code')!
  }
  const linkApple = (token: string, extra: Record<string, unknown> = {}): Promise<Response> =>
    rpc(token, 'account:linkApple', [
      { identityToken: appleIdentityToken(clock), nonce: APPLE_NONCE, ...extra }
    ])

  it('linkCode attaches a free Discord identity to an Apple-only account', async () => {
    const me = addUser(db, `apple:${APPLE_SUB}`, 'appleuser')
    addSession('mine', me)

    const res = await linkCallback()
    const loc = new URL(res.headers.get('location')!)
    expect(loc.origin + loc.pathname).toBe('http://127.0.0.1:53682/callback')
    expect(loc.searchParams.get('state')).toBe(STATE)
    const code = loc.searchParams.get('code')!
    // The link callback signs nobody in and makes no account.
    expect(count('SELECT count(*) AS n FROM users')).toBe(1)
    expect(count('SELECT count(*) AS n FROM sessions')).toBe(1)
    expect(count('SELECT count(*) AS n FROM desktop_codes')).toBe(0)
    expect(cookieOf(res, 'session')).toBeUndefined()
    const row = db.prepare('SELECT * FROM link_codes').get() as Record<string, string>
    expect(row).toMatchObject({
      code_hash: sha256Hex(code),
      challenge: CHALLENGE,
      provider: 'discord',
      subject: '111',
      expires_at: new Date(START.getTime() + 120_000).toISOString()
    })
    expect(JSON.parse(row.profile)).toEqual({
      username: 'kaiba',
      displayName: 'Seto',
      avatar: 'abc'
    })

    expect(await result(await rpc('mine', 'account:linkCode', [code, VERIFIER]))).toEqual({
      status: 'linked'
    })
    expect(
      db
        .prepare('SELECT provider, subject FROM sign_ins WHERE user_id = ? ORDER BY provider')
        .all(me)
    ).toEqual([
      { provider: 'apple', subject: APPLE_SUB },
      { provider: 'discord', subject: '111' }
    ])
    expect(
      db
        .prepare('SELECT discord_id, username, display_name, avatar FROM users WHERE id = ?')
        .get(me)
    ).toEqual({ discord_id: '111', username: 'appleuser', display_name: 'Seto', avatar: 'abc' })
  })

  it('link start works for the phone apps and keeps a set display name', async () => {
    const me = addUser(db, `apple:${APPLE_SUB}`, 'appleuser')
    db.prepare("UPDATE users SET display_name = 'Mine' WHERE id = ?").run(me)
    addSession('mine', me)
    for (const app of ['ios', 'android']) {
      const res = await linkCallback(`app=${app}`)
      expect(res.headers.get('location')!.startsWith('duelbinder://auth/callback?code=')).toBe(true)
    }
    expect(count('SELECT count(*) AS n FROM users')).toBe(1)
    const code = await linkCode('app=ios')
    expect(await result(await rpc('mine', 'account:linkCode', [code, VERIFIER]))).toEqual({
      status: 'linked'
    })
    expect(db.prepare('SELECT display_name, avatar FROM users WHERE id = ?').get(me)).toEqual({
      display_name: 'Mine',
      avatar: 'abc'
    })
  })

  it('link start refuses an unknown intent', async () => {
    const res = await get(
      `/auth/desktop/start?port=53682&state=${STATE}&challenge=${CHALLENGE}&intent=merge`
    )
    expect(res.status).toBe(400)
  })

  it('a linked Discord brings its verified email', async () => {
    const me = addUser(db, `apple:${APPLE_SUB}`, 'appleuser')
    addSession('mine', me)
    discordUser = { ...discordUser, email: 'Kaiba@Corp.io', verified: true }
    const code = await linkCode()
    expect(await result(await rpc('mine', 'account:linkCode', [code, VERIFIER]))).toEqual({
      status: 'linked'
    })
    expect(
      db.prepare("SELECT email FROM sign_ins WHERE provider = 'discord' AND user_id = ?").get(me)
    ).toEqual({ email: 'kaiba@corp.io' })
  })

  it('a linked Apple brings its verified email', async () => {
    const me = addUser(db, '222', 'discorduser')
    addSession('mine', me)
    const identityToken = appleIdentityToken(clock, { email: 'Ann@X.io', email_verified: 'true' })
    const res = await rpc('mine', 'account:linkApple', [{ identityToken, nonce: APPLE_NONCE }])
    expect(await result(res)).toEqual({ status: 'linked' })
    expect(
      db.prepare("SELECT email FROM sign_ins WHERE provider = 'apple' AND user_id = ?").get(me)
    ).toEqual({ email: 'ann@x.io' })
  })

  it("linkCode answers already for this account's own Discord", async () => {
    const me = addUser(db, '111', 'kaiba')
    addSession('mine', me)
    const code = await linkCode()
    expect(await result(await rpc('mine', 'account:linkCode', [code, VERIFIER]))).toEqual({
      status: 'already'
    })
    expect(count('SELECT count(*) AS n FROM sign_ins WHERE user_id = ?', me)).toBe(1)
  })

  it("linkCode answers merge with a preview for another account's Discord", async () => {
    const me = addUser(db, `apple:${APPLE_SUB}`, 'appleuser')
    const other = addUser(db, '111', 'kaiba')
    db.prepare("UPDATE users SET display_name = 'Seto', avatar = 'av' WHERE id = ?").run(other)
    db.prepare('UPDATE users SET username_chosen = 0 WHERE id = ?').run(me)
    addSession('mine', me)
    addCard(me, printings[0], 3)
    addCard(me, printings[1], 2)
    addCard(other, printings[0], 5)
    addCard(other, printings[2], 4)
    db.prepare(
      `INSERT INTO binders (user_id, uid, game, name, rules, goal, languages, created_at, updated_at, seq)
       VALUES (?, 'b1', 'ygo', 'Trade', '[]', 'all', '[]', 'x', 'x', 1)`
    ).run(other)
    db.prepare(
      `INSERT INTO wishlist_entries (user_id, pkey, game, quantity, created_at, updated_at, seq)
       VALUES (?, 'p1', 'ygo', 2, 'x', 'x', 1), (?, 'p2', 'ygo', 1, 'x', 'x', 2)`
    ).run(other, other)
    db.prepare(
      `INSERT INTO scan_sessions (user_id, uid, game, cards, created_at, updated_at, seq)
       VALUES (?, 's1', 'ygo', '[]', 'x', 'x', 1), (?, 's2', 'ygo', '[]', 'x', 'x', 2)`
    ).run(other, other)
    db.prepare("UPDATE scan_sessions SET deleted_at = 'x' WHERE uid = 's2'").run()

    const code = await linkCode()
    const res = await result(await rpc('mine', 'account:linkCode', [code, VERIFIER]))
    expect(res.status).toBe('merge')
    if (res.status !== 'merge') return
    expect(res.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(res.preview).toEqual({
      mine: {
        username: 'appleuser',
        usernameChosen: false,
        displayName: null,
        avatarUrl: null,
        cards: 5,
        binders: 0,
        wishes: 0,
        sessions: 0
      },
      theirs: {
        username: 'kaiba',
        usernameChosen: true,
        displayName: 'Seto',
        avatarUrl: 'https://cdn.discordapp.com/avatars/111/av.png',
        cards: 9,
        binders: 1,
        wishes: 2,
        sessions: 1
      },
      totals: { higher: 11, sum: 14, mine: 5, theirs: 9 }
    })
    for (const c of ['higher', 'sum', 'mine', 'theirs'] as const)
      expect(res.preview.totals[c]).toBe(cardTotal(db, me, planCardMerge(db, me, other, c)))
    expect(db.prepare('SELECT * FROM merge_tickets').get()).toEqual({
      ticket_hash: sha256Hex(res.ticket),
      user_id: me,
      other_id: other,
      provider: 'discord',
      subject: '111',
      apple_refresh_token: null,
      expires_at: new Date(START.getTime() + 15 * 60_000).toISOString()
    })
    // Nothing moved yet.
    expect(count('SELECT count(*) AS n FROM sign_ins WHERE user_id = ?', me)).toBe(1)
    expect(count('SELECT count(*) AS n FROM sign_ins WHERE user_id = ?', other)).toBe(1)
  })

  it('refuses a merge that would give two Discord sign-ins', async () => {
    const me = addUser(db, '111', 'mine')
    const other = addUser(db, '222', 'other')
    addAppleSignIn(other)
    addSession('mine', me)
    expect(await result(await linkApple('mine'))).toEqual({
      status: 'has-provider',
      provider: 'discord'
    })
    expect(count('SELECT count(*) AS n FROM merge_tickets')).toBe(0)
  })

  it('answers has-provider when the account already has that provider', async () => {
    const me = addUser(db, `apple:${APPLE_SUB}`, 'mine')
    addSession('mine', me)
    discordUser = { id: '333', username: 'x' }
    db.prepare(
      "INSERT INTO sign_ins (provider, subject, user_id, created_at) VALUES ('discord', '444', ?, 'x')"
    ).run(me)
    const code = await linkCode()
    expect(await result(await rpc('mine', 'account:linkCode', [code, VERIFIER]))).toEqual({
      status: 'has-provider',
      provider: 'discord'
    })
    expect(count("SELECT count(*) AS n FROM sign_ins WHERE subject = '333'")).toBe(0)
  })

  it('linkApple attaches a free Apple identity and keeps its refresh token', async () => {
    const me = addUser(db, '111', 'kaiba')
    addSession('mine', me)
    expect(await result(await linkApple('mine', { authorizationCode: 'c0de' }))).toEqual({
      status: 'linked'
    })
    expect(
      db
        .prepare('SELECT provider, subject FROM sign_ins WHERE user_id = ? ORDER BY provider')
        .all(me)
    ).toEqual([
      { provider: 'apple', subject: APPLE_SUB },
      { provider: 'discord', subject: '111' }
    ])
    expect(db.prepare('SELECT refresh_token FROM apple_tokens WHERE user_id = ?').get(me)).toEqual({
      refresh_token: 'rt-link'
    })
    expect(db.prepare('SELECT discord_id FROM users WHERE id = ?').get(me)).toEqual({
      discord_id: '111'
    })
  })

  it('linkApple keeps the pending refresh token on a merge ticket', async () => {
    const me = addUser(db, '111', 'kaiba')
    addUser(db, `apple:${APPLE_SUB}`, 'appleuser')
    addSession('mine', me)
    const res = await result(await linkApple('mine', { authorizationCode: 'c0de' }))
    expect(res.status).toBe('merge')
    expect(
      db.prepare('SELECT provider, subject, apple_refresh_token FROM merge_tickets').get()
    ).toEqual({
      provider: 'apple',
      subject: APPLE_SUB,
      apple_refresh_token: 'rt-link'
    })
    expect(count('SELECT count(*) AS n FROM apple_tokens')).toBe(0)
  })

  it('linkApple refuses an invalid identity token', async () => {
    const me = addUser(db, '111', 'kaiba')
    addSession('mine', me)
    const res = await linkApple('mine', { nonce: 'another_nonce_value_123' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid-token' })
  })

  it('link codes expire and work once', async () => {
    const me = addUser(db, `apple:${APPLE_SUB}`, 'appleuser')
    addSession('mine', me)
    const invalid = { error: 'invalid-code' }

    const code = await linkCode()
    const wrong = await rpc('mine', 'account:linkCode', [code, VERIFIER.replace('v', 'w')])
    expect(wrong.status).toBe(400)
    expect(await wrong.json()).toEqual(invalid)
    // Spent by the failed try.
    const again = await rpc('mine', 'account:linkCode', [code, VERIFIER])
    expect(again.status).toBe(400)
    expect(await again.json()).toEqual(invalid)

    const used = await linkCode()
    expect((await rpc('mine', 'account:linkCode', [used, VERIFIER])).status).toBe(200)
    const twice = await rpc('mine', 'account:linkCode', [used, VERIFIER])
    expect(twice.status).toBe(400)
    expect(await twice.json()).toEqual(invalid)

    db.prepare("DELETE FROM sign_ins WHERE provider = 'discord'").run()
    const late = await linkCode()
    clock = new Date(clock.getTime() + 120_001)
    const res = await rpc('mine', 'account:linkCode', [late, VERIFIER])
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual(invalid)
    expect(count("SELECT count(*) AS n FROM sign_ins WHERE provider = 'discord'")).toBe(0)
    expect(count('SELECT count(*) AS n FROM link_codes')).toBe(0)
  })

  it('link attempts are limited to 10 a day', async () => {
    const me = addUser(db, '111', 'kaiba')
    addUser(db, `apple:${APPLE_SUB}`, 'appleuser')
    addSession('mine', me)
    for (let i = 0; i < 10; i++)
      expect((await result(await linkApple('mine'))).status).toBe('merge')
    const res = await linkApple('mine')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/too often today/)
    expect(count('SELECT count(*) AS n FROM merge_tickets')).toBe(10)
    clock = new Date(clock.getTime() + DAY)
    expect((await result(await linkApple('mine'))).status).toBe('merge')
  })
})
