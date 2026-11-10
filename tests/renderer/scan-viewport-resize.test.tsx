import { act, render } from '@testing-library/react'
import { createRef } from 'react'
import { ScanViewport } from '@/features/scan/ScanViewport'
import type { ScanLoop } from '@/features/scan/useScanLoop'

// iOS kept drawing the camera's picture at the size its element had when the picture started,
// a small box in black once the phone's preview grew: the preview takes a new video element,
// with the same stream, whenever its box settles at a new size.

let report: (width: number, height: number) => void = () => undefined
class FakeResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(): void {
    report = (width, height) =>
      this.cb([{ contentRect: { width, height } } as ResizeObserverEntry], this as never)
  }
  disconnect(): void {
    report = () => undefined
  }
  unobserve(): void {
    report = () => undefined
  }
}

const loop: ScanLoop = {
  status: { kind: 'idle' },
  retry: () => undefined,
  takePhoto: () => undefined,
  outline: null,
  artReady: true,
  artData: null,
  timing: null
}

const stream = { id: 'camera' } as unknown as MediaStream

function mount(freshOnResize: boolean): {
  videoRef: React.RefObject<HTMLVideoElement | null>
} {
  const videoRef = createRef<HTMLVideoElement>()
  render(
    <ScanViewport
      videoRef={videoRef}
      error={null}
      messages={{} as never}
      onRetryCamera={() => undefined}
      loop={loop}
      freshOnResize={freshOnResize}
    />
  )
  videoRef.current!.srcObject = stream
  return { videoRef }
}

const settle = (): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ScanViewport preview resizing', () => {
  it('takes a new video element with the same stream when its box settles at a new size', async () => {
    const { videoRef } = mount(true)
    const first = videoRef.current
    act(() => report(330, 440))
    await settle()
    expect(videoRef.current).toBe(first)

    act(() => report(500, 600))
    act(() => report(585, 780))
    await settle()
    expect(videoRef.current).not.toBe(first)
    expect(videoRef.current!.srcObject).toBe(stream)
  })

  it('keeps its video element without the option', async () => {
    const { videoRef } = mount(false)
    const first = videoRef.current
    act(() => report(330, 440))
    act(() => report(585, 780))
    await settle()
    expect(videoRef.current).toBe(first)
  })
})
