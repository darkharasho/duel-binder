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
    await put(encodeFingerprints([]))
    const res = await get({ 'if-none-match': etag })
    expect(res.status).toBe(200)
  })

  it('answers 404 before any upload', async () => {
    const res = await get()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'No fingerprints yet' })
  })
})
