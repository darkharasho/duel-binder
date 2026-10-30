import { describe, expect, it } from 'vitest'
import { createShowingTracker } from '@/features/scan/tracker'
import type { ScanDraft, ScanOutcome } from '@/features/scan/resolve'

const draft = (cardId: number, imageId = cardId * 10): ScanDraft => ({
  cardId,
  name: `Card ${cardId}`,
  imageId,
  printingId: cardId * 100,
  setCode: null,
  rarity: null,
  options: [],
  flag: null,
  via: 'art'
})
const seen = (cardId: number): ScanOutcome => ({ kind: 'recognized', item: draft(cardId) })
const as = (d: Partial<ScanDraft>): ScanOutcome => ({
  kind: 'recognized',
  item: { ...draft(1), ...d }
})
const NONE: ScanOutcome = { kind: 'none' }
const UNSURE: ScanOutcome = { kind: 'unsure' }
const FAR: ScanOutcome = { kind: 'none', far: true }

/** Pushes outcomes 100 ms apart from start and returns the card ids counted. */
function run(
  tracker: ReturnType<typeof createShowingTracker>,
  outcomes: ScanOutcome[],
  start = 0
): number[] {
  return outcomes.flatMap((o, i) => {
    const d = tracker.push(start + i * 100, o)
    return d ? [d.cardId] : []
  })
}

describe('createShowingTracker', () => {
  describe('a best guess', () => {
    const guess = (cardId: number): ScanOutcome => as({ ...draft(cardId), guess: true })
    const tracker = (): ReturnType<typeof createShowingTracker> =>
      createShowingTracker({ stableFrames: 2, guessFrames: 4, absentMs: 600 })

    it('counts only after holding for its frames', () => {
      const t = tracker()
      expect(run(t, [guess(1), guess(1), guess(1)])).toEqual([])
      expect(run(t, [guess(1)], 300)).toEqual([1])
    })

    it('gives way to a certain answer, which counts at once and as certain', () => {
      const t = tracker()
      expect(run(t, [guess(1), guess(1), seen(2), seen(2)])).toEqual([2])
      const u = tracker()
      u.push(0, guess(1))
      expect(u.push(100, seen(1))?.guess).toBeUndefined()
    })

    it('never counts while a card already counted is in view, as its twin', () => {
      const t = tracker()
      expect(run(t, [seen(1), seen(1), guess(2), guess(2), guess(2), guess(2), guess(2)])).toEqual([
        1
      ])
    })

    it('counts for the next card once the view has cleared', () => {
      const t = tracker()
      run(t, [seen(1), seen(1), NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE])
      expect(run(t, [guess(2), guess(2), guess(2), guess(2)], 2000)).toEqual([2])
    })
  })

  it('counts once across flicker', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    expect(run(t, [seen(1), UNSURE, seen(1), seen(1), UNSURE, seen(1), seen(1)])).toEqual([1])
  })

  it('needs stableFrames consecutive frames', () => {
    const t = createShowingTracker({ stableFrames: 3, absentMs: 600 })
    expect(run(t, [seen(1), seen(1), NONE, seen(1), seen(1)])).toEqual([])
    expect(run(t, [seen(1)], 500)).toEqual([1])
  })

  it('same card again after absence counts again', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    const nones = Array<ScanOutcome>(7).fill(NONE)
    expect(run(t, [seen(1), seen(1), ...nones, seen(1), seen(1)])).toEqual([1, 1])
  })

  it('brief absence under absentMs does not recount', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    expect(run(t, [seen(1), seen(1), NONE, NONE, NONE, seen(1), seen(1)])).toEqual([1])
    // An unsure frame breaks the absence too: the card is still in view.
    expect(run(t, [NONE, NONE, NONE, UNSURE, NONE, NONE, NONE, seen(1), seen(1)], 1000)).toEqual([])
  })

  it('one card read by code, then art, then code counts once', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    const code = as({ printingId: 13, via: 'code' })
    const art = as({ printingId: null, via: 'art', flag: 'pick-printing' })
    expect(run(t, [code, code, art, art, code, code])).toEqual([1])
  })

  it('alternating artworks of one card count once', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    const a = as({ imageId: 101 })
    const b = as({ imageId: 102 })
    expect(run(t, [a, b, a, b, a, b, a])).toEqual([1])
  })

  it('a single none frame is no absence, however late the card comes back', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    const counted = [
      t.push(0, seen(1)),
      t.push(100, seen(1)),
      t.push(200, NONE),
      t.push(800, seen(1)),
      t.push(900, seen(1))
    ].filter(Boolean)
    expect(counted).toHaveLength(1)
  })

  it('different card counts without absence', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    expect(run(t, [seen(1), seen(1), seen(2), seen(2), seen(1), seen(1)])).toEqual([1, 2, 1])
  })

  it('reset forgets the card shown', () => {
    const t = createShowingTracker()
    expect(run(t, [seen(1), seen(1)])).toEqual([1])
    t.reset()
    expect(run(t, [seen(1), seen(1)], 300)).toEqual([1])
  })

  it('a single far-art frame right after a recognized one keeps the streak', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    expect(run(t, [seen(1), FAR, seen(1)])).toEqual([1])
  })

  it('a far-art frame after an unsure one still keeps the streak', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    expect(run(t, [seen(1), UNSURE, FAR, seen(1)])).toEqual([1])
  })

  it('two far-art frames in a row break the streak', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    expect(run(t, [seen(1), FAR, FAR, seen(1)])).toEqual([])
  })

  it('far-art frames with nothing recognized just before are none, absence included', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    const fars = Array<ScanOutcome>(7).fill(FAR)
    expect(run(t, [seen(1), seen(1), NONE, ...fars, seen(1), seen(1)])).toEqual([1, 1])
  })

  it('a plain none frame after a recognized one still breaks the streak', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    expect(run(t, [seen(1), NONE, seen(1)])).toEqual([])
  })

  it('a held card flickering with far-art frames counts once', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    const flicker = Array.from({ length: 30 }, (_, i) => (i % 2 ? FAR : seen(1)))
    expect(run(t, flicker)).toEqual([1])
  })

  it('a held card that keeps reading far art counts again only after a real absence', () => {
    const t = createShowingTracker({ stableFrames: 2, absentMs: 600 })
    const fars = Array<ScanOutcome>(8).fill(FAR)
    expect(run(t, [seen(1), seen(1), ...fars, seen(1), seen(1)])).toEqual([1, 1])
    expect(run(t, [seen(1), FAR, FAR, FAR, seen(1), seen(1)], 5000)).toEqual([])
  })
})
