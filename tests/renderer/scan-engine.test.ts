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
  msg: { type: string; wantBands?: boolean; wantLook?: boolean }
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
  it('reads text only when asked, skipping empty bands, and passes the look on', async () => {
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
      nameBands: [],
      textBands: [],
      cues: { nameInk: 'dark', nameTint: null },
      look: [0.25, 0.5]
    })
    const engine = createScanEngine({ api, makeWorker: () => worker })
    await engine.init(null)

    const quiet = await engine.analyze(frame(), { candidates: null, wantText: false })
    expect(quiet).toEqual({
      found: true,
      quad,
      art: [{ imageId: 1, distance: 3 }],
      codeTexts: [],
      nameTexts: [],
      textBands: [],
      cues: { nameInk: 'dark', nameTint: null },
      look: [0.25, 0.5]
    })
    expect(api.ocr).not.toHaveBeenCalled()

    const read = await engine.analyze(frame(), { candidates: [1], wantText: true, wantLook: true })
    expect(read.codeTexts).toEqual(['LOB-EN005'])
    expect(read.quad).toEqual(quad)
    expect(read.nameTexts).toEqual([])
    expect(read.cues).toEqual({ nameInk: 'dark', nameTint: null })
    expect(read.look).toEqual([0.25, 0.5])
    expect(api.ocr).toHaveBeenCalledTimes(1)
    expect(api.ocr).toHaveBeenCalledWith([band(10)], 'code')

    const frames = posted.filter((p) => p.msg.type === 'frame')
    expect(frames.map((p) => p.msg.wantBands)).toEqual([false, true])
    // The look features are measured only when asked for: the phone scanner does, the desktop doesn't.
    expect(frames.map((p) => p.msg.wantLook)).toEqual([false, true])
    expect(frames[0].transfer).toHaveLength(1)
    engine.dispose()
    expect(worker.terminate).toHaveBeenCalled()
  })

  it('reads every name band, the card either way up when the worker sends both', async () => {
    const api = createMockApi().scan
    vi.mocked(api.ocr).mockImplementation(async (bands) =>
      bands.map((b) => (b.width === 7 ? 'DARK MAGICIAN' : b.width === 8 ? '' : 'NAIDIDVW'))
    )
    const { worker } = fakeWorker({
      found: true,
      quad: null,
      art: [],
      codeBands: [],
      nameBands: [band(7), band(0), band(8), band(9)],
      textBands: [],
      cues: null,
      look: null
    })
    const engine = createScanEngine({ api, makeWorker: () => worker })
    const read = await engine.analyze(frame(), { candidates: null, wantText: true })
    expect(read.nameTexts).toEqual(['DARK MAGICIAN', 'NAIDIDVW'])
    expect(api.ocr).toHaveBeenCalledWith([band(7), band(8), band(9)], 'name')
  })

  it('passes the text bands on unread, without the empty ones', async () => {
    const api = createMockApi().scan
    vi.mocked(api.ocr).mockResolvedValue([])
    const { worker } = fakeWorker({
      found: true,
      quad: null,
      art: [],
      codeBands: [],
      nameBands: [],
      textBands: [band(5), band(0)],
      cues: null,
      look: null
    })
    const engine = createScanEngine({ api, makeWorker: () => worker })
    const read = await engine.analyze(frame(), { candidates: null, wantText: true })
    expect(read.textBands).toEqual([band(5)])
    expect(api.ocr).not.toHaveBeenCalled()
    expect(api.language).not.toHaveBeenCalled()
  })

  it('hands a camera bitmap to the worker without copying it', async () => {
    const { worker, posted } = fakeWorker({
      found: false,
      quad: null,
      art: [],
      codeBands: [],
      nameBands: [],
      textBands: [],
      cues: null,
      look: null
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
      nameBands: [],
      textBands: [],
      cues: null,
      look: null
    })
    const engine = createScanEngine({ api: createMockApi().scan, makeWorker: () => worker })
    const fp = new ArrayBuffer(16)
    await engine.init(fp)
    expect(posted[0].transfer).toEqual([fp])
  })

  it('engine posts game in worker init', async () => {
    const none: FrameSignals = {
      found: false,
      quad: null,
      art: [],
      codeBands: [],
      nameBands: [],
      textBands: [],
      cues: null,
      look: null
    }
    const pkm = fakeWorker(none)
    await createScanEngine({
      api: createMockApi().scan,
      makeWorker: () => pkm.worker,
      game: 'pkm'
    }).init(null)
    expect(pkm.posted[0].msg).toMatchObject({ type: 'init', game: 'pkm' })
    // Left out, it's Yu-Gi-Oh, as before there were games.
    const ygo = fakeWorker(none)
    await createScanEngine({ api: createMockApi().scan, makeWorker: () => ygo.worker }).init(null)
    expect(ygo.posted[0].msg).toMatchObject({ type: 'init', game: 'ygo' })
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

  it('a worker that stops answering a frame is thrown away and the next call starts a new one', async () => {
    const silent = { postMessage: vi.fn(), terminate: vi.fn() } as unknown as Worker
    const { worker: live } = fakeWorker({
      found: false,
      quad: null,
      art: [],
      codeBands: [],
      nameBands: [],
      textBands: [],
      cues: null,
      look: null
    })
    const made = [silent, live]
    const engine = createScanEngine({
      api: createMockApi().scan,
      makeWorker: () => made.shift()!,
      timeouts: { frameMs: 20 }
    })
    await expect(engine.analyze(frame(), { candidates: null, wantText: false })).rejects.toThrow(
      'stopped answering'
    )
    expect(silent.terminate).toHaveBeenCalled()
    await engine.init(null)
    const next = await engine.analyze(frame(), { candidates: null, wantText: false })
    expect(next.found).toBe(false)
  })

  it('a hung init rejects instead of waiting forever', async () => {
    const silent = { postMessage: vi.fn(), terminate: vi.fn() } as unknown as Worker
    const engine = createScanEngine({
      api: createMockApi().scan,
      makeWorker: () => silent,
      timeouts: { initMs: 20 }
    })
    await expect(engine.init(null)).rejects.toThrow('stopped answering')
    expect(silent.terminate).toHaveBeenCalled()
  })

  it('a failed text read counts as nothing read and keeps the art', async () => {
    const api = createMockApi().scan
    vi.mocked(api.ocr).mockRejectedValue(new Error('OCR timed out'))
    const { worker } = fakeWorker({
      found: true,
      quad: null,
      art: [{ imageId: 1, distance: 3 }],
      codeBands: [band(10)],
      nameBands: [band(10)],
      textBands: [],
      cues: null,
      look: null
    })
    const engine = createScanEngine({ api, makeWorker: () => worker })
    await engine.init(null)
    const out = await engine.analyze(frame(), { candidates: null, wantText: true })
    expect(out).toMatchObject({ art: [{ imageId: 1, distance: 3 }], codeTexts: [], nameTexts: [] })
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
