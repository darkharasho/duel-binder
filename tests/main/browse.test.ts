import { describe, expect, it } from 'vitest'
import { browseCards, browseFacets } from '../../src/main/repo/browse'
import { addEntry } from '../../src/main/repo/collection'
import { seededDb } from './helpers'

const names = (p: { cards: { name: string }[] }): string[] => p.cards.map((c) => c.name)

describe('browseCards', () => {
  it('lists every card, owned or not, sorted by name', async () => {
    const db = await seededDb()
    const page = browseCards(db, { sort: 'name', dir: 'asc' })
    expect(page.total).toBe(3)
    expect(names(page)).toEqual(['Dark Magician', "Harpie's Feather Duster", 'Pot of Greed'])
    expect(page.cards[0]).toMatchObject({ owned: 0, price: 7.5, atk: 2500, level: 7 })
    expect(page.cards[0].defaultPrintingId).not.toBeNull()
    expect(page.cards[1].defaultPrintingId).toBeNull()
  })

  it('searches names and set codes, and filters by type and set', async () => {
    const db = await seededDb()
    expect(names(browseCards(db, { q: 'pot', sort: 'name', dir: 'asc' }))).toEqual(['Pot of Greed'])
    expect(names(browseCards(db, { q: 'SDY', sort: 'name', dir: 'asc' }))).toEqual([
      'Dark Magician'
    ])
    expect(names(browseCards(db, { cardTypes: ['Spell Card'], sort: 'name', dir: 'asc' }))).toEqual(
      ["Harpie's Feather Duster", 'Pot of Greed']
    )
    expect(
      names(browseCards(db, { setNames: ['Starter Deck: Yugi'], sort: 'name', dir: 'asc' }))
    ).toEqual(['Dark Magician'])
  })

  it('sorts by price with unpriced cards last either way', async () => {
    const db = await seededDb()
    expect(names(browseCards(db, { sort: 'price', dir: 'desc' }))).toEqual([
      'Dark Magician',
      'Pot of Greed',
      "Harpie's Feather Duster"
    ])
    expect(names(browseCards(db, { sort: 'price', dir: 'asc' }))[2]).toBe("Harpie's Feather Duster")
  })

  it('splits owned from not owned and counts copies', async () => {
    const db = await seededDb()
    const dm = browseCards(db, { q: 'dark magician', sort: 'name', dir: 'asc' }).cards[0]
    addEntry(db, { printingId: dm.defaultPrintingId as number, imageId: dm.imageId, quantity: 2 })
    const owned = browseCards(db, { owned: 'owned', sort: 'name', dir: 'asc' })
    expect(owned.total).toBe(1)
    expect(owned.cards[0]).toMatchObject({ name: 'Dark Magician', owned: 2 })
    expect(browseCards(db, { owned: 'missing', sort: 'name', dir: 'asc' }).total).toBe(2)
  })

  it('pages with offset and limit', async () => {
    const db = await seededDb()
    const page = browseCards(db, { sort: 'name', dir: 'asc', offset: 1, limit: 1 })
    expect(page.total).toBe(3)
    expect(names(page)).toEqual(["Harpie's Feather Duster"])
  })
})

describe('browseFacets', () => {
  it('lists options from the whole database', async () => {
    const db = await seededDb()
    const f = browseFacets(db)
    expect(f.cardTypes).toEqual(['Normal Monster', 'Spell Card'])
    expect(f.races).toContain('Spellcaster')
    expect(f.setNames).toContain('Starter Deck: Yugi')
    expect(f.rarities).toEqual(['Rare', 'Ultra Rare'])
  })
})
