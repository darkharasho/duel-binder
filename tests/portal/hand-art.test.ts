import { describe, expect, it } from 'vitest'
import { handArtRoute } from '../../workers/portal/src/handArt'
import { memoryBucket } from './helpers'

const TOKEN = 'admin-secret'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

const put = (
  path: string,
  body: Uint8Array,
  type = 'image/jpeg',
  token: string | null = TOKEN
): Request =>
  new Request(`https://app.duelbinder.com/api/admin/hand-art/${path}`, {
    method: 'PUT',
    body: body as unknown as BodyInit,
    headers: { 'content-type': type, ...(token ? { authorization: `Bearer ${token}` } : {}) }
  })

describe('hand art upload (admin)', () => {
  it('stores high and low as JPEGs under hand/', async () => {
    const bucket = memoryBucket()
    const res = await handArtRoute(put('zh-hans-cbb7c-0101/high', JPEG), bucket, TOKEN)
    expect(await res!.json()).toEqual({ ok: true })
    expect((await handArtRoute(put('zh-hans-cbb7c-0101/low', JPEG), bucket, TOKEN))!.status).toBe(
      200
    )
    expect(bucket.store.get('hand/zh-hans-cbb7c-0101/high.jpg')?.contentType).toBe('image/jpeg')
    expect(bucket.store.get('hand/zh-hans-cbb7c-0101/low.jpg')?.contentType).toBe('image/jpeg')
  })

  it('leaves other paths and methods alone', async () => {
    const bucket = memoryBucket()
    expect(
      await handArtRoute(
        new Request('https://app.duelbinder.com/api/admin/hand-art/x/high'),
        bucket,
        TOKEN
      )
    ).toBeNull()
    expect(
      await handArtRoute(
        new Request('https://app.duelbinder.com/api/admin/op-art/full/1', { method: 'PUT' }),
        bucket,
        TOKEN
      )
    ).toBeNull()
  })

  it('401 without the token', async () => {
    const bucket = memoryBucket()
    for (const t of [null, 'nope'])
      expect(
        (await handArtRoute(put('a-b/high', JPEG, 'image/jpeg', t), bucket, TOKEN))!.status
      ).toBe(401)
    expect(bucket.store.size).toBe(0)
  })

  it('refuses ids outside lowercase letters, digits and dashes', async () => {
    for (const p of ['ZH-hans/high', 'a_b/high', 'a.b/high', 'a/b/high', 'a/medium']) {
      const res = await handArtRoute(put(p, JPEG), memoryBucket(), TOKEN)
      expect(res === null || res.status === 400).toBe(true)
    }
    expect((await handArtRoute(put('ZH/high', JPEG), memoryBucket(), TOKEN))!.status).toBe(400)
  })

  it('415 for anything but a JPEG', async () => {
    const bucket = memoryBucket()
    expect((await handArtRoute(put('a-b/high', PNG, 'image/png'), bucket, TOKEN))!.status).toBe(415)
    expect((await handArtRoute(put('a-b/high', PNG, 'image/jpeg'), bucket, TOKEN))!.status).toBe(
      415
    )
    expect(bucket.store.size).toBe(0)
  })

  it('413 over 4 MiB for high and over the thumb limit for low', async () => {
    const big = new Uint8Array(4 * 1024 * 1024 + 1)
    big.set(JPEG)
    expect((await handArtRoute(put('a-b/high', big), memoryBucket(), TOKEN))!.status).toBe(413)
    const mid = new Uint8Array(300 * 1024)
    mid.set(JPEG)
    expect((await handArtRoute(put('a-b/high', mid), memoryBucket(), TOKEN))!.status).toBe(200)
    expect((await handArtRoute(put('a-b/low', mid), memoryBucket(), TOKEN))!.status).toBe(413)
  })
})
