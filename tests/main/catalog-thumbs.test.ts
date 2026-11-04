import { describe, expect, it } from 'vitest'
import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js'
import { PNG } from 'pngjs'
import { THUMB_WIDTH, runThumbs, shrink, thumbnail, todo } from '../../scripts/catalog/thumbs'

function solid(
  width: number,
  height: number,
  alpha = 255
): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 200
    data[i + 1] = 40
    data[i + 2] = 10
    data[i + 3] = alpha
  }
  return { width, height, data }
}
const jpeg = (w: number, h: number): Uint8Array => {
  const img = solid(w, h)
  return new Uint8Array(encodeJpeg({ ...img, data: Buffer.from(img.data) }, 90).data)
}
const png = (w: number, h: number, alpha: number): Uint8Array => {
  const p = new PNG({ width: w, height: h })
  p.data = Buffer.from(solid(w, h, alpha).data)
  return new Uint8Array(PNG.sync.write(p))
}

describe('printing photo small copies (catalog job)', () => {
  it('shrinks to the grid width, keeping the shape and the colour', () => {
    const out = shrink(solid(700, 1000), THUMB_WIDTH)
    expect(out.width).toBe(THUMB_WIDTH)
    expect(out.height).toBe(383)
    expect([...out.data.slice(0, 4)]).toEqual([200, 40, 10, 255])
    const narrow = solid(200, 290)
    expect(shrink(narrow, THUMB_WIDTH)).toBe(narrow)
  })

  it('makes a small JPEG of a big photo, keeps an already small JPEG as it is', () => {
    const big = thumbnail(jpeg(700, 1000))!
    const img = decodeJpeg(big)
    expect(img.width).toBe(THUMB_WIDTH)
    expect(big.length).toBeLessThan(jpeg(700, 1000).length)
    const small = jpeg(200, 290)
    expect(thumbnail(small)).toBe(small)
  })

  it('turns an opaque PNG into a JPEG and leaves a transparent one be', () => {
    const out = thumbnail(png(600, 870, 255))!
    expect([out[0], out[1]]).toEqual([0xff, 0xd8])
    expect(thumbnail(png(600, 870, 0))).toBeNull()
    expect(thumbnail(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('wants a copy for each photo with none, or one made from another photo, less the skipped', () => {
    const photos = [
      { key: 'printing/1' },
      { key: 'printing/2-v38' },
      { key: 'printing/3' },
      { key: 'printing/4' }
    ]
    const thumbs = [
      { key: 'printing-small/1', from: 'printing/1' },
      { key: 'printing-small/2', from: 'printing/2' }
    ]
    expect(todo(photos, thumbs, new Set(['printing/4']))).toEqual(['printing/2-v38', 'printing/3'])
  })

  it('lists, downloads, shrinks and stores; stops at its time budget', async () => {
    const stored = new Map<string, Uint8Array>([
      ['printing/1', jpeg(700, 1000)],
      ['printing/2', png(600, 870, 0)],
      ['printing/3', jpeg(500, 730)]
    ])
    const puts: { path: string; from: string | null; bytes: number }[] = []
    const fetchFn = (async (input: string, init?: RequestInit) => {
      const u = new URL(input)
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer t')
      const path = u.pathname.replace('/api/admin/thumbs/', '')
      if (path === 'list') {
        const prefix = u.searchParams.get('prefix')
        const objects =
          prefix === 'printing/' ? [...stored.keys()].map((key) => ({ key, size: 1 })) : []
        return Response.json({ objects, cursor: null })
      }
      if (path === 'photo')
        return new Response(stored.get(u.searchParams.get('key')!)! as Uint8Array<ArrayBuffer>)
      const body = new Uint8Array(await new Response(init!.body).arrayBuffer())
      puts.push({ path, from: new Headers(init!.headers).get('x-thumb-from'), bytes: body.length })
      return Response.json({ ok: true })
    }) as unknown as typeof fetch
    const skip = new Set<string>()
    const r = await runThumbs({ url: 'https://portal.test/', token: 't', fetch: fetchFn }, { skip })
    expect(r).toEqual({ made: 2, skipped: 1, failed: 0, left: 0 })
    expect(puts.map((p) => [p.path, p.from]).sort()).toEqual([
      ['1', 'printing/1'],
      ['3', 'printing/3']
    ])
    expect([...skip]).toEqual(['printing/2'])

    let t = 0
    const late = await runThumbs(
      { url: 'https://portal.test', token: 't', fetch: fetchFn },
      { skip: new Set(), now: () => (t += 1000), budgetMs: 500 }
    )
    expect(late).toMatchObject({ made: 0, left: 3 })
  })
})
