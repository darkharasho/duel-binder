import { describe, expect, it } from 'vitest'
import { photoId, thumbsRoute, type ThumbBucket } from '../../workers/portal/src/thumbs'

const TOKEN = 'admin-secret'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

function bucket(): ThumbBucket & {
  store: Map<string, { bytes: ArrayBuffer; meta?: Record<string, string> }>
} {
  const store = new Map<string, { bytes: ArrayBuffer; meta?: Record<string, string> }>()
  return {
    store,
    async get(key) {
      const o = store.get(key)
      return o
        ? { body: new Response(o.bytes).body!, httpMetadata: { contentType: 'image/jpeg' } }
        : null
    },
    async put(key, value, opts) {
      store.set(key, { bytes: value, meta: opts.customMetadata })
    },
    async list({ prefix, cursor, limit = 1000, include }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort()
      const start = cursor ? Number(cursor) : 0
      const page = keys.slice(start, start + limit)
      return {
        objects: page.map((key) => ({
          key,
          size: store.get(key)!.bytes.byteLength,
          ...(include?.includes('customMetadata')
            ? { customMetadata: store.get(key)!.meta ?? {} }
            : {})
        })),
        truncated: start + limit < keys.length,
        cursor: String(start + limit)
      }
    }
  }
}

const req = (path: string, init: RequestInit = {}, token: string | null = TOKEN): Request =>
  new Request(`https://app.duelbinder.com/api/admin/thumbs/${path}`, {
    ...init,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) }
  })

describe('printing photo small copies (admin)', () => {
  it('photoId reads a stored photo key', () => {
    expect(photoId('printing/12')).toBe(12)
    expect(photoId('printing/12-v38')).toBe(12)
    expect(photoId('printing/0')).toBeNull()
    expect(photoId('printing-small/12')).toBeNull()
    expect(photoId('card/small/12')).toBeNull()
  })

  it('is not ours for other paths, and refuses a wrong or missing token', async () => {
    const b = bucket()
    expect(
      await thumbsRoute(new Request('https://app.duelbinder.com/api/sync'), b, TOKEN)
    ).toBeNull()
    expect((await thumbsRoute(req('list?prefix=printing/', {}, 'wrong'), b, TOKEN))?.status).toBe(
      401
    )
    expect((await thumbsRoute(req('list?prefix=printing/', {}, null), b, TOKEN))?.status).toBe(401)
    expect((await thumbsRoute(req('list?prefix=printing/'), b, undefined))?.status).toBe(401)
  })

  it('lists photos and small copies page by page, with what each copy was made from', async () => {
    const b = bucket()
    await b.put('printing/1', JPEG.buffer, { httpMetadata: { contentType: 'image/jpeg' } })
    await b.put('printing/2-v38', JPEG.buffer, { httpMetadata: { contentType: 'image/jpeg' } })
    await b.put('printing-small/1', JPEG.buffer, {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { from: 'printing/1' }
    })
    await b.put('card/small/1', JPEG.buffer, { httpMetadata: { contentType: 'image/jpeg' } })
    const photos = await (await thumbsRoute(req('list?prefix=printing/'), b, TOKEN))!.json()
    expect(photos).toEqual({
      objects: [
        { key: 'printing/1', size: 7 },
        { key: 'printing/2-v38', size: 7 }
      ],
      cursor: null
    })
    const thumbs = await (await thumbsRoute(req('list?prefix=printing-small/'), b, TOKEN))!.json()
    expect(thumbs.objects).toEqual([{ key: 'printing-small/1', size: 7, from: 'printing/1' }])
    expect((await thumbsRoute(req('list?prefix=card/'), b, TOKEN))?.status).toBe(400)
  })

  it('reads a stored photo, and nothing outside printing/', async () => {
    const b = bucket()
    await b.put('printing/3', JPEG.buffer, { httpMetadata: { contentType: 'image/jpeg' } })
    const res = await thumbsRoute(req('photo?key=printing/3'), b, TOKEN)
    expect(new Uint8Array(await res!.arrayBuffer())).toEqual(JPEG)
    expect((await thumbsRoute(req('photo?key=printing/4'), b, TOKEN))?.status).toBe(404)
    expect((await thumbsRoute(req('photo?key=card/small/3'), b, TOKEN))?.status).toBe(400)
  })

  it('stores a JPEG small copy under the id its photo names, and refuses anything else', async () => {
    const b = bucket()
    const put = (id: string, from: string, body: BodyInit): Promise<Response | null> =>
      thumbsRoute(req(id, { method: 'PUT', body, headers: { 'x-thumb-from': from } }), b, TOKEN)
    expect((await put('5', 'printing/5-v38', JPEG))?.status).toBe(200)
    expect(b.store.get('printing-small/5')?.meta).toEqual({ from: 'printing/5-v38' })
    expect((await put('6', 'printing/5', JPEG))?.status).toBe(400)
    expect((await put('6', 'printing/6', new Uint8Array([0x89, 0x50, 1])))?.status).toBe(400)
    expect((await put('6', 'printing/6', new Uint8Array(300 * 1024).fill(0xff)))?.status).toBe(400)
    expect(b.store.has('printing-small/6')).toBe(false)
  })
})
