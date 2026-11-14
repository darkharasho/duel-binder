import { css } from './color'
import type { Fitted } from './fit'

/** Pool spots, biggest family first. Size scales with each family's share of the art's colour. */
const SPOTS = [
  [8, -10],
  [95, 0],
  [55, 110],
  [30, 55],
  [80, 70]
]

/** Small per-card shift of the spots (from the card id) so cards don't all share one layout, but each is stable. */
const jitter = (seed: number, i: number): [number, number] => {
  let h = (Number(seed) || 0) * 2654435761 + i * 40503
  h = (h ^ (h >>> 15)) >>> 0
  return [(h % 31) - 15, ((h >>> 8) % 25) - 12]
}

/** The CSS `background` value: one radial pool per family, then (optionally) the base colour. */
export function field({ pools, base }: Fitted, { seed, withBase = true }: { seed?: number; withBase?: boolean } = {}): string {
  const g = pools.map(({ rgb, share }, i) => {
    const [jx, jy] = seed ? jitter(seed, i) : [0, 0]
    const [x, y] = [SPOTS[i][0] + jx, SPOTS[i][1] + jy]
    const s = 45 + 70 * Math.sqrt(share)
    return `radial-gradient(ellipse ${s}% ${s * 1.25}% at ${x}% ${y}%, ${css(rgb, 1)}, ${css(rgb, 0.55)} 40%, ${css(rgb, 0)} 80%)`
  })
  return withBase ? [...g, css(base)].join(', ') : g.join(', ')
}

export const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 1.4 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`
