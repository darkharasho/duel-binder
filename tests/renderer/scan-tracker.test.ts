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
const NONE: ScanOutcome = { kind: 'none' }
const UNSURE: ScanOutcome = { kind: 'unsure' }

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
})
