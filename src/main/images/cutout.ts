export interface Bitmap {
  /** 4 bytes per pixel with alpha last (RGBA or BGRA; only alpha and "near white" matter). */
  data: Uint8Array
  width: number
  height: number
}

/** Pixels at least this bright in every channel count as the white behind a logo. */
const WHITE = 230
/** Pixels with less alpha than this count as already transparent. */
const CLEAR = 16

/**
 * Makes the white (or transparent) background around a logo transparent and trims to what's left.
 * The background is flood-filled from the edges, so white letters enclosed by an outline survive.
 * Null when nothing is left.
 */
export function cutOutBackground({ data, width, height }: Bitmap): Bitmap | null {
  const px = new Uint8Array(data)
  const isBackground = (i: number): boolean => {
    const o = i * 4
    return px[o + 3] < CLEAR || (px[o] >= WHITE && px[o + 1] >= WHITE && px[o + 2] >= WHITE)
  }
  const seen = new Uint8Array(width * height)
  const stack: number[] = []
  const visit = (i: number): void => {
    if (seen[i] || !isBackground(i)) return
    seen[i] = 1
    stack.push(i)
  }
  for (let x = 0; x < width; x++) {
    visit(x)
    visit((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    visit(y * width)
    visit(y * width + width - 1)
  }
  while (stack.length) {
    const i = stack.pop()!
    px[i * 4 + 3] = 0
    const x = i % width
    if (x > 0) visit(i - 1)
    if (x < width - 1) visit(i + 1)
    if (i >= width) visit(i - width)
    if (i < (height - 1) * width) visit(i + width)
  }

  let left = width
  let right = -1
  let top = height
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] < CLEAR) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  if (right < 0) return null
  const w = right - left + 1
  const h = bottom - top + 1
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const from = ((top + y) * width + left) * 4
    out.set(px.subarray(from, from + w * 4), y * w * 4)
  }
  return { data: out, width: w, height: h }
}
