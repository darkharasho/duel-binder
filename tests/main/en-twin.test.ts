import type Database from 'better-sqlite3'
import { beforeAll, describe, expect, it } from 'vitest'
import { addEntry, listEntries } from '../../src/main/repo/collection'
import { getChecklist } from '../../src/main/repo/sets'
import { printingsByCode } from '../../src/main/repo/scan'
import { enTwinCode } from '../../src/main/repo/enTwin'
import { seededDb } from './helpers'

const SET = 'Twin Test Set'
const DE_SET = 'Twin Test Set (DE)'
let db: Database.Database
let imageId: number
const ids: Record<string, number> = {}

function add(key: string, code: string, rarity: string, lang: string, setName: string, market: number | null, cardId: number): void {
  ids[key] = Number(
    db
      .prepare(
        `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language, market_price)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(cardId, setName, code, rarity, lang, market).lastInsertRowid
  )
}

const entryFor = (key: string): ReturnType<typeof listEntries>[number] =>
  listEntries(db, { sort: 'name', dir: 'asc' }).find((e) => e.printing.id === ids[key])!

beforeAll(async () => {
  db = await seededDb()
  const cardId = (db.prepare('SELECT id FROM cards ORDER BY id LIMIT 1').get() as { id: number }).id
  imageId = (db.prepare('SELECT image_id AS id FROM card_images WHERE card_id = ?').get(cardId) as { id: number }).id
  add('en', 'TWN-EN001', 'Ultra Rare', 'en', SET, 12.5, cardId)
  add('de', 'TWN-DE001', 'Ultra Rare', 'de', DE_SET, null, cardId)
  add('deSecret', 'TWN-DE001', 'Secret Rare', 'de', DE_SET, null, cardId)
  add('enOld', 'TWN-E001', 'Ultra Rare', 'en', SET, 9, cardId)
  add('g', 'TWN-G001', 'Ultra Rare', 'de', DE_SET, null, cardId)
  add('jp', 'TWJ-JP001', 'Ultra Rare', 'ja', 'Twin JP', null, cardId)
  for (const k of ['de', 'deSecret', 'g', 'jp']) addEntry(db, { printingId: ids[k], imageId, quantity: 1 })
})

describe('English twin price estimate', () => {
  it('enTwinCode maps two-letter and single-letter regions', () => {
    expect(enTwinCode('LOB-DE001')).toBe('LOB-EN001')
    expect(enTwinCode('LOB-G001')).toBe('LOB-E001')
    expect(enTwinCode('LOB-SP001')).toBe('LOB-EN001')
    expect(enTwinCode('CORI-JP001')).toBeNull()
    expect(enTwinCode('LOB-EN001')).toBeNull()
  })

  it('listEntries shows the English price as approximate', () => {
    const e = entryFor('de')
    expect(e.unitPrice).toBe(12.5)
    expect(e.priceApproximate).toBe(true)
    expect(e.priceSource).toBe('tcgplayer')
    expect(e.noPriceReason).toBeNull()
  })

  it('rarity must match', () => {
    expect(entryFor('deSecret').unitPrice).toBeNull()
  })

  it('maps single-letter regions', () => {
    expect(entryFor('g').unitPrice).toBe(9)
  })

  it('no twin, no price: Asian printings never fall back', () => {
    expect(entryFor('jp').unitPrice).toBeNull()
  })

  it('checklist and scan use the estimate', () => {
    const card = getChecklist(db, DE_SET, 'de')!.cards[0]
    const ultra = card.rarities.find((r) => r.rarity === 'Ultra Rare')!
    expect(ultra.price).toBe(12.5)
    const opt = printingsByCode(db, 'TWN-DE001').find((p) => p.rarity === 'Ultra Rare')!
    expect(opt.price).toBe(12.5)
  })

  it('twin lookup uses the index', () => {
    const sqls: string[] = []
    const prepare = db.prepare.bind(db)
    db.prepare = ((sql: string) => {
      sqls.push(sql)
      return prepare(sql)
    }) as typeof db.prepare
    listEntries(db, { sort: 'name', dir: 'asc' })
    db.prepare = prepare
    const sql = sqls.find((s) => s.includes('en_twin_price'))!
    expect(sql).toBeDefined()
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join('\n')
    expect(plan).toContain('ux_printings_en')
    expect(plan).not.toMatch(/SCAN en\b/)
  })

  it('own eBay price beats the English estimate', () => {
    db.prepare('INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 4.0, 3, ?)').run(
      ids.de,
      'T'
    )
    const e = entryFor('de')
    expect(e.unitPrice).toBe(4)
    expect(e.priceApproximate).toBe(false)
    expect(e.priceSource).toBe('ebay')
  })
})
