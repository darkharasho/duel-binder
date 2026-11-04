import { describe, expect, it } from 'vitest'
import { tokenId } from '../../src/shared/games/ids'
import { edgeImage } from '../../workers/portal/src/images'
import { memoryBucket } from './helpers'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

/** An in-memory stand-in for caches.default, keyed by URL. */
function memoryEdge(): {
  store: Map<string, Response>
  match(req: Request): Promise<Response | undefined>
  put(req: Request, res: Response): Promise<void>
} {
  const store = new Map<string, Response>()
  return {
    store,
    match: async (req) => store.get(req.url)?.clone(),
    put: async (req, res) => {
      store.set(req.url, res)
    }
  }
}

const url = (path: string): string => `https://app.duelbinder.com/img/${path}`

/** The Durable Object stand-in: records what reached it and answers `res`. */
function durableObject(res: () => Response = () => new Response('Not found', { status: 404 })): {
  calls: string[]
  fetch(req: Request): Promise<Response>
} {
  const calls: string[] = []
  return { calls, fetch: async (req) => (calls.push(new URL(req.url).pathname), res()) }
}

describe('artwork from the edge, ahead of the Durable Object', () => {
  it('serves stored art from R2 without the Durable Object, and caches it at the edge', async () => {
    const store = durableObject()
    const bucket = memoryBucket()
    await bucket.put('card/small/46986414', JPEG.buffer, { httpMetadata: { contentType: 'image/jpeg' } })
    const edge = memoryEdge()
    const waits: Promise<unknown>[] = []
    const res = await edgeImage(new Request(url('small/46986414')), bucket, edge, (p) => waits.push(p), store.fetch)
    expect(res?.status).toBe(200)
    expect(res?.headers.get('content-type')).toBe('image/jpeg')
    expect(res?.headers.get('cache-control')).toContain('immutable')
    expect(res?.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await res!.arrayBuffer())).toEqual(JPEG)
    await Promise.all(waits)
    expect(edge.store.has(url('small/46986414'))).toBe(true)
    expect(store.calls).toEqual([])
  })

  it('answers from the edge cache before R2', async () => {
    const store = durableObject()
    const edge = memoryEdge()
    edge.store.set(url('full/1'), new Response('cached'))
    const bucket = { get: async () => { throw new Error('R2 read') } }
    const res = await edgeImage(new Request(url('full/1')), bucket, edge, () => {}, store.fetch)
    expect(await res?.text()).toBe('cached')
  })

  it('shares one cache entry whoever asks: the key drops the Authorization header', async () => {
    const store = durableObject()
    const bucket = memoryBucket()
    await bucket.put('card/small/7', JPEG.buffer, { httpMetadata: { contentType: 'image/jpeg' } })
    const edge = memoryEdge()
    let key: Request | undefined
    const spy = { ...edge, put: async (req: Request, res: Response) => { key = req; await edge.put(req, res) } }
    const signed = new Request(url('small/7'), { headers: { authorization: 'Bearer secret' } })
    const waits: Promise<unknown>[] = []
    await edgeImage(signed, bucket, spy, (p) => waits.push(p), store.fetch)
    await Promise.all(waits)
    expect(key?.headers.get('authorization')).toBeNull()
  })

  it('reads a token, whatever size is asked, from its one stored original', async () => {
    const store = durableObject()
    const bucket = memoryBucket()
    const id = tokenId(42)
    await bucket.put(`card/full/${id}`, JPEG.buffer, { httpMetadata: { contentType: 'image/png' } })
    const res = await edgeImage(new Request(url(`small/${id}`)), bucket, null, () => {}, store.fetch)
    expect(res?.headers.get('content-type')).toBe('image/png')
  })

  it('leaves the Durable Object what R2 lacks, keeping its 200s at the edge without CORS', async () => {
    const edge = memoryEdge()
    const store = durableObject(
      () =>
        new Response('photo', {
          headers: {
            'content-type': 'image/jpeg',
            'cache-control': 'public, max-age=86400',
            'access-control-allow-origin': 'capacitor://localhost',
            vary: 'origin'
          }
        })
    )
    const waits: Promise<unknown>[] = []
    const req = new Request(url('printing/30230'), { headers: { origin: 'capacitor://localhost' } })
    const res = await edgeImage(req, memoryBucket(), edge, (p) => waits.push(p), store.fetch)
    expect(await res?.text()).toBe('photo')
    await Promise.all(waits)
    expect(store.calls).toEqual(['/img/printing/30230'])
    const kept = edge.store.get(url('printing/30230'))
    expect(kept?.headers.get('access-control-allow-origin')).toBeNull()
    expect(kept?.headers.get('vary')).toBeNull()
    // The next ask, from anywhere, is the edge's.
    await edgeImage(new Request(url('printing/30230')), memoryBucket(), edge, () => {}, store.fetch)
    expect(store.calls).toHaveLength(1)
  })

  it('keeps no misses, quota answers or private replies at the edge', async () => {
    const edge = memoryEdge()
    const replies = [
      new Response('Not found', { status: 404 }),
      new Response('Too many requests', { status: 429 }),
      new Response('x', { headers: { 'cache-control': 'private' } })
    ]
    for (const r of replies) {
      const waits: Promise<unknown>[] = []
      await edgeImage(new Request(url('small/6')), memoryBucket(), edge, (p) => waits.push(p), async () => r)
      await Promise.all(waits)
    }
    expect(edge.store.size).toBe(0)
  })

  it('leaves anything but a GET of /img/ alone', async () => {
    const store = durableObject()
    const bucket = memoryBucket()
    await bucket.put('card/small/5', JPEG.buffer, { httpMetadata: { contentType: 'image/jpeg' } })
    const none = (r: Request): Promise<Response | null> => edgeImage(r, bucket, null, () => {}, store.fetch)
    expect(await none(new Request(url('small/5'), { method: 'HEAD' }))).toBeNull()
    expect(await none(new Request('https://app.duelbinder.com/api/rpc/x'))).toBeNull()
    expect(store.calls).toEqual([])
  })

  it('a failing R2 read falls back to the Durable Object', async () => {
    const store = durableObject()
    const bucket = { get: async () => { throw new Error('R2 down') } }
    const res = await edgeImage(new Request(url('small/5')), bucket, null, () => {}, store.fetch)
    expect(res?.status).toBe(404)
    expect(store.calls).toEqual(['/img/small/5'])
  })

  it("serves a printing photo's small copy from R2 without the Durable Object", async () => {
    const store = durableObject()
    const bucket = memoryBucket()
    await bucket.put('printing-small/12', JPEG.buffer, { httpMetadata: { contentType: 'image/jpeg' } })
    const edge = memoryEdge()
    const waits: Promise<unknown>[] = []
    const res = await edgeImage(new Request(url('printing-small/12')), bucket, edge, (p) => waits.push(p), store.fetch)
    expect(res?.status).toBe(200)
    expect(res?.headers.get('cache-control')).toBe('public, max-age=86400')
    await Promise.all(waits)
    expect(edge.store.has(url('printing-small/12'))).toBe(true)
    expect(store.calls).toEqual([])
  })

  it('without a small copy, the full photo, kept at the edge only an hour', async () => {
    const store = durableObject(
      () => new Response(JPEG, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' } })
    )
    const edge = memoryEdge()
    const waits: Promise<unknown>[] = []
    const res = await edgeImage(new Request(url('printing-small/12')), memoryBucket(), edge, (p) => waits.push(p), store.fetch)
    expect(res?.status).toBe(200)
    expect(res?.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(store.calls).toEqual(['/img/printing/12'])
    await Promise.all(waits)
    expect(edge.store.get(url('printing-small/12'))?.headers.get('cache-control')).toBe('public, max-age=3600')
  })

  it('?only: no small copy is a 404, never the full photo (the desktop keeps that itself)', async () => {
    const store = durableObject(() => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }))
    const edge = memoryEdge()
    const res = await edgeImage(new Request(url('printing-small/12?only')), memoryBucket(), edge, () => {}, store.fetch)
    expect(res?.status).toBe(404)
    expect(res?.headers.get('cache-control')).toBe('no-store')
    expect(store.calls).toEqual([])
    expect(edge.store.size).toBe(0)
  })

  it('?only still serves a small copy that exists', async () => {
    const bucket = memoryBucket()
    await bucket.put('printing-small/12', JPEG.buffer, { httpMetadata: { contentType: 'image/jpeg' } })
    const res = await edgeImage(new Request(url('printing-small/12?only')), bucket, null, () => {}, durableObject().fetch)
    expect(res?.status).toBe(200)
    expect(res?.headers.get('content-type')).toBe('image/jpeg')
  })

  it("passes on the full photo's 404 uncached", async () => {
    const store = durableObject()
    const edge = memoryEdge()
    const res = await edgeImage(new Request(url('printing-small/12')), memoryBucket(), edge, () => {}, store.fetch)
    expect(res?.status).toBe(404)
    expect(edge.store.size).toBe(0)
  })

  it("never reads a training photo's key from R2", async () => {
    const store = durableObject()
    const reads: string[] = []
    const bucket = memoryBucket()
    const key = 'training/op/7/11111111-1111-4111-8111-111111111111.jpg'
    await bucket.put(key, JPEG.buffer, { httpMetadata: { contentType: 'image/jpeg' } })
    const spy = { get: async (k: string) => (reads.push(k), bucket.get(k)) }
    const res = await edgeImage(new Request(url(key)), spy, memoryEdge(), () => {}, store.fetch)
    expect(res?.status).toBe(404)
    expect(reads).toEqual([])
  })
})
