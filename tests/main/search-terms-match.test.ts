import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { LOCAL } from '../../src/main/repo/scope'
import { forgetSearchTerms, matchTerms, termPrintingIds } from '../../src/main/repo/searchTerms'
import { SHARED_SET_NAME, seedPokemon } from '../fixtures/pokemon'
import type { TermTarget, TermTargetKind } from '../../src/shared/search/terms'
import { capParams, DO_MAX_PARAMS } from '../helpers/paramCap'

let db: Database.Database
beforeEach(() => {
  db = openDatabase(':memory:')
  seedPokemon(db)
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('active_game', 'pkm')").run()
})
afterEach(() => db.close())

function addTerm(phrase: string, status = 'approved', game = 'pkm'): void {
  db.prepare(
    `INSERT INTO search_terms (game, phrase, phrase_key, kind, target_kind, target, status, source, created_at)
     VALUES (?, ?, ?, 'nickname', 'printing', '{"pkeys":["x"]}', ?, 'owner', '2026-11-21')`
  ).run(game, phrase, phrase.toLowerCase(), status)
  forgetSearchTerms(db)
}

test('a term matches whole words and leaves the rest', () => {
  addTerm('bubble mew')
  const m = matchTerms(db, LOCAL, 'bubble mew')
  expect(m.matches.map((x) => [x.start, x.end])).toEqual([[0, 2]])
  expect(m.rest).toEqual([])
  expect(matchTerms(db, LOCAL, 'bubble mew psa').rest).toEqual(['psa'])
})

test('pending and rejected terms never match', () => {
  addTerm('bubble mew', 'pending')
  addTerm('tg', 'rejected')
  expect(matchTerms(db, LOCAL, 'bubble mew tg').matches).toEqual([])
})

test('partial words do not match', () => {
  addTerm('bubble mew')
  expect(matchTerms(db, LOCAL, 'bub')).toEqual({ matches: [], rest: ['bub'] })
  expect(matchTerms(db, LOCAL, 'bubble m')).toEqual({ matches: [], rest: ['bubble', 'm'] })
})

test('the longest term wins', () => {
  addTerm('tg')
  addTerm('tg charizard')
  const m = matchTerms(db, LOCAL, 'tg charizard')
  expect(m.matches).toHaveLength(1)
  expect(m.matches[0].term.phrase).toBe('tg charizard')
})

test("another game's term does not match", () => {
  addTerm('bubble mew', 'approved', 'ygo')
  expect(matchTerms(db, LOCAL, 'bubble mew').matches).toEqual([])
})

test('a new approved row matches after forgetSearchTerms', () => {
  expect(matchTerms(db, LOCAL, 'tg').matches).toEqual([])
  addTerm('tg')
  expect(matchTerms(db, LOCAL, 'tg').matches).toHaveLength(1)
})

const of = (targetKind: TermTargetKind, target: TermTarget) => ({ targetKind, target })

test('termPrintingIds', () => {
  expect(termPrintingIds(db, LOCAL, of('printing', { pkeys: ['nope'] }), 10)).toEqual([])
  expect(termPrintingIds(db, LOCAL, of('card', {}), 10)).toEqual([])
  const rows = db
    .prepare(
      'SELECT id, card_id, pkey, language, set_name, set_rarity FROM card_printings ORDER BY id'
    )
    .all() as {
    id: number
    card_id: number
    pkey: string
    language: string
    set_name: string
    set_rarity: string
  }[]
  expect(termPrintingIds(db, LOCAL, of('printing', { pkeys: [rows[1].pkey] }), 10)).toEqual([
    rows[1].id
  ])
  expect(
    termPrintingIds(
      db,
      LOCAL,
      of('set', { sets: [{ language: 'ja', setName: rows[3].set_name }] }),
      10
    )
  ).toEqual(rows.filter((r) => r.language === 'ja').map((r) => r.id))
  // A Pokémon finish (set_rarity) and a Pokémon card rarity (pokemon_cards.rarity) both count.
  expect(termPrintingIds(db, LOCAL, of('rarity', { rarities: ['Reverse Holo'] }), 10)).toEqual([
    rows[1].id,
    rows[3].id
  ])
  expect(termPrintingIds(db, LOCAL, of('rarity', { rarities: ['Common'] }), 10)).toEqual(
    rows.map((r) => r.id)
  )
  expect(termPrintingIds(db, LOCAL, of('cards', { cardIds: [rows[0].card_id] }), 1)).toEqual([
    rows[0].id
  ])
  // Contributed printings never count.
  db.prepare('UPDATE card_printings SET contributed = 1 WHERE id = ?').run(rows[0].id)
  expect(termPrintingIds(db, LOCAL, of('card', { cardIds: [rows[0].card_id] }), 10)).toEqual([
    rows[1].id
  ])
})

test('only the list the target kind names is read', () => {
  const rows = db.prepare('SELECT id, card_id, pkey FROM card_printings ORDER BY id').all() as {
    id: number
    card_id: number
    pkey: string
  }[]
  // A card term that also carries a stray printing key and rarity still names every printing.
  const card = { cardIds: [rows[0].card_id], pkeys: [rows[1].pkey], rarities: ['Reverse Holo'] }
  expect(termPrintingIds(db, LOCAL, of('card', card), 10)).toEqual([rows[0].id, rows[1].id])
  expect(termPrintingIds(db, LOCAL, of('printing', card), 10)).toEqual([rows[1].id])
  // The kind's own list empty: nothing, whatever the other lists hold.
  const target = { pkeys: [rows[0].pkey], cardIds: [], sets: [], rarities: [] }
  expect(termPrintingIds(db, LOCAL, of('card', target), 10)).toEqual([])
  expect(termPrintingIds(db, LOCAL, of('printing', target), 10)).toEqual([rows[0].id])
})

test('big targets stay within the portal limit of 100 bound parameters', () => {
  const rows = db.prepare('SELECT id, card_id, pkey FROM card_printings ORDER BY id').all() as {
    id: number
    card_id: number
    pkey: string
  }[]
  const many = <T>(first: T, n: number, fill: (i: number) => T): T[] => [
    first,
    ...Array.from({ length: n - 1 }, (_, i) => fill(i))
  ]
  const cap = capParams(db)
  try {
    const sets = many({ language: 'en', setName: SHARED_SET_NAME }, 60, (i) => ({
      language: 'en',
      setName: `Set ${i}`
    }))
    expect(termPrintingIds(db, LOCAL, of('set', { sets }), 10)).toEqual([rows[0].id, rows[1].id])
    const pkeys = many(rows[0].pkey, 150, (i) => `en|0|X|${i}`)
    expect(termPrintingIds(db, LOCAL, of('printing', { pkeys }), 10)).toEqual([rows[0].id])
    const cardIds = many(rows[0].card_id, 150, (i) => 1_000_000 + i)
    expect(termPrintingIds(db, LOCAL, of('cards', { cardIds }), 10)).toEqual([
      rows[0].id,
      rows[1].id
    ])
    const rarities = many('Reverse Holo', 120, (i) => `Rarity ${i}`)
    expect(
      termPrintingIds(
        db,
        LOCAL,
        of('rarity', { rarities }),
        10,
        rows.map((r) => r.id)
      )
    ).toEqual([rows[1].id, rows[3].id])
    expect(cap.max()).toBeLessThanOrEqual(DO_MAX_PARAMS)
  } finally {
    cap.restore()
  }
})

test('a card with English and Japanese printings returns the English id first', () => {
  const card = (
    db.prepare('SELECT card_id FROM card_printings LIMIT 1').get() as { card_id: number }
  ).card_id
  const add = db.prepare(
    `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
     VALUES ('pkm', ?, ?, ?, 'X 001', 'Rare')`
  )
  const ja = Number(add.run(card, 'ja', 'JA Set').lastInsertRowid)
  const en = Number(add.run(card, 'en', 'EN Set').lastInsertRowid)
  const ids = termPrintingIds(db, LOCAL, of('card', { cardIds: [card] }), 100)
  expect(ids.indexOf(en)).toBeLessThan(ids.indexOf(ja))
  expect(ids.slice(-1)).toEqual([ja])
})
