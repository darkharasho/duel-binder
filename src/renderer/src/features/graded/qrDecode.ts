// Finding a QR code in a camera frame or a photo, on the device: the browser's BarcodeDetector
// where it has one that reads QR codes (Android, macOS), else jsQR (Windows and Linux Chromium,
// iOS Safari).
import jsQR from 'jsqr'

/** The longest side a picture is decoded at: jsQR's cost grows with its area. */
const MAX_SIDE = 1000

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}
type DetectorClass = {
  new (o: { formats: string[] }): Detector
  getSupportedFormats(): Promise<string[]>
}

let native: Promise<Detector | null> | null = null

/** The browser's QR detector, or null without one. Asked once. */
function nativeDetector(): Promise<Detector | null> {
  native ??= (async () => {
    const D = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector
    if (!D) return null
    try {
      return (await D.getSupportedFormats()).includes('qr_code')
        ? new D({ formats: ['qr_code'] })
        : null
    } catch {
      return null
    }
  })()
  return native
}

/**
 * A small region is drawn up to this many times its size: jsQR needs about 3 px a module, and a
 * TAG label's small code held at a webcam's distance has 1 to 2.
 */
const MAX_UPSCALE = 3

/**
 * The picture's region (sx, sy, sw, sh) drawn at no more than MAX_SIDE on its longer side, and,
 * when `grow`, enlarged up to it (MAX_UPSCALE at most).
 */
function pixels(
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  grow = false
): ImageData | null {
  const fit = MAX_SIDE / Math.max(sw, sh)
  const k = grow ? Math.min(MAX_UPSCALE, fit) : Math.min(1, fit)
  const w = Math.max(1, Math.round(sw * k))
  const h = Math.max(1, Math.round(sh * k))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/**
 * The text of a QR code in `source` (width × height), or null when none reads. jsQR looks at the
 * middle first, enlarged then at full detail (where a label held up to the camera is), then the
 * whole picture.
 */
export async function decodeQr(
  source: CanvasImageSource,
  width: number,
  height: number
): Promise<string | null> {
  if (width <= 0 || height <= 0) return null
  const detector = await nativeDetector()
  if (detector) {
    try {
      const [hit] = await detector.detect(source)
      return hit?.rawValue || null
    } catch {
      // Fall through to jsQR.
    }
  }
  // The middle third enlarged (a small code held up to the camera), then the middle at full
  // detail, then the whole picture.
  const box = (share: number): [number, number, number, number, boolean] => {
    const side = Math.min(width, height) * share
    return [(width - side) / 2, (height - side) / 2, side, side, share < 0.5]
  }
  const regions: [number, number, number, number, boolean][] = [
    box(0.35),
    box(0.6),
    [0, 0, width, height, false]
  ]
  for (const [sx, sy, sw, sh, grow] of regions) {
    const img = pixels(source, sx, sy, sw, sh, grow)
    if (!img) return null
    const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
    if (hit?.data) return hit.data
  }
  return null
}
