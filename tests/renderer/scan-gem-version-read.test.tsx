import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RawSignals } from '@/features/scan/engine'
import type { ScanDraft, ScanOutcome } from '@/features/scan/resolve'
import { useScanLoop } from '@/features/scan/useScanLoop'
import { createMockApi } from './mockApi'
import { NOTHING, fakeEngine, printing, quad, stubVideo } from './scanFakes'

// A Gem Pack card held up counts on its stand-in version, flagged to pick, when the frames that
// count it can't see its foil's pattern; a frame that names the version, while it's still held,
// settles the row it counted on rather than counting it again.

const version = (cardId: number, rarity: string) =>
  printing({
    printingId: cardId * 100,
    cardId,
    name: 'Furret',
    setName: 'Gem Pack Vol. 7',
    setCode: `CBB7C 080${cardId}`,
    rarity,
    language: 'zh-hans',
    imageIds: [cardId * 10]
  })
const options = [version(1, 'Holofoil'), version(2, 'Poke Ball Pattern')]
const gem = (cardId: number, flag: ScanDraft['flag']): ScanDraft => {
  const p = options.find((o) => o.cardId === cardId)!
  return {
    cardId,
    name: 'Furret',
    imageId: p.imageIds[0],
    printingId: p.printingId,
    setCode: p.setCode,
    rarity: p.rarity,
    options,
    flag,
    via: 'art',
    game: 'pkm'
  }
}

const state = vi.hoisted(() => ({ frames: [] as (ScanOutcome | null)[], n: 0 }))
vi.mock('@/features/scan/resolve', async (actual) => ({
  ...(await actual<typeof import('@/features/scan/resolve')>()),
  resolveSignals: vi.fn(async (): Promise<ScanOutcome> => {
    const next = state.frames[Math.min(state.n++, state.frames.length - 1)]
    return next ?? { kind: 'none' }
  })
}))

const held: RawSignals = { ...NOTHING, found: true, quad, art: [{ imageId: 10, distance: 10 }] }

function mount(): { onDraft: ReturnType<typeof vi.fn>; onRarityRead: ReturnType<typeof vi.fn> } {
  const onDraft = vi.fn(() => 'row-1')
  const onRarityRead = vi.fn()
  const engine = fakeEngine(() => held)
  renderHook(() =>
    useScanLoop({
      videoRef: { current: document.createElement('video') },
      engineFactory: () => engine,
      game: 'pkm',
      running: true,
      setKey: 'zh-hans|Gem Pack Vol. 7',
      setPrintings: null,
      defaultRarity: null,
      onDraft,
      onRarityRead
    })
  )
  return { onDraft, onRarityRead }
}

const run = (ms: number): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

const recognized = (d: ScanDraft): ScanOutcome => ({ kind: 'recognized', item: d })

describe('a Gem Pack version named after its card counted', () => {
  beforeEach(() => {
    stubVideo()
    vi.useFakeTimers()
    window.api = createMockApi()
    state.n = 0
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('settles the counted row on the version, counting nothing more', async () => {
    const standIn = recognized(gem(1, 'pick-printing'))
    state.frames = [standIn, standIn, standIn, recognized(gem(2, null))]
    const { onDraft, onRarityRead } = mount()
    await run(5000)
    expect(onDraft).toHaveBeenCalledTimes(1)
    expect(onDraft.mock.calls[0][0]).toMatchObject({ cardId: 1, flag: 'pick-printing' })
    expect(onRarityRead).toHaveBeenCalledTimes(1)
    expect(onRarityRead).toHaveBeenCalledWith(
      'row-1',
      expect.objectContaining({ cardId: 2, printingId: 200, flag: null })
    )
  })

  it('settles it on the stand-in itself when that is the version named', async () => {
    const standIn = recognized(gem(1, 'pick-printing'))
    state.frames = [standIn, standIn, recognized(gem(1, null))]
    const { onDraft, onRarityRead } = mount()
    await run(5000)
    expect(onDraft).toHaveBeenCalledTimes(1)
    expect(onRarityRead).toHaveBeenCalledWith(
      'row-1',
      expect.objectContaining({ cardId: 1, printingId: 100, flag: null })
    )
  })

  it("leaves the row be once the card has gone, the next card's version is its own", async () => {
    const standIn = recognized(gem(1, 'pick-printing'))
    state.frames = [standIn, standIn, ...Array(40).fill(null), recognized(gem(2, null))]
    const { onDraft, onRarityRead } = mount()
    await run(10_000)
    expect(onRarityRead).not.toHaveBeenCalled()
    expect(onDraft).toHaveBeenCalledTimes(2)
  })
})
