// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RGB } from '@/lib/wash/color'
import { fit } from '@/lib/wash/fit'
import {
  clearMisses,
  gameFallback,
  readPixels,
  rememberedCard,
  sampleCard,
  sampleMemory
} from '@/lib/wash/sample'

const px: RGB[] = Array.from({ length: 1024 }, () => [200, 40, 40] as RGB)
const reader = () => vi.fn(async (..._a: unknown[]): Promise<RGB[] | null> => px)

beforeEach(() => {
  localStorage.clear()
  sampleMemory.clear()
  clearMisses()
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

  it('does not ask again for a card that failed, until the day is up', async () => {
    const read = vi.fn(async (..._a: unknown[]): Promise<RGB[] | null> => null)
    expect(await sampleCard({ imageId: 9 }, 'pkm', read)).toBeNull()
    expect(await sampleCard({ imageId: 9 }, 'pkm', read)).toBeNull()
    expect(read).toHaveBeenCalledTimes(1)
    clearMisses() // a new session still has it in localStorage
    expect(await sampleCard({ imageId: 9 }, 'pkm', read)).toBeNull()
    expect(read).toHaveBeenCalledTimes(1)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 25 * 60 * 60 * 1000)
    clearMisses()
    await sampleCard({ imageId: 9 }, 'pkm', read)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('asks with its own query so a CORS read cannot reuse the grid tile copy', async () => {
    const read = reader()
    await sampleCard({ imageId: 6 }, 'pkm', read)
    expect(String(read.mock.calls[0][0])).toMatch(/small\/6\?(wash|now)/)
  })

  it('gives grey art with no frame the game colours', async () => {
    const grey: RGB[] = Array.from({ length: 1024 }, () => [90, 90, 95] as RGB)
    const f = await sampleCard({ imageId: 7 }, 'pkm', async () => grey)
    expect(f?.greyArt).toBe(true)
    expect(f?.fams).toEqual(gameFallback('pkm').fams)
    expect(fit(f!, 'dark').worst).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the frame colour for grey Yu-Gi-Oh! art with a known frame', async () => {
    const grey: RGB[] = Array.from({ length: 1024 }, () => [90, 90, 95] as RGB)
    const f = await sampleCard({ imageId: 8, frameType: 'effect' }, 'ygo', async () => grey)
    expect(f?.fams).not.toEqual(gameFallback('ygo').fams)
  })

  it('recovers from a corrupt index', async () => {
    localStorage.setItem('wash:v1:index', '{"a":1}')
    await sampleCard({ imageId: 5 }, 'ygo', reader())
    expect(JSON.parse(localStorage.getItem('wash:v1:index')!)).toEqual(['wash:v1:ygo:5'])
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

describe('rememberedCard', () => {
  it('returns a card read earlier for this game, from memory or storage', async () => {
    await sampleCard({ imageId: 5 }, 'ygo', reader())
    await sampleCard({ imageId: 9 }, 'pkm', reader())
    expect(rememberedCard('ygo', () => 0)).toMatchObject({ imageId: 5 })
    sampleMemory.clear()
    expect(rememberedCard('ygo', () => 0)?.imageId).toBe(5)
    expect(rememberedCard('pkm', () => 0)?.imageId).toBe(9)
  })

  it('is null with nothing remembered or only failed reads', async () => {
    expect(rememberedCard('ygo', Math.random)).toBeNull()
    await sampleCard(
      { imageId: 7 },
      'ygo',
      vi.fn(async () => null)
    )
    expect(rememberedCard('ygo', Math.random)).toBeNull()
  })
})

describe('gameFallback', () => {
  it('turns both colours by the same random hue, keeping their gap', async () => {
    const { lch } = await import('@/lib/wash/color')
    const plain = gameFallback('pkm').fams.map((f) => lch(f.lab))
    const turned = gameFallback('pkm', () => 0.25).fams.map((f) => lch(f.lab))
    for (let i = 0; i < 2; i++) {
      expect(turned[i][0]).toBeCloseTo(plain[i][0])
      expect(turned[i][1]).toBeCloseTo(plain[i][1])
      expect((turned[i][2] - plain[i][2] + 360) % 360).toBeCloseTo(90)
    }
  })

  it('has two families', () => {
    expect(gameFallback('pkm').fams).toHaveLength(2)
  })
  it.each(['ygo', 'pkm', 'op', 'mtg'] as const)('%s passes contrast in the dark theme', (g) => {
    expect(fit(gameFallback(g), 'dark').worst).toBeGreaterThanOrEqual(4.5)
  })
})

describe('readPixels', () => {
  it('gives up after the timeout', async () => {
    vi.useFakeTimers()
    const p = readPixels('ygo-img://small/1', { x: 0, y: 0, w: 1, h: 1 }, 1000)
    vi.advanceTimersByTime(1001)
    expect(await p).toBeNull()
    vi.useRealTimers()
  })
})
