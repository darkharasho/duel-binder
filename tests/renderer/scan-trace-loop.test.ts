import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScanLoop } from '@/features/scan/useScanLoop'
import { setScanTraceOn } from '@/features/scan/scanTrace'
import { createMockApi } from './mockApi'
import { codeFrame, fakeEngine, NOTHING, printing, stubVideo, type FakeEngine } from './scanFakes'

const SESSION = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/

describe('scan trace in the scan loop', () => {
  beforeEach(() => {
    localStorage.clear()
    stubVideo()
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext(): { drawImage(): void } {
          return { drawImage: () => {} }
        }
        async convertToBlob(): Promise<Blob> {
          return new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' })
        }
      }
    )
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const run = (ms = 0): Promise<void> =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })

  function loop(engine: FakeEngine): void {
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
        onDraft: vi.fn()
      })
    )
  }

  it('traces each frame when the switch is on', async () => {
    setScanTraceOn(true)
    const printingsByCode = vi.fn(async () => [printing()])
    window.api = createMockApi({ scan: { printingsByCode } })
    loop(fakeEngine((n) => (n === 0 ? NOTHING : codeFrame('LOB-EN005'))))
    await run(1000)
    const trace = window.api.scan.trace as ReturnType<typeof vi.fn>
    expect(trace.mock.calls.length).toBeGreaterThanOrEqual(2)
    const sessions = new Set(trace.mock.calls.map((c) => c[0] as string))
    expect(sessions.size).toBe(1)
    expect([...sessions][0]).toMatch(SESSION)
    const lines = trace.mock.calls.map((c) => JSON.parse(c[1] as string) as Record<string, unknown>)
    expect(lines[0]).toMatchObject({ found: false, outcome: 'none', game: 'ygo' })
    // The loop reads text only once a card was seen, so a later frame is the one recognized.
    const seen = lines.find((x) => x['outcome'] === 'recognized')!
    expect(seen).toBeDefined()
    expect(seen['calls']).toEqual(
      expect.arrayContaining([expect.objectContaining({ m: 'printingsByCode' })])
    )
    // The first found frame changed the outcome, so its picture went with it.
    const first = trace.mock.calls.find((c) => JSON.parse(c[1] as string).found === true)!
    expect(first[2]).toBeInstanceOf(ArrayBuffer)
  })

  it('does nothing when the switch is off', async () => {
    window.api = createMockApi({ scan: { printingsByCode: vi.fn(async () => [printing()]) } })
    const lookupsSeen: unknown[] = []
    const realCode = window.api.scan.printingsByCode
    window.api.scan.printingsByCode = vi.fn(async function (this: unknown, code: string) {
      lookupsSeen.push(this)
      return realCode(code)
    }) as typeof realCode
    loop(fakeEngine(() => codeFrame('LOB-EN005')))
    await run(1000)
    expect(window.api.scan.trace).not.toHaveBeenCalled()
    expect(lookupsSeen.length).toBeGreaterThan(0)
    expect(lookupsSeen.every((t) => t === window.api.scan)).toBe(true)
  })

  it('keeps scanning when trace is refused', async () => {
    setScanTraceOn(true)
    window.api = createMockApi({
      scan: {
        printingsByCode: vi.fn(async () => [printing()]),
        trace: vi.fn(async () => {
          throw new Error('Not found')
        })
      }
    })
    const engine = fakeEngine(() => codeFrame('LOB-EN005'))
    loop(engine)
    await run(1000)
    const frames = engine.analyze.mock.calls.length
    await run(1000)
    expect(engine.analyze.mock.calls.length).toBeGreaterThan(frames)
    expect(window.api.scan.trace).toHaveBeenCalled()
  })
})
