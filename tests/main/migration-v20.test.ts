import Database from 'better-sqlite3'
import { migrate } from '../../src/main/db/database'
import { seedPokemon } from '../fixtures/pokemon'
import { databaseAt } from './helpers'

const columns = (db: Database.Database, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)

describe('migration V20 (pokemon_cards image_url and local_name)', () => {
  it('a fresh database has both columns, after the V19 ones', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrate(db)
    expect(columns(db, 'pokemon_cards')).toEqual([
      'card_id',
      'category',
      'hp',
      'types',
      'stage',
      'rarity',
      'illustrator',
      'source_id',
      'image_url',
      'local_name',
      'art_twin_id',
      'traditional_twin_id'
    ])
    db.close()
  })

  it('keeps a V19 row, with nulls in both columns', () => {
    const db = databaseAt(19)
    const { cardIds } = seedPokemon(db)
    migrate(db)
    expect(
      db.prepare('SELECT card_id, source_id, image_url, local_name FROM pokemon_cards ORDER BY source_id DESC').all()
    ).toEqual([
      { card_id: cardIds[0], source_id: 'sv02-045', image_url: null, local_name: null },
      { card_id: cardIds[1], source_id: 'ja/SV2D-030', image_url: null, local_name: null }
    ])
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    db.close()
  })
})
