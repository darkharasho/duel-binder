import { describe, expect, it, vi } from 'vitest'
import { getChecklist, listSets } from '../../src/main/repo/sets'
import {
  packArtKey,
  parseProductListing,
  refreshPackArt,
  shouldRefreshPackArt
} from '../../src/main/konami/packArt'
import { seededDb } from './helpers'

const item = (img: string, alt: string, slug: string): string => `
  <li><div class="bg"></div><section class="detail clear"><section class="alpha">
    <a href="#"><img src="/en/wp-content/uploads/${img}" alt="${alt}" /></a>
    <h3><a href="#">${alt}</a></h3></section>
    <p class="date">Release Date: 12/04/2026</p>
    <a class="btn" href="/en/products/${slug}/">Learn more ></a></section></li>`

const page = (...items: string[]): string =>
  `<ul><li><img class="logo" src="/logo.png" alt="Yu-Gi-Oh!"></li>${items.join('')}</ul>`

describe('official pack art', () => {
  it('reads each product with its image, name and code', () => {
    expect(
      parseProductListing(
        page(
          item('2026/08/BETB_550.png', 'Beyond the Brave', 'betb'),
          item('2020/09/x.png', 'Destiny Masters &#038; Duelists<br>(All-Foil Edition)', 'sdds')
        )
      )
    ).toEqual([
      {
        code: 'BETB',
        name: 'Beyond the Brave',
        imageUrl: 'https://www.yugioh-card.com/en/wp-content/uploads/2026/08/BETB_550.png'
      },
      {
        code: 'SDDS',
        name: 'Destiny Masters & Duelists (All-Foil Edition)',
        imageUrl: 'https://www.yugioh-card.com/en/wp-content/uploads/2020/09/x.png'
      }
    ])
  })

  it('keys only the site’s own uploads', () => {
    expect(packArtKey('https://www.yugioh-card.com/en/wp-content/uploads/a.png')).toMatch(
      /^yc-[0-9a-f]{20}$/
    )
    expect(packArtKey('https://evil.example/a.png')).toBeNull()
  })

  it('matches products to English sets by code or name and shows them on the set', async () => {
    const db = await seededDb()
    db.exec(`INSERT INTO sets (language, set_name, set_code) VALUES
      ('en', 'Legend of Blue Eyes White Dragon', 'LOB'), ('en', 'Starter Deck: Yugi', 'SDY')`)
    const fetchFn = vi.fn(async (url: string) =>
      url.includes('/booster-pack/')
        ? new Response(page(item('lob.png', 'Some Other Title', 'lob')))
        : url.includes('/starter-deck/')
          ? new Response(
              page(
                item('sdy.png', 'Starter Deck: Yugi’s', 'nomatch'),
                item('sdy2.png', 'starter deck yugi', 'x')
              )
            )
          : new Response(page())
    )
    const now = new Date('2026-10-24T00:00:00Z')
    expect(
      await refreshPackArt(db, { version: '1', fetchFn: fetchFn as unknown as typeof fetch, now })
    ).toBe(2)
    expect(shouldRefreshPackArt(db, now)).toBe(false)

    const sets = listSets(db)
    const lob = sets.find((s) => s.setCode === 'LOB')!
    expect(lob.packImageKey).toBe(
      packArtKey('https://www.yugioh-card.com/en/wp-content/uploads/lob.png')
    )
    expect(sets.find((s) => s.setCode === 'SDY')!.packImageKey).toBe(
      packArtKey('https://www.yugioh-card.com/en/wp-content/uploads/sdy2.png')
    )
    expect(getChecklist(db, 'Legend of Blue Eyes White Dragon', 'en')?.set.packImageKey).toBe(
      lob.packImageKey
    )
  })

  it('keeps stored art when a listing fails', async () => {
    const db = await seededDb()
    db.exec(`INSERT INTO pack_art (set_name, image_url, image_key) VALUES ('X', 'u', 'yc-1')`)
    const fetchFn = vi.fn(async () => new Response('down', { status: 503 }))
    expect(
      await refreshPackArt(db, { version: '1', fetchFn: fetchFn as unknown as typeof fetch })
    ).toBe(0)
    expect(db.prepare('SELECT count(*) AS n FROM pack_art').get()).toEqual({ n: 1 })
    expect(shouldRefreshPackArt(db, new Date())).toBe(true)
  })
})
