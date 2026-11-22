import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { migrateServer } from '../../workers/portal/src/migrate'
import {
  GRADED_PRICE_INTERVAL_MS,
  checkGradedPriceKeys,
  collectorNumber,
  gradedPricesFor,
  gradedQuery,
  runGradedPrices
} from '../../workers/portal/src/gradedPrices'
import type { GradedPriceClient, GradedPriceQuery } from '../../src/main/prices/client'
import { getMeta } from '../../src/main/db/meta'

const NOW = new Date('2026-11-19T12:00:00.000Z')
const DAY = 24 * 3600 * 1000

describe('graded prices', () => {
  let db: Database.Database
  let pkeys: Record<string, string>

  function printing(tag: string, code: string, rarity: string, game = 'pkm', lang = 'en'): void {
    const r = db
      .prepare(
        `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language, game)
         VALUES (1, 'Fossil', ?, ?, ?, ?)`
      )
      .run(code, rarity, lang, game)
    pkeys[tag] = (
      db.prepare('SELECT pkey FROM card_printings WHERE id = ?').get(r.lastInsertRowid) as {
        pkey: string
      }
    ).pkey
  }
  let n = 0
  function slab(tag: string, company = 'PSA', grade = '10', deleted = false): void {
    db.prepare(
      `INSERT INTO graded_copies (user_id, uid, game, pkey, image_id, company, grade, created_at, updated_at,
         deleted_at, seq) VALUES (1, ?, 'pkm', ?, 1, ?, ?, '', '', ?, ?)`
    ).run(`u${++n}`, pkeys[tag], company, grade, deleted ? 'x' : null, n)
  }
  const fake = (price: number | null = 120): GradedPriceClient & { asked: GradedPriceQuery[] } => {
    const asked: GradedPriceQuery[] = []
    return {
      asked,
      lookup: vi.fn(async (q: GradedPriceQuery) => {
        asked.push(q)
        return { price, listingCount: price === null ? 1 : 4, checkedAt: NOW.toISOString() }
      })
    }
  }
  const stored = (): Record<string, unknown>[] =>
    db
      .prepare(
        'SELECT pkey, company, grade, price, listing_count, checked_at FROM graded_prices ORDER BY pkey, grade'
      )
      .all() as Record<string, unknown>[]

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrateServer(db)
    db.prepare(
      `INSERT INTO users (id, discord_id, username, created_at, updated_at) VALUES (1, 'd', 'u', '', '')`
    ).run()
    db.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game)
       VALUES (1, 'Dragonite', 'Pokemon', 'normal', '', '', '', 'pkm')`
    ).run()
    pkeys = {}
    n = 0
    printing('first', 'FO 4/62', '1st Edition Holofoil')
    printing('unl', 'FO 4/62', 'Holofoil')
    printing('promo', 'BASEP', 'Normal')
  })

  it('reads collector numbers out of set codes', () => {
    expect(collectorNumber('FO 4/62')).toBe('4/62')
    expect(collectorNumber('M5 065/81')).toBe('65/81')
    expect(collectorNumber('ONE 75')).toBe('75')
    expect(collectorNumber('SWSH TG05/TG30')).toBe('TG05/TG30')
    expect(collectorNumber('BASEP')).toBe('')
  })

  it('searches Pokémon by name and number, with the edition the printing says', () => {
    const base = { game: 'pkm', pkey: 'k', company: 'PSA', grade: '10' }
    const row = { set_code: 'FO 4/62', set_name: 'Fossil', language: 'en', name: 'Dragonite' }
    expect(
      gradedQuery(base, { ...row, set_rarity: '1st Edition Holofoil', first_in_set: 1 })
    ).toMatchObject({
      code: '',
      name: 'Dragonite',
      number: '4/62',
      set: 'Fossil',
      edition: '1st'
    })
    expect(gradedQuery(base, { ...row, set_rarity: 'Holofoil', first_in_set: 1 })).toMatchObject({
      edition: 'unlimited'
    })
    expect(gradedQuery(base, { ...row, set_rarity: 'Holofoil', first_in_set: 0 })).toMatchObject({
      edition: ''
    })
    // A promo's catalog total isn't on the card: its number alone.
    expect(
      gradedQuery(base, {
        ...row,
        set_code: 'SVP 044/225',
        set_name: 'SVP Black Star Promos',
        set_rarity: 'Promo',
        first_in_set: 0
      })
    ).toMatchObject({ number: '44', set: 'SVP Black Star Promos' })
    expect(
      gradedQuery(base, {
        ...row,
        set_code: 'SMP SM229/248',
        set_name: 'SM Black Star Promos',
        set_rarity: 'Promo',
        first_in_set: 0
      })
    ).toMatchObject({ number: 'SM229' })
    // A grader the Worker doesn't know, or a Yu-Gi-Oh! printing with no code: not searched.
    expect(
      gradedQuery(
        { ...base, company: 'Other Co' },
        { ...row, set_rarity: 'Holofoil', first_in_set: 0 }
      )
    ).toBeNull()
    expect(
      gradedQuery(
        { ...base, game: 'ygo' },
        { ...row, set_code: 'DON!!', set_rarity: 'x', first_in_set: 0 }
      )
    ).toBeNull()
    expect(
      gradedQuery(
        { ...base, game: 'ygo' },
        { ...row, set_code: 'LOB-EN001', set_rarity: 'x', first_in_set: 0 }
      )
    ).toMatchObject({ code: 'LOB-EN001' })
  })

  it('prices each owned key once, skips removed slabs, and stores what it found', async () => {
    slab('first')
    slab('first') // A second copy of the same key: one lookup.
    slab('unl', 'CGC', '9.5')
    slab('unl', 'PSA', '8', true)
    const client = fake()
    const r = await runGradedPrices(db, client, NOW)
    expect(r).toEqual({ priced: 2, failed: 0, more: false })
    expect(client.asked.map((q) => [q.company, q.grade, q.edition])).toEqual(
      expect.arrayContaining([
        ['PSA', '10', '1st'],
        ['CGC', '9.5', 'unlimited']
      ])
    )
    expect(stored()).toHaveLength(2)
    expect(getMeta(db, 'graded_calls_day')).toBe('2026-11-19:2')
    // Fresh now: nothing to do until a week has passed.
    expect((await runGradedPrices(db, client, NOW)).priced).toBe(0)
    const later = new Date(NOW.getTime() + GRADED_PRICE_INTERVAL_MS + DAY)
    expect((await runGradedPrices(db, client, later)).priced).toBe(2)
  })

  it('keeps a price when a later lookup finds too few listings', async () => {
    slab('first')
    await runGradedPrices(db, fake(120), NOW)
    const later = new Date(NOW.getTime() + GRADED_PRICE_INTERVAL_MS + DAY)
    await runGradedPrices(db, fake(null), later)
    expect(stored()).toEqual([expect.objectContaining({ price: 120, listing_count: 4 })])
  })

  it('tries an unpriced key again a day later, a priced one a week later', async () => {
    slab('first')
    slab('unl')
    const client: GradedPriceClient & { asked: GradedPriceQuery[] } = {
      asked: [],
      lookup: vi.fn(async (q: GradedPriceQuery) => {
        client.asked.push(q)
        const price = q.edition === '1st' ? 120 : null
        return { price, listingCount: price ? 4 : 1, checkedAt: NOW.toISOString() }
      })
    }
    await runGradedPrices(db, client, NOW)
    expect(client.asked).toHaveLength(2)
    const tomorrow = new Date(NOW.getTime() + DAY + 1000)
    await runGradedPrices(db, client, tomorrow)
    expect(client.asked.slice(2).map((q) => q.edition)).toEqual(['unlimited'])
  })

  it('stops at the day’s cap and the batch, and says more are due', async () => {
    slab('first')
    slab('unl')
    slab('first', 'CGC', '9')
    const client = fake()
    expect(await runGradedPrices(db, client, NOW, { limit: 1 })).toEqual({
      priced: 1,
      failed: 0,
      more: true
    })
    expect(await runGradedPrices(db, client, NOW, { dailyCalls: 2 })).toEqual({
      priced: 1,
      failed: 0,
      more: false
    })
    expect(client.asked).toHaveLength(2)
  })

  it('stores a key it can’t search for unpriced; it and a failure are due a day later', async () => {
    slab('promo')
    slab('first')
    const client: GradedPriceClient = {
      lookup: vi.fn(async () => {
        throw new Error('down')
      })
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await runGradedPrices(db, client, NOW)
    expect(r).toMatchObject({ priced: 0, failed: 1 })
    expect(client.lookup).toHaveBeenCalledTimes(1)
    const rows = stored()
    expect(rows).toHaveLength(2)
    expect(rows.every((x) => x.price === null)).toBe(true)
    // Neither is due again within the day; both are a day later (the unsearchable one without a call).
    const soon = fake()
    await runGradedPrices(db, soon, new Date(NOW.getTime() + DAY - 1000))
    expect(soon.asked).toHaveLength(0)
    const tomorrow = new Date(NOW.getTime() + DAY + 1000)
    const again = fake()
    await runGradedPrices(db, again, tomorrow)
    expect(again.asked).toHaveLength(1)
    expect(again.asked[0].edition).toBe('1st')
  })

  it('backs a failed refresh of a priced key off a day, keeping its price', async () => {
    slab('first')
    await runGradedPrices(db, fake(120), NOW)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const down: GradedPriceClient = {
      lookup: vi.fn(async () => {
        throw new Error('down')
      })
    }
    const later = new Date(NOW.getTime() + GRADED_PRICE_INTERVAL_MS + DAY)
    await runGradedPrices(db, down, later)
    expect(stored()).toEqual([expect.objectContaining({ price: 120 })])
    const again = fake(130)
    await runGradedPrices(db, again, new Date(later.getTime() + DAY + 1000))
    expect(again.asked).toHaveLength(1)
  })

  it('answers a device with the prices it knows, and checks the keys', async () => {
    slab('first')
    await runGradedPrices(db, fake(), NOW)
    expect(
      gradedPricesFor(db, [
        { pkey: pkeys.first, company: 'PSA', grade: '10' },
        { pkey: pkeys.first, company: 'PSA', grade: '9' }
      ])
    ).toEqual({
      prices: [
        {
          pkey: pkeys.first,
          company: 'PSA',
          grade: '10',
          price: 120,
          listingCount: 4,
          checkedAt: NOW.toISOString()
        }
      ]
    })
    expect(() => checkGradedPriceKeys({ keys: [{ pkey: 'x' }] })).toThrow()
    expect(() => checkGradedPriceKeys({})).toThrow()
    expect(
      checkGradedPriceKeys({ keys: [{ pkey: 'x', company: 'PSA', grade: '10', extra: 1 }] })
    ).toEqual([{ pkey: 'x', company: 'PSA', grade: '10' }])
  })
})
