// Pure helpers for fit-tilt.ts: the tilt spike's classifier (Fisher-ranked features, standardized,
// nearest centroid), shaped as the TiltPair / TiltModel the app ships, so held-out scores come
// from the same pickByTilt decision the scanner makes.
import { pickByTilt, type TiltModel, type TiltPair } from '@shared/scan/tilt'
import { TILT_FEATURES } from '@shared/scan/tiltFeatures'

/** One reading: the card it was of, its finish and its feature vector (TILT_FEATURES order). */
export interface TiltRow {
  card: string
  finish: string
  x: number[]
  /** The clip it came from, when a clip gives several rows; classes count clips by it. */
  clip?: string
}

/** Mean and population spread of one feature; a spread of 0 reads as 1, as in the spike. */
function stats(rows: readonly TiltRow[], f: number): { m: number; s: number } {
  let m = 0
  for (const r of rows) m += r.x[f]
  m /= rows.length
  let v = 0
  for (const r of rows) v += (r.x[f] - m) ** 2
  return { m, s: Math.sqrt(v / rows.length) || 1 }
}

/** Between-class over within-class variance of one feature. */
function fisher(rows: readonly TiltRow[], groups: readonly TiltRow[][], f: number): number {
  const { m } = stats(rows, f)
  let b = 0
  let w = 0
  for (const g of groups) {
    const q = stats(g, f)
    b += g.length * (q.m - m) ** 2
    w += g.length * q.s ** 2
  }
  return b / (w + 1e-9)
}

/** One pair: Fisher-ranked top k features, standardized over the pair's rows, two centroids. */
export function fitPair(rows: readonly TiltRow[], a: string, b: string, k: number): TiltPair {
  const ra = rows.filter((r) => r.finish === a)
  const rb = rows.filter((r) => r.finish === b)
  const both = [...ra, ...rb]
  if (!ra.length || !rb.length) throw new Error(`No rows for ${ra.length ? b : a}`)
  const dims = both[0].x.length
  const score = Array.from({ length: dims }, (_, f) => fisher(both, [ra, rb], f))
  // Stable: an equal score keeps the earlier feature, as the spike's sort does.
  const use = [...score.keys()].sort((i, j) => score[j] - score[i]).slice(0, k)
  const norm = use.map((f) => stats(both, f))
  const centroid = (g: readonly TiltRow[]): number[] =>
    use.map((f, i) => (stats(g, f).m - norm[i].m) / norm[i].s)
  return {
    a,
    b,
    use,
    mean: norm.map((n) => n.m),
    spread: norm.map((n) => n.s),
    ca: centroid(ra),
    cb: centroid(rb)
  }
}

const featureNames = (dims: number): string[] =>
  dims === TILT_FEATURES.length
    ? [...TILT_FEATURES]
    : Array.from({ length: dims }, (_, i) => `x${i}`)

/** A model over the given classes, in that order, with a pair for each two of them. */
function modelOf(rows: readonly TiltRow[], classes: readonly string[], k: number): TiltModel {
  const pairs: TiltPair[] = []
  for (let i = 0; i < classes.length; i++) {
    for (let j = i + 1; j < classes.length; j++)
      pairs.push(fitPair(rows, classes[i], classes[j], k))
  }
  return { features: featureNames(rows[0]?.x.length ?? 0), classes: [...classes], pairs }
}

/** Every class with >= minClips rows from >= minCards cards, and a pair for each two of them. */
export function fitModel(
  rows: readonly TiltRow[],
  k: number,
  minClips = 8,
  minCards = 5
): TiltModel {
  const clips = new Map<string, Set<string>>()
  const cards = new Map<string, Set<string>>()
  rows.forEach((r, i) => {
    if (!clips.has(r.finish)) clips.set(r.finish, new Set())
    if (!cards.has(r.finish)) cards.set(r.finish, new Set())
    clips.get(r.finish)!.add(r.clip ?? `#${i}`)
    cards.get(r.finish)!.add(r.card)
  })
  const n = (f: string): number => clips.get(f)!.size
  // Most clips first, then by name, so a refit on the same rows writes the same file.
  const classes = [...clips.keys()]
    .filter((f) => n(f) >= minClips && cards.get(f)!.size >= minCards)
    .sort((a, b) => n(b) - n(a) || (a < b ? -1 : a > b ? 1 : 0))
  return modelOf(
    rows.filter((r) => classes.includes(r.finish)),
    classes,
    k
  )
}

/**
 * Leave one card out: each card's rows scored by a model fitted without that card. The model has
 * a pair for each two of `finishes` that keep at least two training rows; a test row is right
 * when pickByTilt among `finishes` names its finish (no pick counts as wrong).
 */
export function heldOut(
  train: readonly TiltRow[],
  test: readonly TiltRow[],
  finishes: readonly string[],
  k: number
): { right: number; total: number } {
  const scored = test.filter((r) => finishes.includes(r.finish))
  const pool = train.filter((r) => finishes.includes(r.finish))
  let right = 0
  for (const card of new Set(scored.map((r) => r.card))) {
    const rows = pool.filter((r) => r.card !== card)
    const classes = finishes.filter((f) => rows.filter((r) => r.finish === f).length >= 2)
    const model = classes.length >= 2 ? modelOf(rows, classes, k) : null
    for (const r of scored) {
      if (r.card !== card || !model) continue
      if (pickByTilt(model, r.x, finishes)?.finish === r.finish) right++
    }
  }
  return { right, total: scored.length }
}

/** Indices of frames sampled every stepMs over windowMs from startMs; frame n is at n * 1000 / fps. */
export function windowFrames(
  ns: readonly number[],
  fps: number,
  startMs: number,
  windowMs: number,
  stepMs: number
): number[] {
  const eps = 1e-6
  const frames = [...ns].sort((a, b) => a - b)
  const taken = new Set<number>()
  const out: number[] = []
  for (let t = startMs; t < startMs + windowMs - eps; t += stepMs) {
    let best = -1
    let bestD = Infinity
    for (const n of frames) {
      if (taken.has(n)) continue
      const d = Math.abs((n * 1000) / fps - t)
      // Ascending order, so a tie (within rounding) keeps the earlier frame.
      if (d <= stepMs / 2 + eps && d < bestD - eps) {
        best = n
        bestD = d
      }
    }
    if (best < 0) continue
    taken.add(best)
    out.push(best)
  }
  return out
}
