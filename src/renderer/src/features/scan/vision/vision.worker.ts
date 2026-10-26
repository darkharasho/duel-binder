// The Scan page's vision work, off the UI thread: finding the card in a camera frame, matching
// its art against the fingerprints and cutting out its text bands for OCR in main.
import { decodeFingerprints, type FingerprintIndex } from '@shared/scan/fingerprintFile'
import { ART_MATCH_DEPTH } from '@shared/scan/thresholds'
import type { Mat } from '@techstark/opencv-js'
import type { OcrBand, RgbaImage } from '@shared/scan/types'
import type { ArtMatch, FrameSignals, WorkerReply, WorkerRequest } from '../engine'
import { toBand } from './bands'
import { findCandidates, preferOuter, recognizeArt } from './candidates'
import { loadCv, type CV } from './cv'
import { CARD_W, dist, rotate180, toMat, using, warpCard, type Quad } from './detect'
import { rarityCues } from './rarityCues'
import { CODE_BANDS, NAME_BAND } from './regions'

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
  postMessage(msg: WorkerReply, transfer?: Transferable[]): void
}
const scope = self as unknown as WorkerScope

/** How far past CARD_W a card is straightened for reading its text. */
const MAX_BAND_SCALE = 2

const NOTHING: FrameSignals = {
  found: false,
  quad: null,
  art: [],
  codeBands: [],
  nameBand: null,
  cues: null
}

let index: FingerprintIndex | null = null
// Messages are handled one at a time, in order, even while OpenCV is still loading.
let queue = Promise.resolve()

const hasPixels = (b: OcrBand): boolean => b.width > 0 && b.height > 0
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * The width to straighten a card to for reading its text: its width in the frame, so a card
 * filmed bigger than CARD_W keeps its detail (a 4K camera's set code is twice a 1080p one's),
 * within CARD_W to MAX_BAND_SCALE times that.
 */
function bandWidth(quad: Quad): number {
  const shown = (dist(quad[0], quad[1]) + dist(quad[2], quad[3])) / 2
  return Math.round(Math.min(MAX_BAND_SCALE * CARD_W, Math.max(CARD_W, shown)))
}

/**
 * The frame's signals. It's copied into OpenCV once, for finding the card and every warp of it,
 * and freed whatever happens.
 */
function analyze(
  cv: CV,
  img: RgbaImage,
  candidates: number[] | null,
  wantBands: boolean
): FrameSignals {
  const frame = toMat(cv, img)
  return using([frame], () => analyzeFrame(cv, frame, candidates, wantBands))
}

function analyzeFrame(
  cv: CV,
  img: Mat,
  candidates: number[] | null,
  wantBands: boolean
): FrameSignals {
  let quad: Quad
  let art: ArtMatch[] = []
  // The straightened card for its text, made only when bands are wanted.
  let card: () => RgbaImage
  // The card turned upright at CARD_W, when art matching found which way up it is.
  let upright: RgbaImage | null = null
  if (index) {
    const found = recognizeArt(
      cv,
      img,
      index,
      candidates ? new Set(candidates) : undefined,
      ART_MATCH_DEPTH
    )
    if (!found) return NOTHING
    quad = found.quad
    art = found.matches
    upright = found.card
    // Art is matched at CARD_W, the size it was tuned for; text is read at the card's own size.
    card = () => {
      const width = bandWidth(found.quad)
      if (width === CARD_W) return found.card
      const big = warpCard(cv, img, found.quad, width)
      return found.upsideDown ? rotate180(big) : big
    }
  } else {
    // No fingerprints: the candidate finder's likeliest outline (it holds up on real photos far
    // better than findCard alone), or the card around it when that is one of its inner frames.
    // Read but not turned upright, so its foil isn't looked at.
    const likeliest = preferOuter(findCandidates(cv, img))
    if (!likeliest) return NOTHING
    quad = likeliest
    card = () => warpCard(cv, img, likeliest, bandWidth(likeliest))
  }
  // Read at CARD_W, the size the cues were tuned at.
  const cues = upright ? rarityCues(upright) : null
  if (!wantBands) return { found: true, quad, art, codeBands: [], nameBand: null, cues }
  const straight = card()
  const name = toBand(straight, NAME_BAND)
  return {
    found: true,
    quad,
    art,
    codeBands: CODE_BANDS.map((box) => toBand(straight, box)).filter(hasPixels),
    nameBand: hasPixels(name) ? name : null,
    cues
  }
}

let canvas: OffscreenCanvas | null = null

/** A frame's pixels; a camera frame arrives as an ImageBitmap and is closed once read. */
function pixels(image: RgbaImage | ImageBitmap): RgbaImage {
  if (!('close' in image)) return image
  try {
    const { width, height } = image
    if (!canvas || canvas.width !== width || canvas.height !== height)
      canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('No 2D canvas in the scan worker')
    ctx.drawImage(image, 0, 0)
    return { width, height, data: ctx.getImageData(0, 0, width, height).data }
  } finally {
    image.close()
  }
}

async function handle(msg: WorkerRequest): Promise<void> {
  if (msg.type === 'init') {
    try {
      await loadCv()
      index = msg.fingerprints ? decodeFingerprints(msg.fingerprints) : null
      scope.postMessage({ type: 'ready' })
    } catch (e) {
      scope.postMessage({ type: 'error', id: null, message: messageOf(e) })
    }
    return
  }
  try {
    const signals = analyze(await loadCv(), pixels(msg.image), msg.candidates, msg.wantBands)
    const bands = signals.nameBand ? [...signals.codeBands, signals.nameBand] : signals.codeBands
    scope.postMessage(
      { type: 'result', id: msg.id, signals },
      bands.map((b) => b.data.buffer as ArrayBuffer)
    )
  } catch (e) {
    if ('close' in msg.image) msg.image.close()
    scope.postMessage({ type: 'error', id: msg.id, message: messageOf(e) })
  }
}

scope.onmessage = (e) => {
  queue = queue.then(() => handle(e.data))
}
