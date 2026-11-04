import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { gamesFor } from '../../workers/portal/src/auth'
import { mergeAccounts } from '../../workers/portal/src/merge'
import { bindTesterInvites, testerGames } from '../../workers/portal/src/testers'

const BASE = 'https://portal.test'
const DAY = 24 * 60 * 60 * 1000
const START = new Date('2026-11-04T12:00:00.000Z')
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

describe('game tester list', () => {
  let db: Database.Database
  let deps: AppDeps
  let owner: number
  let kaiba: number
  let discordUser: { id: string; username: string }

  beforeEach(async () => {
    db = await seededServerDb()
    discordUser = { id: '555', username: 'DubGrumble' }
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: memoryBucket(),
      printingArt: noPrintingArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        ADMIN_TOKEN: 'admin',
        PRICE_WORKER_URL: 'https://prices.test',
        ADMIN_DISCORD_ID: '999'
      },
      now: () => START,
      fetch: (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === 'https://discord.com/api/oauth2/token')
          return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 })
        if (url === 'https://discord.com/api/users/@me')
          return new Response(JSON.stringify(discordUser), { status: 200 })
        return new Response('?', { status: 404 })
      }) as unknown as typeof fetch
    }
    owner = addUser(db, '999', 'owner')
    kaiba = addUser(db, '111', 'kaiba')
    session(owner, 'tok-owner')
    session(kaiba, 'tok-kaiba')
  })

  function session(userId: number, token: string): void {
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'web', ?, ?)"
    ).run(sha256Hex(token), userId, START.toISOString(), new Date(START.getTime() + 30 * DAY).toISOString())
  }
  const cookie = (token: string): Record<string, string> => ({ cookie: `session=${token}` })
  const post = (
    path: string,
    token: string,
    body: unknown,
    headers: Record<string, string> = { 'content-type': 'application/json', origin: BASE }
  ): Promise<Response> =>
    handle(
      new Request(BASE + path, {
        method: 'POST',
        headers: { ...headers, ...cookie(token) },
        body: JSON.stringify(body)
      }),
      deps
    )
  const list = async (
    token: string
  ): Promise<{ id: number; game: string; discordUsername: string | null; userId: number | null; username: string | null }[]> =>
    ((await (await handle(new Request(BASE + '/admin/testers', { headers: cookie(token) }), deps)).json()) as {
      testers: never[]
    }).testers

  async function signInDiscord(): Promise<string> {
    const start = await handle(new Request(BASE + '/auth/discord/start'), deps)
    const state = /oauth_state=([^;]*)/.exec(start.headers.getSetCookie().join(';'))![1]
    const res = await handle(
      new Request(`${BASE}/auth/discord/callback?code=c&state=${state}`, {
        headers: { cookie: `oauth_state=${state}` }
      }),
      deps
    )
    return /session=([^;]*)/.exec(res.headers.getSetCookie().join(';'))![1]
  }

  it('the seeded row binds on Discord sign-in', async () => {
    const token = await signInDiscord()
    const me = (await (await handle(new Request(BASE + '/api/me', { headers: cookie(token) }), deps)).json()) as {
      games: string[]
    }
    expect(me.games).toEqual(['ygo', 'pkm', 'op'])
    const rows = db.prepare("SELECT user_id FROM game_testers WHERE game = 'op'").all() as { user_id: number }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].user_id).not.toBeNull()
  })

  it("a second account with the same name doesn't take a bound row", () => {
    bindTesterInvites(db, kaiba, 'dubgrumble')
    const rival = addUser(db, '222', 'rival')
    bindTesterInvites(db, rival, 'DUBGRUMBLE')
    expect(testerGames(db, rival)).toEqual([])
    expect(testerGames(db, kaiba)).toEqual(['op'])
  })

  it('add by app username binds at once', async () => {
    const res = await post('/admin/testers', 'tok-owner', { game: 'op', username: 'Kaiba' })
    expect(res.status).toBe(200)
    expect(gamesFor(deps, kaiba)).toContain('op')
    expect(await post('/admin/testers', 'tok-owner', { game: 'op', username: 'Kaiba' })).toMatchObject({ status: 200 })
    expect((await list('tok-owner')).filter((r) => r.userId === kaiba)).toHaveLength(1)
    const missing = await post('/admin/testers', 'tok-owner', { game: 'op', username: 'nobody' })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'no-such-user' })
  })

  it('a pending Discord row is listed as pending', async () => {
    await post('/admin/testers', 'tok-owner', { game: 'op', discordUsername: 'luffy' })
    await post('/admin/testers', 'tok-owner', { game: 'op', discordUsername: 'LUFFY' })
    const rows = await list('tok-owner')
    const luffy = rows.filter((r) => r.discordUsername === 'luffy')
    expect(luffy).toHaveLength(1)
    expect(luffy[0]).toMatchObject({ game: 'op', userId: null, username: null })
  })

  it('remove takes the game away', async () => {
    await post('/admin/testers', 'tok-owner', { game: 'op', username: 'kaiba' })
    const row = (await list('tok-owner')).find((r) => r.userId === kaiba)!
    expect(await (await post('/admin/testers/remove', 'tok-owner', { id: row.id })).json()).toEqual({ ok: true })
    expect(gamesFor(deps, kaiba)).toEqual(['ygo', 'pkm'])
  })

  it('only the owner', async () => {
    expect((await handle(new Request(BASE + '/admin/testers', { headers: cookie('tok-kaiba') }), deps)).status).toBe(404)
    expect((await handle(new Request(BASE + '/admin/testers'), deps)).status).toBe(404)
    expect((await post('/admin/testers', 'tok-kaiba', { game: 'op', username: 'kaiba' })).status).toBe(404)
    expect((await post('/admin/testers/remove', 'tok-kaiba', { id: 1 })).status).toBe(404)
    expect(gamesFor(deps, kaiba)).toEqual(['ygo', 'pkm'])
    const foreign = await post('/admin/testers', 'tok-owner', { game: 'op', username: 'kaiba' }, {
      'content-type': 'application/json',
      origin: 'https://evil.test'
    })
    expect(foreign.status).toBe(404)
    const text = await post('/admin/testers', 'tok-owner', { game: 'op', username: 'kaiba' }, {
      'content-type': 'text/plain',
      origin: BASE
    })
    expect(text.status).toBe(415)
    const pkm = await post('/admin/testers', 'tok-owner', { game: 'pkm', username: 'kaiba' })
    expect(pkm.status).toBe(400)
    expect(await pkm.json()).toEqual({ error: 'not-a-tester-game' })
  })

  it('merge moves tester rows', async () => {
    const me = addUser(db, 'apple:333', 'me')
    bindTesterInvites(db, kaiba, 'dubgrumble')
    mergeAccounts(db, {
      survivor: me,
      closed: kaiba,
      cards: 'sum',
      username: 'mine',
      moved: { provider: 'discord', subject: '111' },
      appleRefreshToken: null,
      now: START
    })
    expect(gamesFor(deps, me)).toContain('op')
  })
})
