import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'
import { createCloudClient, CloudAuthError, type CloudClient } from '../../src/main/cloud/client'
import { syncOnce } from '../../src/main/cloud/engine'
import {
  accountState,
  adoptLocalData,
  ensureAccount,
  gameCursor,
  hasLocalData,
  saveGameCursor,
  setActiveOwner
} from '../../src/main/cloud/localSync'
import { getMeta } from '../../src/main/db/meta'
import {
  getBinder,
  listBinders,
  removeBinder,
  saveBinder,
  setBinderEdit
} from '../../src/main/repo/binders'
import { localScope } from '../../src/main/repo/scope'
import type { BinderDraft } from '../../src/shared/binders'
import { withOwnerOnlyPokemon } from '../fixtures/ownerOnlyGame'
import { seedPokemon } from '../fixtures/pokemon'
import { inProcessPortal, PORTAL } from './cloudHelpers'
import { seededDb } from './helpers'

withOwnerOnlyPokemon()

const T1 = new Date('2026-10-25T11:00:00.000Z')
const T2 = new Date('2026-10-25T12:00:00.000Z')
const T3 = new Date('2026-10-25T13:00:00.000Z')
const NOW = (): Date => new Date('2026-10-25T20:00:00.000Z')

const draft = (over: Partial<BinderDraft> = {}): BinderDraft => ({
  name: 'Mine',
  rules: { version: 1, rules: [] },
  goal: 'card',
  languages: ['en'],
  friendsVisible: true,
  ...over
})

const cardId = (db: Database.Database): number =>
  (db.prepare('SELECT id FROM cards ORDER BY id LIMIT 1').get() as { id: number }).id

const binderRows = (db: Database.Database): Record<string, unknown>[] =>
  db
    .prepare('SELECT owner_id, uid, name, rules, deleted_at, dirty FROM binders ORDER BY uid')
    .all() as Record<string, unknown>[]

const editRows = (db: Database.Database): Record<string, unknown>[] =>
  db
    .prepare(
      `SELECT owner_id, binder_uid, level, target, action, deleted_at, dirty FROM binder_edits
       ORDER BY binder_uid, level, target`
    )
    .all() as Record<string, unknown>[]

describe('binder sync', () => {
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
  /** The portal, with `answer` taking over every binder route. */
  const breakBinders = (answer: () => Response): typeof fetch =>
    (async (input: RequestInfo | URL, init?: RequestInit) =>
      /\/api\/sync\/binder/.test(String(input))
        ? answer()
        : portal.fetch(input, init)) as typeof fetch

  const serverBinders = (): Record<string, unknown>[] =>
    portal.serverDb
      .prepare('SELECT uid, name, rules, deleted_at FROM binders WHERE user_id = ?')
      .all(user) as Record<string, unknown>[]
  const serverEdits = (): Record<string, unknown>[] =>
    portal.serverDb
      .prepare(
        'SELECT binder_uid, level, target, action, deleted_at FROM binder_edits WHERE user_id = ?'
      )
      .all(user) as Record<string, unknown>[]

  beforeEach(async () => {
    portal = await inProcessPortal()
    user = portal.addUser('owner')
    a = await device()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('two devices round-trip a binder and its edits', async () => {
    const uid = saveBinder(a, draft({ name: 'Dragons' }), T1)
    const target = { level: 'card', target: String(cardId(a)) } as const
    setBinderEdit(a, uid, target, 'add', T1)
    await sync(a)
    expect(binderRows(a)).toEqual([expect.objectContaining({ dirty: 0 })])
    expect(editRows(a)).toEqual([expect.objectContaining({ dirty: 0 })])
    expect(serverBinders()).toMatchObject([{ uid, name: 'Dragons', deleted_at: null }])
    expect(serverEdits()).toMatchObject([{ binder_uid: uid, action: 'add', deleted_at: null }])

    const b = await device()
    await sync(b)
    expect(listBinders(b)).toMatchObject([
      { uid, name: 'Dragons', goal: 'card', languages: ['en'] }
    ])
    expect(getBinder(b, uid)?.cards).toHaveLength(1)
    expect(binderRows(b)).toEqual([expect.objectContaining({ dirty: 0 })])
    expect(editRows(b)).toEqual([expect.objectContaining({ dirty: 0 })])

    saveBinder(b, draft({ uid, name: 'Wyrms', friendsVisible: false }), T2)
    setBinderEdit(b, uid, target, null, T2)
    await sync(b)
    await sync(a)
    expect(listBinders(a)).toMatchObject([{ name: 'Wyrms', friendsVisible: false }])
    expect(getBinder(a, uid)?.cards).toEqual([])
    expect(editRows(a)).toEqual([])
    expect(editRows(b)).toEqual([])
    // The server keeps the edit's tombstone for other devices.
    expect(serverEdits()).toMatchObject([{ deleted_at: T2.toISOString() }])
  })

  it("keeps Yu-Gi-Oh!'s binder cursors apart from its entries and price cursors", async () => {
    saveBinder(a, draft(), T1)
    await sync(a)
    await sync(a) // the second run pulls the first one's echo
    expect(gameCursor(a, user, 'ygo', 'binders')).toBeGreaterThan(0)
    expect(accountState(a, user).cursor).toBe(0)

    saveGameCursor(a, user, 'ygo', 'binderEdits', 7)
    saveGameCursor(a, user, 'ygo', 'binders', 9)
    expect(gameCursor(a, user, 'ygo', 'binderEdits')).toBe(7)
    expect(gameCursor(a, user, 'ygo', 'binders')).toBe(9)
    expect(accountState(a, user).cursor).toBe(0)
    expect(getMeta(a, 'price_feed_cursor')).not.toBe('9')

    saveGameCursor(a, user, 'ygo', 'entries', 3)
    expect(accountState(a, user).cursor).toBe(3)
    expect(gameCursor(a, user, 'ygo', 'binders')).toBe(9)
  })

  it("an older portal's 404 doesn't fail the collection sync, and the rows stay queued", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    saveBinder(a, draft(), T1)
    const old = breakBinders(() => Response.json({ error: 'Not found' }, { status: 404 }))
    await expect(syncOnce(a, user, await clientFor(old), NOW)).resolves.toMatchObject({
      unsynced: 0
    })
    expect(accountState(a, user).syncedAt).not.toBeNull()
    expect(binderRows(a)).toEqual([expect.objectContaining({ dirty: 1 })])
    expect(warn).not.toHaveBeenCalled()

    await sync(a)
    expect(serverBinders()).toHaveLength(1)
  })

  it.each([
    ['a refused request', 400, true],
    ['a failing portal', 500, false]
  ])("%s on the binder routes doesn't fail the collection sync", async (_, status, warns) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    saveBinder(a, draft(), T1)
    const broken = breakBinders(() => Response.json({ error: 'no' }, { status }))
    await expect(syncOnce(a, user, await clientFor(broken), NOW)).resolves.toBeDefined()
    expect(binderRows(a)).toEqual([expect.objectContaining({ dirty: 1 })])
    expect(warn).toHaveBeenCalledTimes(warns ? 1 : 0)
  })

  it('a signed-out answer on the binder routes still ends the run', async () => {
    const signedOut = breakBinders(() => new Response('{}', { status: 401 }))
    await expect(syncOnce(a, user, await clientFor(signedOut), NOW)).rejects.toThrow(CloudAuthError)
  })

  it('owner-0 binders and edits count as local data and move on sign-in, dirty', async () => {
    const local = await seededDb()
    expect(hasLocalData(local)).toBe(false)
    const uid = saveBinder(local, draft({ name: 'Before sign-in' }), T1)
    expect(hasLocalData(local)).toBe(true)
    setBinderEdit(local, uid, { level: 'card', target: String(cardId(local)) }, 'add', T1)
    const gone = saveBinder(local, draft({ name: 'Gone' }), T1)
    removeBinder(local, gone, T2)

    // A device that only ever made an edit, with its binder not here, still has local data.
    const onlyEdit = await seededDb()
    onlyEdit
      .prepare(
        `INSERT INTO binder_edits (owner_id, binder_uid, level, target, game, action, created_at, updated_at)
         VALUES (0, 'b', 'card', '1', 'ygo', 'add', ?, ?)`
      )
      .run(T1.toISOString(), T1.toISOString())
    expect(hasLocalData(onlyEdit)).toBe(true)

    adoptLocalData(local, user)
    expect(hasLocalData(local)).toBe(false)
    expect(binderRows(local).map((r) => [r.owner_id, r.dirty])).toEqual([
      [user, 1],
      [user, 1]
    ])
    expect(editRows(local)).toEqual([expect.objectContaining({ owner_id: user, dirty: 1 })])

    ensureAccount(local, user, 'owner')
    setActiveOwner(local, user)
    await sync(local)
    expect(serverBinders()).toMatchObject([{ uid, name: 'Before sign-in' }])
    expect(serverEdits()).toMatchObject([{ binder_uid: uid }])
    expect(listBinders(local)).toMatchObject([{ uid }])
  })

  it('a binder key the owner already has keeps the owner row, and owner 0 is emptied', () => {
    const insert = (db: Database.Database, owner: number, name: string, action: string): void => {
      const at = T1.toISOString()
      db.prepare(
        `INSERT INTO binders (owner_id, uid, game, name, rules, goal, languages, created_at, updated_at)
         VALUES (?, 'x', 'ygo', ?, '{}', 'card', '[]', ?, ?)`
      ).run(owner, name, at, at)
      db.prepare(
        `INSERT INTO binder_edits (owner_id, binder_uid, level, target, game, action, created_at, updated_at)
         VALUES (?, 'x', 'card', '1', 'ygo', ?, ?, ?)`
      ).run(owner, action, at, at)
    }
    insert(a, 0, 'From owner 0', 'remove')
    insert(a, user, 'The owner', 'add')
    adoptLocalData(a, user)
    expect(binderRows(a)).toMatchObject([{ owner_id: user, name: 'The owner' }])
    expect(editRows(a)).toMatchObject([{ owner_id: user, action: 'add' }])
  })

  it('purges a tombstone only after the server has it', async () => {
    const uid = saveBinder(a, draft(), T1)
    setBinderEdit(a, uid, { level: 'card', target: '1' }, 'add', T1)
    await sync(a)
    removeBinder(a, uid, T2)

    const down = breakBinders(() => new Response('', { status: 503 }))
    await syncOnce(a, user, await clientFor(down), NOW)
    expect(binderRows(a)).toEqual([
      expect.objectContaining({ deleted_at: T2.toISOString(), dirty: 1 })
    ])
    expect(editRows(a)).toEqual([
      expect.objectContaining({ deleted_at: T2.toISOString(), dirty: 1 })
    ])

    await sync(a)
    expect(binderRows(a)).toEqual([])
    expect(editRows(a)).toEqual([])
    expect(serverBinders()).toMatchObject([{ deleted_at: T2.toISOString() }])
    expect(serverEdits()).toMatchObject([{ deleted_at: T2.toISOString() }])
  })

  it('a binder deleted on A while B adds an edit stays deleted on both, the edit ignored', async () => {
    const b = await device()
    const uid = saveBinder(a, draft(), T1)
    await sync(a)
    await sync(b)

    removeBinder(a, uid, T2)
    setBinderEdit(b, uid, { level: 'card', target: String(cardId(b)) }, 'add', T3)
    await sync(a)
    await sync(b)
    await sync(a)
    await sync(b)

    expect(listBinders(a)).toEqual([])
    expect(listBinders(b)).toEqual([])
    expect(getBinder(a, uid)).toBeNull()
    expect(getBinder(b, uid)).toBeNull()
    expect(binderRows(a)).toEqual([])
    expect(binderRows(b)).toEqual([])
    expect(serverBinders()).toMatchObject([{ deleted_at: T2.toISOString() }])
    // Stored as any other edit: nothing dirty is left, so it isn't sent again.
    expect(serverEdits()).toMatchObject([{ action: 'add', deleted_at: null }])
    for (const rows of [editRows(a), editRows(b)])
      expect(rows.filter((r) => r.dirty === 1)).toEqual([])
  })

  it('an edit that beats its binder here is kept for when the binder comes', async () => {
    const b = await device()
    // The edit arrives with no binder here, as when the binder is written between the two pulls.
    const uid = saveBinder(a, draft(), T1)
    setBinderEdit(a, uid, { level: 'card', target: String(cardId(a)) }, 'add', T1)
    await sync(a)
    const onlyEdits = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/binders-pull')
        ? Response.json({ entries: [], cursor: 0, more: false })
        : portal.fetch(input, init)) as typeof fetch
    await syncOnce(b, user, await clientFor(onlyEdits), NOW)
    expect(editRows(b)).toHaveLength(1)
    expect(listBinders(b)).toEqual([])

    await sync(b)
    expect(getBinder(b, uid)?.cards).toHaveLength(1)
  })

  it('a version 2 binder passes through a client unchanged and is not marked dirty', async () => {
    const rules = JSON.stringify({
      version: 2,
      rules: [{ kind: 'from-the-future', x: [1, { y: 2 }] }]
    })
    const at = T1.toISOString()
    portal.serverDb
      .prepare(
        `INSERT INTO binders (user_id, uid, game, name, rules, goal, languages, friends_visible, sort_order,
                              created_at, updated_at, deleted_at, seq)
         VALUES (?, 'future', 'ygo', 'Future', ?, 'someday', '["en","xx"]', 1, 4, ?, ?, NULL, 1)`
      )
      .run(user, rules, at, at)
    const before = serverBinders()

    await sync(a)
    expect(binderRows(a)).toEqual([expect.objectContaining({ rules, dirty: 0 })])
    expect(listBinders(a)).toMatchObject([{ uid: 'future', editable: false }])

    await sync(a)
    expect(binderRows(a)).toEqual([expect.objectContaining({ rules, dirty: 0 })])
    expect(serverBinders()).toEqual(before)
    const stored = a
      .prepare('SELECT goal, languages, sort_order, created_at FROM binders')
      .get() as Record<string, unknown>
    expect(stored).toEqual({
      goal: 'someday',
      languages: '["en","xx"]',
      sort_order: 4,
      created_at: at
    })
  })

  it('a newer unpushed edit survives a pull and wins; an older one takes the server row', async () => {
    const b = await device()
    const uid = saveBinder(a, draft({ name: 'One' }), T1)
    await sync(a)
    await sync(b)

    saveBinder(a, draft({ uid, name: 'Older' }), T2)
    saveBinder(b, draft({ uid, name: 'Newer' }), T3)
    await sync(b)
    await sync(a)
    await sync(b)
    expect(listBinders(a)).toMatchObject([{ name: 'Newer' }])
    expect(listBinders(b)).toMatchObject([{ name: 'Newer' }])
    expect(binderRows(a)).toEqual([expect.objectContaining({ dirty: 0 })])

    const key = { level: 'card', target: '1' } as const
    setBinderEdit(a, uid, key, 'add', T2)
    setBinderEdit(b, uid, key, 'remove', T3)
    await sync(a) // the server takes A's older edit, then B's
    await sync(b)
    await sync(a)
    expect(serverEdits()).toMatchObject([{ action: 'remove' }])
    expect(editRows(a)).toEqual([expect.objectContaining({ action: 'remove', dirty: 0 })])
    expect(editRows(b)).toEqual([expect.objectContaining({ action: 'remove', dirty: 0 })])
  })

  it('leaves rows the server skips dirty, without failing the sync or holding up the rest', async () => {
    seedPokemon(a)
    const blocked = saveBinder(a, draft({ name: 'Pikas' }), T1, localScope("'pkm'"))
    setBinderEdit(a, blocked, { level: 'card', target: '1' }, 'add', T1, localScope("'pkm'"))
    const fine = saveBinder(a, draft({ name: 'Dragons' }), T1)
    await sync(a)
    await sync(a) // and doesn't loop on them, this run or the next

    expect(serverBinders()).toMatchObject([{ uid: fine }])
    expect(serverEdits()).toEqual([])
    expect(binderRows(a).filter((r) => r.dirty === 1)).toMatchObject([{ uid: blocked }])
    expect(editRows(a)).toMatchObject([{ binder_uid: blocked, dirty: 1 }])
  })
})
