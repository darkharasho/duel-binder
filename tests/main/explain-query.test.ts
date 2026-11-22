import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { LOCAL } from '../../src/main/repo/scope'
import { forgetSearchTerms } from '../../src/main/repo/searchTerms'
import { explainQuery } from '../../src/main/repo/explainQuery'
import { seedPokemon } from '../fixtures/pokemon'

let db: Database.Database
let mewPkey: string
beforeEach(() => {
  db = openDatabase(':memory:')
  seedPokemon(db)
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('active_game', 'pkm')").run()
  db.prepare(
    `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
     VALUES (9001, 'pkm', 'Mew ex', 'Pokémon', 'pokemon', 'Basic', '', '2026-11-21')`
  ).run()
  db.prepare(
    `INSERT INTO sets (game, language, set_name, set_code) VALUES ('pkm', 'en', 'Paldean Fates', 'PAF')`
  ).run()
  const r = db
    .prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
       VALUES ('pkm', 9001, 'en', 'Paldean Fates', '232/91', 'Shiny Ultra Rare')`
    )
    .run()
  mewPkey = (
    db.prepare('SELECT pkey FROM card_printings WHERE id = ?').get(Number(r.lastInsertRowid)) as {
      pkey: string
    }
  ).pkey
})
afterEach(() => db.close())

function addTerm(phrase: string, targetKind: string, target: object): void {
  db.prepare(
    `INSERT INTO search_terms (game, phrase, phrase_key, kind, target_kind, target, status, source, created_at)
     VALUES ('pkm', ?, ?, 'nickname', ?, ?, 'approved', 'owner', '2026-11-21')`
  ).run(phrase, phrase.toLowerCase(), targetKind, JSON.stringify(target))
  forgetSearchTerms(db)
}

test('a printing term is labelled with card, set and number', () => {
  addTerm('bubble mew', 'printing', { pkeys: [mewPkey] })
  expect(explainQuery(db, LOCAL, 'bubble mew')).toEqual([
    { phrase: 'bubble mew', label: 'Mew ex · Paldean Fates 232/91' }
  ])
})

test('a term whose target is missing locally gives no note', () => {
  addTerm('bubble mew', 'printing', { pkeys: ['nope'] })
  addTerm('ghost', 'card', { cardIds: [424242] })
  addTerm('nowhere', 'set', { sets: [{ language: 'en', setName: 'No Such Set' }] })
  expect(explainQuery(db, LOCAL, 'bubble mew ghost nowhere')).toEqual([])
})

test('card, cards, sets and rarity labels', () => {
  addTerm('mewmew', 'card', { cardIds: [9001] })
  const other = (
    db.prepare('SELECT MIN(id) AS id FROM cards WHERE id <> 9001').get() as { id: number }
  ).id
  addTerm('few', 'cards', { cardIds: [9001, other, 424242] })
  addTerm('fates', 'set', {
    sets: [
      { language: 'en', setName: 'Paldean Fates' },
      { language: 'en', setName: 'Gone' }
    ]
  })
  addTerm('pair', 'set', {
    sets: [
      { language: 'en', setName: 'Paldean Fates' },
      ...(db
        .prepare(
          "SELECT language, set_name AS setName FROM sets WHERE set_name <> 'Paldean Fates' LIMIT 1"
        )
        .all() as { language: string; setName: string }[])
    ]
  })
  addTerm('shiny', 'rarity', { rarities: ['Shiny Ultra Rare'] })
  const labels = Object.fromEntries(
    explainQuery(db, LOCAL, 'mewmew fates shiny').map((n) => [n.phrase, n.label])
  )
  expect(labels).toEqual({
    mewmew: 'Mew ex',
    fates: 'Paldean Fates',
    shiny: 'Shiny Ultra Rare'
  })
  expect(explainQuery(db, LOCAL, 'pair')).toEqual([
    { phrase: 'pair', label: expect.stringMatching(/^Paldean Fates \+1 more$/) }
  ])
  expect(explainQuery(db, LOCAL, 'few')).toEqual([{ phrase: 'few', label: '2 cards' }])
})
