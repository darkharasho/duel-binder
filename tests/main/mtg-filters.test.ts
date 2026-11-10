import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { seededDb } from './helpers'
import { seedMagic } from '../fixtures/magic'
import { mtgCardId, mtgImageId } from '../../src/shared/games'
import { addEntry, getFacets, listEntries } from '../../src/main/repo/collection'
import { browseCards, browseFacets } from '../../src/main/repo/browse'
import { getCardDetail } from '../../src/main/repo/cards'
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
})
