import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { createCloudClient, type CloudClient } from '../../src/main/cloud/client'
import { syncOnce } from '../../src/main/cloud/engine'
import {
  adoptLocalData,
  adoptMergedData,
  ensureAccount,
  hasLocalData,
  hasOwnerRows,
  setActiveOwner
} from '../../src/main/cloud/localSync'
import { getDeck, listDecks, markDeckSeen, removeDeck, saveDeck } from '../../src/main/repo/decks'
import { CollectionError } from '../../src/main/repo/collection'
import type { DeckDraft, DeckEntry } from '../../src/shared/decks/types'
import { applyDecksPush, checkDecksPush, decksPullSince } from '../../workers/portal/src/decks'
import { inProcessPortal, PORTAL } from './cloudHelpers'
import { seededDb } from './helpers'

const T1 = new Date('2026-10-25T11:00:00.000Z')
const T2 = new Date('2026-10-25T12:00:00.000Z')
const T3 = new Date('2026-10-25T13:00:00.000Z')
const NOW = (): Date => new Date('2026-10-25T20:00:00.000Z')

const cardIds = (db: Database.Database, n = 2): number[] =>
  (
    db.prepare("SELECT id FROM cards WHERE game = 'ygo' ORDER BY id LIMIT ?").all(n) as {
      id: number
    }[]
  ).map((r) => r.id)

const rows = (db: Database.Database): Record<string, unknown>[] =>
  db
    .prepare(
      'SELECT owner_id, uid, name, deleted_at, dirty, last_verdict, last_pack_version FROM decks ORDER BY created_at, uid'
    )
    .all() as Record<string, unknown>[]

const draft = (cards: DeckEntry[], patch: Partial<DeckDraft> = {}): DeckDraft => ({
  format: 'advanced',
  name: 'Blue-Eyes',
  notes: 'Go first',
  cover: cards[0]?.card ?? null,
  private: false,
  cards,
  ...patch
})

const wire = (uid: string, cards: unknown[], patch: Record<string, unknown> = {}): unknown => ({
  uid,
  game: 'ygo',
  format: 'advanced',
  name: 'Deck',
  notes: '',
  cover: null,
  private: false,
  cards,
  createdAt: T1.toISOString(),
  updatedAt: T1.toISOString(),
  deletedAt: null,
  ...patch
})

describe('decks sync', () => {
  let portal: Awaited<ReturnType<typeof inProcessPortal>>
  let user: number
  let a: Database.Database
  let ids: number[]

  const device = async (): Promise<Database.Database> => {
    const db = await seededDb()
    ensureAccount(db, user, 'owner')
    setActiveOwner(db, user)
    return db
  }
  const clientFor = async (): Promise<CloudClient> =>
    createCloudClient({
      baseUrl: PORTAL,
      token: await portal.desktopToken(user),
      fetch: portal.fetch
    })
  const sync = async (db: Database.Database): Promise<void> => {
    await syncOnce(db, user, await clientFor(), NOW)
  }
  const server = (): Record<string, unknown>[] =>
    portal.serverDb
      .prepare(
        'SELECT uid, name, cards, deleted_at, last_verdict, last_pack_version FROM decks WHERE user_id = ?'
      )
      .all(user) as Record<string, unknown>[]

  beforeEach(async () => {
    portal = await inProcessPortal()
    user = portal.addUser('owner')
    a = await device()
    ids = cardIds(a, 2)
  })

  it('pushes a deck, reaches a fresh install, and an edit and removal follow', async () => {
    const cards: DeckEntry[] = [
      { section: 'main', card: ids[0], qty: 3 },
      { section: 'side', card: ids[1], qty: 1 }
    ]
    const uid = saveDeck(a, draft(cards), T1)
    markDeckSeen(a, uid, { status: 'illegal', problems: ['Too few'], packVersion: 'p1' })
    await sync(a)
    expect(server()).toEqual([
      {
        uid,
        name: 'Blue-Eyes',
        cards: JSON.stringify(cards),
        deleted_at: null,
        // Per device: never sent.
        last_verdict: null,
        last_pack_version: null
      }
    ])
    expect(rows(a)).toEqual([expect.objectContaining({ dirty: 0, last_pack_version: 'p1' })])

    const b = await device()
    await sync(b)
    expect(getDeck(b, uid)).toEqual(
      expect.objectContaining({ uid, name: 'Blue-Eyes', notes: 'Go first', cards, lastSeen: null })
    )
    expect(rows(b)).toEqual([
      expect.objectContaining({ dirty: 0, last_verdict: null, last_pack_version: null })
    ])

    const edited: DeckEntry[] = [{ section: 'main', card: ids[1], qty: 2 }]
    saveDeck(a, { ...draft(edited), uid, name: 'Dragons', private: true }, T2)
    await sync(a)
    await sync(b)
    expect(getDeck(b, uid)).toEqual(
      expect.objectContaining({ name: 'Dragons', private: true, cards: edited })
    )

    removeDeck(b, uid, T3)
    await sync(b)
    await sync(a)
    expect(listDecks(a).decks).toEqual([])
    expect(server()).toEqual([expect.objectContaining({ deleted_at: T3.toISOString() })])
    expect(rows(a)).toEqual([])
    expect(rows(b)).toEqual([])
  })

  it('the latest edit wins between two devices', async () => {
    const uid = saveDeck(a, draft([{ section: 'main', card: ids[0], qty: 3 }]), T1)
    await sync(a)
    const b = await device()
    await sync(b)
    const aCards: DeckEntry[] = [{ section: 'main', card: ids[0], qty: 1 }]
    const bCards: DeckEntry[] = [{ section: 'main', card: ids[1], qty: 2 }]
    saveDeck(a, { ...draft(aCards), uid }, T2)
    saveDeck(b, { ...draft(bCards), uid }, T3)
    await sync(a)
    await sync(b)
    markDeckSeen(a, uid, { status: 'legal', problems: [], packVersion: 'p7' })
    await sync(a)
    expect(getDeck(a, uid)?.cards).toEqual(bCards)
    expect(getDeck(b, uid)?.cards).toEqual(bCards)
    expect(getDeck(a, uid)?.lastSeen).toEqual({ status: 'legal', problems: [], packVersion: 'p7' })
    expect(rows(a)).toEqual([expect.objectContaining({ dirty: 0, last_pack_version: 'p7' })])
    expect(server()).toEqual([
      expect.objectContaining({ last_verdict: null, last_pack_version: null })
    ])
  })

  it('a stale push answers with the server deck, and a remote apply keeps the verdict', async () => {
    const uid = saveDeck(a, draft([{ section: 'main', card: ids[0], qty: 3 }]), T1)
    await sync(a)
    const b = await device()
    await sync(b)
    markDeckSeen(b, uid, { status: 'legal', problems: [], packVersion: 'p2' })
    // A newer edit lands on the server from elsewhere; b's older edit is then stale.
    const [newer] = checkDecksPush(
      {
        entries: [
          wire(uid, [{ section: 'main', card: ids[1], qty: 1 }], {
            updatedAt: T3.toISOString(),
            name: 'Server'
          })
        ]
      },
      NOW()
    )
    expect(applyDecksPush(portal.serverDb, user, [newer], ['ygo'])).toEqual([
      { uid, status: 'applied' }
    ])
    saveDeck(b, { ...draft([{ section: 'main', card: ids[0], qty: 2 }]), uid }, T2)
    await sync(b)
    expect(getDeck(b, uid)).toEqual(expect.objectContaining({ name: 'Server' }))
    expect(rows(b)).toEqual([expect.objectContaining({ dirty: 0, last_pack_version: 'p2' })])
    // The same deck again is applied without a new seq.
    const before = decksPullSince(portal.serverDb, user, 0).cursor
    expect(applyDecksPush(portal.serverDb, user, [newer], ['ygo'])).toEqual([
      { uid, status: 'applied' }
    ])
    expect(decksPullSince(portal.serverDb, user, 0).cursor).toBe(before)
  })

  it('a portal without decks (404) leaves them queued and the run whole', async () => {
    const calls: string[] = []
    const old = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      const path = new URL(req.url).pathname
      if (path.startsWith('/api/sync/decks')) {
        calls.push(path)
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        })
      }
      return portal.fetch(req)
    }) as typeof fetch
    saveDeck(a, draft([{ section: 'main', card: ids[0], qty: 3 }]), T1)
    const client = createCloudClient({
      baseUrl: PORTAL,
      token: await portal.desktopToken(user),
      fetch: old
    })
    await expect(syncOnce(a, user, client, NOW)).resolves.toBeDefined()
    expect(calls).toEqual(['/api/sync/decks-pull'])
    expect(rows(a)).toEqual([expect.objectContaining({ dirty: 1 })])
    await sync(a)
    expect(server()).toHaveLength(1)
  })

  it('a malformed push is a 400', async () => {
    const many = Array.from({ length: 301 }, (_, i) => ({ section: 'main', card: i + 1, qty: 1 }))
    expect(() => checkDecksPush({ entries: [wire('d-1', many)] }, NOW())).toThrow(CollectionError)
    expect(() => checkDecksPush({ entries: [wire('d-1', [], { format: 'nope' })] }, NOW())).toThrow(
      CollectionError
    )
    expect(() => checkDecksPush({ entries: [wire('', [])] }, NOW())).toThrow(CollectionError)
    expect(() => checkDecksPush({ entries: 'x' }, NOW())).toThrow(CollectionError)

    const res = await portal.fetch(`${PORTAL}/api/sync/decks-push`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await portal.desktopToken(user)}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ entries: [wire('d-1', many)] })
    })
    expect(res.status).toBe(400)
    expect(server()).toEqual([])
  })

  it('refuses a push that would take the user past 1,000 live decks of one game', () => {
    // 999 live decks and one tombstone, written straight into the server table.
    portal.serverDb
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1000)
         INSERT INTO decks (user_id, uid, game, format, name, created_at, updated_at, deleted_at, seq)
         SELECT ?, 'old-' || i, 'ygo', 'advanced', 'D', t, t, CASE WHEN i = 1000 THEN t END, i
         FROM n, (SELECT '2026-01-01T00:00:00.000Z' AS t)`
      )
      .run(user)
    const push = (uids: string[]): unknown =>
      applyDecksPush(
        portal.serverDb,
        user,
        checkDecksPush({ entries: uids.map((u) => wire(u, [])) }, NOW()),
        ['ygo']
      )
    expect(() => push(['new-1', 'new-2'])).toThrow(CollectionError)
    expect(push(['new-1'])).toEqual([{ uid: 'new-1', status: 'applied' }])
    // An edit of a live deck and a revived tombstone's uid count as they stand.
    expect(push(['old-1'])).toEqual([{ uid: 'old-1', status: 'applied' }])
    expect(() => push(['old-1000'])).toThrow(CollectionError)
  })

  it('never-signed-in decks move to the first account, dirty', async () => {
    const local = await seededDb()
    expect(hasLocalData(local)).toBe(false)
    saveDeck(local, draft([{ section: 'main', card: ids[0], qty: 3 }]), T1)
    expect(hasLocalData(local)).toBe(true)
    adoptLocalData(local, 7)
    expect(rows(local)).toEqual([expect.objectContaining({ owner_id: 7, dirty: 1 })])
  })

  it('an unsent deck of a merged-away account moves to the survivor', async () => {
    const local = await seededDb()
    ensureAccount(local, 7, 'old')
    setActiveOwner(local, 7)
    saveDeck(local, draft([{ section: 'main', card: ids[0], qty: 3 }]), T1)
    expect(hasOwnerRows(local, 7)).toBe(true)
    adoptMergedData(local, 7, 8, T2.toISOString())
    expect(rows(local)).toEqual([expect.objectContaining({ owner_id: 8, dirty: 1 })])
    expect(hasOwnerRows(local, 7)).toBe(false)
  })
})
