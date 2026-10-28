// Whether a card is foil all over (Starlight, Quarter Century Secret), from how textured its
// frame is beside the artwork against how crisp its effect text is. Measured per frame in the
// scan worker (vision/foil.ts); read here, where the card's frame type is known.

/** One frame's measurements, in luma levels at half the straightened width. */
export interface SurfaceReading {
  /** Median fine texture of the frame strips beside the artwork. */
  frameFloor: number
  /** Mean coarse texture of the strips. */
  frameCoarse: number
  /** 98th percentile of the effect text's fine texture: its sharpest print. */
  textEdges: number
  /** Mean fine texture of the effect text. */
  textFine: number
}

/**
 * A logistic model over the logs of the four measurements and whether the frame is Xyz (whose
 * black frame shows glitter less) or Link, fitted by scripts/scan/rarity/fit-surface.ts on about 1,400
 * labelled cards: eBay listing photos and Yugipedia and TCGplayer scans put through synthetic
 * camera conditions. Each measurement is standardized by its mean and spread over those cards.
 */
const MODEL = {
  weights: { frameFloor: 1.935, frameCoarse: 0.924, textEdges: -1.167, textFine: -0.67 },
  xyz: 0.577,
  link: -0.035,
  bias: -0.778,
  mean: {
    frameFloor: 0.2895,
    frameCoarse: 1.3762,
    textEdges: 2.5018,
    textFine: 1.3381,
    xyz: 0.1117,
    link: 0.07
  },
  spread: {
    frameFloor: 0.4914,
    frameCoarse: 0.5521,
    textEdges: 0.9966,
    textFine: 0.8354,
    xyz: 0.315,
    link: 0.2552
  }
} as const

/** Added before taking logs, so a perfectly flat region doesn't go to minus infinity. */
const LOG_OFFSET = 0.5

/**
 * The log-odds that a card is foil all over. On the cards the model was fitted on, whole-card
 * foils mostly score above 0 and the rest below; see SURFACE_FOIL_MIN and SURFACE_PLAIN_MAX for
 * where it is trusted.
 */
export function surfaceScore(r: SurfaceReading, frameType: string): number {
  let z = MODEL.bias
  for (const key of Object.keys(MODEL.weights) as (keyof SurfaceReading)[])
    z +=
      (MODEL.weights[key] * (Math.log(r[key] + LOG_OFFSET) - MODEL.mean[key])) / MODEL.spread[key]
  for (const frame of ['xyz', 'link'] as const) {
    const is = frameType === frame ? 1 : 0
    z += (MODEL[frame] * (is - MODEL.mean[frame])) / MODEL.spread[frame]
  }
  return z
}

/**
 * At or above this the frame reads as foil. Set high: no plain card of the eBay photos, webcam
 * shots or degraded scans scored above it, against about a third of the whole-card foils of the
 * eBay photos and degraded scans (and none of the webcam shots, whose glitter the camera loses).
 */
export const SURFACE_FOIL_MIN = 3
/**
 * At or below this the frame reads as plain card stock. Set low: 1 of about 400 whole-card foils
 * over the eBay photos, webcam shots and degraded scans scored below it, against about a sixth of
 * the plain cards (a twentieth of the webcam shots, which score higher overall).
 */
export const SURFACE_PLAIN_MAX = -3.5

/** How a card's frame reads: foil all over, or plain. */
export type SurfaceLook = 'foil' | 'plain'

/**
 * What a reading says of the frame, or null when it can't tell. A Pendulum frame carries its
 * artwork over the strips, so it reads nothing; a Link frame's printed pattern reads as texture,
 * so it never reads foil; an Xyz frame is black, which hides glitter, so it never reads plain.
 */
export function surfaceLook(r: SurfaceReading | null, frameType: string): SurfaceLook | null {
  if (!r || frameType.endsWith('_pendulum')) return null
  const score = surfaceScore(r, frameType)
  if (score <= SURFACE_PLAIN_MAX && frameType !== 'xyz') return 'plain'
  if (score >= SURFACE_FOIL_MIN && frameType !== 'link') return 'foil'
  return null
}

/** The median of each measurement over several frames' readings; null without any. */
export function surfaceOver(readings: SurfaceReading[]): SurfaceReading | null {
  if (!readings.length) return null
  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }
  return {
    frameFloor: median(readings.map((r) => r.frameFloor)),
    frameCoarse: median(readings.map((r) => r.frameCoarse)),
    textEdges: median(readings.map((r) => r.textEdges)),
    textFine: median(readings.map((r) => r.textFine))
  }
}
