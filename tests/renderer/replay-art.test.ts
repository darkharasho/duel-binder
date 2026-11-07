import { describe, it, expect } from 'vitest'
import { loadReplayArt, loadReplayLogo, replayArtSrcs } from '@/features/scan/replay/art'
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
    const bad = replayArtSrcs(pulls[1])[0]
    const out = await loadReplayArt(pulls, async (src) => {
      if (src === bad) throw new Error('404')
      return bitmap(src)
    })
    expect(out.pulls.map((p) => p.key)).toEqual(['k1', 'k3'])
    expect(out.art).toEqual([bitmap(cardImageSrc('full', 1)), bitmap(cardImageSrc('full', 3))])
  })

  it("falls back to the card's art when the printing has no photo", async () => {
    const photo = printingImageSrc(407046)!
    const out = await loadReplayArt([pull(1, { photoId: 407046 })], async (src) => {
      if (src === photo) throw new Error('Art 404')
      return bitmap(src)
    })
    expect(out.pulls.map((p) => p.key)).toEqual(['k1'])
    expect(out.art).toEqual([bitmap(cardImageSrc('full', 1))])
  })

  it('all fail gives nothing', async () => {
    const out = await loadReplayArt([pull(1)], () => Promise.reject(new Error('offline')))
    expect(out).toEqual({ pulls: [], art: [] })
  })
})

describe('replayArtSrcs', () => {
  it('the printing photo first on desktop, then the card art', () => {
    expect(replayArtSrcs(pull(5, { photoId: 7 }))).toEqual([printingImageSrc(7), cardImageSrc('full', 5)])
    expect(replayArtSrcs(pull(5))).toEqual([cardImageSrc('full', 5)])
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
