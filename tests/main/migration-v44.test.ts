import Database from 'better-sqlite3'
import { migrate } from '../../src/main/db/database'
import { PHONE_TABLES } from '../../src/shared/catalogFeed'
import { getMeta, setMeta } from '../../src/main/db/meta'
import { gameFactsRead, rowToCard, type CardDbRow } from '../../src/main/repo/cards'
import { CATALOG_TABLES } from '../../src/shared/catalogTables'
import { mtgCardId } from '../../src/shared/games'
import { seedMagic } from '../fixtures/magic'
import { seedPokemon } from '../fixtures/pokemon'
import { databaseAt, seededDb } from './helpers'

const names = (db: Database.Database, type: string): string[] =>
  (db.prepare('SELECT name FROM sqlite_master WHERE type = ?').all(type) as { name: string }[]).map(
    (r) => r.name
  )

const mtgRead = gameFactsRead('mtg')

describe('migration V44 (mtg_cards and mtg_images)', () => {
  it('creates both tables with their indexes, keeps every pkey, and takes the Magic fixture', async () => {
    const db = await seededDb()
    db.close()
    const old = databaseAt(43)
    seedPokemon(old)
    const before = old.prepare('SELECT pkey FROM card_printings ORDER BY id').all()
    expect(before.length).toBeGreaterThan(0)
    expect(names(old, 'table')).not.toContain('mtg_cards')
    migrate(old)

    expect(names(old, 'table')).toEqual(expect.arrayContaining(['mtg_cards', 'mtg_images']))
    expect(names(old, 'index')).toEqual(
      expect.arrayContaining([
        'ix_mtg_cards_oracle',
        'ix_mtg_images_scryfall',
        'ix_mtg_images_illustration'
      ])
    )
    expect(old.prepare('SELECT pkey FROM card_printings ORDER BY id').all()).toEqual(before)

    const { printingIds, cardIds, imageIds } = seedMagic(old)
    expect(cardIds).toEqual([mtgCardId('en', '0c7437ff-d1e1-4b46-8f4b-8e6a3c8e1f10')])
    expect(imageIds).toHaveLength(2)
    expect(printingIds).toHaveLength(3)
    expect(old.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    old.close()
  })

  it('writing mtg_cards drops the rollups it feeds, not the ones it ignores', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrate(db)
    const { cardIds } = seedMagic(db)
    expect(names(db, 'trigger')).toContain('rollup_mtg_cards_update')
    const rollups = (): number =>
      (db.prepare('SELECT count(*) AS n FROM catalog_rollups').get() as { n: number }).n
    db.prepare("INSERT INTO catalog_rollups (key, value) VALUES ('k', 'v')").run()
    db.prepare('UPDATE mtg_cards SET oracle_text = ? WHERE card_id = ?').run('x', cardIds[0])
    expect(rollups()).toBe(1) // game text no rollup reads
    db.prepare('UPDATE mtg_cards SET colors = \'["W","U"]\' WHERE card_id = ?').run(cardIds[0])
    expect(rollups()).toBe(0)
    db.close()
  })

  it('a card query reads the Magic card text through the join', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    migrate(db)
    const { cardIds } = seedMagic(db)
    const row = db
      .prepare(`SELECT c.* ${mtgRead.cols} FROM cards c ${mtgRead.join} WHERE c.id = ?`)
      .get(cardIds[0]) as CardDbRow
    expect(rowToCard(row).magic).toMatchObject({
      typeLine: 'Creature - Angel',
      types: ['Creature'],
      manaCost: '{3}{W}{W}',
      manaValue: 5,
      colors: ['W'],
      power: '4',
      toughness: '4'
    })
    db.close()
  })

  it('the phone downloads the Magic tables and the feed serves them to Magic only', () => {
    expect(PHONE_TABLES).toEqual(expect.arrayContaining(['mtg_cards', 'mtg_images']))
    for (const t of CATALOG_TABLES.filter((x) => x.name.startsWith('mtg_')))
      expect(t.games).toEqual(['mtg'])
  })

  it('stores the Magic cursor keys', () => {
    const db = new Database(':memory:')
    migrate(db)
    setMeta(db, 'catalog_cursor:mtg', '12')
    setMeta(db, 'catalog_staging_cursor:mtg', '13')
    expect(getMeta(db, 'catalog_cursor:mtg')).toBe('12')
    expect(getMeta(db, 'catalog_staging_cursor:mtg')).toBe('13')
    db.close()
  })
})
