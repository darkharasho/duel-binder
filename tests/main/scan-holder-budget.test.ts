import { describe, expect, it } from 'vitest'
import {
  HOLDER_EVERY,
  holderBudget
} from '../../src/renderer/src/features/scan/vision/holderBudget'

describe('holderBudget', () => {
  it('lets every third unmatched frame in a row search, the first one at once', () => {
    const b = holderBudget()
    const allowed: boolean[] = []
    for (let i = 0; i < 2 * HOLDER_EVERY + 1; i++) {
      allowed.push(b.allow())
      b.record(null)
    }
    expect(allowed).toEqual([true, false, false, true, false, false, true])
  })

  it('starts over once a frame matches, and a far match counts as unmatched', () => {
    const b = holderBudget()
    b.record(null)
    b.record(null)
    expect(b.allow()).toBe(false)
    b.record(20)
    expect(b.allow()).toBe(true)
    b.record(300)
    expect(b.allow()).toBe(false)
  })
})
