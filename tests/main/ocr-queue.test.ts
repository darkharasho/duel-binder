import { describe, expect, it, vi } from 'vitest'
import { createOcrQueue, toPgm, type OcrModel, type OcrWorker } from '../../src/shared/scan/ocr'
import type { OcrBand } from '../../src/shared/scan/types'

const band = (...px: number[]): OcrBand => ({
  width: px.length,
  height: 1,
  data: new Uint8Array(px)
})

function fake(recognize?: OcrWorker['recognize']) {
  const calls: Uint8Array[] = []
  const worker: OcrWorker = {
    recognize: vi.fn(
      recognize ??
        (async (img: Uint8Array) => {
          calls.push(img)
          return { data: { text: ` t${calls.length} `, confidence: 80 } }
        })
    ),
    setParameters: vi.fn(async () => ({})),
    terminate: vi.fn(async () => ({}))
  }
  const deads: (() => void)[] = []
  const start = vi.fn(async (_m: OcrModel, onDead: () => void) => {
    deads.push(onDead)
    return worker
  })
  return { worker, start, deads, calls }
}

describe('createOcrQueue', () => {
  it('reads run one at a time', async () => {
    let active = 0
    let maxActive = 0
    const order: number[] = []
    const f = fake(async (img) => {
      active++
      maxActive = Math.max(maxActive, active)
      order.push(img[img.length - 1])
      await new Promise((r) => setTimeout(r, 5))
      active--
      return { data: { text: 'x', confidence: 1 } }
    })
    const ocr = createOcrQueue({ start: f.start })
    await Promise.all([ocr.read([band(1)], 'code'), ocr.read([band(2)], 'code')])
    expect(maxActive).toBe(1)
    expect(order).toEqual([1, 2])
  })

  it('sets parameters only when the kind changes', async () => {
    const f = fake()
    const ocr = createOcrQueue({ start: f.start })
    await ocr.read([band(1)], 'code')
    await ocr.read([band(1)], 'code')
    await ocr.read([band(1)], 'name')
    expect(f.worker.setParameters).toHaveBeenCalledTimes(2)
    expect(vi.mocked(f.worker.setParameters).mock.calls[0][0]).toMatchObject({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'
    })
  })

  it('a read past timeoutMs rejects and the next read starts a fresh worker', async () => {
    const f = fake(() => new Promise(() => {}))
    const ocr = createOcrQueue({ start: f.start, timeoutMs: 20 })
    await expect(ocr.read([band(1)], 'code')).rejects.toThrow('OCR timed out')
    await expect(ocr.read([band(1)], 'code')).rejects.toThrow('OCR timed out')
    expect(f.start).toHaveBeenCalledTimes(2)
    expect(f.worker.terminate).toHaveBeenCalled()
  })

  it('onDead drops the worker', async () => {
    const f = fake()
    const ocr = createOcrQueue({ start: f.start })
    await ocr.read([band(1)], 'code')
    f.deads[0]()
    await ocr.read([band(1)], 'code')
    expect(f.start).toHaveBeenCalledTimes(2)
  })

  it("empty bands read as '' without recognizing", async () => {
    const f = fake()
    const ocr = createOcrQueue({ start: f.start })
    const out = await ocr.read([{ width: 0, height: 0, data: new Uint8Array(0) }], 'name')
    expect(out).toEqual([''])
    expect(f.worker.recognize).not.toHaveBeenCalled()
  })

  it('toPgm writes a P5 header then the pixels', () => {
    const bytes = toPgm(band(7, 9))
    const header = new TextEncoder().encode('P5\n2 1\n255\n')
    expect([...bytes]).toEqual([...header, 7, 9])
  })
})
