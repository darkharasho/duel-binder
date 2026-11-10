// The Scan page's vision work, off the UI thread: finding the card in a camera frame, matching
// its art against the fingerprints and cutting out its text bands for OCR in main.
import { decodeFingerprints, type FingerprintIndex } from '@shared/scan/fingerprintFile'
import { SCAN_PROFILES, type ScanProfile } from '@shared/scan/profiles'
import { ART_MAX_DISTANCE } from '@shared/scan/thresholds'
import type { RgbaImage } from '@shared/scan/types'
import type { FrameSignals, WorkerReply, WorkerRequest } from '../engine'
import { analyze } from './analyze'
import { loadCv } from './cv'
import type { Quad } from './detect'
import { findCandidates } from './candidates'
import { readFramed } from './framing'
import { holderBudget } from './holderBudget'
import { createTiltFrames, framesForTilt, keepsForTilt, keepsOutline } from './tiltFrames'

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
  postMessage(msg: WorkerReply, transfer?: Transferable[]): void
}
const scope = self as unknown as WorkerScope

let index: FingerprintIndex | null = null
// The art a live frame is matched against: index, or one language's part of it (the 'scope' message).
let liveIndex: FingerprintIndex | null = null
// The game whose cards are scanned, set by init.
let profile: ScanProfile = SCAN_PROFILES.ygo
// Messages are handled one at a time, in order, even while OpenCV is still loading.
let queue = Promise.resolve()
// Frames in a row that matched nothing, for pacing the holder search.
const budget = holderBudget()
// Where the last frame's art matched, tried first on the next. Art the holder search found isn't
// kept: the resolver is warier of it, and only that search can say so.
let held: Quad | null = null
// A tilted card's frames, kept from the live frames that ask (their tilt) and read on request.
const tilt = createTiltFrames()

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

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

function reply(id: number, signals: FrameSignals): void {
  const bands = [...signals.codeBands, ...signals.nameBands, ...signals.textBands]
  scope.postMessage(
    { type: 'result', id, signals },
    bands.map((b) => b.data.buffer as ArrayBuffer)
  )
}

async function handle(msg: WorkerRequest): Promise<void> {
  if (msg.type === 'init') {
    try {
      await loadCv()
      index = msg.fingerprints ? decodeFingerprints(msg.fingerprints) : null
      profile = SCAN_PROFILES[msg.game] ?? SCAN_PROFILES.ygo
      held = null
      tilt.clear()
      if (index && msg.refs?.length) index.withRefs(msg.refs)
      liveIndex = index
      scope.postMessage({ type: 'ready' })
    } catch (e) {
      scope.postMessage({ type: 'error', id: null, message: messageOf(e) })
    }
    return
  }
  if (msg.type === 'scope') {
    liveIndex = index && msg.imageIds ? index.only(new Set(msg.imageIds)) : index
    held = null
    return
  }
  if (msg.type === 'artDistance') {
    const distance = index?.distanceBetween(msg.a, msg.b) ?? null
    scope.postMessage({ type: 'artDistance', id: msg.id, distance })
    return
  }
  if (msg.type === 'tiltReset') {
    tilt.clear()
    return
  }
  if (msg.type === 'tiltReading') {
    // The window's frames go to the tilt worker, which does the slow reading (about 0.3 s) so a
    // frame sent meanwhile isn't kept waiting. now is the loop's clock, as the frames' times are.
    // Copies, transferred: the kept frames stay for the next reading.
    try {
      const frames = framesForTilt(tilt, msg.now)
      scope.postMessage(
        { type: 'tiltFrames', id: msg.id, frames },
        frames.map((f) => f.buffer as ArrayBuffer)
      )
    } catch (e) {
      scope.postMessage({ type: 'error', id: msg.id, message: messageOf(e) })
    }
    return
  }
  try {
    const cv = await loadCv()
    if (msg.photo) {
      // Every language's art and the whole holder search, and no bearing on the live frames'.
      const signals = analyze(
        cv,
        pixels(msg.image),
        index,
        msg.candidates,
        true,
        msg.wantLook,
        profile
      )
      reply(msg.id, signals)
      return
    }
    // The upright card stays in the worker: it's a few MB, and the UI thread has no use for it.
    // A frame kept for a rarity read is still a whole live frame: it resolves and counts like any
    // other. A Yu-Gi-Oh frame keeps its outline only while kept for a read, and a live frame after
    // one neither tries that outline nor keeps one of its own.
    const keep = keepsOutline(profile, !!msg.tilt)
    // Read at the centre crop, and wider when the card runs off it (framing.ts); the quad is told
    // in whole-frame pixels.
    const holderPass = budget.allow()
    const from = performance.now()
    const image = pixels(msg.image)
    const read = performance.now()
    const { upright, ...signals } = readFramed(
      image,
      msg.region ?? null,
      (img, first) =>
        analyze(
          cv,
          img,
          liveIndex,
          msg.candidates,
          msg.wantBands,
          msg.wantLook,
          profile,
          holderPass,
          first,
          false,
          !!msg.tilt
        ),
      (img) => findCandidates(cv, img, profile),
      keep ? held : null
    )
    signals.ms = { pixels: read - from, vision: performance.now() - read }
    if (upright && msg.tilt && msg.at !== undefined && keepsForTilt(signals.art, msg.tilt)) {
      tilt.keep(upright, msg.at)
      signals.tiltKept = true
    }
    const distance = signals.art[0]?.distance ?? null
    budget.record(distance)
    held =
      keep && signals.quad && !signals.artVia && distance !== null && distance <= ART_MAX_DISTANCE
        ? signals.quad
        : null
    reply(msg.id, signals)
  } catch (e) {
    if ('close' in msg.image) msg.image.close()
    scope.postMessage({ type: 'error', id: msg.id, message: messageOf(e) })
  }
}

scope.onmessage = (e) => {
  queue = queue.then(() => handle(e.data))
}
