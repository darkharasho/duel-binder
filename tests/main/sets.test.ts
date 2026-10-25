import { describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/database'
import { runSync } from '../../src/main/sync/sync'
import { addEntry, CollectionError } from '../../src/main/repo/collection'
import { adjustPrinting, findSetImageUrl, getChecklist, listSets } from '../../src/main/repo/sets'
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
  db.prepare('SELECT image_id AS imageId, quantity FROM collection_entries WHERE deleted_at IS NULL ORDER BY id').all()

const ur = (card: ChecklistCard): ChecklistRarity =>
  card.rarities.find((r) => r.rarity === 'Ultra Rare')!

describe('listSets', () => {
  it('summarises each set with an empty collection', async () => {
    const db = await setup()
    const sets = listSets(db)
    expect(sets).toHaveLength(2)
    expect(sets).toContainEqual({
      language: 'en',
      listRows: null,
      unmatchedRows: null,
      setName: 'Metal Raiders',
      setCode: 'MRD',
      tcgDate: '2002-06-26',
      imageKey: 'MRD',
      packImageKey: null,
      logoImageKey: null,
      coverImageId: 1001, // Alpha Dragon: the set's only Secret Rare
      totalCards: 3,
      ownedCards: 0,
      totalRarities: 4,
      ownedRarities: 0
    })
    expect(sets).toContainEqual({
      language: 'en',
      listRows: null,
      unmatchedRows: null,
      setName: 'Starter Deck',
      setCode: 'SDY',
      tcgDate: null,
      imageKey: null,
      packImageKey: null,
      logoImageKey: null,
      coverImageId: 2001,
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
    const list = getChecklist(db, MRD, 'en')!
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

  it('gives each card its stats and dearest printing price in the set', async () => {
    const db = await setup()
    db.prepare("UPDATE cards SET atk = 3000, def = 2500, level = 8, tcgplayer_price = 99 WHERE id = 1001").run()
    db.prepare("UPDATE cards SET linkval = 3, level = NULL, tcgplayer_price = 5 WHERE id = 2001").run()
    db.prepare('UPDATE card_printings SET set_price = NULL').run()
    db.prepare("UPDATE card_printings SET set_price = 12 WHERE set_code = 'MRD-E001'").run()
    db.prepare("UPDATE card_printings SET set_price = 40 WHERE set_code = 'MRD-001' AND set_rarity = 'Secret Rare'").run()
    const [alpha, beta] = getChecklist(db, MRD, 'en')!.cards
    expect(alpha).toMatchObject({ atk: 3000, def: 2500, level: 8, price: 40 })
    expect(alpha.rarities.map((r) => r.price)).toEqual([40, 12])
    // No printing price in the set: falls back to the card's price; link rating counts as level.
    expect(beta).toMatchObject({ level: 3, price: 5 })
    expect(beta.rarities[0].price).toBeNull()
  })

  it('returns null for an unknown set', async () => {
    const db = await setup()
    expect(getChecklist(db, 'Nope', 'en')).toBeNull()
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
    const gamma = getChecklist(db, MRD, 'en')!.cards.find((c) => c.cardId === 3001)!
    expect(gamma.owned).toBe(1)
  })
})

describe('adjustPrinting', () => {
  it('adds original art and removes original art first', async () => {
    const db = await setup()
    const id = pid(db, 'MRD-001', 'Ultra Rare')
    let t = Date.parse('2026-10-23T13:00:00.000Z')
    const next = (): Date => new Date((t += 1000))

    adjustPrinting(db, MRD, 'en', id, 1, next())
    const card = adjustPrinting(db, MRD, 'en', id, 1, next())
    expect(entries(db)).toEqual([{ imageId: 1001, quantity: 2 }])
    expect(card.cardId).toBe(1001)
    expect(ur(card).owned).toBe(2)

    addEntry(db, { printingId: id, imageId: 1002, quantity: 1 }, next())
    adjustPrinting(db, MRD, 'en', id, -1, next())
    expect(entries(db)).toEqual([
      { imageId: 1001, quantity: 1 },
      { imageId: 1002, quantity: 1 }
    ])
    adjustPrinting(db, MRD, 'en', id, -1, next())
    expect(entries(db)).toEqual([{ imageId: 1002, quantity: 1 }])
    adjustPrinting(db, MRD, 'en', id, -1, next())
    expect(entries(db)).toEqual([])
    const after = adjustPrinting(db, MRD, 'en', id, -1, next())
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
    adjustPrinting(db, MRD, 'en', id, -1, new Date('2026-10-24T09:00:00.000Z'))
    expect(db.prepare('SELECT quantity, updated_at AS u FROM collection_entries').get()).toEqual({
      quantity: 1,
      u: '2026-10-24T09:00:00.000Z'
    })
  })

  it('rejects a printing from another set', async () => {
    const db = await setup()
    expect(() => adjustPrinting(db, 'Starter Deck', 'en', pid(db, 'MRD-001', 'Ultra Rare'), 1)).toThrow(
      CollectionError
    )
    expect(() => adjustPrinting(db, MRD, 'en', 999999, 1)).toThrow(CollectionError)
    expect(entries(db)).toEqual([])
  })
})

describe('language-aware sets', () => {
  /** The English fixture plus a Japanese Metal Raiders: Alpha (Ultra, Secret) and Beta (Common). */
  async function withJapanese(): Promise<{ db: Database.Database; jaUltra: number }> {
    const db = await setup()
    db.prepare(
      `INSERT INTO sets (language, set_name, set_code, tcg_date, image_url, list_rows, unmatched_rows)
       VALUES ('ja', ?, '', NULL, NULL, 9, 2)`
    ).run(MRD)
    const ins = db.prepare(
      `INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity, set_rarity_code,
         set_price, missing_from_api) VALUES (?, 'ja', ?, '', ?, '', NULL, 0)`
    )
    const jaUltra = Number(ins.run(1001, MRD, 'Ultra Rare').lastInsertRowid)
    ins.run(1001, MRD, 'Secret Rare')
    ins.run(2001, MRD, 'Common')
    return { db, jaUltra }
  }

  it('lists the Japanese and English LOB separately', async () => {
    const { db } = await withJapanese()
    const mrd = listSets(db).filter((x) => x.setName === MRD)
    expect(mrd.map((x) => x.language)).toEqual(['en', 'ja'])
    expect(mrd[0]).toMatchObject({ totalCards: 3, totalRarities: 4, setCode: 'MRD' })
    expect(mrd[1]).toMatchObject({ totalCards: 2, totalRarities: 3, tcgDate: null })
  })

  it('owning the Japanese copy fills only the Japanese set', async () => {
    const { db, jaUltra } = await withJapanese()
    addEntry(db, { printingId: jaUltra, imageId: 1001, quantity: 1 })
    const mrd = listSets(db).filter((x) => x.setName === MRD)
    expect(mrd[0]).toMatchObject({ language: 'en', ownedCards: 0, ownedRarities: 0 })
    expect(mrd[1]).toMatchObject({ language: 'ja', ownedCards: 1, ownedRarities: 1 })
  })

  it('summary carries listRows and unmatchedRows, null for English', async () => {
    const { db } = await withJapanese()
    const [en, ja] = listSets(db).filter((x) => x.setName === MRD)
    expect(en).toMatchObject({ listRows: null, unmatchedRows: null })
    expect(ja).toMatchObject({ listRows: 9, unmatchedRows: 2 })
  })

  it('getChecklist returns only that language', async () => {
    const { db, jaUltra } = await withJapanese()
    const ja = getChecklist(db, MRD, 'ja')!
    expect(ja.set.language).toBe('ja')
    expect(ja.cards.map((c) => c.cardId)).toEqual([1001, 2001])
    const ids = ja.cards.flatMap((c) => c.rarities.flatMap((r) => r.codes.map((x) => x.printingId)))
    expect(ids).toHaveLength(3)
    expect(ids).toContain(jaUltra)
    const en = getChecklist(db, MRD, 'en')!
    expect(en.cards.map((c) => c.cardId)).toEqual([1001, 2001, 3001])
    expect(getChecklist(db, 'Starter Deck', 'ja')).toBeNull()
  })

  it('adjustPrinting refuses a printing from the other language', async () => {
    const { db, jaUltra } = await withJapanese()
    expect(() => adjustPrinting(db, MRD, 'en', jaUltra, 1)).toThrow(CollectionError)
    expect(() => adjustPrinting(db, MRD, 'ja', pid(db, 'MRD-001', 'Ultra Rare'), 1)).toThrow(
      CollectionError
    )
    expect(entries(db)).toEqual([])
    expect(ur(adjustPrinting(db, MRD, 'ja', jaUltra, 1)).owned).toBe(1)
  })
})

describe('findSetImageUrl', () => {
  it('finds Yugipedia set images and official pack renders by key', () => {
    const db = openDatabase(':memory:')
    db.prepare(
      "INSERT INTO sets (language, set_name, set_code, image_url, image_key) VALUES ('ja', 'X', 'XJ', 'https://ms.yugipedia.com/x.png', 'yp-1')"
    ).run()
    db.prepare(
      "INSERT INTO pack_art (set_name, image_url, image_key) VALUES ('Beyond the Brave', 'https://www.yugioh-card.com/en/wp-content/uploads/BETB.png', 'yc-1')"
    ).run()
    expect(findSetImageUrl(db, 'yp-1')).toBe('https://ms.yugipedia.com/x.png')
    expect(findSetImageUrl(db, 'yc-1')).toBe('https://www.yugioh-card.com/en/wp-content/uploads/BETB.png')
    expect(findSetImageUrl(db, 'yc-unknown')).toBeNull()
  })
})
