import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { seededDb } from './helpers'
import { SHARED_SET_NAME, seedPokemon } from '../fixtures/pokemon'
import { addEntry, getFacets, listEntries } from '../../src/main/repo/collection'
import { getCardDetail, searchCards } from '../../src/main/repo/cards'
import { browseCards, browseFacets } from '../../src/main/repo/browse'
import { getChecklist, listSets } from '../../src/main/repo/sets'
import { getStats, recordSnapshot } from '../../src/main/repo/stats'
import { cardsForImages, matchName, printingsByCode } from '../../src/main/repo/scan'
import { ripPool } from '../../src/main/repo/rip'
import { refreshSets } from '../../src/main/sync/sets'
import { runSync } from '../../src/main/sync/sync'

const now = new Date('2026-10-29T12:00:00.000Z')
const ALL = { sort: 'name', dir: 'asc' } as const
const BROWSE = { sort: 'name', dir: 'asc' } as const
const PKM_CODE = 'PAL 045/193'

const setGame = (db: Database.Database, game: string | null): void => {
  db.prepare("DELETE FROM meta WHERE key = 'active_game'").run()
  if (game) db.prepare("INSERT INTO meta (key, value) VALUES ('active_game', ?)").run(game)
}

/** The first English Yu-Gi-Oh printing of the shared set name, with its card's first image. */
function ygoPrinting(db: Database.Database): { id: number; imageId: number; setCode: string } {
  return db
    .prepare(
      `SELECT p.id, p.set_code AS setCode,
         (SELECT image_id FROM card_images WHERE card_id = p.card_id ORDER BY sort_order, image_id LIMIT 1) AS imageId
       FROM card_printings p WHERE p.game = 'ygo' AND p.language = 'en' AND p.set_name = ? ORDER BY p.id LIMIT 1`
    )
    .get(SHARED_SET_NAME) as { id: number; imageId: number; setCode: string }
}

/** Every repo read behind the data channels the brief names, for the active game. */
function reads(db: Database.Database, setCode: string): Record<string, unknown> {
  return {
    list: listEntries(db, ALL),
    facets: getFacets(db),
    search: searchCards(db, 'dragon'),
    browse: browseCards(db, BROWSE),
    browseFacets: browseFacets(db),
    sets: listSets(db),
    checklist: getChecklist(db, SHARED_SET_NAME, 'en'),
    stats: getStats(db),
    byCode: printingsByCode(db, setCode)
  }
}

describe('game-scoped repo queries', () => {
  let baseline: Database.Database
  let db: Database.Database
  let pkm: { cardIds: number[]; printingIds: number[] }
  let ygo: { id: number; imageId: number; setCode: string }

  beforeEach(async () => {
    baseline = await seededDb()
    ygo = ygoPrinting(baseline)
    addEntry(baseline, { printingId: ygo.id, imageId: ygo.imageId, quantity: 2 }, now)
    recordSnapshot(baseline, now)

    db = await seededDb()
    pkm = seedPokemon(db)
    db.exec(`INSERT INTO cards_fts(cards_fts) VALUES('rebuild')`)
    addEntry(db, { printingId: ygo.id, imageId: ygo.imageId, quantity: 2 }, now)
    recordSnapshot(db, now)
    setGame(db, 'pkm')
    addEntry(db, { printingId: pkm.printingIds[0], imageId: pkm.cardIds[0], quantity: 3 }, now)
    recordSnapshot(db, now)
    setGame(db, null)
  })

  it('with no active game, every read is Yu-Gi-Oh and matches a Yu-Gi-Oh-only database', () => {
    expect(reads(db, ygo.setCode)).toEqual(reads(baseline, ygo.setCode))
    expect(searchCards(db, 'Pikachu')).toEqual([])
    expect(printingsByCode(db, PKM_CODE)).toEqual([])
    expect(getCardDetail(db, pkm.cardIds[0])).toBeNull()
    expect(cardsForImages(db, [pkm.cardIds[0]])).toEqual([])
    expect(matchName(db, 'Pikachu')?.cardId).not.toBe(pkm.cardIds[0])
  })

  it('an explicit ygo active game reads the same as none', () => {
    const none = reads(db, ygo.setCode)
    setGame(db, 'ygo')
    expect(reads(db, ygo.setCode)).toEqual(none)
  })

  it('with active_game = pkm, every read is Pokémon only', () => {
    setGame(db, 'pkm')
    const list = listEntries(db, ALL)
    expect(list.map((e) => [e.card.id, e.quantity])).toEqual([[pkm.cardIds[0], 3]])

    expect(getFacets(db).cardTypes).toEqual(['Pokémon'])
    expect(searchCards(db, 'dragon')).toEqual([])
    expect(searchCards(db, 'Pikachu').map((r) => r.id)).toEqual([pkm.cardIds[0]])

    const browse = browseCards(db, BROWSE)
    expect(browse.total).toBe(2)
    expect(browse.cards.map((c) => c.id).sort()).toEqual([...pkm.cardIds].sort())
    expect(browse.cards.find((c) => c.id === pkm.cardIds[0])?.owned).toBe(3)

    const facets = browseFacets(db)
    expect(facets.cardTypes).toEqual(['Pokémon'])
    expect(facets.setNames).toEqual([SHARED_SET_NAME])
    expect(facets.rarities).toEqual(['Normal', 'Reverse Holo'])

    const sets = listSets(db)
    expect(sets.map((s) => [s.language, s.setName, s.setCode, s.totalCards, s.ownedCards])).toEqual(
      [
        ['en', SHARED_SET_NAME, 'PAL', 1, 1],
        ['ja', 'クレイバースト', 'SV2D', 1, 0]
      ]
    )
    expect(sets[0].coverImageId).toBe(pkm.cardIds[0])
    expect(sets[0].packImageKey).toBeNull()

    const byCode = printingsByCode(db, PKM_CODE)
    expect(byCode.map((p) => p.printingId).sort()).toEqual(pkm.printingIds.slice(0, 2).sort())
    expect(byCode.every((p) => p.imageIds.length === 1 && p.imageIds[0] === pkm.cardIds[0])).toBe(
      true
    )
    expect(printingsByCode(db, ygo.setCode)).toEqual([])

    expect(getCardDetail(db, pkm.cardIds[0])?.printings).toHaveLength(2)
    expect(cardsForImages(db, [pkm.cardIds[0], ygo.imageId])).toEqual([
      { imageId: pkm.cardIds[0], cardId: pkm.cardIds[0] }
    ])
    expect(matchName(db, 'Pikachu')?.cardId).toBe(pkm.cardIds[0])
  })

  it('stats count only the active game', () => {
    expect(getStats(db).totalCards).toBe(2)
    setGame(db, 'pkm')
    const stats = getStats(db)
    expect(stats.totalCards).toBe(3)
    expect(stats.uniqueCards).toBe(1)
  })

  it('value snapshots are written and read per game', () => {
    const rows = db.prepare('SELECT game, total_cards FROM value_snapshots ORDER BY game').all()
    expect(rows).toEqual([
      { game: 'pkm', total_cards: 3 },
      { game: 'ygo', total_cards: 2 }
    ])
    expect(getStats(db).valueHistory.map((v) => v.totalCards)).toEqual([2])
    setGame(db, 'pkm')
    expect(getStats(db).valueHistory.map((v) => v.totalCards)).toEqual([3])
  })

  it('the same-named set lists once under each game and its checklist never mixes cards', () => {
    const ygoSets = listSets(db).filter((s) => s.setName === SHARED_SET_NAME && s.language === 'en')
    expect(ygoSets).toHaveLength(1)
    const ygoList = getChecklist(db, SHARED_SET_NAME, 'en')!
    expect(ygoList.cards.some((c) => pkm.cardIds.includes(c.cardId))).toBe(false)
    expect(ygoList.set.setCode).toBe(ygoSets[0].setCode)

    setGame(db, 'pkm')
    const pkmSets = listSets(db).filter((s) => s.setName === SHARED_SET_NAME && s.language === 'en')
    expect(pkmSets).toHaveLength(1)
    expect(pkmSets[0].setCode).toBe('PAL')
    const pkmList = getChecklist(db, SHARED_SET_NAME, 'en')!
    expect(pkmList.cards.map((c) => c.cardId)).toEqual([pkm.cardIds[0]])
    expect(pkmList.cards[0].rarities.map((r) => r.rarity)).toEqual(['Normal', 'Reverse Holo'])
    expect(pkmList.cards[0].owned).toBe(3)
  })

  it('an entry of another game cannot be added through the active one', () => {
    expect(() =>
      addEntry(db, { printingId: pkm.printingIds[0], imageId: pkm.cardIds[0], quantity: 1 }, now)
    ).toThrow()
  })

  it('Rip reads only Yu-Gi-Oh, whatever the active game', () => {
    const before = ripPool(db, SHARED_SET_NAME)
    expect(before).toEqual(ripPool(baseline, SHARED_SET_NAME))
    setGame(db, 'pkm')
    expect(ripPool(db, SHARED_SET_NAME)).toEqual(before)
  })

  it('the YGOPRODeck set refresh replaces only Yu-Gi-Oh sets', async () => {
    const ok = await refreshSets(db, {
      fetchDbVersion: async () => ({ databaseVersion: '1', lastUpdate: '2026-10-22' }),
      fetchCardInfo: async () => [],
      fetchCardSets: async () => [
        { set_name: 'Metal Raiders', set_code: 'MRD', num_of_cards: 1, tcg_date: '2002-06-26' }
      ]
    })
    expect(ok).toBe(true)
    const pkmSets = db
      .prepare("SELECT language, set_name FROM sets WHERE game = 'pkm' ORDER BY language")
      .all()
    expect(pkmSets).toEqual([
      { language: 'en', set_name: SHARED_SET_NAME },
      { language: 'ja', set_name: 'クレイバースト' }
    ])
  })

  it('a YGOPRODeck re-sync keeps every Pokémon row', async () => {
    const count = (): unknown =>
      db
        .prepare(
          `SELECT (SELECT count(*) FROM cards WHERE game = 'pkm') AS cards,
             (SELECT count(*) FROM card_images WHERE game = 'pkm') AS images,
             (SELECT count(*) FROM card_printings WHERE game = 'pkm') AS printings`
        )
        .get()
    const before = count()
    await runSync(
      db,
      {
        fetchDbVersion: async () => ({ databaseVersion: '2', lastUpdate: '2026-10-29' }),
        fetchCardInfo: async () =>
          (await import('../fixtures/cardinfo.sample.json')).default.data as never,
        fetchCardSets: async () => []
      },
      () => {},
      new Date('2026-10-30T12:00:00.000Z')
    )
    expect(count()).toEqual(before)
    expect(before).toEqual({ cards: 2, images: 2, printings: 4 })
  })
})
