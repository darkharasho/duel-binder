import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { LOCAL } from '../../src/main/repo/scope'
import { fieldPrintingIds, fieldSearch, parseFields } from '../../src/main/repo/queryFields'
import { capParams, DO_MAX_PARAMS } from '../helpers/paramCap'
import { queryPrintingIds } from '../../src/main/repo/queryPrintings'
import { forgetSearchTerms } from '../../src/main/repo/searchTerms'

let db: Database.Database
const ids: Record<string, number> = {}

/**
 * The real Pokémon catalog shape: one card per set appearance, its rarity in
 * `pokemon_cards.rarity`, and each printing's finish ("Holofoil", "Reverse Holofoil") in
 * `card_printings.set_rarity`.
 */
function card(id: number, name: string, rarity: string): void {
  db.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game) VALUES (?, ?, 'Pokemon', 'x', 'x', '', '2026-01-01', 'pkm')`
  ).run(id, name)
  db.prepare('INSERT INTO cards_fts (rowid, name) VALUES (?, ?)').run(id, name)
  db.prepare(
    "INSERT INTO pokemon_cards (card_id, category, rarity, source_id) VALUES (?, 'Pokemon', ?, ?)"
  ).run(id, rarity, `src-${id}`)
}
function printing(key: string, cardId: number, set: string, code: string, finish: string): void {
  const r = db
    .prepare(
      `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language, game)
       VALUES (?, ?, ?, ?, 'en', 'pkm')`
    )
    .run(cardId, set, code, finish)
  ids[key] = Number(r.lastInsertRowid)
}
function set(name: string, code: string, date: string): void {
  db.prepare(
    "INSERT INTO sets (game, language, set_name, set_code, tcg_date) VALUES ('pkm', 'en', ?, ?, ?)"
  ).run(name, code, date)
}

beforeEach(() => {
  db = openDatabase(':memory:')
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('active_game', 'pkm')").run()
  set('Lost Origin', 'LOR', '2022-09-09')
  set('Lost Origin Trainer Gallery', 'LOR:TG', '2022-09-09')
  set('Paldean Fates', 'PAF', '2024-01-26')
  set('Fusion Strike', 'FST', '2021-11-12')
  set('151', 'MEW', '2023-09-22')
  card(1, 'Charizard', 'Rare')
  card(5, 'Charizard', 'Holo Rare')
  card(2, 'Mew ex', 'Double Rare')
  card(4, 'Mew ex', 'Special Illustration Rare')
  card(3, 'Fusion Gate', 'Common')
  card(6, 'Mew ex', 'Special Illustration Rare')
  card(7, 'Mew ex', 'Double Rare')
  printing('lor', 1, 'Lost Origin', 'LOR 020/196', 'Normal')
  printing('tg', 5, 'Lost Origin Trainer Gallery', 'LOR:TG TG03/30', 'Holofoil')
  printing('paf216', 2, 'Paldean Fates', 'PAF 216/091', 'Holofoil')
  printing('paf232', 4, 'Paldean Fates', 'PAF 232/091', 'Holofoil')
  printing('gate', 3, 'Fusion Strike', 'FST 100/264', 'Normal')
  printing('gateRh', 3, 'Fusion Strike', 'FST 100/264', 'Reverse Holofoil')
  printing('mew205', 6, '151', 'MEW 205/165', 'Holofoil')
  printing('mew151', 7, '151', 'MEW 151/165', 'Holofoil')
})
afterEach(() => db.close())

const run = (words: string[], limit = 50) => {
  const fq = parseFields(db, LOCAL, words)
  return { fq, ids: fq ? fieldPrintingIds(db, LOCAL, fq, limit) : [] }
}

test('set words and a name word', () => {
  const { fq, ids: got } = run(['trainer', 'gallery', 'charizard'])
  expect(fq?.sets).toEqual([{ language: 'en', setName: 'Lost Origin Trainer Gallery' }])
  expect(fq?.nameWords).toEqual(['charizard'])
  expect(got).toEqual([ids.tg])
})

test('a rarity abbreviation picks the rarity', () => {
  const { fq, ids: got } = run(['mew', 'sir'])
  expect(fq?.rarities).toEqual(['Special Illustration Rare'])
  expect(got).toEqual([ids.paf232, ids.mew205])
})

test('a rarity label spelled out', () => {
  expect(run(['mew', 'double', 'rare']).ids).toEqual([ids.paf216, ids.mew151])
})

test('"151 SIR mew": a Pokémon rarity comes from the card, not the printing finish', () => {
  const { fq, ids: got } = run(['151', 'sir', 'mew'])
  expect(fq?.sets).toEqual([{ language: 'en', setName: '151' }])
  expect(fq?.rarities).toEqual(['Special Illustration Rare'])
  expect(fq?.nameWords).toEqual(['mew'])
  expect(got).toEqual([ids.mew205])
})

test('a Pokémon finish still reads as a rarity word', () => {
  const { fq, ids: got } = run(['fusion', 'gate', 'reverse', 'holofoil'])
  expect(fq?.rarities).toEqual(['Reverse Holofoil'])
  expect(got).toEqual([ids.gateRh])
})

test('set code and number words', () => {
  const { fq, ids: got } = run(['lor', 'tg03'])
  expect(fq?.codePrefix).toBe('lor')
  expect(fq?.number).toBe('tg03')
  expect(got).toEqual([ids.tg])
})

test('number alone with a name', () => {
  // "mew" is also 151's set code (MEW), so the name here is "fusion gate".
  expect(run(['fusion', 'gate', '100']).ids).toEqual([ids.gate, ids.gateRh])
  expect(run(['charizard', '020', '196']).ids).toEqual([ids.lor])
  expect(run(['charizard', '02']).ids).toEqual([])
})

test('a lone set word with nothing left over is not a field query', () => {
  expect(parseFields(db, LOCAL, ['fusion'])).toBeNull()
  expect(parseFields(db, LOCAL, ['dark', 'magician'])).toBeNull()
})

test('a lone set word counts when a term already constrains', () => {
  const fq = parseFields(db, LOCAL, ['fusion'], true)
  expect(fq?.sets).toEqual([{ language: 'en', setName: 'Fusion Strike' }])
  expect(fieldPrintingIds(db, LOCAL, fq!, 10)).toEqual([ids.gate, ids.gateRh])
})

test('results run newest set first', () => {
  const fq = parseFields(db, LOCAL, ['lost', 'origin', 'charizard'])!
  expect(fq.sets).toHaveLength(2)
  expect(fieldPrintingIds(db, LOCAL, fq, 10)).toEqual([ids.lor, ids.tg])
  expect(fieldPrintingIds(db, LOCAL, fq, 1)).toHaveLength(1)
})

test('a set added later is recognised', () => {
  expect(parseFields(db, LOCAL, ['crown', 'charizard'])).toBeNull()
  set('Crown Zenith', 'CRZ', '2023-01-20')
  expect(parseFields(db, LOCAL, ['crown', 'charizard'])?.sets).toHaveLength(1)
})

test('ygo str means Starlight Rare and stpr means nothing', () => {
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('active_game', 'ygo')").run()
  db.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game)
     VALUES (10, 'Dark Magician', 'Normal Monster', 'normal', 'Spellcaster', '', '2026-01-01', 'ygo')`
  ).run()
  db.prepare("INSERT INTO cards_fts (rowid, name) VALUES (10, 'Dark Magician')").run()
  db.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language, game)
     VALUES (10, 'Some Set', 'SOME-EN001', 'Starlight Rare', 'en', 'ygo')`
  ).run()
  expect(parseFields(db, LOCAL, ['magician', 'str'])?.rarities).toEqual(['Starlight Rare'])
  expect(parseFields(db, LOCAL, ['magician', 'stpr'])).toBeNull()
})

describe('rarity words beat set prefixes', () => {
  beforeEach(() => {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('active_game', 'ygo')").run()
    db.prepare(
      "INSERT INTO sets (game, language, set_name, set_code, tcg_date) VALUES ('ygo', 'en', 'Structure Deck: Albaz Strike', 'SDAZ', '2023-01-01')"
    ).run()
    db.prepare(
      `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game)
       VALUES (10, 'Dark Magician', 'Normal Monster', 'normal', 'Spellcaster', '', '2026-01-01', 'ygo')`
    ).run()
    db.prepare("INSERT INTO cards_fts (rowid, name) VALUES (10, 'Dark Magician')").run()
    db.prepare(
      `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language, game)
       VALUES (10, 'Some Set', 'SOME-EN001', 'Starlight Rare', 'en', 'ygo')`
    ).run()
  })

  test('str is the rarity, not a Structure Deck', () => {
    const fq = parseFields(db, LOCAL, ['dark', 'magician', 'str'])
    expect(fq?.rarities).toEqual(['Starlight Rare'])
    expect(fq?.sets).toBeNull()
  })

  test('stru still reaches the Structure Deck', () => {
    const fq = parseFields(db, LOCAL, ['dark', 'magician', 'stru'])
    expect(fq?.sets).toEqual([{ language: 'en', setName: 'Structure Deck: Albaz Strike' }])
    expect(fq?.rarities).toBeNull()
  })
})

describe('the portal limit of 100 bound parameters', () => {
  test('a word matching 60 sets binds them as one parameter', () => {
    for (let i = 0; i < 60; i++)
      set(`Promo Pack ${i}`, `PR${i}`, `2020-01-${String((i % 28) + 1).padStart(2, '0')}`)
    printing('promo', 1, 'Promo Pack 7', 'PR7 001', 'Holofoil')
    const cap = capParams(db)
    try {
      const { fq, ids: got } = run(['promo', 'charizard'])
      expect(fq?.sets).toHaveLength(60)
      expect(got).toEqual([ids.promo])
      expect(cap.max()).toBeLessThanOrEqual(DO_MAX_PARAMS)
    } finally {
      cap.restore()
    }
  })

  test('the cap itself throws past 100 parameters', () => {
    const cap = capParams(db)
    try {
      const marks = Array.from({ length: 101 }, () => '?').join(',')
      expect(() =>
        db.prepare(`SELECT 1 WHERE 1 IN (${marks})`).all(...Array.from({ length: 101 }, () => 1))
      ).toThrow('too many SQL variables')
    } finally {
      cap.restore()
    }
  })
})

describe('a set-name prefix counts only on the last word', () => {
  test('"mew sir" is not the Mewtwo sets', () => {
    set('Mewtwo Strikes Back', 'MSB', '1999-01-01')
    const { fq, ids: got } = run(['mew', 'sir'])
    expect(fq?.sets).toBeNull()
    expect(got).toEqual([ids.paf232, ids.mew205])
  })

  test('a whole set word anywhere and a prefix at the end still count', () => {
    expect(run(['trainer', 'gallery', 'charizard']).ids).toEqual([ids.tg])
    expect(run(['charizard', 'trainer', 'gal']).ids).toEqual([ids.tg])
    expect(parseFields(db, LOCAL, ['gal', 'charizard'])).toBeNull()
  })
})

describe('a term beside a set code', () => {
  const addTerm = (phrase: string, cardIds: number[]): void => {
    db.prepare(
      `INSERT INTO search_terms (game, phrase, phrase_key, kind, target_kind, target, status, source, created_at)
       VALUES ('pkm', ?, ?, 'nickname', 'cards', ?, 'approved', 'owner', '2026-11-21')`
    ).run(phrase, phrase, JSON.stringify({ cardIds }))
    forgetSearchTerms(db)
  }

  test('"zard lor" narrows the term to that set code', () => {
    printing('fst', 1, 'Fusion Strike', 'FST 009/264', 'Normal')
    addTerm('zard', [1, 5])
    expect(parseFields(db, LOCAL, ['lor'], true)?.codePrefix).toBe('lor')
    expect(queryPrintingIds(db, LOCAL, 'zard lor')?.ids).toEqual([ids.lor, ids.tg])
  })

  test('"zard lor holofoil" narrows by code and rarity', () => {
    printing('fst', 1, 'Fusion Strike', 'FST 009/264', 'Holofoil')
    addTerm('zard', [1, 5])
    expect(queryPrintingIds(db, LOCAL, 'zard lor holofoil')?.ids).toEqual([ids.tg])
  })
})

describe('fieldSearch reads the set words again when the first reading finds nothing', () => {
  test('"fusion gate strike": the Fusion Gate deck has no Fusion Gate, so Fusion Strike is the set', () => {
    set('Fusion Gate Battle Deck', 'FGD', '2025-01-01')
    const words = ['fusion', 'gate', 'strike']
    expect(parseFields(db, LOCAL, words)?.sets).toEqual([
      { language: 'en', setName: 'Fusion Gate Battle Deck' }
    ])
    const hit = fieldSearch(db, LOCAL, words, 10)
    expect(hit?.fq.sets).toEqual([{ language: 'en', setName: 'Fusion Strike' }])
    expect(hit?.fq.nameWords).toEqual(['fusion', 'gate'])
    expect(hit?.ids).toEqual([ids.gate, ids.gateRh])
  })

  test('a first reading that finds rows is kept, and no field words give null', () => {
    expect(fieldSearch(db, LOCAL, ['trainer', 'gallery', 'charizard'], 10)?.ids).toEqual([ids.tg])
    expect(fieldSearch(db, LOCAL, ['dark', 'magician'], 10)).toBeNull()
  })

  test('nothing in any reading keeps the first, empty', () => {
    const hit = fieldSearch(db, LOCAL, ['pikachu', 'fusion'], 10)
    expect(hit?.fq.sets).toEqual([{ language: 'en', setName: 'Fusion Strike' }])
    expect(hit?.ids).toEqual([])
  })
})
