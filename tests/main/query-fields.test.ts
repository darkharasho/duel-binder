import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { LOCAL } from '../../src/main/repo/scope'
import { fieldPrintingIds, parseFields } from '../../src/main/repo/queryFields'

let db: Database.Database
const ids: Record<string, number> = {}

function card(id: number, name: string): void {
  db.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at, game) VALUES (?, ?, 'Pokemon', 'x', 'x', '', '2026-01-01', 'pkm')`
  ).run(id, name)
  db.prepare('INSERT INTO cards_fts (rowid, name) VALUES (?, ?)').run(id, name)
}
function printing(key: string, cardId: number, set: string, code: string, rarity: string): void {
  const r = db
    .prepare(
      `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language, game)
       VALUES (?, ?, ?, ?, 'en', 'pkm')`
    )
    .run(cardId, set, code, rarity)
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
  card(1, 'Charizard')
  card(2, 'Mew ex')
  card(3, 'Fusion Gate')
  printing('lor', 1, 'Lost Origin', 'LOR 020/196', 'Rare')
  printing('tg', 1, 'Lost Origin Trainer Gallery', 'LOR:TG TG03/30', 'Rare Holo')
  printing('paf216', 2, 'Paldean Fates', 'PAF 216/091', 'Double Rare')
  printing('paf232', 2, 'Paldean Fates', 'PAF 232/091', 'Special Illustration Rare')
  printing('gate', 3, 'Fusion Strike', 'FST 100/264', 'Common')
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
  expect(got).toEqual([ids.paf232])
})

test('a rarity label spelled out', () => {
  expect(run(['mew', 'double', 'rare']).ids).toEqual([ids.paf216])
})

test('set code and number words', () => {
  const { fq, ids: got } = run(['lor', 'tg03'])
  expect(fq?.codePrefix).toBe('lor')
  expect(fq?.number).toBe('tg03')
  expect(got).toEqual([ids.tg])
})

test('number alone with a name', () => {
  expect(run(['mew', '232']).ids).toEqual([ids.paf232])
  expect(run(['mew', '232', '091']).ids).toEqual([ids.paf232])
  expect(run(['mew', '23']).ids).toEqual([])
})

test('a lone set word with nothing left over is not a field query', () => {
  expect(parseFields(db, LOCAL, ['fusion'])).toBeNull()
  expect(parseFields(db, LOCAL, ['dark', 'magician'])).toBeNull()
})

test('a lone set word counts when a term already constrains', () => {
  const fq = parseFields(db, LOCAL, ['fusion'], true)
  expect(fq?.sets).toEqual([{ language: 'en', setName: 'Fusion Strike' }])
  expect(fieldPrintingIds(db, LOCAL, fq!, 10)).toEqual([ids.gate])
})

test('results run newest set first', () => {
  const fq = parseFields(db, LOCAL, ['lost', 'origin', 'charizard'])!
  expect(fq.sets).toHaveLength(2)
  expect(fieldPrintingIds(db, LOCAL, fq, 10)).toEqual([ids.lor, ids.tg])
  expect(fieldPrintingIds(db, LOCAL, fq, 1)).toHaveLength(1)
})

test('a set added later is recognised', () => {
  expect(parseFields(db, LOCAL, ['crown', 'mew'])).toBeNull()
  set('Crown Zenith', 'CRZ', '2023-01-20')
  expect(parseFields(db, LOCAL, ['crown', 'mew'])?.sets).toHaveLength(1)
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
