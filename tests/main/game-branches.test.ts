import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { seededDb } from './helpers'
import { seedPokemon } from '../fixtures/pokemon'
import { seedOnePiece } from '../fixtures/onePiece'
import { onePieceCardId, onePieceImageId } from '../../src/shared/games'
import { addEntry, getFacets, listEntries } from '../../src/main/repo/collection'
import { browseCards, browseFacets } from '../../src/main/repo/browse'
import { getStats } from '../../src/main/repo/stats'

const now = new Date('2026-11-04T12:00:00.000Z')

const setGame = (db: Database.Database, game: string): void => {
  db.prepare("DELETE FROM meta WHERE key = 'active_game'").run()
  db.prepare("INSERT INTO meta (key, value) VALUES ('active_game', ?)").run(game)
}

describe('string branches on game, One Piece decided explicitly', () => {
  let db: Database.Database
  let op: { cardIds: number[]; printingIds: number[]; imageIds: number[] }
  let pkm: { cardIds: number[]; printingIds: number[] }

  beforeEach(async () => {
    db = await seededDb()
    pkm = seedPokemon(db)
    op = seedOnePiece(db)
    const ygo = db
      .prepare(
        `SELECT p.id, (SELECT image_id FROM card_images WHERE card_id = p.card_id LIMIT 1) AS imageId
         FROM card_printings p WHERE p.game = 'ygo' AND p.language = 'en' ORDER BY p.id LIMIT 1`
      )
      .get() as { id: number; imageId: number }
    addEntry(db, { printingId: ygo.id, imageId: ygo.imageId, quantity: 2 }, now)
    setGame(db, 'pkm')
    addEntry(db, { printingId: pkm.printingIds[0], imageId: pkm.cardIds[0], quantity: 1 }, now)
    setGame(db, 'op')
    addEntry(db, { printingId: op.printingIds[0], imageId: op.imageIds[0], quantity: 4 }, now)
    // A second card that sorts first by name but last by ATK (a Yu-Gi-Oh column), so a wrong
    // fallback shows.
    const id = onePieceCardId('en', 'OP01-002')
    db.prepare(`UPDATE cards SET atk = 5000 WHERE id = ?`).run(op.cardIds[0])
    db.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", atk, updated_at)
       VALUES (?, 'op', 'Aaa', 'Character', 'op', '', '', 9000, '2026-11-04')`
    ).run(id)
    db.prepare(
      "INSERT INTO card_images (image_id, game, card_id, sort_order) VALUES (?, 'op', ?, 0)"
    ).run(onePieceImageId('en', 'OP01-002'), id)
    db.prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
       VALUES ('op', ?, 'en', 'ROMANCE DAWN [OP-01]', 'OP01-002', 'C')`
    ).run(id)
  })

  it("stats: byFrameType is empty on 'op' and unchanged on the other games", () => {
    expect(getStats(db).byFrameType).toEqual([])
    setGame(db, 'ygo')
    expect(getStats(db).byFrameType.length).toBeGreaterThan(0)
    setGame(db, 'pkm')
    expect(getStats(db).byFrameType.map((f) => f.frameType)).toEqual(['Pokémon'])
  })

  it("facets: 'op' reads no Yu-Gi-Oh columns, Yu-Gi-Oh keeps its lists", () => {
    const f = getFacets(db)
    expect([f.cardTypes, f.attributes, f.archetypes]).toEqual([[], [], []])
    const b = browseFacets(db)
    expect([b.cardTypes, b.attributes, b.races, b.archetypes]).toEqual([[], [], [], []])
    setGame(db, 'ygo')
    expect(getFacets(db).cardTypes.length).toBeGreaterThan(0)
    expect(browseFacets(db).cardTypes.length).toBeGreaterThan(0)
    expect(browseFacets(db).races.length).toBeGreaterThan(0)
  })

  it("browse: atk, def, level and hp fall back to name on 'op'", () => {
    const byName = browseCards(db, { sort: 'name', dir: 'asc' }).cards.map((c) => c.name)
    expect(byName).toEqual(['Aaa', 'Monkey.D.Luffy'])
    for (const sort of ['atk', 'def', 'level', 'hp'] as const) {
      expect(browseCards(db, { sort, dir: 'asc' }).cards.map((c) => c.name)).toEqual(byName)
    }
  })

  it('browse: Yu-Gi-Oh sorts by atk and Pokémon sorts by hp, as before', () => {
    setGame(db, 'ygo')
    const ygoName = browseCards(db, { sort: 'name', dir: 'asc' }).cards.map((c) => c.id)
    const top = db
      .prepare("SELECT atk FROM cards WHERE game = 'ygo' ORDER BY atk DESC LIMIT 1")
      .get() as { atk: number }
    const first = browseCards(db, { sort: 'atk', dir: 'desc' }).cards[0]
    expect(db.prepare('SELECT atk FROM cards WHERE id = ?').get(first.id)).toEqual({ atk: top.atk })
    // hp has no column on Yu-Gi-Oh: it is the name order.
    expect(browseCards(db, { sort: 'hp', dir: 'asc' }).cards.map((c) => c.id)).toEqual(ygoName)
    setGame(db, 'pkm')
    const pkmName = browseCards(db, { sort: 'name', dir: 'asc' }).cards.map((c) => c.id)
    expect(browseCards(db, { sort: 'atk', dir: 'asc' }).cards.map((c) => c.id)).toEqual(pkmName)
  })

  it("nothing from another game shows while 'op' is active", () => {
    expect(listEntries(db, { sort: 'name', dir: 'asc' }).map((e) => e.card.id)).toEqual(op.cardIds)
    const cards = browseCards(db, { sort: 'name', dir: 'asc' }).cards
    expect(cards.length).toBe(2)
    expect(cards.every((c) => c.id >= 2 ** 39 && c.id < 2 ** 40)).toBe(true)
    expect(getStats(db).totalCards).toBe(4)
  })
})
