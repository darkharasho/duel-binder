import { describe, expect, it } from 'vitest'
import { onePieceImageId, tokenId } from '../../src/shared/games/ids'
import { opArtRoute } from '../../workers/portal/src/opArt'
import { memoryBucket } from './helpers'

const TOKEN = 'admin-secret'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const id = onePieceImageId('en', 'OP01-001')

const put = (
  size: string,
  n: number,
  body: Uint8Array,
  type: string,
  token: string | null = TOKEN
): Request =>
  new Request(`https://app.duelbinder.com/api/admin/op-art/${size}/${n}`, {
    method: 'PUT',
    body: body as unknown as BodyInit,
    headers: { 'content-type': type, ...(token ? { authorization: `Bearer ${token}` } : {}) }
  })

describe('One Piece art upload (admin)', () => {
  it('stores full and small', async () => {
    const bucket = memoryBucket()
    expect((await opArtRoute(put('full', id, PNG, 'image/png'), bucket, TOKEN))!.status).toBe(200)
    const res = await opArtRoute(put('small', id, JPEG, 'image/jpeg'), bucket, TOKEN)
    expect(await res!.json()).toEqual({ ok: true })
    expect(bucket.store.get(`card/full/${id}`)?.contentType).toBe('image/png')
    expect(bucket.store.get(`card/small/${id}`)?.contentType).toBe('image/jpeg')
  })

  it('401 without the token', async () => {
    const bucket = memoryBucket()
    expect((await opArtRoute(put('full', id, PNG, 'image/png', null), bucket, TOKEN))!.status).toBe(401)
    expect((await opArtRoute(put('full', id, PNG, 'image/png', 'nope'), bucket, TOKEN))!.status).toBe(401)
    expect(bucket.store.size).toBe(0)
  })

  it('400 for a Yu-Gi-Oh id', async () => {
    for (const n of [5000, tokenId(1)]) {
      const res = await opArtRoute(put('full', n, PNG, 'image/png'), memoryBucket(), TOKEN)
      expect(res!.status).toBe(400)
    }
  })

  it('415 for a JPEG sent as full', async () => {
    const bucket = memoryBucket()
    expect((await opArtRoute(put('full', id, JPEG, 'image/jpeg'), bucket, TOKEN))!.status).toBe(415)
    expect((await opArtRoute(put('full', id, JPEG, 'image/png'), bucket, TOKEN))!.status).toBe(415)
    expect(bucket.store.size).toBe(0)
  })

  it('stores a 3 MiB PNG (OP02 art is 868x1212, about 2.3 MB) and 413s one over 4 MiB', async () => {
    const ok = new Uint8Array(3 * 1024 * 1024)
    ok.set(PNG)
    expect((await opArtRoute(put('full', id, ok, 'image/png'), memoryBucket(), TOKEN))!.status).toBe(200)
    const big = new Uint8Array(5 * 1024 * 1024)
    big.set(PNG)
    expect((await opArtRoute(put('full', id, big, 'image/png'), memoryBucket(), TOKEN))!.status).toBe(413)
  })

  it('413 from Content-Length alone, before the body is read', async () => {
    let read = false
    const req = {
      url: `https://app.duelbinder.com/api/admin/op-art/full/${id}`,
      method: 'PUT',
      headers: new Headers({
        'content-type': 'image/png',
        'content-length': String(5 * 1024 * 1024),
        authorization: `Bearer ${TOKEN}`
      }),
      arrayBuffer: async () => {
        read = true
        return PNG.buffer
      }
    } as unknown as Request
    const bucket = memoryBucket()
    expect((await opArtRoute(req, bucket, TOKEN))!.status).toBe(413)
    expect(read).toBe(false)
    expect(bucket.store.size).toBe(0)
  })

  it('413 for a small copy over 200 KiB, and null for other paths', async () => {
    const big = new Uint8Array(201 * 1024)
    big.set(JPEG)
    expect((await opArtRoute(put('small', id, big, 'image/jpeg'), memoryBucket(), TOKEN))!.status).toBe(413)
    const other = new Request('https://app.duelbinder.com/api/me')
    expect(await opArtRoute(other, memoryBucket(), TOKEN)).toBeNull()
  })
})
