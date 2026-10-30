// The Scan page's vision work, off the UI thread: finding the card in a camera frame, matching
// its art against the fingerprints and cutting out its text bands for OCR in main.
import { decodeFingerprints, type FingerprintIndex } from '@shared/scan/fingerprintFile'
import type { RgbaImage } from '@shared/scan/types'
import type { WorkerReply, WorkerRequest } from '../engine'
import { analyze } from './analyze'
import { loadCv } from './cv'

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
  postMessage(msg: WorkerReply, transfer?: Transferable[]): void
}
const scope = self as unknown as WorkerScope

let index: FingerprintIndex | null = null
// Messages are handled one at a time, in order, even while OpenCV is still loading.
let queue = Promise.resolve()

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

async function handle(msg: WorkerRequest): Promise<void> {
  if (msg.type === 'init') {
    try {
      await loadCv()
      index = msg.fingerprints ? decodeFingerprints(msg.fingerprints) : null
      if (index && msg.refs?.length) index.withRefs(msg.refs)
      scope.postMessage({ type: 'ready' })
    } catch (e) {
      scope.postMessage({ type: 'error', id: null, message: messageOf(e) })
    }
    return
  }
  try {
    const signals = analyze(
      await loadCv(),
      pixels(msg.image),
      index,
      msg.candidates,
      msg.wantBands,
      msg.wantLook
    )
    const bands = [...signals.codeBands, ...signals.nameBands, ...signals.textBands]
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
