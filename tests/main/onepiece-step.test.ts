import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { PNG } from 'pngjs'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { distance } from '../../scripts/catalog/onepiece/art'
import { parseCardList, parseSeriesList } from '../../scripts/catalog/onepiece/bandai'
import { logOnePiece, runOnePieceStep } from '../../scripts/catalog/onepiece'
import type { OnePieceSources } from '../../scripts/catalog/onepiece/sources'
import type { OpProduct } from '../../scripts/catalog/onepiece/tcgcsv'
import type { BandaiEntry } from '../../scripts/catalog/onepiece/types'
import type { TcGroup, TcPrice } from '../../scripts/catalog/pokemon/types'
import { decodeImage } from '../../scripts/catalog/references'
import { openDatabase } from '../../src/main/db/database'
import { artHash } from '../../src/shared/scan/fingerprint'
import { onePieceDonCardId } from '../../src/shared/games'
import { hashHex } from '../../src/shared/scan/fingerprintRefs'

const read = (name: string): string =>
  readFileSync(join(__dirname, '../fixtures/onepiece', name), 'utf8')
const json = (name: string): { results: Record<string, unknown>[] } => JSON.parse(read(name))

const SERIES = parseSeriesList(read('bandai-op17.html')).series
const [OP17, EB04, PROMO] = SERIES
const PAGES: Record<string, BandaiEntry[]> = {
  [OP17.id]: parseCardList(read('bandai-op17.html'), OP17.id).entries,
  [EB04.id]: parseCardList(read('bandai-op15eb04.html'), EB04.id).entries,
  [PROMO.id]: parseCardList(read('bandai-promo.html'), PROMO.id).entries
}
const GROUPS: TcGroup[] = json('tcgcsv-groups.json').results.map((g) => ({
  groupId: g.groupId as number,
  name: g.name as string,
  abbreviation: (g.abbreviation as string) ?? null,
  publishedOn: g.publishedOn as string
}))
const OP17_GROUP = 24736
const PRODUCTS: OpProduct[] = json('tcgcsv-op17-products.json').results.map((p) => {
  const ext = p.extendedData as { name: string; value: string }[]
  const field = (n: string): string | null => ext.find((e) => e.name === n)?.value ?? null
  return {
    productId: p.productId as number,
    groupId: p.groupId as number,
    name: p.name as string,
    number: field('Number'),
    rarity: field('Rarity'),
    imageUrl: p.imageUrl as string
  }
})
const PRICES: TcPrice[] = json('tcgcsv-op17-prices.json').results.map((p) => ({
  productId: p.productId as number,
  subTypeName: p.subTypeName as string,
  marketPrice: (p.marketPrice as number | null) ?? null
}))

/** A 60x84 picture of random grey blocks; `tweak` shifts one block, a few hash bits away. */
function png(seed: number, tweak = 0): Uint8Array {
  const p = new PNG({ width: 60, height: 84 })
  let s = (seed * 2654435761) >>> 0
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
  const cells = Array.from({ length: 6 * 7 }, () => Math.floor(rnd() * 256))
  for (let y = 0; y < 84; y++) {
    for (let x = 0; x < 60; x++) {
      const i = (y * 60 + x) * 4
      let v = cells[Math.floor(y / 12) * 6 + Math.floor(x / 10)]
      if (tweak && x < 10 && y < 12) v = (v + tweak) % 256
      p.data[i] = p.data[i + 1] = p.data[i + 2] = v
      p.data[i + 3] = 255
    }
  }
  return new Uint8Array(PNG.sync.write(p))
}
const hashOf = (b: Uint8Array): string => hashHex(artHash(decodeImage(b)!))

/** Each Bandai version and the TCGplayer product of the same art share a picture. */
const ART: Record<string, number> = {
  'OP17-005': 1,
  'OP17-005_p1': 2,
  'OP17-005_p2': 3,
  'EB04-061_p2': 4
}
const TCG_ART: Record<number, number> = { 711499: 1, 708077: 2, 712083: 3, 710857: 4 }

interface Night {
  entries?: Record<string, BandaiEntry[]>
  products?: OpProduct[]
  prices?: TcPrice[]
  /** productId to a picture (seed, tweak). */
  tcgArt?: Record<number, [number, number]>
  throwOn?: 'prices'
  /** This group's products and prices requests fail. */
  failGroup?: number
}

function fakeSources(n: Night = {}): OnePieceSources {
  const pages = n.entries ?? PAGES
  let other = 100
  const bandaiSeed = new Map<string, number>()
  const products = n.products ?? PRODUCTS
  return {
    async series() {
      return { series: SERIES.map((s) => ({ ...s })), notes: [] }
    },
    async entries(series) {
      return { entries: series.flatMap((s) => pages[s.id] ?? []), problems: [], notes: [] }
    },
    async groups() {
      return GROUPS
    },
    async products(groupId) {
      if (groupId === n.failGroup) throw new Error(`GET https://tcgcsv.com/tcgplayer/68/${groupId}/products returned 404`)
      return groupId === OP17_GROUP ? products : []
    },
    async prices(groupId) {
      if (n.throwOn === 'prices')
        throw new Error('GET https://tcgcsv.com/tcgplayer/68/24736/prices returned 503')
      if (groupId === n.failGroup) throw new Error(`GET https://tcgcsv.com/tcgplayer/68/${groupId}/prices returned 404`)
      return groupId === OP17_GROUP ? (n.prices ?? PRICES) : []
    },
    async bandaiImage(id) {
      if (!bandaiSeed.has(id)) bandaiSeed.set(id, ART[id] ?? other++)
      return { bytes: png(bandaiSeed.get(id)!), lastModified: 'Mon, 01 Jan 2026 00:00:00 GMT' }
    },
    async tcgImage(url) {
      const id = Number(/\/(\d+)_200w\.jpg$/.exec(url)![1])
      const [seed, tweak] = n.tcgArt?.[id] ?? [TCG_ART[id] ?? 500 + id, 0]
      return png(seed, tweak)
    }
  }
}

const NOW = Date.parse('2026-11-04T06:00:00Z')
const DAY = 24 * 60 * 60 * 1000

let dir: string
let work: Database.Database
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'op-step-'))
  work = openDatabase(join(dir, 'work.sqlite'))
})
afterEach(() => {
  work.close()
  rmSync(dir, { recursive: true, force: true })
})

const night = (
  sources: OnePieceSources,
  at = NOW,
  log: string[] = []
): ReturnType<typeof runOnePieceStep> =>
  runOnePieceStep(work, {
    cachePath: join(dir, 'onepiece-src.sqlite'),
    version: 'test',
    log: (l) => log.push(l),
    sources,
    now: () => new Date(at)
  })

interface Row {
  set_rarity_code: string
  set_rarity: string
  tcg_product_id: number | null
  market_price: number | null
}
const row = (bandaiId: string): Row | undefined =>
  work
    .prepare(
      "SELECT set_rarity_code, set_rarity, tcg_product_id, market_price FROM card_printings WHERE game = 'op' AND set_rarity_code = ?"
    )
    .get(bandaiId) as Row | undefined
const opRows = (): number =>
  (
    work.prepare("SELECT COUNT(*) AS n FROM card_printings WHERE game = 'op'").get() as {
      n: number
    }
  ).n

describe('runOnePieceStep', () => {
  test('the test pictures are far apart, and a tweaked one is near its original', () => {
    const seeds = [1, 2, 3, 4]
    for (const a of seeds)
      for (const b of seeds)
        if (a < b) expect(distance(hashOf(png(a)), hashOf(png(b)))).toBeGreaterThan(64)
    const d = distance(hashOf(png(2)), hashOf(png(2, 60)))
    expect(d).toBeGreaterThan(0)
    expect(d).toBeLessThanOrEqual(24)
  })

  test('end to end: OP17-005 versions priced', async () => {
    const log: string[] = []
    const out = await night(fakeSources(), NOW, log)
    expect(out.error).toBeNull()
    expect(out.problems).toEqual([])
    expect(['OP17-005', 'OP17-005_p1', 'OP17-005_p2'].map(row)).toEqual([
      { set_rarity_code: 'OP17-005', set_rarity: 'SR', tcg_product_id: 711499, market_price: 0.75 },
      {
        set_rarity_code: 'OP17-005_p1',
        set_rarity: 'SR (Alternate Art)',
        tcg_product_id: 708077,
        market_price: 10.79
      },
      {
        set_rarity_code: 'OP17-005_p2',
        set_rarity: 'SR (Manga)',
        tcg_product_id: 712083,
        market_price: 1076.92
      }
    ])
    // A reprint listed on OP-17 and EB04 is kept once, on OP-17, as SP; its product has no price yet.
    expect(row('EB04-061_p2')).toEqual({
      set_rarity_code: 'EB04-061_p2',
      set_rarity: 'SP',
      tcg_product_id: 710857,
      market_price: null
    })
    // Promos and cards with no product are written unpriced; an unmatched parallel waits.
    expect(row('EB01-043_p1')?.market_price).toBeNull()
    expect(row('EB04-061_p1')).toBeUndefined()
    // The DON!! card, in its group's set, priced from its one (Foil) row.
    expect(row('tcg:710859/Foil')).toEqual({
      set_rarity_code: 'tcg:710859/Foil',
      set_rarity: 'DON!! (Foil)',
      tcg_product_id: 710859,
      market_price: 5.55
    })
    expect(
      work.prepare('SELECT name, "desc" FROM cards WHERE id = ?').get(onePieceDonCardId('en', 710859))
    ).toEqual({ name: 'DON!! (Alternate Art) (Gold)', desc: '' })
    const r = out.report!
    expect(r).toMatchObject({
      series: 3,
      printings: 11,
      priced: 4,
      held: 1,
      images: 12,
      tcgOnly: 4,
      don: 1,
      donPriced: 1,
      donHeld: 0
    })
    expect(r.perSet).toEqual([
      { setCode: 'OP15-EB04', printings: 1, priced: 0 },
      { setCode: 'OP17', printings: 8, priced: 4 },
      { setCode: 'P', printings: 2, priced: 0 }
    ])
    expect(r.notes).toContain('EB04-061_p2 is listed in OP15-EB04 and OP17; kept in OP17')

    const lines: string[] = []
    logOnePiece(r, (l) => lines.push(l))
    expect(lines[0]).toBe(
      `One Piece en: 3 series, ${r.cards} cards, 11 printings (4 priced, 7 unpriced, 1 held), 12 images, 4 TCGplayer-only products skipped, 1 DON!! cards (1 priced printings, 0 held), ${r.notes.length} notes`
    )
    expect(lines).toContain('One Piece en OP17: 4/8 priced')
    for (const n of r.notes) expect(lines).toContain(`One Piece en: ${n}`)
  })

  test('a second night with no change writes nothing new', async () => {
    await night(fakeSources())
    const before = work.prepare("SELECT * FROM card_printings WHERE game = 'op' ORDER BY id").all()
    const out = await night(fakeSources(), NOW + DAY)
    expect(out.error).toBeNull()
    expect(out.problems).toEqual([])
    expect(
      work.prepare("SELECT * FROM card_printings WHERE game = 'op' ORDER BY id").all()
    ).toEqual(before)
  })

  test('a throwing source writes nothing', async () => {
    const out = await night(fakeSources({ throwOn: 'prices' }))
    expect(out.report).toBeNull()
    expect(out.error).toContain('every TCGCSV group failed')
    expect(out.error).toContain('returned 503')
    expect(opRows()).toBe(0)
    expect(
      (work.prepare("SELECT COUNT(*) AS n FROM cards WHERE game = 'op'").get() as { n: number }).n
    ).toBe(0)
  })

  test('one failing TCGCSV group sits the night out: a problem the first night, a note after', async () => {
    await night(fakeSources())
    const before = ['OP17-005', 'OP17-005_p1', 'OP17-005_p2'].map(row)
    const doubled = PRICES.map((p) => ({ ...p, marketPrice: p.marketPrice === null ? null : p.marketPrice * 2 }))
    const name = GROUPS.find((g) => g.groupId === OP17_GROUP)!.name
    const line = `TCGCSV group 24736 (${name}) failed: GET https://tcgcsv.com/tcgplayer/68/24736/products returned 404; its printings keep their products and prices`

    const second = await night(fakeSources({ failGroup: OP17_GROUP, prices: doubled }), NOW + DAY)
    expect(second.error).toBeNull()
    expect(second.problems).toEqual([line])
    expect(['OP17-005', 'OP17-005_p1', 'OP17-005_p2'].map(row)).toEqual(before)

    const third = await night(fakeSources({ failGroup: OP17_GROUP, prices: doubled }), NOW + 2 * DAY)
    expect(third.error).toBeNull()
    expect(third.problems).toEqual([])
    expect(third.report!.notes).toContain(`${line} (failing since 2026-11-05)`)
    expect(['OP17-005', 'OP17-005_p1', 'OP17-005_p2'].map(row)).toEqual(before)

    // A good night ends the run and prices move again; the next failure is news.
    const fourth = await night(fakeSources({ prices: doubled }), NOW + 3 * DAY)
    expect(fourth.problems).toEqual([])
    expect(row('OP17-005')?.market_price).toBe(1.5)
    const fifth = await night(fakeSources({ failGroup: OP17_GROUP }), NOW + 4 * DAY)
    expect(fifth.problems).toHaveLength(1)
  })

  test('a cache file that is not SQLite is an error, and nothing is written', async () => {
    const cachePath = join(dir, 'onepiece-src.sqlite')
    writeFileSync(
      cachePath,
      'not a database, just text that is long enough to fill a header '.repeat(4)
    )
    const out = await runOnePieceStep(work, {
      cachePath,
      version: 'test',
      log: () => {},
      sources: fakeSources(),
      now: () => new Date(NOW)
    })
    expect(out.report).toBeNull()
    expect(out.error).toMatch(/not a database/i)
    expect(opRows()).toBe(0)
  })

  describe('a share drop is a problem', () => {
    /** One OP-17 set of `n` base cards, renumbered from OP17-005, each with its own product. */
    function renumbered(n: number): { night: (prices: boolean) => Night } {
      const base = PAGES[OP17.id].find((e) => e.bandaiId === 'OP17-005')!
      const entries: BandaiEntry[] = []
      const products: OpProduct[] = []
      for (let i = 0; i < n; i++) {
        const number = `OP17-${String(101 + i).padStart(3, '0')}`
        entries.push({ ...base, bandaiId: number, number })
        const productId = 900000 + i
        products.push({
          productId,
          groupId: OP17_GROUP,
          name: `Edward.Newgate (${number.slice(5)})`,
          number,
          rarity: 'SR',
          imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_200w.jpg`
        })
        ART[number] = 1000 + i
        TCG_ART[productId] = 1000 + i
      }
      return {
        night: (priced) => ({
          entries: { [OP17.id]: entries },
          products,
          prices: priced
            ? products.map((p, i) => ({
                productId: p.productId,
                subTypeName: 'Normal',
                marketPrice: 1 + i
              }))
            : []
        })
      }
    }

    test('20 printings going from 100% to 0% priced', async () => {
      const set = renumbered(20)
      const first = await night(fakeSources(set.night(true)))
      expect(first.problems).toEqual([])
      expect(first.report!.perSet).toEqual([{ setCode: 'OP17', printings: 20, priced: 20 }])
      const second = await night(fakeSources(set.night(false)), NOW + DAY)
      expect(second.report!.perSet).toEqual([{ setCode: 'OP17', printings: 20, priced: 0 }])
      expect(second.problems).toContain('OP17 priced share fell from 100% to 0%')
    })

    test('a set that grows with unpriced printings, keeping every price, is no problem', async () => {
      // As the catalog fills in, a set can go from 20 printings to 100 with only the first 20 priced.
      const small = renumbered(20)
      await night(fakeSources(small.night(true)))
      const big = renumbered(100).night(true)
      const kept = new Set(big.products!.slice(0, 20).map((p) => p.productId))
      const second = await night(
        fakeSources({ ...big, prices: big.prices!.filter((p) => kept.has(p.productId)) }),
        NOW + DAY
      )
      expect(second.report!.perSet).toEqual([{ setCode: 'OP17', printings: 100, priced: 20 }])
      expect(second.problems).toEqual([])
    })

    test('the same drop on 4 printings is no problem', async () => {
      const set = renumbered(4)
      await night(fakeSources(set.night(true)))
      const second = await night(fakeSources(set.night(false)), NOW + DAY)
      expect(second.report!.perSet).toEqual([{ setCode: 'OP17', printings: 4, priced: 0 }])
      expect(second.problems).toEqual([])
    })
  })

  test('stored products feed the matcher', async () => {
    // Night 1: _p1 matches a picture a few bits off; _p2's product isn't listed yet.
    const near: Record<number, [number, number]> = { 708077: [2, 60] }
    const first = await night(
      fakeSources({ products: PRODUCTS.filter((p) => p.productId !== 712083), tcgArt: near })
    )
    expect(first.error).toBeNull()
    expect(row('OP17-005_p1')?.tcg_product_id).toBe(708077)
    // Night 2: _p2's product arrives, and with it a closer one for _p1.
    const closer: OpProduct = {
      productId: 799999,
      groupId: OP17_GROUP,
      name: 'Edward.Newgate (005) (Alternate Art) (Reprint)',
      number: 'OP17-005',
      rarity: 'SR',
      imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/799999_200w.jpg'
    }
    const second = await night(
      fakeSources({ products: [...PRODUCTS, closer], tcgArt: { ...near, 799999: [2, 0] } }),
      NOW + DAY
    )
    expect(second.error).toBeNull()
    expect(row('OP17-005_p1')).toMatchObject({ tcg_product_id: 708077, market_price: 10.79 })
    expect(row('OP17-005_p2')?.tcg_product_id).toBe(712083)
    expect(second.report!.notes).toContain('OP17-005_p1: matches 799999 now, keeps 708077')
  })
})
