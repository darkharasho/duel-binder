import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLimiter } from '../../src/main/images/limiter'
import { createImageCache, imageUrl, parseImageUrl } from '../../src/main/images/cache'

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
