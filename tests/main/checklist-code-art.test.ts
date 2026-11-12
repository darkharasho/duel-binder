import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { seededDb } from './helpers'
import { seedMagic } from '../fixtures/magic'
import { getChecklist, listSets, listSetsFast } from '../../src/main/repo/sets'
import { addEntry } from '../../src/main/repo/collection'
import type { SetSummary } from '../../src/shared/types'

const setGame = (db: Database.Database, game: string): void => {
  db.prepare("DELETE FROM meta WHERE key = 'active_game'").run()
  db.prepare("INSERT INTO meta (key, value) VALUES ('active_game', ?)").run(game)
}

// Like Gardenize in Reality Fracture: the Rare (M15 33) and a Mythic of other art (M15 34). The
// card's tile art is the first version by rarity label, the Mythic's; the Rare's tile must still
// show the Rare's own art, and the art the panel opens on.
describe("a set checklist's versions carry their own art", () => {
  let db: Database.Database
  let mtg: ReturnType<typeof seedMagic>

  beforeEach(async () => {
    db = await seededDb()
    mtg = seedMagic(db)
    const scryfall = db.prepare('SELECT scryfall_id FROM mtg_images WHERE image_id = ?')
    const set = db.prepare(
      'UPDATE card_printings SET set_rarity_code = ?, set_rarity = ? WHERE id = ?'
    )
    const code = (i: number): string =>
      (scryfall.get(mtg.imageIds[i]) as { scryfall_id: string }).scryfall_id
    set.run(code(0), 'Rare', mtg.printingIds[0])
    set.run(code(0), 'Rare (Foil)', mtg.printingIds[1])
    set.run(code(1), 'Mythic', mtg.printingIds[2])
    setGame(db, 'mtg')
  })

  it("gives each Magic version its own art, apart from the card's", () => {
    const card = getChecklist(db, 'Magic 2015', 'en')!.cards[0]
    expect(card.imageId).toBe(mtg.imageIds[1])
    const art = Object.fromEntries(
      card.rarities.flatMap((r) => r.codes.map((c) => [`${r.rarity} ${c.setCode}`, c.imageId]))
    )
    expect(art).toEqual({
      'Mythic M15 34': mtg.imageIds[1],
      'Rare M15 33': mtg.imageIds[0],
      'Rare (Foil) M15 33': mtg.imageIds[0]
    })
  })

  it('leaves a version without art of its own to the card art', () => {
    db.prepare("UPDATE card_printings SET set_rarity_code = '' WHERE id = ?").run(
      mtg.printingIds[0]
    )
    const rare = getChecklist(db, 'Magic 2015', 'en')!.cards[0].rarities.find(
      (r) => r.rarity === 'Rare'
    )!
    expect(rare.codes[0]).not.toHaveProperty('imageId')
  })
})

// Like Darklight Phoenix in Reality Fracture: FRA 444 ($10.82) and FRA 453 ($365.93) are both
// "Mythic (Foil)". One tile for both showed FRA 444's art at FRA 453's price; each version is
// its own entry, priced, numbered and counted on its own.
describe("a Magic set's versions of one rarity", () => {
  let db: Database.Database
  let mtg: ReturnType<typeof seedMagic>

  beforeEach(async () => {
    db = await seededDb()
    mtg = seedMagic(db)
    const set = db.prepare(
      'UPDATE card_printings SET set_rarity = ?, market_price = ? WHERE id = ?'
    )
    set.run('Mythic (Foil)', 10.82, mtg.printingIds[0])
    set.run('Rare', 1.5, mtg.printingIds[1])
    set.run('Mythic (Foil)', 365.93, mtg.printingIds[2])
    setGame(db, 'mtg')
  })

  it('are separate entries with their own price and number', () => {
    const card = getChecklist(db, 'Magic 2015', 'en')!.cards[0]
    expect(
      card.rarities.map((r) => ({
        rarity: r.rarity,
        key: r.key,
        label: r.numberLabel,
        price: r.price,
        codes: r.codes.map((c) => c.setCode)
      }))
    ).toEqual([
      {
        rarity: 'Mythic (Foil)',
        key: 'Mythic (Foil)|M15 33',
        label: '33',
        price: 10.82,
        codes: ['M15 33']
      },
      {
        rarity: 'Mythic (Foil)',
        key: 'Mythic (Foil)|M15 34',
        label: '34',
        price: 365.93,
        codes: ['M15 34']
      },
      { rarity: 'Rare', key: 'Rare|M15 33', label: '33', price: 1.5, codes: ['M15 33'] }
    ])
  })

  it('count one by one in the set totals, owned or not', () => {
    addEntry(db, { printingId: mtg.printingIds[0], imageId: mtg.imageIds[0], quantity: 1 })
    const listed = (fn: typeof listSets): SetSummary =>
      fn(db).find((s) => s.setName === 'Magic 2015')!
    for (const s of [
      getChecklist(db, 'Magic 2015', 'en')!.set,
      listed(listSets),
      listed(listSetsFast)
    ])
      expect({ total: s.totalRarities, owned: s.ownedRarities }).toEqual({ total: 3, owned: 1 })
  })
})
