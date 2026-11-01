import type { GameId } from '@shared/games/types'
import type { Api } from '@shared/ipc'
import type { RarityCues } from '@shared/scan/rarity'
import type { VersionCues } from './vision/pokemonVersion'
import type { OcrKind } from '@shared/scan/ocr'
import type { ArtMatch } from '@shared/scan/fingerprintFile'
import type { ScanRef } from '@shared/scan/fingerprintRefs'
import type { OcrBand, RgbaImage } from '@shared/scan/types'
import type { Quad } from './vision/detect'

export type { ArtMatch } from '@shared/scan/fingerprintFile'

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
  /** The card's effect or flavour text as a block, for telling its language; only when it's upright. */
  textBands: OcrBand[]
  /** What the card shows of its foil; null when it couldn't be turned upright to look. */
  cues: RarityCues | null
  /** A Pokémon card's foil cues for its version; null for other games or a card not turned upright. */
  version?: VersionCues | null
  /** Pokémon only: the card is in a graded slab (its label block shows above it). */
  slab?: boolean
  /**
   * 'holder' when the art matched only on the second look of a profile's holderSearch, which
   * must then clear the art margin against every other name (resolvePokemon).
   */
  artVia?: 'holder'
  /**
   * The card's look for the rarity look model (rarityFeatures, LOOK_FEATURES order): only when
   * asked for (wantLook) and the card was turned upright, else null.
   */
  look: number[] | null
}

/** Messages to the vision worker. Frames are answered in the order they're sent. */
export type WorkerRequest =
  | { type: 'init'; fingerprints: ArrayBuffer | null; game: GameId; refs?: ScanRef[] }
  | {
      type: 'frame'
      id: number
      /** A camera frame as a bitmap (the worker reads and closes it), or raw pixels. */
      image: RgbaImage | ImageBitmap
      candidates: number[] | null
      wantBands: boolean
      /** Measure the card's look for the rarity look model too (about 3.7 ms more a frame). */
      wantLook: boolean
      /** A photo: every language's art, the whole holder search, and bands whatever wantBands says. */
      photo?: true
    }
  /** Narrows live frames' art search to these artworks, or null for all of it, until told again. */
  | { type: 'scope'; imageIds: number[] | null }

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
  /** The text bands, unread: reading them is slow, so it's left until a card's language is needed. */
  textBands: OcrBand[]
  /** A Pokémon card's name bands, for reading its printed name with another model if need be. */
  nameBands?: OcrBand[]
  cues: RarityCues | null
  version?: VersionCues | null
  slab?: boolean
  /** As FrameSignals.artVia. */
  artVia?: 'holder'
  look: number[] | null
}

export interface ScanEngine {
  /**
   * Loads OpenCV and the fingerprints (null: no art matching) in the worker, which takes fp's
   * buffer, with the printings of their reference scans when known (see fingerprintRefs.ts).
   */
  init(fp: ArrayBuffer | null, refs?: ScanRef[]): Promise<void>
  /**
   * The frame is handed to the worker, so it can't be used afterwards. A camera frame is best
   * an ImageBitmap: the worker reads its pixels, so the UI thread never copies them. `wantLook`
   * measures the card's look for the rarity look model as well.
   */
  analyze(
    frame: ImageBitmap | ImageData,
    opts: { candidates: number[] | null; wantText: boolean; wantLook?: boolean; photo?: boolean }
  ): Promise<RawSignals>
  /** Live frames match only these artworks from now on; null for every one. */
  scope(imageIds: number[] | null): void
  /** Stops the worker and rejects pending calls; init and analyze reject afterwards. */
  dispose(): void
}

interface Waiter<T> {
  resolve(value: T): void
  reject(error: Error): void
}

/**
 * How long the worker may take to answer before it's taken as hung: loading OpenCV and the
 * fingerprints, and one frame. A hung worker is thrown away like a crashed one, so the scan
 * loop's retry starts a fresh one instead of waiting forever.
 */
const INIT_TIMEOUT_MS = 45_000
const FRAME_TIMEOUT_MS = 10_000
/** A photo gets the whole holder search, which a slow phone may spend this long on. */
const PHOTO_TIMEOUT_MS = 30_000

/** The vision worker, bundled by Vite. */
export const makeVisionWorker = (): Worker =>
  new Worker(new URL('./vision/vision.worker.ts', import.meta.url), { type: 'module' })

const hasPixels = (b: OcrBand): boolean => b.width > 0 && b.height > 0

/**
 * Runs the vision worker over camera frames and reads the text bands it cuts out through
 * `api.ocr`, only when wantText. The worker starts on first use, reading cards of game
 * (Yu-Gi-Oh when left out).
 */
export function createScanEngine(deps: {
  api: Api['scan']
  makeWorker: () => Worker
  game?: GameId
  timeouts?: { initMs?: number; frameMs?: number }
}): ScanEngine {
  let worker: Worker | null = null
  let disposed = false
  let nextId = 1
  const inits: Waiter<void>[] = []
  const frames = new Map<number, Waiter<FrameSignals>>()
  const initMs = deps.timeouts?.initMs ?? INIT_TIMEOUT_MS
  const frameMs = deps.timeouts?.frameMs ?? FRAME_TIMEOUT_MS

  const failAll = (error: Error): void => {
    for (const w of inits.splice(0)) w.reject(error)
    for (const w of frames.values()) w.reject(error)
    frames.clear()
  }

  /** Throws the worker away with everything it owes; the next call starts a new one. */
  const kill = (w: Worker, error: Error): void => {
    failAll(error)
    w.terminate()
    if (worker === w) worker = null
  }

  /** waiter, settled as a hang (killing the worker) unless it's answered within ms. */
  const watched = <T>(waiter: Waiter<T>, ms: number): Waiter<T> => {
    const w = worker
    const timer = setTimeout(() => {
      if (w && worker === w) kill(w, new Error('The scan worker stopped answering'))
    }, ms)
    return {
      resolve: (v) => {
        clearTimeout(timer)
        waiter.resolve(v)
      },
      reject: (e) => {
        clearTimeout(timer)
        waiter.reject(e)
      }
    }
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
    w.onerror = (e) => kill(w, new Error(e.message || 'The scan worker failed'))
    w.onmessageerror = () => failAll(new Error('A scan worker reply could not be read'))
    worker = w
    return w
  }

  const send = (msg: WorkerRequest, transfer: Transferable[] = []): void =>
    start().postMessage(msg, transfer)

  return {
    init(fp, refs) {
      return new Promise<void>((resolve, reject) => {
        try {
          // Handed over rather than copied: it's a few MB, and the caller reads a fresh one each time.
          send({ type: 'init', fingerprints: fp, game: deps.game ?? 'ygo', refs }, fp ? [fp] : [])
          inits.push(watched({ resolve, reject }, initMs))
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      })
    },

    scope(imageIds) {
      send({ type: 'scope', imageIds })
    },

    async analyze(frame, { candidates, wantText, wantLook = false, photo = false }) {
      const id = nextId++
      const signals = await new Promise<FrameSignals>((resolve, reject) => {
        const bitmap = !('data' in frame)
        const image: RgbaImage | ImageBitmap = bitmap
          ? frame
          : { width: frame.width, height: frame.height, data: frame.data }
        try {
          send(
            {
              type: 'frame',
              id,
              image,
              candidates,
              wantBands: wantText,
              wantLook,
              ...(photo ? { photo: true as const } : {})
            },
            [bitmap ? frame : (frame.data.buffer as ArrayBuffer)]
          )
          frames.set(
            id,
            watched({ resolve, reject }, photo ? Math.max(frameMs, PHOTO_TIMEOUT_MS) : frameMs)
          )
        } catch (e) {
          frames.delete(id)
          // Never handed over, so it's still ours to free.
          if (bitmap) frame.close()
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      })
      const { found, quad, art, cues, version, slab, look } = signals
      // Only when set, so a Yu-Gi-Oh frame's signals are as they were.
      const via = signals.artVia ? { artVia: signals.artVia } : {}
      if (!wantText || !found)
        return {
          found,
          quad,
          art,
          codeTexts: [],
          nameTexts: [],
          textBands: [],
          cues,
          version,
          slab,
          ...via,
          look
        }
      const codeBands = signals.codeBands.filter(hasPixels)
      const nameBands = signals.nameBands.filter(hasPixels)
      // Text is a helper to the art: a failed or timed-out read counts as nothing read, so OCR
      // trouble never stops art matching.
      const read = (bands: OcrBand[], kind: OcrKind): Promise<string[]> =>
        bands.length ? deps.api.ocr(bands, kind).catch(() => []) : Promise.resolve([])
      // A Pokémon card's code band holds its collector number, slash and all.
      const codeKind = deps.game === 'pkm' ? 'number' : 'code'
      const [codes, names] = await Promise.all([read(codeBands, codeKind), read(nameBands, 'name')])
      return {
        found,
        quad,
        art,
        codeTexts: codes.map((t) => t.trim()).filter(Boolean),
        nameTexts: names.map((t) => t.trim()).filter(Boolean),
        textBands: signals.textBands.filter(hasPixels),
        ...(deps.game === 'pkm' ? { nameBands } : {}),
        cues,
        version,
        slab,
        ...via,
        look
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

/** Makes a scan engine for a game's cards; the scan loop makes a new one when the game changes. */
export type EngineFactory = (game: GameId) => ScanEngine

/** The real engine: the vision worker, with the main process's scan lookups. */
export const defaultEngine: EngineFactory = (game) =>
  createScanEngine({ api: window.api.scan, makeWorker: makeVisionWorker, game })
