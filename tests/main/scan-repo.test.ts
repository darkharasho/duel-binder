import { describe, expect, it } from 'vitest'
import {
  cardsForImages,
  chineseOfArt,
  matchName,
  printingsByCode,
  printingsByNumber,
  printingsForCards,
  printingsForSet,
  printingsOfArt
} from '../../src/main/repo/scan'
import { scanRefs } from '../../src/main/repo/scanRefs'
import type Database from 'better-sqlite3'
import { seededDb } from './helpers'
import { getMeta, setMeta } from '../../src/main/db/meta'
import { localScope } from '../../src/main/repo/scope'
import { seedPokemon } from '../fixtures/pokemon'
import {
  mtgBackImageId,
  mtgCardId,
  mtgImageId,
  onePieceCardId,
  onePieceImageId
} from '../../src/shared/games/ids'

const LOB = 'Legend of Blue Eyes White Dragon'

async function scanDb(): Promise<{ db: Database.Database; cardId: number }> {
  const db = await seededDb()
  const card = db
    .prepare(
      "SELECT card_id AS cardId FROM card_printings WHERE set_code = 'LOB-EN005' AND language = 'en'"
    )
    .get() as { cardId: number }
  const add = db.prepare(
    'INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language) VALUES (?, ?, ?, ?, ?)'
  )
  add.run(card.cardId, LOB, 'LOB-EN005', 'Ultra Rare (Extended Art)', 'en')
  add.run(card.cardId, 'Legend of Blue Eyes (French)', 'LOB-FR005', 'Ultra Rare', 'fr')
  return { db, cardId: card.cardId }
}

describe('scan repo', () => {
  it("scanRefs names printings by this catalog's ids, leaving out the ones it lacks", async () => {
    const { db, cardId } = await scanDb()
    const id = (rarity: string): number =>
      (
        db
          .prepare("SELECT id FROM card_printings WHERE set_code = 'LOB-EN005' AND set_rarity = ?")
          .get(rarity) as { id: number }
      ).id
    const h = 'ab'.repeat(32)
    expect(
      scanRefs(db, {
        v: 1,
        refs: [
          {
            h,
            imageId: 7,
            printings: [
              `en|${cardId}|LOB-EN005|Ultra Rare (Extended Art)`,
              `en|${cardId}|LOB-EN005|Ultra Rare`,
              'ja|1|Nowhere|NOPE-JP001|Ultra Rare'
            ]
          },
          { h, imageId: 8, printings: ['ja|1|Nowhere|NOPE-JP001|Ultra Rare'] }
        ]
      })
    ).toEqual([{ h, imageId: 7, printingIds: [id('Ultra Rare (Extended Art)'), id('Ultra Rare')] }])
  })

  it('printingsByCode is case-insensitive, carries ordered image ids', async () => {
    const { db, cardId } = await scanDb()
    const rows = printingsByCode(db, 'lob-en005')
    expect(rows.map((r) => r.rarity)).toEqual(['Ultra Rare', 'Ultra Rare (Extended Art)'])
    expect(rows.every((r) => r.setCode === 'LOB-EN005' && r.name === 'Dark Magician')).toBe(true)
    const images = (
      db
        .prepare('SELECT image_id AS id FROM card_images WHERE card_id = ? ORDER BY sort_order')
        .all(cardId) as { id: number }[]
    ).map((i) => i.id)
    expect(images.length).toBeGreaterThan(0)
    expect(rows[0].imageIds).toEqual(images)
    const fr = printingsByCode(db, 'LOB-FR005')
    expect(fr.map((r) => r.language)).toEqual(['fr'])
    expect(rows.every((r) => r.language === 'en')).toBe(true)
  })

  it('printingsForSet returns every rarity, including the variant, sorted by code then tier', async () => {
    const { db } = await scanDb()
    const rows = printingsForSet(db, LOB, 'en')
    expect(rows.map((r) => `${r.setCode} ${r.rarity}`)).toEqual([
      'LOB-EN005 Ultra Rare',
      'LOB-EN005 Ultra Rare (Extended Art)',
      'LOB-EN119 Rare'
    ])
  })

  it('printingsForSet filters by language', async () => {
    const { db } = await scanDb()
    expect(printingsForSet(db, 'Legend of Blue Eyes (French)', 'fr').map((r) => r.setCode)).toEqual(
      ['LOB-FR005']
    )
    expect(printingsForSet(db, 'Legend of Blue Eyes (French)', 'en')).toEqual([])
  })

  it('sorts by code, then language order, then rarity', async () => {
    const { db, cardId } = await scanDb()
    db.prepare(
      'INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language) VALUES (?, ?, ?, ?, ?)'
    ).run(cardId, LOB, 'LOB-EN005', 'Ultra Rare', 'de')
    const langs = printingsByCode(db, 'LOB-EN005').map((r) => r.language)
    expect(langs).toEqual(['en', 'en', 'de'])
  })

  it('printingsForCards returns the cards printings in every language', async () => {
    const { db, cardId } = await scanDb()
    const rows = printingsForCards(db, [cardId])
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows.every((r) => r.cardId === cardId)).toBe(true)
    expect(rows.some((r) => r.language === 'fr')).toBe(true)
    expect(printingsForCards(db, [])).toEqual([])
  })

  it('matchName finds a card through OCR noise', async () => {
    const { db } = await scanDb()
    expect(matchName(db, 'Dark Maglcian')?.name).toBe('Dark Magician')
    expect(matchName(db, 'zzzzzzzz')).toBeNull()
  })

  it('matchName sees the catalog again once its version changes', async () => {
    const { db, cardId } = await scanDb()
    expect(matchName(db, 'Dark Magician')?.cardId).toBe(cardId)
    db.prepare('UPDATE cards SET name = ? WHERE id = ?').run('Dark Paladin', cardId)
    // Same version: still the cached list.
    expect(matchName(db, 'Dark Magician')?.cardId).toBe(cardId)
    setMeta(db, 'db_version', `${getMeta(db, 'db_version') ?? ''}-next`)
    expect(matchName(db, 'Dark Paladin')).toMatchObject({ cardId, name: 'Dark Paladin' })
  })

  it('looks up more ids than fit in one query', async () => {
    const { db, cardId } = await scanDb()
    const images = (
      db.prepare('SELECT image_id AS imageId FROM card_images WHERE card_id = ?').all(cardId) as {
        imageId: number
      }[]
    ).map((i) => i.imageId)
    const filler = Array.from({ length: 1200 }, (_, i) => 900_000_000 + i)
    expect(cardsForImages(db, [...filler, ...images])).toEqual(
      [...images].sort((a, b) => a - b).map((imageId) => ({ imageId, cardId }))
    )
    const rows = printingsForCards(db, [...filler, cardId])
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.cardId === cardId && r.imageIds.length > 0)).toBe(true)
  })

  it('cardsForImages maps known artworks to their card and skips unknown ones', async () => {
    const { db, cardId } = await scanDb()
    const images = (
      db
        .prepare('SELECT image_id AS imageId FROM card_images WHERE card_id = ? ORDER BY image_id')
        .all(cardId) as {
        imageId: number
      }[]
    ).map((i) => i.imageId)
    expect(cardsForImages(db, [...images, 999999999])).toEqual(
      images.map((imageId) => ({ imageId, cardId }))
    )
    expect(cardsForImages(db, [])).toEqual([])
  })

  describe('price', () => {
    const priceOf = (db: Database.Database, code: string, rarity: string): number | null =>
      printingsByCode(db, code).find((r) => r.rarity === rarity)!.price
    const setCols = (
      db: Database.Database,
      code: string,
      rarity: string,
      market: number | null,
      set: number | null
    ): number => {
      const row = db
        .prepare('SELECT id FROM card_printings WHERE set_code = ? AND set_rarity = ?')
        .get(code, rarity) as { id: number }
      db.prepare('UPDATE card_printings SET market_price = ?, set_price = ? WHERE id = ?').run(
        market,
        set,
        row.id
      )
      return row.id
    }
    const ebay = (db: Database.Database, id: number, price: number): void => {
      db.prepare(
        "INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, 1, '2026-01-01')"
      ).run(id, price)
    }

    it("carries each printing's own price: market, then eBay, then set price", async () => {
      const { db } = await scanDb()
      const R = 'Ultra Rare (Extended Art)'
      const id = setCols(db, 'LOB-EN005', R, 12.5, 3)
      expect(priceOf(db, 'LOB-EN005', R)).toBe(12.5)
      setCols(db, 'LOB-EN005', R, null, 3)
      expect(priceOf(db, 'LOB-EN005', R)).toBe(3)
      ebay(db, id, 7)
      expect(priceOf(db, 'LOB-EN005', R)).toBe(7)
    })

    it('a non-English printing is priced from eBay only', async () => {
      const { db } = await scanDb()
      const id = setCols(db, 'LOB-FR005', 'Ultra Rare', 9, 3)
      expect(priceOf(db, 'LOB-FR005', 'Ultra Rare')).toBeNull()
      ebay(db, id, 4)
      expect(priceOf(db, 'LOB-FR005', 'Ultra Rare')).toBe(4)
    })

    it('a zero or missing price is null', async () => {
      const { db } = await scanDb()
      const R = 'Ultra Rare (Extended Art)'
      setCols(db, 'LOB-EN005', R, null, 0)
      expect(priceOf(db, 'LOB-EN005', R)).toBeNull()
      setCols(db, 'LOB-EN005', R, null, null)
      expect(priceOf(db, 'LOB-EN005', R)).toBeNull()
    })
  })
})

describe('printingsByNumber', () => {
  const PKM = localScope("'pkm'")

  async function numberDb(): Promise<Database.Database> {
    const db = await seededDb()
    const { cardIds } = seedPokemon(db)
    db.exec("DELETE FROM card_printings WHERE game = 'pkm'")
    const add = db.prepare(
      "INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity) VALUES ('pkm', ?, ?, ?, ?, ?)"
    )
    add.run(cardIds[0], 'en', 'Scarlet', 'SV3 045/193', 'Holofoil')
    add.run(cardIds[1], 'ja', 'Japan', 'SV1S 045/078', 'Normal')
    add.run(cardIds[1], 'ja', 'Japan', 'SVP 12', 'Normal')
    add.run(cardIds[1], 'en', 'Promos', 'SVP 045', 'Normal')
    add.run(cardIds[0], 'en', 'Gallery', 'SIT TG05/TG30', 'Normal')
    return db
  }
  const codes = (db: Database.Database, n: Parameters<typeof printingsByNumber>[1]): string[] =>
    printingsByNumber(db, n, PKM)
      .map((p) => p.setCode)
      .sort()

  it('matches number and total, ignoring leading zeros', async () => {
    const db = await numberDb()
    expect(codes(db, { setAbbrev: null, number: '45', total: '193' })).toEqual(['SV3 045/193'])
    expect(codes(db, { setAbbrev: null, number: '045', total: null })).toEqual([
      'SV1S 045/078',
      'SV3 045/193',
      'SVP 045'
    ])
  })

  it('matches a code with no total only when no total was read', async () => {
    const db = await numberDb()
    expect(codes(db, { setAbbrev: null, number: '045', total: '193' })).toEqual(['SV3 045/193'])
    expect(codes(db, { setAbbrev: 'SVP', number: '045', total: '193' })).toEqual(['SV3 045/193'])
  })

  it('never returns a Yu-Gi-Oh printing for a Pokémon scope', async () => {
    const db = await numberDb()
    const ygo = db
      .prepare("SELECT card_id AS id FROM card_printings WHERE game = 'ygo' LIMIT 1")
      .get() as { id: number }
    db.prepare(
      "INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity) VALUES ('ygo', ?, 'en', 'X', 'YGO 045/193', 'Common')"
    ).run(ygo.id)
    expect(codes(db, { setAbbrev: null, number: '45', total: '193' })).toEqual(['SV3 045/193'])
  })

  it('rebuilds its number index when the catalog version changes', async () => {
    const db = await numberDb()
    const n = { setAbbrev: null, number: '99', total: null }
    expect(codes(db, n)).toEqual([])
    const card = db
      .prepare("SELECT card_id AS id FROM card_printings WHERE game = 'pkm' LIMIT 1")
      .get() as { id: number }
    db.prepare(
      "INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity) VALUES ('pkm', ?, 'en', 'New', 'NEW 099/100', 'Normal')"
    ).run(card.id)
    expect(codes(db, n)).toEqual([])
    setMeta(db, 'db_version', 'next')
    expect(codes(db, n)).toEqual(['NEW 099/100'])
  })

  it('narrows by set abbreviation only when it matches a stored one', async () => {
    const db = await numberDb()
    expect(codes(db, { setAbbrev: 'sv1s', number: '045', total: null })).toEqual(['SV1S 045/078'])
    expect(codes(db, { setAbbrev: 'PAL', number: '045', total: '193' })).toEqual(['SV3 045/193'])
  })

  it('matches a code with no total and one whose number carries letters', async () => {
    const db = await numberDb()
    expect(codes(db, { setAbbrev: null, number: '012', total: null })).toEqual(['SVP 12'])
    expect(codes(db, { setAbbrev: null, number: 'TG05', total: 'TG30' })).toEqual(['SIT TG05/TG30'])
    expect(codes(db, { setAbbrev: null, number: '5', total: null })).toEqual([])
  })

  it('keeps to Pokémon, and the rows have the ScanPrinting shape', async () => {
    const db = await numberDb()
    const [row] = printingsByNumber(db, { setAbbrev: null, number: '45', total: '193' }, PKM)
    expect(row).toMatchObject({ language: 'en', rarity: 'Holofoil', imageIds: expect.any(Array) })
  })
})

describe("a Pokémon card's local name", () => {
  const PKM = localScope("'pkm'")

  it("carries the catalog's local-language name on a Pokémon printing, none on Yu-Gi-Oh's", async () => {
    const db = await seededDb()
    const { cardIds } = seedPokemon(db)
    // A Japanese card named in English, as TCGCSV names it, with its printed name beside it.
    db.prepare("UPDATE cards SET name = 'Pikachu' WHERE id = ?").run(cardIds[1])
    db.prepare("UPDATE pokemon_cards SET local_name = 'ピカチュウ' WHERE card_id = ?").run(
      cardIds[1]
    )
    const rows = printingsForCards(db, cardIds, PKM)
    expect(rows.filter((r) => r.cardId === cardIds[1]).map((r) => r.localName)).toEqual([
      'ピカチュウ',
      'ピカチュウ'
    ])
    // No local name: the key is left out, as on every Yu-Gi-Oh printing.
    expect(rows.filter((r) => r.cardId === cardIds[0]).every((r) => !('localName' in r))).toBe(true)
    const ygo = printingsByCode(db, 'LOB-EN005')
    expect(ygo.length).toBeGreaterThan(0)
    expect(ygo.every((r) => !('localName' in r))).toBe(true)
  })
})

describe('a Pokémon art twin with no artwork', () => {
  const PKM = localScope("'pkm'")

  it('marks a card with an unseen reprint: same name, illustrator and language, no image', async () => {
    const db = await seededDb()
    const { cardIds } = seedPokemon(db)
    const [pikachu, japanese] = cardIds
    db.prepare(
      "UPDATE pokemon_cards SET image_url = 'https://assets/x' WHERE card_id IN (?, ?)"
    ).run(pikachu, japanese)
    const add = (
      id: number,
      name: string,
      illustrator: string,
      sourceId: string,
      url: string | null
    ): void => {
      db.prepare(
        `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
         VALUES (?, 'pkm', ?, 'Pokémon', 'pokemon', 'Basic', '', '2026-10-29')`
      ).run(id, name)
      db.prepare(
        `INSERT INTO pokemon_cards (card_id, category, hp, types, stage, rarity, illustrator, source_id, image_url)
         VALUES (?, 'Pokémon', 60, '[]', 'Basic', 'Common', ?, ?, ?)`
      ).run(id, illustrator, sourceId, url)
      db.prepare(
        `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
         VALUES ('pkm', ?, ?, 'Reprints', 'R 1', 'Holofoil')`
      ).run(id, sourceId.slice(0, 2))
    }
    const twinned = (): boolean[] =>
      printingsForCards(db, [pikachu], PKM).map((p) => p.unseenTwin === true)
    expect(twinned()).toEqual([false, false])
    // Another illustrator's, another language's, or one with its artwork: not a twin.
    add(9001, 'Pikachu', 'Someone Else', 'en/x-1', null)
    add(9002, 'Pikachu', 'Naoyo Kimura', 'ja/X-1', null)
    add(9003, 'Pikachu', 'Naoyo Kimura', 'en/x-3', 'https://assets/y')
    expect(twinned()).toEqual([false, false])
    // A reprint with no artwork, as the Classic Collection's cards have none.
    add(9004, 'Pikachu', 'Naoyo Kimura', 'en/cel25cc-1', null)
    expect(twinned()).toEqual([true, true])
    db.prepare('DELETE FROM pokemon_cards WHERE card_id = 9004').run()
    expect(twinned()).toEqual([false, false])
    // A trainer kit's, whose only artwork is a product photo; and a blank written another way.
    add(
      9005,
      'Pikachu',
      'Naoyo Kimura',
      'en/tk-1',
      'https://tcgplayer-cdn.tcgplayer.com/product/1_200w.jpg'
    )
    expect(twinned()).toEqual([true, true])
    db.prepare('DELETE FROM pokemon_cards WHERE card_id = 9005').run()
    db.prepare("UPDATE cards SET name = '_____''s Pikachu' WHERE id = ?").run(pikachu)
    add(9006, "___'s Pikachu", 'Naoyo Kimura', 'en/cel25cc-2', null)
    expect(twinned()).toEqual([true, true])
    // Names written another way: Tapu Lele-GX and Tapu Lele GX, a star as ☆ or ★.
    db.prepare('DELETE FROM pokemon_cards WHERE card_id = 9006').run()
    db.prepare("UPDATE cards SET name = 'Umbreon ★' WHERE id = ?").run(pikachu)
    add(9007, 'Umbreon ☆', 'Naoyo Kimura', 'en/cel25cc-3', null)
    expect(twinned()).toEqual([true, true])
    expect(printingsByCode(db, 'LOB-EN005').every((r) => !('unseenTwin' in r))).toBe(true)
  })

  it('with no illustrator on record, a twin counts only from a set of the same series', async () => {
    const db = await seededDb()
    const { cardIds } = seedPokemon(db)
    const [pikachu] = cardIds
    db.prepare(
      "UPDATE pokemon_cards SET image_url = 'https://assets/x', illustrator = NULL WHERE card_id = ?"
    ).run(pikachu)
    db.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
       VALUES (9010, 'pkm', 'Pikachu', 'Pokémon', 'pokemon', 'Basic', '', '2026-10-29')`
    ).run()
    db.prepare(
      `INSERT INTO pokemon_cards (card_id, category, hp, types, stage, rarity, illustrator, source_id, image_url)
       VALUES (9010, 'Pokémon', 60, '[]', 'Basic', 'Common', NULL, 'en/tk-1', NULL)`
    ).run()
    db.prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
       VALUES ('pkm', 9010, 'en', 'Old Kit', 'TK 1/30', 'Normal')`
    ).run()
    const twinned = (): boolean =>
      printingsForCards(db, [pikachu], PKM).some(
        (p) => p.language === 'en' && p.unseenTwin === true
      )
    const own = db
      .prepare("SELECT set_name FROM card_printings WHERE card_id = ? AND language = 'en'")
      .pluck()
      .get(pikachu) as string
    // No series on record: still a twin, as before.
    expect(twinned()).toBe(true)
    const setSeries = db.prepare(
      `INSERT OR REPLACE INTO sets (game, language, set_name, set_code, series) VALUES ('pkm', 'en', ?, 'X', ?)`
    )
    setSeries.run(own, 'Mega Evolution')
    setSeries.run('Old Kit', 'Trainer kits')
    expect(twinned()).toBe(false)
    // A stamped promo of the set, from its own series' promo set.
    setSeries.run('Old Kit', 'Mega Evolution')
    expect(twinned()).toBe(true)
    // A database whose sets have no series column (the built catalog): series unknown, a twin.
    setSeries.run('Old Kit', 'Trainer kits')
    db.exec('ALTER TABLE sets DROP COLUMN series')
    expect(twinned()).toBe(true)
  })
})

describe('chineseOfArt', () => {
  const PKM = localScope("'pkm'")

  it("gives the Simplified Chinese printings showing a card's art, unless their rarities' art differs", async () => {
    const db = await seededDb()
    const { cardIds } = seedPokemon(db)
    const [pikachu] = cardIds
    const add = (
      id: number,
      rarity: string | null,
      language: string,
      twin: number | null
    ): void => {
      db.prepare(
        `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
         VALUES (?, 'pkm', 'Pikachu', 'Pokémon', 'pokemon', 'Basic', '', '2026-11-03')`
      ).run(id)
      db.prepare(
        `INSERT INTO pokemon_cards (card_id, category, hp, types, stage, rarity, source_id, art_twin_id)
         VALUES (?, 'Pokémon', 60, '[]', 'Basic', ?, ?, ?)`
      ).run(id, rarity, `${language}/X-${id}`, twin)
      db.prepare(
        `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
         VALUES ('pkm', ?, ?, 'Ardent Obsidian', ?, 'Common')`
      ).run(id, language, `CSV5C ${id}`)
    }
    db.prepare("UPDATE pokemon_cards SET rarity = 'Common' WHERE card_id = ?").run(pikachu)
    add(9101, 'Common', 'zh-hans', pikachu)
    add(9102, null, 'zh-hans', pikachu)
    // An Illustration Rare linked to the regular card by name and number: not its art.
    add(9103, 'Illustration Rare', 'zh-hans', pikachu)
    // Not Simplified, or linked elsewhere.
    add(9104, 'Common', 'zh-hant', pikachu)
    add(9105, 'Common', 'zh-hans', null)
    const found = chineseOfArt(db, [pikachu], PKM)
    expect(found.map((f) => [f.twinId, f.printing.cardId, f.printing.language])).toEqual([
      [pikachu, 9101, 'zh-hans'],
      [pikachu, 9102, 'zh-hans']
    ])
    expect(chineseOfArt(db, [], PKM)).toEqual([])
  })
})

describe('One Piece printings', () => {
  const OP = localScope("'op'")

  it('carry their own art, so art matched picks the printing and not just the card', async () => {
    const db = await seededDb()
    const card = onePieceCardId('en', 'OP01-120')
    db.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game)
       VALUES (?, 'Shanks', 'CHARACTER', 'op', '', '', '2026-11-04', 'op')`
    ).run(card)
    const image = db.prepare(
      "INSERT INTO card_images (image_id, card_id, sort_order, missing_from_api, game) VALUES (?, ?, ?, 0, 'op')"
    )
    image.run(onePieceImageId('en', 'OP01-120'), card, 0)
    image.run(onePieceImageId('en', 'OP01-120_p1'), card, 1)
    const add = db.prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity, set_rarity_code)
       VALUES ('op', ?, 'en', 'ROMANCE DAWN [OP-01]', 'OP01-120', ?, ?)`
    )
    add.run(card, 'SEC', 'OP01-120')
    add.run(card, 'SEC (Alternate Art)', 'OP01-120_p1')
    // A printing whose art the catalog lacks keeps the card's.
    add.run(card, 'SEC (Parallel)', 'OP01-120_p9')
    const byRarity = Object.fromEntries(
      printingsByCode(db, 'op01-120', OP).map((p) => [p.rarity, p.imageIds])
    )
    expect(byRarity).toEqual({
      SEC: [onePieceImageId('en', 'OP01-120')],
      'SEC (Alternate Art)': [onePieceImageId('en', 'OP01-120_p1')],
      'SEC (Parallel)': [onePieceImageId('en', 'OP01-120'), onePieceImageId('en', 'OP01-120_p1')]
    })
    expect(printingsByCode(db, 'OP01-120', OP)[0]).not.toHaveProperty('rarityCode')
  })
})

describe('printingsOfArt', () => {
  const MTG = localScope("'mtg'")
  const sid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

  /**
   * Lightning Strike: FRA 107 (en, foil and not) and an XYZ 5 reprint with the same look; a
   * borderless FRA 346 (another look); a Japanese FRA 107 whose image borrows the English art.
   * Delver: a two-faced card with a back face.
   */
  async function magicDb(): Promise<{
    db: Database.Database
    img: Record<string, number>
    back: number
    ygoImage: number
  }> {
    const db = await seededDb()
    const ygoImage = (
      db.prepare("SELECT image_id AS id FROM card_images WHERE game = 'ygo' LIMIT 1").get() as {
        id: number
      }
    ).id
    const card = (lang: string, oracle: string, name: string): number => {
      const id = mtgCardId(lang, oracle)
      db.prepare(
        `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
         VALUES (?, 'mtg', ?, 'Instant', 'mtg', '', '', '2026-11-12')`
      ).run(id, name)
      db.prepare('INSERT INTO mtg_cards (card_id, oracle_id, lang) VALUES (?, ?, ?)').run(
        id,
        oracle,
        lang
      )
      return id
    }
    const image = (
      cardId: number,
      n: number,
      o: { ill?: string; border?: string; artFrom?: string; back?: number } = {}
    ): number => {
      const id = mtgImageId(sid(n))
      db.prepare(
        "INSERT INTO card_images (image_id, card_id, sort_order, game) VALUES (?, ?, ?, 'mtg')"
      ).run(id, cardId, n)
      db.prepare(
        `INSERT INTO mtg_images (image_id, scryfall_id, illustration_id, frame, border_color, full_art,
           back_image_id, art_from) VALUES (?, ?, ?, '2015', ?, 0, ?, ?)`
      ).run(
        id,
        sid(n),
        o.ill ?? 'ill-strike',
        o.border ?? 'black',
        o.back ?? null,
        o.artFrom ?? null
      )
      return id
    }
    const printing = (
      cardId: number,
      lang: string,
      set: string,
      code: string,
      rarity: string,
      n: number
    ): void => {
      db.prepare(
        `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity, set_rarity_code)
         VALUES ('mtg', ?, ?, ?, ?, ?, ?)`
      ).run(cardId, lang, set, code, rarity, sid(n))
    }
    const en = card('en', 'o-strike', 'Lightning Strike')
    const ja = card('ja', 'o-strike', 'Lightning Strike')
    const delver = card('en', 'o-delver', 'Delver of Secrets')
    const img = {
      fra107: image(en, 1),
      xyz5: image(en, 2),
      fra346: image(en, 3, { border: 'borderless' }),
      ja107: image(ja, 4, { artFrom: sid(1) }),
      delver: image(delver, 5, { ill: 'ill-delver', back: mtgBackImageId(sid(5)) })
    }
    for (const r of ['Uncommon', 'Uncommon (Foil)']) {
      printing(en, 'en', 'Reality Fracture', 'FRA 107', r, 1)
      printing(en, 'en', 'Xyz Set', 'XYZ 5', r, 2)
      printing(en, 'en', 'Reality Fracture', 'FRA 346', r, 3)
      printing(ja, 'ja', 'Reality Fracture', 'FRA 107', r, 4)
      printing(delver, 'en', 'Innistrad', 'ISD 51', r, 5)
    }
    return { db, img, back: mtgBackImageId(sid(5)), ygoImage }
  }

  it('finds every printing of a look from its representative id', async () => {
    const { db, img } = await magicDb()
    const found = printingsOfArt(db, [img.fra107], MTG)
    expect(found.map((p) => `${p.setCode}|${p.language}|${p.rarity}`).sort()).toEqual([
      'FRA 107|en|Uncommon',
      'FRA 107|en|Uncommon (Foil)',
      'FRA 107|ja|Uncommon',
      'FRA 107|ja|Uncommon (Foil)',
      'XYZ 5|en|Uncommon',
      'XYZ 5|en|Uncommon (Foil)'
    ])
  })

  it('reaches a printing that borrows its art', async () => {
    const { db, img } = await magicDb()
    const ja = printingsOfArt(db, [img.fra107], MTG).filter((p) => p.language === 'ja')
    expect(ja).toHaveLength(2)
    expect(ja.every((p) => p.imageIds.length === 1 && p.imageIds[0] === img.ja107)).toBe(true)
    const own = printingsOfArt(db, [img.fra107], MTG).find((p) => p.setCode === 'XYZ 5')!
    expect(own.imageIds).toEqual([img.xyz5])
  })

  it('leads a back face id to the same printings as the front', async () => {
    const { db, img, back } = await magicDb()
    const front = printingsOfArt(db, [img.delver], MTG)
    expect(front.map((p) => p.setCode)).toEqual(['ISD 51', 'ISD 51'])
    expect(printingsOfArt(db, [back], MTG)).toEqual(front)
  })

  it('gives each printing the look ids it is matched by', async () => {
    const { db, img, back } = await magicDb()
    expect(printingsOfArt(db, [img.delver], MTG)[0].artIds).toEqual([img.delver, back])
    const strike = printingsOfArt(db, [img.xyz5], MTG)
    // The look's representative is its lowest-id English image, whichever of its ids was matched.
    expect(strike.every((p) => p.artIds?.length === 1 && p.artIds[0] === img.fra107)).toBe(true)
    expect(printingsOfArt(db, [img.fra346], MTG).every((p) => p.artIds![0] === img.fra346)).toBe(
      true
    )
  })

  it("gives a Magic printing found by its code the printing's own art", async () => {
    const { db, img } = await magicDb()
    expect(printingsByCode(db, 'XYZ 5', MTG).map((p) => p.imageIds)).toEqual([
      [img.xyz5],
      [img.xyz5]
    ])
    expect(printingsByCode(db, 'FRA 346', MTG).map((p) => p.imageIds)).toEqual([
      [img.fra346],
      [img.fra346]
    ])
  })

  it('ignores ids that are not Magic looks', async () => {
    const { db, ygoImage } = await magicDb()
    expect(printingsOfArt(db, [ygoImage, 12345], MTG)).toEqual([])
  })
})
