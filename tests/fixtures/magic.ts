import type { SqlDb } from '../../src/main/db/sql'
import { mtgCardId, mtgImageId } from '../../src/shared/games'

const ORACLE_ID = '0c7437ff-d1e1-4b46-8f4b-8e6a3c8e1f10'
const SCRYFALL_IDS = [
  '6e5e1c1b-0d4e-4c6e-9d2a-1d1f2b6a7c01',
  '6e5e1c1b-0d4e-4c6e-9d2a-1d1f2b6a7c02'
]
const SET_NAME = 'Magic 2015'

/**
 * One Magic card (a creature) with two Scryfall objects (images) and three printings: 'Rare' and
 * 'Rare (Foil)' of the first, 'Rare' of the second (a different collector number), plus one `sets`
 * row. Every row has game 'mtg'. Needs the V44 schema; works on desktop and server.
 */
export function seedMagic(db: SqlDb): {
  cardIds: number[]
  printingIds: number[]
  imageIds: number[]
} {
  const cardId = mtgCardId('en', ORACLE_ID)
  const images = SCRYFALL_IDS.map((s, order) => ({ id: mtgImageId(s), scryfall: s, order }))
  const printingIds: number[] = []
  db.transaction(() => {
    db.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
       VALUES (?, 'mtg', 'Serra Angel', 'Creature', 'mtg', '', '', '2026-11-09')`
    ).run(cardId)
    db.prepare(
      `INSERT INTO mtg_cards (card_id, oracle_id, layout, type_line, types, mana_cost, mana_value, colors,
         color_identity, oracle_text, power, toughness, keywords)
       VALUES (?, ?, 'normal', 'Creature - Angel', '["Creature"]', '{3}{W}{W}', 5, '["W"]', '["W"]',
         'Flying, vigilance', '4', '4', '["Flying","Vigilance"]')`
    ).run(cardId, ORACLE_ID)
    const image = db.prepare(
      "INSERT INTO card_images (image_id, game, card_id, sort_order) VALUES (?, 'mtg', ?, ?)"
    )
    const scry = db.prepare(
      `INSERT INTO mtg_images (image_id, scryfall_id, illustration_id, artist, frame, border_color, full_art, promo_types)
       VALUES (?, ?, ?, 'Greg Staples', '2015', 'black', 0, '[]')`
    )
    for (const i of images) {
      image.run(i.id, cardId, i.order)
      scry.run(i.id, i.scryfall, `ill-${i.order}`)
    }
    db.prepare(
      "INSERT INTO sets (game, language, set_name, set_code) VALUES ('mtg', 'en', ?, 'M15')"
    ).run(SET_NAME)
    const printing = db.prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
       VALUES ('mtg', ?, 'en', ?, ?, ?)`
    )
    for (const [code, rarity] of [
      ['M15 33', 'Rare'],
      ['M15 33', 'Rare (Foil)'],
      ['M15 34', 'Rare']
    ]) {
      printingIds.push(Number(printing.run(cardId, SET_NAME, code, rarity).lastInsertRowid))
    }
  })()
  return { cardIds: [cardId], printingIds, imageIds: images.map((i) => i.id) }
}
