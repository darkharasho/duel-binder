import { vi, type Mock } from 'vitest'
import type { ScanPrinting } from '@shared/scan/types'
import type { ScanWindowMessage } from '@shared/scanWindow'
import type { RawSignals, ScanEngine } from '@/features/scan/engine'

export const printing = (o: Partial<ScanPrinting> = {}): ScanPrinting => ({
  printingId: 101,
  cardId: 1,
  name: 'Dark Magician',
  frameType: 'normal',
  setName: 'Legend of Blue Eyes White Dragon',
  setCode: 'LOB-EN005',
  rarity: 'Ultra Rare',
  language: 'en',
  price: null,
  imageIds: [46986414],
  ...o
})

export const quad = [
  [10, 10],
  [110, 10],
  [110, 160],
  [10, 160]
] as const

export const NOTHING: RawSignals = {
  found: false,
  quad: null,
  art: [],
  codeTexts: [],
  nameTexts: [],
  textBands: [],
  cues: null
}
export const codeFrame = (code: string): RawSignals => ({
  found: true,
  quad,
  art: [],
  codeTexts: [code],
  nameTexts: [],
  textBands: [],
  cues: null
})

export type FakeEngine = ScanEngine & {
  init: ReturnType<typeof vi.fn>
  analyze: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

/** Answers frames with `frame(n)` (n counts from 0); text only when asked, as the real one. */
export function fakeEngine(frame: (n: number) => RawSignals | Error = () => NOTHING): FakeEngine {
  let n = 0
  return {
    init: vi.fn(async () => undefined),
    analyze: vi.fn(async (_img: ImageData, opts: { wantText: boolean }) => {
      const out = frame(n++)
      if (out instanceof Error) throw out
      return opts.wantText ? out : { ...out, codeTexts: [], nameTexts: [] }
    }),
    dispose: vi.fn()
  } as unknown as FakeEngine
}

export interface FakeTrack {
  stop: ReturnType<typeof vi.fn>
  end(): void
}

/** Stubs getUserMedia (resolving, or rejecting with a DOMException name) and the video/canvas bits. */
export function stubCamera(fail?: string): {
  track: FakeTrack
  getUserMedia: ReturnType<typeof vi.fn>
} {
  const listeners: (() => void)[] = []
  const track = {
    kind: 'video',
    stop: vi.fn(),
    getSettings: () => ({ deviceId: 'cam1' }),
    addEventListener: (type: string, cb: () => void) => {
      if (type === 'ended') listeners.push(cb)
    },
    removeEventListener: () => {},
    end: () => listeners.forEach((cb) => cb())
  }
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] }
  const getUserMedia = vi.fn(async () => {
    if (fail) throw new DOMException('no', fail)
    return stream
  })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: vi.fn(async () =>
        fail === 'NotFoundError'
          ? []
          : [{ deviceId: 'cam1', kind: 'videoinput', label: 'Desk webcam', groupId: 'g' }]
      ),
      addEventListener: () => {},
      removeEventListener: () => {}
    }
  })
  return { track, getUserMedia }
}

/**
 * The video and canvas bits jsdom lacks: a 640x480 camera, ready to be read. Returns the
 * createImageBitmap stub, which records the frames grabbed as (video, x, y, w, h) calls.
 */
export function stubVideo(): ReturnType<typeof vi.fn> {
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
    configurable: true,
    get: () => 4
  })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    get: () => 640
  })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    configurable: true,
    get: () => 480
  })
  // A live camera's picture moves with the clock.
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get: () => Date.now() / 1000
  })
  const grabbed = vi.fn(
    async (_src: unknown, _x: number, _y: number, width: number, height: number) =>
      ({ width, height, close: vi.fn() }) as unknown as ImageBitmap
  )
  vi.stubGlobal('createImageBitmap', grabbed)
  return grabbed
}

/** A stand-in for window.api.scanWindow, for either window; `startOpen` is what isOpen() answers. */
export function fakeBridge(startOpen = false): {
  scanWindow: {
    open: Mock<() => Promise<void>>
    isOpen: Mock<() => Promise<boolean>>
    send: Mock<(m: ScanWindowMessage) => void>
    onMessage: Mock<(cb: (m: ScanWindowMessage) => void) => () => void>
    onOpenChange: Mock<(cb: (open: boolean) => void) => () => void>
    toggleFullScreen: Mock<() => Promise<void>>
  }
  /** Delivers a message to the window, as main's relay would. */
  emit: (m: ScanWindowMessage) => void
  emitOpen: (open: boolean) => void
  /** How many onMessage callbacks are registered right now. */
  listening: () => number
  /** Every message the window has sent. */
  sent: ScanWindowMessage[]
} {
  const messageCbs = new Set<(m: ScanWindowMessage) => void>()
  const openCbs = new Set<(open: boolean) => void>()
  const sent: ScanWindowMessage[] = []
  return {
    scanWindow: {
      open: vi.fn(async () => undefined),
      isOpen: vi.fn(async () => startOpen),
      send: vi.fn((m: ScanWindowMessage) => {
        sent.push(m)
      }),
      onMessage: vi.fn((cb: (m: ScanWindowMessage) => void) => {
        messageCbs.add(cb)
        return () => messageCbs.delete(cb)
      }),
      onOpenChange: vi.fn((cb: (open: boolean) => void) => {
        openCbs.add(cb)
        return () => openCbs.delete(cb)
      }),
      toggleFullScreen: vi.fn(async () => undefined)
    },
    emit: (m) => messageCbs.forEach((cb) => cb(m)),
    emitOpen: (b) => openCbs.forEach((cb) => cb(b)),
    listening: () => messageCbs.size,
    sent
  }
}
