import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { runSync } from '../../src/main/sync/sync'
import { addEntry, CollectionError } from '../../src/main/repo/collection'
import { adjustPrinting, getChecklist, listSets } from '../../src/main/repo/sets'
import type { ApiCardSet, YgoClient } from '../../src/main/ygo/client'
import type { ApiCard } from '../../src/main/ygo/mapCard'
import type { ChecklistCard, ChecklistRarity, EntryView } from '../../src/shared/types'

const SETS = [
  {
    set_name: 'Metal Raiders',
    set_code: 'MRD',
    num_of_cards: 432,
    tcg_date: '2002-06-26',
    set_image: 'https://images.ygoprodeck.com/images/sets/MRD.jpg'
  }
] as ApiCardSet[]

const MRD = 'Metal Raiders'
const base = { type: 'Normal Monster', frameType: 'normal', race: 'Dragon', desc: '' }
const s = (
  set_code: string,
  set_rarity: string,
  set_name = MRD
): { set_name: string; set_code: string; set_rarity: string } => ({
  set_name,
  set_code,
  set_rarity
})

const ALPHA: ApiCard = {
  ...base,
  id: 1001,
  name: 'Alpha Dragon',
  card_images: [{ id: 1001 }, { id: 1002 }],
  card_sets: [
    s('MRD-001', 'Ultra Rare'),
    s('MRD-E001', 'Ultra Rare'),
    s('MRD-EN001', 'Ultra Rare'),
    s('MRD-001', 'Secret Rare')
  ]
}
const BETA: ApiCard = {
  ...base,
  id: 2001,
  name: 'Beta Knight',
  card_images: [{ id: 2001 }],
  card_sets: [s('MRD-002', 'Common'), s('SDY-002', 'Common', 'Starter Deck')]
}
const GAMMA: ApiCard = {
  ...base,
  id: 3001,
  name: 'Gamma Trap',
  card_images: [{ id: 3001 }],
  card_sets: [s('MRD-E010', 'Rare'), s('MRD-EN010', 'Rare')]
}

const client = (cards: ApiCard[]): YgoClient => ({
  fetchDbVersion: async () => ({ databaseVersion: '1', lastUpdate: '' }),
  fetchCardInfo: async () => cards,
  fetchCardSets: async () => SETS
})

async function setup(): Promise<Database.Database> {
  const db = openDatabase(':memory:')
  await runSync(db, client([ALPHA, BETA, GAMMA]), () => {}, new Date('2026-10-23T12:00:00.000Z'))
  return db
}

const pid = (db: Database.Database, setCode: string, rarity: string): number =>
  (
    db
      .prepare('SELECT id FROM card_printings WHERE set_code = ? AND set_rarity = ?')
      .get(setCode, rarity) as {
      id: number
    }
  ).id

const own = (
  db: Database.Database,
  setCode: string,
  rarity: string,
  imageId: number,
  quantity: number
): EntryView => addEntry(db, { printingId: pid(db, setCode, rarity), imageId, quantity })

const entries = (db: Database.Database): unknown[] =>
  db.prepare('SELECT image_id AS imageId, quantity FROM collection_entries ORDER BY id').all()

const ur = (card: ChecklistCard): ChecklistRarity =>
  card.rarities.find((r) => r.rarity === 'Ultra Rare')!

describe('listSets', () => {
  it('summarises each set with an empty collection', async () => {
    const db = await setup()
    const sets = listSets(db)
    expect(sets).toHaveLength(2)
    expect(sets).toContainEqual({
      setName: 'Metal Raiders',
      setCode: 'MRD',
      tcgDate: '2002-06-26',
      imageKey: 'MRD',
      totalCards: 3,
      ownedCards: 0,
      totalRarities: 4,
      ownedRarities: 0
    })
    expect(sets).toContainEqual({
      setName: 'Starter Deck',
      setCode: 'SDY',
      tcgDate: null,
      imageKey: null,
      totalCards: 1,
      ownedCards: 0,
      totalRarities: 1,
      ownedRarities: 0
    })
  })

  it('counts ownership only through printings of that set', async () => {
    const db = await setup()
    own(db, 'MRD-E001', 'Ultra Rare', 1001, 2)
    own(db, 'SDY-002', 'Common', 2001, 1)
    const sets = listSets(db)
    const mrd = sets.find((x) => x.setName === MRD)!
    const sdy = sets.find((x) => x.setName === 'Starter Deck')!
    expect(mrd).toMatchObject({ ownedCards: 1, ownedRarities: 1 })
    expect(sdy).toMatchObject({ ownedCards: 1, ownedRarities: 1 })
  })
})

describe('getChecklist', () => {
  it('orders cards and fills fields', async () => {
    const db = await setup()
    own(db, 'MRD-E001', 'Ultra Rare', 1001, 2)
    const list = getChecklist(db, MRD)!
    expect(list.set.setName).toBe(MRD)
    expect(list.cards.map((c) => c.cardId)).toEqual([1001, 2001, 3001])
    expect(list.cards.map((c) => c.numberLabel)).toEqual(['001', '002', '010'])
    const [alpha, , gamma] = list.cards
    expect(alpha.imageId).toBe(1001)
    expect(alpha.owned).toBe(2)
    expect(alpha.entryId).not.toBeNull()
    expect(alpha.rarities.map((r) => r.rarity)).toEqual(['Secret Rare', 'Ultra Rare'])
    const u = ur(alpha)
    expect(u.codes.map((c) => c.setCode)).toEqual(['MRD-001', 'MRD-E001', 'MRD-EN001'])
    expect(u.codes.map((c) => c.owned)).toEqual([0, 2, 0])
    expect(u.owned).toBe(2)
    expect(u.defaultPrintingId).toBe(pid(db, 'MRD-E001', 'Ultra Rare'))
    expect(u.entryId).not.toBeNull()
    expect(gamma.rarities[0].defaultPrintingId).toBe(pid(db, 'MRD-EN010', 'Rare'))
    expect(gamma.entryId).toBeNull()
  })

  it('returns null for an unknown set', async () => {
    const db = await setup()
    expect(getChecklist(db, 'Nope')).toBeNull()
  })

  it('still counts printings missing from the API', async () => {
    const db = await setup()
    own(db, 'MRD-001', 'Ultra Rare', 1001, 1)
    own(db, 'MRD-EN010', 'Rare', 3001, 1)
    await runSync(db, client([ALPHA, BETA, { ...GAMMA, card_sets: [] }]), () => {})
    const flagged = db
      .prepare('SELECT missing_from_api AS m FROM card_printings WHERE set_code = ?')
      .get('MRD-EN010')
    expect(flagged).toEqual({ m: 1 })
    const mrd = listSets(db).find((x) => x.setName === MRD)!
    expect(mrd).toMatchObject({ totalCards: 3, ownedCards: 2 })
    const gamma = getChecklist(db, MRD)!.cards.find((c) => c.cardId === 3001)!
    expect(gamma.owned).toBe(1)
  })
})

describe('adjustPrinting', () => {
  it('adds original art and removes original art first', async () => {
    const db = await setup()
    const id = pid(db, 'MRD-001', 'Ultra Rare')
    let t = Date.parse('2026-10-23T13:00:00.000Z')
    const next = (): Date => new Date((t += 1000))

    adjustPrinting(db, MRD, id, 1, next())
    const card = adjustPrinting(db, MRD, id, 1, next())
    expect(entries(db)).toEqual([{ imageId: 1001, quantity: 2 }])
    expect(card.cardId).toBe(1001)
    expect(ur(card).owned).toBe(2)

    addEntry(db, { printingId: id, imageId: 1002, quantity: 1 }, next())
    adjustPrinting(db, MRD, id, -1, next())
    expect(entries(db)).toEqual([
      { imageId: 1001, quantity: 1 },
      { imageId: 1002, quantity: 1 }
    ])
    adjustPrinting(db, MRD, id, -1, next())
    expect(entries(db)).toEqual([{ imageId: 1002, quantity: 1 }])
    adjustPrinting(db, MRD, id, -1, next())
    expect(entries(db)).toEqual([])
    const after = adjustPrinting(db, MRD, id, -1, next())
    expect(entries(db)).toEqual([])
    expect(ur(after).owned).toBe(0)
  })

  it('decrementing sets updated_at', async () => {
    const db = await setup()
    const id = pid(db, 'MRD-001', 'Ultra Rare')
    addEntry(
      db,
      { printingId: id, imageId: 1001, quantity: 2 },
      new Date('2026-10-23T13:00:00.000Z')
    )
    adjustPrinting(db, MRD, id, -1, new Date('2026-10-24T09:00:00.000Z'))
    expect(db.prepare('SELECT quantity, updated_at AS u FROM collection_entries').get()).toEqual({
      quantity: 1,
      u: '2026-10-24T09:00:00.000Z'
    })
  })

  it('rejects a printing from another set', async () => {
    const db = await setup()
    expect(() => adjustPrinting(db, 'Starter Deck', pid(db, 'MRD-001', 'Ultra Rare'), 1)).toThrow(
      CollectionError
    )
    expect(() => adjustPrinting(db, MRD, 999999, 1)).toThrow(CollectionError)
    expect(entries(db)).toEqual([])
  })
})
