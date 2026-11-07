import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { createDataHandlers } from '../../src/main/ipc/dataHandlers'
import { pokedexSpecies, pokedexSummary } from '../../src/main/repo/pokedex'
import { LOCAL, localScope } from '../../src/main/repo/scope'

const PKM = localScope("'pkm'")
const NOW = '2026-11-07T00:00:00.000Z'

let db: Database.Database
let nextId = 1

/** A Pokémon card with one printing; returns the card and printing ids. */
function card(
  name: string,
  dexNo: number | null,
  opts: {
    extra?: string
    category?: string
    language?: string
    setName?: string
    date?: string
  } = {}
): { cardId: number; printingId: number } {
  const id = nextId++
  const language = opts.language ?? 'en'
  const setName = opts.setName ?? 'Set A'
  db.prepare(
    `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
     VALUES (?, 'pkm', ?, 'Pokémon', 'pokemon', '', '', ?)`
  ).run(id, name, NOW)
  db.prepare(
    "INSERT INTO card_images (image_id, game, card_id, sort_order) VALUES (?, 'pkm', ?, 0)"
  ).run(id + 1000, id)
  db.prepare(
    `INSERT INTO pokemon_cards (card_id, category, source_id, dex_no, dex_extra) VALUES (?, ?, ?, ?, ?)`
  ).run(id, opts.category ?? 'Pokemon', `src-${id}`, dexNo, opts.extra ?? null)
  db.prepare(
    "INSERT OR IGNORE INTO sets (game, language, set_name, set_code, tcg_date) VALUES ('pkm', ?, ?, 'X', ?)"
  ).run(language, setName, opts.date ?? '2024-01-01')
  const p = db
    .prepare(
      `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
       VALUES ('pkm', ?, ?, ?, ?, 'Common')`
    )
    .run(id, language, setName, `${setName} ${id}`)
  return { cardId: id, printingId: Number(p.lastInsertRowid) }
}

function own(printingId: number, cardId: number, quantity = 1, deleted = false): void {
  db.prepare(
    `INSERT INTO collection_entries (uid, owner_id, game, printing_id, image_id, quantity, created_at, updated_at, deleted_at)
     VALUES (?, 0, 'pkm', ?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), printingId, cardId + 1000, quantity, NOW, NOW, deleted ? NOW : null)
}

beforeEach(() => {
  db = openDatabase(':memory:')
  nextId = 1
})
afterEach(() => db.close())

describe('pokedexSummary', () => {
  it('sums copies per species across cards, skipping tombstones and Trainers', () => {
    const a = card('Charizard', 6)
    const b = card('Charizard ex', 6, { setName: 'Set B' })
    const gone = card('Charizard V', 6, { setName: 'Set C' })
    const trainer = card('Professor', null, { category: 'Trainer' })
    own(a.printingId, a.cardId, 2)
    own(b.printingId, b.cardId, 1)
    own(gone.printingId, gone.cardId, 5, true)
    own(trainer.printingId, trainer.cardId, 3)
    expect(pokedexSummary(db, PKM).caught).toEqual([{ dexNo: 6, copies: 3 }])
  })

  it('catches both species of a Tag Team card, sorted by number', () => {
    const t = card('Pikachu & Zekrom', 25, { extra: '644' })
    const m = card('Mew', 151)
    own(m.printingId, m.cardId)
    own(t.printingId, t.cardId, 2)
    expect(pokedexSummary(db, PKM).caught).toEqual([
      { dexNo: 25, copies: 2 },
      { dexNo: 151, copies: 1 },
      { dexNo: 644, copies: 2 }
    ])
  })

  it('is empty for a scope that is not Pokémon', () => {
    const a = card('Charizard', 6)
    own(a.printingId, a.cardId)
    expect(pokedexSummary(db, localScope("'ygo'")).caught).toEqual([])
    expect(pokedexSummary(db, LOCAL).caught).toEqual([])
  })
})

describe('pokedexSpecies', () => {
  it('lists owned cards with copies and unowned English cards as missing, not unowned Japanese ones', () => {
    const a = card('Charizard', 6, { date: '2023-01-01' })
    own(a.printingId, a.cardId, 2)
    const en = card('Charizard ex', 6, { setName: 'Set B', date: '2024-01-01' })
    card('リザードン', 6, { language: 'ja', setName: 'JP Set', date: '2024-06-01' })
    const r = pokedexSpecies(db, 6, PKM)
    expect(r.dexNo).toBe(6)
    expect(r.owned).toEqual([
      {
        cardId: a.cardId,
        imageId: a.cardId + 1000,
        name: 'Charizard',
        setName: 'Set A',
        language: 'en',
        copies: 2
      }
    ])
    expect(r.missing).toEqual([
      {
        cardId: en.cardId,
        imageId: en.cardId + 1000,
        name: 'Charizard ex',
        setName: 'Set B',
        language: 'en',
        copies: 0
      }
    ])
  })

  it('sums copies over all printings of a card and orders owned newest set first', () => {
    const old = card('Pikachu', 25, { setName: 'Old', date: '2020-01-01' })
    const newer = card('Pikachu V', 25, { setName: 'New', date: '2024-01-01' })
    own(old.printingId, old.cardId, 1)
    const second = db
      .prepare(
        `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
         VALUES ('pkm', ?, 'en', 'Old', 'X2', 'Rare')`
      )
      .run(old.cardId)
    own(Number(second.lastInsertRowid), old.cardId, 2)
    own(newer.printingId, newer.cardId, 1)
    const r = pokedexSpecies(db, 25, PKM)
    expect(r.owned.map((c) => [c.name, c.copies])).toEqual([
      ['Pikachu V', 1],
      ['Pikachu', 3]
    ])
  })

  it('finds a Tag Team card from its second species', () => {
    const t = card('Pikachu & Zekrom', 25, { extra: '644' })
    own(t.printingId, t.cardId)
    expect(pokedexSpecies(db, 644, PKM).owned.map((c) => c.cardId)).toEqual([t.cardId])
    expect(pokedexSpecies(db, 64, PKM).owned).toEqual([])
  })

  it('with only Japanese cards owned, owned has them and missing the English ones', () => {
    const ja = card('リザードン', 6, { language: 'ja', setName: 'JP' })
    own(ja.printingId, ja.cardId)
    const en = card('Charizard', 6)
    const r = pokedexSpecies(db, 6, PKM)
    expect(r.owned.map((c) => c.cardId)).toEqual([ja.cardId])
    expect(r.missing.map((c) => c.cardId)).toEqual([en.cardId])
  })

  it('falls back to Japanese cards in missing when the species has no English card', () => {
    const ja = card('ウーラオス', 892, { language: 'ja', setName: 'JP' })
    const r = pokedexSpecies(db, 892, PKM)
    expect(r.owned).toEqual([])
    expect(r.missing.map((c) => c.cardId)).toEqual([ja.cardId])
  })

  it('has no missing cards when every English card is owned, whatever Japanese cards remain', () => {
    const en = card('Charizard', 6)
    own(en.printingId, en.cardId)
    card('リザードン', 6, { language: 'ja', setName: 'JP' })
    expect(pokedexSpecies(db, 6, PKM).missing).toEqual([])
  })

  it('returns nothing for a species with no cards', () => {
    expect(pokedexSpecies(db, 1025, PKM)).toEqual({ dexNo: 1025, owned: [], missing: [] })
  })
})

describe('pokedex handlers', () => {
  it('validate the species number', async () => {
    const h = createDataHandlers({
      db,
      onEdit: () => {},
      availableGames: () => ['pkm'],
      onGameChanged: () => {}
    })
    await expect(h['pokedex:species'](0)).rejects.toThrow()
    await expect(h['pokedex:species'](1026)).rejects.toThrow()
    await expect(h['pokedex:species']('6')).rejects.toThrow()
    await expect(h['pokedex:species'](6)).resolves.toEqual({ dexNo: 6, owned: [], missing: [] })
  })
})
