import { css } from './color'
import type { Fitted } from './fit'

/** Unseeded pool spots (x %, y %), biggest family first. */
const SPOTS: [number, number][] = [
  [8, -10],
  [95, 0],
  [55, 110],
  [30, 55],
  [80, 70]
]

/** A small seeded random source (mulberry32), so a card's layout is random but stable. */
const rng = (seed: number): (() => number) => {
  let a = ((Number(seed) || 0) * 2654435761) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Blobs in a seeded wash: enough to read like blurred art, not so many it turns to mush. */
const BLOBS = 14

type Pool = Fitted['pools'][number]

const blob = (rgb: Pool['rgb'], w: number, h: number, x: number, y: number, a = 1): string =>
  `radial-gradient(ellipse ${w.toFixed(1)}% ${h.toFixed(1)}% at ${x.toFixed(1)}% ${y.toFixed(1)}%, ${css(rgb, a)}, ${css(rgb, a * 0.55)} 40%, ${css(rgb, 0)} 80%)`

/**
 * The CSS `background` value: soft radial blobs of the art's colours, then (optionally) the base
 * colour. With a seed (the card), the blobs are scattered at random but stable per card, many and of
 * mixed sizes, so the wash looks like a blurred card rather than a fixed pattern. A few large blobs
 * lay down the main colours, then smaller ones (colour picked by each family's share) break them up;
 * small ones are drawn on top. Without a seed: one pool per family in fixed spots.
 */
export function field(
  { pools, base }: Fitted,
  { seed, withBase = true }: { seed?: number; withBase?: boolean } = {}
): string {
  let g: string[]
  if (!seed || pools.length === 0) {
    g = pools.map(({ rgb, share }, i) => {
      const [x, y] = SPOTS[i % SPOTS.length]
      const s = 45 + 70 * Math.sqrt(share)
      return blob(rgb, s, s * 1.25, x, y)
    })
  } else {
    const r = rng(seed)
    const total = pools.reduce((n, p) => n + p.share, 0) || 1
    const pick = (): Pool => {
      let t = r() * total
      for (const p of pools) if ((t -= p.share) <= 0) return p
      return pools[0]
    }
    const blobs = Array.from({ length: BLOBS }, (_, i) => {
      const p = i < pools.length ? pools[i] : pick()
      const big = i < 4
      const s = big ? 55 + r() * 35 : 18 + r() * 30
      const a = big ? 0.8 : 0.5 + r() * 0.2
      return { s, css: blob(p.rgb, s, s * (0.7 + r() * 0.9), -10 + r() * 120, -10 + r() * 120, a) }
    })
    g = blobs.sort((a, b) => a.s - b.s).map((b) => b.css)
  }
  return withBase ? [...g, css(base)].join(', ') : g.join(', ')
}

/**
 * The phone's grain: the same noise drawn white at a low alpha with plain blending, in place of
 * GRAIN with `mix-blend-mode: overlay` at 0.22. Over the dark wash they look alike (measured in
 * Chromium on fills of 15 to 80 grey: both lift about 2 to 5 levels with a spread under 1.5), but a
 * plain layer needs no blend pass, so iOS can keep it as a still layer above the pools.
 */
export const GRAIN_PLAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .025 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`

export const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 1.4 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`
