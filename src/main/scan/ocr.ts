import { existsSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import type { Worker as NodeWorker } from 'worker_threads'
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'
import type { OcrBand } from '@shared/scan/types'

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'

export interface Ocr {
  /** The text on each band, one line per band, in order. */
  read(bands: OcrBand[], kind: 'code' | 'name'): Promise<string[]>
  dispose(): Promise<void>
}

/**
 * The folder of the installed `@tesseract.js-data/eng` model, `best_int` when it ships one. Packaged,
 * it's the copy electron-builder unpacks next to the asar, since tesseract reads it from disk.
 */
export function engLangPath(packaged = false): string {
  const root = packaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@tesseract.js-data', 'eng')
    : dirname(createRequire(import.meta.url).resolve('@tesseract.js-data/eng/package.json'))
  const bestInt = join(root, '4.0.0_best_int')
  return existsSync(bestInt) ? bestInt : join(root, '4.0.0')
}

/** A grayscale band as a binary PGM, which Leptonica reads without any codec. */
function toPgm(band: OcrBand): Buffer {
  const header = Buffer.from(`P5\n${band.width} ${band.height}\n255\n`, 'ascii')
  return Buffer.concat([
    header,
    Buffer.from(band.data.buffer, band.data.byteOffset, band.width * band.height)
  ])
}

const MAX_BANDS = 8
const MAX_SIDE = 4096
const MAX_PIXELS = 4_000_000
const READ_TIMEOUT_MS = 10_000

/**
 * Throws unless bands is what the renderer may send: at most MAX_BANDS grayscale bands, each a
 * whole number of pixels on a side (0×0 for a band with no text) with one byte per pixel.
 */
export function checkOcrBands(bands: unknown): asserts bands is OcrBand[] {
  if (!Array.isArray(bands) || bands.length > MAX_BANDS)
    throw new Error(`OCR takes a list of at most ${MAX_BANDS} bands`)
  for (const b of bands as Partial<OcrBand>[]) {
    const { width, height, data } = b ?? {}
    const side = (n: unknown): n is number =>
      typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_SIDE
    if (
      !side(width) ||
      !side(height) ||
      width * height > MAX_PIXELS ||
      // Empty means both sides are 0.
      (width === 0) !== (height === 0)
    )
      throw new Error('OCR band size is out of range')
    if (!(data instanceof Uint8Array) || data.length !== width * height)
      throw new Error('OCR band data must be one byte per pixel')
  }
}

interface Slot {
  worker: Promise<Worker>
  /** The kind the worker's parameters are set for. */
  kind: 'code' | 'name' | null
}

/**
 * Local OCR for the Scan page, with one tesseract worker created on first use. Everything is read
 * from disk: the language data from langPath and the core from the installed `tesseract.js-core`.
 * A read that fails or takes longer than timeoutMs throws away the worker; the next read starts a
 * fresh one.
 */
export function createOcr(opts: { langPath?: string; timeoutMs?: number } = {}): Ocr {
  let current: Slot | null = null
  // One worker and its parameters are shared, so reads run one at a time.
  let queue: Promise<unknown> = Promise.resolve()
  let warned = false

  const drop = (slot: Slot): void => {
    if (current === slot) current = null
    slot.worker.then((w) => w.terminate()).catch(() => {})
  }

  const start = (): Slot => {
    const slot: Slot = { kind: null, worker: Promise.resolve(null as unknown as Worker) }
    slot.worker = createWorker('eng', OEM.LSTM_ONLY, {
      langPath: opts.langPath ?? engLangPath(),
      // Don't write a traineddata copy into the working directory.
      cacheMethod: 'none',
      gzip: true,
      // Without a handler, tesseract.js rethrows a failed job as an uncaught exception; the
      // job's promise rejects either way.
      errorHandler: (err: unknown) => {
        if (!warned) console.warn('OCR job failed:', err)
        warned = true
      }
    }).then((w) => {
      // The thread behind the worker; if it dies, start over on the next read.
      const thread = (w as unknown as { worker: NodeWorker }).worker
      thread.on('error', () => drop(slot))
      thread.on('exit', () => drop(slot))
      return w
    })
    slot.worker.catch(() => drop(slot))
    return slot
  }

  const run = async (slot: Slot, bands: OcrBand[], kind: 'code' | 'name'): Promise<string[]> => {
    const w = await slot.worker
    if (slot.kind !== kind) {
      await w.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        tessedit_char_whitelist: kind === 'code' ? CODE_CHARS : ''
      })
      slot.kind = kind
    }
    const out: string[] = []
    for (const band of bands) {
      if (!band.width || !band.height) {
        out.push('')
        continue
      }
      const { data } = await w.recognize(toPgm(band))
      out.push(data.text.trim())
    }
    return out
  }

  const readNow = (bands: OcrBand[], kind: 'code' | 'name'): Promise<string[]> => {
    const slot = (current ??= start())
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('OCR timed out')),
        opts.timeoutMs ?? READ_TIMEOUT_MS
      )
    })
    return Promise.race([run(slot, bands, kind), timeout])
      .catch((err: unknown) => {
        drop(slot)
        throw err
      })
      .finally(() => clearTimeout(timer))
  }

  return {
    read(bands, kind) {
      const result = queue.then(() => readNow(bands, kind))
      queue = result.catch(() => {})
      return result
    },
    async dispose() {
      const slot = current
      current = null
      if (slot) await slot.worker.then((w) => w.terminate()).catch(() => {})
    }
  }
}
