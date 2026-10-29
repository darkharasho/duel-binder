import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { seededDb } from './helpers'
import { seedPokemon } from '../fixtures/pokemon'
import { pokemonId } from '../../src/shared/games'
import { addEntry, getFacets, listEntries } from '../../src/main/repo/collection'
import { browseCards, browseFacets } from '../../src/main/repo/browse'
import { getStats } from '../../src/main/repo/stats'

const now = new Date('2026-10-29T12:00:00.000Z')
const ALL = { sort: 'name', dir: 'asc' } as const
const BROWSE = { sort: 'name', dir: 'asc' } as const

const setGame = (db: Database.Database, game: string | null): void => {
  db.prepare("DELETE FROM meta WHERE key = 'active_game'").run()
  if (game) db.prepare("INSERT INTO meta (key, value) VALUES ('active_game', ?)").run(game)
}

/** Adds a card (with one printing) on top of seedPokemon's two Lightning Basics (HP 60 and 70). */
function addPokemonCard(
  db: Database.Database,
  o: {
    source: string
    name: string
    category: string
    hp: number | null
    types: string[]
    stage: string | null
  }
): { cardId: number; printingId: number } {
  const id = pokemonId(o.source)
  db.prepare(
    `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
     VALUES (?, 'pkm', ?, ?, 'pokemon', '', '', '2026-10-29')`
  ).run(id, o.name, o.category)
  db.prepare(
    "INSERT INTO card_images (image_id, game, card_id, sort_order) VALUES (?, 'pkm', ?, 0)"
  ).run(id, id)
  db.prepare(
    `INSERT INTO pokemon_cards (card_id, category, hp, types, stage, rarity, illustrator, source_id)
     VALUES (?, ?, ?, ?, ?, 'Common', 'x', ?)`
  ).run(id, o.category, o.hp, JSON.stringify(o.types), o.stage, o.source)
  const r = db
    .prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
       VALUES ('pkm', ?, 'en', 'Test Set', 'TST 001/001', 'Normal')`
    )
    .run(id)
  return { cardId: id, printingId: Number(r.lastInsertRowid) }
}

describe('per-game filters and facets', () => {
  let db: Database.Database

  beforeEach(async () => {
    db = await seededDb()
    const base = seedPokemon(db)
    const zard = addPokemonCard(db, {
      source: 't-zard',
      name: 'Charizard',
      category: 'Pokémon',
      hp: 170,
      types: ['Fire', 'Flying'],
      stage: 'Stage 2'
    })
    const potion = addPokemonCard(db, {
      source: 't-potion',
      name: 'Potion',
      category: 'Trainer',
      hp: null,
      types: [],
      stage: null
    })
    addPokemonCard(db, {
      source: 't-energy',
      name: 'Fire Energy',
      category: 'Energy',
      hp: null,
      types: ['Fire'],
      stage: null
    })
    db.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`)
    setGame(db, 'pkm')
    addEntry(db, { printingId: base.printingIds[0], imageId: base.cardIds[0], quantity: 2 }, now)
    addEntry(db, { printingId: zard.printingId, imageId: zard.cardId, quantity: 1 }, now)
    addEntry(db, { printingId: potion.printingId, imageId: potion.cardId, quantity: 4 }, now)
  })

  const names = (rows: { card: { name: string } }[]): string[] => rows.map((r) => r.card.name)
  const browseNames = (f: object): string[] =>
    browseCards(db, { ...BROWSE, ...f }).cards.map((c) => c.name)

  describe('on Pokémon', () => {
    it('pkmTypes filters by an element of the JSON types array', () => {
      expect(names(listEntries(db, { ...ALL, pkmTypes: ['Fire'] }))).toEqual(['Charizard'])
      expect(names(listEntries(db, { ...ALL, pkmTypes: ['Flying', 'Lightning'] }))).toEqual([
        'Charizard',
        'Pikachu'
      ])
      expect(browseNames({ pkmTypes: ['Fire'] })).toEqual(['Charizard', 'Fire Energy'])
    })

    it('pkmCategories and pkmStages filter', () => {
      expect(names(listEntries(db, { ...ALL, pkmCategories: ['Trainer'] }))).toEqual(['Potion'])
      expect(browseNames({ pkmStages: ['Stage 2'] })).toEqual(['Charizard'])
      expect(browseNames({ pkmCategories: ['Energy', 'Trainer'] })).toEqual([
        'Fire Energy',
        'Potion'
      ])
    })

    it('hpMin and hpMax bound the HP, excluding cards without HP', () => {
      expect(names(listEntries(db, { ...ALL, hpMin: 100 }))).toEqual(['Charizard'])
      expect(names(listEntries(db, { ...ALL, hpMax: 60 }))).toEqual(['Pikachu'])
      expect(browseNames({ hpMin: 65, hpMax: 100 })).toEqual(['ピカチュウ'])
    })

    it('ignores the Yu-Gi-Oh fields', () => {
      const all = names(listEntries(db, ALL))
      expect(all).toHaveLength(3)
      expect(
        names(
          listEntries(db, {
            ...ALL,
            attributes: ['DARK'],
            cardTypes: ['Effect Monster'],
            archetypes: ['x'],
            levelMin: 4
          })
        )
      ).toEqual(all)
      expect(browseNames({ attributes: ['DARK'], races: ['Dragon'], levelMax: 1 })).toHaveLength(5)
    })

    it('facets list categories, types and stages, with empty Yu-Gi-Oh facets', () => {
      expect(browseFacets(db)).toMatchObject({
        cardTypes: [],
        attributes: [],
        races: [],
        archetypes: [],
        pkmCategories: ['Energy', 'Pokémon', 'Trainer'],
        pkmTypes: ['Fire', 'Flying', 'Lightning'],
        pkmStages: ['Basic', 'Stage 2']
      })
      // Collection facets only cover what is owned.
      expect(getFacets(db)).toMatchObject({
        cardTypes: [],
        pkmCategories: ['Pokémon', 'Trainer'],
        pkmTypes: ['Fire', 'Flying', 'Lightning'],
        pkmStages: ['Basic', 'Stage 2']
      })
    })

    it('sorts by hp, and atk/def/level fall back to name', () => {
      const hp = browseCards(db, { sort: 'hp', dir: 'desc' }).cards.map((c) => c.name)
      expect(hp.slice(0, 3)).toEqual(['Charizard', 'ピカチュウ', 'Pikachu'])
      const byName = browseNames({})
      for (const sort of ['atk', 'def', 'level'] as const)
        expect(browseNames({ sort })).toEqual(byName)
    })

    it('stats put the category in byFrameType', () => {
      expect(getStats(db).byFrameType).toEqual([
        { frameType: 'Trainer', count: 4 },
        { frameType: 'Pokémon', count: 3 }
      ])
    })
  })

  describe('on Yu-Gi-Oh', () => {
    it('ignores the pkm filters and has no pkm facets', () => {
      setGame(db, 'ygo')
      addEntry(
        db,
        { printingId: ygoPrinting(db).id, imageId: ygoPrinting(db).imageId, quantity: 1 },
        now
      )
      expect(
        listEntries(db, { ...ALL, pkmTypes: ['Fire'], hpMin: 9999, pkmCategories: ['Trainer'] })
      ).toEqual(listEntries(db, ALL))
      expect(listEntries(db, ALL)).toHaveLength(1)
      const f = { ...BROWSE, pkmTypes: ['Fire'], pkmStages: ['Basic'], hpMin: 9999 }
      expect(browseCards(db, f)).toEqual(browseCards(db, BROWSE))
      expect(browseCards(db, BROWSE).total).toBeGreaterThan(1)
      expect(browseFacets(db).pkmTypes).toBeUndefined()
      expect(getFacets(db).pkmCategories).toBeUndefined()
      expect(browseFacets(db).cardTypes.length).toBeGreaterThan(0)
    })

    it("'hp' sorts by name", () => {
      setGame(db, 'ygo')
      expect(browseCards(db, { sort: 'hp', dir: 'asc' })).toEqual(browseCards(db, BROWSE))
    })
  })
})

function ygoPrinting(db: Database.Database): { id: number; imageId: number } {
  return db
    .prepare(
      `SELECT p.id, (SELECT image_id FROM card_images WHERE card_id = p.card_id ORDER BY sort_order LIMIT 1) AS imageId
       FROM card_printings p WHERE p.game = 'ygo' AND p.language = 'en' ORDER BY p.id LIMIT 1`
    )
    .get() as { id: number; imageId: number }
}
