import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RawSignals } from '@/features/scan/engine'
import type { ScanDraft, ScanOutcome } from '@/features/scan/resolve'
import { useScanLoop } from '@/features/scan/useScanLoop'
import { createMockApi } from './mockApi'
import { NOTHING, fakeEngine, printing, quad, stubVideo } from './scanFakes'

// A card counted in a graded slab has its label read after the count, never holding it up: what
// the label says (grader, grade, cert) goes to onSlabRead for the row.

const p = printing({ printingId: 501, cardId: 7, name: 'Dragonite', setCode: 'FO 4/62' })
const draft = (slab: boolean): ScanDraft => ({
  cardId: 7,
  name: 'Dragonite',
  imageId: 46986414,
  printingId: 501,
  setCode: 'FO 4/62',
  rarity: 'Holofoil',
  options: [p],
  flag: null,
  via: 'art',
  game: 'pkm',
  ...(slab ? { slab: true as const } : {})
})

const state = vi.hoisted(() => ({ outcome: null as ScanOutcome | null }))
vi.mock('@/features/scan/resolve', async (actual) => ({
  ...(await actual<typeof import('@/features/scan/resolve')>()),
  resolveSignals: vi.fn(async (): Promise<ScanOutcome> => state.outcome ?? { kind: 'none' })
}))

const band = { width: 4, height: 2, data: new Uint8Array(8) }
const frame = (slab: boolean): RawSignals => ({
  ...NOTHING,
  found: true,
  quad,
  art: [{ imageId: 46986414, distance: 10 }],
  slab,
  ...(slab ? { slabBand: band } : {})
})

const run = (ms = 0): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

function mount(slab: boolean): {
  onDraft: ReturnType<typeof vi.fn>
  onSlabRead: ReturnType<typeof vi.fn>
  engine: ReturnType<typeof fakeEngine>
} {
  const onDraft = vi.fn(() => 'row-1')
  const onSlabRead = vi.fn()
  const video = document.createElement('video')
  const engine = fakeEngine(() => frame(slab))
  renderHook(() =>
    useScanLoop({
      videoRef: { current: video },
      engineFactory: () => engine,
      game: 'pkm',
      running: true,
      setKey: 'any',
      setPrintings: null,
      defaultRarity: null,
      onDraft,
      onSlabRead
    })
  )
  return { onDraft, onSlabRead, engine }
}

describe('reading a counted slab’s label', () => {
  beforeEach(() => {
    stubVideo()
    vi.useFakeTimers()
    window.api = createMockApi()
    vi.mocked(window.api.scan.readText).mockResolvedValue([
      '1999 POKEMON FOSSIL #4\nDRAGONITE-HOLO NM\n1ST EDITION 7\nPSA 12345678'
    ])
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reads the label once the slab is counted and hands what it says to the row', async () => {
    state.outcome = { kind: 'recognized', item: draft(true) }
    const { onDraft, onSlabRead } = mount(true)
    await run(5000)
    expect(onDraft).toHaveBeenCalledTimes(1)
    expect(window.api.scan.readText).toHaveBeenCalledWith([band], 'eng')
    expect(onSlabRead).toHaveBeenCalledTimes(1)
    expect(onSlabRead).toHaveBeenCalledWith('row-1', {
      company: 'PSA',
      grade: '7',
      cert: '12345678'
    })
  })

  it('asks live frames to cut the label out only now and then', async () => {
    state.outcome = { kind: 'none' }
    const { engine } = mount(true)
    await run(3000)
    const asks = engine.analyze.mock.calls.map(
      (c) => (c[1] as { wantSlabLabel?: boolean }).wantSlabLabel
    )
    const cuts = asks.filter(Boolean).length
    expect(asks.length).toBeGreaterThan(cuts)
    // One every 600 ms at most over the 3 s.
    expect(cuts).toBeGreaterThan(0)
    expect(cuts).toBeLessThanOrEqual(6)
  })

  it('reads nothing for a raw card', async () => {
    state.outcome = { kind: 'recognized', item: draft(false) }
    const { onDraft, onSlabRead } = mount(false)
    await run(5000)
    expect(onDraft).toHaveBeenCalledTimes(1)
    expect(window.api.scan.readText).not.toHaveBeenCalledWith([band], 'eng')
    expect(onSlabRead).not.toHaveBeenCalled()
  })

  it('says nothing when the label reads as nothing', async () => {
    vi.mocked(window.api.scan.readText).mockResolvedValue(['~~ ||'])
    state.outcome = { kind: 'recognized', item: draft(true) }
    const { onSlabRead } = mount(true)
    await run(5000)
    expect(onSlabRead).not.toHaveBeenCalled()
  })
})
