// Whether two frames' outlines are one card held in place, for what's kept while it stays there.
import { dist, type Quad } from './vision/detect'

/** How far a card's centre may move, in its own widths, and still be the same card. */
const MAX_SHIFT = 0.5

const centre = (q: Quad): [number, number] => [
  (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4,
  (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4
]

/**
 * Whether b is where a was, by centres: the outlines of one held card differ in size from frame to
 * frame (the card, its sleeve, its holder), and a card swapped for another moves further than that.
 */
export function sameSpot(a: Quad | null, b: Quad | null): boolean {
  if (!a || !b) return false
  return dist(centre(a), centre(b)) <= MAX_SHIFT * Math.min(dist(a[0], a[1]), dist(b[0], b[1]))
}
