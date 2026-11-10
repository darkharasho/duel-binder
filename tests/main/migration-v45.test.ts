import Database from 'better-sqlite3'
import { migrate } from '../../src/main/db/database'
import { seedMagic } from '../fixtures/magic'
import { databaseAt } from './helpers'

const names = (db: Database.Database, type: string): string[] =>
  (db.prepare('SELECT name FROM sqlite_master WHERE type = ?').all(type) as { name: string }[]).map(
    (r) => r.name
  )

describe('migration V45 (Magic languages and faces)', () => {
  it('adds the columns and indexes, keeping existing rows', () => {
    const old = databaseAt(44)
    const { cardIds, imageIds } = seedMagic(old)
    const card = old.prepare('SELECT * FROM mtg_cards WHERE card_id = ?').get(cardIds[0]) as Record<string, unknown>
    const image = old.prepare('SELECT * FROM mtg_images WHERE image_id = ?').get(imageIds[0]) as Record<string, unknown>
    migrate(old)
    expect(old.prepare('SELECT * FROM mtg_cards WHERE card_id = ?').get(cardIds[0])).toEqual({
      ...card,
      lang: 'en',
      local_name: null,
      local_name_search: null
    })
    expect(old.prepare('SELECT * FROM mtg_images WHERE image_id = ?').get(imageIds[0])).toEqual({
      ...image,
      back_image_id: null,
      art_from: null
    })
    expect(names(old, 'index')).toEqual(
      expect.arrayContaining(['ix_mtg_cards_local_name', 'ix_mtg_images_back'])
    )
    old.close()
  })

  it('the mtg_cards rollup triggers still fire', () => {
    const db = databaseAt(44)
    const { cardIds } = seedMagic(db)
    migrate(db)
    expect(names(db, 'trigger')).toContain('rollup_mtg_cards_update')
    db.prepare("INSERT INTO catalog_rollups (key, value) VALUES ('k', 'v')").run()
    db.prepare('UPDATE mtg_cards SET colors = \'["W","U"]\' WHERE card_id = ?').run(cardIds[0])
    expect(db.prepare('SELECT count(*) AS n FROM catalog_rollups').get()).toEqual({ n: 0 })
    db.close()
  })
})
