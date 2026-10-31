import { afterEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { browseCards, browseFacets, browseFacetsFast } from '../../src/main/repo/browse'
import { addEntry, removeEntry } from '../../src/main/repo/collection'
import { catalogRollup } from '../../src/main/repo/rollup'
import { adjustPrinting, listSets, listSetsFast } from '../../src/main/repo/sets'
import { setMeta } from '../../src/main/db/meta'

let db: Database.Database
afterEach(() => db.close())

function card(id: number, game: 'ygo' | 'pkm', name: string): void {
  db.prepare(
    `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
     VALUES (?, ?, ?, 'Normal Monster', 'normal', 'Dragon', '', '2026-01-01')`
  ).run(id, game, name)
  db.prepare(
    'INSERT INTO card_images (image_id, card_id, game, sort_order) VALUES (?, ?, ?, 0)'
  ).run(id, id, game)
}

function printing(
  cardId: number,
  game: 'ygo' | 'pkm',
  setName: string,
  code: string,
  rarity = 'Rare',
  missing = 0
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO card_printings (card_id, game, set_name, set_code, set_rarity, missing_from_api)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(cardId, game, setName, code, rarity, missing).lastInsertRowid
  )
}

function setup(game: 'ygo' | 'pkm' = 'ygo'): number {
  db = openDatabase(':memory:')
  setMeta(db, 'active_game', game)
  card(1, game, 'Alpha')
  card(2, game, 'Beta')
  const id = printing(1, game, 'First Set', 'FST-001')
  printing(1, game, 'First Set', 'FST-001', 'Secret Rare')
  printing(2, game, 'First Set', 'FST-002')
  printing(2, game, 'Second Set', 'SND-001')
  db.prepare(
    "INSERT INTO sets (game, set_name, set_code, tcg_date) VALUES (?, 'First Set', 'FST', '2020-01-01')"
  ).run(game)
  return id
}

const rollups = (): number =>
  (db.prepare('SELECT count(*) AS n FROM catalog_rollups').get() as { n: number }).n

describe('listSetsFast', () => {
  it('matches listSets, and stores the catalog part once', () => {
    setup()
    expect(listSetsFast(db)).toEqual(listSets(db))
    expect(rollups()).toBe(1)
    expect(listSetsFast(db)).toEqual(listSets(db))
  })

  it('shows an add and a removal at once', () => {
    const id = setup()
    listSetsFast(db)
    const entry = addEntry(db, { printingId: id, imageId: 1, quantity: 1 })
    const first = listSetsFast(db).find((s) => s.setName === 'First Set')
    expect(first).toMatchObject({ ownedCards: 1, ownedRarities: 1 })
    expect(listSetsFast(db)).toEqual(listSets(db))
    removeEntry(db, entry.id)
    expect(listSetsFast(db).find((s) => s.setName === 'First Set')?.ownedCards).toBe(0)
    adjustPrinting(db, 'First Set', 'en', id, 1)
    expect(listSetsFast(db).find((s) => s.setName === 'First Set')?.ownedCards).toBe(1)
    expect(listSetsFast(db)).toEqual(listSets(db))
  })

  it('keeps each game to its own rollup', () => {
    setup()
    card(3, 'pkm', 'Sprout')
    printing(3, 'pkm', 'Base', 'BS 1/102')
    listSetsFast(db)
    setMeta(db, 'active_game', 'pkm')
    expect(listSetsFast(db).map((s) => s.setName)).toEqual(['Base'])
    setMeta(db, 'active_game', 'ygo')
    expect(listSetsFast(db)).toEqual(listSets(db))
  })

  it('lists an owned flagged Pokémon printing as listSets does, even as a set of its own', () => {
    setup('pkm')
    const flagged = printing(1, 'pkm', 'First Set', 'FST-009', 'Holo', 1)
    const alone = printing(2, 'pkm', 'Aardvark Set', 'AAR-001', 'Holo', 1)
    expect(listSetsFast(db)).toEqual(listSets(db))
    addEntry(db, { printingId: flagged, imageId: 1, quantity: 1 })
    addEntry(db, { printingId: alone, imageId: 2, quantity: 1 })
    const sets = listSetsFast(db)
    expect(sets.map((s) => s.setName)).toEqual(['Aardvark Set', 'First Set', 'Second Set'])
    expect(sets).toEqual(listSets(db))
  })
})

describe('catalog_rollups', () => {
  const stale: [string, () => void][] = [
    ['a new printing', () => printing(1, 'ygo', 'Second Set', 'SND-002')],
    [
      'a renamed set on a printing',
      () => db.exec("UPDATE card_printings SET set_name = 'Third' WHERE set_code = 'SND-001'")
    ],
    [
      'a flagged printing',
      () => db.exec("UPDATE card_printings SET missing_from_api = 1 WHERE set_code = 'SND-001'")
    ],
    ['a removed printing', () => db.exec("DELETE FROM card_printings WHERE set_code = 'SND-001'")],
    ['a set date', () => db.exec("UPDATE sets SET tcg_date = '2021-01-01'")],
    ['pack art', () => db.exec("INSERT INTO pack_art VALUES ('First Set', 'u', 'k')")],
    ['a logo', () => db.exec("INSERT INTO set_logos VALUES ('First Set', 'u', 'k')")],
    ['a Konami logo', () => db.exec("INSERT INTO konami_logos VALUES ('First Set', 'u', 'k')")],
    [
      'Pokémon set art',
      () => db.exec("INSERT INTO pokemon_set_art VALUES ('en', 'First Set', 'pack', 0, 'u', 'k')")
    ],
    ['a card image', () => db.exec('UPDATE card_images SET sort_order = 1 WHERE image_id = 1')],
    ['a card type', () => db.exec("UPDATE cards SET type = 'Effect Monster' WHERE id = 1")]
  ]
  it.each(stale)('drops on %s', (_, write) => {
    setup()
    listSetsFast(db)
    browseFacetsFast(db)
    expect(rollups()).toBe(2)
    write()
    expect(rollups()).toBe(0)
    expect(listSetsFast(db)).toEqual(listSets(db))
    expect(browseFacetsFast(db)).toEqual(browseFacets(db))
  })

  it('survives price and collection writes, which no rollup reads', () => {
    const id = setup()
    listSetsFast(db)
    db.prepare('UPDATE card_printings SET market_price = 3, set_price = 2 WHERE id = ?').run(id)
    db.prepare('UPDATE cards SET tcgplayer_price = 3 WHERE id = 1').run()
    addEntry(db, { printingId: id, imageId: 1, quantity: 1 })
    expect(rollups()).toBe(1)
  })

  it('a rewrite of a printing with the same values keeps them', () => {
    setup()
    listSetsFast(db)
    db.exec('UPDATE card_printings SET set_name = set_name, set_rarity = set_rarity')
    expect(rollups()).toBe(1)
  })

  it('computes when the store is unusable', () => {
    setup()
    db.exec('DROP TABLE catalog_rollups')
    expect(catalogRollup(db, 'k', () => 7)).toBe(7)
  })
})

describe('browseCards', () => {
  it('gives every card its release date whatever the sort', () => {
    setup()
    const byName = browseCards(db, { sort: 'name', dir: 'asc', owned: 'all' })
    const byDate = browseCards(db, { sort: 'released', dir: 'asc', owned: 'all' })
    expect(byName.cards.map((c) => [c.name, c.releasedAt])).toEqual([
      ['Alpha', '2020-01-01'],
      ['Beta', '2020-01-01']
    ])
    expect(byDate.cards.map((c) => c.releasedAt)).toEqual(['2020-01-01', '2020-01-01'])
  })
})
