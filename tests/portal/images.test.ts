import type Database from 'better-sqlite3'
import { KONAMI_LOGO_PREFIX, PACK_ART_PREFIX, YUGIPEDIA_IMAGE_PREFIX } from '../../src/shared/imageSources'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handle, type AppDeps } from '../../workers/portal/src/app'
import { TCGPLAYER_IMAGE_PREFIX } from '../../src/main/tcgplayer/catalog'
import { createImageQuota } from '../../workers/portal/src/images'
import { addUser, memoryBucket, noPrices, seededServerDb } from './helpers'

const BASE = 'https://app.test'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const imageResponse = (): Response => new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } })

describe('image route', () => {
  let db: Database.Database
  let bucket: ReturnType<typeof memoryBucket>
  let upstream: ReturnType<typeof vi.fn>
  let deps: AppDeps
  let imageId: number
  let printingUrl: string | null
  const printingArt = { url: vi.fn(async () => printingUrl) }

  beforeEach(async () => {
    db = await seededServerDb()
    printingUrl = null
    printingArt.url.mockClear()
    bucket = memoryBucket()
    upstream = vi.fn(async () => imageResponse())
    imageId = (db.prepare('SELECT image_id FROM card_images LIMIT 1').get() as { image_id: number }).image_id
    const uid = addUser(db, '1', 'alice')
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('tok')))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
      hash,
      uid,
      '2026-10-25T11:00:00.000Z',
      '2026-10-25T23:00:00.000Z'
    )
    cookie = 'session=tok'
    deps = {
      db,
      assets: { fetch: async () => new Response('nope', { status: 404 }) },
      images: bucket,
      printingArt,
      prices: noPrices,
      env: { PUBLIC_URL: BASE, SITE_URL: 'https://site.test', DISCORD_CLIENT_ID: 'c', DISCORD_CLIENT_SECRET: 's', ADMIN_TOKEN: 'a', PRICE_WORKER_URL: 'https://prices.test' },
      now: () => new Date('2026-10-25T12:00:00.000Z'),
      fetch: upstream as unknown as typeof fetch
    }
  })
  afterEach(() => db.close())

  let cookie = ''
  const get = (path: string, method = 'GET') =>
    handle(new Request(`${BASE}/img/${path}`, { method, headers: { cookie } }), deps)
  const getAnon = (path: string) => handle(new Request(`${BASE}/img/${path}`), deps)

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

  it('signed-out R2 miss answers 404 without any upstream call', async () => {
    printingUrl = `${YUGIPEDIA_IMAGE_PREFIX}x.jpg`
    for (const path of [`small/${imageId}`, 'printing/1']) {
      const res = await getAnon(path)
      expect(res.status).toBe(404)
      expect(await res.text()).toBe('Not found')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    }
    expect(upstream).not.toHaveBeenCalled()
    expect(printingArt.url).not.toHaveBeenCalled()
  })

  it('signed-out R2 hit is still served', async () => {
    await get(`small/${imageId}`)
    upstream.mockClear()
    const res = await getAnon(`small/${imageId}`)
    expect(res.status).toBe(200)
    expect(upstream).not.toHaveBeenCalled()
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

  it('yc- key resolves through pack_art and fetches the official URL', async () => {
    const url = `${PACK_ART_PREFIX}2024/01/pack.jpg`
    db.prepare("INSERT INTO pack_art (set_name, image_url, image_key) VALUES ('Pack', ?, 'yc-abc')").run(url)
    const res = await get('set/yc-abc')
    expect(res.status).toBe(200)
    expect(upstream.mock.calls[0][0]).toBe(url)
  })

  it('serves only jpeg, png, webp and gif, ignoring parameters', async () => {
    for (const type of ['image/svg+xml', 'image/x-icon', 'text/html']) {
      upstream.mockResolvedValueOnce(new Response('<svg/>', { headers: { 'content-type': type } }))
      expect((await get(`small/${imageId}`)).status).toBe(404)
    }
    expect(bucket.store.size).toBe(0)
    upstream.mockResolvedValueOnce(new Response(JPEG, { headers: { 'content-type': 'Image/PNG; charset=binary' } }))
    const ok = await get(`small/${imageId}`)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('image/png')
  })

  it('locks down every response', async () => {
    for (const res of [await get(`small/${imageId}`), await get('small/0'), await get(`small/${imageId}`, 'POST')]) {
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('content-security-policy')).toBe('sandbox')
    }
  })

  it('does not follow redirects and treats them as a miss', async () => {
    upstream.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://evil.test/x.png' } }))
    expect((await get(`small/${imageId}`)).status).toBe(404)
    expect((upstream.mock.calls[0][1] as RequestInit).redirect).toBe('manual')
    expect(bucket.store.size).toBe(0)
  })

  it('serves fetched bytes when R2 put fails, and treats a failing get as a miss', async () => {
    bucket.put = async () => {
      throw new Error('r2 down')
    }
    const res = await get(`small/${imageId}`)
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG)
    bucket.get = async () => {
      throw new Error('r2 down')
    }
    expect((await get(`small/${imageId}`)).status).toBe(200)
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it('rejects oversized set keys and oversized upstream bodies', async () => {
    expect((await get(`set/${'a'.repeat(201)}`)).status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
    expect((await get(`set/${'a'.repeat(200)}`)).status).toBe(200)
    upstream.mockResolvedValueOnce(
      new Response(JPEG, { headers: { 'content-type': 'image/jpeg', 'content-length': String(11 * 1024 * 1024) } })
    )
    expect((await get(`small/${imageId}`)).status).toBe(404)
    upstream.mockResolvedValueOnce(new Response(new Uint8Array(10 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/jpeg' } }))
    expect((await get(`full/${imageId}`)).status).toBe(404)
    expect([...bucket.store.keys()]).toEqual([`set/${'a'.repeat(200)}`])
  })

  describe('printing photos', () => {
    it('printing photo comes from the resolver URL and is stored', async () => {
      printingUrl = `${TCGPLAYER_IMAGE_PREFIX}1_in_1000x1000.jpg`
      const res = await get('printing/7')
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('public, max-age=86400')
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG)
      expect(printingArt.url).toHaveBeenCalledWith(7)
      expect(upstream.mock.calls[0][0]).toBe(printingUrl)
      expect(bucket.store.has('printing/7')).toBe(true)
      expect((await get('printing/7')).status).toBe(200)
      expect(upstream).toHaveBeenCalledTimes(1)
    })

    it('a Yugipedia photo is fetched with a User-Agent', async () => {
      printingUrl = `${YUGIPEDIA_IMAGE_PREFIX}a/ab/Card.png`
      expect((await get('printing/7')).status).toBe(200)
      expect(upstream.mock.calls[0][1].headers['User-Agent']).toMatch(/^DuelBinder\//)
    })

    it('printing with no photo answers 404', async () => {
      expect((await get('printing/7')).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
      expect(bucket.store.size).toBe(0)
    })

    it('resolver URL on another host answers 404 without fetching', async () => {
      printingUrl = 'https://evil.test/product/1.jpg'
      expect((await get('printing/7')).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
      expect(bucket.store.size).toBe(0)
    })

    it('malformed ids answer 404 without asking the resolver', async () => {
      for (const id of ['0', '-1', 'x', '1.5', '99999999999999999999']) {
        expect((await get(`printing/${id}`)).status).toBe(404)
      }
      expect(printingArt.url).not.toHaveBeenCalled()
    })

    it('a resolver that rejects answers 404 and stores nothing', async () => {
      printingArt.url.mockRejectedValueOnce(new Error('boom'))
      expect((await get('printing/7')).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
      expect(bucket.store.size).toBe(0)
    })

    it('a resolver that never answers gives 404 once the timeout passes', async () => {
      vi.useFakeTimers()
      try {
        printingArt.url.mockImplementationOnce(() => new Promise<string | null>(() => {}))
        const pending = get('printing/7')
        await vi.waitFor(() => expect(printingArt.url).toHaveBeenCalled()) // session lookup uses real async crypto
        await vi.advanceTimersByTimeAsync(30_000)
        expect((await pending).status).toBe(404)
        expect(upstream).not.toHaveBeenCalled()
        expect(bucket.store.size).toBe(0)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it('counts printing art lookups against the quota before asking the resolver', async () => {
      deps.imageQuota = createImageQuota(() => 1_000_000, { limit: 2, windowMs: 3_600_000 })
      await bucket.put('printing/9', JPEG.buffer as ArrayBuffer, { httpMetadata: { contentType: 'image/jpeg' } })
      expect((await get('printing/1')).status).toBe(404) // resolves to nothing, still spends a unit
      expect((await get('printing/2')).status).toBe(404)
      printingArt.url.mockClear()
      const limited = await get('printing/3')
      expect(limited.status).toBe(429)
      expect(limited.headers.get('retry-after')).not.toBeNull()
      expect(printingArt.url).not.toHaveBeenCalled()
      expect((await get('printing/9')).status).toBe(200) // stored: free
      expect(upstream).not.toHaveBeenCalled()
    })

    it('a stored photo is served without asking the resolver', async () => {
      await bucket.put('printing/7', JPEG.buffer as ArrayBuffer, { httpMetadata: { contentType: 'image/jpeg' } })
      expect((await get('printing/7')).status).toBe(200)
      expect(printingArt.url).not.toHaveBeenCalled()
    })
  })

  describe('Konami logos and the upstream quota', () => {
    const addLogo = (key: string, url = `${KONAMI_LOGO_PREFIX}logos/a.png`): void => {
      db.prepare("INSERT INTO konami_logos (set_name, image_url, image_key) VALUES (?, ?, ?)").run(`Set ${key}`, url, key)
    }

    it('mirrors a Konami logo under konami/<key>', async () => {
      addLogo('km-abc')
      const res = await get('konami/km-abc')
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toBe('public, max-age=86400')
      expect(upstream.mock.calls[0][0]).toBe(`${KONAMI_LOGO_PREFIX}logos/a.png`)
      expect(bucket.store.has('konami/km-abc')).toBe(true)
      expect((await get('konami/km-abc')).status).toBe(200)
      expect(upstream).toHaveBeenCalledTimes(1)
    })

    it('refuses unknown, off-prefix and non-km keys under konami', async () => {
      addLogo('km-evil', 'https://evil.test/x.png')
      addLogo('yp-nope')
      for (const key of ['km-missing', 'km-evil', 'yp-nope', 'LOB', 'km-a/b']) {
        expect((await get(`konami/${key}`)).status).toBe(404)
      }
      expect(upstream).not.toHaveBeenCalled()
    })

    it('a signed-out miss on a Konami logo is a 404 without fetching', async () => {
      addLogo('km-abc')
      expect((await getAnon('konami/km-abc')).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
    })

    it('still refuses km- keys under /img/set', async () => {
      addLogo('km-abc')
      expect((await get('set/km-abc')).status).toBe(404)
      expect(upstream).not.toHaveBeenCalled()
    })

    it('limits upstream fetches per user but never R2 hits', async () => {
      let t = 1_000_000
      deps.imageQuota = createImageQuota(() => t, { limit: 2, windowMs: 3_600_000 })
      await bucket.put('card/small/1', JPEG.buffer as ArrayBuffer, { httpMetadata: { contentType: 'image/jpeg' } })
      expect((await get('set/AAA')).status).toBe(200)
      expect((await get('set/BBB')).status).toBe(200)
      const limited = await get('set/CCC')
      expect(limited.status).toBe(429)
      expect(limited.headers.get('retry-after')).toBe(String(Math.ceil((3_600_000 - 0) / 1000)))
      expect(upstream).toHaveBeenCalledTimes(2)
      // Stored images and keys that would 404 anyway cost nothing.
      expect((await get('set/AAA')).status).toBe(200)
      expect((await getAnon('set/BBB')).status).toBe(200)
      expect((await get('small/999999999')).status).toBe(404)
      expect((await get('set/km-abc')).status).toBe(404)
      expect(upstream).toHaveBeenCalledTimes(2)
      // The window rolls over.
      t += 3_600_000
      expect((await get('set/CCC')).status).toBe(200)
    })

    it('rounds retry-after up to whole seconds, minimum 1', async () => {
      let t = 0
      const quota = createImageQuota(() => t, { limit: 1, windowMs: 10_000 })
      deps.imageQuota = quota
      expect((await get('set/AAA')).status).toBe(200)
      t = 8_500
      const early = await get('set/BBB')
      expect(early.status).toBe(429)
      expect(early.headers.get('retry-after')).toBe('2') // 1.5 s left
      t = 9_999
      expect((await get('set/BBB')).headers.get('retry-after')).toBe('1') // 1 ms left
      expect(quota.take(2)).toBe(true) // another user has their own budget
    })
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
