import type { PackWrappers } from './types'

/** 4 bytes per pixel with alpha last; only alpha matters here. */
export interface WrapperBitmap {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
}

/** Pixels with less alpha than this count as the photo's transparent canvas. */
const CLEAR = 16
/** Columns of pixels narrower than this share of the photo are specks (stray 1px lines), not packs. */
const SPECK = 0.05
/** A wrapper is tall and narrow, about 0.55 as wide as tall; boxes and displays are 0.86 or wider. */
const TALL = 0.8

/**
 * Where the wrappers are when a pack photo shows two side by side (Battles of Legend: Monster
 * Mayhem's 1st Edition and Unlimited packs). Every photo is a square canvas, so its own shape says
 * nothing: two wrappers are two tall, narrow runs of opaque columns with clear canvas between them.
 * A single pack, a box, or packs fanned over each other is one run; null for those.
 */
export function findWrappers({ data, width, height }: WrapperBitmap): PackWrappers | null {
  const opaque = (x: number, y: number): boolean => data[(y * width + x) * 4 + 3] >= CLEAR
  const runs: { x: number; width: number }[] = []
  let start = -1
  for (let x = 0; x <= width; x++) {
    let filled = false
    for (let y = 0; x < width && y < height && !filled; y++) filled = opaque(x, y)
    if (filled && start < 0) start = x
    if (!filled && start >= 0) {
      if (x - start >= width * SPECK) runs.push({ x: start, width: x - start })
      start = -1
    }
  }
  if (runs.length !== 2) return null
  const wrappers = runs.map((run) => {
    let top = height
    let bottom = -1
    for (let y = 0; y < height; y++) {
      for (let x = run.x; x < run.x + run.width; x++) {
        if (!opaque(x, y)) continue
        if (y < top) top = y
        bottom = y
        break
      }
    }
    return { x: run.x, y: top, width: run.width, height: bottom - top + 1 }
  })
  if (wrappers.some((w) => w.width > w.height * TALL)) return null
  return { width, height, wrappers }
}
