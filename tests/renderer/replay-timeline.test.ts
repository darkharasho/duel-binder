import { describe, it, expect } from 'vitest'
import { frameAt, replayTimeline } from '@/features/scan/replay/timeline'

describe('replayTimeline', () => {
  it('8 pulls fit in 30 s', () => {
    const tl = replayTimeline(8)
    expect(tl.duration).toBe(7 * 3000 + 5500 + 2000)
    expect(tl.duration).toBeLessThanOrEqual(30000)
  })

  it('one pull is the best, held 5.5 s, then the end card', () => {
    expect(replayTimeline(1).segments).toEqual([
      { kind: 'pull', index: 0, rank: 1, of: 1, start: 0, end: 5500 },
      { kind: 'end', start: 5500, end: 7500 }
    ])
  })

  it('ranks count down to 1', () => {
    const ranks = replayTimeline(3).segments.flatMap((s) => (s.kind === 'pull' ? [s.rank] : []))
    expect(ranks).toEqual([3, 2, 1])
  })

  it('zero pulls throws', () => {
    expect(() => replayTimeline(0)).toThrow()
  })
})

describe('frameAt', () => {
  it('clamps past the end to the last frame', () => {
    const tl = replayTimeline(2)
    expect(frameAt(tl, 99999)).toEqual({ segment: tl.segments[2], progress: 1 })
  })

  it('finds the middle of a segment', () => {
    const f = frameAt(replayTimeline(2), 1500)
    expect(f.segment).toMatchObject({ kind: 'pull', index: 0 })
    expect(f.progress).toBe(0.5)
  })
})
