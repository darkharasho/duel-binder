import { beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import { createCloudClient, type CloudClient } from '../../src/main/cloud/client'
import { syncOnce } from '../../src/main/cloud/engine'
import {
  adoptLocalData,
  ensureAccount,
  hasLocalData,
  setActiveOwner
} from '../../src/main/cloud/localSync'
import { MIGRATIONS } from '../../src/main/db/schema'
import { listEntries } from '../../src/main/repo/collection'
import { gradedForCard, listGraded, removeGraded, saveGraded } from '../../src/main/repo/graded'
import { applyGradedPush, checkGradedPush } from '../../workers/portal/src/graded'
import type { GradedCopy, GradedDraft } from '../../src/shared/graded'
import { acceptFriend, requestFriend } from '../../workers/portal/src/friends'
import { userScope } from '../../workers/portal/src/scope'
import { inProcessPortal, PORTAL } from './cloudHelpers'
import { seededDb } from './helpers'

const T1 = new Date('2026-10-25T11:00:00.000Z')
const T2 = new Date('2026-10-25T12:00:00.000Z')
const T3 = new Date('2026-10-25T13:00:00.000Z')
const NOW = (): Date => new Date('2026-10-25T20:00:00.000Z')

interface PrintingRow {
  id: number
  card_id: number
  image_id: number
}

/** The first printing of the first `n` cards of a game, one per card, with the card's first art. */
const printings = (db: Database.Database, n = 2, game = 'ygo'): PrintingRow[] =>
  db
    .prepare(
      `SELECT MIN(p.id) AS id, p.card_id,
         (SELECT i.image_id FROM card_images i WHERE i.card_id = p.card_id ORDER BY i.sort_order LIMIT 1) AS image_id
       FROM card_printings p WHERE p.game = ? AND p.pkey IS NOT NULL
       GROUP BY p.card_id ORDER BY p.card_id LIMIT ?`
    )
    .all(game, n) as PrintingRow[]

const rows = (db: Database.Database): Record<string, unknown>[] =>
  db
    .prepare(
      'SELECT owner_id, uid, grade, deleted_at, dirty FROM graded_copies ORDER BY created_at, uid'
    )
    .all() as Record<string, unknown>[]

const draft = (p: PrintingRow, patch: Partial<GradedDraft> = {}): GradedDraft => ({
  printingId: p.id,
  company: 'PSA',
  grade: '10',
  label: '',
  cert: '12345678',
  subgrades: '',
  value: 250,
  paid: 120,
  notes: '',
  ...patch
})

describe('graded copies repo', () => {
  let db: Database.Database
  let a: PrintingRow
  let b: PrintingRow

  beforeEach(async () => {
    db = await seededDb()
    ;[a, b] = printings(db)
  })

  it('migration 49 is desktop-only', () => {
    expect(MIGRATIONS.find((m) => m.version === 49)).toMatchObject({ server: false })
  })

  it('adds slabs one by one, newest first, with the card art and raw price', () => {
    const first = saveGraded(db, draft(a), T1)
    const second = saveGraded(
      db,
      draft(a, { company: 'BGS', grade: '9.5', label: 'Black Label' }),
      T2
    )
    saveGraded(db, draft(b, { value: null }), T3)
    const all = listGraded(db)
    expect(all.map((g) => g.uid).slice(1)).toEqual([second, first])
    const forA = gradedForCard(db, a.card_id)
    expect(forA).toHaveLength(2)
    expect(forA[0]).toMatchObject({
      uid: second,
      company: 'BGS',
      grade: '9.5',
      label: 'Black Label',
      cert: '12345678',
      value: 250,
      paid: 120,
      imageId: a.image_id,
      printingScan: true
    })
    expect(forA[0].card.id).toBe(a.card_id)
    expect(forA[0].printing.id).toBe(a.id)
    expect(all[0]).toMatchObject({ value: null })
    expect(all[0].rawPrice === null || typeof all[0].rawPrice === 'number').toBe(true)
  })

  it('never touches the collection, so completion ignores slabs', () => {
    saveGraded(db, draft(a), T1)
    expect(listEntries(db, { sort: 'name', dir: 'asc' })).toEqual([])
  })

  it('edits a slab in place and tidies its fields', () => {
    const uid = saveGraded(db, draft(a), T1)
    expect(
      saveGraded(
        db,
        { ...draft(a), uid, grade: '9', cert: '  987 ', value: 99.999, notes: ' ok ' },
        T2
      )
    ).toBe(uid)
    expect(listGraded(db)).toEqual([
      expect.objectContaining({ uid, grade: '9', cert: '987', value: 100, notes: 'ok' })
    ])
    expect(rows(db)).toHaveLength(1)
  })

  it('rejects bad fields, a gone uid and art from another card', () => {
    expect(() => saveGraded(db, draft(a, { grade: '11' }))).toThrow(/Grade/)
    expect(() => saveGraded(db, draft(a, { grade: '9.25' }))).toThrow(/Grade/)
    expect(() => saveGraded(db, draft(a, { company: '  ' }))).toThrow(/company is required/)
    expect(() => saveGraded(db, draft(a, { value: -1 }))).toThrow(/Value/)
    expect(() => saveGraded(db, draft(a, { uid: 'nope' }))).toThrow(/gone/)
    expect(() => saveGraded(db, draft(a, { imageId: b.image_id }))).toThrow(/Image/)
    expect(() => saveGraded(db, { ...draft(a), printingId: 999_999_999 })).toThrow(/not found/)
    expect(saveGraded(db, draft(a, { grade: 'Authentic', value: null, paid: null }))).toBeTruthy()
  })

  it('keeps all four subgrades tidied, or none, and rejects anything else', () => {
    const uid = saveGraded(db, draft(a, { company: 'BGS', subgrades: ' 9.5  10 10 9.5 ' }), T1)
    expect(listGraded(db)).toEqual([expect.objectContaining({ uid, subgrades: '9.5 10 10 9.5' })])
    expect(saveGraded(db, draft(a))).toBeTruthy()
    expect(listGraded(db)[0]).toMatchObject({ subgrades: '' })
    expect(() => saveGraded(db, draft(a, { subgrades: '9.5 10 10' }))).toThrow(/Subgrades/)
    expect(() => saveGraded(db, draft(a, { subgrades: '9.5 10 10 11' }))).toThrow(/Subgrades/)
    expect(() => saveGraded(db, draft(a, { subgrades: '10 10 10 Authentic' }))).toThrow(/Subgrades/)
  })

  it('reads the set’s release date for the label’s year', () => {
    saveGraded(db, draft(a), T1)
    const [slab] = listGraded(db)
    const date = db
      .prepare(
        `SELECT s.tcg_date FROM card_printings p JOIN sets s ON s.game = p.game
           AND s.language = p.language AND s.set_name = p.set_name WHERE p.id = ?`
      )
      .get(a.id) as { tcg_date: string | null } | undefined
    expect(slab.printing.releaseDate).toBe(date?.tcg_date ?? undefined)
  })

  it('never-signed-in slabs are deleted outright; signed-in ones leave a tombstone', () => {
    const uid = saveGraded(db, draft(a), T1)
    removeGraded(db, uid, T2)
    expect(rows(db)).toEqual([])

    ensureAccount(db, 5, 'owner')
    setActiveOwner(db, 5)
    const signed = saveGraded(db, draft(a), T1)
    removeGraded(db, signed, T2)
    expect(listGraded(db)).toEqual([])
    expect(rows(db)).toEqual([
      expect.objectContaining({ owner_id: 5, deleted_at: T2.toISOString(), dirty: 1 })
    ])
  })

  it('a slab outlives its printing leaving the catalog and shows again when it returns', () => {
    saveGraded(db, draft(a), T1)
    const p = db.prepare('SELECT * FROM card_printings WHERE id = ?').get(a.id) as Record<
      string,
      unknown
    >
    db.pragma('foreign_keys = OFF')
    db.prepare('DELETE FROM card_printings WHERE id = ?').run(a.id)
    expect(listGraded(db)).toEqual([])
    // pkey is generated from the other columns.
    const cols = Object.keys(p).filter((c) => c !== 'pkey')
    db.prepare(
      `INSERT INTO card_printings (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    ).run(...cols.map((c) => p[c]))
    expect(listGraded(db)).toHaveLength(1)
  })

  it('never-signed-in slabs count as local data and move to the first account, dirty', () => {
    expect(hasLocalData(db)).toBe(false)
    saveGraded(db, draft(a), T1)
    expect(hasLocalData(db)).toBe(true)
    adoptLocalData(db, 7)
    expect(rows(db)).toEqual([expect.objectContaining({ owner_id: 7, dirty: 1 })])
  })
})

describe('graded copies sync', () => {
  let portal: Awaited<ReturnType<typeof inProcessPortal>>
  let user: number
  let a: Database.Database
  let p: PrintingRow

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
      .prepare('SELECT uid, grade, value, deleted_at FROM graded_copies WHERE user_id = ?')
      .all(user) as Record<string, unknown>[]

  beforeEach(async () => {
    portal = await inProcessPortal()
    user = portal.addUser('owner')
    a = await device()
    ;[p] = printings(a, 1)
  })

  it('pushes a slab, reaches a fresh install, and an edit and removal follow', async () => {
    const uid = saveGraded(a, draft(p), T1)
    await sync(a)
    expect(server()).toEqual([{ uid, grade: '10', value: 250, deleted_at: null }])
    expect(rows(a)).toEqual([expect.objectContaining({ dirty: 0 })])

    const b = await device()
    await sync(b)
    expect(listGraded(b)).toEqual([expect.objectContaining({ uid, cert: '12345678', paid: 120 })])

    saveGraded(a, { ...draft(p), uid, grade: '9.5' }, T2)
    await sync(a)
    await sync(b)
    expect(listGraded(b)).toEqual([expect.objectContaining({ uid, grade: '9.5' })])

    removeGraded(b, uid, T3)
    await sync(b)
    await sync(a)
    expect(listGraded(a)).toEqual([])
    expect(server()).toEqual([expect.objectContaining({ deleted_at: T3.toISOString() })])
    expect(rows(a)).toEqual([])
    expect(rows(b)).toEqual([])
  })

  it('subgrades reach the other device, and an older app’s push leaves them be', async () => {
    const uid = saveGraded(a, draft(p, { company: 'BGS', subgrades: '10 9.5 10 10' }), T1)
    await sync(a)
    const b = await device()
    await sync(b)
    expect(listGraded(b)).toEqual([expect.objectContaining({ uid, subgrades: '10 9.5 10 10' })])

    // An app from before subgrades pushes an edit with no subgrades field.
    const [wire] = checkGradedPush(
      {
        entries: [
          {
            uid,
            game: 'ygo',
            pkey: listGraded(a)[0].pkey,
            imageId: p.image_id,
            company: 'BGS',
            grade: '9.5',
            label: '',
            cert: '12345678',
            value: 250,
            paid: 120,
            notes: '',
            createdAt: T1.toISOString(),
            updatedAt: T2.toISOString(),
            deletedAt: null
          }
        ]
      },
      NOW()
    )
    expect(wire.subgrades).toBeUndefined()
    expect(applyGradedPush(portal.serverDb, user, [wire], ['ygo'])).toEqual([
      { uid, status: 'applied' }
    ])
    expect(
      portal.serverDb
        .prepare('SELECT grade, subgrades FROM graded_copies WHERE user_id = ? AND uid = ?')
        .get(user, uid)
    ).toEqual({ grade: '9.5', subgrades: '10 9.5 10 10' })
  })

  it('the latest edit wins between two devices', async () => {
    const uid = saveGraded(a, draft(p), T1)
    await sync(a)
    const b = await device()
    await sync(b)
    saveGraded(b, { ...draft(p), uid, grade: '8' }, T3)
    saveGraded(a, { ...draft(p), uid, grade: '9' }, T2)
    await sync(b)
    await sync(a)
    await sync(b)
    expect(listGraded(a)).toEqual([expect.objectContaining({ grade: '8' })])
    expect(listGraded(b)).toEqual([expect.objectContaining({ grade: '8' })])
  })

  it('a portal without graded copies (404) leaves them queued and the run whole', async () => {
    const calls: string[] = []
    const old = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      const path = new URL(req.url).pathname
      if (path.startsWith('/api/sync/graded')) {
        calls.push(path)
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        })
      }
      return portal.fetch(req)
    }) as typeof fetch
    saveGraded(a, draft(p), T1)
    const client = createCloudClient({
      baseUrl: PORTAL,
      token: await portal.desktopToken(user),
      fetch: old
    })
    await expect(syncOnce(a, user, client, NOW)).resolves.toBeDefined()
    // The pull fails first; the prices are asked about too, and fail the same way.
    expect(calls).toEqual(['/api/sync/graded-pull', '/api/sync/graded-prices'])
    expect(rows(a)).toEqual([expect.objectContaining({ dirty: 1 })])
    await sync(a)
    expect(server()).toHaveLength(1)
  })

  it('brings down the eBay price the server found for a slab, and asks again only later', async () => {
    saveGraded(a, draft(p), T1)
    await sync(a)
    expect(listGraded(a)).toEqual([expect.objectContaining({ market: null })])
    const pkey = (a.prepare('SELECT pkey FROM graded_copies').get() as { pkey: string }).pkey
    const { company, grade } = draft(p)
    portal.serverDb
      .prepare(
        `INSERT INTO graded_prices (pkey, company, grade, price, listing_count, checked_at)
         VALUES (?, ?, ?, 410, 5, ?)`
      )
      .run(pkey, company, grade, NOW().toISOString())
    // Asked about a moment ago and the slabs haven't changed: not asked again yet.
    await sync(a)
    expect(listGraded(a)[0].market).toBeNull()
    const later = (): Date => new Date(NOW().getTime() + 31 * 60 * 1000)
    await syncOnce(a, user, await clientFor(), later)
    expect(listGraded(a)).toEqual([
      expect.objectContaining({
        market: { price: 410, listings: 5, checkedAt: NOW().toISOString() }
      })
    ])
    // The web reads the server's own table.
    expect(listGraded(portal.serverDb, userScope(user, 'ygo'))).toEqual([
      expect.objectContaining({ market: expect.objectContaining({ price: 410 }) })
    ])
  })

  it('the web (server scope) adds and removes slabs that sync to the desktop', async () => {
    const scope = userScope(user, 'ygo')
    const serverPrinting = portal.serverDb
      .prepare(
        'SELECT id FROM card_printings WHERE pkey = (SELECT pkey FROM card_printings WHERE id = ?)'
      )
      .get(p.id) as { id: number } | undefined
    // The fixture catalog is shared, so the server has the same printing.
    expect(serverPrinting).toBeDefined()
    const uid = saveGraded(
      portal.serverDb,
      { ...draft(p), printingId: serverPrinting!.id },
      T1,
      scope
    )
    expect(listGraded(portal.serverDb, scope)).toEqual([expect.objectContaining({ uid })])
    await sync(a)
    expect(listGraded(a)).toEqual([expect.objectContaining({ uid, grade: '10' })])
    removeGraded(portal.serverDb, uid, T2, scope)
    await sync(a)
    expect(listGraded(a)).toEqual([])
  })

  it('friends:graded shows a friend their slabs without what was paid or notes', async () => {
    saveGraded(a, draft(p, { notes: 'from a card show' }), T1)
    await sync(a)
    const friend = portal.addUser('friend')
    const asFriend = createCloudClient({
      baseUrl: PORTAL,
      token: await portal.desktopToken(friend),
      fetch: portal.fetch
    })
    await expect(asFriend.rpc('friends:graded', [user], 'ygo')).rejects.toThrow()
    requestFriend(portal.serverDb, friend, 'owner', T1)
    acceptFriend(portal.serverDb, user, friend, T2)
    const seen = await asFriend.rpc<GradedCopy[]>('friends:graded', [user], 'ygo')
    expect(seen).toEqual([
      expect.objectContaining({ company: 'PSA', grade: '10', cert: '12345678', value: 250 })
    ])
    expect(seen[0]).toMatchObject({ paid: null, notes: '' })
    expect(await asFriend.rpc('friends:graded', [user], 'pkm')).toEqual([])
  })
})
