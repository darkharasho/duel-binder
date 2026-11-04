import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { seededDb } from './helpers'
import { seedOnePiece } from '../fixtures/onePiece'
import { onePieceCardId, onePieceImageId } from '../../src/shared/games'
import { opVersionSql } from '../../src/shared/games/onePiece'
import { setType } from '../../src/shared/setTypes'
import { getCardDetail } from '../../src/main/repo/cards'
import { addEntry, getFacets, listEntries } from '../../src/main/repo/collection'
import { browseCards, browseFacets } from '../../src/main/repo/browse'
import { getStats } from '../../src/main/repo/stats'
import type { CollectionFilters } from '../../src/shared/types'

const now = new Date('2026-11-04T12:00:00.000Z')
const EVENT = 'OP17-019'

const setGame = (db: Database.Database, game: string): void => {
  db.prepare("DELETE FROM meta WHERE key = 'active_game'").run()
  db.prepare("INSERT INTO meta (key, value) VALUES ('active_game', ?)").run(game)
}

describe('One Piece in the repos', () => {
  let db: Database.Database
  let leaderId: number
  let eventId: number
  /** Entry ids: the Leader's L, its L (Alternate Art), the Event's C. */
  let entries: { l: number; alt: number; c: number }

  beforeEach(async () => {
    db = await seededDb()
    const op = seedOnePiece(db)
    leaderId = op.cardIds[0]
    eventId = onePieceCardId('en', EVENT)
    const eventImage = onePieceImageId('en', EVENT)
    // Named after the Leader and given an ATK (a Yu-Gi-Oh column), so a wrong sort shows.
    db.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", atk, updated_at)
       VALUES (?, 'op', 'Radical Beam!!', 'Event', 'op', '', '', 1, '2026-11-04')`
    ).run(eventId)
    db.prepare(
      `INSERT INTO onepiece_cards (card_id, number, colors, card_type, cost, block_icon)
       VALUES (?, ?, '["Red"]', 'Event', 1, 5)`
    ).run(eventId, EVENT)
    db.prepare(
      "INSERT INTO card_images (image_id, game, card_id, sort_order) VALUES (?, 'op', ?, 0)"
    ).run(eventImage, eventId)
    const eventPrinting = Number(
      db
        .prepare(
          `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
           VALUES ('op', ?, 'en', 'THE WORLD’S STRONGEST WARRIORS [OP-17]', ?, 'C')`
        )
        .run(eventId, EVENT).lastInsertRowid
    )
    setGame(db, 'op')
    const add = (printingId: number, imageId: number): number =>
      addEntry(db, { printingId, imageId, quantity: 1 }, now).id
    entries = {
      l: add(op.printingIds[0], op.imageIds[0]),
      alt: add(op.printingIds[1], op.imageIds[0]),
      c: add(eventPrinting, eventImage)
    }
  })

  const list = (f: Partial<CollectionFilters>): number[] =>
    listEntries(db, { sort: 'name', dir: 'asc', ...f })
      .map((e) => e.id)
      .sort((a, b) => a - b)

  it('facts: a One Piece card has its facts, a Yu-Gi-Oh card none', () => {
    const card = getCardDetail(db, leaderId)?.card
    expect(card?.onePiece).toEqual({
      cardType: 'Leader',
      colors: ['Red'],
      cost: null,
      life: 5,
      power: 5000,
      counter: null,
      attribute: ['Strike'],
      traits: ['Straw Hat Crew'],
      blockIcon: null,
      number: 'OP01-001'
    })
    expect(listEntries(db, { sort: 'name', dir: 'asc' })[0].card.onePiece?.number).toBe('OP01-001')
    setGame(db, 'ygo')
    const ygo = db.prepare("SELECT id FROM cards WHERE game = 'ygo' LIMIT 1").get() as {
      id: number
    }
    const detail = getCardDetail(db, ygo.id)
    expect(detail?.card).toBeDefined()
    expect(detail?.card.onePiece).toBeUndefined()
  })

  it('collection filters', () => {
    expect(list({ opCardTypes: ['Event'] })).toEqual([entries.c])
    expect(list({ opColors: ['Red'] })).toEqual([entries.l, entries.alt, entries.c])
    expect(list({ costMax: 0 })).toEqual([])
    expect(list({ costMin: 1, costMax: 1 })).toEqual([entries.c])
    expect(list({ powerMin: 5000 })).toEqual([entries.l, entries.alt])
    expect(list({ opAttributes: ['Strike'] })).toEqual([entries.l, entries.alt])
    expect(list({ opTraits: ['Straw Hat Crew'] })).toEqual([entries.l, entries.alt])
    expect(list({ opBlocks: ['5'] })).toEqual([entries.c])
    expect(list({ opRarities: ['L'] })).toEqual([entries.l, entries.alt])
    expect(list({ opVersions: ['Alternate Art'] })).toEqual([entries.alt])
    expect(list({ opVersions: ['Base'] })).toEqual([entries.l, entries.c])
    expect(list({ opRarities: ['L'], opVersions: ['Base'] })).toEqual([entries.l])
    // A Yu-Gi-Oh filter is ignored on One Piece.
    expect(list({ cardTypes: ['Effect Monster'] })).toEqual([entries.l, entries.alt, entries.c])
  })

  it('collection facets', () => {
    const f = getFacets(db)
    expect(f.opCardTypes).toEqual(['Leader', 'Event'])
    expect(f.opRarities).toEqual(['L', 'C'])
    expect(f.opVersions).toEqual(['Base', 'Alternate Art'])
    expect(f.opColors).toEqual(['Red'])
    expect(f.opBlocks).toEqual(['5'])
  })

  it('browse filters and facets', () => {
    const b = browseFacets(db)
    expect(b.opCardTypes).toEqual(['Leader', 'Event'])
    expect(b.opRarities).toEqual(['L', 'C'])
    expect(b.opVersions).toEqual(['Base', 'Alternate Art'])
    expect(b.opBlocks).toEqual(['5'])
    expect(b.opColors).toEqual(['Red'])
    expect(b.opAttributes).toEqual(['Strike'])
    expect(b.opTraits).toEqual(['Straw Hat Crew'])
    expect([b.cardTypes, b.attributes, b.races, b.archetypes]).toEqual([[], [], [], []])

    const names = (f: Record<string, unknown>): string[] =>
      browseCards(db, { sort: 'name', dir: 'asc', ...f }).cards.map((c) => c.name)
    expect(names({ opCardTypes: ['Event'] })).toEqual(['Radical Beam!!'])
    expect(names({ opColors: ['Red'] })).toEqual(['Monkey.D.Luffy', 'Radical Beam!!'])
    expect(names({ costMax: 0 })).toEqual([])
    expect(names({ opRarities: ['L'] })).toEqual(['Monkey.D.Luffy'])
    expect(names({ opVersions: ['Alternate Art'] })).toEqual(['Monkey.D.Luffy'])
    expect(names({ opVersions: ['Base'] })).toEqual(['Monkey.D.Luffy', 'Radical Beam!!'])
    expect(names({ opRarities: ['C'], opVersions: ['Alternate Art'] })).toEqual([])
  })

  it('browse sort by cost and power; Yu-Gi-Oh sorts fall back to name', () => {
    const names = (sort: string, dir: 'asc' | 'desc' = 'asc'): string[] =>
      browseCards(db, { sort: sort as 'name', dir }).cards.map((c) => c.name)
    expect(names('name')).toEqual(['Monkey.D.Luffy', 'Radical Beam!!'])
    expect(names('cost')).toEqual(['Radical Beam!!', 'Monkey.D.Luffy'])
    expect(names('cost', 'desc')).toEqual(['Radical Beam!!', 'Monkey.D.Luffy'])
    expect(names('power', 'desc')).toEqual(['Monkey.D.Luffy', 'Radical Beam!!'])
    expect(names('atk')).toEqual(['Monkey.D.Luffy', 'Radical Beam!!'])
  })

  it('cost and power sort by name on Yu-Gi-Oh and Pokémon', () => {
    for (const game of ['ygo', 'pkm']) {
      setGame(db, game)
      const byName = browseCards(db, { sort: 'name', dir: 'desc' }).cards.map((c) => c.id)
      for (const sort of ['cost', 'power'] as const) {
        expect(browseCards(db, { sort, dir: 'desc' }).cards.map((c) => c.id)).toEqual(byName)
      }
    }
  })

  it('stats: card types with copy counts', () => {
    const byType = getStats(db).byFrameType
    expect(byType).toHaveLength(2)
    expect(byType).toEqual(
      expect.arrayContaining([
        { frameType: 'Leader', count: 2 },
        { frameType: 'Event', count: 1 }
      ])
    )
  })

  it('set types', () => {
    expect(setType({ setName: 'x', setCode: 'ST31' }, 'op')).toBe('deck')
    expect(setType({ setName: 'x', setCode: 'P' }, 'op')).toBe('promo')
    expect(setType({ setName: 'x', setCode: 'OPC' }, 'op')).toBe('collection')
    // The Japanese Family Deck Set.
    expect(setType({ setName: 'Family Deck Set', setCode: 'FDS' }, 'op')).toBe('deck')
    expect(setType({ setName: 'x', setCode: 'OP17' }, 'op')).toBe('booster')
    expect(setType({ setName: 'x', setCode: 'PRB01' }, 'op')).toBe('booster')
    expect(setType({ setName: 'Structure Deck: Yugi', setCode: 'SDY' })).toBe('deck')
    expect(setType({ setName: 'Structure Deck: Yugi', setCode: 'ST31' }, 'ygo')).toBe('deck')
    expect(setType({ setName: 'Promo Pack', setCode: 'P' }, 'pkm')).toBe('booster')
  })

  it('version of a label', () => {
    const version = (label: string): string =>
      (
        db.prepare(`SELECT ${opVersionSql('x.l')} AS v FROM (SELECT ? AS l) x`).get(label) as {
          v: string
        }
      ).v
    expect(version('SR')).toBe('Base')
    expect(version('SP')).toBe('Base')
    expect(version('TR')).toBe('Base')
    expect(version('SP (2)')).toBe('Base')
    expect(version('SR (Alternate Art)')).toBe('Alternate Art')
    expect(version('SR (Alternate Art 2)')).toBe('Alternate Art 2')
    expect(version('P (Offline Regional Participation Pack 2025 Vol.1)')).toBe(
      'Offline Regional Participation Pack 2025 Vol.1'
    )
    expect(version('P (Offline Regional Finalist Card Set 25-26 Season 1)')).toBe(
      'Offline Regional Finalist Card Set 25-26 Season 1'
    )
  })
})
