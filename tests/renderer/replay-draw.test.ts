import { afterEach, describe, it, expect, vi } from 'vitest'
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

  it('a lone pull has no "#1 of 1"', () => {
    const s = scene([pull(4)])
    const { ctx, calls } = recordingContext()
    drawReplayFrame(ctx, s, middleOf(s, 0))
    expect(textsOf(calls).join('\n')).not.toContain('#1 of 1')
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

  it('the logo beside the watermark on every frame, when there is one', () => {
    const logo = { id: 'logo' } as unknown as ImageBitmap
    const s = { ...scene([pull(2)]), logo }
    for (const t of [0, middleOf(s, 0), s.timeline.duration]) {
      const { ctx, calls } = recordingContext()
      drawReplayFrame(ctx, s, t)
      const drawn = calls.filter((c) => c[0] === 'drawImage' && c[1] === logo)
      expect(drawn).toHaveLength(1)
      // Low down, beside the watermark, and small.
      const [, , , y, w] = drawn[0] as [string, unknown, number, number, number]
      expect(y).toBeGreaterThan(830)
      expect(w).toBeLessThan(40)
    }
  })

  it('no logo, just the watermark', () => {
    const s = scene([pull(2)])
    const { ctx, calls } = recordingContext()
    drawReplayFrame(ctx, s, 0)
    expect(textsOf(calls)).toContain('DUEL BINDER · RIP REPLAY')
  })
})

describe('drawReplayFrame motion', () => {
  const drew = (calls: unknown[][], art: unknown): boolean =>
    calls.some((c) => c[0] === 'drawImage' && c[1] === art)

  it('deals each pull face down and turns it over', () => {
    const s = scene([pull(2), pull(5), pull(12)])
    const start = s.timeline.segments[1].start
    const dealt = recordingContext()
    drawReplayFrame(dealt.ctx, s, start + 100)
    expect(drew(dealt.calls, s.art[1])).toBe(false)
    expect(drew(dealt.calls, s.art[0])).toBe(true) // the last pull on its way out
    const turned = recordingContext()
    drawReplayFrame(turned.ctx, s, start + 1200)
    expect(drew(turned.calls, s.art[1])).toBe(true)
    expect(drew(turned.calls, s.art[0])).toBe(false)
  })

  it('holds the best pull face down longer before it turns', () => {
    const s = scene([pull(2), pull(12)])
    const start = s.timeline.segments[1].start
    const { ctx, calls } = recordingContext()
    drawReplayFrame(ctx, s, start + 1200)
    expect(drew(calls, s.art[1])).toBe(false)
    expect(textsOf(calls)).not.toContain('TOP PULL OF THE NIGHT')
  })

  it('counts the price up as it comes in', () => {
    const s = scene([pull(40)])
    const { ctx, calls } = recordingContext()
    drawReplayFrame(ctx, s, 2100)
    const texts = textsOf(calls).join('\n')
    expect(texts).toContain('Card 40')
    expect(texts).not.toContain(formatUsd(40))
  })

  it('the closing card shows every hit', () => {
    const s = scene([pull(2), pull(5), pull(12)])
    const { ctx, calls } = recordingContext()
    drawReplayFrame(ctx, s, s.timeline.duration - 1)
    for (const art of s.art) expect(drew(calls, art)).toBe(true)
  })
})

describe('drawReplayFrame backdrop', () => {
  afterEach(() => vi.unstubAllGlobals())

  const stubOffscreen = (): void => {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext(): unknown {
          const { ctx } = recordingContext()
          Object.assign(ctx, { getImageData: () => ({ data: [200, 40, 120, 255] }) })
          return ctx
        }
      }
    )
  }

  // Every frame has the card's art blurred behind it, in whichever look.
  const washes = (s: ReplayScene): unknown[][] =>
    [middleOf(s, 0), s.timeline.segments[1].start + 100, middleOf(s, 1), middleOf(s, 2)].map(
      (t) => {
        const { ctx, calls } = recordingContext()
        drawReplayFrame(ctx, s, t)
        return calls
          .filter((c) => c[0] === 'drawImage' && !s.art.includes(c[1] as ImageBitmap))
          .map((c) => c[1])
      }
    )

  it('the blurred art behind the card on every frame, bright when not asked', () => {
    stubOffscreen()
    for (const images of washes(scene([pull(2), pull(12)])))
      expect(images.length).toBeGreaterThan(0)
  })

  // Deep is blurred more than bright: a different picture behind the card.
  it('deep and bright draw different washes of the same art', () => {
    stubOffscreen()
    const base = scene([pull(4), pull(14)])
    const bright = washes(base).flat()
    const deep = washes({ ...base, backdrop: 'deep' }).flat()
    expect(deep.length).toBeGreaterThan(0)
    for (const image of deep) expect(bright).not.toContain(image)
  })
})
