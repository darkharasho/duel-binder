import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { seededDb } from './helpers'
import { seedPokemon } from '../fixtures/pokemon'
import { pokemonId } from '../../src/shared/games'
import { addEntry, listEntries } from '../../src/main/repo/collection'
import { getChecklist } from '../../src/main/repo/sets'
import { getStats } from '../../src/main/repo/stats'
import { countCandidates, priceCandidates } from '../../src/main/prices/candidates'
import { refreshTcgCatalog } from '../../src/main/tcgplayer/catalog'
import { applyTcgPrices } from '../../src/main/tcgplayer/prices'

const NOW = new Date('2026-10-29T12:00:00.000Z')
const ALL = { sort: 'name', dir: 'asc' } as const
const PIKACHU = pokemonId('sv02-045')

const setGame = (db: Database.Database, game: string | null): void => {
  db.prepare("DELETE FROM meta WHERE key = 'active_game'").run()
  if (game) db.prepare("INSERT INTO meta (key, value) VALUES ('active_game', ?)").run(game)
}

function pkmPrinting(
  db: Database.Database,
  o: { language: string; setName: string; code: string; rarity: string; market?: number | null }
): number {
  const r = db
    .prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity, market_price)
       VALUES ('pkm', ?, ?, ?, ?, ?, ?)`
    )
    .run(PIKACHU, o.language, o.setName, o.code, o.rarity, o.market ?? null)
  return Number(r.lastInsertRowid)
}

const printingId = (db: Database.Database, language: string, code: string, rarity: string): number =>
  (
    db
      .prepare(
        "SELECT id FROM card_printings WHERE game = 'pkm' AND language = ? AND set_code = ? AND set_rarity = ?"
      )
      .get(language, code, rarity) as { id: number }
  ).id

describe('Pokémon pricing', () => {
  let db: Database.Database
  const ids: Record<string, number> = {}

  beforeEach(async () => {
    db = await seededDb()
    seedPokemon(db)
    ids.enNormal = printingId(db, 'en', 'PAL 045/193', 'Normal')
    ids.enReverse = printingId(db, 'en', 'PAL 045/193', 'Reverse Holo')
    db.prepare('UPDATE card_printings SET market_price = 4.25 WHERE id = ?').run(ids.enNormal)
    // The Japanese counterpart: same card (so same name) and same number, no price of its own.
    ids.ja = pkmPrinting(db, { language: 'ja', setName: 'Paldea Evolved (JP)', code: 'PAL 045/193', rarity: 'Normal' })
    // A German printing whose code the English-twin matcher maps onto a priced English one
    // (PAL-DE045 -> PAL-EN045): only the per-game gate keeps the English price off it.
    pkmPrinting(db, { language: 'en', setName: 'Paldea Evolved', code: 'PAL-EN045', rarity: 'Normal', market: 7.5 })
    ids.de = pkmPrinting(db, { language: 'de', setName: 'Paldea Evolved (DE)', code: 'PAL-DE045', rarity: 'Normal' })
    setGame(db, 'pkm')
    for (const k of ['enNormal', 'enReverse', 'ja', 'de'])
      addEntry(db, { printingId: ids[k], imageId: PIKACHU, quantity: 1 }, NOW)
  })

  const entry = (key: string): ReturnType<typeof listEntries>[number] =>
    listEntries(db, ALL).find((e) => e.printing.id === ids[key])!

  it('the English Normal printing shows its own TCGplayer price', () => {
    expect(entry('enNormal')).toMatchObject({ unitPrice: 4.25, priceApproximate: false, priceSource: 'tcgplayer' })
  })

  it('the Japanese counterpart never takes the English price, and has no price source', () => {
    expect(entry('ja')).toMatchObject({ unitPrice: null, priceSource: null, noPriceReason: null, totalValue: 0 })
  })

  it('no English-twin estimate for a European Pokémon printing', () => {
    expect(entry('de')).toMatchObject({ unitPrice: null, priceSource: null, priceApproximate: false })
    const card = getChecklist(db, 'Paldea Evolved (DE)', 'de')!.cards[0]
    expect(card.price).toBeNull()
  })

  it('the Reverse Holo never shows the Normal price', () => {
    expect(entry('enReverse')).toMatchObject({ unitPrice: null, priceSource: null })
  })

  it('stats count the unpriced Pokémon entries as unpriced', () => {
    const s = getStats(db)
    expect(s.totalValue).toBe(4.25)
    expect(s.unpricedCount).toBe(3)
    expect(s.approximateCount).toBe(0)
  })

  it('price candidates never pick a Pokémon printing', () => {
    const owned = [ids.enReverse, ids.ja, ids.de]
    expect(priceCandidates(db, NOW, { printingIds: owned })).toEqual([])
    expect(countCandidates(db, NOW, owned)).toBe(0)
    db.prepare('INSERT INTO price_requests (printing_id, requested_at) VALUES (?, ?)').run(ids.ja, NOW.toISOString())
    expect(priceCandidates(db, NOW).some((c) => owned.includes(c.id))).toBe(false)
  })

  it('a Yu-Gi-Oh! printing is still a candidate', () => {
    setGame(db, null)
    const ygo = db
      .prepare(
        `INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity)
         VALUES ((SELECT id FROM cards WHERE game = 'ygo' ORDER BY id LIMIT 1), 'ja', 'JP', 'GP-JP001', 'Rare')`
      )
      .run().lastInsertRowid as number
    db.prepare('INSERT INTO price_requests (printing_id, requested_at) VALUES (?, ?)').run(ygo, NOW.toISOString())
    expect(priceCandidates(db, NOW, { printingIds: [Number(ygo), ids.ja] }).map((c) => c.id)).toEqual([Number(ygo)])
  })
})

describe('TCGplayer prices are Yu-Gi-Oh! only', () => {
  const json = (results: unknown[]): Response =>
    new Response(JSON.stringify({ success: true, results }), { status: 200 })

  it('never writes a market price to a Pokémon printing', async () => {
    const db = await seededDb()
    seedPokemon(db)
    // A Pokémon printing whose number matches a TCGplayer (Yu-Gi-Oh!) product exactly.
    const pkm = pkmPrinting(db, { language: 'en', setName: 'Promo', code: 'PKM-EN001', rarity: 'Ultra Rare' })
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/groups')) return json([{ groupId: 10, modifiedOn: 'a' }])
      return json([
        {
          productId: 1,
          name: 'Card',
          imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/1_200w.jpg',
          imageCount: 1,
          extendedData: [
            { name: 'Number', value: 'PKM-EN001' },
            { name: 'Rarity', value: 'Ultra Rare' }
          ]
        }
      ])
    })
    await refreshTcgCatalog(db, { version: '1', fetchFn: fetchFn as unknown as typeof fetch })
    db.prepare("INSERT INTO tcgplayer_prices (product_id, group_id, price) VALUES (1, 10, 20)").run()
    applyTcgPrices(db)
    expect(
      (db.prepare('SELECT market_price FROM card_printings WHERE id = ?').get(pkm) as { market_price: number | null })
        .market_price
    ).toBeNull()
  })
})
