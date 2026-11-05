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
import {
  deleteScanSession,
  listScanSessions,
  recordScanSession,
  setScanSessionHidden
} from '../../src/main/repo/scanSessions'
import type { ScanSessionCard, WireScanSession } from '../../src/shared/scanSessions'
import { inProcessPortal, PORTAL } from './cloudHelpers'
import { seededDb } from './helpers'

const NOW = (): Date => new Date('2026-10-25T20:00:00.000Z')

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
    expect(listScanSessions(b, 'ygo')).toMatchObject([{ uid: 's1', cards: [card()] }])
    expect(rows(b)).toEqual([expect.objectContaining({ dirty: 0 })])
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
    const old = (async (input: RequestInfo | URL, init?: RequestInit) =>
      /\/api\/sync\/sessions-/.test(String(input))
        ? Response.json({ error: 'Not found' }, { status: 404 })
        : portal.fetch(input, init)) as typeof fetch
    await syncOnce(a, user, await clientFor(old), NOW)
    expect(rows(a)).toEqual([expect.objectContaining({ uid: 's1', dirty: 1 })])
    expect(warn).not.toHaveBeenCalled()
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
  })
})
