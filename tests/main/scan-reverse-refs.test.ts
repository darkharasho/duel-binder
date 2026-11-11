import { describe, expect, it } from 'vitest'
import { buildReverseRefs } from '../../scripts/scan/reverse-refs'
import { reverseRefStats } from '../../src/shared/scan/reverseHolo'
import refs from '../../src/shared/scan/reverseRefs.json'
import type { RgbaImage } from '../../src/shared/scan/types'

function flat(v: number): RgbaImage {
  const w = 100
  const h = 146
  const data = new Uint8ClampedArray(w * h * 4).fill(v)
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  return { width: w, height: h, data }
}

describe('buildReverseRefs', () => {
  it('keeps rounded stats and lists the failures', async () => {
    const out = await buildReverseRefs(
      [
        { imageId: 1, url: 'a' },
        { imageId: 2, url: 'b' }
      ],
      async (url) => (url === 'a' ? flat(128) : null)
    )
    expect(out.refs).toEqual({ '1': [1, 0] })
    expect(out.failed).toEqual([2])
  })
})

describe('reverseRefStats', () => {
  it('is null for an unknown id', () => {
    expect(reverseRefStats(-1)).toBeNull()
  })
  it('reads a shipped id', () => {
    const id = Number(Object.keys(refs.refs)[0])
    const s = reverseRefStats(id)!
    expect(s.ratio).toBeGreaterThan(0.2)
    expect(s.ratio).toBeLessThan(3)
    expect(s.spread).toBeGreaterThanOrEqual(0)
    expect(s.spread).toBeLessThan(1)
  })
})
