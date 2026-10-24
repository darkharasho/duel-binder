import { describe, expect, it, vi } from 'vitest'
import { findSetImageUrl, getChecklist, listSets } from '../../src/main/repo/sets'
import {
  type Article,
  konamiLogoKey,
  matchArticles,
  parseArticleList,
  refreshKonamiLogos,
  shouldRefreshKonamiLogos
} from '../../src/main/konami/logos'
import { seededDb } from './helpers'

const post = (ID: number, title: string, url: string | null): unknown => ({
  post: { type: 'topics', ID, title, content: '<p>{"not": "json"}</p>', thumbnail: { full: { url, w: 1280 } } }
})

/** A listing page as the site sends it: the data inside a script call. */
const page = (maxPage: number, ...list: unknown[]): string =>
  `<script>this.setTopics({ tgt_id:{base:'tgt-topics'},
    data:${JSON.stringify({ api_name: 'topics_EU_en_ygotcg', max_page: maxPage, page: 1, list })}
  });</script>`

const UP = '/games_cms/promo/eu/uploads/'

describe('Konami news logos', () => {
  it('reads each article with its thumbnail on img.konami.com', () => {
    expect(
      parseArticleList(
        page(
          9,
          post(19076, 'Debuts In Rarity Collection 5 !', `${UP}rao5_en_169.jpg`),
          post(15642, 'Autumn', '/kde_cms/eu_publish/uploads/ygo-logo-with-copyright.png'),
          post(1, 'Elsewhere', 'https://evil.example/x.png'),
          post(2, 'None', null)
        )
      )
    ).toEqual({
      maxPage: 9,
      articles: [
        { id: 19076, title: 'Debuts In Rarity Collection 5 !', imageUrl: `https://img.konami.com${UP}rao5_en_169.jpg` },
        { id: 15642, title: 'Autumn', imageUrl: null },
        { id: 1, title: 'Elsewhere', imageUrl: null },
        { id: 2, title: 'None', imageUrl: null }
      ]
    })
    expect(() => parseArticleList('<html></html>')).toThrow()
  })

  it('matches titles to the longest set name, newest article first, plus known exceptions', () => {
    const sets = [
      { set_name: 'Rarity Collection 5', set_code: 'RA05' },
      { set_name: 'Legendary 5D&apos;s Decks', set_code: 'L5DD' },
      { set_name: 'Structure Deck: Legend of the Crystal Beasts', set_code: 'SDCB' },
      { set_name: 'Legendary Duelists', set_code: 'LEDU' },
      { set_name: 'Legendary Duelists: Season 3', set_code: 'LDS3' },
      { set_name: "2022 Tin of the Pharaoh's Gods", set_code: 'MP22' },
      { set_name: 'Premium', set_code: 'PRM' }
    ]
    const a = (id: number, title: string, img = `x${id}.png`): Article => ({ id, title, imageUrl: img })
    expect(
      matchArticles(
        [
          a(5, 'Debuts Extended Art Cards In Rarity Collection 5 !'),
          a(4, 'Rarity Collection 5 reprint', 'older.png'),
          a(3, 'LEGENDARY 5D’S DECKS out now'),
          a(2, 'Legendary Duelists: Season 3 arrives'),
          a(16677, 'Discover the legend of the crystal beasts'),
          a(6, "2022 Tin of the Pharaoh's Gods"),
          a(7, 'Premium packs tonight')
        ],
        sets
      )
    ).toEqual(
      new Map([
        ['Rarity Collection 5', 'x5.png'],
        ['Legendary 5D&apos;s Decks', 'x3.png'],
        ['Legendary Duelists: Season 3', 'x2.png'],
        ['Structure Deck: Legend of the Crystal Beasts', 'x16677.png']
      ])
    )
  })

  it('walks every page, stores the matches and shows them as logos after Yugipedia’s', async () => {
    const db = await seededDb()
    db.exec(`INSERT INTO sets (language, set_name, set_code) VALUES
      ('en', 'Legend of Blue Eyes White Dragon', 'LOB'), ('en', 'Rarity Collection 5', 'RA05')`)
    const fetchFn = vi.fn(async (url: string) =>
      url.endsWith('page=1')
        ? new Response(page(2, post(9, 'Rarity Collection 5 is here', `${UP}ra05.jpg`)))
        : new Response(page(2, post(8, 'Legend of Blue Eyes White Dragon returns', `${UP}lob.png`)))
    )
    const now = new Date('2026-10-24T00:00:00Z')
    expect(await refreshKonamiLogos(db, { version: '1', fetchFn: fetchFn as unknown as typeof fetch, now })).toBe(2)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(shouldRefreshKonamiLogos(db, now)).toBe(false)

    const lob = `https://img.konami.com${UP}lob.png`
    const key = konamiLogoKey(lob)!
    expect(key).toMatch(/^km-[0-9a-f]{20}$/)
    expect(listSets(db).find((s) => s.setCode === 'LOB')!.logoImageKey).toBe(key)
    expect(getChecklist(db, 'Legend of Blue Eyes White Dragon', 'en')?.set.logoImageKey).toBe(key)
    expect(findSetImageUrl(db, key)).toBe(lob)
    expect(findSetImageUrl(db, konamiLogoKey(`https://img.konami.com${UP}ra05.jpg`)!)).not.toBeNull()

    db.exec(`INSERT INTO set_logos (set_name, image_url, image_key)
      VALUES ('Legend of Blue Eyes White Dragon', 'https://ms.yugipedia.com/l.png', 'yp-lob')`)
    expect(listSets(db).find((s) => s.setCode === 'LOB')!.logoImageKey).toBe('yp-lob')
  })

  it('keeps stored logos when a page fails', async () => {
    const db = await seededDb()
    db.exec(`INSERT INTO konami_logos (set_name, image_url, image_key) VALUES ('X', 'u', 'km-1')`)
    const fetchFn = vi.fn(async () => new Response('busy', { status: 503 }))
    expect(await refreshKonamiLogos(db, { version: '1', fetchFn: fetchFn as unknown as typeof fetch })).toBe(0)
    expect(db.prepare('SELECT count(*) AS n FROM konami_logos').get()).toEqual({ n: 1 })
    expect(shouldRefreshKonamiLogos(db, new Date())).toBe(true)
  })

  it('keys only img.konami.com', () => {
    expect(konamiLogoKey('https://evil.example/a.png')).toBeNull()
    expect(konamiLogoKey(null)).toBeNull()
  })
})
