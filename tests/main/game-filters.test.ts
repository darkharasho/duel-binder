import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { seededDb } from './helpers'
import { seedPokemon } from '../fixtures/pokemon'
import { pokemonId } from '../../src/shared/games'
import { searchCards } from '../../src/main/repo/cards'
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
    rarity?: string
    setCode?: string
    localName?: string
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
    `INSERT INTO pokemon_cards (card_id, category, hp, types, stage, rarity, illustrator, source_id, local_name)
     VALUES (?, ?, ?, ?, ?, ?, 'x', ?, ?)`
  ).run(id, o.category, o.hp, JSON.stringify(o.types), o.stage, o.rarity ?? 'Common', o.source, o.localName ?? null)
  const r = db
    .prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
       VALUES ('pkm', ?, 'en', 'Test Set', ?, 'Normal')`
    )
    .run(id, o.setCode ?? 'TST 001/001')
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

    it('pkmRarities lists the seeded rarities and filters', () => {
      addPokemonCard(db, {
        source: 't-rare',
        name: 'Gyarados',
        category: 'Pokémon',
        hp: 180,
        types: ['Water'],
        stage: 'Stage 1',
        rarity: 'Double Rare'
      })
      expect(browseFacets(db).pkmRarities).toEqual(['Common', 'Double Rare'])
      expect(getFacets(db).pkmRarities).toEqual(['Common'])
      expect(browseNames({ pkmRarities: ['Double Rare'] })).toEqual(['Gyarados'])
      expect(browseNames({ pkmRarities: ['Common'] })).not.toContain('Gyarados')
      expect(names(listEntries(db, { ...ALL, pkmRarities: ['Double Rare'] }))).toEqual([])
      expect(names(listEntries(db, { ...ALL, pkmRarities: ['Common'] }))).toHaveLength(3)
    })

    describe('search', () => {
      beforeEach(() => {
        const pineco = addPokemonCard(db, {
          source: 't-pineco',
          name: 'Pineco',
          category: 'Pokémon',
          hp: 60,
          types: ['Grass'],
          stage: 'Basic',
          setCode: 'SVI 045/198',
          localName: 'マツボックリ'
        })
        addPokemonCard(db, {
          source: 't-gallery',
          name: 'Gallery Mew',
          category: 'Pokémon',
          hp: 70,
          types: ['Psychic'],
          stage: 'Basic',
          setCode: 'SIT TG05/TG30'
        })
        db.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`)
        addEntry(db, { printingId: pineco.printingId, imageId: pineco.cardId, quantity: 1 }, now)
      })

      const found = (q: string): string[] => browseNames({ q })
      const searched = (q: string): string[] => searchCards(db, q).map((r) => r.name)

      it('finds a card by name or Japanese name', () => {
        expect(found('Pineco')).toEqual(['Pineco'])
        expect(found('マツボックリ')).toEqual(['Pineco'])
        expect(searched('Pineco')).toEqual(['Pineco'])
        expect(searched('ボックリ')).toEqual(['Pineco'])
        expect(names(listEntries(db, { ...ALL, q: 'マツボ' }))).toEqual(['Pineco'])
      })

      it('finds a card by printing number, with or without leading zeros', () => {
        for (const q of ['045', '45']) {
          expect(found(q)).toEqual(['Pikachu', 'Pineco'])
          expect(searched(q)).toEqual(['Pikachu', 'Pineco'])
          expect(names(listEntries(db, { ...ALL, q }))).toEqual(['Pikachu', 'Pineco'])
        }
        expect(found('45/193')).toEqual(['Pikachu'])
        expect(found('045/198')).toEqual(['Pineco'])
        expect(searched('45/193')).toEqual(['Pikachu'])
        expect(found('45/999')).toEqual([])
      })

      it('does not match a localId with letters, or a number inside a longer one', () => {
        expect(found('5')).toEqual([])
        expect(found('05')).toEqual([])
        expect(found('30')).toEqual(['ピカチュウ'])
      })

      it('never finds Pokémon from a Yu-Gi-Oh scope', () => {
        setGame(db, 'ygo')
        for (const q of ['Pineco', 'マツボックリ', '045', '45/193']) {
          expect(found(q)).toEqual([])
          expect(searched(q)).toEqual([])
        }
      })
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
