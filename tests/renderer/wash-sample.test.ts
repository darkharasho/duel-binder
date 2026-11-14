// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RGB } from '@/lib/wash/color'
import { fit } from '@/lib/wash/fit'
import { gameFallback, sampleCard, sampleMemory } from '@/lib/wash/sample'

const px: RGB[] = Array.from({ length: 1024 }, () => [200, 40, 40] as RGB)
const reader = () => vi.fn(async (..._a: unknown[]): Promise<RGB[] | null> => px)

beforeEach(() => {
  localStorage.clear()
  sampleMemory.clear()
  vi.restoreAllMocks()
})

describe('sampleCard', () => {
  it('reads once, then serves the memory cache', async () => {
    const read = reader()
    const a = await sampleCard({ imageId: 5 }, 'ygo', read)
    const b = await sampleCard({ imageId: 5 }, 'ygo', read)
    expect(a?.fams.length).toBeGreaterThan(0)
    expect(b).toEqual(a)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('reads the cropped image for Yu-Gi-Oh! and small for the rest', async () => {
    const read = reader()
    await sampleCard({ imageId: 5 }, 'ygo', read)
    await sampleCard({ imageId: 6 }, 'pkm', read)
    expect(read.mock.calls[0][0]).toContain('cropped/5')
    expect(read.mock.calls[1][0]).toContain('small/6')
  })

  it('falls back to localStorage with memory cleared', async () => {
    const read = reader()
    const a = await sampleCard({ imageId: 5 }, 'ygo', read)
    sampleMemory.clear()
    const b = await sampleCard({ imageId: 5 }, 'ygo', read)
    expect(b).toEqual(a)
    expect(read).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('wash:v1:ygo:5')).not.toBeNull()
  })

  it('ignores a corrupt entry and recomputes', async () => {
    localStorage.setItem('wash:v1:ygo:5', 'not json')
    const read = reader()
    expect(await sampleCard({ imageId: 5 }, 'ygo', read)).not.toBeNull()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('still resolves when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(await sampleCard({ imageId: 5 }, 'ygo', reader())).not.toBeNull()
  })

  it('is null when the read fails or comes back empty', async () => {
    expect(await sampleCard({ imageId: 1 }, 'ygo', async () => null)).toBeNull()
    expect(await sampleCard({ imageId: 2 }, 'ygo', async () => [])).toBeNull()
    expect(
      await sampleCard({ imageId: 3 }, 'ygo', async () => {
        throw new Error('x')
      })
    ).toBeNull()
  })

  it('keeps at most 600 keys, evicting the oldest', async () => {
    const read = reader()
    for (let i = 1; i <= 601; i++) await sampleCard({ imageId: i }, 'ygo', read)
    expect(localStorage.getItem('wash:v1:ygo:1')).toBeNull()
    expect(localStorage.getItem('wash:v1:ygo:2')).not.toBeNull()
    expect(localStorage.getItem('wash:v1:ygo:601')).not.toBeNull()
    expect(JSON.parse(localStorage.getItem('wash:v1:index')!)).toHaveLength(600)
  })
})

describe('gameFallback', () => {
  it('has two families', () => {
    expect(gameFallback('pkm').fams).toHaveLength(2)
  })
  it.each(['ygo', 'pkm', 'op', 'mtg'] as const)('%s passes contrast in the dark theme', (g) => {
    expect(fit(gameFallback(g), 'dark').worst).toBeGreaterThanOrEqual(4.5)
  })
})
