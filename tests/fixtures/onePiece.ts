import type { SqlDb } from '../../src/main/db/sql'
import { onePieceCardId, onePieceImageId } from '../../src/shared/games'
import { SHARED_SET_NAME } from './pokemon'

const SET_NAME = 'ROMANCE DAWN [OP-01]'
const NUMBER = 'OP01-001'

/**
 * One One Piece card (a Leader) with a base and a parallel image and two printings of one set
 * under one code ('L' and 'L (Alternate Art)'), plus a `sets` row named exactly like an English
 * Yu-Gi-Oh! fixture set. Every row has game 'op'. Needs the V40 schema; works on desktop and server.
 */
export function seedOnePiece(db: SqlDb): { cardIds: number[]; printingIds: number[]; imageIds: number[] } {
  const cardId = onePieceCardId('en', NUMBER)
  const images = [
    { id: onePieceImageId('en', NUMBER), bandai: NUMBER, order: 0 },
    { id: onePieceImageId('en', `${NUMBER}_p1`), bandai: `${NUMBER}_p1`, order: 1 }
  ]
  const printingIds: number[] = []
  db.transaction(() => {
    db.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
       VALUES (?, 'op', 'Monkey.D.Luffy', 'Leader', 'op', '', '', '2026-11-04')`
    ).run(cardId)
    db.prepare(
      `INSERT INTO onepiece_cards (card_id, number, colors, card_type, life, power, attribute, traits, effect)
       VALUES (?, ?, '["Red"]', 'Leader', 5, 5000, '["Strike"]', '["Straw Hat Crew"]', '[Activate: Main] Give 1 Rested DON!!')`
    ).run(cardId, NUMBER)
    const image = db.prepare(
      "INSERT INTO card_images (image_id, game, card_id, sort_order) VALUES (?, 'op', ?, ?)"
    )
    const bandai = db.prepare('INSERT INTO onepiece_images (image_id, bandai_id) VALUES (?, ?)')
    for (const i of images) {
      image.run(i.id, cardId, i.order)
      bandai.run(i.id, i.bandai)
    }
    db.prepare("INSERT INTO sets (game, language, set_name, set_code) VALUES ('op', 'en', ?, 'OP01')").run(
      SHARED_SET_NAME
    )
    const printing = db.prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
       VALUES ('op', ?, 'en', ?, ?, ?)`
    )
    for (const rarity of ['L', 'L (Alternate Art)']) {
      printingIds.push(Number(printing.run(cardId, SET_NAME, NUMBER, rarity).lastInsertRowid))
    }
  })()
  return { cardIds: [cardId], printingIds, imageIds: images.map((i) => i.id) }
}
