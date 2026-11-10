import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TiltModel } from '@shared/scan/tilt'
import type { TiltReading } from '@shared/scan/tiltFeatures'
import { TILT_READ_PAIRS } from '@shared/scan/tiltRead'
import { ABSENT_MS, TILT_MS, TILT_READ_MS } from '@shared/scan/thresholds'
import type { RawSignals } from '@/features/scan/engine'
import type { ScanDraft, ScanOutcome } from '@/features/scan/resolve'
import { useScanLoop, type ScanLoopOptions } from '@/features/scan/useScanLoop'
import { createMockApi } from './mockApi'
import { NOTHING, printing, quad, stubVideo, tiltEngine, type FakeEngine } from './scanFakes'

// Frames resolve to whatever card the test says is in view, so the loop's read is all that's tested.
const resolved = vi.hoisted(() => ({ draft: null as ScanDraft | null }))
vi.mock('@/features/scan/resolve', async (actual) => ({
  ...(await actual<typeof import('@/features/scan/resolve')>()),
  resolveSignals: vi.fn(async (raw: RawSignals): Promise<ScanOutcome> =>
    raw.found && resolved.draft ? { kind: 'recognized', item: resolved.draft } : { kind: 'none' }
  )
}))

// One feature: above 0 reads as Reverse Holofoil, below it as Normal.
const MODEL: TiltModel = {
  features: ['f'],
  classes: ['Normal', 'Reverse Holofoil'],
  pairs: [
    { a: 'Normal', b: 'Reverse Holofoil', use: [0], mean: [0], spread: [1], ca: [-1], cb: [1] }
  ]
}
const REVERSE: TiltReading = { features: [1], frames: 10, motion: 50 }
const STILL: TiltReading = { features: [1], frames: 10, motion: 0 }

const OPTIONS = [
  printing({ printingId: 501, cardId: 5, name: 'Pikachu', rarity: 'Normal', imageIds: [500] }),
  printing({
    printingId: 502,
    cardId: 5,
    name: 'Pikachu',
    rarity: 'Reverse Holofoil',
    imageIds: [500]
  })
]
const pikachu = (o: Partial<ScanDraft> = {}): ScanDraft => ({
  cardId: 5,
  name: 'Pikachu',
  imageId: 500,
  printingId: 501,
  setCode: 'PAL 045/193',
  rarity: 'Normal',
  options: OPTIONS,
  flag: 'pick-printing',
  via: 'art',
  game: 'pkm',
  ...o
})

const held = (q: RawSignals['quad'] = quad): RawSignals => ({
  ...NOTHING,
  found: true,
  quad: q,
  art: [{ imageId: 500, distance: 10 }]
})
const shifted = quad.map(([x, y]) => [x + 300, y]) as unknown as RawSignals['quad']

/** A reading the test answers when it likes. */
function deferred(): { promise: Promise<TiltReading>; resolve: (r: TiltReading) => void } {
  let resolve: (r: TiltReading) => void = () => {}
  const promise = new Promise<TiltReading>((r) => (resolve = r))
  return { promise, resolve }
}

const run = (ms = 0): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

type Props = Pick<ScanLoopOptions, 'defaultRarity' | 'setKey'> & { running?: boolean }

function mount(
  engine: FakeEngine,
  onDraft: ScanLoopOptions['onDraft'] = vi.fn((): string => 'row-1'),
  onRarityRead = vi.fn()
): {
  onDraft: ScanLoopOptions['onDraft']
  onRarityRead: ReturnType<typeof vi.fn>
  rerender: (p: Props) => void
} {
  const video = document.createElement('video')
  const { rerender } = renderHook(
    ({ defaultRarity, setKey, running = true }: Props) =>
      useScanLoop({
        videoRef: { current: video },
        engineFactory: () => engine,
        game: 'pkm',
        running,
        setKey,
        setPrintings: null,
        defaultRarity,
        tiltModels: { pkm: MODEL },
        onDraft,
        onRarityRead
      }),
    { initialProps: { defaultRarity: null, setKey: 'any' } as Props }
  )
  return { onDraft, onRarityRead, rerender }
}

const tilts = (engine: FakeEngine): unknown[] =>
  engine.analyze.mock.calls.map(([, o]) => (o as { tilt?: unknown }).tilt).filter(Boolean)

describe('background rarity read', () => {
  beforeEach(() => {
    stubVideo()
    vi.useFakeTimers()
    window.api = createMockApi()
    resolved.draft = pikachu()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('the read is over the pair the brief names', () => {
    expect(TILT_READ_PAIRS.pkm).toContainEqual(['Normal', 'Reverse Holofoil'])
  })

  it('counts on the first recognized frame and updates the row once from a usable reading', async () => {
    const engine = tiltEngine(
      () => held(),
      () => REVERSE
    )
    const { onDraft, onRarityRead } = mount(engine)
    await run(1000)
    expect(onDraft).toHaveBeenCalledTimes(1)
    expect(onRarityRead).not.toHaveBeenCalled()
    // Read frames are kept for the card's art, stamped when grabbed.
    expect(engine.analyze.mock.calls.find(([, o]) => o.tilt)?.[1]).toMatchObject({
      tilt: [500],
      at: expect.any(Number)
    })
    await run(TILT_MS + 400)
    expect(onRarityRead).toHaveBeenCalledTimes(1)
    expect(onRarityRead).toHaveBeenCalledWith(
      'row-1',
      expect.objectContaining({
        printingId: 502,
        rarity: 'Reverse Holofoil',
        // A guess never changes the flag: the version still wants picking.
        flag: 'pick-printing'
      })
    )
    await run(3000)
    expect(onRarityRead).toHaveBeenCalledTimes(1)
    expect(onDraft).toHaveBeenCalledTimes(1)
    expect(engine.tiltReading).toHaveBeenCalledTimes(1)
  })

  it('passes tilt only while a read is on', async () => {
    resolved.draft = pikachu({ flag: null })
    const engine = tiltEngine(
      () => held(),
      () => REVERSE
    )
    const { onDraft, onRarityRead } = mount(engine)
    await run(TILT_READ_MS)
    expect(onDraft).toHaveBeenCalledTimes(1)
    // Every frame's options are exactly as without a read.
    expect(engine.analyze.mock.calls.length).toBeGreaterThan(5)
    for (const [, o] of engine.analyze.mock.calls)
      expect(Object.keys(o).sort()).toEqual(['candidates', 'onVision', 'wantLook', 'wantText'])
    expect(engine.tiltReading).not.toHaveBeenCalled()
    expect(engine.tiltReset).not.toHaveBeenCalled()
    expect(onRarityRead).not.toHaveBeenCalled()
  })

  it('a row with no id is never read', async () => {
    const engine = tiltEngine(
      () => held(),
      () => REVERSE
    )
    const { onDraft, onRarityRead } = mount(engine, vi.fn())
    await run(TILT_MS + 1500)
    expect(onDraft).toHaveBeenCalledTimes(1)
    expect(tilts(engine)).toEqual([])
    expect(engine.tiltReading).not.toHaveBeenCalled()
    expect(onRarityRead).not.toHaveBeenCalled()
  })

  it('a second copy counted ends the first read before its own', async () => {
    let inView = true
    const events: string[] = []
    const engine = tiltEngine(
      () => (inView ? held() : NOTHING),
      () => REVERSE
    )
    const first = deferred()
    vi.mocked(engine.tiltReading!)
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async () => REVERSE)
    vi.mocked(engine.tiltReset!).mockImplementation(() => void events.push('reset'))
    let rows = 0
    const { onDraft, onRarityRead } = mount(
      engine,
      vi.fn((): string => {
        events.push('count')
        return `row-${++rows}`
      })
    )
    await run(1000)
    await run(TILT_MS + 200)
    expect(engine.tiltReading).toHaveBeenCalledTimes(1)
    inView = false
    await run(ABSENT_MS + 400)
    inView = true
    await run(1000)
    expect(onDraft).toHaveBeenCalledTimes(2)
    expect(events.slice(0, 3)).toEqual(['count', 'reset', 'count'])
    // Row 1's reading, still out when its read ended, applies to nothing.
    await act(async () => first.resolve(REVERSE))
    expect(onRarityRead).not.toHaveBeenCalled()
    await run(TILT_MS + 400)
    expect(onRarityRead).toHaveBeenCalledTimes(1)
    expect(onRarityRead).toHaveBeenCalledWith('row-2', expect.objectContaining({ printingId: 502 }))
  })

  it('an outline that jumps ends the read', async () => {
    let moved = false
    const engine = tiltEngine(
      () => held(moved ? shifted : quad),
      () => REVERSE
    )
    const { onDraft, onRarityRead } = mount(engine)
    await run(1000)
    expect(onDraft).toHaveBeenCalledTimes(1)
    moved = true
    await run(TILT_MS + 1000)
    expect(onRarityRead).not.toHaveBeenCalled()
    expect(engine.tiltReading).not.toHaveBeenCalled()
    expect(engine.tiltReset).toHaveBeenCalled()
  })

  it('another card in view ends the read', async () => {
    let other = false
    const engine = tiltEngine(
      () => (other ? { ...held(), art: [{ imageId: 777, distance: 10 }] } : held()),
      () => REVERSE
    )
    const { onRarityRead } = mount(engine)
    await run(1000)
    other = true
    await run(TILT_MS + 1000)
    expect(onRarityRead).not.toHaveBeenCalled()
    expect(engine.tiltReading).not.toHaveBeenCalled()
  })

  it('a card held still past TILT_READ_MS changes nothing and stops asking', async () => {
    const engine = tiltEngine(
      () => held(),
      () => STILL
    )
    const { onRarityRead } = mount(engine)
    await run(1000 + TILT_READ_MS + 400)
    expect(onRarityRead).not.toHaveBeenCalled()
    const asks = vi.mocked(engine.tiltReading!).mock.calls.length
    expect(asks).toBeGreaterThanOrEqual(2)
    const frames = engine.analyze.mock.calls.length
    await run(3000)
    expect(vi.mocked(engine.tiltReading!).mock.calls.length).toBe(asks)
    const later = engine.analyze.mock.calls.slice(frames)
    expect(later.length).toBeGreaterThan(5)
    expect(later.every(([, o]) => !('tilt' in o))).toBe(true)
    expect(onRarityRead).not.toHaveBeenCalled()
  })

  it('a failed reading ends the read with nothing applied', async () => {
    const engine = tiltEngine(
      () => held(),
      () => new Error('worker gone')
    )
    const { onRarityRead } = mount(engine)
    await run(1000 + TILT_MS + 1500)
    expect(engine.tiltReading).toHaveBeenCalledTimes(1)
    expect(engine.tiltReset).toHaveBeenCalled()
    expect(onRarityRead).not.toHaveBeenCalled()
  })

  it('a change of set or default rarity mid-read applies nothing', async () => {
    for (const change of [
      { defaultRarity: 'Normal', setKey: 'any' },
      { defaultRarity: null, setKey: 'PAL' }
    ] as Props[]) {
      const engine = tiltEngine(
        () => held(),
        () => REVERSE
      )
      const out = deferred()
      vi.mocked(engine.tiltReading!).mockImplementation(() => out.promise)
      const { onRarityRead, rerender } = mount(engine)
      await run(1000 + TILT_MS + 200)
      expect(engine.tiltReading).toHaveBeenCalledTimes(1)
      rerender(change)
      await run()
      await act(async () => out.resolve(REVERSE))
      await run(1000)
      expect(onRarityRead).not.toHaveBeenCalled()
      expect(engine.tiltReset).toHaveBeenCalled()
    }
  })

  it('a pick equal to the counted printing calls nothing', async () => {
    resolved.draft = pikachu({ printingId: 502, rarity: 'Reverse Holofoil' })
    const engine = tiltEngine(
      () => held(),
      () => REVERSE
    )
    const { onRarityRead } = mount(engine)
    await run(1000 + TILT_MS + 1500)
    expect(engine.tiltReading).toHaveBeenCalledTimes(1)
    expect(onRarityRead).not.toHaveBeenCalled()
  })

  it('pausing mid-read applies nothing and forgets the kept frames', async () => {
    const engine = tiltEngine(
      () => held(),
      () => REVERSE
    )
    const out = deferred()
    vi.mocked(engine.tiltReading!).mockImplementation(() => out.promise)
    const { onRarityRead, rerender } = mount(engine)
    await run(1000 + TILT_MS + 200)
    expect(engine.tiltReading).toHaveBeenCalledTimes(1)
    rerender({ defaultRarity: null, setKey: 'any', running: false })
    await run()
    expect(engine.tiltReset).toHaveBeenCalled()
    await act(async () => out.resolve(REVERSE))
    await run(1000)
    expect(onRarityRead).not.toHaveBeenCalled()
  })

  it('a card lowered for ABSENT_MS ends its read with nothing applied, and asks stop', async () => {
    let inView = true
    const engine = tiltEngine(
      () => (inView ? held() : NOTHING),
      () => STILL
    )
    const { onDraft, onRarityRead } = mount(engine)
    await run(1000 + TILT_MS + 200)
    expect(engine.tiltReading).toHaveBeenCalled()
    inView = false
    await run(ABSENT_MS + 400)
    expect(engine.tiltReset).toHaveBeenCalled()
    const asks = vi.mocked(engine.tiltReading!).mock.calls.length
    const frames = engine.analyze.mock.calls.length
    await run(2000)
    expect(vi.mocked(engine.tiltReading!).mock.calls.length).toBe(asks)
    expect(engine.analyze.mock.calls.slice(frames).every(([, o]) => !('tilt' in o))).toBe(true)
    expect(onDraft).toHaveBeenCalledTimes(1)
    expect(onRarityRead).not.toHaveBeenCalled()
  })

  it('an onRarityRead that throws ends the read quietly, and later cards still count', async () => {
    const rejections: unknown[] = []
    const onRejection = (e: unknown): void => void rejections.push(e)
    process.on('unhandledRejection', onRejection)
    try {
      let inView = true
      const engine = tiltEngine(
        () => (inView ? held() : NOTHING),
        () => REVERSE
      )
      const onRarityRead = vi.fn(() => {
        throw new Error('row gone')
      })
      let rows = 0
      const { onDraft } = mount(
        engine,
        vi.fn((): string => `row-${++rows}`),
        onRarityRead
      )
      await run(1000 + TILT_MS + 400)
      expect(onRarityRead).toHaveBeenCalledTimes(1)
      expect(engine.tiltReset).toHaveBeenCalled()
      inView = false
      await run(ABSENT_MS + 400)
      resolved.draft = pikachu({ cardId: 6, name: 'Raichu', imageId: 600 })
      inView = true
      await run(1000)
      expect(onDraft).toHaveBeenCalledTimes(2)
      // Let any stray rejection surface before looking.
      await run(200)
      expect(rejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })
})
