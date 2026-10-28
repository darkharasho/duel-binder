import { readFileSync } from 'node:fs'
import { decode } from 'jpeg-js'
import { PNG } from 'pngjs'
import type { RgbaImage } from '@shared/scan/types'

/** A JPEG or PNG file's pixels. */
export function loadImage(path: string): RgbaImage {
  const bytes = readFileSync(path)
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const png = PNG.sync.read(bytes)
    return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }
  }
  const img = decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 })
  return { width: img.width, height: img.height, data: img.data }
}
