import { describe, expect, it } from 'vitest'
import { migrate } from '../../src/main/db/database'
import {
  checkSessionCards,
  deleteScanSession,
  fillScanSessionPrices,
  listScanSessions,
  recordScanSession,
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
    expect(list[0]).toMatchObject({ uid: 'a', game: 'ygo', friendsVisible: true, cards: [card()] })
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
    recordScanSession(db, {
      uid: 'a',
      game: 'ygo',
      cards: [
        card({ cardId: p.card_id, printingId: p.id, price: 5 }),
        card({ cardId: p.card_id, printingId: p.id, price: null })
      ]
    })
    db.prepare('UPDATE scan_sessions SET dirty = 0').run()
    expect(fillScanSessionPrices(db, 'ygo')).toBe(1)
    expect(listScanSessions(db, 'ygo')[0].cards.map((c) => c.price)).toEqual([5, 9])
    expect(db.prepare('SELECT dirty FROM scan_sessions').get()).toEqual({ dirty: 1 })
    expect(fillScanSessionPrices(db, 'ygo')).toBe(0)
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
  })
  it('rejects a card missing printingId', () => {
    const rest: Record<string, unknown> = { ...card() }
    delete rest.printingId
    expect(() => checkSessionCards([rest])).toThrow(/session card/i)
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
    expect(old.pragma('user_version', { simple: true })).toBe(41)
    expect(old.prepare("SELECT value FROM meta WHERE key = 'keep'").get()).toEqual({ value: 'me' })
    expect(old.prepare('SELECT COUNT(*) AS n FROM scan_sessions').get()).toEqual({ n: 0 })
    old.close()
  })
})
