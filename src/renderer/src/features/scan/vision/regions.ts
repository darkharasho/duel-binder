import type { RgbaImage } from '@shared/scan/types'

/** x0, y0, x1, y1 as ratios of the straightened card. */
export type Box = readonly [number, number, number, number]

/**
 * Where the artwork sits on a straightened card, calibrated on the generated fixtures (YGOPRODeck
 * renders). The hash is sensitive to this: a box 2.5% off adds about 50 bits of distance.
 * YGOPRODeck's cropped Pendulum art is the whole picture, including the part the Pendulum text
 * box covers, so that box runs down over the text box to keep the cropped art's proportions.
 */
export const ART_BOXES = {
  normal: [0.092, 0.168, 0.911, 0.716],
  pendulum: [0.034, 0.164, 0.966, 0.961]
} as const satisfies Record<string, Box>

/** Set code bands: under the art, and the bottom strip used by Pendulum, Link and overframe cards. */
export const CODE_BANDS = [
  [0.05, 0.695, 0.95, 0.765],
  [0.04, 0.885, 0.96, 0.955]
] as const satisfies readonly Box[]

export const NAME_BAND = [0.06, 0.04, 0.8, 0.105] as const satisfies Box

/** Copies the part of img inside box. */
export function crop(img: RgbaImage, box: Box): RgbaImage {
  const x0 = Math.max(0, Math.round(box[0] * img.width))
  const y0 = Math.max(0, Math.round(box[1] * img.height))
  const x1 = Math.min(img.width, Math.round(box[2] * img.width))
  const y1 = Math.min(img.height, Math.round(box[3] * img.height))
  const width = Math.max(0, x1 - x0)
  const height = Math.max(0, y1 - y0)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const from = ((y0 + y) * img.width + x0) * 4
    data.set(img.data.subarray(from, from + width * 4), y * width * 4)
  }
  return { width, height, data }
}
