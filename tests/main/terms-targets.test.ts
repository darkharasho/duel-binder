import { afterEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { harvestQuery, pickPrintings, uniqueSearches } from '../../scripts/terms/targets'

const NOW = new Date('2026-11-21T00:00:00Z')
let db: Database.Database

interface Row {
  game: 'ygo' | 'pkm'
  name: string
  set: string
  code: string
  date: string
  price: number | null
  language?: string
  contributed?: number
}

function seed(rows: Row[]): void {
  let id = 1
  for (const r of rows) {
    const cardId = id++
    db.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
       VALUES (?, ?, ?, 't', 'f', 'r', '', '2026-01-01')`
    ).run(cardId, r.game, r.name)
    db.prepare(
      'INSERT OR IGNORE INTO sets (game, language, set_name, set_code, tcg_date) VALUES (?, ?, ?, ?, ?)'
    ).run(r.game, r.language ?? 'en', r.set, r.code.split(' ')[0], r.date)
    db.prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity, market_price, contributed)
       VALUES (?, ?, ?, ?, ?, 'Rare', ?, ?)`
    ).run(r.game, cardId, r.language ?? 'en', r.set, r.code, r.price, r.contributed ?? 0)
  }
}

afterEach(() => db.close())

describe('pickPrintings', () => {
  it('backfill interleaves games by price rank and skips non-English and contributed rows', () => {
    db = openDatabase(':memory:')
    seed([
      { game: 'ygo', name: 'Y1', set: 'S1', code: 'AAA-EN001', date: '2020-01-01', price: 50 },
      { game: 'ygo', name: 'Y2', set: 'S1', code: 'AAA-EN002', date: '2020-01-01', price: 30 },
      { game: 'ygo', name: 'Yfr', set: 'S1', code: 'AAA-FR003', date: '2020-01-01', price: 99, language: 'fr' },
      { game: 'ygo', name: 'Ycon', set: 'S1', code: 'AAA-EN004', date: '2020-01-01', price: 98, contributed: 1 },
      { game: 'ygo', name: 'Ynull', set: 'S1', code: 'AAA-EN005', date: '2020-01-01', price: null },
      { game: 'pkm', name: 'P1', set: 'S2', code: 'PAL 001/100', date: '2020-01-01', price: 10 },
      { game: 'pkm', name: 'P2', set: 'S2', code: 'PAL 002/100', date: '2020-01-01', price: 20 }
    ])
    const all = pickPrintings(db, { mode: 'backfill', from: 0, count: 10, now: NOW })
    expect(all.map((p) => p.name)).toEqual(['Y1', 'P2', 'Y2', 'P1'])
    expect(all[1]).toMatchObject({ game: 'pkm', setCode: 'PAL', number: '002/100', language: 'en' })
    const page = pickPrintings(db, { mode: 'backfill', from: 1, count: 2, now: NOW })
    expect(page.map((p) => p.name)).toEqual(['P2', 'Y2'])
  })

  it('recent keeps only sets 21 to 112 days old with a price of 5 or more', () => {
    db = openDatabase(':memory:')
    seed([
      { game: 'ygo', name: 'Fresh', set: 'A', code: 'A-EN001', date: '2026-11-10', price: 90 },
      { game: 'ygo', name: 'InWindow', set: 'B', code: 'B-EN001', date: '2026-10-01', price: 40 },
      { game: 'ygo', name: 'Cheap', set: 'B', code: 'B-EN002', date: '2026-10-01', price: 4 },
      { game: 'ygo', name: 'Old', set: 'C', code: 'C-EN001', date: '2026-06-01', price: 80 },
      { game: 'pkm', name: 'PkmIn', set: 'D', code: 'DDD 001/010', date: '2026-08-15', price: 12 }
    ])
    const got = pickPrintings(db, { mode: 'recent', from: 0, count: 10, now: NOW })
    expect(got.map((p) => p.name)).toEqual(['InWindow', 'PkmIn'])
    expect(pickPrintings(db, { mode: 'recent', from: 0, count: 1, now: NOW })).toHaveLength(1)
  })
})

describe('Pokémon rarity', () => {
  it('offers the card rarity (pokemon_cards), not the printing finish', () => {
    db = openDatabase(':memory:')
    seed([
      { game: 'pkm', name: 'Mew ex', set: '151', code: 'MEW 205/165', date: '2020-01-01', price: 40 },
      { game: 'pkm', name: 'NoRow', set: '151', code: 'MEW 001/165', date: '2020-01-01', price: 1 },
      { game: 'ygo', name: 'Y', set: 'S', code: 'S-EN001', date: '2020-01-01', price: 5 }
    ])
    db.prepare("UPDATE card_printings SET set_rarity = 'Holofoil' WHERE game = 'pkm'").run()
    db.prepare(
      "INSERT INTO pokemon_cards (card_id, category, rarity, source_id) VALUES (1, 'Pokemon', 'Special Illustration Rare', 'sv3pt5-205')"
    ).run()
    const got = pickPrintings(db, { mode: 'backfill', from: 0, count: 10, now: NOW })
    expect(got.map((p) => [p.name, p.rarity])).toEqual([
      ['Y', 'Rare'],
      ['Mew ex', 'Special Illustration Rare'],
      // No pokemon_cards row: the finish is all there is.
      ['NoRow', 'Holofoil']
    ])
  })
})

describe('recent window dates', () => {
  it('reads slash dates (TCGdex) and dates with a time as well as plain ISO ones', () => {
    db = openDatabase(':memory:')
    seed([
      { game: 'pkm', name: 'Slash', set: 'A', code: 'AAA 001/010', date: '2026/10/01', price: 30 },
      { game: 'pkm', name: 'SlashOld', set: 'B', code: 'BBB 001/010', date: '2026/03/01', price: 30 },
      { game: 'ygo', name: 'Timed', set: 'C', code: 'C-EN001', date: '2026-10-01T00:00:00', price: 20 }
    ])
    const got = pickPrintings(db, { mode: 'recent', from: 0, count: 10, now: NOW })
    expect(got.map((p) => p.name).sort()).toEqual(['Slash', 'Timed'])
  })
})

describe('uniqueSearches', () => {
  const p = { game: 'ygo' as const, pkey: 'a', cardId: 1, name: 'Dark Magician', setName: 'S', setCode: 'LOB-EN005', number: 'LOB-EN005', rarity: 'Ultra Rare', language: 'en' }
  it('keeps one printing per game and search', () => {
    const got = uniqueSearches([p, { ...p, pkey: 'b', rarity: 'Secret Rare' }, { ...p, game: 'op' }])
    expect(got.map((x) => x.pkey + x.game)).toEqual(['aygo', 'aop'])
  })
})

describe('harvestQuery', () => {
  const base = { pkey: 'k', cardId: 1, name: 'Mew ex', rarity: 'R', language: 'en' }
  it('builds each game its own query', () => {
    expect(
      harvestQuery({ ...base, game: 'pkm', setName: 'Paldean Fates', setCode: 'PAF', number: '232/091' })
    ).toBe('Mew ex 232/091')
    expect(
      harvestQuery({ ...base, game: 'ygo', setName: 'X', setCode: 'LOB-EN001', number: 'LOB-EN001' })
    ).toBe('Mew ex LOB-EN001')
    expect(
      harvestQuery({ ...base, game: 'op', setName: 'X', setCode: 'OP01-001', number: 'OP01-001' })
    ).toBe('Mew ex OP01-001')
    expect(
      harvestQuery({ ...base, game: 'mtg', setName: 'Foundations', setCode: 'FDN', number: '1' })
    ).toBe('Mew ex Foundations')
  })
})
