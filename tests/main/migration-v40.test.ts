import Database from 'better-sqlite3'
import { migrate } from '../../src/main/db/database'
import { onePieceCardId } from '../../src/shared/games'
import { seedOnePiece } from '../fixtures/onePiece'
import { seedPokemon } from '../fixtures/pokemon'
import { databaseAt, seededDb } from './helpers'

const names = (db: Database.Database, type: string): string[] =>
  (db.prepare('SELECT name FROM sqlite_master WHERE type = ?').all(type) as { name: string }[]).map(
    (r) => r.name
  )

describe('migration V40 (onepiece_cards and onepiece_images)', () => {
  it('creates both tables, keeps every pkey, and takes the One Piece fixture', async () => {
    const db = await seededDb()
    db.close()
    const old = databaseAt(39)
    seedPokemon(old)
    const before = old.prepare('SELECT pkey FROM card_printings ORDER BY id').all()
    expect(before.length).toBeGreaterThan(0)
    expect(names(old, 'table')).not.toContain('onepiece_cards')
    migrate(old)

    expect(names(old, 'table')).toEqual(expect.arrayContaining(['onepiece_cards', 'onepiece_images']))
    expect(old.prepare('SELECT pkey FROM card_printings ORDER BY id').all()).toEqual(before)
    expect(old.prepare('PRAGMA foreign_key_check').all()).toEqual([])

    const { printingIds, cardIds, imageIds } = seedOnePiece(old)
    expect(cardIds).toEqual([onePieceCardId('en', 'OP01-001')])
    expect(imageIds).toHaveLength(2)
    const pkeys = printingIds.map(
      (id) => (old.prepare('SELECT pkey FROM card_printings WHERE id = ?').get(id) as { pkey: string }).pkey
    )
    expect(pkeys).toEqual([`en|${cardIds[0]}|OP01-001|L`, `en|${cardIds[0]}|OP01-001|L (Alternate Art)`])
    expect(old.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    old.close()
  })

  it('updating onepiece_cards.card_type clears the rollups', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrate(db)
    const { cardIds } = seedOnePiece(db)
    expect(names(db, 'trigger')).toContain('rollup_onepiece_cards_update')
    const rollups = (): number =>
      (db.prepare('SELECT count(*) AS n FROM catalog_rollups').get() as { n: number }).n
    db.prepare("INSERT INTO catalog_rollups (key, value) VALUES ('k', 'v')").run()
    db.prepare('UPDATE onepiece_cards SET effect = ? WHERE card_id = ?').run('x', cardIds[0])
    expect(rollups()).toBe(1) // game text no rollup reads
    db.prepare("UPDATE onepiece_cards SET card_type = 'Character' WHERE card_id = ?").run(cardIds[0])
    expect(rollups()).toBe(0)
    db.close()
  })
})
