import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { seededDb } from './helpers'
import { seedMagic } from '../fixtures/magic'
import { mtgBackImageId, mtgCardId, mtgImageId } from '../../src/shared/games'
import { addEntry, getFacets, listEntries } from '../../src/main/repo/collection'
import { browseCards, browseFacets } from '../../src/main/repo/browse'
import { getCardDetail, searchCards } from '../../src/main/repo/cards'
import { getStats } from '../../src/main/repo/stats'
import { magicFacets } from '../../src/main/repo/mtgFilters'
import { LOCAL } from '../../src/main/repo/scope'

const now = new Date('2026-11-09T12:00:00.000Z')

describe('Magic filters, facets, stats and details', () => {
  let db: Database.Database
  let mtg: { cardIds: number[]; printingIds: number[]; imageIds: number[] }
  const instant = mtgCardId('en', 'inst-oracle')
  const artifact = mtgCardId('en', 'arti-oracle')
  const addCard = (
    id: number,
    name: string,
    type: string,
    mc: (string | number | null)[],
    code: string
  ): number => {
    db.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
       VALUES (?, 'mtg', ?, ?, 'mtg', '', '', '2026-11-09')`
    ).run(id, name, type)
    db.prepare(
      `INSERT INTO mtg_cards (card_id, oracle_id, layout, type_line, types, mana_cost, mana_value, colors,
         color_identity, oracle_text, power, toughness, keywords)
       VALUES (?, ?, 'normal', ?, ?, '', ?, ?, '[]', '', ?, ?, '[]')`
    ).run(id, `o-${id}`, type, ...mc)
    const image = mtgImageId(`img-${id}`)
    db.prepare(
      "INSERT INTO card_images (image_id, game, card_id, sort_order) VALUES (?, 'mtg', ?, 0)"
    ).run(image, id)
    db.prepare(
      `INSERT INTO mtg_images (image_id, scryfall_id, illustration_id, artist, frame, border_color, full_art, promo_types)
       VALUES (?, ?, 'ill', 'Mark Tedin', '2015', 'black', 0, '[]')`
    ).run(image, `img-${id}`)
    return Number(
      db
        .prepare(
          `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
           VALUES ('mtg', ?, 'en', 'Magic 2015', ?, 'Common')`
        )
        .run(id, code).lastInsertRowid
    )
  }
  const browse = (f: object): string[] =>
    browseCards(db, { sort: 'name', dir: 'asc', ...f }).cards.map((c) => c.name)
  const owned = (f: object): string[] =>
    listEntries(db, { sort: 'name', dir: 'asc', ...f }).map((e) => e.card.name)

  beforeEach(async () => {
    db = await seededDb()
    mtg = seedMagic(db)
    db.prepare("DELETE FROM meta WHERE key = 'active_game'").run()
    db.prepare("INSERT INTO meta (key, value) VALUES ('active_game', 'mtg')").run()
    const p1 = addCard(instant, 'Opt', 'Instant', ['["Instant"]', 1, '["U"]', null, null], 'M15 60')
    const p2 = addCard(
      artifact,
      'Walker',
      'Artifact',
      ['["Artifact","Creature"]', 3, '[]', '*', '*'],
      'M15 70'
    )
    addEntry(db, { printingId: mtg.printingIds[1], imageId: mtg.imageIds[0], quantity: 1 }, now)
    addEntry(db, { printingId: p1, imageId: mtgImageId(`img-${instant}`), quantity: 2 }, now)
    addEntry(db, { printingId: p2, imageId: mtgImageId(`img-${artifact}`), quantity: 1 }, now)
  })

  it('filters by color, type, mana value and power, in Browse and the collection', () => {
    for (const run of [browse, owned]) {
      expect(run({ mtgColors: ['Blue'] })).toEqual(['Opt'])
      expect(run({ mtgColors: ['Colorless'] })).toEqual(['Walker'])
      expect(run({ mtgColors: ['White', 'Blue'] })).toEqual(['Opt', 'Serra Angel'])
      expect(run({ mtgTypes: ['Creature'] })).toEqual(['Serra Angel', 'Walker'])
      expect(run({ manaValueMin: 0, manaValueMax: 2 })).toEqual(['Opt'])
      expect(run({ mtgPowerMin: 4 })).toEqual(['Serra Angel'])
      expect(run({ mtgToughnessMax: 100 })).toEqual(['Serra Angel'])
    }
  })

  it('filters the collection by finish', () => {
    expect(owned({ mtgFinishes: ['Foil'] })).toEqual(['Serra Angel'])
    expect(owned({ mtgFinishes: ['Nonfoil'] })).toEqual(['Opt', 'Walker'])
    expect(browse({ mtgFinishes: ['Foil'] })).toEqual(['Serra Angel'])
  })

  it('lists base rarities, and Rare matches the foil printing too', () => {
    expect(browseFacets(db).rarities).toEqual(['Common', 'Rare'])
    expect(getFacets(db).rarities).toEqual(['Common', 'Rare'])
    expect(owned({ rarities: ['Rare'] })).toEqual(['Serra Angel'])
    expect(browse({ rarities: ['Rare'] })).toEqual(['Serra Angel'])
  })

  it('builds the facets in display order', () => {
    const b = browseFacets(db)
    expect(b.mtgColors).toEqual(['White', 'Blue', 'Colorless'])
    expect(b.mtgTypes).toEqual(['Artifact', 'Creature', 'Instant'])
    expect(b.mtgFinishes).toEqual(['Nonfoil', 'Foil'])
    expect(getFacets(db).mtgColors).toEqual(['White', 'Blue', 'Colorless'])
    expect(magicFacets(db, LOCAL, [instant])).toEqual({
      mtgColors: ['Blue'],
      mtgTypes: ['Instant'],
      mtgFinishes: ['Nonfoil']
    })
  })

  it('counts owned copies by card type', () => {
    const by = Object.fromEntries(getStats(db).byFrameType.map((r) => [r.frameType, r.count]))
    expect(by).toEqual({ Creature: 1, Instant: 2, Artifact: 1 })
  })

  it('joins the artists of the art', () => {
    db.prepare("UPDATE mtg_images SET artist = 'Zed' WHERE image_id = ?").run(mtg.imageIds[1])
    expect(getCardDetail(db, mtg.cardIds[0])?.card.magic?.artist).toBe('Greg Staples, Zed')
  })

  it('lists only the finishes the collection owns, and Browse the catalog ones', () => {
    expect(getFacets(db).mtgFinishes).toEqual(['Nonfoil', 'Foil'])
    db.prepare('DELETE FROM collection_entries WHERE printing_id = ?').run(mtg.printingIds[1])
    addEntry(db, { printingId: mtg.printingIds[0], imageId: mtg.imageIds[0], quantity: 1 }, now)
    expect(getFacets(db).mtgFinishes).toEqual(['Nonfoil'])
    expect(browseFacets(db).mtgFinishes).toEqual(['Nonfoil', 'Foil'])
  })

  it('limits the Browse finish facet to the language filter', () => {
    db.prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
       VALUES ('mtg', ?, 'ja', 'Magic 2015', 'M15 33', 'Rare (Etched Foil)')`
    ).run(mtg.cardIds[0])
    expect(browseFacets(db, LOCAL, 'ja').mtgFinishes).toEqual(['Etched Foil'])
    expect(browseFacets(db, LOCAL, 'en').mtgFinishes).toEqual(['Nonfoil', 'Foil'])
  })

  it("shows each Magic printing's own Scryfall object's art", () => {
    const scry = ['6e5e1c1b-0d4e-4c6e-9d2a-1d1f2b6a7c01', '6e5e1c1b-0d4e-4c6e-9d2a-1d1f2b6a7c02']
    const set = db.prepare('UPDATE card_printings SET set_rarity_code = ? WHERE id = ?')
    set.run(scry[0], mtg.printingIds[0])
    set.run(scry[0], mtg.printingIds[1])
    set.run(scry[1], mtg.printingIds[2])
    const art = Object.fromEntries(
      getCardDetail(db, mtg.cardIds[0])!.printings.map((p) => [p.id, p.artImageId])
    )
    expect(art).toEqual({
      [mtg.printingIds[0]]: mtgImageId(scry[0]),
      [mtg.printingIds[1]]: mtgImageId(scry[0]),
      [mtg.printingIds[2]]: mtgImageId(scry[1])
    })
    expect(mtgImageId(scry[0])).toBe(mtg.imageIds[0])
    expect(mtgImageId(scry[1])).toBe(mtg.imageIds[1])
  })

  it('gives a Magic image its back face, and only one that has a back', () => {
    const back = mtgBackImageId('6e5e1c1b-0d4e-4c6e-9d2a-1d1f2b6a7c02')
    db.prepare('UPDATE mtg_images SET back_image_id = ? WHERE image_id = ?').run(
      back,
      mtg.imageIds[1]
    )
    expect(getCardDetail(db, mtg.cardIds[0])!.images).toEqual([
      { imageId: mtg.imageIds[0], cardId: mtg.cardIds[0], sortOrder: 0 },
      { imageId: mtg.imageIds[1], cardId: mtg.cardIds[0], sortOrder: 1, backImageId: back }
    ])
  })

  it('shows and searches the printed name of a Japanese card', () => {
    const ja = mtgCardId('ja', 'serra-oracle')
    db.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
       VALUES (?, 'mtg', 'Serra Angel', 'Creature', 'mtg', '', '', '2026-11-09')`
    ).run(ja)
    db.prepare(
      `INSERT INTO mtg_cards (card_id, oracle_id, layout, type_line, types, mana_cost, mana_value, colors,
         color_identity, oracle_text, power, toughness, keywords, lang, local_name)
       VALUES (?, 'serra-oracle', 'normal', 'Creature - Angel', '["Creature"]', '{3}{W}{W}', 5, '["W"]',
         '["W"]', '', '4', '4', '[]', 'ja', 'セラの天使')`
    ).run(ja)
    const p = Number(
      db
        .prepare(
          `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
           VALUES ('mtg', ?, 'ja', 'Magic 2015', 'M15 33', 'Rare')`
        )
        .run(ja).lastInsertRowid
    )
    db.prepare(
      "INSERT INTO card_images (image_id, game, card_id, sort_order) VALUES (?, 'mtg', ?, 0)"
    ).run(mtgImageId('ja-img'), ja)
    addEntry(db, { printingId: p, imageId: mtgImageId('ja-img'), quantity: 1 }, now)
    db.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`)

    expect(getCardDetail(db, ja)!.card.magic?.localName).toBe('セラの天使')
    expect(getCardDetail(db, mtg.cardIds[0])!.card.magic?.localName).toBeNull()
    expect(searchCards(db, 'セラの').map((r) => r.id)).toEqual([ja])
    expect(
      searchCards(db, 'Serra Angel')
        .map((r) => r.id)
        .sort()
    ).toEqual([mtg.cardIds[0], ja].sort())
    expect(
      browseCards(db, { sort: 'name', dir: 'asc', q: 'の天使' }).cards.map((c) => c.id)
    ).toEqual([ja])
    expect(
      listEntries(db, { sort: 'name', dir: 'asc', q: 'の天使' }).map((e) => e.card.id)
    ).toEqual([ja])
    expect(browse({ q: 'Serra' })).toEqual(['Serra Angel', 'Serra Angel'])
  })

  it('search puts English first among same-named cards and labels each language', () => {
    const add = (lang: string, localName: string | null): number => {
      const id = mtgCardId(lang, 'serra-oracle')
      db.prepare(
        `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
         VALUES (?, 'mtg', 'Serra Angel', 'Creature', 'mtg', '', '', '2026-11-09')`
      ).run(id)
      db.prepare(
        `INSERT INTO mtg_cards (card_id, oracle_id, layout, type_line, lang, local_name)
         VALUES (?, 'serra-oracle', 'normal', 'Creature - Angel', ?, ?)`
      ).run(id, lang, localName)
      return id
    }
    // Inserted German, Japanese: the order out must not follow the table's.
    const de = add('de', 'Serra-Engel')
    const ja = add('ja', 'セラの天使')
    db.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`)
    const hits = searchCards(db, 'Serra Angel')
    expect(hits.map((r) => r.id)).toEqual([mtg.cardIds[0], ja, de])
    expect(hits.map((r) => [r.language, r.localName])).toEqual([
      ['en', undefined],
      ['ja', 'セラの天使'],
      ['de', 'Serra-Engel']
    ])
  })

  it('gives artists in a fixed order, only on the details read', () => {
    db.prepare("UPDATE mtg_images SET artist = 'Zed' WHERE image_id = ?").run(mtg.imageIds[0])
    db.prepare("UPDATE mtg_images SET artist = 'Abe' WHERE image_id = ?").run(mtg.imageIds[1])
    expect(getCardDetail(db, mtg.cardIds[0])?.card.magic?.artist).toBe('Abe, Zed')
    expect(listEntries(db, { sort: 'name', dir: 'asc' })[0].card.magic?.artist).toBeUndefined()
  })
})
