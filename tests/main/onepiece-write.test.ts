import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { parseCardList, parseSeriesList } from '../../scripts/catalog/onepiece/bandai'
import type { DonCard } from '../../scripts/catalog/onepiece/don'
import type { OpMatch } from '../../scripts/catalog/onepiece/match'
import type { BandaiEntry } from '../../scripts/catalog/onepiece/types'
import { HOLD_UNMATCHED_MS, writeOnePiece, type OnePieceReport, type OpPlan } from '../../scripts/catalog/onepiece/write'
import { openDatabase } from '../../src/main/db/database'
import { runSync } from '../../src/main/sync/sync'
import type { YgoClient } from '../../src/main/ygo/client'
import type { ApiCard } from '../../src/main/ygo/mapCard'
import { CATALOG_TABLES } from '../../src/shared/catalogTables'
import { onePieceCardId, onePieceDonCardId, onePieceDonImageId, onePieceImageId } from '../../src/shared/games'
import fixture from '../fixtures/cardinfo.sample.json'
import { seedPokemon } from '../fixtures/pokemon'

const read = (name: string): string => readFileSync(join(__dirname, '../fixtures/onepiece', name), 'utf8')
const SERIES = parseSeriesList(read('bandai-op17.html')).series
const OP17 = SERIES[0]
const FX = parseCardList(read('bandai-op17.html'), OP17.id).entries
const fx = (id: string): BandaiEntry => FX.find((e) => e.bandaiId === id)!
const entry = (o: Partial<BandaiEntry>): BandaiEntry => ({ ...fx('OP17-005'), ...o })
const GROUP = { groupId: 24736, name: "The World's Strongest Warriors", abbreviation: 'OP17', publishedOn: '2026-08-28T00:00:00' }
const NOW = Date.parse('2026-11-04T06:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const TRIO = ['OP17-005', 'OP17-005_p1', 'OP17-005_p2'].map(fx)

interface PlanIn {
  entries: BandaiEntry[]
  /** bandaiId to [productId, label]. */
  matches?: Record<string, [number, string | null]>
  prices?: Record<number, number | null>
  hashed?: string[]
  frozen?: string[]
  firstSeen?: Record<string, number>
  don?: DonCard[]
  /** DON!! product ids listed tonight; defaults to those of `don`. */
  donListed?: number[]
  donComplete?: boolean
}

function plan(p: PlanIn): OpPlan {
  const matches = new Map<string, OpMatch>()
  for (const [bandaiId, [productId, label]] of Object.entries(p.matches ?? {})) {
    const e = p.entries.find((x) => x.bandaiId === bandaiId)
    if (!e) continue
    matches.set(bandaiId, {
      bandaiId, label,
      product: { productId, groupId: GROUP.groupId, name: '', number: e.number, rarity: e.rarity, imageUrl: null }
    })
  }
  return {
    series: SERIES,
    entries: p.entries,
    groupOf: new Map([[OP17.id, GROUP]]),
    matches,
    prices: new Map(Object.entries(p.prices ?? {}).map(([k, v]) => [Number(k), v])),
    hashed: new Set(p.hashed ?? p.entries.map((e) => e.bandaiId)),
    frozen: new Set(p.frozen ?? []),
    firstSeen: new Map(Object.entries(p.firstSeen ?? {})),
    don: {
      cards: p.don ?? [],
      listed: new Set(p.donListed ?? (p.don ?? []).map((d) => d.productId)),
      complete: p.donComplete ?? true
    }
  }
}

const PROMO_ID = SERIES[2].id
const ACE: DonCard = {
  productId: 593801, seriesId: OP17.id, name: 'DON!! (Ace)', description: 'Your Turn +1000',
  versions: [
    { code: 'tcg:593801/Normal', label: 'DON!!', price: 4.85 },
    { code: 'tcg:593801/Foil', label: 'DON!! (Foil)', price: 13.16 }
  ]
}
const GOLD: DonCard = {
  productId: 482236, seriesId: PROMO_ID, name: 'DON!! (Gold)', description: null,
  versions: [{ code: 'tcg:482236/Normal', label: 'DON!!', price: null }]
}

let dir: string
let db: Database.Database

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'op-write-'))
  db = openDatabase(join(dir, 'work.sqlite'))
  const client: YgoClient = {
    fetchDbVersion: async () => ({ databaseVersion: '1', lastUpdate: '2026-10-22' }),
    fetchCardInfo: async () => fixture.data as ApiCard[],
    fetchCardSets: async () => []
  }
  await runSync(db, client, () => {}, new Date('2026-10-23T12:00:00.000Z'))
  seedPokemon(db)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const write = (p: PlanIn, now = NOW): OnePieceReport =>
  writeOnePiece(db, plan(p), { now, nowIso: new Date(now).toISOString() })

interface Printing {
  id: number; card_id: number; set_name: string; set_code: string; set_rarity: string; set_rarity_code: string
  tcg_product_id: number | null; market_price: number | null; missing_from_api: number; pkey: string
}
const printings = (): Printing[] =>
  db.prepare("SELECT * FROM card_printings WHERE game = 'op' ORDER BY set_rarity_code").all() as Printing[]
const printing = (bandaiId: string): Printing | undefined =>
  db.prepare("SELECT * FROM card_printings WHERE game = 'op' AND set_rarity_code = ?").get(bandaiId) as Printing | undefined

const OP_TABLES = ['cards', 'card_images', 'card_printings', 'sets']
const opCounts = (): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const t of OP_TABLES) out[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE game = 'op'`).get() as { n: number }).n
  for (const t of ['onepiece_cards', 'onepiece_images']) out[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
  return out
}

describe('writeOnePiece', () => {
  test('writes the OP17-005 versions', () => {
    const r = write({
      entries: TRIO,
      matches: { 'OP17-005': [711499, null], 'OP17-005_p1': [712083, 'Manga'], 'OP17-005_p2': [708077, 'Alternate Art'] },
      prices: { 711499: 0.75, 712083: 1076.92, 708077: 10.79 }
    })
    const cardId = onePieceCardId('en', 'OP17-005')
    const images = db.prepare("SELECT image_id, card_id, sort_order, missing_from_api FROM card_images WHERE game = 'op' ORDER BY sort_order").all()
    expect(images).toEqual(TRIO.map((e, i) => ({ image_id: onePieceImageId('en', e.bandaiId), card_id: cardId, sort_order: i, missing_from_api: 0 })))
    expect(db.prepare('SELECT bandai_id FROM onepiece_images ORDER BY bandai_id').all()).toEqual(TRIO.map((e) => ({ bandai_id: e.bandaiId })))
    const cards = db.prepare("SELECT id, name, type, frame_type, tcgplayer_price FROM cards WHERE game = 'op'").all()
    expect(cards).toEqual([{ id: cardId, name: 'Edward.Newgate', type: 'Character', frame_type: 'op', tcgplayer_price: null }])
    expect(printings().map((p) => [p.set_rarity_code, p.set_rarity, p.set_code, p.card_id, p.tcg_product_id, p.market_price])).toEqual([
      ['OP17-005', 'SR', 'OP17-005', cardId, 711499, 0.75],
      ['OP17-005_p1', 'SR (Manga)', 'OP17-005', cardId, 712083, 1076.92],
      ['OP17-005_p2', 'SR (Alternate Art)', 'OP17-005', cardId, 708077, 10.79]
    ])
    expect(printings().map((p) => p.pkey)).toContain(`en|${cardId}|OP17-005|SR (Manga)`)
    expect(db.prepare("SELECT set_name, set_code, tcg_date FROM sets WHERE game = 'op'").all()).toEqual([
      { set_name: 'THE WORLD’S STRONGEST WARRIORS [OP-17]', set_code: 'OP17', tcg_date: '2026-08-28' }
    ])
    expect(r).toMatchObject({ cards: 1, printings: 3, priced: 3, held: 0, images: 3 })
  })

  test('the card row holds the effect, then the trigger', () => {
    write({ entries: [fx('OP17-019')] })
    const e = fx('OP17-019')
    const id = onePieceCardId('en', 'OP17-019')
    expect(db.prepare('SELECT type, "desc" FROM cards WHERE id = ?').get(id)).toEqual({ type: 'Event', desc: `${e.effect}\n${e.trigger}` })
    expect(db.prepare('SELECT number, card_type, cost, effect, trigger FROM onepiece_cards WHERE card_id = ?').get(id)).toEqual({
      number: 'OP17-019', card_type: 'Event', cost: 1, effect: e.effect, trigger: e.trigger
    })
  })

  test('SP on a later set', () => {
    const e = fx('EB04-061_p2')
    expect(e.rarity).toBe('SEC')
    write({ entries: [e] })
    expect(printing('EB04-061_p2')).toMatchObject({
      set_name: 'THE WORLD’S STRONGEST WARRIORS [OP-17]', set_code: 'EB04-061', set_rarity: 'SP',
      card_id: onePieceCardId('en', 'EB04-061')
    })
  })

  test('a starter-deck reprint is labelled Reprint, matched or not', () => {
    const ST31 = { id: '569031', kind: 'deck' as const, title: 'RED Monkey.D.Luffy', code: 'ST-31', setName: 'RED Monkey.D.Luffy [ST-31]', setCode: 'ST31' }
    const e = (bandaiId: string, rarity: string): BandaiEntry =>
      entry({ bandaiId, number: bandaiId.split('_')[0], rarity, seriesId: ST31.id, name: 'Nami' })
    const entries = [e('OP01-016_p9', 'R'), e('OP11-003_r1', 'UC')]
    const p = plan({ entries, matches: { 'OP01-016_p9': [706310, null] }, prices: { 706310: 0.4 } })
    const r = writeOnePiece(db, { ...p, series: [...SERIES, ST31] }, { now: NOW, nowIso: new Date(NOW).toISOString() })
    expect(printings().map((x) => [x.set_rarity_code, x.set_name, x.set_rarity, x.tcg_product_id, x.market_price])).toEqual([
      ['OP01-016_p9', 'RED Monkey.D.Luffy [ST-31]', 'R (Reprint)', 706310, 0.4],
      ['OP11-003_r1', 'RED Monkey.D.Luffy [ST-31]', 'UC (Reprint)', null, null]
    ])
    expect(r).toMatchObject({ printings: 2, priced: 1, held: 0 })
  })

  test('DON!! cards: a card per product, a printing per finish, TCGplayer art', () => {
    const r = write({ entries: [fx('OP17-005')], don: [ACE, GOLD] })
    const ace = onePieceDonCardId('en', 593801)
    const gold = onePieceDonCardId('en', 482236)
    expect(db.prepare(`SELECT id, name, type, "desc", frame_type FROM cards WHERE game = 'op' AND type = 'DON!!' ORDER BY name`).all()).toEqual([
      { id: ace, name: 'DON!! (Ace)', type: 'DON!!', desc: 'Your Turn +1000', frame_type: 'op' },
      { id: gold, name: 'DON!! (Gold)', type: 'DON!!', desc: '', frame_type: 'op' }
    ])
    expect(db.prepare('SELECT number, card_type, colors, effect FROM onepiece_cards WHERE card_id = ?').get(ace)).toEqual({
      number: 'DON!!', card_type: 'DON!!', colors: '[]', effect: 'Your Turn +1000'
    })
    expect(db.prepare('SELECT card_id, sort_order FROM card_images WHERE image_id = ?').get(onePieceDonImageId('en', 593801))).toEqual({ card_id: ace, sort_order: 0 })
    expect(db.prepare('SELECT bandai_id FROM onepiece_images WHERE image_id = ?').get(onePieceDonImageId('en', 593801))).toEqual({ bandai_id: 'tcg:593801' })
    const don = printings().filter((p) => p.set_rarity_code.startsWith('tcg:'))
    expect(don.map((p) => [p.set_rarity_code, p.card_id, p.set_name, p.set_code, p.set_rarity, p.tcg_product_id, p.market_price])).toEqual([
      ['tcg:482236/Normal', gold, 'Promotion Cards', 'DON!!', 'DON!!', 482236, null],
      ['tcg:593801/Foil', ace, 'THE WORLD’S STRONGEST WARRIORS [OP-17]', 'DON!!', 'DON!! (Foil)', 593801, 13.16],
      ['tcg:593801/Normal', ace, 'THE WORLD’S STRONGEST WARRIORS [OP-17]', 'DON!!', 'DON!!', 593801, 4.85]
    ])
    // The promo set holds only a DON!! card tonight, and is written for it.
    expect(db.prepare("SELECT set_code FROM sets WHERE game = 'op' ORDER BY set_code").all()).toEqual([{ set_code: 'OP17' }, { set_code: 'P' }])
    expect(r).toMatchObject({ series: 2, cards: 3, printings: 4, priced: 2, images: 3, don: 2, donPriced: 2 })
    expect(r.perSet).toEqual([{ setCode: 'OP17', printings: 3, priced: 2 }, { setCode: 'P', printings: 1, priced: 0 }])
  })

  test('DON!! rows: unchanged nights write nothing, prices move enough, names follow TCGplayer', () => {
    write({ don: [ACE], entries: [] })
    const before = db.prepare("SELECT * FROM card_printings WHERE game = 'op' ORDER BY id").all()
    write({ don: [ACE], entries: [] }, NOW + DAY)
    expect(db.prepare("SELECT * FROM card_printings WHERE game = 'op' ORDER BY id").all()).toEqual(before)
    const moved: DonCard = { ...ACE, name: 'DON!! (Portgas.D.Ace)', versions: [{ ...ACE.versions[0], price: 6 }, ACE.versions[1]] }
    write({ don: [moved], entries: [] }, NOW + 2 * DAY)
    expect(printing('tcg:593801/Normal')!.market_price).toBe(6)
    expect(printing('tcg:593801/Foil')!.market_price).toBe(13.16)
    expect((db.prepare('SELECT name FROM cards WHERE id = ?').get(onePieceDonCardId('en', 593801)) as { name: string }).name).toBe('DON!! (Portgas.D.Ace)')
  })

  test('a DON!! product is flagged missing only when TCGplayer stops listing it on a complete night', () => {
    write({ don: [ACE, GOLD], entries: [] })
    const flags = (): number[] => printings().filter((p) => p.set_rarity_code.startsWith('tcg:')).map((p) => p.missing_from_api)
    const goldImage = (): number =>
      (db.prepare('SELECT missing_from_api AS m FROM card_images WHERE image_id = ?').get(onePieceDonImageId('en', 482236)) as { m: number }).m
    // Held tonight (no price rows), still listed: kept as it is.
    write({ don: [ACE], donListed: [593801, 482236], entries: [] }, NOW + DAY)
    expect(flags()).toEqual([0, 0, 0])
    // A TCGCSV group failed: nothing is flagged.
    write({ don: [ACE], donComplete: false, entries: [] }, NOW + 2 * DAY)
    expect(flags()).toEqual([0, 0, 0])
    expect(goldImage()).toBe(0)
    write({ don: [ACE], entries: [] }, NOW + 3 * DAY)
    expect(flags()).toEqual([1, 0, 0])
    expect(goldImage()).toBe(1)
    write({ don: [ACE, GOLD], entries: [] }, NOW + 4 * DAY)
    expect(flags()).toEqual([0, 0, 0])
    expect(goldImage()).toBe(0)
  })

  test('labels never move, prices move enough', () => {
    write({ entries: TRIO, matches: { 'OP17-005_p1': [712083, 'Manga'] }, prices: { 712083: 12 } })
    write({ entries: TRIO, matches: { 'OP17-005_p1': [712083, 'Gold'] }, prices: { 712083: 12.12 } }, NOW + DAY)
    expect(printing('OP17-005_p1')).toMatchObject({ set_rarity: 'SR (Manga)', tcg_product_id: 712083, market_price: 12 })
    write({ entries: TRIO, matches: { 'OP17-005_p1': [712083, 'Gold'] }, prices: { 712083: 15.6 } }, NOW + 2 * DAY)
    expect(printing('OP17-005_p1')).toMatchObject({ set_rarity: 'SR (Manga)', tcg_product_id: 712083, market_price: 15.6 })
  })

  test('a new product sets the price outright', () => {
    write({ entries: TRIO, matches: { 'OP17-005_p1': [712083, 'Manga'] }, prices: { 712083: 12 } })
    write({ entries: TRIO, matches: { 'OP17-005_p1': [900001, 'Special Foil'] }, prices: { 900001: 12.12 } }, NOW + DAY)
    expect(printing('OP17-005_p1')).toMatchObject({ set_rarity: 'SR (Manga)', tcg_product_id: 900001, market_price: 12.12 })
  })

  test('held parallel is written after 7 days as Parallel', () => {
    const p = { entries: TRIO.slice(0, 2), firstSeen: { 'OP17-005_p1': NOW } }
    const r1 = write(p)
    expect(printing('OP17-005_p1')).toBeUndefined()
    expect(r1).toMatchObject({ held: 1, printings: 1 })
    const r8 = write(p, NOW + HOLD_UNMATCHED_MS)
    expect(printing('OP17-005_p1')).toMatchObject({ set_rarity: 'SR (Parallel)', tcg_product_id: null, market_price: null })
    expect(r8).toMatchObject({ held: 0, printings: 2 })
  })

  test('second Alternate Art is numbered', () => {
    const kaido = (id: string): BandaiEntry => entry({ bandaiId: id, number: 'OP17-062', rarity: 'SR', name: 'Kaido' })
    const sp = (id: string): BandaiEntry => entry({ bandaiId: id, number: 'P-084', rarity: 'SP', name: 'Luffy' })
    // Listed out of order: the numbering follows the Bandai id, not the plan.
    write({
      entries: [kaido('OP17-062_p2'), kaido('OP17-062_p1'), sp('P-084_p2'), sp('P-084_p1')],
      matches: { 'OP17-062_p1': [707135, 'Alternate Art'], 'OP17-062_p2': [900002, 'Alternate Art'] }
    })
    expect(printing('OP17-062_p1')!.set_rarity).toBe('SR (Alternate Art)')
    expect(printing('OP17-062_p2')!.set_rarity).toBe('SR (Alternate Art 2)')
    expect(printing('P-084_p1')!.set_rarity).toBe('SP')
    expect(printing('P-084_p2')!.set_rarity).toBe('SP (2)')
  })

  test('promo entries are labelled by their card sets', () => {
    const PROMO = SERIES[2]
    const promo = parseCardList(read('bandai-promo.html'), PROMO.id).entries
    write({ entries: promo })
    expect(printings().map((p) => [p.set_rarity_code, p.set_name, p.set_rarity])).toEqual([
      ['EB01-043_p1', 'Promotion Cards', 'R (Offline Regional Participation Pack 2025 Vol.1)'],
      ['EB01-043_p2', 'Promotion Cards', 'R (Offline Regional Finalist Card Set 25-26 Season 1)']
    ])
  })

  test('frozen entry keeps its row', () => {
    const p2: [number, string] = [708077, 'Alternate Art']
    write({ entries: TRIO, matches: { 'OP17-005_p1': [712083, 'Manga'], 'OP17-005_p2': p2 }, prices: { 712083: 12 } })
    const row = db.prepare("SELECT * FROM card_printings WHERE set_rarity_code = 'OP17-005_p1'").get()
    const image = db.prepare('SELECT * FROM card_images WHERE image_id = ?').get(onePieceImageId('en', 'OP17-005_p1'))
    const r = write(
      { entries: TRIO, matches: { 'OP17-005_p1': [900001, 'Manga'], 'OP17-005_p2': p2 }, prices: { 900001: 99 }, frozen: ['OP17-005_p1'] },
      NOW + DAY
    )
    expect(db.prepare("SELECT * FROM card_printings WHERE set_rarity_code = 'OP17-005_p1'").get()).toEqual(row)
    expect(db.prepare('SELECT * FROM card_images WHERE image_id = ?').get(onePieceImageId('en', 'OP17-005_p1'))).toEqual(image)
    expect(r.printings).toBe(3)
  })

  test('unhashed entries are not written', () => {
    const r = write({ entries: TRIO, hashed: ['OP17-005'] })
    expect(printings().map((p) => p.set_rarity_code)).toEqual(['OP17-005'])
    expect(r).toMatchObject({ printings: 1, images: 1 })
  })

  test('unlisted entry is flagged, not deleted', () => {
    const p = { entries: TRIO, matches: { 'OP17-005_p2': [708077, 'Alternate Art'] as [number, string] }, prices: { 708077: 10.79 } }
    write(p)
    const counts = opCounts()
    const imageId = onePieceImageId('en', 'OP17-005_p2')
    const flags = (): { printing: number; image: number } => ({
      printing: printing('OP17-005_p2')!.missing_from_api,
      image: (db.prepare('SELECT missing_from_api AS m FROM card_images WHERE image_id = ?').get(imageId) as { m: number }).m
    })
    write({ ...p, entries: TRIO.slice(0, 2) }, NOW + DAY)
    expect(flags()).toEqual({ printing: 1, image: 1 })
    expect(printing('OP17-005_p2')!.market_price).toBe(10.79)
    expect(db.prepare('SELECT bandai_id FROM onepiece_images WHERE image_id = ?').get(imageId)).toEqual({ bandai_id: 'OP17-005_p2' })
    expect(opCounts()).toEqual(counts)
    write(p, NOW + 2 * DAY)
    expect(flags()).toEqual({ printing: 0, image: 0 })
  })

  test('id collision throws', () => {
    const before = opCounts()
    const shared = onePieceCardId('en', 'OP17-005')
    const idOf = {
      card: (n: string) => (n === 'OP17-019' ? shared : onePieceCardId('en', n)),
      image: (b: string) => onePieceImageId('en', b)
    }
    expect(() =>
      writeOnePiece(db, plan({ entries: [fx('OP17-019'), fx('OP17-005')] }), { now: NOW, nowIso: new Date(NOW).toISOString(), idOf })
    ).toThrow(`One Piece id collision: OP17-005 and OP17-019 → ${shared}`)
    expect(opCounts()).toEqual(before)
  })

  test('leaves every ygo and pkm row byte-identical', () => {
    const hashes = (): Record<string, string> => {
      const out: Record<string, string> = {}
      for (const t of CATALOG_TABLES) {
        if (t.games.length === 1 && t.games[0] === 'op') continue
        const where = t.games.includes('op') ? " WHERE game <> 'op'" : ''
        const rows = db.prepare(`SELECT * FROM ${t.name}${where} ORDER BY rowid`).all()
        out[t.name] = createHash('sha256').update(JSON.stringify(rows)).digest('hex')
      }
      return out
    }
    const before = hashes()
    expect(Object.keys(before)).toContain('pokemon_cards')
    write({
      entries: [...TRIO, fx('OP17-001'), fx('OP17-019'), fx('EB04-061_p2'), fx('OP14-108_p3')],
      don: [ACE, GOLD],
      matches: { 'OP17-005': [711499, null], 'OP17-005_p1': [712083, 'Manga'] },
      prices: { 711499: 0.25, 712083: 12 }
    })
    expect(hashes()).toEqual(before)
  })

  test('perSet counts priced share', () => {
    const ygoCard = (db.prepare("SELECT id FROM cards WHERE game = 'ygo' ORDER BY id LIMIT 1").get() as { id: number }).id
    db.prepare("INSERT INTO sets (game, language, set_name, set_code) VALUES ('ygo', 'en', 'OTS Tournament Pack 17', 'OP17')").run()
    db.prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity, market_price)
       VALUES ('ygo', ?, 'en', 'OTS Tournament Pack 17', 'OP17-EN001', 'Ultimate Rare', 3.5)`
    ).run(ygoCard)
    const r = write({
      entries: TRIO,
      matches: { 'OP17-005': [711499, null], 'OP17-005_p1': [712083, 'Manga'], 'OP17-005_p2': [708077, 'Alternate Art'] },
      prices: { 711499: 0.25, 712083: 12, 708077: null }
    })
    expect(r.perSet).toEqual([{ setCode: 'OP17', printings: 3, priced: 2 }])
  })
})
