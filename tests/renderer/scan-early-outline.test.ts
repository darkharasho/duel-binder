import { describe, expect, it } from 'vitest'
import type { FrameSignals } from '@/features/scan/engine'
import { earlyOutline } from '@/features/scan/useScanLoop'
import { ART_MAX_DISTANCE } from '@shared/scan/thresholds'

// A card whose art matched gets its outline as soon as the worker answers, before its text is
// read and looked up; anything less sure waits for the lookup.

const quad = [
  [1, 2],
  [30, 2],
  [30, 44],
  [1, 44]
] as const

const seen = (over: Partial<FrameSignals>): FrameSignals => ({
  found: true,
  quad,
  art: [{ imageId: 1, distance: ART_MAX_DISTANCE - 1 }],
  codeBands: [],
  nameBands: [],
  textBands: [],
  cues: null,
  look: null,
  ...over
})

describe('earlyOutline', () => {
  it('draws a card whose art matched', () => {
    expect(earlyOutline(seen({}))).toEqual(quad)
  })

  it('waits on art too far off, none at all, or no card', () => {
    expect(earlyOutline(seen({ art: [{ imageId: 1, distance: ART_MAX_DISTANCE + 1 }] }))).toBeNull()
    expect(earlyOutline(seen({ art: [] }))).toBeNull()
    expect(earlyOutline(seen({ found: false, quad: null }))).toBeNull()
  })

  it('waits on art found by the holder search or close to a card back', () => {
    expect(earlyOutline(seen({ artVia: 'holder' }))).toBeNull()
    expect(earlyOutline(seen({ artBack: 5 }))).toBeNull()
  })
})
