import { describe, it, expect } from 'vitest'
import { loadReplayArt, loadReplayLogo, replayArtSrc } from '@/features/scan/replay/art'
import type { ReplayPull } from '@/features/scan/replay/pulls'
import { cardImageSrc, printingImageSrc } from '@/lib/images'

const pull = (n: number, over: Partial<ReplayPull> = {}): ReplayPull => ({
  key: `k${n}`,
  name: `Card ${n}`,
  imageId: n,
  photoId: null,
  rarity: null,
  setCode: null,
  price: n,
  quantity: 1,
  addedAt: n,
  ...over
})
const bitmap = (src: string): ImageBitmap => ({ src }) as unknown as ImageBitmap

describe('loadReplayArt', () => {
  it('drops a pull whose art fails and keeps order', async () => {
    const pulls = [pull(1), pull(2), pull(3)]
    const bad = replayArtSrc(pulls[1])
    const out = await loadReplayArt(pulls, async (src) => {
      if (src === bad) throw new Error('404')
      return bitmap(src)
    })
    expect(out.pulls.map((p) => p.key)).toEqual(['k1', 'k3'])
    expect(out.art).toEqual([bitmap(replayArtSrc(pulls[0])), bitmap(replayArtSrc(pulls[2]))])
  })

  it('all fail gives nothing', async () => {
    const out = await loadReplayArt([pull(1)], () => Promise.reject(new Error('offline')))
    expect(out).toEqual({ pulls: [], art: [] })
  })
})

describe('replayArtSrc', () => {
  it('prefers the printing photo on desktop', () => {
    expect(replayArtSrc(pull(5, { photoId: 7 }))).toBe(printingImageSrc(7))
    expect(replayArtSrc(pull(5))).toBe(cardImageSrc('full', 5))
  })
})

describe('loadReplayLogo', () => {
  it("the app's logo, drawn from its own file", async () => {
    const seen: string[] = []
    const logo = await loadReplayLogo(async (src) => {
      seen.push(src)
      return bitmap(src)
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/svg/)
    expect(logo).toEqual(bitmap(seen[0]))
  })

  it("nothing when it won't load: the replay still makes, words only", async () => {
    await expect(loadReplayLogo(() => Promise.reject(new Error('no')))).resolves.toBeUndefined()
  })
})
