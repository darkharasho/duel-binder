import { describe, expect, it } from 'vitest'
import { addEntry, listEntries } from '../../src/main/repo/collection'
import { searchCards, getCardDetail } from '../../src/main/repo/cards'
import { browseCards, browseFacets } from '../../src/main/repo/browse'
import { getChecklist, listSets } from '../../src/main/repo/sets'
import { printingsByCode, printingsForSet } from '../../src/main/repo/scan'
import { seededDb } from './helpers'

const CODE = 'ZZZ-EN001'
const OTHER_SET = 'Contributed Only Set'
const LOB = 'Legend of Blue Eyes White Dragon'

describe('contributed printings', () => {
  it('contributed printings show only through entries', async () => {
    const db = await seededDb()
    const card = db
      .prepare("SELECT card_id AS cardId FROM card_printings WHERE set_code = 'LOB-EN005' AND language = 'en'")
      .get() as { cardId: number }
    const imageId = (
      db.prepare('SELECT image_id AS id FROM card_images WHERE card_id = ? ORDER BY sort_order LIMIT 1').get(card.cardId) as {
        id: number
      }
    ).id
    const checklistBefore = getChecklist(db, LOB, 'en')
    const setsBefore = listSets(db).map((s) => `${s.setName}|${s.language}|${s.totalCards}`)

    const add = db.prepare(
      `INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language, contributed)
       VALUES (?, ?, ?, ?, 'en', 1)`
    )
    const inOwnSet = Number(add.run(card.cardId, OTHER_SET, CODE, 'Zzz Rare').lastInsertRowid)
    const inRealSet = Number(add.run(card.cardId, LOB, 'ZZZ-EN002', 'Zzz Rare 2').lastInsertRowid)
    addEntry(db, { printingId: inOwnSet, imageId, quantity: 1 })

    // The card itself stays searchable by name, but no set code reaches it through the contributed printing.
    expect(searchCards(db, 'Dark Magician').some((r) => r.id === card.cardId)).toBe(true)
    expect(searchCards(db, 'ZZZ-EN')).toEqual([])
    expect(browseCards(db, { q: 'ZZZ-EN', sort: 'name', dir: 'asc' }).cards).toEqual([])
    expect(browseCards(db, { setNames: [OTHER_SET], sort: 'name', dir: 'asc' }).cards).toEqual([])
    expect(browseCards(db, { rarities: ['Zzz Rare'], sort: 'name', dir: 'asc' }).cards).toEqual([])

    const codes = getCardDetail(db, card.cardId)!.printings.map((p) => p.setCode)
    expect(codes).not.toContain(CODE)
    expect(codes).not.toContain('ZZZ-EN002')

    const facets = browseFacets(db)
    expect(facets.setNames).not.toContain(OTHER_SET)
    expect(facets.rarities).not.toContain('Zzz Rare')
    expect(facets.rarities).not.toContain('Zzz Rare 2')

    expect(listSets(db).some((s) => s.setName === OTHER_SET)).toBe(false)
    expect(listSets(db).map((s) => `${s.setName}|${s.language}|${s.totalCards}`)).toEqual(setsBefore)
    expect(getChecklist(db, OTHER_SET, 'en')).toBeNull()
    expect(getChecklist(db, LOB, 'en')).toEqual(checklistBefore)

    expect(printingsByCode(db, CODE)).toEqual([])
    expect(printingsByCode(db, 'ZZZ-EN002')).toEqual([])
    expect(printingsForSet(db, OTHER_SET, 'en')).toEqual([])
    expect(inRealSet).toBeGreaterThan(0)

    const entry = listEntries(db, { sort: 'name', dir: 'asc' }).find((e) => e.printing.id === inOwnSet)
    expect(entry?.printing.setName).toBe(OTHER_SET)
    expect(entry?.printing.setRarity).toBe('Zzz Rare')
  })
})
