/** The preview's shape, width over height: portrait, like a card held up. */
export const PREVIEW_ASPECT = 3 / 4

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The centre of a width x height frame at the given aspect (width over height), as large as
 * fits: what `object-fit: cover; object-position: center` shows of it, so what is scanned is
 * what the preview shows. A 1920x1080 frame gives 810x1080 from x = 555.
 */
export function centreCrop(width: number, height: number, aspect = PREVIEW_ASPECT): CropRect {
  if (width / height > aspect) {
    const w = Math.min(width, Math.round(height * aspect))
    return { x: Math.floor((width - w) / 2), y: 0, width: w, height }
  }
  const h = Math.min(height, Math.round(width / aspect))
  return { x: 0, y: Math.floor((height - h) / 2), width, height: h }
}
