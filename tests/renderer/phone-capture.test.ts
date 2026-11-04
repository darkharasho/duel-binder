import { describe, expect, test, vi } from 'vitest'
import {
  appVersion,
  deviceFromUa,
  deviceModel,
  encodeWithinCap,
  grabFrame,
  newClientId
} from '../../src/phone/training/capture'
import { CLIENT_ID_RE } from '../../src/shared/training'

describe('encodeWithinCap', () => {
  test('first quality under the cap wins', async () => {
    const sizes: Record<number, number> = { 0.92: 9e6, 0.8: 7e6, 0.7: 5e6 }
    const asked: number[] = []
    const out = await encodeWithinCap(async (q) => {
      asked.push(q)
      return new Blob([new Uint8Array(sizes[q])])
    })
    expect(asked).toEqual([0.92, 0.8])
    expect(out.byteLength).toBe(7e6)
  })
  test('still too big throws', async () => {
    await expect(encodeWithinCap(async () => new Blob([new Uint8Array(10)]), 5)).rejects.toThrow(
      'photo-too-big'
    )
  })
})

describe('grabFrame', () => {
  test('no frame yet throws', async () => {
    await expect(grabFrame({ videoWidth: 0, videoHeight: 0 } as HTMLVideoElement)).rejects.toThrow(
      'no-frame'
    )
  })
  test('a null blob is a failed encode', async () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (cb: (b: Blob | null) => void) => cb(null)
    }
    const doc = vi.spyOn(document, 'createElement').mockReturnValue(canvas as never)
    await expect(grabFrame({ videoWidth: 4, videoHeight: 3 } as HTMLVideoElement)).rejects.toThrow(
      'no-frame'
    )
    doc.mockRestore()
  })
  test('draws the whole frame and encodes it', async () => {
    const drawImage = vi.fn()
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (cb: (b: Blob | null) => void, type: string) => {
        expect(type).toBe('image/jpeg')
        cb(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]))
      }
    }
    const doc = vi.spyOn(document, 'createElement').mockReturnValue(canvas as never)
    const video = { videoWidth: 4, videoHeight: 3 } as HTMLVideoElement
    const out = await grabFrame(video)
    doc.mockRestore()
    expect(out.byteLength).toBe(3)
    expect([canvas.width, canvas.height]).toEqual([4, 3])
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 4, 3)
  })
})

describe('device', () => {
  test.each([
    ['Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36', 'Android 15 Pixel 8'],
    ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36', 'Android 10'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X)', 'iPhone iOS 26.1'],
    ['Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)', 'iPad iOS 17.5'],
    ['x'.repeat(300), 'x'.repeat(100)],
    ['', 'unknown']
  ])('device of %j', (ua, want) => expect(deviceFromUa(ua)).toBe(want))

  test('deviceModel is 1-100 chars and memoized', async () => {
    const a = await deviceModel()
    expect(a.length).toBeGreaterThanOrEqual(1)
    expect(a.length).toBeLessThanOrEqual(100)
    expect(await deviceModel()).toBe(a)
  })
})

test('client ids are v4 UUIDs', () => expect(newClientId()).toMatch(CLIENT_ID_RE))

test('app version passes the label rule', () => {
  expect(appVersion()).toBe('0.0.0-dev')
  vi.stubGlobal('__APP_VERSION__', '0.53.0')
  expect(appVersion()).toBe('0.53.0')
  vi.unstubAllGlobals()
})
