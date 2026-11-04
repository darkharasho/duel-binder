import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BANDAI_EN, packShots, parseCardList, parseProductTiles, parseSeriesList } from '../../scripts/catalog/onepiece/bandai'
import { openOpCache, type OpCache } from '../../scripts/catalog/onepiece/cache'
import { createOnePieceSources, readPackShots, type OnePieceSources } from '../../scripts/catalog/onepiece/sources'
import { opPackKey, writeOnePiece, type OpPlan } from '../../scripts/catalog/onepiece/write'
import { openDatabase } from '../../src/main/db/database'
import { localScope } from '../../src/main/repo/scope'
import { findSetImageUrl, listSets } from '../../src/main/repo/sets'
import { isOpPackUrl } from '../../src/shared/imageSources'

const read = (name: string): string => readFileSync(join(__dirname, '../fixtures/onepiece', name), 'utf8')

/** One `/products/` tile as Bandai writes it; `series` null for a product with no card list. */
const tile = (href: string, img: string, series: string | null): string => `
  <li class="linkListColBox" data-cat="boosters">
    <a href="${href}" class="linkListColItem">
      <div class="linkListColThumb">
        <img class="lazy" src="/renewal/images/common/thumbnail/img_thumbnail_sq.webp" data-src="${img}" alt="">
      </div>
      <h4 class="linkListColTitle">A PRODUCT</h4>
    </a>
    ${series ? `<a class="linkListColBtn" href="https://en.onepiece-cardgame.com/cardlist/?series=${series}">CARDS</a>` : ''}
  </li>`
const listing = (...tiles: string[]): string => `<ul class="linkListColInner">${tiles.join('')}</ul>`

const OP17_SHOT = 'https://en.onepiece-cardgame.com/onepiececg/bccard/en/product/2026/07/10/UZto2ePj0hiv3KkV/img_item01.webp'
const OP01_SHOT = 'https://en.onepiece-cardgame.com/renewal/images/products/boosters/op01/img_item01.webp'

describe('parseProductTiles', () => {
  it('reads each tile, resolving a site-relative shot and dropping the cache buster', () => {
    const html = listing(
      tile('https://en.onepiece-cardgame.com/products/op17.html', '/onepiececg/bccard/en/product/2026/07/10/UZto2ePj0hiv3KkV/img_item01.webp?_=6ed86e56', '569117'),
      tile('https://en.onepiece-cardgame.com/products/boosters/op01.php', `${OP01_SHOT}?_=b22d3b4f`, '569101'),
      tile('https://en.onepiece-cardgame.com/products/sleeve045.html', '/onepiececg/bccard/en/products/2026/09/18/x/img_item01.webp', null),
      tile('https://en.onepiece-cardgame.com/products/elsewhere.html', 'https://evil.example/pack.webp', '569102')
    )
    expect(parseProductTiles(html, BANDAI_EN)).toEqual([
      { href: 'https://en.onepiece-cardgame.com/products/op17.html', seriesId: '569117', imageUrl: OP17_SHOT },
      { href: 'https://en.onepiece-cardgame.com/products/boosters/op01.php', seriesId: '569101', imageUrl: OP01_SHOT },
      { href: 'https://en.onepiece-cardgame.com/products/sleeve045.html', seriesId: null, imageUrl: 'https://en.onepiece-cardgame.com/onepiececg/bccard/en/products/2026/09/18/x/img_item01.webp' },
      // Off Bandai's image folders: no shot.
      { href: 'https://en.onepiece-cardgame.com/products/elsewhere.html', seriesId: '569102', imageUrl: null }
    ])
  })

  it('packShots takes the first subcategory listing a series, and its oldest tile', () => {
    const t = (seriesId: string, imageUrl: string): { href: string; seriesId: string; imageUrl: string } =>
      ({ href: imageUrl, seriesId, imageUrl })
    const shots = packShots([
      { subcategory: 'others', tiles: [t('569101', `${OP01_SHOT}#bundle`)] },
      { subcategory: 'boosters', tiles: [t('569101', `${OP01_SHOT}#reprint`), t('569117', OP17_SHOT)] },
      { subcategory: 'boosters', tiles: [t('569101', OP01_SHOT)] },
      { subcategory: 'others', tiles: [t('569999', `${OP01_SHOT}#only-other`)] }
    ])
    expect([...shots]).toEqual([
      ['569101', OP01_SHOT],
      ['569117', OP17_SHOT],
      ['569999', `${OP01_SHOT}#only-other`]
    ])
  })
})

describe('the packShots source', () => {
  let dir: string
  let cache: OpCache
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'op-packs-')); cache = openOpCache(join(dir, 'c.db')) })
  afterEach(() => { cache.close(); rmSync(dir, { recursive: true, force: true }) })

  const source = (pages: Record<string, string>, requests: string[]): OnePieceSources =>
    createOnePieceSources({
      cache, version: '1.0.0', pageGapMs: 0, retryDelayMs: 1,
      fetch: (async (input: RequestInfo | URL) => {
        const url = String(input)
        requests.push(url.slice(url.indexOf('?')))
        return new Response(pages[url.slice(url.indexOf('?'))] ?? listing(), { status: 200 })
      }) as typeof fetch
    })

  it('reads every page of each subcategory, past a page of sleeves, until one adds nothing', async () => {
    const sleeves = listing(tile('/products/sleeve045.html', '/onepiececg/bccard/en/products/s/img_item01.webp', null))
    const p1 = listing(tile('/products/op17.html', OP17_SHOT, '569117'))
    const requests: string[] = []
    const src = source({
      '?subcategory=boosters&page=1': p1,
      // Past the last page Bandai shows the last page again.
      '?subcategory=boosters&page=2': p1,
      '?subcategory=others&page=1': sleeves,
      '?subcategory=others&page=2': listing(tile('/products/op01.php', OP01_SHOT, '569101')),
      '?subcategory=others&page=3': listing()
    }, requests)
    const shots = await src.packShots!()
    expect([...shots]).toEqual([['569117', OP17_SHOT], ['569101', OP01_SHOT]])
    expect(requests).toEqual([
      '?subcategory=boosters&page=1', '?subcategory=boosters&page=2',
      '?subcategory=decks&page=1',
      '?subcategory=others&page=1', '?subcategory=others&page=2', '?subcategory=others&page=3'
    ])
  })

  it('readPackShots notes a failed or empty listing and keeps the stored shots', async () => {
    const series = parseSeriesList(read('bandai-op17.html')).series
    const failing = { packShots: async () => { throw new Error('boom') } } as unknown as OnePieceSources
    expect(await readPackShots(failing, series)).toEqual({
      shots: undefined, notes: ['Bandai product listing failed: boom; set pack shots kept']
    })
    const empty = { packShots: async () => new Map() } as unknown as OnePieceSources
    expect((await readPackShots(empty, series)).shots).toBeUndefined()
    expect(await readPackShots({} as OnePieceSources, series)).toEqual({ shots: undefined, notes: [] })
    const some = { packShots: async () => new Map([['569117', OP17_SHOT]]) } as unknown as OnePieceSources
    const r = await readPackShots(some, series)
    expect(r.shots?.get('569117')).toBe(OP17_SHOT)
    // Only boosters and decks are expected to have one.
    const missing = series.filter((s) => s.id !== '569117' && (s.kind === 'booster' || s.kind === 'deck'))
    expect(r.notes).toEqual(missing.length ? [`No pack shot on Bandai's product listing: ${missing.map((s) => s.setCode).join(', ')}`] : [])
  })
})

describe('One Piece pack shots in the catalog', () => {
  const SERIES = parseSeriesList(read('bandai-op17.html')).series
  const OP17 = SERIES.find((s) => s.id === '569117')!
  const PROMO = SERIES.find((s) => s.kind === 'promo')!
  const ENTRIES = parseCardList(read('bandai-op17.html'), OP17.id).entries.slice(0, 2)
  const PROMO_ENTRY = parseCardList(read('bandai-promo.html'), PROMO.id).entries[0]
  const NOW = Date.parse('2026-11-04T06:00:00Z')

  let dir: string
  let db: Database.Database
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'op-packs-db-')); db = openDatabase(join(dir, 'work.sqlite')) })
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

  const write = (packShots?: Map<string, string>): void => {
    const entries = [...ENTRIES, PROMO_ENTRY]
    const plan: OpPlan = {
      series: SERIES, entries, groupOf: new Map(), matches: new Map(), prices: new Map(),
      hashed: new Set(entries.map((e) => e.bandaiId)), frozen: new Set(), firstSeen: new Map(), packShots
    }
    writeOnePiece(db, plan, { now: NOW, nowIso: new Date(NOW).toISOString() })
  }
  const setRows = (): { set_code: string; image_url: string | null; image_key: string | null }[] =>
    db.prepare("SELECT set_code, image_url, image_key FROM sets WHERE game = 'op' ORDER BY set_code").all() as never

  it('stores a booster’s shot under its ob- key, keeps it when the listing is unread, and moves with it', () => {
    const shots = new Map([[OP17.id, OP17_SHOT], [PROMO.id, OP01_SHOT]])
    write(shots)
    const key = opPackKey(OP17_SHOT)
    expect(key).toMatch(/^ob-[0-9a-f]{20}$/)
    // The promotion cards take no shot, even one the listing links.
    expect(setRows()).toEqual([
      { set_code: 'OP17', image_url: OP17_SHOT, image_key: key },
      { set_code: 'P', image_url: null, image_key: null }
    ])

    write(undefined)
    expect(setRows()[0]).toEqual({ set_code: 'OP17', image_url: OP17_SHOT, image_key: key })

    const moved = OP17_SHOT.replace('UZto2ePj0hiv3KkV', 'NewShot0000000000')
    write(new Map([[OP17.id, moved]]))
    expect(setRows()[0]).toEqual({ set_code: 'OP17', image_url: moved, image_key: opPackKey(moved) })
  })

  it('the sets list shows it as the pack, and the key resolves to Bandai only', () => {
    write(new Map([[OP17.id, OP17_SHOT]]))
    const op = listSets(db, localScope("'op'")).find((s) => s.setCode === 'OP17')!
    expect(op.packImageKey).toBe(opPackKey(OP17_SHOT))
    expect(findSetImageUrl(db, opPackKey(OP17_SHOT))).toBe(OP17_SHOT)
    expect(isOpPackUrl(OP17_SHOT)).toBe(true)
    expect(isOpPackUrl('https://en.onepiece-cardgame.com/images/cardlist/card/OP17-005.png')).toBe(false)
  })
})
