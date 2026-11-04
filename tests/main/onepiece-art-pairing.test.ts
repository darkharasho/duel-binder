import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { seededDb } from './helpers'
import { seedOnePiece } from '../fixtures/onePiece'
import { onePieceImageId } from '../../src/shared/games'
import { getCardDetail, rowToPrinting, type PrintingDbRow } from '../../src/main/repo/cards'
import { listEntries } from '../../src/main/repo/collection'
import { adjustPrinting, getChecklist } from '../../src/main/repo/sets'
import { listWishlist, setWish } from '../../src/main/repo/wishlist'

const SET_NAME = 'ROMANCE DAWN [OP-01]'
const now = new Date('2026-11-04T12:00:00.000Z')

const setGame = (db: Database.Database, game: string): void => {
  db.prepare("DELETE FROM meta WHERE key = 'active_game'").run()
  db.prepare("INSERT INTO meta (key, value) VALUES ('active_game', ?)").run(game)
}

describe('One Piece versions pair with their own art and price', () => {
  let db: Database.Database
  let op: ReturnType<typeof seedOnePiece>
  let altId: number
  const altArt = onePieceImageId('en', 'OP01-001_p1')

  beforeEach(async () => {
    db = await seededDb()
    op = seedOnePiece(db)
    altId = op.printingIds[1]
    const set = db.prepare(
      'UPDATE card_printings SET set_rarity_code = ?, market_price = ? WHERE id = ?'
    )
    set.run('OP01-001', 1.0, op.printingIds[0])
    set.run('OP01-001_p1', 40.0, altId)
  })

  it('gives each One Piece printing its own art; Yu-Gi-Oh! printings get none', () => {
    setGame(db, 'op')
    const printings = getCardDetail(db, op.cardIds[0])!.printings
    const alt = printings.find((p) => p.setRarity === 'L (Alternate Art)')
    const base = printings.find((p) => p.setRarity === 'L')
    expect(alt?.artImageId).toBe(altArt)
    expect(base?.artImageId).toBe(onePieceImageId('en', 'OP01-001'))
    setGame(db, 'ygo')
    const ygo = db
      .prepare("SELECT card_id FROM card_printings WHERE game = 'ygo' LIMIT 1")
      .get() as {
      card_id: number
    }
    for (const p of getCardDetail(db, ygo.card_id)!.printings)
      expect(p).not.toHaveProperty('artImageId')
  })

  it('a +1 on the Alternate Art adds it with its own art and price', () => {
    setGame(db, 'op')
    adjustPrinting(db, SET_NAME, 'en', altId, 1, now)
    const [entry, ...rest] = listEntries(db, { sort: 'name', dir: 'asc' })
    expect(rest).toEqual([])
    expect(entry.imageId).toBe(altArt)
    expect(entry.printing.id).toBe(altId)
    expect(entry.unitPrice).toBe(40)
    adjustPrinting(db, SET_NAME, 'en', altId, -1, now)
    expect(listEntries(db, { sort: 'name', dir: 'asc' })).toEqual([])
  })

  it("the set checklist shows the card's base art (L sorts first)", () => {
    setGame(db, 'op')
    const card = getChecklist(db, SET_NAME, 'en')!.cards.find((c) => c.cardId === op.cardIds[0])
    expect(card?.imageId).toBe(op.imageIds[0])
  })

  it("the checklist shows the first version's art only when the card has that image", () => {
    setGame(db, 'op')
    const tile = (): number | undefined =>
      getChecklist(db, SET_NAME, 'en')!.cards.find((c) => c.cardId === op.cardIds[0])?.imageId
    // The first version names an image the card doesn't have: the base image.
    db.prepare('UPDATE card_printings SET set_rarity_code = ? WHERE id = ?').run(
      'OP01-001_p9',
      op.printingIds[0]
    )
    expect(tile()).toBe(op.imageIds[0])
    // With the base version gone, the Alternate Art is first, and the card has its image.
    db.prepare('DELETE FROM card_printings WHERE id = ?').run(op.printingIds[0])
    expect(tile()).toBe(altArt)
  })

  it('a contributed printing never names art', () => {
    db.prepare('UPDATE card_printings SET contributed = 1 WHERE id = ?').run(altId)
    const row = db
      .prepare(
        `SELECT id, card_id, set_name, set_code, set_rarity, set_rarity_code, set_price, market_price,
                missing_from_api, language, contributed FROM card_printings WHERE id = ?`
      )
      .get(altId) as PrintingDbRow
    expect(row.set_rarity_code).toBe('OP01-001_p1')
    expect(rowToPrinting(row)).not.toHaveProperty('artImageId')
  })

  it('a wanted Alternate Art shows its own art; a Yu-Gi-Oh! want keeps its first image', () => {
    setGame(db, 'op')
    setWish(db, altId, null, now)
    expect(listWishlist(db).map((w) => w.imageId)).toEqual([altArt])
    setGame(db, 'ygo')
    const ygo = db
      .prepare(
        `SELECT p.id, (SELECT i.image_id FROM card_images i WHERE i.card_id = p.card_id
                       ORDER BY i.sort_order LIMIT 1) AS image_id
         FROM card_printings p WHERE p.game = 'ygo' ORDER BY p.id LIMIT 1`
      )
      .get() as { id: number; image_id: number }
    setWish(db, ygo.id, null, now)
    expect(listWishlist(db).map((w) => w.imageId)).toEqual([ygo.image_id])
  })
})
