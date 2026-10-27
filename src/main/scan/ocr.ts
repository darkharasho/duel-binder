import { existsSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import type { Worker as NodeWorker } from 'worker_threads'
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'
import type { OcrBand } from '@shared/scan/types'

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'

/** The tesseract models the app ships: English, and the scripts a card's language is told by. */
export type OcrModel = 'eng' | 'jpn' | 'kor' | 'chi_sim'

export interface Ocr {
  /** The text on each band, one line per band, in order. */
  read(bands: OcrBand[], kind: 'code' | 'name'): Promise<string[]>
  /** The block of text on one band, read with model, and tesseract's confidence in it (0-100). */
  readText(band: OcrBand, model: OcrModel): Promise<{ text: string; confidence: number }>
  dispose(): Promise<void>
}

/**
 * The folder of the installed `@tesseract.js-data/<model>` model, `best_int` when it ships one.
 * Packaged, it's the copy electron-builder unpacks next to the asar, since tesseract reads it from
 * disk.
 */
export function langPath(model: OcrModel, packaged = false): string {
  const root = packaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@tesseract.js-data', model)
    : dirname(createRequire(import.meta.url).resolve(`@tesseract.js-data/${model}/package.json`))
  const bestInt = join(root, '4.0.0_best_int')
  return existsSync(bestInt) ? bestInt : join(root, '4.0.0')
}

export const engLangPath = (packaged = false): string => langPath('eng', packaged)

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

type Kind = 'code' | 'name' | 'text'

interface Slot {
  worker: Promise<Worker>
  /** The kind the worker's parameters are set for. */
  kind: Kind | null
}

/**
 * Local OCR for the Scan page, with one tesseract worker per model, each created on first use.
 * Everything is read from disk: the language data from the installed `@tesseract.js-data` models
 * and the core from the installed `tesseract.js-core`. A read that fails or takes longer than
 * timeoutMs throws away its worker; the next read with that model starts a fresh one.
 */
export function createOcr(opts: { packaged?: boolean; timeoutMs?: number } = {}): Ocr {
  const slots = new Map<OcrModel, Slot>()
  // Reads run one at a time, so a worker's parameters stay put through a read.
  let queue: Promise<unknown> = Promise.resolve()
  let warned = false

  const drop = (model: OcrModel, slot: Slot): void => {
    if (slots.get(model) === slot) slots.delete(model)
    slot.worker.then((w) => w.terminate()).catch(() => {})
  }

  const start = (model: OcrModel): Slot => {
    const slot: Slot = { kind: null, worker: Promise.resolve(null as unknown as Worker) }
    slot.worker = createWorker(model, OEM.LSTM_ONLY, {
      langPath: langPath(model, opts.packaged),
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
      thread.on('error', () => drop(model, slot))
      thread.on('exit', () => drop(model, slot))
      return w
    })
    slot.worker.catch(() => drop(model, slot))
    slots.set(model, slot)
    return slot
  }

  const ready = async (slot: Slot, kind: Kind): Promise<Worker> => {
    const w = await slot.worker
    if (slot.kind !== kind) {
      await w.setParameters({
        tessedit_pageseg_mode: kind === 'text' ? PSM.SINGLE_BLOCK : PSM.SINGLE_LINE,
        tessedit_char_whitelist: kind === 'code' ? CODE_CHARS : ''
      })
      slot.kind = kind
    }
    return w
  }

  const readLines = async (slot: Slot, bands: OcrBand[], kind: Kind): Promise<string[]> => {
    const w = await ready(slot, kind)
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

  const readBlock = async (
    slot: Slot,
    band: OcrBand
  ): Promise<{ text: string; confidence: number }> => {
    if (!band.width || !band.height) return { text: '', confidence: 0 }
    const w = await ready(slot, 'text')
    const { data } = await w.recognize(toPgm(band))
    return { text: data.text.trim(), confidence: data.confidence }
  }

  /** job on model's worker, one at a time, throwing the worker away if it fails or stalls. */
  const queued = <T>(model: OcrModel, job: (slot: Slot) => Promise<T>): Promise<T> => {
    const result = queue.then(() => {
      const slot = slots.get(model) ?? start(model)
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('OCR timed out')),
          opts.timeoutMs ?? READ_TIMEOUT_MS
        )
      })
      return Promise.race([job(slot), timeout])
        .catch((err: unknown) => {
          drop(model, slot)
          throw err
        })
        .finally(() => clearTimeout(timer))
    })
    queue = result.catch(() => {})
    return result
  }

  return {
    read: (bands, kind) => queued('eng', (slot) => readLines(slot, bands, kind)),
    readText: (band, model) => queued(model, (slot) => readBlock(slot, band)),
    async dispose() {
      const all = [...slots.values()]
      slots.clear()
      await Promise.all(all.map((slot) => slot.worker.then((w) => w.terminate()).catch(() => {})))
    }
  }
}
