import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { MIGRATIONS } from '../../src/main/db/schema'
import {
  getDeck,
  listDecks,
  markDeckSeen,
  removeDeck,
  resolveDeckLines,
  saveDeck
} from '../../src/main/repo/decks'
import { saveGraded } from '../../src/main/repo/graded'
import { CollectionError } from '../../src/main/repo/collection'
import { localScope } from '../../src/main/repo/scope'
import { userScope } from '../../workers/portal/src/scope'
import type { DeckDraft, DeckEntry, DeckVerdictMark } from '../../src/shared/decks/types'
import { acceptFriend, requestFriend } from '../../workers/portal/src/friends'
import { createCloudClient } from '../../src/main/cloud/client'
import type { DeckDetail, DeckList } from '../../src/shared/decks/types'
import { inProcessPortal, PORTAL } from './cloudHelpers'
import { seededDb } from './helpers'
import { addUser, seededServerDb } from '../portal/helpers'

const T1 = new Date('2026-11-22T10:00:00.000Z')
const T2 = new Date('2026-11-22T11:00:00.000Z')
const T3 = new Date('2026-11-22T12:00:00.000Z')
const DARK_MAGICIAN = 46986414
const POT_OF_GREED = 55144522
const FEATHER_DUSTER = 18144506

const draft = (patch: Partial<DeckDraft> = {}): DeckDraft => ({
  format: 'advanced',
  name: 'Spellcasters',
  notes: '',
  cover: null,
  private: false,
  cards: [{ section: 'main', card: DARK_MAGICIAN, qty: 3 }],
  ...patch
})

/** A ygo card with one image (its own id) and no printings. */
function addCard(db: Database.Database, id: number, name: string, frame = 'effect'): void {
  db.prepare(
    `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
     VALUES (?, 'ygo', ?, 'Effect Monster', ?, 'Spellcaster', '', '2026-11-22')`
  ).run(id, name, frame)
  db.prepare(
    "INSERT INTO card_images (image_id, game, card_id, sort_order) VALUES (?, 'ygo', ?, 0)"
  ).run(id, id)
  db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')")
}

/** A printing; English prices go in market_price, others in intl_prices (eBay). */
function addPrinting(
  db: Database.Database,
  card: number,
  language: string,
  code: string,
  price: number | null
): number {
  const id = Number(
    db
      .prepare(
        `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity, market_price)
         VALUES ('ygo', ?, ?, ?, ?, 'Common', ?)`
      )
      .run(card, language, `Set ${code}`, code, language === 'en' ? price : null).lastInsertRowid
  )
  if (language !== 'en' && price !== null)
    db.prepare(
      'INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, 3, ?)'
    ).run(id, price, T1.toISOString())
  return id
}

function addCopy(db: Database.Database, printingId: number, imageId: number, qty: number): void {
  db.prepare(
    `INSERT INTO collection_entries (uid, owner_id, game, printing_id, image_id, quantity, created_at, updated_at)
     VALUES (?, 0, 'ygo', ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), printingId, imageId, qty, T1.toISOString(), T1.toISOString())
}

const deckRow = (db: Database.Database, uid: string): Record<string, unknown> | undefined =>
  db.prepare('SELECT * FROM decks WHERE uid = ?').get(uid) as Record<string, unknown> | undefined

describe('decks repo', () => {
  let db: Database.Database

  beforeEach(async () => {
    db = await seededDb()
  })

  it('deckCards gives a pkm card its source id and lowest English code', () => {
    db.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
       VALUES (9001, 'pkm', 'Pikachu', 'Pokémon', '', '', '', '2026-11-22')`
    ).run()
    db.prepare(
      "INSERT INTO pokemon_cards (card_id, category, source_id) VALUES (9001, 'Pokemon', 'en/sv01-057')"
    ).run()
    for (const code of ['SVI 057/198', 'PAL 001/193'])
      db.prepare(
        `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
         VALUES ('pkm', 9001, 'en', ?, ?, 'Common')`
      ).run(`Set ${code}`, code)
    const pkm = localScope("'pkm'")
    const uid = saveDeck(
      db,
      draft({ format: 'standard', cards: [{ section: 'main', card: 9001, qty: 1 }] }),
      T1,
      pkm
    )
    expect(getDeck(db, uid, pkm)!.cardFacts[9001]).toMatchObject({
      sourceId: 'en/sv01-057',
      code: 'PAL 001/193'
    })
    const ygo = localScope("'ygo'")
    const y = saveDeck(db, draft(), T1, ygo)
    expect(getDeck(db, y, ygo)!.cardFacts[DARK_MAGICIAN]).toMatchObject({
      sourceId: null,
      code: null
    })
  })

  it('deckCards gives an op card its number, type, colours, cost and block', () => {
    const opCard = (id: number, block: number | null): void => {
      db.prepare(
        `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
         VALUES (?, 'op', 'Usopp', 'Character', 'op', '', '', '2026-11-22')`
      ).run(id)
      db.prepare(
        `INSERT INTO onepiece_cards (card_id, number, colors, card_type, cost, block_icon)
         VALUES (?, 'OP01-016', '["Red"]', 'Character', 2, ?)`
      ).run(id, block)
    }
    opCard(9101, 1)
    opCard(9102, null)
    const op = localScope("'op'")
    const uid = saveDeck(
      db,
      draft({
        format: 'standard',
        cards: [
          { section: 'main', card: 9101, qty: 1 },
          { section: 'main', card: 9102, qty: 1 }
        ]
      }),
      T1,
      op
    )
    const facts = getDeck(db, uid, op)!.cardFacts
    for (const id of [9101, 9102])
      expect(facts[id]).toMatchObject({
        opNumber: 'OP01-016',
        opCardType: 'Character',
        opColors: ['Red'],
        opCost: 2,
        opBlock: 1
      })
    db.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
       VALUES (9001, 'pkm', 'Pikachu', 'Pokémon', '', '', '', '2026-11-22')`
    ).run()
    const pkm = localScope("'pkm'")
    const p = saveDeck(
      db,
      draft({ format: 'standard', cards: [{ section: 'main', card: 9001, qty: 1 }] }),
      T1,
      pkm
    )
    expect(getDeck(db, p, pkm)!.cardFacts[9001]).toMatchObject({
      opNumber: null,
      opCardType: null,
      opColors: [],
      opCost: null,
      opBlock: null
    })
  })

  it('saves and reads back an op deck with a Leader entry', () => {
    const op = localScope("'op'")
    const cards: DeckEntry[] = [
      { section: 'leader', card: 9111, qty: 1 },
      { section: 'main', card: 9112, qty: 4 }
    ]
    const uid = saveDeck(db, draft({ format: 'standard', cards }), T1, op)
    expect(getDeck(db, uid, op)!.cards).toEqual(cards)
  })

  it('migration 53 is desktop-only', () => {
    expect(MIGRATIONS.find((m) => m.version === 53)).toMatchObject({ server: false })
  })

  it('saves, lists newest first, and reads a deck back with card facts', () => {
    const cards: DeckEntry[] = [
      { section: 'main', card: DARK_MAGICIAN, qty: 3 },
      { section: 'main', card: POT_OF_GREED, qty: 1 },
      { section: 'side', card: FEATHER_DUSTER, qty: 2 }
    ]
    const first = saveDeck(db, draft({ name: 'First' }), T1)
    const second = saveDeck(db, draft({ name: ' Second ', cards, cover: POT_OF_GREED }), T2)
    const list = listDecks(db)
    expect(list.decks.map((d) => d.uid)).toEqual([second, first])
    expect(list.decks[0]).toMatchObject({
      name: 'Second',
      game: 'ygo',
      format: 'advanced',
      private: false,
      coverImageId: POT_OF_GREED,
      cards,
      createdAt: T2.toISOString(),
      updatedAt: T2.toISOString(),
      lastSeen: null
    })
    // No cover picked: the first Main card's art.
    expect(list.decks[1].coverImageId).toBe(DARK_MAGICIAN)
    expect(Object.keys(list.cardFacts).map(Number).sort()).toEqual(
      [FEATHER_DUSTER, DARK_MAGICIAN, POT_OF_GREED].sort()
    )

    const deck = getDeck(db, second)!
    expect(deck.cards).toEqual(cards)
    expect(deck.cover).toBe(POT_OF_GREED)
    expect(deck.notes).toBe('')
    expect(deck.cardFacts[DARK_MAGICIAN]).toMatchObject({
      id: DARK_MAGICIAN,
      name: 'Dark Magician',
      frameType: 'normal',
      imageId: DARK_MAGICIAN,
      owned: 0
    })
    expect(deck.cardFacts[POT_OF_GREED]).toMatchObject({ name: 'Pot of Greed', frameType: 'spell' })
    expect(getDeck(db, 'nope')).toBeNull()

    expect(saveDeck(db, { ...draft({ name: 'First, edited' }), uid: first }, T3)).toBe(first)
    expect(listDecks(db).decks.map((d) => d.name)).toEqual(['First, edited', 'Second'])
  })

  it('the tile art falls back to the first Main card when no cover is picked or it left', () => {
    const cards: DeckEntry[] = [
      { section: 'side', card: FEATHER_DUSTER, qty: 1 },
      { section: 'main', card: 999999, qty: 1 },
      { section: 'main', card: POT_OF_GREED, qty: 1 }
    ]
    const none = saveDeck(db, draft({ cards }), T1)
    const gone = saveDeck(db, draft({ cards, cover: DARK_MAGICIAN }), T2)
    const sideOnly = saveDeck(
      db,
      draft({ cards: [{ section: 'side', card: FEATHER_DUSTER, qty: 1 }] }),
      T3
    )
    const empty = saveDeck(db, draft({ cards: [] }), T3)
    const cover = (uid: string): number | null =>
      listDecks(db).decks.find((d) => d.uid === uid)!.coverImageId
    expect(cover(none)).toBe(POT_OF_GREED)
    expect(cover(gone)).toBe(POT_OF_GREED)
    expect(getDeck(db, gone)!.coverImageId).toBe(POT_OF_GREED)
    expect(cover(sideOnly)).toBe(FEATHER_DUSTER)
    expect(cover(empty)).toBeNull()
  })

  it('maps pinned printings to their art', () => {
    const pkey = (
      db
        .prepare('SELECT pkey FROM card_printings WHERE card_id = ? AND pkey IS NOT NULL LIMIT 1')
        .get(DARK_MAGICIAN) as { pkey: string }
    ).pkey
    const uid = saveDeck(
      db,
      draft({ cards: [{ section: 'main', card: DARK_MAGICIAN, printing: pkey, qty: 1 }] })
    )
    expect(getDeck(db, uid)!.printingArt).toEqual({ [pkey]: DARK_MAGICIAN })
  })

  it('owned counts any printing, any language, and slabs', () => {
    addCard(db, 900001, 'Owned Card')
    const en = addPrinting(db, 900001, 'en', 'TST-EN001', 1)
    const ja = addPrinting(db, 900001, 'ja', 'TST-JP001', 1)
    addCopy(db, en, 900001, 1)
    addCopy(db, ja, 900001, 1)
    saveGraded(db, {
      printingId: en,
      company: 'PSA',
      grade: '10',
      label: '',
      cert: '',
      subgrades: '',
      value: null,
      paid: null,
      notes: ''
    })
    const uid = saveDeck(db, draft({ cards: [{ section: 'main', card: 900001, qty: 3 }] }))
    expect(getDeck(db, uid)!.cardFacts[900001].owned).toBe(3)
    expect(listDecks(db).cardFacts[900001].owned).toBe(3)
  })

  it('cost prices', () => {
    addCard(db, 900001, 'Both Regions')
    addPrinting(db, 900001, 'en', 'TST-EN001', 2)
    addPrinting(db, 900001, 'en', 'TST-EN002', 0.5)
    addPrinting(db, 900001, 'ja', 'TST-JP001', 0.3)
    addCard(db, 900002, 'Asia Only')
    addPrinting(db, 900002, 'ja', 'TST-JP002', 0.8)
    addPrinting(db, 900002, 'ko', 'TST-KR002', 0.4)
    addCard(db, 900003, 'Unpriced')
    addPrinting(db, 900003, 'en', 'TST-EN003', null)
    addPrinting(db, 900003, 'en', 'TST-EN004', 0)
    addCard(db, 900004, 'English Only')
    addPrinting(db, 900004, 'en', 'TST-EN005', 1.25)
    const uid = saveDeck(
      db,
      draft({
        cards: [900001, 900002, 900003, 900004].map((card) => ({
          section: 'main' as const,
          card,
          qty: 1
        }))
      })
    )
    const facts = getDeck(db, uid)!.cardFacts
    expect(facts[900001]).toMatchObject({ price: 0.5, regionPrice: 0.3 })
    expect(facts[900002]).toMatchObject({ price: 0.4, regionPrice: 0.4 })
    expect(facts[900003]).toMatchObject({ price: null, regionPrice: null })
    expect(facts[900004]).toMatchObject({ price: 1.25, regionPrice: 1.25 })
  })

  it('an entry for a card this catalog lacks is kept', () => {
    const cards: DeckEntry[] = [{ section: 'main', card: 99999999, qty: 1 }]
    const uid = saveDeck(db, draft({ cards }))
    const deck = getDeck(db, uid)!
    expect(deck.cards).toEqual(cards)
    expect(deck.cardFacts[99999999]).toBeUndefined()
    saveDeck(db, { ...draft({ cards: deck.cards, name: 'Again' }), uid }, T2)
    expect(getDeck(db, uid)!.cards).toEqual(cards)
  })

  it('rejects bad fields and a gone uid', () => {
    expect(() => saveDeck(db, draft({ name: '  ' }))).toThrow(CollectionError)
    expect(() => saveDeck(db, draft({ format: 'nope' }))).toThrow(/Unknown format/)
    expect(() => saveDeck(db, { ...draft(), uid: 'gone' })).toThrow(/gone/)
    expect(() => saveDeck(db, null)).toThrow(CollectionError)
    const uid = saveDeck(db, draft())
    removeDeck(db, uid)
    expect(() => saveDeck(db, { ...draft(), uid })).toThrow(/gone/)
  })

  it('200-deck cap per game', () => {
    const insert = db.prepare(
      `INSERT INTO decks (owner_id, uid, game, format, name, created_at, updated_at)
       VALUES (0, ?, 'ygo', 'advanced', ?, ?, ?)`
    )
    for (let i = 0; i < 200; i++)
      insert.run(`d${i}`, `Deck ${i}`, T1.toISOString(), T1.toISOString())
    expect(() => saveDeck(db, draft())).toThrow(
      'You have 200 decks in this game; remove one to add another'
    )
    expect(saveDeck(db, { ...draft({ name: 'Edited' }), uid: 'd7' }, T2)).toBe('d7')
    expect(getDeck(db, 'd7')!.name).toBe('Edited')
    removeDeck(db, 'd8')
    expect(saveDeck(db, draft())).toBeTruthy()
  })

  it('removing tombstones a signed-in deck and deletes an owner-0 one', () => {
    const local = saveDeck(db, draft(), T1)
    removeDeck(db, local, T2)
    expect(deckRow(db, local)).toBeUndefined()

    db.prepare("INSERT INTO meta (key, value) VALUES ('cloud_active_owner', '7')").run()
    const signedIn = saveDeck(db, draft(), T1)
    db.prepare('UPDATE decks SET dirty = 0').run()
    removeDeck(db, signedIn, T2)
    expect(deckRow(db, signedIn)).toMatchObject({
      owner_id: 7,
      deleted_at: T2.toISOString(),
      updated_at: T2.toISOString(),
      dirty: 1
    })
    expect(listDecks(db).decks).toEqual([])
    expect(getDeck(db, signedIn)).toBeNull()
    expect(() => removeDeck(db, 42)).toThrow(CollectionError)
  })

  it('markDeckSeen leaves the deck clean and its updated_at alone', () => {
    const uid = saveDeck(db, draft(), T1)
    db.prepare('UPDATE decks SET dirty = 0').run()
    const mark: DeckVerdictMark = {
      status: 'illegal',
      problems: ['Main Deck needs at least 40 cards'],
      packVersion: '2026-11-22.1'
    }
    markDeckSeen(db, uid, mark)
    expect(deckRow(db, uid)).toMatchObject({
      dirty: 0,
      updated_at: T1.toISOString(),
      last_pack_version: '2026-11-22.1'
    })
    expect(getDeck(db, uid)!.lastSeen).toEqual(mark)
    expect(listDecks(db).decks[0].lastSeen).toEqual(mark)

    expect(() => markDeckSeen(db, uid, { ...mark, status: 'great' })).toThrow(CollectionError)
    expect(() => markDeckSeen(db, uid, { ...mark, problems: [1] })).toThrow(CollectionError)
    expect(() =>
      markDeckSeen(db, uid, { ...mark, problems: Array.from({ length: 301 }, () => 'x') })
    ).toThrow(CollectionError)
    expect(() => markDeckSeen(db, uid, { ...mark, problems: ['x'.repeat(65)] })).toThrow(
      CollectionError
    )
    const most = { ...mark, problems: Array.from({ length: 300 }, (_, i) => `place:${i}:extra`) }
    markDeckSeen(db, uid, most)
    expect(getDeck(db, uid)!.lastSeen).toEqual(most)
    markDeckSeen(db, uid, mark)
    expect(() => markDeckSeen(db, uid, { ...mark, packVersion: 'x'.repeat(33) })).toThrow(
      CollectionError
    )

    db.prepare("UPDATE decks SET last_verdict = 'not json' WHERE uid = ?").run(uid)
    expect(getDeck(db, uid)!.lastSeen).toBeNull()
  })

  it('resolves passcodes, alternate art, set codes and names', () => {
    const DM = (
      db.prepare('SELECT name FROM cards WHERE id = ?').get(DARK_MAGICIAN) as { name: string }
    ).name
    db.prepare(
      "INSERT INTO card_images (image_id, game, card_id, sort_order) VALUES (36996508, 'ygo', ?, 5)"
    ).run(DARK_MAGICIAN)
    addCard(db, 900001, 'Maxx "C"')
    addCard(db, 900002, 'Ash Blossom & Joyous Spring')
    addCard(db, 900003, 'Twin Name')
    addCard(db, 900004, 'Twin Name')
    addPrinting(db, 900003, 'en', 'TWN-EN001', 1)
    addPrinting(db, 900004, 'en', 'TWN-EN001', 1)
    expect(
      resolveDeckLines(db, [
        { passcode: DARK_MAGICIAN },
        { passcode: 36996508 },
        { passcode: 12 },
        { setCode: 'lob-en005' },
        { setCode: 'TWN-EN001' },
        { setCode: 'NOPE-EN000' },
        { name: 'maxx “c”' },
        { name: 'ash blossom' },
        { name: '  ASH   Blossom & joyous spring ' },
        { name: 'Twin Name' },
        { name: '&&&' },
        { name: 'Dárk Magician' }
      ])
    ).toEqual([
      { status: 'matched', card: DARK_MAGICIAN, name: DM, frameType: 'normal' },
      { status: 'matched', card: DARK_MAGICIAN, name: DM, frameType: 'normal' },
      { status: 'unmatched' },
      { status: 'matched', card: DARK_MAGICIAN, name: DM, frameType: 'normal' },
      {
        status: 'ambiguous',
        options: [
          { card: 900003, name: 'Twin Name', frameType: 'effect', imageId: 900003 },
          { card: 900004, name: 'Twin Name', frameType: 'effect', imageId: 900004 }
        ]
      },
      { status: 'unmatched' },
      { status: 'matched', card: 900001, name: 'Maxx "C"', frameType: 'effect' },
      { status: 'unmatched' },
      { status: 'matched', card: 900002, name: 'Ash Blossom & Joyous Spring', frameType: 'effect' },
      {
        status: 'ambiguous',
        options: [
          { card: 900003, name: 'Twin Name', frameType: 'effect', imageId: 900003 },
          { card: 900004, name: 'Twin Name', frameType: 'effect', imageId: 900004 }
        ]
      },
      { status: 'unmatched' },
      { status: 'matched', card: DARK_MAGICIAN, name: DM, frameType: 'normal' }
    ])
    expect(() => resolveDeckLines(db, 'x')).toThrow(CollectionError)
    expect(() => resolveDeckLines(db, [{ bogus: 1 }])).toThrow(CollectionError)
    expect(() =>
      resolveDeckLines(
        db,
        Array.from({ length: 301 }, () => ({ passcode: 1 }))
      )
    ).toThrow(CollectionError)
  })
})

describe('pkm deck line resolution', () => {
  it('matches by set and number, falls back to name, and only sees English cards', async () => {
    const db = await seededDb()
    const pkm = localScope("'pkm'")
    const card = (id: number, name: string, lang: string, code: string): void => {
      db.prepare(
        `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
         VALUES (?, 'pkm', ?, 'Pokémon', '', '', '', '2026-11-22')`
      ).run(id, name)
      db.prepare(
        `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
         VALUES ('pkm', ?, ?, ?, ?, 'Common')`
      ).run(id, lang, `Set ${code}`, code)
    }
    card(9101, 'Pikachu ex', 'en', 'SVI 057/198')
    card(9102, 'Twin Mon', 'en', 'PAL 010/193')
    card(9103, 'Twin Mon', 'en', 'OBF 010/197')
    card(9104, 'Twin Mon', 'ja', 'SV1S 010/078')
    card(9105, 'Japan Only', 'ja', 'SV1S 011/078')
    db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')")
    const res = resolveDeckLines(
      db,
      [
        { set: 'SVI', number: '57', name: 'Pikachu ex' },
        { set: 'svi', number: '057', name: 'Whatever' },
        { set: 'ZZZ', number: '1', name: 'Pikachu ex' },
        { name: 'Twin Mon' },
        { name: 'Japan Only' },
        { set: 'PAL', number: '10', name: 'Twin Mon' }
      ],
      pkm
    )
    expect(res[0]).toMatchObject({ status: 'matched', card: 9101 })
    expect(res[1]).toMatchObject({ status: 'matched', card: 9101 })
    expect(res[2]).toMatchObject({ status: 'matched', card: 9101 })
    expect(res[3].status).toBe('ambiguous')
    expect((res[3] as { options: { card: number }[] }).options.map((o) => o.card)).toEqual([
      9102, 9103
    ])
    expect(res[4]).toEqual({ status: 'unmatched' })
    expect(res[5]).toMatchObject({ status: 'matched', card: 9102 })
  })
})

describe('pkm basic Energy resolution', () => {
  it('picks the SVE card for basic Energy lines', async () => {
    const db = await seededDb()
    const pkm = localScope("'pkm'")
    for (const [id, code] of [
      [9201, 'MEE 002/008'],
      [9202, 'SVE 002/24']
    ] as const) {
      db.prepare(
        `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
         VALUES (?, 'pkm', 'Fire Energy', 'Energy', '', '', '', '2026-11-22')`
      ).run(id)
      db.prepare(
        `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
         VALUES ('pkm', ?, 'en', 'Set', ?, 'Common')`
      ).run(id, code)
    }
    db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')")
    const res = resolveDeckLines(
      db,
      [{ set: 'SVE', number: '2', name: 'Fire Energy' }, { name: 'Fire Energy' }],
      pkm
    )
    expect(res[0]).toMatchObject({ status: 'matched', card: 9202 })
    expect(res[1]).toMatchObject({ status: 'matched', card: 9202 })
  })
})

describe('op deck line resolution', () => {
  it('matches a card number, English twin first, else falls back to the name', async () => {
    const db = await seededDb()
    const op = localScope("'op'")
    const card = (id: number, name: string, number: string, lang: string): void => {
      db.prepare(
        `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
         VALUES (?, 'op', ?, 'Character', 'op', '', '', '2026-11-22')`
      ).run(id, name)
      db.prepare(
        `INSERT INTO onepiece_cards (card_id, number, colors, card_type, cost)
         VALUES (?, ?, '["Red"]', 'Character', 2)`
      ).run(id, number)
      db.prepare(
        `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
         VALUES ('op', ?, ?, 'Set', ?, 'Common')`
      ).run(id, lang, number)
    }
    card(9301, 'Nami', 'OP01-016', 'ja')
    card(9302, 'Nami', 'OP01-016', 'en')
    card(9303, 'Nami', 'OP01-016', 'en')
    card(9304, 'Japan Only', 'OP14-001', 'ja')
    card(9305, 'Sabo', 'OP13-086', 'en')
    db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')")
    const res = resolveDeckLines(
      db,
      [
        { opNumber: 'OP01-016', name: '' },
        { opNumber: 'op01-016', name: 'Whatever' },
        { opNumber: 'OP14-001', name: '' },
        { opNumber: 'OP99-999', name: 'Sabo' },
        { opNumber: 'OP99-999', name: '' }
      ],
      op
    )
    expect(res[0]).toEqual({
      status: 'matched',
      card: 9302,
      name: 'Nami',
      frameType: 'op',
      opCardType: 'Character'
    })
    expect(res[1]).toMatchObject({ status: 'matched', card: 9302 })
    expect(res[2]).toMatchObject({ status: 'matched', card: 9304, name: 'Japan Only' })
    expect(res[3]).toMatchObject({ status: 'matched', card: 9305, name: 'Sabo' })
    expect(res[4]).toEqual({ status: 'unmatched' })
  })

  it('drops an art suffix (_p1) from the card number before matching', async () => {
    const db = await seededDb()
    const op = localScope("'op'")
    const card = (id: number, number: string, lang: string): void => {
      db.prepare(
        `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
         VALUES (?, 'op', 'Nami', 'Character', 'op', '', '', '2026-11-22')`
      ).run(id)
      db.prepare(
        `INSERT INTO onepiece_cards (card_id, number, colors, card_type, cost)
         VALUES (?, ?, '["Red"]', 'Character', 2)`
      ).run(id, number)
      db.prepare(
        `INSERT INTO card_printings (game, card_id, language, set_name, set_code, set_rarity)
         VALUES ('op', ?, ?, 'Set', ?, 'Common')`
      ).run(id, lang, number)
    }
    card(9311, 'OP01-016', 'ja')
    card(9312, 'OP01-016', 'en')
    card(9313, 'P-100', 'en')
    const res = resolveDeckLines(
      db,
      [
        { opNumber: 'OP01-016_p1', name: '' },
        { opNumber: 'OP01-016_P2', name: '' },
        { opNumber: 'P-100_P1', name: '' },
        // A name-less ref (an OPlay code line) passes the line checks.
        { opNumber: 'OP01-016' }
      ],
      op
    )
    expect(res.map((r) => (r.status === 'matched' ? r.card : null))).toEqual([
      9312, 9312, 9313, 9312
    ])
  })

  it('a resolved op Leader carries its card type, by number or by name', async () => {
    const db = await seededDb()
    const op = localScope("'op'")
    db.prepare(
      `INSERT INTO cards (id, game, name, type, frame_type, race, "desc", updated_at)
       VALUES (9401, 'op', 'Monkey.D.Luffy', 'Leader', 'op', '', '', '2026-11-22')`
    ).run()
    db.prepare(
      `INSERT INTO onepiece_cards (card_id, number, colors, card_type, cost)
       VALUES (9401, 'OP01-001', '["Red"]', 'Leader', NULL)`
    ).run()
    db.exec("INSERT INTO cards_fts(cards_fts) VALUES('rebuild')")
    const res = resolveDeckLines(
      db,
      [
        { opNumber: 'OP01-001', name: '' },
        { opNumber: 'OP99-001', name: 'Monkey.D.Luffy' }
      ],
      op
    )
    expect(res[0]).toEqual({
      status: 'matched',
      card: 9401,
      name: 'Monkey.D.Luffy',
      frameType: 'op',
      opCardType: 'Leader'
    })
    expect(res[1]).toMatchObject({ status: 'matched', card: 9401, opCardType: 'Leader' })
  })

  it('leaves an op card number unmatched on another game', async () => {
    const db = await seededDb()
    expect(
      resolveDeckLines(db, [{ opNumber: 'OP01-016', name: 'Dark Magician' }], localScope("'ygo'"))
    ).toEqual([{ status: 'unmatched' }])
  })

  it('checks op card number lengths', async () => {
    const db = await seededDb()
    const op = localScope("'op'")
    expect(() => resolveDeckLines(db, [{ opNumber: 'X'.repeat(33), name: '' }], op)).toThrow(
      CollectionError
    )
    expect(() =>
      resolveDeckLines(db, [{ opNumber: 'OP01-001', name: 'n'.repeat(201) }], op)
    ).toThrow(CollectionError)
  })
})

describe('decks repo on the server', () => {
  it('saves, lists, marks and tombstones one user’s decks by seq', async () => {
    const db = await seededServerDb()
    const ann = addUser(db, 'd1', 'ann')
    const bob = addUser(db, 'd2', 'bob')
    const annYgo = userScope(ann, 'ygo')
    const a = saveDeck(db, draft({ name: 'Ann deck' }), T1, annYgo)
    const b = saveDeck(db, draft({ name: 'Bob deck' }), T1, userScope(bob, 'ygo'))
    expect(listDecks(db, annYgo).decks.map((d) => d.uid)).toEqual([a])
    expect(getDeck(db, b, annYgo)).toBeNull()
    expect(getDeck(db, a, annYgo)!.cardFacts[DARK_MAGICIAN].name).toBe('Dark Magician')
    expect(listDecks(db, userScope(ann, 'pkm')).decks).toEqual([])
    const seqOf = (uid: string): number =>
      (db.prepare('SELECT seq FROM decks WHERE uid = ?').get(uid) as { seq: number }).seq
    const before = seqOf(a)
    markDeckSeen(db, a, { status: 'legal', problems: [], packVersion: 'v1' }, annYgo)
    expect(seqOf(a)).toBe(before)
    removeDeck(db, a, T2, annYgo)
    expect(seqOf(a)).toBeGreaterThan(seqOf(b))
    expect(listDecks(db, annYgo).decks).toEqual([])
  })
})

describe('deck channels on the portal', () => {
  const clientFor = async (
    portal: Awaited<ReturnType<typeof inProcessPortal>>,
    userId: number
  ): Promise<ReturnType<typeof createCloudClient>> =>
    createCloudClient({
      baseUrl: PORTAL,
      token: await portal.desktopToken(userId),
      fetch: portal.fetch
    })

  it('the web (server scope) saves and removes decks', async () => {
    const portal = await inProcessPortal()
    const user = portal.addUser('owner')
    const client = await clientFor(portal, user)
    const uid = await client.rpc<string>('decks:save', [draft()], 'ygo')
    const list = await client.rpc<DeckList>('decks:list', [], 'ygo')
    expect(list.decks.map((d) => d.uid)).toEqual([uid])
    expect((await client.rpc<DeckDetail | null>('decks:get', [uid], 'ygo'))!.name).toBe(
      'Spellcasters'
    )
    await client.rpc(
      'decks:markSeen',
      [uid, { status: 'legal', problems: [], packVersion: 'v1' }],
      'ygo'
    )
    await client.rpc('decks:remove', [uid], 'ygo')
    expect((await client.rpc<DeckList>('decks:list', [], 'ygo')).decks).toEqual([])
  })

  it("friends see a friend's non-private decks without notes, with the friend's owned counts", async () => {
    const portal = await inProcessPortal()
    const user = portal.addUser('owner')
    const friend = portal.addUser('friend')
    const scope = userScope(user, 'ygo')
    const pub = saveDeck(portal.serverDb, draft({ notes: 'sideboard plan' }), T1, scope)
    const priv = saveDeck(
      portal.serverDb,
      draft({
        name: 'Secret',
        private: true,
        cards: [{ section: 'main', card: POT_OF_GREED, qty: 1 }]
      }),
      T1,
      scope
    )
    markDeckSeen(portal.serverDb, pub, { status: 'legal', problems: [], packVersion: 'v1' }, scope)
    const printing = portal.serverDb
      .prepare('SELECT id FROM card_printings WHERE card_id = ? LIMIT 1')
      .get(DARK_MAGICIAN) as { id: number }
    portal.serverDb
      .prepare(
        `INSERT INTO collection_entries (user_id, uid, printing_id, image_id, quantity, created_at, updated_at, server_seq)
         VALUES (?, 'c1', ?, ?, 2, ?, ?, 1)`
      )
      .run(user, printing.id, DARK_MAGICIAN, T1.toISOString(), T1.toISOString())
    const asFriend = await clientFor(portal, friend)
    await expect(asFriend.rpc('friends:decks', [user], 'ygo')).rejects.toThrow()
    await expect(asFriend.rpc('friends:deck', [user, pub], 'ygo')).rejects.toThrow()
    requestFriend(portal.serverDb, friend, 'owner', T1)
    acceptFriend(portal.serverDb, user, friend, T2)
    const list = await asFriend.rpc<DeckList>('friends:decks', [user], 'ygo')
    expect(list.decks.map((d) => d.uid)).toEqual([pub])
    expect(list.decks[0].lastSeen).toBeNull()
    expect(Object.keys(list.cardFacts).map(Number)).toEqual([DARK_MAGICIAN])
    const seen = await asFriend.rpc<DeckDetail | null>('friends:deck', [user, pub], 'ygo')
    expect(seen).toMatchObject({ uid: pub, notes: '', lastSeen: null })
    expect(seen!.cardFacts[DARK_MAGICIAN].owned).toBe(2)
    expect(await asFriend.rpc('friends:deck', [user, priv], 'ygo')).toBeNull()
    expect(await asFriend.rpc('friends:deck', [user, 'nope'], 'ygo')).toBeNull()
    expect((await asFriend.rpc<DeckList>('friends:decks', [user], 'pkm')).decks).toEqual([])
  })
})
