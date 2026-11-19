// The label of a graded slab, cut out for reading: the white block above the card in the case
// carries the grader's grade, its word ("GEM MT", "NM") and the certification number.
import type { Mat } from '@techstark/opencv-js'
import type { OcrBand } from '@shared/scan/types'
import type { CV } from './cv'
import type { Point, Quad } from './detect'

/** The label's box across, in the card's widths (u; the card is 0..1). */
const LABEL_U = [-0.02, 1.02] as const
/** How far the band reaches past the label window the slab was found by, up and down (v). */
const LABEL_ABOVE = 0.06
const LABEL_BELOW = 0.04
/** The band's width in pixels: the label scaled so its text is tall enough for tesseract. */
const BAND_W = 1000
/** A card narrower than this in the frame has a label too small to read. */
const MIN_CARD_PX = 140

/**
 * The label above the card at quad (corners clockwise from top-left, the label above the top
 * edge: see slabQuad), around the window `labelV` it was found in, as a grayscale band straightened and scaled to BAND_W across, contrast
 * stretched. One perspective warp in OpenCV, the card's own perspective carried up to the label,
 * so it costs a millisecond or two a frame. Null when the card is too small in the frame or the
 * label runs off it.
 */
export function slabLabelBand(
  cv: CV,
  frame: Mat,
  quad: Quad,
  labelV: readonly [number, number]
): OcrBand | null {
  const p = quad
  const across: Point = [p[1][0] - p[0][0], p[1][1] - p[0][1]]
  const down: Point = [p[3][0] - p[0][0], p[3][1] - p[0][1]]
  const cardPx = Math.hypot(across[0], across[1])
  if (cardPx < MIN_CARD_PX) return null
  const [u0, u1] = LABEL_U
  const v0 = labelV[0] - LABEL_ABOVE
  const v1 = Math.min(-0.01, labelV[1] + LABEL_BELOW)
  // The label's corners in the frame, near enough (the card's sides carried straight on): off
  // the frame by more than a little, and there's no label to read.
  const slack = 0.05 * cardPx
  const off = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1]
  ].some(([u, v]) => {
    const x = p[0][0] + u * across[0] + v * down[0]
    const y = p[0][1] + u * across[1] + v * down[1]
    return x < -slack || y < -slack || x > frame.cols + slack || y > frame.rows + slack
  })
  if (off) return null
  const downPx = Math.hypot(down[0], down[1])
  const width = BAND_W
  const height = Math.round((width * (v1 - v0) * downPx) / ((u1 - u0) * cardPx))
  // Where the card's corners land in the band: the band is the card's (u, v) box scaled.
  const at = (u: number, v: number): number[] => [
    ((u - u0) / (u1 - u0)) * width,
    ((v - v0) / (v1 - v0)) * height
  ]
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flat())
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [
    ...at(0, 0),
    ...at(1, 0),
    ...at(1, 1),
    ...at(0, 1)
  ])
  const warped = new cv.Mat()
  try {
    const m = cv.getPerspectiveTransform(from, to)
    try {
      cv.warpPerspective(
        frame,
        warped,
        m,
        new cv.Size(width, height),
        cv.INTER_LINEAR,
        cv.BORDER_CONSTANT,
        new cv.Scalar(255, 255, 255, 255)
      )
    } finally {
      m.delete()
    }
    // Gray by hand: the app's OpenCV build has no cvtColor, and the band is small.
    const px = warped.data
    const out = new Uint8Array(width * height)
    for (let i = 0, k = 0; i < out.length; i++, k += 4)
      out[i] = (77 * px[k] + 150 * px[k + 1] + 29 * px[k + 2]) >> 8
    stretch(out)
    return { width, height, data: out }
  } finally {
    from.delete()
    to.delete()
    warped.delete()
  }
}

/** Spreads the band's luma over 0-255, from its 2nd to its 98th percentile. */
function stretch(px: Uint8Array): void {
  const hist = new Array<number>(256).fill(0)
  for (const v of px) hist[v]++
  const at = (share: number): number => {
    let n = 0
    for (let v = 0; v < 256; v++) if ((n += hist[v]) >= share * px.length) return v
    return 255
  }
  const lo = at(0.02)
  const hi = at(0.98)
  if (hi - lo < 16) return
  for (let i = 0; i < px.length; i++)
    px[i] = Math.max(0, Math.min(255, Math.round(((px[i] - lo) * 255) / (hi - lo))))
}
