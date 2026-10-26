import { describe, expect, it, vi } from 'vitest'
import { createScanEngine, type FrameSignals } from '@/features/scan/engine'
import { createMockApi } from './mockApi'
import type { OcrBand } from '@shared/scan/types'

const band = (width: number): OcrBand => ({
  width,
  height: width ? 4 : 0,
  data: new Uint8Array(width * 4)
})

interface Posted {
  msg: { type: string; wantBands?: boolean }
  transfer?: Transferable[]
}

/** A stand-in for the vision worker that answers every frame with signals. */
function fakeWorker(signals: FrameSignals): { worker: Worker; posted: Posted[] } {
  const posted: Posted[] = []
  const worker = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    terminate: vi.fn(),
    postMessage(msg: { type: string; id?: number }, transfer?: Transferable[]) {
      posted.push({ msg, transfer })
      const reply =
        msg.type === 'init' ? { type: 'ready' } : { type: 'result', id: msg.id, signals }
      queueMicrotask(() => worker.onmessage?.({ data: reply } as MessageEvent))
    }
  }
  return { worker: worker as unknown as Worker, posted }
}

const frame = (): ImageData =>
  ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }) as unknown as ImageData

describe('createScanEngine', () => {
  it('reads text only when asked, skipping empty bands', async () => {
    const api = createMockApi().scan
    vi.mocked(api.ocr).mockResolvedValue(['LOB-EN005'])
    const quad = [
      [1, 2],
      [30, 2],
      [30, 44],
      [1, 44]
    ] as const
    const { worker, posted } = fakeWorker({
      found: true,
      quad,
      art: [{ imageId: 1, distance: 3 }],
      codeBands: [band(10), band(0)],
      nameBand: null,
      cues: { nameInk: 'dark', nameTint: null }
    })
    const engine = createScanEngine({ api, makeWorker: () => worker })
    await engine.init(null)

    const quiet = await engine.analyze(frame(), { candidates: null, wantText: false })
    expect(quiet).toEqual({
      found: true,
      quad,
      art: [{ imageId: 1, distance: 3 }],
      codeTexts: [],
      nameText: null,
      cues: { nameInk: 'dark', nameTint: null }
    })
    expect(api.ocr).not.toHaveBeenCalled()

    const read = await engine.analyze(frame(), { candidates: [1], wantText: true })
    expect(read.codeTexts).toEqual(['LOB-EN005'])
    expect(read.quad).toEqual(quad)
    expect(read.nameText).toBeNull()
    expect(read.cues).toEqual({ nameInk: 'dark', nameTint: null })
    expect(api.ocr).toHaveBeenCalledTimes(1)
    expect(api.ocr).toHaveBeenCalledWith([band(10)], 'code')

    const frames = posted.filter((p) => p.msg.type === 'frame')
    expect(frames.map((p) => p.msg.wantBands)).toEqual([false, true])
    expect(frames[0].transfer).toHaveLength(1)
    engine.dispose()
    expect(worker.terminate).toHaveBeenCalled()
  })

  it('hands a camera bitmap to the worker without copying it', async () => {
    const { worker, posted } = fakeWorker({
      found: false,
      quad: null,
      art: [],
      codeBands: [],
      nameBand: null,
      cues: null
    })
    const engine = createScanEngine({ api: createMockApi().scan, makeWorker: () => worker })
    const bitmap = { width: 810, height: 1080, close: vi.fn() } as unknown as ImageBitmap
    await engine.analyze(bitmap, { candidates: null, wantText: false })
    const [sent] = posted.filter((p) => p.msg.type === 'frame')
    expect((sent.msg as unknown as { image: unknown }).image).toBe(bitmap)
    expect(sent.transfer).toEqual([bitmap])
  })

  it('hands the fingerprints over rather than copying them', async () => {
    const { worker, posted } = fakeWorker({
      found: false,
      quad: null,
      art: [],
      codeBands: [],
      nameBand: null,
      cues: null
    })
    const engine = createScanEngine({ api: createMockApi().scan, makeWorker: () => worker })
    const fp = new ArrayBuffer(16)
    await engine.init(fp)
    expect(posted[0].transfer).toEqual([fp])
  })

  it('dispose rejects a pending frame, and later calls reject', async () => {
    const silent = { postMessage: vi.fn(), terminate: vi.fn() } as unknown as Worker
    const engine = createScanEngine({ api: createMockApi().scan, makeWorker: () => silent })
    const pending = engine.analyze(frame(), { candidates: null, wantText: false })
    engine.dispose()
    await expect(pending).rejects.toThrow('disposed')
    await expect(engine.init(null)).rejects.toThrow('disposed')
    await expect(engine.analyze(frame(), { candidates: null, wantText: false })).rejects.toThrow(
      'disposed'
    )
  })

  it("closes a camera bitmap it couldn't hand to the worker", async () => {
    const throwing = {
      postMessage: () => {
        throw new DOMException('no', 'DataCloneError')
      },
      terminate: vi.fn()
    } as unknown as Worker
    const engine = createScanEngine({ api: createMockApi().scan, makeWorker: () => throwing })
    const bitmap = { width: 8, height: 8, close: vi.fn() } as unknown as ImageBitmap
    await expect(engine.analyze(bitmap, { candidates: null, wantText: false })).rejects.toThrow()
    expect(bitmap.close).toHaveBeenCalled()

    engine.dispose()
    const late = { width: 8, height: 8, close: vi.fn() } as unknown as ImageBitmap
    await expect(engine.analyze(late, { candidates: null, wantText: false })).rejects.toThrow(
      'disposed'
    )
    expect(late.close).toHaveBeenCalled()
  })
})
