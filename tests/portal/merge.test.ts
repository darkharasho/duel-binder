import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'
import { APPLE_NONCE, appleIdentityToken, appleTestKeys } from './appleKeys'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { APPLE_KEYS_URL, APPLE_TOKEN_URL, resetAppleKeys } from '../../workers/portal/src/apple'
import { pruneExpired } from '../../workers/portal/src/auth'
import { mergeAccounts, undoMerge } from '../../workers/portal/src/merge'
import { pullSince } from '../../workers/portal/src/sync'
import type { CardChoice, LinkResult, MergePreview } from '../../src/shared/account'
import type { Me } from '../../src/shared/cloud'

const BASE = 'https://portal.test'
const DAY = 24 * 60 * 60 * 1000
const START = new Date('2026-11-02T12:00:00.000Z')
const STATE = 'state_0123456789abcdef'
const VERIFIER = 'verifier-0123456789-abcdefghijklmnopqrstuvwxyz-ABCDEFG'
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')
const APPLE_SUB = '000123.abc'
const EXPIRED = { error: 'This link expired. Try linking again.' }
const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')
const b64url = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url')

describe('merging two accounts', () => {
  let db: Database.Database
  let deps: AppDeps
  let clock: Date
  let printings: number[]
  let images: number[]
  let seq = 0

  beforeEach(async () => {
    resetAppleKeys()
    clock = new Date(START)
    db = await seededServerDb()
    printings = (
      db.prepare('SELECT id FROM card_printings ORDER BY id LIMIT 3').all() as { id: number }[]
    ).map((r) => r.id)
    images = (
      db.prepare('SELECT image_id FROM card_images ORDER BY image_id LIMIT 2').all() as {
        image_id: number
      }[]
    ).map((r) => r.image_id)
    const { jwks, signinPem } = appleTestKeys()
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      if (url === 'https://discord.com/api/oauth2/token')
        return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 })
      if (url === 'https://discord.com/api/users/@me')
        return new Response(
          JSON.stringify({ id: '111', username: 'kaiba', global_name: 'Seto', avatar: 'abc' }),
          { status: 200 }
        )
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

  // ---- helpers ----

  const cookieOf = (res: Response, name: string): string | undefined => {
    for (const c of res.headers.getSetCookie()) {
      const m = c.match(new RegExp(`^${name}=([^;]*)`))
      if (m) return m[1]
    }
    return undefined
  }
  const get = (path: string, headers: Record<string, string> = {}): Promise<Response> =>
    handle(new Request(BASE + path, { headers }), deps)
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {}
  ): Promise<Response> =>
    handle(
      new Request(BASE + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body)
      }),
      deps
    )
  const count = (sql: string, ...args: unknown[]): number =>
    (db.prepare(sql).get(...args) as { n: number }).n
  const liveTotal = (userId: number): number =>
    count(
      'SELECT COALESCE(SUM(quantity), 0) AS n FROM collection_entries WHERE user_id = ? AND deleted_at IS NULL',
      userId
    )
  const rowsOf = (userId: number): unknown[] =>
    db.prepare('SELECT * FROM collection_entries WHERE user_id = ? ORDER BY id').all(userId)

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
  const addCard = (
    userId: number,
    printingId: number,
    quantity: number,
    { deleted = false, image = images[0], notes = '' } = {}
  ): number =>
    Number(
      db
        .prepare(
          `INSERT INTO collection_entries (user_id, uid, printing_id, image_id, quantity, notes,
             created_at, updated_at, deleted_at, server_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          userId,
          `uid-${++seq}`,
          printingId,
          image,
          quantity,
          notes,
          '2026-10-01T00:00:00.000Z',
          '2026-10-01T00:00:00.000Z',
          deleted ? '2026-10-01T00:00:00.000Z' : null,
          1000 + seq
        ).lastInsertRowid
    )

  /** Task 3's fixture: 5 cards here, 9 there; higher 11, sum 14, mine 5, theirs 9. */
  const cardFixture = (mine: number, theirs: number): void => {
    const [k, ka, kb] = printings
    addCard(mine, k, 3)
    addCard(mine, ka, 2)
    addCard(theirs, k, 5)
    addCard(theirs, kb, 4)
    addCard(theirs, ka, 7, { deleted: true })
    addCard(mine, kb, 9, { deleted: true })
  }

  const rpc = (token: string, channel: string, args: unknown[]): Promise<Response> =>
    post(`/api/rpc/${channel}`, { args }, { authorization: `Bearer ${token}` })

  async function mergeTicket(res: Response): Promise<{ ticket: string; preview: MergePreview }> {
    expect(res.status).toBe(200)
    const result = ((await res.json()) as { result: LinkResult }).result
    expect(result.status).toBe('merge')
    if (result.status !== 'merge') throw new Error('no ticket')
    return { ticket: result.ticket, preview: result.preview }
  }
  /** `token`'s account links the Apple id 000123.abc, which another account has. */
  const appleTicket = (
    token: string,
    extra: Record<string, unknown> = {}
  ): Promise<{ ticket: string; preview: MergePreview }> =>
    rpc(token, 'account:linkApple', [
      { identityToken: appleIdentityToken(clock), nonce: APPLE_NONCE, ...extra }
    ]).then(mergeTicket)
  /** Discord's browser flow: with `link` it hands back a link code, else a desktop sign-in code. */
  async function discordCode(link: boolean): Promise<string> {
    const start = await get(
      `/auth/desktop/start?port=53682&state=${STATE}&challenge=${CHALLENGE}${link ? '&intent=link' : ''}`
    )
    const oauthState = cookieOf(start, 'oauth_state')!
    const desktop = cookieOf(start, 'desktop_auth')!
    const res = await get(`/auth/discord/callback?code=c&state=${oauthState}`, {
      cookie: `oauth_state=${oauthState}; desktop_auth=${desktop}`
    })
    return new URL(res.headers.get('location')!).searchParams.get('code')!
  }
  /** `token`'s account links Discord 111, which another account has. */
  const discordTicket = async (token: string): Promise<{ ticket: string; preview: MergePreview }> =>
    mergeTicket(await rpc(token, 'account:linkCode', [await discordCode(true), VERIFIER]))

  const merge = (
    token: string,
    ticket: string,
    cards: CardChoice = 'higher',
    username: 'mine' | 'theirs' = 'mine'
  ): Promise<Response> => rpc(token, 'account:merge', [ticket, { cards, username }])

  async function merged(res: Response): Promise<Me> {
    expect(res.status, await res.clone().text()).toBe(200)
    return ((await res.json()) as { result: Me }).result
  }

  /** Discord 111 `kaiba` (signed in as 'mine') and Apple-only `appleuser` (signed in as 'theirs'). */
  function discordAndApple(): { me: number; other: number } {
    const me = addUser(db, '111', 'kaiba')
    const other = addUser(db, `apple:${APPLE_SUB}`, 'appleuser')
    addSession('mine', me)
    addSession('theirs', other)
    return { me, other }
  }
  /** Apple-only `appleuser` (signed in as 'mine') and Discord 111 `kaiba` (signed in as 'theirs'). */
  function appleAndDiscord(): { me: number; other: number } {
    const me = addUser(db, `apple:${APPLE_SUB}`, 'appleuser')
    const other = addUser(db, '111', 'kaiba')
    addSession('mine', me)
    addSession('theirs', other)
    return { me, other }
  }

  // ---- tests ----

  it.each(['higher', 'mine', 'theirs', 'sum'] as const)(
    'each card choice leaves exactly the previewed total (%s)',
    async (choice) => {
      const { me, other } = discordAndApple()
      cardFixture(me, other)
      const { ticket, preview } = await appleTicket('mine')
      expect(preview.totals).toEqual({ higher: 11, sum: 14, mine: 5, theirs: 9 })
      const before = rowsOf(other)

      const result = await merged(await merge('mine', ticket, choice))
      expect(result.id).toBe(me)
      expect(liveTotal(me)).toBe(preview.totals[choice])
      // The closed account's rows are untouched, held for 30 days.
      expect(rowsOf(other)).toEqual(before)
      expect(db.prepare('SELECT * FROM account_merges').get()).toMatchObject({
        closed_id: other,
        survivor_id: me,
        cards: choice,
        closed_username: 'appleuser',
        merged_at: START.toISOString(),
        purge_after: new Date(START.getTime() + 30 * DAY).toISOString(),
        purged_at: null
      })
    }
  )

  it("merged rows reach the survivor's devices", async () => {
    const { me, other } = discordAndApple()
    cardFixture(me, other)
    const cursor = pullSince(db, me, 0).cursor
    const theirUids = new Set(
      (
        db.prepare('SELECT uid FROM collection_entries WHERE user_id = ?').all(other) as {
          uid: string
        }[]
      ).map((r) => r.uid)
    )
    const { ticket, preview } = await appleTicket('mine')
    await merged(await merge('mine', ticket, 'theirs'))

    const pulled = pullSince(db, me, cursor).entries
    const live = pulled.filter((e) => e.deletedAt === null)
    const gone = pulled.filter((e) => e.deletedAt !== null)
    // K updated to their 5, KB copied over as a new row, KA (only mine) tombstoned.
    expect(live.map((e) => e.quantity).sort()).toEqual([4, 5])
    expect(gone.map((e) => e.quantity)).toEqual([2])
    for (const e of pulled) expect(theirUids.has(e.uid)).toBe(false)
    const inserted = live.find((e) => e.quantity === 4)!
    expect(inserted.createdAt).toBe('2026-10-01T00:00:00.000Z')
    expect(inserted.updatedAt).toBe(START.toISOString())
    // A device that applies the pull ends at the previewed total.
    expect(live.reduce((n, e) => n + e.quantity, 0)).toBe(preview.totals.theirs)
  })

  it("an update keeps the survivor's notes, or takes theirs when the survivor has none", async () => {
    const { me, other } = discordAndApple()
    const [k, ka] = printings
    const a = addCard(me, k, 1, { notes: 'mine' })
    const b = addCard(me, ka, 1)
    addCard(other, k, 2, { notes: 'theirs' })
    addCard(other, ka, 2, { notes: 'theirs' })
    const { ticket } = await appleTicket('mine')
    await merged(await merge('mine', ticket, 'higher'))
    const notes = (id: number): string =>
      (db.prepare('SELECT notes FROM collection_entries WHERE id = ?').get(id) as { notes: string })
        .notes
    expect([notes(a), notes(b)]).toEqual(['mine', 'theirs'])
  })

  it('wishlist keeps the higher count, favourites union, binders copied with a suffix on clashes', async () => {
    const { me, other } = discordAndApple()
    const wish = db.prepare(
      `INSERT INTO wishlist_entries (user_id, pkey, game, quantity, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, 'ygo', ?, 'x', 'x', ?, ?)`
    )
    wish.run(me, 'p1', 1, null, 1)
    wish.run(me, 'p3', null, null, 2)
    wish.run(me, 'p4', 5, 'x', 3)
    wish.run(me, 'p5', 4, null, 4)
    wish.run(other, 'p1', 3, null, 5)
    wish.run(other, 'p2', 2, null, 6)
    wish.run(other, 'p3', 2, null, 7)
    wish.run(other, 'p4', 1, null, 8)
    wish.run(other, 'p5', 2, null, 9)
    wish.run(other, 'p6', 2, 'x', 10)
    const fav = db.prepare(
      `INSERT INTO favourites (user_id, card_id, game, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, 'ygo', 'x', 'x', ?, ?)`
    )
    fav.run(me, 1, null, 1)
    fav.run(me, 3, 'x', 2)
    fav.run(other, 1, null, 3)
    fav.run(other, 2, null, 4)
    fav.run(other, 3, null, 5)
    const binder = db.prepare(
      `INSERT INTO binders (user_id, uid, game, name, rules, goal, languages, created_at, updated_at, deleted_at, seq)
       VALUES (?, ?, ?, ?, '[]', 'all', '[]', 'x', 'x', ?, ?)`
    )
    binder.run(me, 'b-me', 'ygo', 'Trade', null, 1)
    binder.run(other, 'b-1', 'ygo', 'Trade', null, 2)
    binder.run(other, 'b-2', 'pkm', 'Trade', null, 3)
    binder.run(other, 'b-3', 'ygo', 'Trade', null, 4)
    binder.run(other, 'b-4', 'ygo', 'Gone', 'x', 5)
    db.prepare(
      `INSERT INTO binder_edits (user_id, binder_uid, level, target, game, action, created_at, updated_at, seq)
       VALUES (?, 'b-1', 'card', '42', 'ygo', 'add', 'x', 'x', 1)`
    ).run(other)
    const top = (table: string): number => count(`SELECT MAX(seq) AS n FROM ${table}`)
    const before = {
      wishlist_entries: top('wishlist_entries'),
      favourites: top('favourites'),
      binders: top('binders'),
      binder_edits: top('binder_edits')
    }

    const { ticket } = await appleTicket('mine')
    await merged(await merge('mine', ticket))

    expect(
      db
        .prepare(
          'SELECT pkey, quantity, deleted_at IS NOT NULL AS gone FROM wishlist_entries WHERE user_id = ? ORDER BY pkey'
        )
        .all(me)
    ).toEqual([
      { pkey: 'p1', quantity: 3, gone: 0 },
      { pkey: 'p2', quantity: 2, gone: 0 },
      { pkey: 'p3', quantity: 2, gone: 0 },
      { pkey: 'p4', quantity: 1, gone: 0 },
      { pkey: 'p5', quantity: 4, gone: 0 }
    ])
    // Every changed wish has a new seq, so devices pull it; the unchanged p5 keeps its own.
    const wishSeq = db
      .prepare('SELECT pkey, seq FROM wishlist_entries WHERE user_id = ?')
      .all(me) as { pkey: string; seq: number }[]
    for (const w of wishSeq)
      if (w.pkey === 'p5') expect(w.seq).toBe(4)
      else expect(w.seq).toBeGreaterThan(before.wishlist_entries)

    expect(
      db
        .prepare(
          'SELECT card_id, deleted_at IS NOT NULL AS gone, seq > ? AS fresh FROM favourites WHERE user_id = ? ORDER BY card_id'
        )
        .all(before.favourites, me)
    ).toEqual([
      { card_id: 1, gone: 0, fresh: 0 },
      { card_id: 2, gone: 0, fresh: 1 },
      { card_id: 3, gone: 0, fresh: 1 }
    ])

    expect(
      db
        .prepare(
          'SELECT uid, game, name, seq > ? AS fresh FROM binders WHERE user_id = ? ORDER BY uid'
        )
        .all(before.binders, me)
    ).toEqual([
      { uid: 'b-1', game: 'ygo', name: 'Trade (2)', fresh: 1 },
      { uid: 'b-2', game: 'pkm', name: 'Trade', fresh: 1 },
      { uid: 'b-3', game: 'ygo', name: 'Trade (3)', fresh: 1 },
      { uid: 'b-me', game: 'ygo', name: 'Trade', fresh: 0 }
    ])
    expect(
      db
        .prepare(
          'SELECT binder_uid, level, target, action, seq > ? AS fresh FROM binder_edits WHERE user_id = ?'
        )
        .all(before.binder_edits, me)
    ).toEqual([{ binder_uid: 'b-1', level: 'card', target: '42', action: 'add', fresh: 1 }])
    // The closed account's own rows stay as they were.
    expect(count('SELECT count(*) AS n FROM wishlist_entries WHERE user_id = ?', other)).toBe(6)
    expect(count('SELECT count(*) AS n FROM binders WHERE user_id = ?', other)).toBe(4)
  })

  it('friends: pending upgraded, the two accounts’ friendship dropped, block wins', async () => {
    const { me, other } = discordAndApple()
    const [x, y, z, w, v] = ['xx1', 'yy1', 'zz1', 'ww1', 'vv1'].map((n, i) =>
      addUser(db, String(900 + i), n)
    )
    const friend = db.prepare(
      `INSERT INTO friendships (requester_id, addressee_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'x', 'x')`
    )
    friend.run(me, x, 'pending')
    friend.run(x, other, 'accepted')
    friend.run(me, other, 'accepted')
    friend.run(other, y, 'accepted')
    friend.run(v, other, 'pending')
    const block = db.prepare(
      "INSERT INTO friend_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, 'x')"
    )
    block.run(me, y)
    block.run(other, z)
    block.run(w, other)

    const { ticket } = await appleTicket('mine')
    await merged(await merge('mine', ticket))

    expect(
      db
        .prepare(
          'SELECT requester_id AS r, addressee_id AS a, status FROM friendships ORDER BY r, a'
        )
        .all()
    ).toEqual(
      [
        { r: me, a: x, status: 'accepted' },
        { r: v, a: me, status: 'pending' }
      ].sort((p, q) => p.r - q.r || p.a - q.a)
    )
    expect(
      db.prepare('SELECT blocker_id AS b, blocked_id AS d FROM friend_blocks ORDER BY b, d').all()
    ).toEqual(
      [
        { b: me, d: y },
        { b: me, d: z },
        { b: w, d: me }
      ].sort((p, q) => p.b - q.b || p.d - q.d)
    )
  })

  it("the closed account's sign-in now opens the survivor, its sessions are gone", async () => {
    const { me, other } = appleAndDiscord()
    db.prepare(
      "INSERT INTO desktop_codes (code_hash, user_id, challenge, expires_at) VALUES ('h', ?, 'c', ?)"
    ).run(other, new Date(START.getTime() + 60_000).toISOString())
    expect((await get('/api/me', { authorization: 'Bearer theirs' })).status).toBe(200)
    const { ticket } = await discordTicket('mine')
    await merged(await merge('mine', ticket))

    expect((await get('/api/me', { authorization: 'Bearer theirs' })).status).toBe(401)
    expect((await get('/api/me', { authorization: 'Bearer mine' })).status).toBe(200)
    expect(count('SELECT count(*) AS n FROM desktop_codes WHERE user_id = ?', other)).toBe(0)
    expect(count('SELECT count(*) AS n FROM sign_ins WHERE user_id = ?', other)).toBe(0)
    expect(
      db.prepare('SELECT provider FROM sign_ins WHERE user_id = ? ORDER BY provider').all(me)
    ).toEqual([{ provider: 'apple' }, { provider: 'discord' }])
    expect(db.prepare('SELECT discord_id FROM users WHERE id = ?').get(me)).toEqual({
      discord_id: '111'
    })
    expect(db.prepare('SELECT discord_id, closed_at FROM users WHERE id = ?').get(other)).toEqual({
      discord_id: `user:${other}`,
      closed_at: START.toISOString()
    })

    const res = await post('/auth/desktop/token', {
      code: await discordCode(false),
      verifier: VERIFIER
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { user: Me }).user.id).toBe(me)
  })

  it('moves the Apple refresh token with the sign-in, or keeps the one the link brought', async () => {
    const { me } = discordAndApple()
    const { ticket } = await appleTicket('mine', { authorizationCode: 'c0de' })
    await merged(await merge('mine', ticket))
    expect(db.prepare('SELECT user_id, refresh_token FROM apple_tokens').all()).toEqual([
      { user_id: me, refresh_token: 'rt-link' }
    ])
    expect(
      db.prepare('SELECT moved_sign_ins, moved_apple_token FROM account_merges').get()
    ).toEqual({
      moved_sign_ins: JSON.stringify([{ provider: 'apple', subject: APPLE_SUB }]),
      moved_apple_token: 1
    })
  })

  it('moves an Apple refresh token the closed account already had', async () => {
    const { me, other } = discordAndApple()
    db.prepare(
      "INSERT INTO apple_tokens (user_id, refresh_token, updated_at) VALUES (?, 'rt-old', 'x')"
    ).run(other)
    // The closed account's own token wins over the one this link brought.
    const { ticket } = await appleTicket('mine', { authorizationCode: 'c0de' })
    await merged(await merge('mine', ticket))
    expect(db.prepare('SELECT user_id, refresh_token FROM apple_tokens').all()).toEqual([
      { user_id: me, refresh_token: 'rt-old' }
    ])
    expect(db.prepare('SELECT moved_apple_token FROM account_merges').get()).toEqual({
      moved_apple_token: 1
    })
  })

  it("keeps the survivor's own Apple token when the closed account brings none", async () => {
    const { me } = appleAndDiscord()
    db.prepare(
      "INSERT INTO apple_tokens (user_id, refresh_token, updated_at) VALUES (?, 'rt-mine', 'x')"
    ).run(me)
    const { ticket } = await discordTicket('mine')
    await merged(await merge('mine', ticket))
    expect(db.prepare('SELECT user_id, refresh_token FROM apple_tokens').all()).toEqual([
      { user_id: me, refresh_token: 'rt-mine' }
    ])
    expect(db.prepare('SELECT moved_apple_token FROM account_merges').get()).toEqual({
      moved_apple_token: 0
    })
  })

  it('a merge moves training photos to the survivor', async () => {
    const { me, other } = discordAndApple()
    const ins = db.prepare(
      `INSERT INTO training_photos (user_id, client_id, game, card_id, printing_id, holder, device,
         app_version, taken_at, created_at, bytes, r2_key)
       VALUES (?, ?, 'op', 1, 1, 'bare', 'd', '0.54.0', 'x', 'x', 3, ?)`
    )
    const keys = ['a', 'b'].map((c) => `training/op/${other}/${c}.jpg`)
    ins.run(other, 'a', keys[0])
    ins.run(other, 'b', keys[1])
    const photos = (): unknown[] =>
      db.prepare('SELECT user_id, r2_key FROM training_photos ORDER BY id').all()
    const { ticket } = await appleTicket('mine')
    await merged(await merge('mine', ticket))
    expect(photos()).toEqual(keys.map((r2_key) => ({ user_id: me, r2_key })))
    undoMerge(db, other, clock)
    expect(photos()).toEqual(keys.map((r2_key) => ({ user_id: me, r2_key })))
  })

  it('keeping their username moves it', async () => {
    const { me, other } = discordAndApple()
    const { ticket } = await appleTicket('mine')
    const result = await merged(await merge('mine', ticket, 'higher', 'theirs'))
    expect(result.username).toBe('appleuser')
    expect(result.usernameChosen).toBe(true)
    expect(db.prepare('SELECT username FROM users WHERE id = ?').get(me)).toEqual({
      username: 'appleuser'
    })
    expect(db.prepare('SELECT username FROM users WHERE id = ?').get(other)).toEqual({
      username: `merged-${other}`
    })
  })

  it('keeping my username leaves theirs reserved on the closed account', async () => {
    const { me, other } = discordAndApple()
    const { ticket } = await appleTicket('mine')
    expect((await merged(await merge('mine', ticket, 'higher', 'mine'))).username).toBe('kaiba')
    expect(db.prepare('SELECT username FROM users WHERE id = ?').get(other)).toEqual({
      username: 'appleuser'
    })
    void me
  })

  it('/api/me lists mergedFrom, transitively', async () => {
    const a = addUser(db, '501', 'aaa')
    const b = addUser(db, 'apple:b-sub', 'bbb')
    const c = addUser(db, '503', 'ccc')
    db.prepare("UPDATE sign_ins SET provider = 'email' WHERE user_id = ?").run(c)
    addSession('a', a)
    addSession('c', c)
    const meOf = async (token: string): Promise<Me> =>
      (await get('/api/me', { authorization: `Bearer ${token}` })).json() as Promise<Me>
    expect((await meOf('a')).mergedFrom).toBeUndefined()

    mergeAccounts(db, {
      survivor: a,
      closed: b,
      cards: 'higher',
      username: 'mine',
      moved: { provider: 'apple', subject: 'b-sub' },
      appleRefreshToken: null,
      now: clock
    })
    expect((await meOf('a')).mergedFrom).toEqual([b])
    mergeAccounts(db, {
      survivor: c,
      closed: a,
      cards: 'higher',
      username: 'mine',
      moved: { provider: 'discord', subject: '501' },
      appleRefreshToken: null,
      now: clock
    })
    expect([...(await meOf('c')).mergedFrom!].sort()).toEqual([a, b].sort())
  })

  it('rejects a stale ticket: its sign-in was removed', async () => {
    const { me, other } = discordAndApple()
    cardFixture(me, other)
    const { ticket } = await appleTicket('mine')
    db.prepare("DELETE FROM sign_ins WHERE user_id = ? AND provider = 'apple'").run(other)
    const before = { mine: rowsOf(me), theirs: rowsOf(other) }
    const res = await merge('mine', ticket)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual(EXPIRED)
    expect({ mine: rowsOf(me), theirs: rowsOf(other) }).toEqual(before)
    expect(count('SELECT count(*) AS n FROM account_merges')).toBe(0)
    expect(count('SELECT count(*) AS n FROM merge_tickets')).toBe(0)
    expect(db.prepare('SELECT closed_at FROM users WHERE id = ?').get(other)).toEqual({
      closed_at: null
    })
  })

  it('rejects a stale ticket: past 15 minutes', async () => {
    const { me, other } = discordAndApple()
    cardFixture(me, other)
    const { ticket } = await appleTicket('mine')
    clock = new Date(START.getTime() + 15 * 60_000 + 1)
    const before = { mine: rowsOf(me), theirs: rowsOf(other) }
    const res = await merge('mine', ticket)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual(EXPIRED)
    expect({ mine: rowsOf(me), theirs: rowsOf(other) }).toEqual(before)
    expect(count('SELECT count(*) AS n FROM sign_ins WHERE user_id = ?', other)).toBe(1)
  })

  it("rejects someone else's ticket, a used ticket, and a closed other account", async () => {
    const { me, other } = discordAndApple()
    const third = addUser(db, '333', 'third')
    addSession('third', third)
    const first = await appleTicket('mine')
    // Another account can't spend it, and trying spends it.
    expect(await (await merge('third', first.ticket)).json()).toEqual(EXPIRED)
    expect((await merge('mine', first.ticket)).status).toBe(400)

    const second = await appleTicket('mine')
    const extra = await appleTicket('mine')
    await merged(await merge('mine', second.ticket))
    // A merge spends the caller's other tickets too.
    expect(count('SELECT count(*) AS n FROM merge_tickets')).toBe(0)
    expect(await (await merge('mine', extra.ticket)).json()).toEqual(EXPIRED)
    expect(await (await merge('mine', second.ticket)).json()).toEqual(EXPIRED)
    expect(count('SELECT count(*) AS n FROM account_merges')).toBe(1)

    // A ticket naming the now-closed account (whose sign-in has moved to the survivor).
    db.prepare(
      `INSERT INTO merge_tickets (ticket_hash, user_id, other_id, provider, subject, expires_at)
       VALUES (?, ?, ?, 'apple', ?, ?)`
    ).run(
      sha256Hex('late'),
      third,
      other,
      APPLE_SUB,
      new Date(START.getTime() + 60_000).toISOString()
    )
    expect(await (await merge('third', 'late')).json()).toEqual(EXPIRED)
    expect(count('SELECT count(*) AS n FROM sign_ins WHERE user_id = ?', me)).toBe(2)
    expect(count('SELECT count(*) AS n FROM account_merges')).toBe(1)
  })

  it('rejects a ticket when the accounts now share a provider', async () => {
    const { me, other } = discordAndApple()
    const { ticket } = await appleTicket('mine')
    db.prepare(
      "INSERT INTO sign_ins (provider, subject, user_id, created_at) VALUES ('discord', '777', ?, 'x')"
    ).run(other)
    const res = await merge('mine', ticket)
    expect(await res.json()).toEqual(EXPIRED)
    expect(count('SELECT count(*) AS n FROM sign_ins WHERE user_id = ?', other)).toBe(2)
    void me
  })

  it('rejects bad arguments', async () => {
    discordAndApple()
    const { ticket } = await appleTicket('mine')
    for (const args of [
      [ticket, { cards: 'most', username: 'mine' }],
      [ticket, { cards: 'higher', username: 'both' }],
      [ticket, null],
      [42, { cards: 'higher', username: 'mine' }]
    ])
      expect((await rpc('mine', 'account:merge', args)).status).toBe(400)
    // A bad choice doesn't spend the ticket.
    await merged(await merge('mine', ticket))
  })

  it('the admin stays admin after merging into an Apple-first account', async () => {
    deps.env.ADMIN_DISCORD_ID = '111'
    const { me } = appleAndDiscord()
    const before = (await (await get('/api/me', { authorization: 'Bearer mine' })).json()) as Me
    expect(before.admin).toBeUndefined()
    const { ticket } = await discordTicket('mine')
    await merged(await merge('mine', ticket))
    const after = (await (await get('/api/me', { authorization: 'Bearer mine' })).json()) as Me
    expect(after).toMatchObject({ id: me, admin: true })
  })

  it('holds are purged after 30 days', async () => {
    const { me, other } = discordAndApple()
    cardFixture(me, other)
    db.prepare(
      `INSERT INTO wishlist_entries (user_id, pkey, game, quantity, created_at, updated_at, seq)
       VALUES (?, 'p1', 'ygo', 1, 'x', 'x', 1)`
    ).run(other)
    const { ticket, preview } = await appleTicket('mine')
    await merged(await merge('mine', ticket))

    pruneExpired(deps, new Date(START.getTime() + 29 * DAY).toISOString())
    expect(count('SELECT count(*) AS n FROM users WHERE id = ?', other)).toBe(1)

    pruneExpired(deps, new Date(START.getTime() + 31 * DAY).toISOString())
    expect(count('SELECT count(*) AS n FROM users WHERE id = ?', other)).toBe(0)
    expect(count('SELECT count(*) AS n FROM collection_entries WHERE user_id = ?', other)).toBe(0)
    expect(count('SELECT count(*) AS n FROM wishlist_entries WHERE user_id = ?', other)).toBe(0)
    expect(db.prepare('SELECT closed_id, purged_at FROM account_merges').get()).toEqual({
      closed_id: other,
      purged_at: new Date(START.getTime() + 31 * DAY).toISOString()
    })
    // The survivor keeps the merged collection.
    expect(liveTotal(me)).toBe(preview.totals.higher)
    expect((await get('/api/me', { authorization: 'Bearer mine' })).status).toBe(200)
  })

  describe('a purged closed id reused by a new user', () => {
    /** Merges, purges the hold, then signs up a new user who gets the closed account's old id. */
    async function reused(): Promise<{ me: number; other: number; fresh: number }> {
      const { me, other } = discordAndApple()
      cardFixture(me, other)
      const { ticket } = await appleTicket('mine')
      await merged(await merge('mine', ticket))
      clock = new Date(START.getTime() + 31 * DAY)
      pruneExpired(deps, clock.toISOString())
      const fresh = addUser(db, '777', 'newcomer')
      // users.id has no AUTOINCREMENT: the highest id, once deleted, is handed out again.
      expect(fresh).toBe(other)
      addSession('fresh', fresh)
      // Past the merge's seqs, which follow the fixture's.
      seq += 100
      addCard(fresh, printings[0], 2)
      return { me, other, fresh }
    }

    it("is not in the survivor's mergedFrom", async () => {
      await reused()
      const me = (await (await get('/api/me', { authorization: 'Bearer mine' })).json()) as Me
      expect(me.mergedFrom).toBeUndefined()
    })

    it('is left intact when the survivor deletes its account', async () => {
      const { me, fresh } = await reused()
      const res = await post(
        '/api/account/delete',
        { confirm: 'delete' },
        { authorization: 'Bearer mine' }
      )
      expect(res.status).toBe(204)
      expect(count('SELECT count(*) AS n FROM users WHERE id = ?', me)).toBe(0)
      expect(count('SELECT count(*) AS n FROM users WHERE id = ?', fresh)).toBe(1)
      expect(liveTotal(fresh)).toBe(2)
      expect((await get('/api/me', { authorization: 'Bearer fresh' })).status).toBe(200)
    })

    it("can't be undone into, and can itself be merged away later", async () => {
      const { fresh } = await reused()
      expect(() => undoMerge(db, fresh, clock)).toThrow('This merge is past its 30 days')
      expect(
        count('SELECT count(*) AS n FROM users WHERE id = ? AND closed_at IS NULL', fresh)
      ).toBe(1)
      const third = addUser(db, 'apple:third-sub', 'third')
      mergeAccounts(db, {
        survivor: third,
        closed: fresh,
        cards: 'higher',
        username: 'mine',
        moved: { provider: 'discord', subject: '777' },
        appleRefreshToken: null,
        now: clock
      })
      expect(
        db
          .prepare('SELECT survivor_id, purged_at FROM account_merges WHERE closed_id = ?')
          .get(fresh)
      ).toEqual({ survivor_id: third, purged_at: null })
    })
  })

  it('deleting the survivor deletes its held accounts too', async () => {
    const { me, other } = discordAndApple()
    cardFixture(me, other)
    const { ticket } = await appleTicket('mine')
    await merged(await merge('mine', ticket))
    const res = await post(
      '/api/account/delete',
      { confirm: 'delete' },
      { authorization: 'Bearer mine' }
    )
    expect(res.status).toBe(204)
    expect(count('SELECT count(*) AS n FROM users WHERE id IN (?, ?)', me, other)).toBe(0)
    expect(
      count('SELECT count(*) AS n FROM collection_entries WHERE user_id IN (?, ?)', me, other)
    ).toBe(0)
    expect(count('SELECT count(*) AS n FROM account_merges')).toBe(0)
  })
})
