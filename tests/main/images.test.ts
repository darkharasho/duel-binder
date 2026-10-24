import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLimiter } from '../../src/main/images/limiter'
import { createImageCache, imageUrl, parseImageUrl, parseSetImageUrl, setImageKey, setImageUrl, yugipediaImageKey } from '../../src/main/images/cache'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ygo-img-'))
})
afterEach(async () => {
  vi.useRealTimers()
  await fs.rm(dir, { recursive: true, force: true })
})

const okResponse = (body = 'jpegdata', type = 'image/jpeg') =>
  new Response(body, { status: 200, headers: { 'content-type': type } })

const noLimit = createLimiter({ concurrency: 4, minIntervalMs: 0 })

describe('image cache', () => {
  it('fetches with a timeout signal', async () => {
    const fetchFn = vi.fn(async (..._args: unknown[]) => okResponse())
    const cache = createImageCache({ dir, fetchFn: fetchFn as unknown as typeof fetch, limit: noLimit })
    await cache.get('small', 7)
    expect((fetchFn.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
  })

  it('downloads once then serves from disk', async () => {
    const fetchFn = vi.fn(async () => okResponse())
    const cache = createImageCache({ dir, fetchFn: fetchFn as unknown as typeof fetch, limit: noLimit })
    const [a, b] = await Promise.all([cache.get('small', 1), cache.get('small', 1)])
    const c = await cache.get('small', 1)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(a).toBe(path.join(dir, 'small', '1.jpg'))
    expect(b).toBe(a)
    expect(c).toBe(a)
    expect(await fs.readFile(a!, 'utf8')).toBe('jpegdata')
  })

  it('failed download returns null and caches nothing', async () => {
    const bad = vi.fn(async () => new Response('err', { status: 500 }))
    const cache = createImageCache({ dir, fetchFn: bad as unknown as typeof fetch, limit: noLimit })
    expect(await cache.get('full', 2)).toBeNull()
    expect(await fs.readdir(path.join(dir, 'full'))).toEqual([])
    const good = vi.fn(async () => okResponse())
    const cache2 = createImageCache({ dir, fetchFn: good as unknown as typeof fetch, limit: noLimit })
    expect(await cache2.get('full', 2)).toBe(path.join(dir, 'full', '2.jpg'))
  })

  it('rejects non-image and empty bodies', async () => {
    const html = createImageCache({ dir, fetchFn: (async () => okResponse('<html>', 'text/html')) as unknown as typeof fetch, limit: noLimit })
    expect(await html.get('small', 3)).toBeNull()
    const empty = createImageCache({ dir, fetchFn: (async () => okResponse('')) as unknown as typeof fetch, limit: noLimit })
    expect(await empty.get('small', 3)).toBeNull()
    expect(await fs.readdir(path.join(dir, 'small'))).toEqual([])
  })

  it('interrupted body leaves no file', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('partial'))
      },
      pull() {
        throw new Error('connection reset')
      },
    })
    const fetchFn = async () => new Response(stream, { status: 200, headers: { 'content-type': 'image/jpeg' } })
    const cache = createImageCache({ dir, fetchFn: fetchFn as unknown as typeof fetch, limit: noLimit })
    expect(await cache.get('small', 4)).toBeNull()
    expect(await fs.readdir(path.join(dir, 'small'))).toEqual([])
  })

  it('sizeBytes and clear', async () => {
    const cache = createImageCache({ dir: path.join(dir, 'missing'), fetchFn: (async () => okResponse('12345')) as unknown as typeof fetch, limit: noLimit })
    expect(await cache.sizeBytes()).toBe(0)
    await cache.clear()
    await cache.get('small', 1)
    await cache.get('full', 2)
    expect(await cache.sizeBytes()).toBe(10)
    await cache.clear()
    expect(await cache.sizeBytes()).toBe(0)
  })
})

describe('imageUrl', () => {
  it('returns the YGOPRODeck URLs', () => {
    expect(imageUrl('full', 46986414)).toBe('https://images.ygoprodeck.com/images/cards/46986414.jpg')
    expect(imageUrl('small', 46986414)).toBe('https://images.ygoprodeck.com/images/cards_small/46986414.jpg')
  })
})

describe('parseImageUrl', () => {
  it('parses valid urls', () => {
    expect(parseImageUrl('ygo-img://small/46986414')).toEqual({ size: 'small', id: 46986414 })
    expect(parseImageUrl('ygo-img://full/1')).toEqual({ size: 'full', id: 1 })
  })
  it('rejects malformed urls', () => {
    for (const u of ['ygo-img://huge/1', 'ygo-img://small/abc', 'ygo-img://small/0', 'ygo-img://small/-5', 'ygo-img://small/1.5', 'ygo-img://small/', 'ygo-img://small/1/2', 'ygo-img://small/1e3', 'nonsense'])
      expect(parseImageUrl(u), u).toBeNull()
  })
})

describe('limiter', () => {
  it('caps concurrency', async () => {
    const limit = createLimiter({ concurrency: 4, minIntervalMs: 0 })
    let inFlight = 0
    let max = 0
    await Promise.all(
      Array.from({ length: 10 }, () =>
        limit(async () => {
          inFlight++
          max = Math.max(max, inFlight)
          await new Promise((r) => setTimeout(r, 5))
          inFlight--
        }),
      ),
    )
    expect(max).toBe(4)
  })

  it('spaces starts', async () => {
    vi.useFakeTimers()
    const limit = createLimiter({ concurrency: 4, minIntervalMs: 50 })
    const starts: number[] = []
    const all = Promise.all(Array.from({ length: 5 }, () => limit(async () => void starts.push(Date.now()))))
    await vi.advanceTimersByTimeAsync(1000)
    await all
    expect(starts).toHaveLength(5)
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(50)
  })
})

describe('set image keys', () => {
  it('setImageKey accepts only the YGOPRODeck set-image folder', () => {
    expect(setImageKey('https://images.ygoprodeck.com/images/sets/MRD.jpg')).toBe('MRD')
    for (const bad of [
      'http://images.ygoprodeck.com/images/sets/MRD.jpg',
      'https://evil.example/images/sets/MRD.jpg',
      'https://images.ygoprodeck.com/images/sets/../x.jpg',
      'https://images.ygoprodeck.com/images/sets/A B.jpg',
      'https://images.ygoprodeck.com/images/cards/1.jpg',
      null,
    ]) {
      expect(setImageKey(bad)).toBeNull()
    }
  })

  it('setImageUrl builds the remote url', () => {
    expect(setImageUrl('MRD')).toBe('https://images.ygoprodeck.com/images/sets/MRD.jpg')
  })

  it('parseSetImageUrl parses ygo-img://set/<key>', () => {
    expect(parseSetImageUrl('ygo-img://set/MRD')).toBe('MRD')
    expect(parseSetImageUrl('ygo-img://set/MRD/')).toBe('MRD')
    expect(parseSetImageUrl('ygo-img://set/..%2Fx')).toBeNull()
    expect(parseImageUrl('ygo-img://set/1')).toBeNull()
  })
})

describe('image cache sets', () => {
  it('downloads once for concurrent calls and writes sets/<key>.jpg', async () => {
    const fetchFn = vi.fn<(url: string) => Promise<Response>>(async () => okResponse())
    const cache = createImageCache({ dir, fetchFn: fetchFn as unknown as typeof fetch, limit: noLimit })
    const [a, b] = await Promise.all([cache.getSet('MRD'), cache.getSet('MRD')])
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn.mock.calls[0][0]).toBe('https://images.ygoprodeck.com/images/sets/MRD.jpg')
    expect(a).toBe(path.join(dir, 'sets', 'MRD.jpg'))
    expect(b).toBe(a)
    expect(await fs.readFile(a!, 'utf8')).toBe('jpegdata')
  })

  it('failed set download leaves nothing behind', async () => {
    const bad = vi.fn(async () => new Response('err', { status: 500 }))
    const cache = createImageCache({ dir, fetchFn: bad as unknown as typeof fetch, limit: noLimit })
    expect(await cache.getSet('MRD')).toBeNull()
    expect(await fs.readdir(path.join(dir, 'sets'))).toEqual([])
  })

  it('invalid key resolves null without fetching', async () => {
    const fetchFn = vi.fn(async () => okResponse())
    const cache = createImageCache({ dir, fetchFn: fetchFn as unknown as typeof fetch, limit: noLimit })
    expect(await cache.getSet('../x')).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('yugipedia set images', () => {
  const URL_A = 'https://ms.yugipedia.com/a/ab/LB-JP.png'

  it('yugipediaImageKey is stable, 23 chars, and null outside ms.yugipedia.com', () => {
    const k = yugipediaImageKey(URL_A)!
    expect(k).toMatch(/^yp-[0-9a-f]{20}$/)
    expect(k).toHaveLength(23)
    expect(yugipediaImageKey(URL_A)).toBe(k)
    expect(yugipediaImageKey('https://ms.yugipedia.com/a/ab/Other.png')).not.toBe(k)
    expect(yugipediaImageKey('http://ms.yugipedia.com/a.png')).toBeNull()
    expect(yugipediaImageKey('https://evil.example/a.png')).toBeNull()
    expect(yugipediaImageKey(null)).toBeNull()
  })

  it('downloads the resolved URL with the User-Agent into sets/<key>.jpg', async () => {
    const key = yugipediaImageKey(URL_A)!
    const fetchFn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => okResponse())
    const resolveSetImage = vi.fn((k: string) => (k === key ? URL_A : null))
    const cache = createImageCache({ dir, fetchFn: fetchFn as unknown as typeof fetch, limit: noLimit, version: '1.2.3', resolveSetImage })
    expect(await cache.getSet(key)).toBe(path.join(dir, 'sets', `${key}.jpg`))
    expect(fetchFn.mock.calls[0][0]).toBe(URL_A)
    expect(new Headers(fetchFn.mock.calls[0][1]?.headers).get('user-agent')).toBe(
      'YugiohCollectionTracker/1.2.3 (https://github.com/darkharasho/yugioh-collection-tracker)'
    )
  })

  it('refuses a resolved URL outside ms.yugipedia.com', async () => {
    const fetchFn = vi.fn(async () => okResponse())
    const cache = createImageCache({ dir, fetchFn: fetchFn as unknown as typeof fetch, limit: noLimit, resolveSetImage: () => 'https://evil.example/x.jpg' })
    expect(await cache.getSet('yp-0123456789abcdef0123')).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('returns null for a yp- key with no resolver', async () => {
    const fetchFn = vi.fn(async () => okResponse())
    const cache = createImageCache({ dir, fetchFn: fetchFn as unknown as typeof fetch, limit: noLimit })
    expect(await cache.getSet('yp-0123456789abcdef0123')).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
