import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { thumbsRoute, type ThumbBucket } from '../../workers/portal/src/thumbs'
import { labelParams, type TrainingLabel } from '../../src/shared/training'
import { addUser, memoryBucket, noPrices, noPrintingArt, seededServerDb } from './helpers'
import { seedOnePiece } from '../fixtures/onePiece'
import { seedPokemon } from '../fixtures/pokemon'

const BASE = 'https://portal.test'
const NOW = new Date('2026-11-04T12:00:00.000Z')
const HOUR = 60 * 60 * 1000
const CID = '11111111-1111-4111-8111-111111111111'
const CID2 = '22222222-2222-4222-8222-222222222222'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const CAP = 8 * 1024 * 1024
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

describe('/api/training', () => {
  let db: Database.Database
  let bucket: ReturnType<typeof memoryBucket>
  let puts: string[]
  let deps: AppDeps
  let owner: number
  let tess: number
  let tom: number
  let nora: number
  let op: { cardIds: number[]; printingIds: number[] }
  let pkm: { cardIds: number[]; printingIds: number[] }
  let ygo: { id: number; card_id: number }

  beforeEach(async () => {
    db = await seededServerDb()
    op = seedOnePiece(db)
    pkm = seedPokemon(db)
    ygo = db
      .prepare("SELECT id, card_id FROM card_printings WHERE game = 'ygo' ORDER BY id LIMIT 1")
      .get() as { id: number; card_id: number }
    bucket = memoryBucket()
    puts = []
    const put = bucket.put.bind(bucket)
    bucket.put = async (key, value, opts) => {
      puts.push(key)
      return put(key, value, opts)
    }
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: bucket,
      training: bucket,
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
      now: () => NOW,
      fetch: (() => {
        throw new Error('no network')
      }) as unknown as typeof fetch
    }
    owner = addUser(db, '999', 'owner')
    tess = addUser(db, '1', 'tess')
    tom = addUser(db, '2', 'tom')
    nora = addUser(db, '3', 'nora')
    for (const [id, name] of [
      [owner, 'owner'],
      [tess, 'tess'],
      [tom, 'tom'],
      [nora, 'nora']
    ] as const)
      db.prepare(
        "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'desktop', ?, ?)"
      ).run(sha(name), id, NOW.toISOString(), '2099-01-01T00:00:00.000Z')
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at) VALUES (?, ?, 'web', ?, ?)"
    ).run(sha('tess-web'), tess, NOW.toISOString(), '2099-01-01T00:00:00.000Z')
    // The seeded 'dubgrumble' pending row stays pending; tess and tom are on the list.
    for (const id of [tess, tom])
      db.prepare("INSERT INTO game_testers (game, user_id) VALUES ('op', ?)").run(id)
  })

  const label = (over: Partial<Record<string, string>> = {}): URLSearchParams => {
    const l: TrainingLabel = {
      game: 'op',
      cardId: op.cardIds[0],
      printingId: op.printingIds[0],
      holder: 'sleeve',
      device: 'iPhone16,1',
      appVersion: '0.54.0',
      takenAt: '2026-11-04T11:59:00.000Z'
    }
    const q = labelParams(l)
    for (const [k, v] of Object.entries(over)) if (v !== undefined) q.set(k, v)
    return q
  }
  const auth = (who: string): Record<string, string> => ({ authorization: `Bearer ${who}` })
  const upload = (
    who: string | Record<string, string>,
    cid = CID,
    q: URLSearchParams = label(),
    body: BodyInit | null = JPEG,
    headers: Record<string, string> = {}
  ): Promise<Response> =>
    handle(
      new Request(`${BASE}/api/training/photos/${cid}?${q}`, {
        method: 'POST',
        headers: {
          ...(typeof who === 'string' ? auth(who) : who),
          'content-type': 'image/jpeg',
          ...headers
        },
        body,
        // @ts-expect-error Node's fetch needs duplex for a stream body.
        duplex: 'half'
      }),
      deps
    )
  const del = (who: string | Record<string, string>, cid = CID): Promise<Response> =>
    handle(
      new Request(`${BASE}/api/training/photos/${cid}`, {
        method: 'DELETE',
        headers: typeof who === 'string' ? auth(who) : who
      }),
      deps
    )
  const get = (path: string, who?: string): Promise<Response> =>
    handle(new Request(BASE + path, { headers: who ? auth(who) : {} }), deps)
  const rows = (): Record<string, unknown>[] =>
    db.prepare('SELECT * FROM training_photos ORDER BY id').all() as Record<string, unknown>[]
  const key = (uid: number, cid = CID): string => `training/op/${uid}/${cid}.jpg`

  it('tester uploads a photo', async () => {
    const res = await upload('tess')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ total: 1, today: 1, dailyCap: 500 })
    const stored = bucket.store.get(key(tess))
    expect(stored?.contentType).toBe('image/jpeg')
    expect(new Uint8Array(stored!.bytes)).toEqual(JPEG)
    expect(rows()).toEqual([
      expect.objectContaining({
        user_id: tess,
        client_id: CID,
        game: 'op',
        card_id: op.cardIds[0],
        printing_id: op.printingIds[0],
        holder: 'sleeve',
        device: 'iPhone16,1',
        app_version: '0.54.0',
        taken_at: '2026-11-04T11:59:00.000Z',
        created_at: NOW.toISOString(),
        bytes: JPEG.byteLength,
        r2_key: key(tess)
      })
    ])
  })

  it('owner counts as a tester', async () => {
    const res = await upload('owner')
    expect(res.status).toBe(200)
    expect(bucket.store.has(key(owner))).toBe(true)
  })

  it('non-tester gets 404', async () => {
    const res = await upload('nora')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not-found' })
    expect(bucket.store.size).toBe(0)
    expect(rows()).toEqual([])
  })

  it('signed out is 401, a web session from another origin is 403', async () => {
    expect((await upload({})).status).toBe(401)
    const cross = await upload({ cookie: 'session=tess-web', origin: 'https://evil.test' })
    expect(cross.status).toBe(403)
    expect(await cross.json()).toEqual({ error: 'bad-origin' })
    const same = await upload({ cookie: 'session=tess-web', origin: BASE })
    expect(same.status).toBe(200)
  })

  it('ygo and pkm are refused', async () => {
    const res = await upload(
      'tess',
      CID,
      label({ game: 'pkm', card: String(pkm.cardIds[0]), printing: String(pkm.printingIds[0]) })
    )
    expect(res.status).toBe(404)
    const ygoRes = await upload(
      'owner',
      CID,
      label({ game: 'ygo', card: String(ygo.card_id), printing: String(ygo.id) })
    )
    expect(ygoRes.status).toBe(404)
    expect(bucket.store.size).toBe(0)
  })

  it('a bad client id is 400', async () => {
    const res = await upload('tess', 'not-a-uuid')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad-id' })
  })

  it('printing of another game is rejected', async () => {
    const res = await upload('tess', CID, label({ printing: String(ygo.id) }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad-printing' })
    // Another card's printing, and a missing one.
    const other = await upload(
      'tess',
      CID,
      label({ card: String(ygo.card_id), printing: String(op.printingIds[0]) })
    )
    expect(other.status).toBe(400)
    const missing = await upload('tess', CID, label({ printing: '999999999' }))
    expect(await missing.json()).toEqual({ error: 'bad-printing' })
    expect(bucket.store.size).toBe(0)
  })

  it('same client id twice stores one photo', async () => {
    const a = await upload('tess')
    const b = await upload('tess')
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(await b.json()).toEqual({ total: 1, today: 1, dailyCap: 500 })
    expect(rows()).toHaveLength(1)
    expect(puts).toEqual([key(tess)])
  })

  it('too big is 413 before the body', async () => {
    let pulled = false
    const lazy = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          pulled = true
          c.enqueue(JPEG)
          c.close()
        }
      },
      { highWaterMark: 0 }
    )
    const res = await upload('tess', CID, label(), lazy, { 'content-length': String(CAP + 1) })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'too-big' })
    expect(pulled).toBe(false)
    expect(puts).toEqual([])

    const big = new Uint8Array(CAP + 1)
    big.set(JPEG)
    let sent = false
    const chunked = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent) return c.close()
        sent = true
        c.enqueue(big)
      }
    })
    const res2 = await upload('tess', CID, label(), chunked)
    expect(res2.status).toBe(413)
    expect(await res2.json()).toEqual({ error: 'too-big' })
    expect(puts).toEqual([])
    expect(rows()).toEqual([])
  })

  it('not a jpeg is 415', async () => {
    const png = await upload('tess', CID, label(), new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    expect(png.status).toBe(415)
    const typed = await upload('tess', CID, label(), JPEG, { 'content-type': 'image/png' })
    expect(typed.status).toBe(415)
    expect(puts).toEqual([])
  })

  it('501st photo in 24 h is 429', async () => {
    const at = new Date(NOW.getTime() - HOUR).toISOString()
    const ins = db.prepare(
      `INSERT INTO training_photos (user_id, client_id, game, card_id, printing_id, holder, device,
         app_version, taken_at, created_at, bytes, r2_key)
       VALUES (?, ?, 'op', ?, ?, 'bare', 'd', '0.54.0', ?, ?, 3, ?)`
    )
    db.transaction(() => {
      for (let i = 0; i < 500; i++)
        ins.run(
          tess,
          `c${i}`,
          op.cardIds[0],
          op.printingIds[0],
          at,
          at,
          `training/op/${tess}/c${i}.jpg`
        )
    })()
    const res = await upload('tess')
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'daily-cap' })
    expect(bucket.store.size).toBe(0)

    const old = new Date(NOW.getTime() - 25 * HOUR).toISOString()
    db.prepare('UPDATE training_photos SET created_at = ?').run(old)
    const ok = await upload('tess')
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ total: 501, today: 1, dailyCap: 500 })
  })

  it('bad label is 400', async () => {
    const res = await upload('tess', CID, label({ holder: 'binder' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad-label' })
    const hidden = await upload('nora', CID, label({ holder: 'binder' }))
    expect(hidden.status).toBe(404)
    expect(await hidden.json()).toEqual({ error: 'not-found' })
  })

  it('delete removes the row and the object', async () => {
    await upload('tess')
    await upload('tom')
    const res = await del('tess')
    expect(res.status).toBe(204)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(rows().map((r) => r.user_id)).toEqual([tom])
    expect(bucket.store.has(key(tess))).toBe(false)
    expect((await del('tess')).status).toBe(204)
    // Tom's photo of the same client id is his own.
    expect(bucket.store.has(key(tom))).toBe(true)

    await upload('tess')
    expect((await del('tom')).status).toBe(204)
    expect(bucket.store.has(key(tess))).toBe(true)
    expect(rows().filter((r) => r.user_id === tess)).toHaveLength(1)

    const hidden = await del('nora')
    expect(hidden.status).toBe(404)
    expect(await hidden.json()).toEqual({ error: 'not-found' })
    const cross = await del({ cookie: 'session=tess-web', origin: 'https://evil.test' })
    expect(cross.status).toBe(403)
    expect(await cross.json()).toEqual({ error: 'bad-origin' })
    expect(bucket.store.has(key(tess))).toBe(true)
    expect((await del({})).status).toBe(401)
  })

  it('summary', async () => {
    await upload('tess')
    await upload('tess', CID2)
    const res = await get('/api/training/summary?game=op', 'tess')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ total: 2, today: 2, dailyCap: 500 })
    const hidden = await get('/api/training/summary?game=op', 'nora')
    expect(hidden.status).toBe(404)
    expect(await hidden.json()).toEqual({ error: 'not-found' })
    expect((await get('/api/training/summary?game=pkm', 'tess')).status).toBe(404)
    expect((await get('/api/training/summary?game=op')).status).toBe(401)
  })

  it('account deletion removes its training photos', async () => {
    await upload('tess')
    await upload('tom')
    const res = await handle(
      new Request(`${BASE}/api/account/delete`, {
        method: 'POST',
        headers: { ...auth('tess'), 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'delete' })
      }),
      deps
    )
    expect(res.status).toBe(204)
    expect(bucket.store.has(key(tess))).toBe(false)
    expect(bucket.store.has(key(tom))).toBe(true)
    expect(rows().map((r) => r.user_id)).toEqual([tom])
  })

  it('training keys are never served', async () => {
    const got: string[] = []
    const read = bucket.get.bind(bucket)
    expect((await upload('tess')).status).toBe(200)
    bucket.get = async (k) => {
      got.push(k)
      return read(k)
    }
    const empty = async (res: Response): Promise<void> => {
      expect(res.status).not.toBe(200)
      const bytes = new Uint8Array(await res.arrayBuffer())
      expect(bytes[0] === 0xff && bytes[1] === 0xd8).toBe(false)
    }
    for (const path of [
      `/img/training/op/${tess}/${CID}.jpg`,
      '/img/full/training',
      '/img/printing/training',
      `/api/training/photos/${CID}`
    ]) {
      await empty(await get(path, 'tess'))
      await empty(await get(path, 'owner'))
    }
    const thumbs = await thumbsRoute(
      new Request(`${BASE}/api/admin/thumbs/photo?key=${encodeURIComponent(key(tess))}`, {
        headers: auth('admin')
      }),
      bucket as unknown as ThumbBucket,
      'admin'
    )
    await empty(thumbs!)
    expect(got.filter((k) => k.startsWith('training/'))).toEqual([])
  })
})
