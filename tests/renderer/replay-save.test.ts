import { describe, it, expect, vi, afterEach } from 'vitest'

const where = vi.hoisted(() => ({ platform: 'desktop' as 'desktop' | 'phone-web' | 'native' }))
vi.mock('@/lib/platform', async (orig) => ({
  ...(await orig<typeof import('@/lib/platform')>()),
  isPhone: () => where.platform !== 'desktop',
  isWeb: () => where.platform !== 'desktop'
}))
vi.mock('@/lib/portal', async (orig) => ({
  ...(await orig<typeof import('@/lib/portal')>()),
  isNativeApp: () => where.platform === 'native'
}))
const shareFile = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../src/phone/stream/device', () => ({ shareFile }))

const { replayFileName, saveReplay } = await import('@/features/scan/replay/save')

const blob = (): Blob => new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' })

afterEach(() => {
  where.platform = 'desktop'
  vi.unstubAllGlobals()
  // @ts-expect-error test cleanup
  delete window.api
})

describe('replayFileName', () => {
  it('names the file by date', () => {
    expect(replayFileName('mp4', new Date(2026, 10, 4))).toBe('rip-replay-2026-11-04.mp4')
  })
})

describe('saveReplay', () => {
  const desktopApi = (result: string | null): ReturnType<typeof vi.fn> => {
    const save = vi.fn(async () => result)
    ;(window as unknown as { api: unknown }).api = { app: { saveReplay: save } }
    return save
  }

  it('desktop saves through the app API', async () => {
    const save = desktopApi('/x.mp4')
    await expect(saveReplay(blob(), 'r.mp4')).resolves.toEqual({ saved: true, where: '/x.mp4' })
    expect(save).toHaveBeenCalledWith('r.mp4', new Uint8Array([1, 2, 3]))
  })

  it('desktop cancel', async () => {
    desktopApi(null)
    await expect(saveReplay(blob(), 'r.mp4')).resolves.toEqual({ saved: false })
  })

  it('the apps open the share sheet', async () => {
    where.platform = 'native'
    await expect(saveReplay(blob(), 'r.mp4')).resolves.toEqual({ saved: true, where: null })
    expect(shareFile).toHaveBeenCalledWith('r.mp4', 'video/mp4', expect.any(Blob))
  })

  it('phone web shares when it can', async () => {
    where.platform = 'phone-web'
    const share = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share })
    await expect(saveReplay(blob(), 'r.mp4')).resolves.toEqual({ saved: true, where: null })
    expect(share).toHaveBeenCalled()
  })

  it('phone web cancel is not an error', async () => {
    where.platform = 'phone-web'
    const share = vi.fn(async () => {
      throw new DOMException('', 'AbortError')
    })
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share })
    await expect(saveReplay(blob(), 'r.mp4')).resolves.toEqual({ saved: false })
  })

  // A share needs a recent tap, and the render takes longer than that: the browser refuses it.
  it('phone web downloads when the share is refused after a long render', async () => {
    where.platform = 'phone-web'
    const share = vi.fn(async () => {
      throw new DOMException('', 'NotAllowedError')
    })
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share })
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await expect(saveReplay(blob(), 'r.mp4')).resolves.toEqual({ saved: true, where: null })
    expect(click).toHaveBeenCalledTimes(1)
  })

  it("phone web downloads when it can't share", async () => {
    where.platform = 'phone-web'
    vi.stubGlobal('navigator', { ...navigator, canShare: undefined })
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      expect(this.download).toBe('r.mp4')
    })
    await expect(saveReplay(blob(), 'r.mp4')).resolves.toEqual({ saved: true, where: null })
    expect(click).toHaveBeenCalledTimes(1)
  })
})
