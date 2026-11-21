import type Database from 'better-sqlite3'
import { buildFtsQuery, getCardDetail, searchCards } from '../../src/main/repo/cards'
import { seededDb } from './helpers'
import { seedPokemon } from '../fixtures/pokemon'
import { seedOnePiece } from '../fixtures/onePiece'
import { openDatabase } from '../../src/main/db/database'
import { forgetSearchTerms } from '../../src/main/repo/searchTerms'
import { onePieceImageId } from '../../src/shared/games'

let db: Database.Database
beforeAll(async () => {
  db = await seededDb()
})
afterAll(() => db.close())

test('buildFtsQuery', () => {
  expect(buildFtsQuery("Harpie's")).toBe('"Harpie"* "s"*')
  expect(buildFtsQuery(' - " ')).toBeNull()
})

test('name prefix search', () =>
  expect(searchCards(db, 'dark mag').map((r) => r.id)).toEqual([46986414]))
test("other games' results carry no language or printed name", () =>
  expect(Object.keys(searchCards(db, 'dark mag')[0]).sort()).toEqual([
    'defaultImageId',
    'id',
    'matchedSetCode',
    'name',
    'type'
  ]))
test('apostrophes and FTS syntax never throw', () => {
  expect(searchCards(db, "Harpie's").map((r) => r.id)).toEqual([18144506])
  for (const q of ['"', '*', '-', '(', 'NOT', 'a AND', '  ', 'pot"of'])
    expect(() => searchCards(db, q)).not.toThrow()
  expect(searchCards(db, '   ')).toEqual([])
})
test('set code search', () =>
  expect(searchCards(db, 'lob-en1')[0]).toMatchObject({
    id: 55144522,
    matchedSetCode: 'LOB-EN119'
  }))
test('LIKE wildcards are literal', () => expect(searchCards(db, 'LOB-%')).toEqual([]))
test('getCardDetail', () => {
  const d = getCardDetail(db, 46986414)!
  expect(d.printings.map((p) => p.setCode)).toEqual(['LOB-EN005', 'SDY-006'])
  expect(d.images).toHaveLength(2)
  // Only a Magic image can have a back face; the others keep exactly this shape.
  for (const i of d.images)
    expect(Object.keys(i).sort()).toEqual(['cardId', 'imageId', 'sortOrder'])
  expect(d.card.name).toBe('Dark Magician')
  expect(getCardDetail(db, 1)).toBeNull()
})

test('card details give each printing its TCGplayer product id', () => {
  db.prepare("UPDATE card_printings SET tcg_product_id = 777 WHERE set_code = 'LOB-EN005'").run()
  const d = getCardDetail(db, 46986414)!
  expect(d.printings.find((p) => p.setCode === 'LOB-EN005')?.tcgProductId).toBe(777)
  expect(d.printings.find((p) => p.setCode === 'SDY-006')).not.toHaveProperty('tcgProductId')
})

test("getCardDetail dates a printing by its set, else the English set's", () => {
  db.prepare(
    "INSERT OR REPLACE INTO sets (game, language, set_name, set_code, tcg_date) VALUES ('ygo','en','Legend of Blue Eyes White Dragon','LOB','2002-03-08')"
  ).run()
  const d = getCardDetail(db, 46986414)!
  expect(d.printings.find((p) => p.setCode === 'LOB-EN005')?.releaseDate).toBe('2002-03-08')
})
test('getCardDetail leaves releaseDate out when the set has no date', () => {
  const d = getCardDetail(db, 46986414)!
  expect(d.printings.find((p) => p.setCode === 'SDY-006')).not.toHaveProperty('releaseDate')
})
test("getCardDetail dates a non-English printing by the English set's date when its own set row is missing", () => {
  db.prepare(
    "INSERT OR REPLACE INTO sets (game, language, set_name, set_code, tcg_date) VALUES ('ygo','en','Legend of Blue Eyes White Dragon','LOB','2002-03-08')"
  ).run()
  db.prepare(
    "INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language) VALUES (46986414, 'Legend of Blue Eyes White Dragon', 'LOB-DE005', 'Common', 'de')"
  ).run()
  const d = getCardDetail(db, 46986414)!
  expect(d.printings.find((p) => p.setCode === 'LOB-DE005')?.releaseDate).toBe('2002-03-08')
  db.prepare("DELETE FROM card_printings WHERE set_code = 'LOB-DE005'").run()
})

test('Pokémon cards are not found by name or number from a Yu-Gi-Oh! search', async () => {
  const other = await seededDb()
  seedPokemon(other)
  expect(searchCards(other, 'Pikachu')).toEqual([])
  expect(searchCards(other, '045')).toEqual([])
  expect(searchCards(other, '45/193')).toEqual([])
  other.close()
})

describe('name search order', () => {
  const ids: Record<string, number> = {}
  beforeAll(() => {
    let next = 9000
    const add = (name: string, sets: [string, string][]): void => {
      const id = next++
      ids[name] = id
      db.prepare(
        `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at) VALUES (?, ?, 'Normal Monster', 'normal', 'Warrior', '', '2026-10-01')`
      ).run(id, name)
      for (const [setName, code] of sets)
        db.prepare(
          `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language) VALUES (?, ?, ?, 'Common', 'en')`
        ).run(id, setName, code)
    }
    const dates = [
      ['Old Set', '2002-01-01'],
      ['Mid Set', '2010-01-01'],
      ['New Set', '2024-01-01']
    ]
    for (const [n, d] of dates)
      db.prepare(
        "INSERT INTO sets (language, set_name, set_code, tcg_date) VALUES ('en', ?, 'ZZ', ?)"
      ).run(n, d)
    add('Zorbo Old', [['Old Set', 'ZZ-EN001']])
    add('Zorbo Newest', [
      ['Old Set', 'ZZ-EN002'],
      ['New Set', 'ZZ-EN003']
    ])
    add('Zorbo Mid', [['Mid Set', 'ZZ-EN004']])
    add('Zorbo Undated', [['Unknown Set', 'ZZ-EN005']])
    add('Zorbo', [['Old Set', 'ZZ-EN006']])
    db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')")
  })

  test('exact name first, then newest printing first, undated last', () => {
    expect(searchCards(db, 'zorbo').map((r) => r.id)).toEqual(
      ['Zorbo', 'Zorbo Newest', 'Zorbo Mid', 'Zorbo Old', 'Zorbo Undated'].map((n) => ids[n])
    )
  })

  test('a partial name has no exact match, so the newest leads', () => {
    expect(searchCards(db, 'zorb').map((r) => r.id)[0]).toBe(ids['Zorbo Newest'])
  })
})

describe('version rows', () => {
  let vdb: Database.Database
  const p: Record<string, number> = {}
  const c: Record<string, number> = {}

  function card(id: number, name: string): void {
    c[name] = id
    vdb
      .prepare(
        `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game) VALUES (?, ?, 'Pokemon', 'x', 'x', '', '2026-01-01', 'pkm')`
      )
      .run(id, name)
    vdb.prepare('INSERT INTO cards_fts (rowid, name) VALUES (?, ?)').run(id, name)
  }
  function printing(key: string, cardId: number, set: string, code: string, rarity: string): void {
    const r = vdb
      .prepare(
        `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language, game)
         VALUES (?, ?, ?, ?, 'en', 'pkm')`
      )
      .run(cardId, set, code, rarity)
    p[key] = Number(r.lastInsertRowid)
  }
  function set(name: string, code: string, date: string): void {
    vdb
      .prepare(
        "INSERT INTO sets (game, language, set_name, set_code, tcg_date) VALUES ('pkm', 'en', ?, ?, ?)"
      )
      .run(name, code, date)
  }
  function term(phrase: string, target: object, game = 'pkm'): void {
    vdb
      .prepare(
        `INSERT INTO search_terms (game, phrase, phrase_key, kind, target_kind, target, status, source, created_at)
         VALUES (?, ?, ?, 'nickname', 'printing', ?, 'approved', 'owner', '2026-11-21')`
      )
      .run(game, phrase, phrase, JSON.stringify(target))
    forgetSearchTerms(vdb)
  }
  const pk = (id: number): string =>
    (vdb.prepare('SELECT pkey FROM card_printings WHERE id = ?').get(id) as { pkey: string }).pkey
  const game = (g: string): void => {
    vdb.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('active_game', ?)").run(g)
  }

  beforeEach(() => {
    vdb = openDatabase(':memory:')
    game('pkm')
    set('Lost Origin', 'LOR', '2022-09-09')
    set('Lost Origin Trainer Gallery', 'LOR:TG', '2022-09-09')
    set('Paldean Fates', 'PAF', '2024-01-26')
    set('Fusion Strike', 'FST', '2021-11-12')
    card(1, 'Charizard')
    card(2, 'Mew ex')
    card(3, 'Bubbleman')
    card(4, 'Pikachu')
    printing('lor', 1, 'Lost Origin', 'LOR 020/196', 'Rare')
    printing('tg', 1, 'Lost Origin Trainer Gallery', 'LOR:TG TG03/30', 'Rare Holo')
    printing('paf216', 2, 'Paldean Fates', 'PAF 216/091', 'Double Rare')
    printing('paf232', 2, 'Paldean Fates', 'PAF 232/091', 'Special Illustration Rare')
    printing('bubble', 3, 'Fusion Strike', 'FST 100/264', 'Common')
    for (let i = 1; i <= 15; i++)
      printing(`pika${i}`, 4, 'Fusion Strike', `FST ${200 + i}/264`, 'Common')
  })
  afterEach(() => vdb.close())

  const brief = (rows: ReturnType<typeof searchCards>) =>
    rows.map((r) => (r.printingId ? `v${r.printingId}${r.term ? `:${r.term}` : ''}` : r.name))

  test('set words and a name give that version first', () => {
    expect(searchCards(vdb, 'trainer gallery charizard')[0]).toMatchObject({
      id: 1,
      printingId: p.tg,
      setName: 'Lost Origin Trainer Gallery',
      setCode: 'LOR:TG TG03/30',
      rarity: 'Rare Holo',
      imageId: 1,
      matchedSetCode: 'LOR:TG TG03/30'
    })
  })

  test('an approved term names its version first', () => {
    term('bubble mew', { pkeys: [pk(p.paf232)] })
    const rows = searchCards(vdb, 'bubble mew')
    expect(rows[0]).toMatchObject({ id: 2, term: 'bubble mew', printingId: p.paf232 })
  })

  test('a name match still shows beside a term', () => {
    term('bubble mew', { pkeys: [pk(p.paf232)] })
    expect(brief(searchCards(vdb, 'bubble'))).toEqual(['Bubbleman'])
    term('bubble', { pkeys: [pk(p.paf232)] })
    expect(brief(searchCards(vdb, 'bubble'))).toEqual([`v${p.paf232}:bubble`, 'Bubbleman'])
  })

  test('a version row never takes a card row’s place', () => {
    term('charizard', { pkeys: [pk(p.tg)] })
    expect(brief(searchCards(vdb, 'charizard'))).toEqual([`v${p.tg}:charizard`, 'Charizard'])
  })

  test('words beside a term narrow its versions', () => {
    term('bubble', { cardIds: [2] })
    expect(brief(searchCards(vdb, 'bubble'))).toEqual([
      `v${p.paf216}:bubble`,
      `v${p.paf232}:bubble`,
      'Bubbleman'
    ])
    expect(brief(searchCards(vdb, 'bubble sir'))[0]).toBe(`v${p.paf232}:bubble`)
    expect(brief(searchCards(vdb, 'bubble sir'))).not.toContain(`v${p.paf216}:bubble`)
  })

  test('term rows take at most ten per term and half the list', () => {
    term('pika', { cardIds: [4] })
    const rows = searchCards(vdb, 'pika')
    expect(rows.filter((r) => r.term)).toHaveLength(10)
    expect(brief(rows).slice(10)).toEqual(['Pikachu'])
    const few = searchCards(vdb, 'pika', 5)
    expect(few.filter((r) => r.term)).toHaveLength(3)
    expect(few.map((r) => r.name)).toContain('Pikachu')
    expect(few.length).toBeLessThanOrEqual(5)
  })

  test('a version found twice is listed once', () => {
    term('trainer gallery charizard', { pkeys: [pk(p.tg)] })
    expect(brief(searchCards(vdb, 'trainer gallery charizard'))).toEqual([
      `v${p.tg}:trainer gallery charizard`
    ])
  })

  test('the total stays within the limit', () => {
    term('pika', { cardIds: [4] })
    for (const limit of [1, 2, 3, 7, 20]) {
      expect(searchCards(vdb, 'pika', limit).length).toBeLessThanOrEqual(limit)
      expect(searchCards(vdb, 'fusion strike pikachu', limit).length).toBeLessThanOrEqual(limit)
    }
  })

  test('a version row shows the art the card panel shows for it', () => {
    const { cardIds, printingIds } = seedOnePiece(vdb)
    vdb
      .prepare("UPDATE card_printings SET set_rarity_code = 'OP01-001_p1' WHERE id = ?")
      .run(printingIds[1])
    game('op')
    term('alt luffy', { pkeys: [pk(printingIds[1])] }, 'op')
    expect(searchCards(vdb, 'alt luffy')[0]).toMatchObject({
      id: cardIds[0],
      printingId: printingIds[1],
      imageId: onePieceImageId('en', 'OP01-001_p1')
    })
  })
})
