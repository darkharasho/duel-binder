// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { phonePackWrappers } from '../../src/phone/packWrappers'

describe('phonePackWrappers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('rejects a key that is not a string', async () => {
    await expect(phonePackWrappers(5 as unknown as string)).rejects.toThrow('Pack image key')
  })

  it('is null when the photo is missing or the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 }))
    )
    await expect(phonePackWrappers('yc-abc')).resolves.toBeNull()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline')))
    )
    await expect(phonePackWrappers('yc-abc')).resolves.toBeNull()
  })

  it("is null when the photo can't be decoded", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['x'])))
    )
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => Promise.reject(new Error('bad image')))
    )
    await expect(phonePackWrappers('yc-abc')).resolves.toBeNull()
  })
})
