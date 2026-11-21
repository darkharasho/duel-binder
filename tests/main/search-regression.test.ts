import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { searchCards } from '../../src/main/repo/cards'
import { parseFields } from '../../src/main/repo/queryFields'
import { matchTerms } from '../../src/main/repo/searchTerms'
import { LOCAL } from '../../src/main/repo/scope'
import { termWords } from '../../src/shared/search/terms'
import { mtgCardId, pokemonId } from '../../src/shared/games'
import type { CardSearchResult } from '../../src/shared/types'
import { seededDb } from './helpers'
import { seedPokemon } from '../fixtures/pokemon'
import { seedMagic } from '../fixtures/magic'
import { seedOnePiece } from '../fixtures/onePiece'

/**
 * Today's searches must not change: every query's rows, frozen from the code before version rows,
 * stay first and in order. Queries with no term or field words give exactly the frozen rows.
 * Regenerate (only on purpose) with FREEZE_SEARCH=1.
 */
const SNAPSHOT = join(__dirname, '../fixtures/search-regression.json')
const GAMES = ['ygo', 'pkm', 'mtg', 'op'] as const
const QUERIES = [
  'dark magician',
  'blue-eyes',
  'MEP 102',
  'Victini 102',
  'fusion',
  'char',
  'LOB-001'
]
/** Queries the snapshot must give exactly, in every game. */
const PLAIN = ['dark magician', 'blue-eyes', 'fusion', 'char']

let db: Database.Database

function seedYgo(): void {
  let next = 7000
  const card = db.prepare(
    `INSERT INTO cards (id, name, type, frame_type, race, "desc", updated_at) VALUES (?, ?, ?, 'normal', 'Dragon', '', '2026-10-01')`
  )
  const printing = db.prepare(
    `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language) VALUES (?, ?, ?, ?, ?)`
  )
  const add = (
    name: string,
    type: string,
    printings: [string, string, string, string?][]
  ): void => {
    const id = next++
    card.run(id, name, type)
    for (const [set, code, rarity, lang] of printings)
      printing.run(id, set, code, rarity, lang ?? 'en')
  }
  const set = db.prepare(
    "INSERT OR REPLACE INTO sets (game, language, set_name, set_code, tcg_date) VALUES ('ygo', ?, ?, ?, ?)"
  )
  set.run('en', 'Legend of Blue Eyes White Dragon', 'LOB', '2002-03-08')
  set.run('en', 'Starter Deck: Kaiba', 'SDK', '2002-03-29')
  set.run('en', 'Fusion Enforcers', 'FUEN', '2017-02-02')
  set.run('en', 'Battles of Legend: Chapter 1', 'BLC1', '2023-11-17')
  add('Blue-Eyes White Dragon', 'Normal Monster', [
    ['Legend of Blue Eyes White Dragon', 'LOB-001', 'Ultra Rare'],
    ['Starter Deck: Kaiba', 'SDK-001', 'Ultra Rare'],
    ['Legend of Blue Eyes White Dragon', 'LOB-DE001', 'Ultra Rare', 'de'],
    ['Battles of Legend: Chapter 1', 'BLC1-EN001', 'Quarter Century Secret Rare']
  ])
  add('Blue-Eyes Ultimate Dragon', 'Fusion Monster', [
    ['Legend of Blue Eyes White Dragon', 'LOB-EN000', 'Secret Rare']
  ])
  add('Dark Magician Girl', 'Effect Monster', [
    ['Battles of Legend: Chapter 1', 'BLC1-EN002', 'Ultra Rare']
  ])
  add('Polymerization', 'Spell Card', [
    ['Legend of Blue Eyes White Dragon', 'LOB-059', 'Rare'],
    ['Fusion Enforcers', 'FUEN-EN040', 'Secret Rare']
  ])
  add('Fusion Gate', 'Spell Card', [['Fusion Enforcers', 'FUEN-EN041', 'Super Rare']])
  add('Charcoal Inpachi', 'Normal Monster', [['Starter Deck: Kaiba', 'SDK-010', 'Common']])
  add('Undated Dragon', 'Normal Monster', [['Nowhere', 'NOW-001', 'Common']])
}

function seedPkm(): void {
  seedPokemon(db)
  const set = db.prepare(
    "INSERT OR REPLACE INTO sets (game, language, set_name, set_code, tcg_date) VALUES ('pkm', 'en', ?, ?, ?)"
  )
  set.run('Lost Origin', 'LOR', '2022-09-09')
  set.run('Lost Origin Trainer Gallery', 'LOR:TG', '2022-09-09')
  set.run('Paldean Fates', 'PAF', '2024-01-26')
  set.run('Fusion Strike', 'FST', '2021-11-12')
  set.run('Celebrations', 'CEL', '2021-10-08')
  set.run('Scarlet & Violet Black Star Promos', 'MEP', '2023-03-31')
  const card = db.prepare(
    `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
     VALUES (?, 'pkm', ?, 'Pokémon', 'pokemon', 'Basic', '', '2026-10-29')`
  )
  const image = db.prepare(
    "INSERT INTO card_images (image_id, game, card_id, sort_order) VALUES (?, 'pkm', ?, 0)"
  )
  const details = db.prepare(
    `INSERT INTO pokemon_cards (card_id, category, hp, types, stage, rarity, illustrator, source_id, local_name)
     VALUES (?, 'Pokémon', 100, '["Fire"]', 'Basic', 'Rare', 'x', ?, ?)`
  )
  const printing = db.prepare(
    `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
     VALUES ('pkm', ?, 'en', ?, ?, ?)`
  )
  const add = (
    source: string,
    name: string,
    local: string | null,
    printings: [string, string, string][]
  ): void => {
    const id = pokemonId(source)
    card.run(id, name)
    image.run(id, id)
    details.run(id, source, local)
    for (const [s, code, rarity] of printings) printing.run(id, s, code, rarity)
  }
  add('t-victini-set', 'Victini', null, [['Celebrations', 'CEL 013/128', 'Rare']])
  add('t-victini-promo', 'Victini', null, [
    ['Scarlet & Violet Black Star Promos', 'MEP 102', 'Promo']
  ])
  add('t-charizard', 'Charizard', 'リザードン', [
    ['Lost Origin', 'LOR 020/196', 'Rare'],
    ['Lost Origin Trainer Gallery', 'LOR:TG TG03/30', 'Rare Holo']
  ])
  add('t-charmander', 'Charmander', 'ヒトカゲ', [['Paldean Fates', 'PAF 007/091', 'Common']])
  add('t-mew', 'Mew ex', null, [
    ['Paldean Fates', 'PAF 216/091', 'Double Rare'],
    ['Paldean Fates', 'PAF 232/091', 'Special Illustration Rare']
  ])
  add('t-fusion-energy', 'Fusion Strike Energy', null, [
    ['Fusion Strike', 'FST 244/264', 'Uncommon']
  ])
}

function seedMtg(): void {
  seedMagic(db)
  const oracle = 'aaaaaaaa-0000-4000-8000-00000000c4a2'
  for (const [lang, local] of [
    ['en', null],
    ['de', 'Verkohlen']
  ] as const) {
    const id = mtgCardId(lang, oracle)
    db.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
       VALUES (?, 'mtg', 'Char', 'Instant', 'mtg', '', '', '2026-11-09')`
    ).run(id)
    db.prepare(
      `INSERT INTO mtg_cards (card_id, oracle_id, layout, type_line, types, mana_cost, mana_value, colors,
         color_identity, oracle_text, keywords, lang, local_name, local_name_search)
       VALUES (?, ?, 'normal', 'Instant', '["Instant"]', '{2}{R}', 3, '["R"]', '["R"]', '', '[]', ?, ?, ?)`
    ).run(id, oracle, lang, local, local?.toLowerCase() ?? null)
    db.prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
       VALUES ('mtg', ?, ?, 'Ravnica: City of Guilds', 'RAV 115', 'Rare')`
    ).run(id, lang)
  }
}

const setGame = (game: string): void => {
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('active_game', ?)").run(game)
}

beforeAll(async () => {
  db = await seededDb()
  seedYgo()
  seedPkm()
  seedMtg()
  seedOnePiece(db)
  db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')")
})
afterAll(() => db.close())

function runAll(): Record<string, CardSearchResult[]> {
  const out: Record<string, CardSearchResult[]> = {}
  for (const game of GAMES) {
    setGame(game)
    for (const q of QUERIES) out[`${game}: ${q}`] = searchCards(db, q)
  }
  setGame('ygo')
  return out
}

// Only FREEZE_SEARCH=1 writes the snapshot: a missing file fails below instead of passing on whatever the code returns.
if (process.env.FREEZE_SEARCH === '1') {
  test('freeze today’s search rows', () => {
    writeFileSync(SNAPSHOT, `${JSON.stringify(runAll(), null, 1)}\n`)
  })
}

describe('today’s search rows', () => {
  const frozen = (): Record<string, CardSearchResult[]> =>
    JSON.parse(readFileSync(SNAPSHOT, 'utf8'))

  test('the snapshot covers every game and query, with rows to compare', () => {
    const f = frozen()
    expect(Object.keys(f).sort()).toEqual(
      GAMES.flatMap((g) => QUERIES.map((q) => `${g}: ${q}`)).sort()
    )
    expect(Object.values(f).filter((rows) => rows.length > 0).length).toBeGreaterThanOrEqual(10)
  })

  test('stay first and in order; only version rows come after them', () => {
    const now = runAll()
    for (const [key, rows] of Object.entries(frozen())) {
      const got = now[key]
      expect({ key, rows: got.slice(0, rows.length) }).toEqual({ key, rows })
      for (const extra of got.slice(rows.length))
        expect({ key, printingId: typeof extra.printingId }).toEqual({ key, printingId: 'number' })
    }
  })

  test('are exactly what a query with no term or field words gives', () => {
    const now = runAll()
    const f = frozen()
    for (const game of GAMES) {
      setGame(game)
      for (const q of QUERIES) {
        const plain =
          matchTerms(db, LOCAL, q).matches.length === 0 &&
          parseFields(db, LOCAL, termWords(q)) === null
        if (PLAIN.includes(q)) expect({ game, q, plain }).toEqual({ game, q, plain: true })
        if (plain)
          expect({ game, q, rows: now[`${game}: ${q}`] }).toEqual({
            game,
            q,
            rows: f[`${game}: ${q}`]
          })
      }
    }
    setGame('ygo')
  })
})
