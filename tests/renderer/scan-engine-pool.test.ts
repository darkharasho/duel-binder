import { describe, expect, it, vi } from 'vitest'
import { createEnginePool } from '@/features/scan/enginePool'
import type { ScanEngine } from '@/features/scan/engine'
import { NOTHING } from './scanFakes'

/** An engine whose frames are answered when the test says (answers[n]()). */
function heldEngine(): {
  engine: ScanEngine
  answers: (() => void)[]
  analyze: ReturnType<typeof vi.fn>
} {
  const answers: (() => void)[] = []
  const analyze = vi.fn(() => new Promise((done) => answers.push(() => done(NOTHING))))
  const engine = {
    init: vi.fn(async () => undefined),
    analyze,
    scope: vi.fn(),
    artDistance: vi.fn(async () => 3),
    tiltReading: vi.fn(async () => null),
    tiltReset: vi.fn(),
    dispose: vi.fn()
  } as unknown as ScanEngine
  return { engine, answers, analyze }
}

const frame = (): ImageData =>
  ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }) as ImageData
const live = { candidates: null, wantText: false }

describe('engine pool', () => {
  it('sends each frame to the engine with the fewest in hand', async () => {
    const a = heldEngine()
    const b = heldEngine()
    const pool = createEnginePool([a.engine, b.engine])
    expect(pool.lanes).toBe(2)
    const first = pool.analyze(frame(), live)
    void pool.analyze(frame(), live)
    expect(a.analyze).toHaveBeenCalledTimes(1)
    expect(b.analyze).toHaveBeenCalledTimes(1)
    a.answers[0]()
    await first
    void pool.analyze(frame(), live)
    expect(a.analyze).toHaveBeenCalledTimes(2)
  })

  it('keeps tilt frames and readings on the first engine', async () => {
    const a = heldEngine()
    const b = heldEngine()
    const pool = createEnginePool([a.engine, b.engine])
    void pool.analyze(frame(), live)
    void pool.analyze(frame(), { ...live, tilt: [1] })
    expect(a.analyze).toHaveBeenCalledTimes(2)
    expect(b.analyze).not.toHaveBeenCalled()
    await pool.tiltReading!('ygo', 5)
    pool.tiltReset!()
    expect(await pool.artDistance!(1, 2)).toBe(3)
    expect(a.engine.tiltReading).toHaveBeenCalledWith('ygo', 5)
    expect(a.engine.tiltReset).toHaveBeenCalled()
    expect(b.engine.tiltReading).not.toHaveBeenCalled()
  })

  it('gives every engine its own copy of the fingerprints, and scopes and disposes them all', async () => {
    const a = heldEngine()
    const b = heldEngine()
    const pool = createEnginePool([a.engine, b.engine])
    const fp = new Uint8Array([1, 2, 3]).buffer
    await pool.init(fp, [])
    const [fpA] = vi.mocked(a.engine.init).mock.calls[0]
    const [fpB] = vi.mocked(b.engine.init).mock.calls[0]
    expect(fpA).toBe(fp)
    expect(fpB).not.toBe(fp)
    expect([...new Uint8Array(fpB!)]).toEqual([1, 2, 3])
    pool.scope([7])
    expect(a.engine.scope).toHaveBeenCalledWith([7])
    expect(b.engine.scope).toHaveBeenCalledWith([7])
    pool.dispose()
    expect(a.engine.dispose).toHaveBeenCalled()
    expect(b.engine.dispose).toHaveBeenCalled()
  })
})
