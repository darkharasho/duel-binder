import type { GameId } from '@shared/games/types'
import type { Api } from '@shared/ipc'
import type { RarityCues } from '@shared/scan/rarity'
import type { VersionCues } from './vision/pokemonVersion'
import type { OcrKind } from '@shared/scan/ocr'
import type { ArtMatch } from '@shared/scan/fingerprintFile'
import type { ScanRef } from '@shared/scan/fingerprintRefs'
import type { OcrBand, RgbaImage } from '@shared/scan/types'
import type { Quad } from './vision/detect'
import type { CropRect } from './crop'
import type { TiltReading } from '@shared/scan/tiltFeatures'
import type { TiltReply, TiltRequest } from './vision/tilt.worker'

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
   * For a game with card backs (cardBacks.ts): how close the card, or an outline over it, came
   * to one of them (recognizeArt's back). Left out for other games.
   */
  artBack?: number
  /**
   * The card's look for the rarity look model (rarityFeatures, LOOK_FEATURES order): only when
   * asked for (wantLook) and the card was turned upright, else null.
   */
  look: number[] | null
  /** The worker kept this frame for the tilt reading (the frame's `tilt` held its art). */
  tiltKept?: boolean
  /**
   * A live frame's times in ms, for the phone's timing readout: reading the bitmap's pixels in
   * the worker, the vision work on them, and (when text was read) the OCR after.
   */
  ms?: FrameMs
}

export interface FrameMs {
  pixels: number
  vision: number
  ocr?: number
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
      /**
       * Keep the card for the tilt reading when its closest art is one of these images, close
       * enough (keepsForTilt), as captured at `at`.
       */
      tilt?: number[]
      /** When the frame was grabbed, on the scan loop's clock (performance.now()); sent with tilt. */
      at?: number
      /**
       * The part of the frame the preview shows, read first (framing.ts); the whole frame is
       * read when it is left out. The quad comes back in the whole frame's pixels either way.
       */
      region?: CropRect
    }
  /** Narrows live frames' art search to these artworks, or null for all of it, until told again. */
  | { type: 'scope'; imageIds: number[] | null }
  | { type: 'artDistance'; id: number; a: number; b: number }
  /** The tilt features of the frames kept in the TILT_MS before now (the loop's clock, as at). */
  | { type: 'tiltReading'; id: number; game: GameId; now: number }
  /** Forgets the kept tilt frames (init does too). */
  | { type: 'tiltReset' }

/** Messages from it: `ready` answers `init`, and an error with no id is init's. */
export type WorkerReply =
  | { type: 'ready' }
  | { type: 'result'; id: number; signals: FrameSignals }
  | { type: 'artDistance'; id: number; distance: number | null }
  /** The kept frames for a tilt reading (copies, transferred), for the tilt worker to read. */
  | { type: 'tiltFrames'; id: number; frames: Uint8Array[] }
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
  /** As FrameSignals.artBack. */
  artBack?: number
  look: number[] | null
  /** As FrameSignals.tiltKept. */
  tiltKept?: boolean
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
   * measures the card's look for the rarity look model as well. A live frame whose closest art is
   * one of `tilt` is kept for the tilt reading (tiltKept), as grabbed at `at` (performance.now()
   * when left out: grab it as the frame is, so a frame that waits in the worker isn't misplaced).
   */
  analyze(
    frame: ImageBitmap | ImageData,
    opts: {
      candidates: number[] | null
      wantText: boolean
      wantLook?: boolean
      photo?: boolean
      tilt?: number[]
      at?: number
      /** Read only the code bands, not the names: a number reader's frame (the Contribute screen). */
      codesOnly?: boolean
      /** As the frame request's region. */
      region?: CropRect
      /**
       * Hears what the worker saw as soon as it answers, before the frame's text is read: a
       * matched card's outline can be drawn while its OCR runs.
       */
      onVision?: (seen: FrameSignals) => void
    }
  ): Promise<RawSignals>
  /** Live frames match only these artworks from now on; null for every one. */
  scope(imageIds: number[] | null): void
  /** How far apart two artworks' fingerprints are; null when either has none. */
  artDistance?(a: number, b: number): Promise<number | null>
  /**
   * The tilt features of the frames kept in the TILT_MS before now (performance.now() when left
   * out), read as game's cards; null for too few of them. It takes the worker about a second, and
   * frames sent meanwhile wait behind it.
   */
  tiltReading?(game: GameId, now?: number): Promise<TiltReading | null>
  /** Forgets the kept tilt frames; nothing to do while no worker is running. */
  tiltReset?(): void
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

/** The tilt worker, bundled by Vite: it reads the vision worker's kept frames off its thread. */
export const makeTiltWorker = (): Worker =>
  new Worker(new URL('./vision/tilt.worker.ts', import.meta.url), { type: 'module' })

const hasPixels = (b: OcrBand): boolean => b.width > 0 && b.height > 0

/**
 * Runs the vision worker over camera frames and reads the text bands it cuts out through
 * `api.ocr`, only when wantText. The worker starts on first use, reading cards of game
 * (Yu-Gi-Oh when left out).
 */
export function createScanEngine(deps: {
  api: Api['scan']
  makeWorker: () => Worker
  /** The tilt worker, started on the first reading (makeTiltWorker when left out). */
  makeTiltWorker?: () => Worker
  game?: GameId
  timeouts?: { initMs?: number; frameMs?: number }
}): ScanEngine {
  let worker: Worker | null = null
  let disposed = false
  let nextId = 1
  const inits: Waiter<void>[] = []
  const frames = new Map<number, Waiter<FrameSignals>>()
  const distances = new Map<number, (distance: number | null) => void>()
  const tilts = new Map<number, Waiter<TiltReading | null>>()
  // The tilt worker, and the readings (their ids) it owes.
  let tiltWorker: Worker | null = null
  const onTiltWorker = new Set<number>()
  const tiltGames = new Map<number, GameId>()
  const initMs = deps.timeouts?.initMs ?? INIT_TIMEOUT_MS
  const frameMs = deps.timeouts?.frameMs ?? FRAME_TIMEOUT_MS

  const failAll = (error: Error): void => {
    for (const w of inits.splice(0)) w.reject(error)
    for (const w of frames.values()) w.reject(error)
    frames.clear()
    for (const w of tilts.values()) w.reject(error)
    tilts.clear()
    tiltGames.clear()
    endTiltWorker()
  }

  /** Ends the tilt worker; readings it owed are failed by the caller, which knows why. */
  function endTiltWorker(): void {
    onTiltWorker.clear()
    tiltWorker?.terminate()
    tiltWorker = null
  }

  /** Throws the tilt worker away, failing only the readings it owes. */
  const killTilt = (error: Error): void => {
    for (const id of [...onTiltWorker]) {
      tilts.get(id)?.reject(error)
      tilts.delete(id)
      tiltGames.delete(id)
    }
    endTiltWorker()
  }

  const startTilt = (): Worker => {
    if (tiltWorker) return tiltWorker
    const t = (deps.makeTiltWorker ?? makeTiltWorker)()
    t.onmessage = (e: MessageEvent<TiltReply>) => {
      const msg = e.data
      onTiltWorker.delete(msg.id)
      if (msg.type === 'reading') tilts.get(msg.id)?.resolve(msg.reading)
      else tilts.get(msg.id)?.reject(new Error(msg.message))
      tilts.delete(msg.id)
    }
    t.onerror = (e) => {
      if (tiltWorker === t) killTilt(new Error(e.message || 'The tilt worker failed'))
    }
    t.onmessageerror = () => {
      if (tiltWorker === t) killTilt(new Error('A tilt worker reply could not be read'))
    }
    tiltWorker = t
    return t
  }

  /** The vision worker's frames for reading id, on to the tilt worker. */
  const readTilt = (id: number, frames: Uint8Array[]): void => {
    const game = tiltGames.get(id)
    tiltGames.delete(id)
    if (game === undefined || !tilts.has(id)) return // gave up on (timed out) meanwhile
    try {
      const request: TiltRequest = { type: 'read', id, game, frames }
      const t = startTilt()
      onTiltWorker.add(id)
      t.postMessage(
        request,
        frames.map((f) => f.buffer as ArrayBuffer)
      )
    } catch (e) {
      onTiltWorker.delete(id)
      tilts.get(id)?.reject(e instanceof Error ? e : new Error(String(e)))
      tilts.delete(id)
    }
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

  /**
   * A reading's waiter, covering its whole round trip: unanswered within frameMs, the worker
   * holding it is thrown away (the tilt worker if it has the frames, else the vision worker).
   */
  const watchedTilt = (
    id: number,
    waiter: Waiter<TiltReading | null>
  ): Waiter<TiltReading | null> => {
    const w = worker
    const timer = setTimeout(() => {
      const error = new Error('The scan worker stopped answering')
      // Killing a hung tilt worker rejects every reading queued on it, not just this one.
      if (onTiltWorker.has(id)) killTilt(error)
      else if (w && worker === w) kill(w, error)
    }, frameMs)
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
      } else if (msg.type === 'artDistance') {
        distances.get(msg.id)?.(msg.distance)
        distances.delete(msg.id)
      } else if (msg.type === 'tiltFrames') {
        readTilt(msg.id, msg.frames)
      } else if (msg.id === null) {
        inits.shift()?.reject(new Error(msg.message))
      } else {
        frames.get(msg.id)?.reject(new Error(msg.message))
        frames.delete(msg.id)
        tilts.get(msg.id)?.reject(new Error(msg.message))
        tilts.delete(msg.id)
        tiltGames.delete(msg.id)
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
          // A read of nothing starts the text reader now, so the first card held up doesn't wait
          // for it to load (a second or so on a phone).
          void Promise.resolve()
            .then(() => deps.api.ocr([], deps.game === 'pkm' ? 'number' : 'code'))
            .catch(() => {})
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      })
    },

    scope(imageIds) {
      send({ type: 'scope', imageIds })
    },

    artDistance(a, b) {
      return new Promise((resolve) => {
        const id = nextId++
        distances.set(id, resolve)
        send({ type: 'artDistance', id, a, b })
      })
    },

    tiltReading(game, now = performance.now()) {
      return new Promise((resolve, reject) => {
        const id = nextId++
        try {
          send({ type: 'tiltReading', id, game, now })
          tiltGames.set(id, game)
          tilts.set(id, watchedTilt(id, { resolve, reject }))
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      })
    },

    tiltReset() {
      // A worker not running keeps no frames, so there's none to start (or to fail after dispose).
      worker?.postMessage({ type: 'tiltReset' } satisfies WorkerRequest)
    },

    async analyze(
      frame,
      {
        candidates,
        wantText,
        wantLook = false,
        photo = false,
        tilt,
        at,
        codesOnly = false,
        region,
        onVision
      }
    ) {
      const id = nextId++
      const grabbed = at ?? performance.now()
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
              ...(photo ? { photo: true as const } : {}),
              ...(tilt ? { tilt, at: grabbed } : {}),
              ...(region ? { region } : {})
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
      onVision?.(signals)
      const { found, quad, art, cues, version, slab, look } = signals
      // Only when set, so a frame's signals are as they were without the holder search or a tilt.
      const flags = {
        ...(signals.artVia ? { artVia: signals.artVia } : {}),
        ...(signals.artBack !== undefined ? { artBack: signals.artBack } : {}),
        ...(signals.tiltKept ? { tiltKept: true } : {}),
        ...(signals.ms ? { ms: signals.ms } : {})
      }
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
          ...flags,
          look
        }
      const codeBands = signals.codeBands.filter(hasPixels)
      const nameBands = codesOnly ? [] : signals.nameBands.filter(hasPixels)
      // Text is a helper to the art: a failed or timed-out read counts as nothing read, so OCR
      // trouble never stops art matching.
      const read = (bands: OcrBand[], kind: OcrKind): Promise<string[]> =>
        bands.length ? deps.api.ocr(bands, kind).catch(() => []) : Promise.resolve([])
      // A Pokémon card's code band holds its collector number, slash and all.
      const codeKind = deps.game === 'pkm' ? 'number' : 'code'
      const ocrFrom = performance.now()
      const [codes, names] = await Promise.all([read(codeBands, codeKind), read(nameBands, 'name')])
      if (flags.ms) flags.ms = { ...flags.ms, ocr: performance.now() - ocrFrom }
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
        ...flags,
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
