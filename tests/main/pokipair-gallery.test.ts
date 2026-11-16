import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { hamming } from '../../src/shared/scan/fingerprint'
import {
  parseSetPage,
  POKIPAIR_HUB,
  type PpCard,
  type ZhCatalogCard
} from '../../scripts/catalog/pokemon/pokipair'
import {
  galleryGroups,
  galleryHash,
  isGallery,
  matchGallery,
  SAME_ART
} from '../../scripts/catalog/pokemon/pokipairGallery'
import { mirrorZhArt, type MirrorRecord } from '../../scripts/catalog/pokemon/pokipairMirror'

const dir = join(__dirname, '../fixtures/pokipair')
/** Thumbnails 16–22 of PokiPair's CSV1 page: Rowlet x3, Dartrix x3, Decidueye ex. */
const THUMBS = ['016', '017', '018', '019', '020', '021', '022']
const thumb = (n: string): Uint8Array =>
  new Uint8Array(readFileSync(join(dir, 'gallery', `${n}.png`)))
const galleryHtml = readFileSync(join(dir, 'csv1-gallery.html'), 'utf8')

const card = (n: string, name: string, rarity: string, set = 'CSV1C'): ZhCatalogCard => ({
  sourceId: `zh-hans/${set}-${n}`,
  number: n,
  name,
  rarity
})
const csv1 = [
  card('006', 'Rowlet', 'Common'),
  card('007', 'Dartrix', 'Common'),
  card('008', 'Decidueye ex', 'Double Rare')
]

/** A hash `bits` bits away from `base`, the first ones flipped. */
function near(base: Uint32Array, bits: number): Uint32Array {
  const h = base.slice()
  for (let i = 0; i < bits; i++) h[i >> 5] ^= 1 << (i & 31)
  return h
}
const A = new Uint32Array(8)
const B = near(A, 128)
const C = near(A, 200)
const D = new Uint32Array(8).fill(0xf0f0f0f0)

const pic = (n: number): PpCard => ({
  number: null,
  variant: '',
  name: null,
  url: `https://media.pokipair.com/x/list-${n}.png`,
  thumb: `https://media.pokipair.com/x/list-${n}-216x300.png`
})

describe('galleryHash', () => {
  it("puts a card's reverse prints with it and its neighbours well apart", () => {
    const h = THUMBS.map((n) => galleryHash(thumb(n))!)
    const d = (a: number, b: number): number => hamming(h[a], 0, h[b], 0)
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [3, 4],
      [4, 5]
    ])
      expect(d(a, b)).toBeLessThanOrEqual(SAME_ART)
    for (const [a, b] of [
      [2, 3],
      [5, 6]
    ])
      expect(d(a, b)).toBeGreaterThan(SAME_ART + 30)
  })

  it('is null for bytes that are no picture', () => {
    expect(galleryHash(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})

describe('galleryGroups', () => {
  it('runs neighbours with the same art together', () => {
    expect(galleryGroups([A, near(A, 20), near(A, 40), B, near(B, 10), C, A])).toEqual([
      [0, 1, 2],
      [3, 4],
      [5],
      [6]
    ])
  })
})

describe('isGallery', () => {
  it('is a numberless page with more pictures than cards', () => {
    expect(isGallery([1, 2, 3].map(pic), csv1.slice(0, 2))).toBe(true)
    expect(isGallery([1, 2].map(pic), csv1.slice(0, 2))).toBe(false)
    expect(isGallery([1, 2, 3].map(pic), [])).toBe(false)
    expect(isGallery([{ ...pic(1), number: '001' }, pic(2), pic(3)], csv1.slice(0, 2))).toBe(false)
  })
})

describe('matchGallery', () => {
  const page = [1, 2, 3, 4, 5, 6, 7].map(pic)

  it("gives each card its run's first picture, the plain print, in the set's order", () => {
    const m = matchGallery(page, [A, A, A, B, B, B, C], [csv1[2], csv1[0], csv1[1]])
    expect([...m]).toEqual([
      ['zh-hans/CSV1C-006', page[0].url],
      ['zh-hans/CSV1C-007', page[3].url],
      ['zh-hans/CSV1C-008', page[6].url]
    ])
  })

  it('matches nothing when the runs and the cards are not as many', () => {
    expect(matchGallery(page, [A, A, A, B, B, B, B], csv1).size).toBe(0)
    expect(matchGallery(page, [A, A, A, B, B, C, D], csv1).size).toBe(0)
  })

  it('matches nothing when reverse prints stop following rarity (a card missing, another extra)', () => {
    // Commons with and without reverses: the gallery has slipped a card.
    const cards = [
      card('001', 'A', 'Common'),
      card('002', 'B', 'Common'),
      card('003', 'C', 'Double Rare')
    ]
    expect(matchGallery(page.slice(0, 5), [A, A, A, B, C], cards).size).toBe(0)
  })

  it('matches nothing when a thumbnail is missing', () => {
    expect(matchGallery(page, [A, A, A, B, B, B], csv1).size).toBe(0)
  })
})

describe('parseSetPage on a gallery page', () => {
  it("keeps each picture's small copy", () => {
    const { title, cards } = parseSetPage(galleryHtml)
    expect(title).toBe('Eternal Beginnings CSV1 Card List')
    expect(cards).toHaveLength(7)
    expect(cards.every((c) => c.number === null)).toBe(true)
    expect(cards[0].url).toMatch(/Card-List-16\.png$/)
    expect(cards[0].thumb).toMatch(/Card-List-16-216x300\.png$/)
  })
})

describe('mirrorZhArt on a gallery page', () => {
  // The fixture hub's CS4a link serves the CSV1 gallery here.
  const cs4a = csv1.map((c) => ({ ...c, sourceId: c.sourceId.replace('CSV1C', 'CS4aC') }))

  function setup(over: { thumb?: (n: string) => Response } = {}) {
    const urls: string[] = []
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      urls.push(url)
      if (url === POKIPAIR_HUB) return new Response(readFileSync(join(dir, 'hub.html'), 'utf8'))
      if (url.includes('nine-colors')) return new Response(galleryHtml)
      const t = /Card-List-(\d+)-216x300\.png$/.exec(url)
      if (t) {
        const n = t[1].padStart(3, '0')
        return (
          over.thumb?.(n) ??
          new Response(thumb(n) as unknown as BodyInit, {
            headers: { 'content-type': 'image/png' }
          })
        )
      }
      // Full-size pictures, and every other set's pages and packs.
      if (/Card-List-\d+\.png$/.test(url))
        return new Response(thumb('016') as unknown as BodyInit, {
          headers: { 'content-type': 'image/png' }
        })
      return new Response('nope', { status: 404 })
    })
    const uploads: string[] = []
    const portalFetch = vi.fn(async (input: string | URL | Request) => {
      uploads.push(String(input))
      return new Response('{"ok":true}')
    })
    const record: MirrorRecord = { done: {}, packs: {} }
    const run = (cards: ZhCatalogCard[], dry = false) =>
      mirrorZhArt({
        cards: new Map([['CS4aC', cards]]),
        record,
        fetch: fetchFn as unknown as typeof fetch,
        portal: dry
          ? undefined
          : {
              url: 'https://portal.test',
              token: 't',
              fetch: portalFetch as unknown as typeof fetch
            },
        budget: 100,
        gapMs: 1000,
        sleep: async () => undefined,
        log: () => undefined
      })
    return { run, urls, uploads, record }
  }

  it("copies each card's plain picture, told apart by art", async () => {
    const t = setup()
    const r = await t.run(cs4a)
    expect(r.uploaded).toBe(3)
    expect(t.record.done).toEqual({
      'zh-hans/CS4aC-006': expect.stringMatching(/Card-List-16\.png$/),
      'zh-hans/CS4aC-007': expect.stringMatching(/Card-List-19\.png$/),
      'zh-hans/CS4aC-008': expect.stringMatching(/Card-List-22\.png$/)
    })
    expect(t.uploads.filter((u) => u.includes('/hand-art/zh-hans-cs4ac-'))).toHaveLength(6)
  })

  it('on a dry run reads the thumbnails and counts the matches, copying nothing', async () => {
    const t = setup()
    const r = await t.run(cs4a, true)
    expect(r.matched).toBe(3)
    expect(t.uploads).toHaveLength(0)
    expect(t.urls.filter((u) => /Card-List-\d+\.png$/.test(u))).toHaveLength(0)
    expect(t.record.done).toEqual({})
    expect(t.record.galleries).toEqual({})
  })

  it("remembers a gallery that won't line up and doesn't fetch it again until the page changes", async () => {
    const t = setup()
    const four = [...cs4a, card('009', 'Sprigatito', 'Common', 'CS4aC')]
    await t.run(four)
    expect(t.record.done).toEqual({})
    expect(Object.keys(t.record.galleries ?? {})).toEqual(['nine-colors-gathering-set-list-cs4a'])
    const thumbsBefore = t.urls.filter((u) => u.endsWith('-216x300.png')).length
    expect(thumbsBefore).toBe(7)
    await t.run(four)
    expect(t.urls.filter((u) => u.endsWith('-216x300.png')).length).toBe(thumbsBefore)
  })

  it('tries a gallery again another night when a thumbnail fails', async () => {
    const t = setup({
      thumb: (n) => (n === '019' ? new Response('', { status: 500 }) : undefined!)
    })
    const r = await t.run(cs4a)
    expect(r.uploaded).toBe(0)
    expect(t.record.galleries).toEqual({})
  })
})
