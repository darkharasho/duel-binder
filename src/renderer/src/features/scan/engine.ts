import type { Api } from '@shared/ipc'
import type { RarityCues } from '@shared/scan/rarity'
import type { OcrBand, RgbaImage } from '@shared/scan/types'
import type { Quad } from './vision/detect'

export interface ArtMatch {
  imageId: number
  distance: number
}

/** What the vision worker sees in one frame. */
export interface FrameSignals {
  found: boolean
  /** The card's corners in frame pixels; null when no card was found. */
  quad: Quad | null
  /** Closest artworks, closest first; empty without fingerprints. */
  art: ArtMatch[]
  /**
   * Only when bands were asked for, and never empty ones. A card not known to be upright has
   * its bands both ways up.
   */
  codeBands: OcrBand[]
  nameBands: OcrBand[]
  /** What the card shows of its foil; null when it couldn't be turned upright to look. */
  cues: RarityCues | null
}

/** Messages to the vision worker. Frames are answered in the order they're sent. */
export type WorkerRequest =
  | { type: 'init'; fingerprints: ArrayBuffer | null }
  | {
      type: 'frame'
      id: number
      /** A camera frame as a bitmap (the worker reads and closes it), or raw pixels. */
      image: RgbaImage | ImageBitmap
      candidates: number[] | null
      wantBands: boolean
    }

/** Messages from it: `ready` answers `init`, and an error with no id is init's. */
export type WorkerReply =
  | { type: 'ready' }
  | { type: 'result'; id: number; signals: FrameSignals }
  | { type: 'error'; id: number | null; message: string }

/** A frame's signals with its bands read. */
export interface RawSignals {
  found: boolean
  /** The card's corners in frame pixels; null when no card was found. */
  quad: Quad | null
  art: ArtMatch[]
  codeTexts: string[]
  /** Every name band's read that isn't empty, in band order. */
  nameTexts: string[]
  cues: RarityCues | null
}

export interface ScanEngine {
  /** Loads OpenCV and the fingerprints (null: no art matching) in the worker, which takes fp's buffer. */
  init(fp: ArrayBuffer | null): Promise<void>
  /**
   * The frame is handed to the worker, so it can't be used afterwards. A camera frame is best
   * an ImageBitmap: the worker reads its pixels, so the UI thread never copies them.
   */
  analyze(
    frame: ImageBitmap | ImageData,
    opts: { candidates: number[] | null; wantText: boolean }
  ): Promise<RawSignals>
  /** Stops the worker and rejects pending calls; init and analyze reject afterwards. */
  dispose(): void
}

interface Waiter<T> {
  resolve(value: T): void
  reject(error: Error): void
}

/** The vision worker, bundled by Vite. */
export const makeVisionWorker = (): Worker =>
  new Worker(new URL('./vision/vision.worker.ts', import.meta.url), { type: 'module' })

const hasPixels = (b: OcrBand): boolean => b.width > 0 && b.height > 0

/**
 * Runs the vision worker over camera frames and reads the text bands it cuts out through
 * `api.ocr`, only when wantText. The worker starts on first use.
 */
export function createScanEngine(deps: { api: Api['scan']; makeWorker: () => Worker }): ScanEngine {
  let worker: Worker | null = null
  let disposed = false
  let nextId = 1
  const inits: Waiter<void>[] = []
  const frames = new Map<number, Waiter<FrameSignals>>()

  const failAll = (error: Error): void => {
    for (const w of inits.splice(0)) w.reject(error)
    for (const w of frames.values()) w.reject(error)
    frames.clear()
  }

  const start = (): Worker => {
    if (disposed) throw new Error('The scan engine was disposed')
    if (worker) return worker
    const w = deps.makeWorker()
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      const msg = e.data
      if (msg.type === 'ready') {
        inits.shift()?.resolve()
      } else if (msg.type === 'result') {
        frames.get(msg.id)?.resolve(msg.signals)
        frames.delete(msg.id)
      } else if (msg.id === null) {
        inits.shift()?.reject(new Error(msg.message))
      } else {
        frames.get(msg.id)?.reject(new Error(msg.message))
        frames.delete(msg.id)
      }
    }
    // A dead worker takes its pending frames with it; the next call starts a new one.
    w.onerror = (e) => {
      failAll(new Error(e.message || 'The scan worker failed'))
      w.terminate()
      if (worker === w) worker = null
    }
    w.onmessageerror = () => failAll(new Error('A scan worker reply could not be read'))
    worker = w
    return w
  }

  const send = (msg: WorkerRequest, transfer: Transferable[] = []): void =>
    start().postMessage(msg, transfer)

  return {
    init(fp) {
      return new Promise<void>((resolve, reject) => {
        try {
          // Handed over rather than copied: it's a few MB, and the caller reads a fresh one each time.
          send({ type: 'init', fingerprints: fp }, fp ? [fp] : [])
          inits.push({ resolve, reject })
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      })
    },

    async analyze(frame, { candidates, wantText }) {
      const id = nextId++
      const signals = await new Promise<FrameSignals>((resolve, reject) => {
        frames.set(id, { resolve, reject })
        const bitmap = !('data' in frame)
        const image: RgbaImage | ImageBitmap = bitmap
          ? frame
          : { width: frame.width, height: frame.height, data: frame.data }
        try {
          send({ type: 'frame', id, image, candidates, wantBands: wantText }, [
            bitmap ? frame : (frame.data.buffer as ArrayBuffer)
          ])
        } catch (e) {
          frames.delete(id)
          // Never handed over, so it's still ours to free.
          if (bitmap) frame.close()
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      })
      const { found, quad, art, cues } = signals
      if (!wantText || !found) return { found, quad, art, codeTexts: [], nameTexts: [], cues }
      const codeBands = signals.codeBands.filter(hasPixels)
      const nameBands = signals.nameBands.filter(hasPixels)
      const [codes, names] = await Promise.all([
        codeBands.length ? deps.api.ocr(codeBands, 'code') : [],
        nameBands.length ? deps.api.ocr(nameBands, 'name') : []
      ])
      return {
        found,
        quad,
        art,
        codeTexts: codes.map((t) => t.trim()).filter(Boolean),
        nameTexts: names.map((t) => t.trim()).filter(Boolean),
        cues
      }
    },

    dispose() {
      disposed = true
      worker?.terminate()
      worker = null
      failAll(new Error('The scan engine was disposed'))
    }
  }
}

/** The real engine: the vision worker, with the main process's scan lookups. */
export const defaultEngine = (): ScanEngine =>
  createScanEngine({ api: window.api.scan, makeWorker: makeVisionWorker })
