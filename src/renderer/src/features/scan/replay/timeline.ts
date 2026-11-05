/** How long each pull holds, the best one, and the closing card; and each slide in or out. */
export const PULL_MS = 3000
export const BEST_MS = 5500
export const END_MS = 2000
export const SLIDE_MS = 450

/** A stretch of the replay: one pull (`rank` counts down to 1, the best) or the closing card. */
export type ReplaySegment =
  | { kind: 'pull'; index: number; rank: number; of: number; start: number; end: number }
  | { kind: 'end'; start: number; end: number }

export interface ReplayTimeline {
  segments: ReplaySegment[]
  duration: number
}

/** The countdown for `pullCount` pulls in play order: the last is the best and holds longest. */
export function replayTimeline(pullCount: number): ReplayTimeline {
  if (pullCount < 1) throw new Error('A replay needs at least one pull')
  const segments: ReplaySegment[] = []
  let t = 0
  for (let index = 0; index < pullCount; index++) {
    const length = index === pullCount - 1 ? BEST_MS : PULL_MS
    segments.push({
      kind: 'pull',
      index,
      rank: pullCount - index,
      of: pullCount,
      start: t,
      end: t + length
    })
    t += length
  }
  segments.push({ kind: 'end', start: t, end: t + END_MS })
  return { segments, duration: t + END_MS }
}

/** The segment playing at `t` ms and how far through it (0..1); past the end is the last frame. */
export function frameAt(
  tl: ReplayTimeline,
  t: number
): { segment: ReplaySegment; progress: number } {
  const time = Math.max(0, t)
  const segment =
    tl.segments.find((s) => time < s.end) ?? tl.segments[tl.segments.length - 1]
  const progress = Math.min(1, (time - segment.start) / (segment.end - segment.start))
  return { segment, progress }
}
