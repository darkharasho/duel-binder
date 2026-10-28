import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { migrateServer } from '../../workers/portal/src/migrate'
import { encodeFingerprints } from '../../src/shared/scan/fingerprintFile'
import { HASH_WORDS } from '../../src/shared/scan/fingerprint'
import { memoryBucket, noPrintingArt, noPrices } from './helpers'

const BASE = 'https://portal.test'
const TOKEN = 'admin-secret'

describe('scan fingerprint file', () => {
  let deps: AppDeps
  let bucket: ReturnType<typeof memoryBucket>
  const body = encodeFingerprints([
    { imageId: 7, hash: new Uint32Array(HASH_WORDS).fill(0xdeadbeef) },
    { imageId: 3, hash: new Uint32Array(HASH_WORDS).fill(1) }
  ])

  beforeEach(() => {
    const db = new Database(':memory:')
    migrateServer(db)
    bucket = memoryBucket()
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: bucket,
      printingArt: noPrintingArt,
      prices: noPrices,
      env: {
        PUBLIC_URL: BASE,
        SITE_URL: 'https://site.test',
        DISCORD_CLIENT_ID: 'c',
        DISCORD_CLIENT_SECRET: 's',
        ADMIN_TOKEN: TOKEN,
        PRICE_WORKER_URL: 'https://prices.test'
      },
      now: () => new Date('2026-10-26T12:00:00.000Z'),
      fetch: (async () => new Response('?', { status: 404 })) as unknown as typeof fetch
    }
  })

  const put = (bytes: Uint8Array, token: string | null = TOKEN): Promise<Response> =>
    handle(
      new Request(`${BASE}/admin/scan/fingerprints`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: bytes as unknown as BodyInit
      }),
      deps
    )
  const putForced = (bytes: Uint8Array): Promise<Response> =>
    handle(
      new Request(`${BASE}/admin/scan/fingerprints?force=1`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${TOKEN}` },
        body: bytes as unknown as BodyInit
      }),
      deps
    )
  const rollback = (): Promise<Response> =>
    handle(
      new Request(`${BASE}/admin/scan/fingerprints/rollback`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}` }
      }),
      deps
    )
  /** A file of `n` records with ids 1..n. */
  const file = (n: number, fill = 5): Uint8Array =>
    encodeFingerprints(
      Array.from({ length: n }, (_, i) => ({
        imageId: i + 1,
        hash: new Uint32Array(HASH_WORDS).fill(fill)
      }))
    )
  const get = (headers: Record<string, string> = {}): Promise<Response> =>
    handle(new Request(`${BASE}/scan/fingerprints`, { headers }), deps)

  it('rejects a PUT without the admin token', async () => {
    expect((await put(body, null)).status).toBe(401)
    expect(bucket.store.size).toBe(0)
  })

  it('rejects a PUT that is not a fingerprint file', async () => {
    const res = await put(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
    expect(res.status).toBe(400)
    expect(bucket.store.size).toBe(0)
  })

  it('rejects a PUT over 8 MB before decoding it', async () => {
    const res = await put(new Uint8Array(8 * 1024 * 1024 + 1))
    expect(res.status).toBe(400)
    expect(bucket.store.size).toBe(0)
  })

  it('stores a valid file and serves the same bytes with an ETag', async () => {
    const res = await put(body)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, count: 2 })
    const got = await get()
    expect(got.status).toBe(200)
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(body)
    expect(got.headers.get('etag')).toBeTruthy()
    expect(got.headers.get('cache-control')).toBe('no-cache')
  })

  it('answers 304 when If-None-Match matches', async () => {
    await put(body)
    const etag = (await get()).headers.get('etag')!
    const res = await get({ 'if-none-match': etag })
    expect(res.status).toBe(304)
    expect(res.headers.get('etag')).toBe(etag)
  })

  it('serves the new bytes after a replacement', async () => {
    await put(body)
    const etag = (await get()).headers.get('etag')!
    expect((await put(file(2, 0xabc))).status).toBe(200)
    const res = await get({ 'if-none-match': etag })
    expect(res.status).toBe(200)
  })

  it('rejects an empty file', async () => {
    const res = await put(encodeFingerprints([]))
    expect(res.status).toBe(400)
    expect(bucket.store.size).toBe(0)
  })

  it('refuses a file that shrinks the index past 10% unless forced', async () => {
    await put(file(100))
    const smaller = file(80)
    const res = await put(smaller)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ had: 100, count: 80 })
    expect(new Uint8Array(await (await get()).arrayBuffer())).toEqual(file(100))

    expect((await put(file(95))).status).toBe(200)
    expect((await putForced(smaller)).status).toBe(200)
    expect(new Uint8Array(await (await get()).arrayBuffer())).toEqual(smaller)
  })

  it('keeps the replaced file and rolls back to it', async () => {
    expect((await rollback()).status).toBe(404)
    await put(file(10))
    await put(file(12))
    const res = await rollback()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, count: 10 })
    expect(new Uint8Array(await (await get()).arrayBuffer())).toEqual(file(10))
    // Rolling back again undoes the rollback.
    await rollback()
    expect(new Uint8Array(await (await get()).arrayBuffer())).toEqual(file(12))
  })

  it('rejects a rollback without the admin token', async () => {
    const res = await handle(
      new Request(`${BASE}/admin/scan/fingerprints/rollback`, { method: 'POST' }),
      deps
    )
    expect(res.status).toBe(401)
  })

  it('answers 404 before any upload', async () => {
    const res = await get()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No fingerprints yet' })
  })
})
