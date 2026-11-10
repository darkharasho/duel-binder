import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_PHOTO_MS } from '@shared/scan/thresholds'
import type { FrameSignals, RawSignals } from '@/features/scan/engine'
import type { ScanOutcome } from '@/features/scan/resolve'
import { useScanLoop } from '@/features/scan/useScanLoop'
import { createMockApi } from './mockApi'
import { NOTHING, fakeEngine, printing, quad, stubVideo, type FakeEngine } from './scanFakes'

// A card held up the whole time is one card, however it came to be counted: by the photo taken
// for it when it stayed undecided, by the live frames, or both.

const state = vi.hoisted(() => ({ unsureUntil: 0, calls: 0 }))
vi.mock('@/features/scan/resolve', async (actual) => ({
  ...(await actual<typeof import('@/features/scan/resolve')>()),
  resolveSignals: vi.fn(async (): Promise<ScanOutcome> => {
    state.calls++
    if (performance.now() < state.unsureUntil) return { kind: 'unsure' }
    const p = printing()
    return {
      kind: 'recognized',
      item: {
        cardId: p.cardId,
        name: p.name,
        imageId: p.imageIds[0],
        printingId: p.printingId,
        setCode: p.setCode,
        rarity: p.rarity,
        options: [p],
        flag: null,
        via: 'art'
      }
    }
  })
}))

const held: RawSignals = {
  ...NOTHING,
  found: true,
  quad,
  art: [{ imageId: 46986414, distance: 10 }]
}

/** Answers vision at once and each live frame's text after textMs; photos at once. */
function slowTextEngine(textMs: number): FakeEngine {
  return {
    ...fakeEngine(),
    analyze: vi.fn(
      async (
        _img: ImageData,
        opts: { photo?: boolean; onVision?: (seen: FrameSignals) => void }
      ) => {
        opts.onVision?.({ ...held, codeBands: [], nameBands: [] } as unknown as FrameSignals)
        if (!opts.photo) await new Promise((done) => setTimeout(done, textMs))
        return held
      }
    )
  } as unknown as FakeEngine
}

const run = (ms: number): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

function mount(engine: FakeEngine): ReturnType<typeof vi.fn> {
  const onDraft = vi.fn(() => 'row-1')
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
      onDraft
    })
  )
  return onDraft
}

describe('a held card', () => {
  beforeEach(() => {
    stubVideo()
    vi.useFakeTimers()
    window.api = createMockApi()
    state.calls = 0
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each([0, 150, 350])(
    'counts once when the photo taken for it counts it (text read in %i ms)',
    async (textMs) => {
      // Undecided long enough for the photo, then named by every frame after.
      state.unsureUntil = performance.now() + AUTO_PHOTO_MS + 800
      const onDraft = mount(slowTextEngine(textMs))
      await run(AUTO_PHOTO_MS + 10_000)
      expect(state.calls).toBeGreaterThan(20)
      expect(onDraft).toHaveBeenCalledTimes(1)
    }
  )
})
