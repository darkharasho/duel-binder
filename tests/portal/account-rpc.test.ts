import { createHash, generateKeyPairSync } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { addUser, memoryBucket, noPrintingArt, noPrices } from './helpers'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { migrateServer } from '../../workers/portal/src/migrate'
import { APPLE_REVOKE_URL } from '../../workers/portal/src/apple'
import type { Me } from '../../src/shared/cloud'

const BASE = 'https://portal.test'
const DAY = 24 * 60 * 60 * 1000
const NOW = '2026-11-02T12:00:00.000Z'
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

describe('account RPCs', () => {
  let db: Database.Database
  let deps: AppDeps
  let ann: number
  let clock: Date
  let signinPem: string
  let fetchMock: ReturnType<typeof vi.fn>

  beforeAll(() => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    signinPem = ec.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  })

  const addSession = (token: string, userId: number): void => {
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      sha256Hex(token),
      userId,
      'desktop',
      NOW,
      new Date(Date.parse(NOW) + 30 * DAY).toISOString()
    )
  }

  /** Gives the user an Apple sign-in (added a day after its first) and a stored refresh token. */
  const addApple = (userId: number, sub: string): void => {
    db.prepare(
      "INSERT INTO sign_ins (provider, subject, user_id, created_at) VALUES ('apple', ?, ?, ?)"
    ).run(sub, userId, '2026-10-24T12:00:00.000Z')
    db.prepare(
      'INSERT INTO apple_tokens (user_id, refresh_token, updated_at) VALUES (?, ?, ?)'
    ).run(userId, `rt-${sub}`, NOW)
  }

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrateServer(db)
    ann = addUser(db, '111', 'Ann')
    addSession('ann', ann)
    clock = new Date(NOW)
    fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === APPLE_REVOKE_URL
        ? new Response(null, { status: 200 })
        : new Response('?', { status: 404 })
    )
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

  const call = async (
    channel: string,
    args: unknown[],
    token = 'ann'
  ): Promise<{ status: number; body: { result?: unknown; error?: string } }> => {
    const res = await handle(
      new Request(`${BASE}/api/rpc/${channel}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ args })
      }),
      deps
    )
    return { status: res.status, body: (await res.json()) as { result?: unknown; error?: string } }
  }

  const user = (id: number): { username: string; username_chosen: number; discord_id: string } =>
    db.prepare('SELECT username, username_chosen, discord_id FROM users WHERE id = ?').get(id) as {
      username: string
      username_chosen: number
      discord_id: string
    }

  it('setUsername saves a valid name and marks it chosen', async () => {
    db.prepare('UPDATE users SET username_chosen = 0 WHERE id = ?').run(ann)
    const res = await call('account:setUsername', ['Ann_2'])
    expect(res.status).toBe(200)
    const me = res.body.result as Me
    expect(me.username).toBe('Ann_2')
    expect(me.usernameChosen).toBe(true)
    expect(user(ann)).toMatchObject({ username: 'Ann_2', username_chosen: 1 })
  })

  it('setUsername refuses names that break the rules', async () => {
    for (const [name, error] of [
      ['ab', 'Usernames are 3 to 20 characters'],
      ['a'.repeat(21), 'Usernames are 3 to 20 characters'],
      ['a.b', 'Use letters, numbers, _ and - only']
    ]) {
      expect(await call('account:setUsername', [name])).toEqual({ status: 400, body: { error } })
    }
    expect((await call('account:setUsername', [42])).status).toBe(400)
    expect(user(ann).username).toBe('Ann')
  })

  it('setUsername refuses a name taken in another case', async () => {
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run('me_1', ann)
    addUser(db, '222', 'ann')
    expect(await call('account:setUsername', ['ANN'])).toEqual({
      status: 400,
      body: { error: 'That username is taken' }
    })
    expect(user(ann).username).toBe('me_1')
    // Your own name in another case is yours to take.
    db.prepare('UPDATE users SET username = ? WHERE discord_id = ?').run('bob', '222')
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run('Ann', ann)
    const res = await call('account:setUsername', ['ANN'])
    expect(res.status).toBe(200)
    expect((res.body.result as Me).username).toBe('ANN')
    expect(user(ann).username).toBe('ANN')
  })

  it('setUsername allows 5 changes a day', async () => {
    for (let i = 1; i <= 5; i++) {
      clock = new Date(Date.parse(NOW) + i * 60_000)
      expect((await call('account:setUsername', [`ann_${i}`])).status).toBe(200)
    }
    clock = new Date(Date.parse(NOW) + 6 * 60_000)
    expect(await call('account:setUsername', ['ann_6'])).toEqual({
      status: 400,
      body: { error: "You've changed your username too often today. Try again tomorrow." }
    })
    expect(user(ann).username).toBe('ann_5')
    // A day after the first change, one more is allowed.
    clock = new Date(Date.parse(NOW) + DAY + 60_000)
    expect((await call('account:setUsername', ['ann_6'])).status).toBe(200)
  })

  it("signIns lists the account's methods", async () => {
    addApple(ann, '000123.abc')
    const res = await call('account:signIns', [])
    expect(res.status).toBe(200)
    expect(res.body.result).toEqual([
      { provider: 'discord', addedAt: '2026-10-23T12:00:00.000Z' },
      { provider: 'apple', addedAt: '2026-10-24T12:00:00.000Z' }
    ])
  })

  it('removeSignIn refuses the last one', async () => {
    expect(await call('account:removeSignIn', ['discord'])).toEqual({
      status: 400,
      body: { error: "This is your only way to sign in, so it can't be removed" }
    })
    expect((await call('account:signIns', [])).body.result).toHaveLength(1)
    expect((await call('account:removeSignIn', ['email'])).status).toBe(400)
  })

  it('removeSignIn of Apple revokes its token and drops apple_tokens', async () => {
    addApple(ann, '000123.abc')
    const res = await call('account:removeSignIn', ['apple'])
    expect(res).toEqual({ status: 200, body: { result: null } })
    const revokes = fetchMock.mock.calls.filter(([url]) => String(url) === APPLE_REVOKE_URL)
    expect(revokes).toHaveLength(1)
    expect(new URLSearchParams(revokes[0][1]?.body as URLSearchParams).get('token')).toBe(
      'rt-000123.abc'
    )
    expect(db.prepare('SELECT 1 FROM apple_tokens WHERE user_id = ?').get(ann)).toBeUndefined()
    expect((await call('account:signIns', [])).body.result).toEqual([
      { provider: 'discord', addedAt: '2026-10-23T12:00:00.000Z' }
    ])
    expect(user(ann).discord_id).toBe('111')
  })

  it('removeSignIn of Discord moves the legacy id to apple:<sub>', async () => {
    addApple(ann, '000123.abc')
    expect((await call('account:removeSignIn', ['discord'])).status).toBe(200)
    expect(user(ann).discord_id).toBe('apple:000123.abc')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.prepare('SELECT 1 FROM apple_tokens WHERE user_id = ?').get(ann)).toBeDefined()
  })

  it('dismissLinkHint clears the hint', async () => {
    db.prepare('UPDATE users SET link_hint = 1 WHERE id = ?').run(ann)
    const res = await call('account:dismissLinkHint', [])
    expect(res.status).toBe(200)
    expect((res.body.result as Me).linkHint).toBeNull()
    expect(
      (db.prepare('SELECT link_hint FROM users WHERE id = ?').get(ann) as { link_hint: number })
        .link_hint
    ).toBe(0)
  })

  it("friend requests can't find a closed account", async () => {
    const closed = addUser(db, '333', 'carol')
    db.prepare('UPDATE users SET closed_at = ? WHERE id = ?').run(NOW, closed)
    const res = await call('friends:request', ['carol'])
    expect(res).toEqual({ status: 400, body: { error: 'No Duel Binder user called "carol"' } })
    expect(await call('friends:request', ['nobody'])).toEqual({
      status: 400,
      body: { error: 'No Duel Binder user called "nobody"' }
    })
  })
})
