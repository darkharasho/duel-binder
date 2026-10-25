import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { memoryBucket, seededServerDb } from './helpers'

const BASE = 'https://app.test'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const imageResponse = (): Response => new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } })

describe('image route', () => {
  let db: Database.Database
  let bucket: ReturnType<typeof memoryBucket>
  let upstream: ReturnType<typeof vi.fn>
  let deps: AppDeps
  let imageId: number

  beforeEach(async () => {
    db = await seededServerDb()
    bucket = memoryBucket()
    upstream = vi.fn(async () => imageResponse())
    imageId = (db.prepare('SELECT image_id FROM card_images LIMIT 1').get() as { image_id: number }).image_id
    deps = {
      db,
      images: bucket,
      env: { PUBLIC_URL: BASE, SITE_URL: 'https://site.test', DISCORD_CLIENT_ID: 'c', DISCORD_CLIENT_SECRET: 's', ADMIN_TOKEN: 'a' },
      now: () => new Date('2026-10-25T12:00:00.000Z'),
      fetch: upstream as unknown as typeof fetch
    }
  })
  afterEach(() => db.close())

  const get = (path: string, method = 'GET') => handle(new Request(`${BASE}/img/${path}`, { method }), deps)

  it('serves a card image from upstream once, then from R2', async () => {
    const first = await get(`small/${imageId}`)
    expect(first.status).toBe(200)
    expect(first.headers.get('content-type')).toBe('image/jpeg')
    expect(first.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(JPEG)
    expect(upstream).toHaveBeenCalledTimes(1)
    expect(upstream.mock.calls[0][0]).toBe(`https://images.ygoprodeck.com/images/cards_small/${imageId}.jpg`)
    expect(bucket.store.has(`card/small/${imageId}`)).toBe(true)

    const second = await get(`small/${imageId}`)
    expect(second.status).toBe(200)
    expect(second.headers.get('content-type')).toBe('image/jpeg')
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it('uses the full and cropped folders', async () => {
    await get(`full/${imageId}`)
    await get(`cropped/${imageId}`)
    expect(upstream.mock.calls.map((c) => c[0])).toEqual([
      `https://images.ygoprodeck.com/images/cards/${imageId}.jpg`,
      `https://images.ygoprodeck.com/images/cards_cropped/${imageId}.jpg`
    ])
  })

  it('unknown image id answers 404 without fetching', async () => {
    expect((await get('small/999999999')).status).toBe(404)
    expect((await get('small/abc')).status).toBe(404)
    expect((await get('small/0')).status).toBe(404)
    expect((await get('huge/1')).status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('upstream 404 or non-image answers 404 and stores nothing', async () => {
    upstream.mockResolvedValueOnce(new Response('nope', { status: 404, headers: { 'content-type': 'image/jpeg' } }))
    expect((await get(`small/${imageId}`)).status).toBe(404)
    upstream.mockResolvedValueOnce(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    expect((await get(`small/${imageId}`)).status).toBe(404)
    upstream.mockRejectedValueOnce(new Error('network'))
    expect((await get(`small/${imageId}`)).status).toBe(404)
    expect(bucket.store.size).toBe(0)
  })

  describe('set image keys', () => {
    it('plain key maps to the YGOPRODeck sets URL', async () => {
      const res = await get('set/LOB')
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('public, max-age=86400')
      expect(upstream.mock.calls[0][0]).toBe('https://images.ygoprodeck.com/images/sets/LOB.jpg')
      expect(bucket.store.has('set/LOB')).toBe(true)
    })

    it('yp- key resolves through the sets table and sends a User-Agent', async () => {
      const url = 'https://ms.yugipedia.com/a/ab/Cover.png'
      db.prepare("INSERT INTO sets (language, set_name, set_code, image_url, image_key) VALUES ('en', 'Cover Set', 'CVR', ?, 'yp-abc123')").run(url)
      const res = await get('set/yp-abc123')
      expect(res.status).toBe(200)
      expect(upstream.mock.calls[0][0]).toBe(url)
      expect((upstream.mock.calls[0][1] as RequestInit).headers).toEqual({
        'User-Agent': 'DuelBinder/portal (https://github.com/darkharasho/duel-binder)'
      })
    })

    it('yp- key whose stored URL is off-prefix, or unknown, answers 404', async () => {
      db.prepare("INSERT INTO sets (language, set_name, set_code, image_url, image_key) VALUES ('en', 'Evil Set', 'EVL', 'https://evil.test/x.png', 'yp-evil')").run()
      expect((await get('set/yp-evil')).status).toBe(404)
      expect((await get('set/yp-missing')).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
    })

    it('km- and malformed keys answer 404', async () => {
      expect((await get('set/km-anything')).status).toBe(404)
      expect((await get('set/..%2Fx')).status).toBe(404)
      expect((await get('set/../x')).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
    })
  })

  it('printing images answer 404 for now', async () => {
    expect((await get('printing/1')).status).toBe(404)
  })

  it('HEAD answers with no body', async () => {
    const res = await get(`small/${imageId}`, 'HEAD')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(await res.text()).toBe('')
  })

  it('POST answers 405', async () => {
    expect((await get(`small/${imageId}`, 'POST')).status).toBe(405)
  })
})
