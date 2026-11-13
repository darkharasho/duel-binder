import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { createCloudClient, type CloudClient } from '../../src/main/cloud/client'
import { syncOnce } from '../../src/main/cloud/engine'
import {
  adoptLocalData,
  applyRemoteSession,
  ensureAccount,
  hasLocalData,
  setActiveOwner
} from '../../src/main/cloud/localSync'
import { addEntry } from '../../src/main/repo/collection'
import {
  deleteScanSession,
  fillScanSessionPrices,
  listScanSessions,
  recordScanSession,
  removeScanSessionCard,
  setScanSessionHidden
} from '../../src/main/repo/scanSessions'
import type { ScanSessionCard, WireScanSession } from '../../src/shared/scanSessions'
import { inProcessPortal, PORTAL } from './cloudHelpers'
import { seededDb } from './helpers'

const NOW = (): Date => new Date('2026-10-25T20:00:00.000Z')

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

const rows = (db: Database.Database): Record<string, unknown>[] =>
  db
    .prepare(
      'SELECT owner_id, uid, deleted_at, friends_visible, dirty FROM scan_sessions ORDER BY uid'
    )
    .all() as Record<string, unknown>[]

/** Puts a session's edit times before the test portal's clock, which clamps later ones. */
const stamp = (db: Database.Database, at: string): void => {
  db.prepare(
    'UPDATE scan_sessions SET updated_at = ?, deleted_at = CASE WHEN deleted_at IS NULL THEN NULL ELSE ? END'
  ).run(at, at)
}
const T0 = '2026-10-25T10:00:00.000Z'
const T1 = '2026-10-25T11:00:00.000Z'
const T2 = '2026-10-25T12:00:00.000Z'

describe('scan session sync', () => {
  let portal: Awaited<ReturnType<typeof inProcessPortal>>
  let user: number
  let a: Database.Database

  const device = async (): Promise<Database.Database> => {
    const db = await seededDb()
    ensureAccount(db, user, 'owner')
    setActiveOwner(db, user)
    return db
  }
  const clientFor = async (fetch: typeof globalThis.fetch = portal.fetch): Promise<CloudClient> =>
    createCloudClient({ baseUrl: PORTAL, token: await portal.desktopToken(user), fetch })
  const sync = async (db: Database.Database): Promise<void> => {
    await syncOnce(db, user, await clientFor(), NOW)
  }

  beforeEach(async () => {
    portal = await inProcessPortal()
    user = portal.addUser('owner')
    a = await device()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a session recorded on one device appears on another', async () => {
    recordScanSession(a, { uid: 's1', game: 'ygo', cards: [card()] })
    await sync(a)
    expect(rows(a)).toEqual([expect.objectContaining({ uid: 's1', dirty: 0 })])
    const b = await device()
    await sync(b)
    expect(listScanSessions(b, 'ygo')).toMatchObject([
      { uid: 's1', cards: [card({ printingId: null })] }
    ])
    expect(rows(b)).toEqual([expect.objectContaining({ dirty: 0 })])
  })

  /** Two printings of the device catalog, `right` priced 9 and `other` 1 on `db`. */
  type Printing = { id: number; card_id: number; pkey: string }
  const printings = (db: Database.Database): { right: Printing; other: Printing } => {
    const [right, other] = db
      .prepare('SELECT id, card_id, pkey FROM card_printings ORDER BY id LIMIT 2')
      .all() as { id: number; card_id: number; pkey: string }[]
    const price = db.prepare(
      "UPDATE card_printings SET market_price = ?, set_price = ?, language = 'en' WHERE id = ?"
    )
    price.run(9, 9, right.id)
    price.run(1, 1, other.id)
    db.prepare('DELETE FROM intl_prices').run()
    return { right, other }
  }
  const serverRow = (): Record<string, unknown> =>
    portal.serverDb
      .prepare('SELECT friends_visible, deleted_at, cards FROM scan_sessions WHERE uid = ?')
      .get('s1') as Record<string, unknown>

  it('a pulled session whose printing id is an unrelated printing here is read and priced by pkey', async () => {
    const { right, other } = printings(a)
    // Device A's printing id for the card is device B's unrelated `other`.
    recordScanSession(a, {
      uid: 's1',
      game: 'ygo',
      cards: [
        card({
          cardId: right.card_id,
          pkey: right.pkey,
          printingId: other.id,
          photoId: other.id,
          price: null
        })
      ]
    })
    await sync(a)
    const b = await device()
    printings(b)
    await sync(b)
    fillScanSessionPrices(b, 'ygo')
    expect(listScanSessions(b, 'ygo')[0].cards[0]).toMatchObject({
      printingId: right.id,
      photoId: right.id,
      price: 9
    })
  })

  it('a fill on one device never shows a session hidden on another', async () => {
    const { right } = printings(a)
    recordScanSession(a, {
      uid: 's1',
      game: 'ygo',
      cards: [card({ cardId: right.card_id, pkey: right.pkey, price: null })]
    })
    a.prepare('DELETE FROM card_printings WHERE id = ?').run(right.id)
    stamp(a, T0)
    await sync(a)
    const b = await device()
    printings(b)
    await sync(b)
    setScanSessionHidden(a, 's1', true)
    stamp(a, T1)
    await sync(a)
    // B, not yet synced since the hide, fills the price.
    expect(fillScanSessionPrices(b, 'ygo')).toBe(1)
    await sync(b)
    await sync(a)
    expect(serverRow().friends_visible).toBe(0)
    expect(JSON.parse(serverRow().cards as string)[0].price).toBe(9)
    for (const db of [a, b]) {
      expect(listScanSessions(db, 'ygo')).toMatchObject([
        { friendsVisible: false, updatedAt: T1, cards: [{ price: 9 }] }
      ])
      expect(rows(db)).toEqual([expect.objectContaining({ dirty: 0 })])
    }
  })

  it('a fill on one device never brings back a session deleted on another', async () => {
    const { right } = printings(a)
    recordScanSession(a, {
      uid: 's1',
      game: 'ygo',
      cards: [card({ cardId: right.card_id, pkey: right.pkey, price: null })]
    })
    a.prepare('DELETE FROM card_printings WHERE id = ?').run(right.id)
    stamp(a, T0)
    await sync(a)
    const b = await device()
    printings(b)
    await sync(b)
    deleteScanSession(a, 's1')
    stamp(a, T1)
    await sync(a)
    expect(fillScanSessionPrices(b, 'ygo')).toBe(1)
    await sync(b)
    await sync(a)
    expect(serverRow().deleted_at).not.toBeNull()
    for (const db of [a, b]) {
      expect(listScanSessions(db, 'ygo')).toEqual([])
      expect(rows(db)).toEqual([])
    }
  })

  it('hiding on one device reaches the other', async () => {
    recordScanSession(a, { uid: 's1', game: 'ygo', cards: [card()] })
    stamp(a, T1)
    await sync(a)
    const b = await device()
    await sync(b)
    setScanSessionHidden(b, 's1', true)
    stamp(b, T2)
    await sync(b)
    await sync(a)
    expect(listScanSessions(a, 'ygo')).toMatchObject([{ uid: 's1', friendsVisible: false }])
  })

  it('a deletion reaches the other device', async () => {
    recordScanSession(a, { uid: 's1', game: 'ygo', cards: [card()] })
    stamp(a, T1)
    await sync(a)
    const b = await device()
    await sync(b)
    deleteScanSession(a, 's1')
    stamp(a, T2)
    await sync(a)
    await sync(b)
    expect(listScanSessions(b, 'ygo')).toEqual([])
    expect(rows(a)).toEqual([])
    expect(rows(b)).toEqual([])
  })

  it('signing in adopts a signed-out session', async () => {
    const db = await seededDb()
    recordScanSession(db, { uid: 'local', game: 'ygo', cards: [card()] })
    expect(hasLocalData(db)).toBe(true)
    ensureAccount(db, user, 'owner')
    adoptLocalData(db, user)
    setActiveOwner(db, user)
    expect(rows(db)).toEqual([expect.objectContaining({ owner_id: user, uid: 'local', dirty: 1 })])
    await sync(db)
    expect(rows(db)).toEqual([expect.objectContaining({ dirty: 0 })])
    const b = await device()
    await sync(b)
    expect(listScanSessions(b, 'ygo')).toMatchObject([{ uid: 'local' }])
  })

  it('a portal without the sessions routes leaves the row dirty and the rest syncing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    recordScanSession(a, { uid: 's1', game: 'ygo', cards: [card()] })
    const pid = (
      a.prepare("SELECT id FROM card_printings WHERE set_code = 'LOB-EN005'").get() as {
        id: number
      }
    ).id
    const img = 46986414
    addEntry(
      a,
      { printingId: pid, imageId: img, quantity: 1 },
      new Date('2026-10-25T11:00:00.000Z')
    )
    const old = (async (input: RequestInfo | URL, init?: RequestInit) =>
      /\/api\/sync\/sessions-/.test(String(input))
        ? Response.json({ error: 'Not found' }, { status: 404 })
        : portal.fetch(input, init)) as typeof fetch
    await syncOnce(a, user, await clientFor(old), NOW)
    expect(rows(a)).toEqual([expect.objectContaining({ uid: 's1', dirty: 1 })])
    expect(warn).not.toHaveBeenCalled()
    // The collection still synced.
    expect(
      portal.serverDb
        .prepare('SELECT COUNT(*) AS n FROM collection_entries WHERE user_id = ?')
        .get(user)
    ).toEqual({ n: 1 })
    expect(a.prepare('SELECT dirty FROM collection_entries').all()).toEqual([{ dirty: 0 }])
    // Later, the routes exist.
    await sync(a)
    expect(rows(a)).toEqual([expect.objectContaining({ dirty: 0 })])
  })

  it('a newer remote session never changes a stored price but fills a null', () => {
    recordScanSession(a, {
      uid: 's1',
      game: 'ygo',
      cards: [card({ price: 5 }), card({ printingId: 2, price: null })]
    })
    const local = listScanSessions(a, 'ygo')[0]
    const remote: WireScanSession = {
      ...local,
      cards: [card({ price: 9 }), card({ printingId: 2, price: 3 })],
      friendsVisible: false,
      updatedAt: '2099-01-01T00:00:00.000Z',
      deletedAt: null
    }
    expect(applyRemoteSession(a, user, remote)).toBe(true)
    const [s] = listScanSessions(a, 'ygo')
    expect(s.cards.map((c) => c.price)).toEqual([5, 3])
    expect(s.friendsVisible).toBe(false)
    // Nothing remote lacked a price we hold, so nothing goes back up.
    expect(rows(a)).toEqual([expect.objectContaining({ dirty: 0 })])
  })

  it('keeps a price the server lacks, dirty with the server edit time', () => {
    recordScanSession(a, { uid: 's1', game: 'ygo', cards: [card({ price: 7 })] })
    a.prepare("UPDATE scan_sessions SET updated_at = '2025-12-31T00:00:00.000Z'").run()
    const local = listScanSessions(a, 'ygo')[0]
    const at = '2026-01-01T00:00:00.000Z'
    expect(
      applyRemoteSession(a, user, {
        ...local,
        cards: [card({ price: null })],
        friendsVisible: false,
        updatedAt: at,
        deletedAt: null
      })
    ).toBe(true)
    const [s] = listScanSessions(a, 'ygo')
    expect(s.cards[0].price).toBe(7)
    expect(s.friendsVisible).toBe(false)
    // Dirty to send the price up, but the edit time is the server's: the flags it carries are too.
    expect(s.updatedAt).toBe(at)
    expect(rows(a)).toEqual([expect.objectContaining({ dirty: 1 })])
  })

  it('two different fills of one null leave the local price, hidden, and clean', () => {
    recordScanSession(a, { uid: 's1', game: 'ygo', cards: [card({ price: 9 })] })
    const local = listScanSessions(a, 'ygo')[0]
    expect(
      applyRemoteSession(a, user, {
        ...local,
        cards: [card({ price: 5 })],
        friendsVisible: false,
        updatedAt: '2099-01-01T00:00:00.000Z',
        deletedAt: null
      })
    ).toBe(true)
    const [s] = listScanSessions(a, 'ygo')
    expect(s.cards[0].price).toBe(9)
    expect(s.friendsVisible).toBe(false)
    expect(s.updatedAt).toBe('2099-01-01T00:00:00.000Z')
    expect(rows(a)).toEqual([expect.objectContaining({ dirty: 0 })])
  })

  it('a card removed on one device goes on the other, and an older edit never brings it back', async () => {
    const stray = card({ pkey: 'en|1|ABC-002|Common', addedAt: 2000 })
    recordScanSession(a, { uid: 's1', game: 'ygo', cards: [card(), stray] })
    stamp(a, T0)
    await sync(a)
    const b = await device()
    await sync(b)
    // B hides the session at T1 but has not pushed yet; A removes the stray at T2.
    setScanSessionHidden(b, 's1', true)
    stamp(b, T1)
    removeScanSessionCard(a, 's1', stray)
    stamp(a, T2)
    await sync(a)
    expect(JSON.parse(serverRow().cards as string)).toHaveLength(1)
    await sync(b)
    expect(JSON.parse(serverRow().cards as string)).toHaveLength(1)
    expect(listScanSessions(b, 'ygo').map((s) => s.cards.map((c) => c.pkey))).toEqual([
      [card().pkey]
    ])
  })
})
