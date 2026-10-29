import type { OcrBand } from './types'

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'
/** A Pokémon collector number's ("PAL EN 045/193"): a set code's, and the slash before the set's total. */
const NUMBER_CHARS = CODE_CHARS + '/'

/**
 * What a band holds: a Yu-Gi-Oh set code, a Pokémon collector number or a card name, each read
 * as one line.
 */
export type OcrKind = 'code' | 'number' | 'name'

export const isOcrKind = (k: unknown): k is OcrKind =>
  k === 'code' || k === 'number' || k === 'name'

/** The tesseract models the app ships: English, and the scripts a card's language is told by. */
export type OcrModel = 'eng' | 'jpn' | 'kor' | 'chi_sim'

export interface Ocr {
  /** The text on each band, one line per band, in order. */
  read(bands: OcrBand[], kind: OcrKind): Promise<string[]>
  /** The block of text on one band, read with model, and tesseract's confidence in it (0-100). */
  readText(band: OcrBand, model: OcrModel): Promise<{ text: string; confidence: number }>
  dispose(): Promise<void>
}

/** The part of a tesseract worker the queue uses, so the queue needs no tesseract import. */
export interface OcrWorker {
  recognize(image: Uint8Array): Promise<{ data: { text: string; confidence: number } }>
  setParameters(p: Record<string, string>): Promise<unknown>
  terminate(): Promise<unknown>
}

/** A grayscale band as a binary PGM, which Leptonica reads without any codec. */
export function toPgm(band: OcrBand): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${band.width} ${band.height}\n255\n`)
  const out = new Uint8Array(header.length + band.width * band.height)
  out.set(header)
  out.set(band.data.subarray(0, band.width * band.height), header.length)
  return out
}

const MAX_BANDS = 8
const MAX_SIDE = 4096
const MAX_PIXELS = 4_000_000
const READ_TIMEOUT_MS = 10_000
/**
 * Starting a worker loads its model, which can take far longer than a read on a slow machine.
 * It gets its own budget: counted against the read's, a cold start would time out, be thrown
 * away and start over on every read.
 */
const START_TIMEOUT_MS = 60_000

/** p, or a rejection with message once ms pass. */
function within<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

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

type Kind = OcrKind | 'text'

const WHITELISTS: Record<Kind, string> = {
  code: CODE_CHARS,
  number: NUMBER_CHARS,
  name: '',
  text: ''
}

interface Slot {
  worker: Promise<OcrWorker>
  /** The kind the worker's parameters are set for. */
  kind: Kind | null
}

// tesseract's page segmentation modes: a single line, and a single block.
const PSM_LINE = '7'
const PSM_BLOCK = '6'

/**
 * The OCR queue, with one worker per model, each created on first use by opts.start. A worker
 * that takes longer than startTimeoutMs to start, a read that fails or takes longer than
 * timeoutMs (not counting the start), and start's onDead all throw the worker away; the next
 * read with that model starts a fresh one.
 */
export function createOcrQueue(opts: {
  start(model: OcrModel, onDead: () => void): Promise<OcrWorker>
  timeoutMs?: number
  startTimeoutMs?: number
}): Ocr {
  const slots = new Map<OcrModel, Slot>()
  // Reads run one at a time, so a worker's parameters stay put through a read.
  let queue: Promise<unknown> = Promise.resolve()

  const drop = (model: OcrModel, slot: Slot): void => {
    if (slots.get(model) === slot) slots.delete(model)
    slot.worker.then((w) => w.terminate()).catch(() => {})
  }

  const start = (model: OcrModel): Slot => {
    const slot: Slot = { kind: null, worker: Promise.resolve(null as unknown as OcrWorker) }
    slot.worker = opts.start(model, () => drop(model, slot))
    slot.worker.catch(() => drop(model, slot))
    slots.set(model, slot)
    return slot
  }

  const ready = async (slot: Slot, kind: Kind): Promise<OcrWorker> => {
    const w = await slot.worker
    if (slot.kind !== kind) {
      await w.setParameters({
        tessedit_pageseg_mode: kind === 'text' ? PSM_BLOCK : PSM_LINE,
        tessedit_char_whitelist: WHITELISTS[kind]
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
    const result = queue.then(async () => {
      const slot = slots.get(model) ?? start(model)
      try {
        await within(slot.worker, opts.startTimeoutMs ?? START_TIMEOUT_MS, 'OCR start timed out')
        return await within(job(slot), opts.timeoutMs ?? READ_TIMEOUT_MS, 'OCR timed out')
      } catch (err) {
        drop(model, slot)
        throw err
      }
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

/** The models a card's text is read with as it is (scan.readText): English, and Japanese for its kana. */
export type TextModel = 'eng' | 'jpn'

export const isTextModel = (m: unknown): m is TextModel => m === 'eng' || m === 'jpn'

/** Each band's block of text read with model, in order; '' for an empty band. */
export async function readTexts(ocr: Ocr, bands: OcrBand[], model: TextModel): Promise<string[]> {
  const out: string[] = []
  for (const band of bands) out.push((await ocr.readText(band, model)).text)
  return out
}
