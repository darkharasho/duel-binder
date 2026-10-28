import { act, renderHook, waitFor } from '@testing-library/react'
import { useCamera } from '@/features/scan/useCamera'
import { stubCamera } from './scanFakes'

const DESKTOP = {
  audio: false,
  video: { width: { ideal: 3840 }, height: { ideal: 2160 } }
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('useCamera', () => {
  it("useCamera with 'environment' asks for the rear camera; without it, constraints are unchanged", async () => {
    const { getUserMedia } = stubCamera()
    const rear = renderHook(() => useCamera(null, 'environment'))
    await waitFor(() => expect(rear.result.current.stream).not.toBeNull())
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: { ...DESKTOP.video, facingMode: { ideal: 'environment' } }
    })
    rear.unmount()

    const desk = renderHook(() => useCamera(null))
    await waitFor(() => expect(desk.result.current.stream).not.toBeNull())
    expect(getUserMedia).toHaveBeenLastCalledWith(DESKTOP)
    desk.unmount()
  })

  it('a picked camera opens by its id, whichever way it faces', async () => {
    const { getUserMedia } = stubCamera()
    const r = renderHook(() => useCamera('cam1', 'environment'))
    await waitFor(() => expect(r.result.current.stream).not.toBeNull())
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: { ...DESKTOP.video, deviceId: { exact: 'cam1' } }
    })
    r.unmount()
  })
})

interface Track {
  readyState: 'live' | 'ended'
  muted: boolean
  stop: ReturnType<typeof vi.fn>
  getSettings: () => { deviceId: string }
  addEventListener: (type: string, cb: () => void) => void
  removeEventListener: () => void
}

/** getUserMedia answering from `answers` in turn (a DOMException name rejects), then streams. */
function stubMedia(answers: (string | 'ok')[] = []): {
  getUserMedia: ReturnType<typeof vi.fn>
  tracks: Track[]
  deviceChange: () => void
} {
  const tracks: Track[] = []
  let changed: (() => void) | null = null
  const getUserMedia = vi.fn(async () => {
    const next = answers.shift() ?? 'ok'
    if (next !== 'ok') throw new DOMException('no', next)
    const track: Track = {
      readyState: 'live',
      muted: false,
      stop: vi.fn(),
      getSettings: () => ({ deviceId: 'cam1' }),
      addEventListener: () => {},
      removeEventListener: () => {}
    }
    tracks.push(track)
    return { getVideoTracks: () => [track], getTracks: () => [track] }
  })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: vi.fn(async () => []),
      addEventListener: (type: string, cb: () => void) => {
        if (type === 'devicechange') changed = cb
      },
      removeEventListener: () => {}
    }
  })
  return { getUserMedia, tracks, deviceChange: () => changed?.() }
}

const flush = (ms = 0): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

const setVisibility = (state: 'visible' | 'hidden'): void => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useCamera recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    setVisibility('visible')
  })

  it('reports a camera held elsewhere as busy and tries it again on its own', async () => {
    const media = stubMedia(['NotReadableError', 'NotReadableError'])
    const { result } = renderHook(() => useCamera(null))
    await flush()
    expect(result.current.error).toBe('busy')
    await flush(500)
    expect(result.current.error).toBe('busy')
    await flush(1500)
    expect(result.current.error).toBeNull()
    expect(result.current.stream).not.toBeNull()
    expect(media.getUserMedia).toHaveBeenCalledTimes(3)
  })

  it('gives up retrying a busy camera after a few tries', async () => {
    const media = stubMedia(Array(10).fill('NotReadableError'))
    const { result } = renderHook(() => useCamera(null))
    for (let i = 0; i < 30; i++) await flush(1000)
    expect(result.current.error).toBe('busy')
    expect(media.getUserMedia).toHaveBeenCalledTimes(4)
  })

  it('opens a camera plugged in after none was found', async () => {
    const media = stubMedia(['NotFoundError'])
    const { result } = renderHook(() => useCamera(null))
    await flush()
    expect(result.current.error).toBe('none')
    media.deviceChange()
    await flush()
    expect(result.current.error).toBeNull()
    expect(result.current.stream).not.toBeNull()
  })

  it('does not ask again after the camera was denied', async () => {
    const media = stubMedia(['NotAllowedError'])
    const { result } = renderHook(() => useCamera(null))
    await flush()
    media.deviceChange()
    await flush(10_000)
    expect(result.current.error).toBe('denied')
    expect(media.getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('reopens a stream muted or ended in the background once shown again', async () => {
    const media = stubMedia()
    const { result } = renderHook(() => useCamera(null))
    await flush()
    const first = result.current.stream
    setVisibility('hidden')
    media.tracks[0].muted = true
    await flush()
    expect(media.getUserMedia).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    await flush()
    expect(media.getUserMedia).toHaveBeenCalledTimes(2)
    expect(media.tracks[0].stop).toHaveBeenCalled()
    expect(result.current.stream).not.toBe(first)

    // A healthy stream is left alone.
    setVisibility('hidden')
    setVisibility('visible')
    await flush()
    expect(media.getUserMedia).toHaveBeenCalledTimes(2)
  })
})
