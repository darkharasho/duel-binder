import { describe, expect, it } from 'vitest'
import { migrate } from '../../src/main/db/database'
import {
  checkSessionCards,
  deleteScanSession,
  fillScanSessionPrices,
  mergeSessionCards,
  listScanSessions,
  recordScanSession,
  sessionCardsOf,
  setScanSessionHidden
} from '../../src/main/repo/scanSessions'
import {
  MAX_SESSION_CARDS,
  sessionTotal,
  type ScanSessionCard
} from '../../src/shared/scanSessions'
import { databaseAt, seededDb } from './helpers'

const card = (over: Partial<ScanSessionCard> = {}): ScanSessionCard => ({
  cardId: 1,
  pkey: 'en|1|ABC-001|Common',
  printingId: 1,
  imageId: 1,
  photoId: null,
  name: 'Test',
  setCode: 'ABC-001',
  rarity: 'Common',
  quantity: 1,
  price: 5,
  guess: false,
  addedAt: 1000,
  ...over
})

describe('scan sessions on the device', () => {
  it('records a session and lists it visible to friends', async () => {
    const db = await seededDb()
    recordScanSession(db, { uid: 'a', game: 'ygo', cards: [card()] })
    const list = listScanSessions(db, 'ygo')
    expect(list).toHaveLength(1)
    // This catalog has no such pkey: the card stays, with no printing of this device.
    expect(list[0]).toMatchObject({
      uid: 'a',
      game: 'ygo',
      friendsVisible: true,
      cards: [card({ printingId: null, photoId: null })]
    })
  })

  it('keeps one session when the same uid is recorded twice', async () => {
    const db = await seededDb()
    recordScanSession(db, { uid: 'a', game: 'ygo', cards: [card()] })
    recordScanSession(db, { uid: 'a', game: 'ygo', cards: [card({ name: 'Other' })] })
    const list = listScanSessions(db, 'ygo')
    expect(list).toHaveLength(1)
    expect(list[0].cards[0].name).toBe('Test')
  })

  it('records nothing for an empty card list', async () => {
    const db = await seededDb()
    recordScanSession(db, { uid: 'a', game: 'ygo', cards: [] })
    expect(listScanSessions(db, 'ygo')).toEqual([])
  })

  it('lists only the asked game, newest first', async () => {
    const db = await seededDb()
    recordScanSession(db, { uid: 'old', game: 'ygo', cards: [card()] })
    db.prepare(
      "UPDATE scan_sessions SET created_at = '2026-01-01T00:00:00.000Z' WHERE uid = 'old'"
    ).run()
    recordScanSession(db, { uid: 'new', game: 'ygo', cards: [card()] })
    recordScanSession(db, { uid: 'pkm', game: 'pkm', cards: [card()] })
    expect(listScanSessions(db, 'ygo').map((s) => s.uid)).toEqual(['new', 'old'])
    expect(listScanSessions(db, 'pkm').map((s) => s.uid)).toEqual(['pkm'])
  })

  it('hides a session from friends and marks it dirty', async () => {
    const db = await seededDb()
    recordScanSession(db, { uid: 'a', game: 'ygo', cards: [card()] })
    db.prepare('UPDATE scan_sessions SET dirty = 0').run()
    setScanSessionHidden(db, 'a', true)
    expect(listScanSessions(db, 'ygo')[0].friendsVisible).toBe(false)
    expect(db.prepare('SELECT dirty FROM scan_sessions').get()).toEqual({ dirty: 1 })
    setScanSessionHidden(db, 'a', false)
    expect(listScanSessions(db, 'ygo')[0].friendsVisible).toBe(true)
  })

  it('deletes by tombstone', async () => {
    const db = await seededDb()
    recordScanSession(db, { uid: 'a', game: 'ygo', cards: [card()] })
    db.prepare('UPDATE scan_sessions SET dirty = 0').run()
    deleteScanSession(db, 'a')
    expect(listScanSessions(db, 'ygo')).toEqual([])
    const row = db.prepare('SELECT deleted_at, dirty FROM scan_sessions').get() as {
      deleted_at: string | null
      dirty: number
    }
    expect(row.deleted_at).not.toBeNull()
    expect(row.dirty).toBe(1)
  })

  it('fills a missing price once and never changes a price', async () => {
    const db = await seededDb()
    const p = db.prepare('SELECT id, card_id FROM card_printings LIMIT 1').get() as {
      id: number
      card_id: number
    }
    db.prepare(
      'UPDATE card_printings SET market_price = 9, set_price = 9, language = ? WHERE id = ?'
    ).run('en', p.id)
    db.prepare('DELETE FROM intl_prices').run()
    const { pkey } = db.prepare('SELECT pkey FROM card_printings WHERE id = ?').get(p.id) as {
      pkey: string
    }
    recordScanSession(db, {
      uid: 'a',
      game: 'ygo',
      cards: [
        card({ cardId: p.card_id, pkey, printingId: p.id, price: 5 }),
        card({ cardId: p.card_id, pkey, printingId: p.id, price: null })
      ]
    })
    db.prepare('UPDATE scan_sessions SET dirty = 0').run()
    expect(fillScanSessionPrices(db, 'ygo')).toBe(1)
    expect(listScanSessions(db, 'ygo')[0].cards.map((c) => c.price)).toEqual([5, 9])
    expect(db.prepare('SELECT dirty FROM scan_sessions').get()).toEqual({ dirty: 1 })
    expect(fillScanSessionPrices(db, 'ygo')).toBe(0)
  })

  /** Two priced English printings of this catalog: the session's own, and an unrelated one. */
  type Printing = { id: number; card_id: number; pkey: string }
  const twoPrintings = async (): Promise<{
    db: Awaited<ReturnType<typeof seededDb>>
    right: Printing
    other: Printing
  }> => {
    const db = await seededDb()
    const [right, other] = db
      .prepare('SELECT id, card_id, pkey FROM card_printings ORDER BY id LIMIT 2')
      .all() as { id: number; card_id: number; pkey: string }[]
    const price = db.prepare(
      "UPDATE card_printings SET market_price = ?, set_price = ?, language = 'en' WHERE id = ?"
    )
    price.run(9, 9, right.id)
    price.run(1, 1, other.id)
    db.prepare('DELETE FROM intl_prices').run()
    return { db, right, other }
  }

  it('reads and prices a card by its pkey, never by a printing id from another device', async () => {
    const { db, right, other } = await twoPrintings()
    // Another device's ids: its printing id is this catalog's unrelated printing.
    recordScanSession(db, {
      uid: 'a',
      game: 'ygo',
      cards: [
        card({
          cardId: right.card_id,
          pkey: right.pkey,
          printingId: other.id,
          photoId: other.id,
          price: null
        }),
        card({
          pkey: 'en|999|NOPE-001|Common',
          printingId: other.id,
          photoId: other.id,
          price: null
        })
      ]
    })
    expect(fillScanSessionPrices(db, 'ygo')).toBe(1)
    const [s] = listScanSessions(db, 'ygo')
    expect(s.cards[0]).toMatchObject({ printingId: right.id, photoId: right.id, price: 9 })
    // A pkey this catalog lacks keeps the card, with no printing and no price.
    expect(s.cards[1]).toMatchObject({ printingId: null, photoId: null, price: null })
  })

  it('a card added without its own photo gets none on another device', async () => {
    const { db, right, other } = await twoPrintings()
    recordScanSession(db, {
      uid: 'a',
      game: 'ygo',
      cards: [card({ pkey: right.pkey, printingId: other.id, photoId: null })]
    })
    expect(listScanSessions(db, 'ygo')[0].cards[0]).toMatchObject({
      printingId: right.id,
      photoId: null
    })
  })

  it('a fill changes the cards only, never the edit time', async () => {
    const { db, right } = await twoPrintings()
    recordScanSession(db, {
      uid: 'a',
      game: 'ygo',
      cards: [card({ pkey: right.pkey, printingId: right.id, price: null })]
    })
    const at = '2026-01-01T00:00:00.000Z'
    db.prepare('UPDATE scan_sessions SET dirty = 0, updated_at = ?').run(at)
    expect(fillScanSessionPrices(db, 'ygo')).toBe(1)
    expect(db.prepare('SELECT updated_at, dirty FROM scan_sessions').get()).toEqual({
      updated_at: at,
      dirty: 1
    })
  })
})

describe('sessionCardsOf', () => {
  it('names each recorded card by its printing pkey and drops a printing this catalog lacks', async () => {
    const db = await seededDb()
    const p = db.prepare('SELECT id, pkey FROM card_printings LIMIT 1').get() as {
      id: number
      pkey: string
    }
    const { pkey: _drop, ...draft } = card({ printingId: p.id })
    void _drop
    expect(sessionCardsOf(db, [draft, { ...draft, printingId: 99_999_999 }])).toEqual([
      card({ printingId: p.id, pkey: p.pkey })
    ])
    expect(sessionCardsOf(db, [{ ...draft, printingId: 99_999_999 }])).toEqual([])
    expect(() => sessionCardsOf(db, [])).toThrow()
    expect(() => sessionCardsOf(db, [{ ...draft, printingId: 'x' }])).toThrow(/session card/i)
  })
})

describe('sessionTotal', () => {
  it('ignores unpriced cards and multiplies by quantity', () => {
    expect(
      sessionTotal([
        card({ price: 2, quantity: 3 }),
        card({ price: null, quantity: 4 }),
        card({ price: 1.5 })
      ])
    ).toEqual({ value: 7.5, priced: 2, unpriced: 1 })
  })
})

describe('checkSessionCards', () => {
  it('accepts well-formed cards', () => {
    expect(checkSessionCards([card()])).toEqual([card()])
    expect(checkSessionCards([card({ printingId: null })])).toEqual([card({ printingId: null })])
  })
  it('needs a pkey of 1 to 300 characters', () => {
    const rest: Record<string, unknown> = { ...card() }
    delete rest.pkey
    expect(() => checkSessionCards([rest])).toThrow(/session card/i)
    expect(() => checkSessionCards([card({ pkey: '' })])).toThrow(/session card/i)
    expect(() => checkSessionCards([card({ pkey: 'x'.repeat(301) })])).toThrow(/session card/i)
    expect(checkSessionCards([card({ pkey: 'x'.repeat(300) })])).toHaveLength(1)
  })
  it('rejects a card missing printingId', () => {
    const rest: Record<string, unknown> = { ...card() }
    delete rest.printingId
    expect(() => checkSessionCards([rest])).toThrow(/session card/i)
    expect(() => checkSessionCards([card({ printingId: 1.5 })])).toThrow(/session card/i)
  })
  it('rejects a negative quantity', () => {
    expect(() => checkSessionCards([card({ quantity: -1 })])).toThrow()
  })
  it('rejects an empty list, a non-array and too many cards', () => {
    expect(() => checkSessionCards([])).toThrow()
    expect(() => checkSessionCards('x')).toThrow()
    expect(() =>
      checkSessionCards(Array.from({ length: MAX_SESSION_CARDS + 1 }, () => card()))
    ).toThrow()
  })
})

describe('migration V41 (scan_sessions)', () => {
  it('migrates from 40 with data intact', () => {
    const old = databaseAt(40)
    old.exec("INSERT INTO meta (key, value) VALUES ('keep', 'me')")
    migrate(old)
    expect(old.pragma('user_version', { simple: true })).toBe(43)
    expect(old.prepare("SELECT value FROM meta WHERE key = 'keep'").get()).toEqual({ value: 'me' })
    expect(old.prepare('SELECT COUNT(*) AS n FROM scan_sessions').get()).toEqual({ n: 0 })
    old.close()
  })
})

describe('mergeSessionCards', () => {
  const c = (price: number | null, extra: Partial<ScanSessionCard> = {}): ScanSessionCard => ({
    cardId: 1,
    pkey: 'en|1|A-001|Common',
    printingId: 2,
    imageId: 3,
    photoId: null,
    name: 'A',
    setCode: null,
    rarity: null,
    quantity: 1,
    price,
    guess: false,
    addedAt: 10,
    ...extra
  })
  it('keeps a stored price, fills a stored null', () => {
    expect(mergeSessionCards([c(1), c(null)], [c(2), c(3)]).map((x) => x.price)).toEqual([1, 3])
  })
  it('keeps the stored cards when the lists differ', () => {
    expect(mergeSessionCards([c(null)], [c(5), c(5)])).toEqual([c(null)])
    expect(mergeSessionCards([c(null)], [c(5, { addedAt: 11 })])).toEqual([c(null)])
    expect(mergeSessionCards([c(null)], [c(5, { pkey: 'en|1|A-002|Common' })])).toEqual([c(null)])
  })
  it('matches cards by pkey, as each device has its own printing ids', () => {
    expect(mergeSessionCards([c(null)], [c(5, { printingId: 77, photoId: 77 })])).toEqual([c(5)])
  })
})
