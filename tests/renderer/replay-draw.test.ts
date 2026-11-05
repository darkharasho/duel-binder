import { describe, it, expect } from 'vitest'
import { drawReplayFrame, type ReplayScene } from '@/features/scan/replay/draw'
import type { ReplayPull } from '@/features/scan/replay/pulls'
import { replayTimeline } from '@/features/scan/replay/timeline'
import { formatUsd } from '@/lib/format'
import { recordingContext, textsOf } from './replayCanvas'

const pull = (price: number, over: Partial<ReplayPull> = {}): ReplayPull => ({
  key: `k${price}`,
  name: `Card ${price}`,
  imageId: price,
  photoId: null,
  rarity: 'Secret Rare',
  setCode: 'X',
  price,
  quantity: 1,
  addedAt: price,
  ...over
})

const scene = (pulls: ReplayPull[]): ReplayScene => ({
  pulls,
  art: pulls.map((p) => ({ id: p.key }) as unknown as ImageBitmap),
  header: 'Nov 4 · 3 cards · $20.00',
  timeline: replayTimeline(pulls.length)
})

const middleOf = (s: ReplayScene, index: number): number => {
  const seg = s.timeline.segments[index]
  return (seg.start + seg.end) / 2
}

describe('drawReplayFrame', () => {
  it("draws the best pull's caption on its segment", () => {
    const s = scene([pull(2), pull(12)])
    const { ctx, calls } = recordingContext()
    drawReplayFrame(ctx, s, middleOf(s, 1))
    const texts = textsOf(calls).join('\n')
    expect(texts).toContain('Card 12')
    expect(texts).toContain(formatUsd(12))
    expect(texts).toContain('#1 of 2')
  })

  it('shows ×3 for a triple', () => {
    const s = scene([pull(4, { quantity: 3 })])
    const { ctx, calls } = recordingContext()
    drawReplayFrame(ctx, s, middleOf(s, 0))
    expect(textsOf(calls).join('\n')).toContain('×3')
  })

  it('draws the art bitmap for the current pull', () => {
    const s = scene([pull(2), pull(12)])
    const { ctx, calls } = recordingContext()
    drawReplayFrame(ctx, s, middleOf(s, 1))
    expect(calls.some((c) => c[0] === 'drawImage' && c[1] === s.art[1])).toBe(true)
    expect(calls.some((c) => c[0] === 'drawImage' && c[1] === s.art[0])).toBe(false)
  })

  it('end card tallies the hits', () => {
    const s = scene([pull(2), pull(10, { quantity: 2 })])
    const { ctx, calls } = recordingContext()
    drawReplayFrame(ctx, s, middleOf(s, 2))
    expect(textsOf(calls).join('\n')).toContain(`2 hits · ${formatUsd(22)}`)
  })

  it('watermark on every frame', () => {
    const s = scene([pull(2)])
    for (const t of [0, s.timeline.duration]) {
      const { ctx, calls } = recordingContext()
      drawReplayFrame(ctx, s, t)
      expect(textsOf(calls)).toContain('DUEL BINDER · RIP REPLAY')
    }
  })
})
