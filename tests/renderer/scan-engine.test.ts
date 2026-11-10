import { describe, expect, it, vi } from 'vitest'
import { createScanEngine, type FrameSignals } from '@/features/scan/engine'
import { createMockApi } from './mockApi'
import type { OcrBand } from '@shared/scan/types'
import type { TiltReading } from '@shared/scan/tiltFeatures'

const band = (width: number): OcrBand => ({
  width,
  height: width ? 4 : 0,
  data: new Uint8Array(width * 4)
})

interface Posted {
  msg: {
    type: string
    wantBands?: boolean
    wantLook?: boolean
    tilt?: number[]
    at?: number
    game?: string
    now?: number
  }
  transfer?: Transferable[]
}

/** A stand-in for the vision worker that answers every frame with signals, and a tilt reading with two kept frames. */
function fakeWorker(signals: FrameSignals): { worker: Worker; posted: Posted[] } {
  const posted: Posted[] = []
  const worker = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    terminate: vi.fn(),
    postMessage(msg: { type: string; id?: number }, transfer?: Transferable[]) {
      posted.push({ msg, transfer })
      if (msg.type === 'tiltReset') return
      const reply =
        msg.type === 'init'
          ? { type: 'ready' }
          : msg.type === 'tiltReading'
            ? {
                type: 'tiltFrames',
                id: msg.id,
                frames: [new Uint8Array([1, 2]), new Uint8Array([3])]
              }
            : { type: 'result', id: msg.id, signals }
      queueMicrotask(() => worker.onmessage?.({ data: reply } as MessageEvent))
    }
  }
  return { worker: worker as unknown as Worker, posted }
}

interface TiltPosted {
  msg: { type: string; id: number; game: string; frames: Uint8Array[] }
  transfer?: Transferable[]
}

/** A stand-in for the tilt worker; answer returns its reply to a request, or null to stay silent. */
function fakeTiltWorker(answer: (m: TiltPosted['msg']) => object | null): {
  worker: Worker
  posted: TiltPosted[]
  make: () => Worker
} {
  const posted: TiltPosted[] = []
  const worker = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    terminate: vi.fn(),
    postMessage(msg: TiltPosted['msg'], transfer?: Transferable[]) {
      posted.push({ msg, transfer })
      const reply = answer(msg)
      if (reply) queueMicrotask(() => worker.onmessage?.({ data: reply } as MessageEvent))
    }
  } as unknown as Worker
  return { worker, posted, make: () => worker }
}

const NO_CARD: FrameSignals = {
  found: false,
  quad: null,
  art: [],
  codeBands: [],
  nameBands: [],
  textBands: [],
  cues: null,
  look: null
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

  it('tells onVision what the worker saw before the text is read', async () => {
    const api = createMockApi().scan
    const order: string[] = []
    vi.mocked(api.ocr).mockImplementation(async () => {
      order.push('ocr')
      return ['LOB-EN005']
    })
    const signals: FrameSignals = {
      ...NO_CARD,
      found: true,
      quad: [
        [1, 2],
        [30, 2],
        [30, 44],
        [1, 44]
      ],
      art: [{ imageId: 1, distance: 3 }],
      codeBands: [band(10)]
    }
    const { worker } = fakeWorker(signals)
    const engine = createScanEngine({ api, makeWorker: () => worker })
    await engine.init(null)
    const seen: FrameSignals[] = []
    const read = await engine.analyze(frame(), {
      candidates: null,
      wantText: true,
      onVision: (s) => {
        order.push('vision')
        seen.push(s)
      }
    })
    expect(order).toEqual(['vision', 'ocr'])
    expect(seen[0].quad).toEqual(signals.quad)
    expect(read.codeTexts).toEqual(['LOB-EN005'])
    engine.dispose()
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

  it('codesOnly reads the code bands and leaves the names unread', async () => {
    const api = createMockApi().scan
    vi.mocked(api.ocr).mockImplementation(async (bands) => bands.map(() => 'OP05-119SEC2'))
    const { worker, posted } = fakeWorker({
      found: true,
      quad: null,
      art: [],
      codeBands: [band(10), band(11)],
      nameBands: [band(7)],
      textBands: [],
      cues: null,
      look: null
    })
    const engine = createScanEngine({ api, makeWorker: () => worker, game: 'op' })
    await engine.init(null)
    const read = await engine.analyze(frame(), {
      candidates: null,
      wantText: true,
      codesOnly: true
    })
    expect(read.codeTexts).toEqual(['OP05-119SEC2', 'OP05-119SEC2'])
    expect(read.nameTexts).toEqual([])
    expect(api.ocr).toHaveBeenCalledTimes(1)
    expect(api.ocr).toHaveBeenCalledWith([band(10), band(11)], 'code')
    expect(posted[0].msg.game).toBe('op')
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

  it('hands on art found by the holder search, with text read or not', async () => {
    const api = createMockApi().scan
    vi.mocked(api.ocr).mockResolvedValue([])
    const { worker } = fakeWorker({
      found: true,
      quad: null,
      art: [{ imageId: 1, distance: 3 }],
      codeBands: [],
      nameBands: [],
      textBands: [],
      cues: null,
      artVia: 'holder',
      look: null
    })
    const engine = createScanEngine({ api, makeWorker: () => worker })
    await engine.init(null)
    for (const wantText of [false, true]) {
      const raw = await engine.analyze(frame(), { candidates: null, wantText })
      expect(raw.artVia).toBe('holder')
    }
  })

  it('a Pokémon engine reads its code bands as collector numbers', async () => {
    const api = createMockApi().scan
    vi.mocked(api.ocr).mockImplementation(async (bands, kind) =>
      bands.map(() => (kind === 'number' ? '045/193' : 'PIKACHU'))
    )
    const { worker } = fakeWorker({
      found: true,
      quad: null,
      art: [],
      codeBands: [band(10)],
      nameBands: [band(7)],
      textBands: [],
      cues: null,
      look: null
    })
    const engine = createScanEngine({ api, makeWorker: () => worker, game: 'pkm' })
    const read = await engine.analyze(frame(), { candidates: null, wantText: true })
    expect(read.codeTexts).toEqual(['045/193'])
    expect(read.nameTexts).toEqual(['PIKACHU'])
    expect(api.ocr).toHaveBeenCalledWith([band(10)], 'number')
    expect(api.ocr).toHaveBeenCalledWith([band(7)], 'name')
    // Kept for reading the printed name with the Japanese model if the text can't tell.
    expect(read.nameBands).toEqual([band(7)])
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

  it('a tilt reading runs on its own worker, not the vision worker', async () => {
    const reading: TiltReading = { features: [0.5, 1.5], frames: 20, motion: 6 }
    const { worker, posted } = fakeWorker(NO_CARD)
    const tilt = fakeTiltWorker((m) => ({ type: 'reading', id: m.id, reading }))
    const engine = createScanEngine({
      api: createMockApi().scan,
      makeWorker: () => worker,
      makeTiltWorker: tilt.make
    })
    await engine.init(null)
    await expect(engine.tiltReading!('pkm', 5000)).resolves.toEqual(reading)
    expect(tilt.posted).toHaveLength(1)
    expect(tilt.posted[0]!.msg).toMatchObject({ type: 'read', game: 'pkm' })
    expect(tilt.posted[0]!.msg.frames.map((f) => [...f])).toEqual([[1, 2], [3]])
    expect(tilt.posted[0]!.transfer).toHaveLength(2)
    // The window ends at the loop's now, not when the worker gets round to it.
    expect(posted.at(-1)!.msg).toEqual({
      type: 'tiltReading',
      id: expect.any(Number),
      game: 'pkm',
      now: 5000
    })
    engine.tiltReset!()
    expect(posted.at(-1)!.msg).toEqual({ type: 'tiltReset' })
  })

  it('a live frame is answered while a reading is still running', async () => {
    const { worker } = fakeWorker(NO_CARD)
    const tilt = fakeTiltWorker(() => null)
    const engine = createScanEngine({
      api: createMockApi().scan,
      makeWorker: () => worker,
      makeTiltWorker: tilt.make
    })
    await engine.init(null)
    const pending = engine.tiltReading!('ygo').catch(() => 'x')
    await Promise.resolve()
    await expect(
      engine.analyze(frame(), { candidates: null, wantText: false })
    ).resolves.toBeTruthy()
    engine.dispose()
    await pending
  })

  it('a tilt worker that fails rejects that reading and the next starts a fresh one', async () => {
    const { worker } = fakeWorker(NO_CARD)
    const made: ReturnType<typeof fakeTiltWorker>[] = []
    const engine = createScanEngine({
      api: createMockApi().scan,
      makeWorker: () => worker,
      makeTiltWorker: () => {
        const t = fakeTiltWorker(() => null)
        made.push(t)
        return t.make()
      }
    })
    await engine.init(null)
    const first = engine.tiltReading!('ygo')
    await new Promise((r) => setTimeout(r, 0))
    made[0]!.worker.onerror?.({ message: 'tilt boom' } as ErrorEvent)
    await expect(first).rejects.toThrow('tilt boom')
    expect(made[0]!.worker.terminate).toHaveBeenCalled()
    const second = engine.tiltReading!('ygo')
    await new Promise((r) => setTimeout(r, 0))
    expect(made).toHaveLength(2)
    made[1]!.worker.onmessage?.({
      data: { type: 'reading', id: made[1]!.posted[0]!.msg.id, reading: null }
    } as MessageEvent)
    await expect(second).resolves.toBeNull()
  })

  it('a hung tilt worker is thrown away alone: the reading fails and live frames still answer', async () => {
    const { worker } = fakeWorker(NO_CARD)
    const tilt = fakeTiltWorker(() => null)
    const engine = createScanEngine({
      api: createMockApi().scan,
      makeWorker: () => worker,
      makeTiltWorker: tilt.make,
      timeouts: { frameMs: 20 }
    })
    await engine.init(null)
    const pending = engine.tiltReading!('ygo')
    await expect(pending).rejects.toThrow('stopped answering')
    expect(tilt.posted).toHaveLength(1)
    expect(tilt.worker.terminate).toHaveBeenCalled()
    expect(worker.terminate).not.toHaveBeenCalled()
    await expect(
      engine.analyze(frame(), { candidates: null, wantText: false })
    ).resolves.toBeTruthy()
  })

  it('throwing the vision worker away on a frame timeout ends the tilt worker too', async () => {
    const { worker: vision } = fakeWorker(NO_CARD)
    // Answers init and tilt reading requests, but never a frame.
    const answer = vision.postMessage.bind(vision)
    vision.postMessage = ((msg: { type: string }, transfer?: Transferable[]): void => {
      if (msg.type !== 'frame') answer(msg, transfer as Transferable[])
    }) as Worker['postMessage']
    const tilt = fakeTiltWorker(() => null)
    const engine = createScanEngine({
      api: createMockApi().scan,
      makeWorker: () => vision,
      makeTiltWorker: tilt.make,
      timeouts: { frameMs: 50 }
    })
    await engine.init(null)
    const reading = engine.tiltReading!('ygo').catch((e: Error) => e)
    await new Promise((r) => setTimeout(r, 0))
    expect(tilt.posted).toHaveLength(1)
    await expect(engine.analyze(frame(), { candidates: null, wantText: false })).rejects.toThrow(
      'stopped answering'
    )
    expect(vision.terminate).toHaveBeenCalled()
    expect(tilt.worker.terminate).toHaveBeenCalled()
    expect(await reading).toBeInstanceOf(Error)
  })

  it('dispose ends the tilt worker too', async () => {
    const { worker } = fakeWorker(NO_CARD)
    const tilt = fakeTiltWorker(() => null)
    const engine = createScanEngine({
      api: createMockApi().scan,
      makeWorker: () => worker,
      makeTiltWorker: tilt.make
    })
    await engine.init(null)
    const pending = engine.tiltReading!('ygo').catch(() => 'x')
    await new Promise((r) => setTimeout(r, 0))
    engine.dispose()
    await pending
    expect(tilt.worker.terminate).toHaveBeenCalled()
  })

  it('a tilt reset starts no worker, and does nothing after dispose', () => {
    const makeWorker = vi.fn(() => fakeWorker(NO_CARD).worker)
    const engine = createScanEngine({ api: createMockApi().scan, makeWorker })
    engine.tiltReset!()
    expect(makeWorker).not.toHaveBeenCalled()
    engine.dispose()
    expect(() => engine.tiltReset!()).not.toThrow()
    expect(makeWorker).not.toHaveBeenCalled()
  })

  it('a tilt reading rejects when the worker dies', async () => {
    const silent = { postMessage: vi.fn(), terminate: vi.fn() } as unknown as Worker
    const engine = createScanEngine({ api: createMockApi().scan, makeWorker: () => silent })
    const pending = engine.tiltReading!('ygo')
    silent.onerror?.({ message: 'boom' } as ErrorEvent)
    await expect(pending).rejects.toThrow('boom')
    expect(silent.terminate).toHaveBeenCalled()
  })

  it('a tilt reading the worker failed rejects with its error', async () => {
    const worker = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      terminate: vi.fn(),
      postMessage(msg: { type: string; id?: number }) {
        if (msg.type !== 'tiltReading') return
        queueMicrotask(() =>
          worker.onmessage?.({
            data: { type: 'error', id: msg.id, message: 'bad frame' }
          } as MessageEvent)
        )
      }
    }
    const engine = createScanEngine({
      api: createMockApi().scan,
      makeWorker: () => worker as unknown as Worker
    })
    await expect(engine.tiltReading!('ygo')).rejects.toThrow('bad frame')
  })

  it('passes the tilt images with a frame, and when it was grabbed', async () => {
    const { worker, posted } = fakeWorker({ ...NO_CARD, tiltKept: true })
    const engine = createScanEngine({ api: createMockApi().scan, makeWorker: () => worker })
    await engine.init(null)
    const out = await engine.analyze(frame(), {
      candidates: [7],
      wantText: false,
      tilt: [7],
      at: 1234
    })
    expect(posted.at(-1)!.msg).toMatchObject({ type: 'frame', tilt: [7], at: 1234 })
    expect(out.tiltKept).toBe(true)
    // Left out, it's taken as the frame is handed over.
    await engine.analyze(frame(), { candidates: [7], wantText: false, tilt: [7] })
    expect(posted.at(-1)!.msg.at).toEqual(expect.any(Number))
    await engine.analyze(frame(), { candidates: null, wantText: false })
    expect(posted.at(-1)!.msg).not.toHaveProperty('tilt')
    expect(posted.at(-1)!.msg).not.toHaveProperty('at')
  })
})
