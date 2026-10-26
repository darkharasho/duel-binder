// The Scan page's vision work, off the UI thread: finding the card in a camera frame, matching
// its art against the fingerprints and cutting out its text bands for OCR in main.
import { decodeFingerprints, type FingerprintIndex } from '@shared/scan/fingerprintFile'
import { ART_MATCH_DEPTH } from '@shared/scan/thresholds'
import type { OcrBand, RgbaImage } from '@shared/scan/types'
import type { ArtMatch, FrameSignals, WorkerReply, WorkerRequest } from '../engine'
import { toBand } from './bands'
import { recognizeArt } from './candidates'
import { loadCv, type CV } from './cv'
import { findCard, warpCard } from './detect'
import { CODE_BANDS, NAME_BAND } from './regions'

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
  postMessage(msg: WorkerReply, transfer?: Transferable[]): void
}
const scope = self as unknown as WorkerScope

const NOTHING: FrameSignals = { found: false, art: [], codeBands: [], nameBand: null }

let index: FingerprintIndex | null = null
// Messages are handled one at a time, in order, even while OpenCV is still loading.
let queue = Promise.resolve()

const hasPixels = (b: OcrBand): boolean => b.width > 0 && b.height > 0
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function analyze(
  cv: CV,
  img: RgbaImage,
  candidates: number[] | null,
  wantBands: boolean
): FrameSignals {
  let card: RgbaImage
  let art: ArtMatch[] = []
  if (index) {
    const found = recognizeArt(
      cv,
      img,
      index,
      candidates ? new Set(candidates) : undefined,
      ART_MATCH_DEPTH
    )
    if (!found) return NOTHING
    card = found.card
    art = found.matches
  } else {
    // No fingerprints: the card can still be found and read, though not turned upright.
    const quad = findCard(cv, img)
    if (!quad) return NOTHING
    card = warpCard(cv, img, quad)
  }
  if (!wantBands) return { found: true, art, codeBands: [], nameBand: null }
  const name = toBand(card, NAME_BAND)
  return {
    found: true,
    art,
    codeBands: CODE_BANDS.map((box) => toBand(card, box)).filter(hasPixels),
    nameBand: hasPixels(name) ? name : null
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
    const signals = analyze(await loadCv(), msg.image, msg.candidates, msg.wantBands)
    const bands = signals.nameBand ? [...signals.codeBands, signals.nameBand] : signals.codeBands
    scope.postMessage(
      { type: 'result', id: msg.id, signals },
      bands.map((b) => b.data.buffer as ArrayBuffer)
    )
  } catch (e) {
    scope.postMessage({ type: 'error', id: msg.id, message: messageOf(e) })
  }
}

scope.onmessage = (e) => {
  queue = queue.then(() => handle(e.data))
}
