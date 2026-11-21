import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { addUser, memoryBucket, noPrintingArt, noPrices, seededServerDb } from './helpers'

const BASE = 'https://portal.test'
const OWNER = 'tok-owner'
const SAM = 'tok-sam'
const ADMIN = 'admin-secret'

describe('community search terms', () => {
  let db: Database.Database
  let deps: AppDeps

  beforeEach(async () => {
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
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        ADMIN_TOKEN: ADMIN,
        ADMIN_DISCORD_ID: '999',
        PRICE_WORKER_URL: 'https://prices.test'
      },
      email: { send: async () => {} },
      now: () => new Date('2026-11-21T12:00:00.000Z'),
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
    for (const [discord, name, token] of [
      ['999', 'owner', OWNER],
      ['111', 'sam', SAM]
    ]) {
      const id = addUser(db, discord, name)
      db.prepare(
        "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)"
      ).run(
        createHash('sha256').update(token).digest('hex'),
        id,
        '2026-11-01T00:00:00.000Z',
        '2027-11-01T00:00:00.000Z'
      )
    }
  })

  const call = (
    method: string,
    path: string,
    token: string | null,
    body?: unknown
  ): Promise<Response> =>
    handle(
      new Request(BASE + path, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      }),
      deps
    )

  const proposal = (
    phrase: string,
    extra: Record<string, unknown> = {}
  ): Record<string, unknown> => ({
    game: 'ygo',
    phrase,
    kind: 'nickname',
    targetKind: 'card',
    target: { cardIds: [1] },
    evidence: { titles: ['a'], count: 3, sellers: 2, reason: 'seen' },
    ...extra
  })
  const propose = (...phrases: string[]): Promise<Response> =>
    call('POST', '/admin/terms/propose', ADMIN, { proposals: phrases.map((p) => proposal(p)) })
  const feed = async (since: number, token = SAM): Promise<any> =>
    (await call('GET', `/api/sync/search-terms?game=ygo&since=${since}`, token)).json()
  const pending = async (): Promise<any[]> =>
    ((await (await call('GET', '/admin/terms?status=pending', OWNER)).json()) as any).terms

  it('proposes as pending, outside the feed', async () => {
    const res = await propose('blue eyes')
    expect(await res.json()).toEqual({ added: 1 })
    expect((await feed(0)).terms).toEqual([])
    const [t] = await pending()
    expect(t).toMatchObject({ phrase: 'blue eyes', status: 'pending', source: 'ebay-ai' })
    expect(t.evidence.count).toBe(3)
  })

  it('approve puts it in the feed with a new cursor; reject after approve deletes it', async () => {
    await propose('blue eyes')
    const [{ id }] = await pending()
    const ok = await call('POST', '/admin/terms/decide', OWNER, { id, status: 'approved' })
    expect(ok.status).toBe(200)
    const a = await feed(0)
    expect(a.terms.map((t: any) => t.id)).toEqual([id])
    expect(a.cursor).toBeGreaterThan(0)
    expect(a.more).toBe(false)
    await call('POST', '/admin/terms/decide', OWNER, { id, status: 'rejected' })
    const b = await feed(a.cursor)
    expect(b.terms).toEqual([])
    expect(b.deleted).toEqual([id])
    expect(b.cursor).toBeGreaterThan(a.cursor)
  })

  it('proposing a known phrase in any status adds nothing', async () => {
    await propose('blue eyes')
    const [{ id }] = await pending()
    await call('POST', '/admin/terms/decide', OWNER, { id, status: 'rejected' })
    expect(await (await propose('Blue-Eyes')).json()).toEqual({ added: 0 })
    const known = await call('GET', '/admin/terms/known?game=ygo', ADMIN)
    expect(await known.json()).toEqual({ keys: ['blue eyes'] })
  })

  it('the owner can add an approved term', async () => {
    const res = await call('POST', '/admin/terms/add', OWNER, {
      game: 'ygo',
      phrase: 'dark magician',
      kind: 'nickname',
      targetKind: 'card',
      target: { cardIds: [1] }
    })
    expect(res.status).toBe(200)
    expect((await feed(0)).terms[0]).toMatchObject({
      phrase: 'dark magician',
      phraseKey: 'dark magician'
    })
  })

  it('answers 404 to non-admins and 401 to a wrong token', async () => {
    for (const [m, p] of [
      ['GET', '/admin/terms'],
      ['POST', '/admin/terms/decide'],
      ['POST', '/admin/terms/add']
    ])
      expect((await call(m, p, SAM, m === 'POST' ? {} : undefined)).status).toBe(404)
    expect((await call('GET', '/admin/terms', null)).status).toBe(404)
    expect((await call('GET', '/admin/terms/known?game=ygo', SAM)).status).toBe(401)
    expect((await call('POST', '/admin/terms/propose', SAM, { proposals: [] })).status).toBe(401)
  })

  it("rejects an edit onto another row's phrase with 409", async () => {
    await propose('one', 'two')
    const rows = await pending()
    const two = rows.find((r) => r.phrase === 'two')
    const res = await call('POST', '/admin/terms/decide', OWNER, {
      id: two.id,
      status: 'approved',
      phrase: 'One'
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'duplicate-pending' })
  })

  it('a pending row never reaches the feed, not even as deleted', async () => {
    await propose('one', 'two')
    const rows = await pending()
    const one = rows.find((r) => r.phrase === 'one')
    await call('POST', '/admin/terms/decide', OWNER, { id: one.id, status: 'rejected' })
    const f = await feed(0)
    expect(f.terms).toEqual([])
    // "one" was decided, so it is listed; "two" is still pending and is not.
    expect(f.deleted).toEqual([one.id])
  })

  it("keeps only the target kind's list and refuses an empty one", async () => {
    const add = (phrase: string, targetKind: string, target: unknown): Promise<Response> =>
      call('POST', '/admin/terms/add', OWNER, {
        game: 'ygo',
        phrase,
        kind: 'nickname',
        targetKind,
        target
      })
    const stray = { cardIds: [1], pkeys: ['en|1|LOB-001|Ultra Rare'], rarities: ['Ultra Rare'] }
    expect((await add('bewd', 'card', stray)).status).toBe(200)
    expect((await feed(0)).terms[0].target).toEqual({ cardIds: [1] })
    expect((await add('lob', 'set', stray)).status).toBe(400)
    expect((await add('ur', 'rarity', { rarities: [] })).status).toBe(400)
    expect(
      (
        await call('POST', '/admin/terms/propose', ADMIN, {
          proposals: [proposal('x', { targetKind: 'printing', target: { cardIds: [1] } })]
        })
      ).status
    ).toBe(400)
    // An edit that moves the kind keeps only the new kind's list.
    await call('POST', '/admin/terms/propose', ADMIN, {
      proposals: [proposal('mixed', { target: stray })]
    })
    const [p] = await pending()
    expect(p.target).toEqual({ cardIds: [1] })
    expect(
      (
        await call('POST', '/admin/terms/decide', OWNER, {
          id: p.id,
          status: 'approved',
          targetKind: 'rarity',
          target: stray
        })
      ).status
    ).toBe(200)
    const approved = (await feed(0)).terms.find((t: any) => t.id === p.id)
    expect(approved).toMatchObject({ targetKind: 'rarity', target: { rarities: ['Ultra Rare'] } })
  })

  it("names the clashing term's status on 409, and a rejected term can be restored", async () => {
    await propose('blue eyes')
    const [{ id }] = await pending()
    const add = (): Promise<Response> =>
      call('POST', '/admin/terms/add', OWNER, {
        game: 'ygo',
        phrase: 'Blue Eyes',
        kind: 'nickname',
        targetKind: 'card',
        target: { cardIds: [1] }
      })
    let res = await add()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'duplicate-pending' })
    await call('POST', '/admin/terms/decide', OWNER, { id, status: 'rejected' })
    res = await add()
    expect(await res.json()).toEqual({ error: 'duplicate-rejected' })
    const listed = await (await call('GET', '/admin/terms?status=rejected&game=ygo', OWNER)).json()
    expect((listed as any).terms.map((t: any) => t.id)).toEqual([id])
    expect(
      (await call('POST', '/admin/terms/decide', OWNER, { id, status: 'approved' })).status
    ).toBe(200)
    expect((await feed(0)).terms.map((t: any) => t.id)).toEqual([id])
    expect(await (await add()).json()).toEqual({ error: 'duplicate-approved' })
  })

  it('edits recompute the key', async () => {
    await propose('one')
    const [{ id }] = await pending()
    await call('POST', '/admin/terms/decide', OWNER, { id, status: 'approved', phrase: 'Un Deux' })
    expect((await feed(0)).terms[0].phraseKey).toBe('un deux')
  })

  it('rejects bad proposals and more than 100', async () => {
    const send = (proposals: unknown[]): Promise<Response> =>
      call('POST', '/admin/terms/propose', ADMIN, { proposals })
    expect((await send(Array.from({ length: 101 }, (_, i) => proposal(`p${i}`)))).status).toBe(400)
    expect((await send([proposal('a b c d e')])).status).toBe(400)
    expect((await send([proposal('x', { game: 'nope' })])).status).toBe(400)
    expect((await send([proposal('x', { kind: 'weird' })])).status).toBe(400)
    expect((await send([proposal('x', { targetKind: 'weird' })])).status).toBe(400)
    expect((await send([proposal('  ')])).status).toBe(400)
  })

  it('pages the feed at 500 rows', async () => {
    for (let i = 0; i < 501; i++)
      db.prepare(
        `INSERT INTO search_terms (game, phrase, phrase_key, kind, target_kind, target, status, source, seq, created_at)
         VALUES ('ygo', ?, ?, 'nickname', 'card', '{}', 'approved', 'owner', ?, 'x')`
      ).run(`t${i}`, `t${i}`, i + 1)
    const a = await feed(0)
    expect(a.terms).toHaveLength(500)
    expect(a.more).toBe(true)
    expect(a.cursor).toBe(500)
    const b = await feed(a.cursor)
    expect(b.terms).toHaveLength(1)
    expect(b.more).toBe(false)
  })
})
