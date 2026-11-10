import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FrameSignals, RawSignals } from '@/features/scan/engine'
import type { ScanOutcome } from '@/features/scan/resolve'
import { useScanLoop } from '@/features/scan/useScanLoop'
import { createMockApi } from './mockApi'
import { NOTHING, fakeEngine, quad, stubVideo, type FakeEngine } from './scanFakes'

// A frame's text is read (OCR) after the worker has matched its art. The next frame's art is
// matched meanwhile, and frames still finish in the order they were grabbed.

const order = vi.hoisted(() => ({ resolved: [] as number[] }))
vi.mock('@/features/scan/resolve', async (actual) => ({
  ...(await actual<typeof import('@/features/scan/resolve')>()),
  resolveSignals: vi.fn(async (raw: RawSignals): Promise<ScanOutcome> => {
    order.resolved.push(raw.art[0]?.imageId ?? -1)
    return { kind: 'none' }
  })
}))

const frameOf = (n: number): RawSignals => ({
  ...NOTHING,
  found: true,
  quad,
  art: [{ imageId: n, distance: 10 }]
})

/** Answers each frame's vision at once and its text when the test says (texts[n]()). */
function overlapEngine(): { engine: FakeEngine; texts: (() => void)[] } {
  const texts: (() => void)[] = []
  let n = 0
  const engine = {
    ...fakeEngine(),
    analyze: vi.fn(async (_img: ImageData, opts: { onVision?: (seen: FrameSignals) => void }) => {
      const raw = frameOf(n++)
      opts.onVision?.({ ...raw, codeBands: [], nameBands: [] } as unknown as FrameSignals)
      await new Promise<void>((done) => texts.push(done))
      return raw
    })
  } as unknown as FakeEngine
  return { engine, texts }
}

/** Answers each frame's vision when the test says (visions[n]()), and its text at once. */
function heldVisionEngine(lanes?: number): { engine: FakeEngine; visions: (() => void)[] } {
  const visions: (() => void)[] = []
  let n = 0
  const engine = {
    ...fakeEngine(),
    ...(lanes ? { lanes } : {}),
    analyze: vi.fn(async (_img: ImageData, opts: { onVision?: (seen: FrameSignals) => void }) => {
      const raw = frameOf(n++)
      await new Promise<void>((done) => visions.push(done))
      opts.onVision?.({ ...raw, codeBands: [], nameBands: [] } as unknown as FrameSignals)
      return raw
    })
  } as unknown as FakeEngine
  return { engine, visions }
}

const run = (ms = 0): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

function mount(engine: FakeEngine): void {
  const video = document.createElement('video')
  renderHook(() =>
    useScanLoop({
      videoRef: { current: video },
      engineFactory: () => engine,
      game: 'ygo',
      running: true,
      setKey: 'any',
      setPrintings: null,
      defaultRarity: null,
      onDraft: vi.fn(() => 'row-1')
    })
  )
}

describe('scan loop text overlap', () => {
  beforeEach(() => {
    stubVideo()
    vi.useFakeTimers()
    window.api = createMockApi()
    order.resolved = []
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("matches the next frame's art while a frame's text is read, one frame ahead at most", async () => {
    const { engine, texts } = overlapEngine()
    mount(engine)
    await run(1000)
    // Frame 0's text is still being read: frame 1 went ahead, frame 2 waits for frame 0.
    expect(engine.analyze).toHaveBeenCalledTimes(2)
    expect(order.resolved).toEqual([])

    texts[0]()
    await run(1000)
    expect(order.resolved).toEqual([0])
    expect(engine.analyze).toHaveBeenCalledTimes(3)
  })

  it('finishes frames in the order they were grabbed', async () => {
    const { engine, texts } = overlapEngine()
    mount(engine)
    await run(1000)
    // The later frame's text is read first; it still waits for the earlier one.
    texts[1]()
    await run(0)
    expect(order.resolved).toEqual([])
    texts[0]()
    await run(0)
    expect(order.resolved).toEqual([0, 1])
  })

  it("waits for a frame's art before the next with one worker", async () => {
    const { engine, visions } = heldVisionEngine()
    mount(engine)
    await run(1000)
    expect(engine.analyze).toHaveBeenCalledTimes(1)
    visions[0]()
    await run(1000)
    expect(engine.analyze).toHaveBeenCalledTimes(2)
  })

  it("keeps two frames' art being matched with two workers, and no more", async () => {
    const { engine, visions } = heldVisionEngine(2)
    mount(engine)
    await run(1000)
    expect(engine.analyze).toHaveBeenCalledTimes(2)
    visions[0]()
    await run(1000)
    expect(engine.analyze).toHaveBeenCalledTimes(3)
    // The later frames answering first still finish in the order they were grabbed.
    visions[2]()
    visions[1]()
    await run(0)
    expect(order.resolved).toEqual([0, 1, 2])
  })
})
