import { crop } from '../../src/shared/scan/regions'
import type { RgbaImage } from '../../src/shared/scan/types'
import { centreCrop } from '../../src/renderer/src/features/scan/crop'

/** The part of a photo the live app would scan: the same centre crop as useScanLoop's grab. */
export function appFrame(img: RgbaImage): RgbaImage {
  const { x, y, width, height } = centreCrop(img.width, img.height)
  return crop(img, [
    x / img.width,
    y / img.height,
    (x + width) / img.width,
    (y + height) / img.height
  ])
}
