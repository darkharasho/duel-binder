import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { seededDb } from './helpers'
import { seedPokemon } from '../fixtures/pokemon'
import { onePieceCardId, onePieceImageId, pokemonId } from '../../src/shared/games'
import { addEntry, listEntries } from '../../src/main/repo/collection'
import { getCardDetail } from '../../src/main/repo/cards'
import { printingsByCode } from '../../src/main/repo/scan'
import { getChecklist } from '../../src/main/repo/sets'
import { getStats } from '../../src/main/repo/stats'
import { countCandidates, priceCandidates } from '../../src/main/prices/candidates'
import { refreshTcgCatalog } from '../../src/main/tcgplayer/catalog'
import { applyTcgPrices } from '../../src/main/tcgplayer/prices'
import { MARKET_ONLY_PRICE, setPrice } from '../../src/main/repo/priceRule'

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

describe('Pokémon market-only price rule', () => {
  let db: Database.Database
  let en: number
  let ja: number
  let jaNull: number

  beforeEach(async () => {
    db = await seededDb()
    seedPokemon(db)
    en = pkmPrinting(db, { language: 'en', setName: 'Rule Set', code: 'RUL-EN001', rarity: 'Normal', market: 1 })
    ja = pkmPrinting(db, { language: 'ja', setName: 'Rule Set JP', code: 'RUL-JP001', rarity: 'Normal', market: 2 })
    jaNull = pkmPrinting(db, { language: 'ja', setName: 'Rule Set JP', code: 'RUL-JP002', rarity: 'Normal' })
    db.prepare('UPDATE card_printings SET set_price = 5 WHERE id = ?').run(en)
    db.prepare('UPDATE card_printings SET set_price = 5 WHERE id = ?').run(jaNull)
    db.prepare("INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 9.99, 3, ?)").run(ja, NOW.toISOString())
    db.prepare("INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, 9.99, 3, ?)").run(jaNull, NOW.toISOString())
    setGame(db, 'pkm')
    for (const id of [en, ja, jaNull]) addEntry(db, { printingId: id, imageId: PIKACHU, quantity: 1 }, NOW)
  })

  const entry = (id: number): ReturnType<typeof listEntries>[number] =>
    listEntries(db, ALL).find((e) => e.printing.id === id)!

  it('entries use the printing market price in every language, never approximate', () => {
    expect(entry(en)).toMatchObject({ unitPrice: 1, priceApproximate: false })
    expect(entry(ja)).toMatchObject({ unitPrice: 2, priceApproximate: false, priceSource: 'tcgplayer' })
  })

  it('a Japanese printing with no market price gets no price, not eBay or set_price', () => {
    expect(entry(jaNull)).toMatchObject({
      unitPrice: null,
      priceApproximate: false,
      priceSource: null,
      noPriceReason: null
    })
  })

  it('the sets total uses the market price', () => {
    expect(getChecklist(db, 'Rule Set', 'en')!.cards[0].rarities[0].price).toBe(1)
    // Both Japanese printings share one rarity row: the dearest is the market 2, not eBay 9.99 or set_price 5.
    expect(getChecklist(db, 'Rule Set JP', 'ja')!.cards[0].rarities[0].price).toBe(2)
  })

  it('scan rawPrice uses the market price', () => {
    const raw = (code: string): number | null => printingsByCode(db, code)[0].price
    expect(raw('RUL-EN001')).toBe(1)
    expect(raw('RUL-JP001')).toBe(2)
    expect(raw('RUL-JP002')).toBeNull()
  })

  it('card detail setPrice uses the market price and ignores set_price', () => {
    const prices = Object.fromEntries(getCardDetail(db, PIKACHU)!.printings.map((p) => [p.id, p.setPrice]))
    expect(prices[en]).toBe(1)
    expect(prices[ja]).toBe(2)
    expect(prices[jaNull]).toBeNull()
  })
})

describe('Chinese Pokémon takes its swept eBay price', () => {
  let db: Database.Database
  let priced: number
  let unpriced: number
  let marketed: number

  beforeEach(async () => {
    db = await seededDb()
    seedPokemon(db)
    priced = pkmPrinting(db, { language: 'zh-hans', setName: 'Rule ZH', code: 'CS3aC 017', rarity: 'Normal' })
    unpriced = pkmPrinting(db, { language: 'zh-hans', setName: 'Rule ZH', code: 'CS3aC 018', rarity: 'Normal' })
    marketed = pkmPrinting(db, { language: 'zh-hant', setName: 'Rule TW', code: 'SV8F 019', rarity: 'Normal', market: 2 })
    // The English twin must never stand in for the unpriced card.
    pkmPrinting(db, { language: 'en', setName: 'Rule EN', code: 'CS3aC 018', rarity: 'Normal', market: 50 })
    const add = db.prepare('INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, 3, ?)')
    add.run(priced, 4.5, NOW.toISOString())
    add.run(marketed, 9.99, NOW.toISOString())
    setGame(db, 'pkm')
    for (const id of [priced, unpriced, marketed]) addEntry(db, { printingId: id, imageId: PIKACHU, quantity: 1 }, NOW)
  })

  const entry = (id: number): ReturnType<typeof listEntries>[number] =>
    listEntries(db, ALL).find((e) => e.printing.id === id)!

  it('an entry shows it as an eBay price', () => {
    expect(entry(priced)).toMatchObject({
      unitPrice: 4.5,
      priceApproximate: false,
      priceSource: 'ebay',
      priceListingCount: 3,
      noPriceReason: null
    })
  })

  it('no swept price is no price, not a "checking" and not another language', () => {
    expect(entry(unpriced)).toMatchObject({ unitPrice: null, priceSource: null, noPriceReason: null })
  })

  it('a market price beats it', () => {
    expect(entry(marketed)).toMatchObject({ unitPrice: 2, priceSource: 'tcgplayer' })
  })

  it('reaches the set list, the scan and the card detail', () => {
    expect(getChecklist(db, 'Rule ZH', 'zh-hans')!.cards.flatMap((c) => c.rarities.map((r) => r.price))).toContain(4.5)
    expect(printingsByCode(db, 'CS3aC 017')[0].price).toBe(4.5)
    const prices = Object.fromEntries(getCardDetail(db, PIKACHU)!.printings.map((p) => [p.id, p.setPrice]))
    expect(prices[priced]).toBe(4.5)
    expect(prices[unpriced]).toBeNull()
  })
})

describe('Japanese One Piece takes its swept eBay price', () => {
  let db: Database.Database
  let jaPriced: number
  let jaUnpriced: number
  let enUnpriced: number
  const JA_CARD = onePieceCardId('ja', 'OP01-001')
  const EN_CARD = onePieceCardId('en', 'OP01-001')

  beforeEach(async () => {
    db = await seededDb()
    const card = db.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at) VALUES (?, 'op', 'Luffy', 'Leader', 'op', '', '', '2026-11-04')`
    )
    card.run(JA_CARD)
    card.run(EN_CARD)
    const details = db.prepare("INSERT INTO onepiece_cards (card_id, number, card_type) VALUES (?, 'OP01-001', 'Leader')")
    details.run(JA_CARD)
    details.run(EN_CARD)
    db.prepare("INSERT INTO sets (game, language, set_name, set_code) VALUES ('op', 'ja', 'ROMANCE DAWN [OP-01]', 'OP01')").run()
    db.prepare("INSERT INTO sets (game, language, set_name, set_code) VALUES ('op', 'en', 'ROMANCE DAWN [OP-01]', 'OP01')").run()
    const printing = db.prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity, set_rarity_code, market_price)
       VALUES ('op', ?, ?, 'ROMANCE DAWN [OP-01]', 'OP01-001', ?, ?, ?)`
    )
    jaPriced = Number(printing.run(JA_CARD, 'ja', 'L', 'OP01-001', null).lastInsertRowid)
    jaUnpriced = Number(printing.run(JA_CARD, 'ja', 'L (Parallel)', 'OP01-001_p1', null).lastInsertRowid)
    // English has a market price for the same art; it must never stand in for Japanese.
    printing.run(EN_CARD, 'en', 'L (Alternate Art)', 'OP01-001_p1', 120)
    enUnpriced = Number(printing.run(EN_CARD, 'en', 'L', 'OP01-001', null).lastInsertRowid)
    const add = db.prepare('INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, 3, ?)')
    add.run(jaPriced, 6.5, NOW.toISOString())
    // An English op printing never takes an eBay row, whatever wrote it.
    add.run(enUnpriced, 9.99, NOW.toISOString())
    const image = db.prepare("INSERT INTO card_images (image_id, game, card_id, sort_order) VALUES (?, 'op', ?, 0)")
    image.run(onePieceImageId('ja', 'OP01-001'), JA_CARD)
    image.run(onePieceImageId('en', 'OP01-001'), EN_CARD)
    setGame(db, 'op')
    for (const id of [jaPriced, jaUnpriced])
      addEntry(db, { printingId: id, imageId: onePieceImageId('ja', 'OP01-001'), quantity: 1 }, NOW)
    addEntry(db, { printingId: enUnpriced, imageId: onePieceImageId('en', 'OP01-001'), quantity: 1 }, NOW)
  })

  const entry = (id: number): ReturnType<typeof listEntries>[number] =>
    listEntries(db, ALL).find((e) => e.printing.id === id)!

  it('an entry shows it as an eBay price', () => {
    expect(entry(jaPriced)).toMatchObject({ unitPrice: 6.5, priceSource: 'ebay', priceListingCount: 3, noPriceReason: null })
  })

  it('no swept price is no price, never the English one', () => {
    expect(entry(jaUnpriced)).toMatchObject({ unitPrice: null, priceSource: null, noPriceReason: null })
    expect(entry(enUnpriced)).toMatchObject({ unitPrice: null, priceSource: null })
  })

  it('reaches the set list, the scan and the card detail', () => {
    expect(getChecklist(db, 'ROMANCE DAWN [OP-01]', 'ja')!.cards.flatMap((c) => c.rarities.map((r) => r.price))).toContain(6.5)
    const prices = Object.fromEntries(getCardDetail(db, JA_CARD)!.printings.map((p) => [p.id, p.setPrice]))
    expect(prices[jaPriced]).toBe(6.5)
    expect(prices[jaUnpriced]).toBeNull()
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

describe('Magic Chinese printings keep the market-only price rule', () => {
  it('a zh-hans printing with no market price reads as unpriced, whatever its set_price', async () => {
    const db = await seededDb()
    const cardId = (db.prepare('SELECT id FROM cards LIMIT 1').get() as { id: number }).id
    const insert = (num: string, market: number | null): number =>
      Number(
        db
          .prepare(
            `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity, market_price, set_price)
             VALUES ('mtg', ?, 'zh-hans', 'Test Set', ?, 'Rare', ?, 9.99)`
          )
          .run(cardId, num, market).lastInsertRowid
      )
    const unpriced = insert('TST 1', null)
    const priced = insert('TST 2', 2.5)
    const read = (id: number): { price: number | null; setPrice: number | null } =>
      db
        .prepare(
          `SELECT ${MARKET_ONLY_PRICE} AS price, ${setPrice('1 = 0')} AS setPrice
           FROM card_printings p LEFT JOIN intl_prices ip ON ip.printing_id = p.id WHERE p.id = ?`
        )
        .get(id) as { price: number | null; setPrice: number | null }
    expect(read(unpriced)).toEqual({ price: null, setPrice: null })
    expect(read(priced).price).toBe(2.5)
  })
})
