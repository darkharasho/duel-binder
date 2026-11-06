import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { createCatalogService, type CatalogService } from '../../src/main/catalog/service'
import { getMeta, setMeta } from '../../src/main/db/meta'
import {
  createAccountService,
  SERVER_SIGNED_OUT,
  type AccountService
} from '../../src/main/cloud/account'
import { CloudAuthError, createCloudClient } from '../../src/main/cloud/client'
import { activeOwner, setActiveOwner } from '../../src/main/cloud/localSync'
import { TokenStore, type Cipher } from '../../src/main/cloud/tokenStore'
import { addEntry, listEntries, updateEntry } from '../../src/main/repo/collection'
import type { Me } from '../../src/shared/cloud'
import { FRIENDS_SIGNED_OUT, OFFLINE_MESSAGE } from '../../src/shared/friends'
import type { AccountStatus } from '../../src/shared/types'
import { userScope } from '../../workers/portal/src/scope'
import { runPriceAlarm } from '../../workers/portal/src/prices'
import type { PriceClient } from '../../src/main/prices/client'
import { inProcessPortal, PORTAL } from './cloudHelpers'
import { seededDb } from './helpers'
import { withOwnerOnlyPokemon } from '../fixtures/ownerOnlyGame'

withOwnerOnlyPokemon()

const ALL = { sort: 'name', dir: 'asc' } as const
const T1 = new Date('2026-10-25T11:00:00.000Z')
const T2 = new Date('2026-10-25T12:00:00.000Z')
const T3 = new Date('2026-10-25T13:00:00.000Z')
const NOW = (): Date => new Date('2026-10-25T20:00:00.000Z')
const DM = 46986414
const POT = 55144522

const fakeCipher: Cipher = {
  encrypt: (plain) => Buffer.from('enc:' + [...plain].reverse().join(''), 'utf8'),
  decrypt: (buf) => {
    const s = buf.toString('utf8')
    if (!s.startsWith('enc:')) throw new Error('bad blob')
    return [...s.slice(4)].reverse().join('')
  }
}

type Portal = Awaited<ReturnType<typeof inProcessPortal>>

let portal: Portal
let dir: string
let db: Database.Database
let alice: number
let bob: number
let online: boolean
/** When set, every portal request fails as a network error. */
let unreachable: boolean
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
let fetchSpy: Mock<Fetch>
/** While set, push requests wait for it, failing like a real fetch when their signal aborts. */
let pushGate: Promise<void> | null
/** When set, the portal's /api/me answers with this `mergedFrom`. */
let meMergedFrom: number[] | null
let nextSignIn: { token: string; user: Me } | null
let emitted: AccountStatus[]
let emitDataChanged: Mock<() => void>
let onCatalogChanged: Mock<(r: { imagesChanged: boolean }) => void>
let catalog: CatalogService
const services: AccountService[] = []

const pid = (d: Database.Database, code: string): number =>
  (d.prepare('SELECT id FROM card_printings WHERE set_code = ?').get(code) as { id: number }).id

interface Row {
  uid: string
  owner_id: number
  quantity: number
  deleted_at: string | null
  dirty: number
}
const localRows = (): Row[] =>
  db
    .prepare(
      'SELECT uid, owner_id, quantity, deleted_at, dirty FROM collection_entries ORDER BY id'
    )
    .all() as Row[]
const serverRows = (
  userId: number
): { uid: string; quantity: number; deleted_at: string | null }[] =>
  portal.serverDb
    .prepare(
      'SELECT uid, quantity, deleted_at FROM collection_entries WHERE user_id = ? ORDER BY server_seq'
    )
    .all(userId) as { uid: string; quantity: number; deleted_at: string | null }[]
const catalogCalls = (): number =>
  fetchSpy.mock.calls.filter(([input]) => String(input).includes('/api/catalog/changes')).length
const firstCall = (path: string): number =>
  fetchSpy.mock.calls.findIndex(([input]) => String(input).includes(path))
const cardName = (d: Database.Database, id: number): string =>
  (d.prepare('SELECT name FROM cards WHERE id = ?').get(id) as { name: string }).name

/** Marks the desktop as already on the server's catalog, up to date with its feed. */
function switchedAndCurrent(d: Database.Database): void {
  const { seq } = portal.serverDb.prepare('SELECT seq FROM catalog_clock').get() as { seq: number }
  setMeta(d, 'catalog_switched_at', '2026-10-24T00:00:00.000Z')
  setMeta(d, 'catalog_cursor', String(seq))
}

const pushCalls = (): number =>
  fetchSpy.mock.calls.filter(([input]) => String(input).includes('/api/sync/push')).length

const me = (id: number, username: string): Me => ({
  id,
  username,
  displayName: null,
  avatarUrl: null
})

/** The next browser sign-in finishes as this user with a fresh desktop token; returns the token. */
async function willSignInAs(user: Me): Promise<string> {
  const token = await portal.desktopToken(user.id)
  nextSignIn = { token, user }
  return token
}

const tokenFile = (): string => join(dir, 'account.json')

function makeService(opts: { signInRequired?: boolean } = {}): AccountService {
  const service = createAccountService({
    db,
    tokens: new TokenStore(tokenFile(), fakeCipher),
    client: (token, opts = {}) =>
      createCloudClient({
        baseUrl: PORTAL,
        token,
        fetch: fetchSpy as unknown as typeof fetch,
        timeoutMs: opts.timeoutMs,
        signal: opts.signal
      }),
    signIn: async () => {
      if (!nextSignIn) throw new Error("Sign-in didn't go through")
      const out = nextSignIn
      nextSignIn = null
      return out
    },
    emit: (s) => emitted.push(s),
    emitDataChanged,
    isOnline: () => online,
    catalog,
    onCatalogChanged,
    ...opts,
    now: NOW
  })
  services.push(service)
  return service
}

/** Signs in and waits for the first sync to finish. */
async function signInAs(service: AccountService, user: Me): Promise<string> {
  const token = await willSignInAs(user)
  const s = await service.signIn()
  expect(s.user?.id).toBe(user.id)
  await service.syncNow()
  return token
}

const authCheck = (token: string): Promise<Me> =>
  createCloudClient({ baseUrl: PORTAL, token, fetch: portal.fetch }).me()

beforeEach(async () => {
  portal = await inProcessPortal()
  alice = portal.addUser('alice')
  bob = portal.addUser('bob')
  db = await seededDb()
  switchedAndCurrent(db)
  dir = mkdtempSync(join(tmpdir(), 'duel-binder-account-'))
  online = true
  unreachable = false
  pushGate = null
  meMergedFrom = null
  nextSignIn = null
  emitted = []
  emitDataChanged = vi.fn<() => void>()
  onCatalogChanged = vi.fn<(r: { imagesChanged: boolean }) => void>()
  catalog = createCatalogService({
    db,
    backupPath: () => join(dir, 'backups', 'pre-server-catalog.sqlite'),
    emit: () => {},
    now: NOW,
    launchedAt: new Date('2026-10-25T19:00:00.000Z')
  })
  fetchSpy = vi.fn<Fetch>(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (unreachable) throw new TypeError('fetch failed')
    if (pushGate && String(input).includes('/api/sync/push')) {
      const gate = pushGate
      await new Promise<void>((resolve, reject) => {
        void gate.then(resolve)
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted', 'AbortError'))
        )
      })
    }
    const res = await portal.fetch(input, init)
    if (meMergedFrom && String(input).endsWith('/api/me')) {
      return Response.json({ ...(await res.json()), mergedFrom: meMergedFrom })
    }
    return res
  })
})

const revokeCalls = (): number =>
  fetchSpy.mock.calls.filter(([input]) => String(input).includes('/auth/desktop/revoke')).length

/** Push requests block until the returned function is called. */
function blockPushes(): () => void {
  let open!: () => void
  pushGate = new Promise<void>((r) => (open = r))
  return () => {
    pushGate = null
    open()
  }
}

afterEach(() => {
  for (const s of services.splice(0)) s.stop()
  db.close()
  portal.serverDb.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('account service', () => {
  it('starts signed out, showing no account', () => {
    const service = makeService()
    expect(service.status()).toEqual({
      state: 'signed-out',
      user: null,
      localOwner: null,
      lastSyncedAt: null,
      error: null,
      pendingCount: 0,
      unsyncedCount: 0,
      signInRequired: true
    })
    expect(service.isSignedIn()).toBe(false)
  })

  it('reports when the app can be used signed out', () => {
    expect(makeService({ signInRequired: false }).status().signInRequired).toBe(false)
  })

  it('first sign-in adopts never-signed-in cards without asking', async () => {
    addEntry(db, { printingId: pid(db, 'LOB-EN005'), imageId: DM, quantity: 2 }, T1)
    addEntry(db, { printingId: pid(db, 'LOB-EN119'), imageId: POT, quantity: 1 }, T1)
    const service = makeService()
    await signInAs(service, me(alice, 'alice'))

    expect(localRows().map((r) => [r.owner_id, r.dirty])).toEqual([
      [alice, 0],
      [alice, 0]
    ])
    expect(
      serverRows(alice)
        .map((r) => r.uid)
        .sort()
    ).toEqual(
      localRows()
        .map((r) => r.uid)
        .sort()
    )
    expect(listEntries(db, ALL)).toHaveLength(2)
    expect(emitDataChanged).toHaveBeenCalled()
    expect(service.status()).toMatchObject({
      state: 'idle',
      user: { id: alice, username: 'alice' },
      localOwner: 'alice',
      lastSyncedAt: NOW().toISOString(),
      error: null
    })
    expect(service.isSignedIn()).toBe(true)
  })

  it("signing in to a merged account adopts the old owner's unsent rows", async () => {
    setActiveOwner(db, alice)
    addEntry(db, { printingId: pid(db, 'LOB-EN005'), imageId: DM, quantity: 3 }, T1)
    const oldUid = localRows()[0].uid
    const service = makeService()
    await signInAs(service, { ...me(bob, 'bob'), mergedFrom: [alice] })

    expect(activeOwner(db)).toBe(bob)
    const rows = localRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ owner_id: bob, quantity: 3, dirty: 0 })
    expect(rows[0].uid).not.toBe(oldUid)
    expect(serverRows(bob).map((r) => r.uid)).toEqual([rows[0].uid])
  })

  it("a sync whose me() reports a merge adopts the old owner's unsent rows and pushes them", async () => {
    addEntry(db, { printingId: pid(db, 'LOB-EN005'), imageId: DM, quantity: 1 }, T1)
    const service = makeService()
    await signInAs(service, me(bob, 'bob'))
    // Signed out, this device holds unsent rows of alice, one on a card bob already has.
    await service.signOut()
    setActiveOwner(db, alice)
    addEntry(db, { printingId: pid(db, 'LOB-EN005'), imageId: DM, quantity: 4 }, T2)
    addEntry(db, { printingId: pid(db, 'LOB-EN119'), imageId: POT, quantity: 2 }, T2)
    await willSignInAs(me(bob, 'bob'))
    await service.signIn()
    meMergedFrom = [alice]
    await service.syncNow()
    await service.syncNow()

    expect(localRows().every((r) => r.owner_id === bob && r.dirty === 0)).toBe(true)
    expect(
      localRows()
        .map((r) => r.quantity)
        .sort()
    ).toEqual([2, 4])
    expect(
      serverRows(bob)
        .map((r) => r.quantity)
        .sort()
    ).toEqual([2, 4])
  })

  it('a carried lower count never lowers the merged count on a device that never held it', async () => {
    // Bob (the merged account) has 4 on the server; this device only ever held alice, with an unsent 2.
    portal.serverDb
      .prepare(
        `INSERT INTO collection_entries (user_id, uid, game, printing_id, image_id, quantity, notes, created_at, updated_at, deleted_at, server_seq)
         VALUES (?, 'merged-uid', 'ygo', ?, ?, 4, '', ?, ?, NULL,
           (SELECT COALESCE(MAX(server_seq), 0) + 1 FROM collection_entries))`
      )
      .run(bob, pid(portal.serverDb, 'LOB-EN005'), DM, T1.toISOString(), T1.toISOString())
    setActiveOwner(db, alice)
    addEntry(db, { printingId: pid(db, 'LOB-EN005'), imageId: DM, quantity: 2 }, T2)
    addEntry(db, { printingId: pid(db, 'LOB-EN119'), imageId: POT, quantity: 3 }, T2)
    const service = makeService()
    await signInAs(service, { ...me(bob, 'bob'), mergedFrom: [alice] })
    await service.syncNow()

    const live = serverRows(bob).filter((r) => r.deleted_at === null)
    expect(live.map((r) => r.quantity).sort()).toEqual([3, 4])
    expect(live.find((r) => r.quantity === 4)?.uid).toBe('merged-uid')
    expect(
      localRows()
        .filter((r) => r.deleted_at === null)
        .map((r) => [r.owner_id, r.quantity])
        .sort()
    ).toEqual([
      [bob, 3],
      [bob, 4]
    ])
  })

  it("switching A→B→A restores A, including A's signed-out edit", async () => {
    addEntry(db, { printingId: pid(db, 'LOB-EN005'), imageId: DM, quantity: 2 }, T1)
    const service = makeService()

    // 1. Alice signs in, syncs and signs out, then edits while signed out.
    await signInAs(service, me(alice, 'alice'))
    await service.signOut()
    const [aliceCard] = listEntries(db, ALL)
    updateEntry(db, aliceCard.id, { quantity: 7 }, T2)
    const [aliceRow] = localRows()
    expect(aliceRow).toMatchObject({ owner_id: alice, quantity: 7, dirty: 1 })
    expect(service.status()).toMatchObject({ state: 'signed-out', user: null, localOwner: 'alice' })

    // 2. Bob signs in: only Bob's server collection shows; Alice's rows are untouched and not pushed.
    addEntry(
      portal.serverDb,
      { printingId: pid(portal.serverDb, 'LOB-EN119'), imageId: POT, quantity: 3 },
      T1,
      userScope(bob, 'ygo')
    )
    emitDataChanged.mockClear()
    await signInAs(service, me(bob, 'bob'))
    expect(emitDataChanged).toHaveBeenCalled()
    expect(listEntries(db, ALL).map((e) => [e.card.id, e.quantity])).toEqual([[POT, 3]])
    expect(localRows().find((r) => r.uid === aliceRow.uid)).toEqual(aliceRow)
    expect(serverRows(bob).map((r) => r.uid)).not.toContain(aliceRow.uid)
    expect(serverRows(bob)).toHaveLength(1)
    expect(serverRows(alice)).toEqual([{ uid: aliceRow.uid, quantity: 2, deleted_at: null }])
    expect(service.status()).toMatchObject({ user: { id: bob }, localOwner: 'bob' })

    // 3. Bob signs out and Alice signs back in: her cards return with the edit, and it reaches the server.
    await service.signOut()
    await signInAs(service, me(alice, 'alice'))
    expect(listEntries(db, ALL).map((e) => [e.card.id, e.quantity])).toEqual([[DM, 7]])
    expect(serverRows(alice)).toEqual([{ uid: aliceRow.uid, quantity: 7, deleted_at: null }])
    expect(localRows().filter((r) => r.owner_id === bob)).toHaveLength(1)
    expect(service.status()).toMatchObject({ user: { id: alice }, localOwner: 'alice' })
  })

  it('sign-out pushes first, then revokes and keeps the cards and owner', async () => {
    const service = makeService()
    const token = await signInAs(service, me(alice, 'alice'))
    addEntry(db, { printingId: pid(db, 'LOB-EN005'), imageId: DM, quantity: 4 }, T2)
    expect(localRows()[0].dirty).toBe(1)

    const s = await service.signOut()

    expect(serverRows(alice)).toEqual([{ uid: localRows()[0].uid, quantity: 4, deleted_at: null }])
    expect(localRows()[0].dirty).toBe(0)
    await expect(authCheck(token)).rejects.toBeInstanceOf(CloudAuthError)
    expect(s).toMatchObject({ state: 'signed-out', user: null, localOwner: 'alice', error: null })
    expect(activeOwner(db)).toBe(alice)
    expect(listEntries(db, ALL)).toHaveLength(1)
    expect(getMeta(db, 'cloud_user')).toBeNull()
    expect(new TokenStore(tokenFile(), fakeCipher).get()).toBeNull()
    expect(service.isSignedIn()).toBe(false)
  })

  it('sign-out offline still signs out; revoke is retried on next start', async () => {
    const service = makeService()
    const token = await signInAs(service, me(alice, 'alice'))
    addEntry(db, { printingId: pid(db, 'LOB-EN005'), imageId: DM, quantity: 4 }, T2)
    unreachable = true

    const s = await service.signOut()

    expect(s).toMatchObject({ state: 'signed-out', user: null, localOwner: 'alice' })
    // The failed final push leaves the edit dirty for Alice.
    expect(localRows()).toEqual([expect.objectContaining({ owner_id: alice, dirty: 1 })])
    expect(serverRows(alice)).toEqual([])
    const store = new TokenStore(tokenFile(), fakeCipher)
    expect(store.get()).toBeNull()
    expect(store.pendingRevokes()).toEqual([token])
    await expect(authCheck(token)).resolves.toMatchObject({ id: alice })

    // Back online, the next app start revokes it.
    unreachable = false
    service.stop()
    makeService().start()
    await vi.waitFor(() => expect(store.pendingRevokes()).toEqual([]))
    await expect(authCheck(token)).rejects.toBeInstanceOf(CloudAuthError)
  })

  describe('error reports', () => {
    const details = { appVersion: '1.2.3', message: 'boom at /home/alice/x', stack: 'at y' }
    const stored = (): unknown[] =>
      portal.serverDb.prepare('SELECT platform, message FROM error_reports').all()

    it('sends one as the desktop, scrubbed, with nothing about the account', async () => {
      const service = makeService()
      await signInAs(service, me(alice, 'alice'))
      await service.reportError(details)
      expect(stored()).toEqual([{ platform: 'desktop', message: 'boom at /home/~/x' }])
    })

    it('drops it signed out, offline, or when it is malformed', async () => {
      const service = makeService()
      await service.reportError(details)
      await signInAs(service, me(alice, 'alice'))
      await expect(service.reportError(null)).resolves.toBeUndefined()
      online = false
      await service.reportError(details)
      expect(stored()).toEqual([])
    })

    it('ignores an older portal without the route, and stays signed in', async () => {
      const service = makeService()
      await signInAs(service, me(alice, 'alice'))
      fetchSpy.mockImplementationOnce(async () => new Response('{}', { status: 404 }))
      await expect(service.reportError(details)).resolves.toBeUndefined()
      expect(service.isSignedIn()).toBe(true)
    })
  })

  it('a 401 during sync signs out without losing data', async () => {
    const service = makeService()
    await signInAs(service, me(alice, 'alice'))
    addEntry(db, { printingId: pid(db, 'LOB-EN005'), imageId: DM, quantity: 4 }, T2)
    portal.serverDb.prepare('DELETE FROM sessions').run()
    const before = pushCalls()
    const revokesBefore = revokeCalls()

    const s = await service.syncNow()

    expect(s).toMatchObject({
      state: 'signed-out',
      user: null,
      localOwner: 'alice',
      error: SERVER_SIGNED_OUT
    })
    expect(pushCalls()).toBe(before + 1)
    expect(localRows()).toEqual([
      expect.objectContaining({ owner_id: alice, quantity: 4, dirty: 1 })
    ])
    expect(listEntries(db, ALL)).toHaveLength(1)
    const store = new TokenStore(tokenFile(), fakeCipher)
    expect(store.get()).toBeNull()
    expect(store.pendingRevokes()).toEqual([])

    // No further runs.
    service.noteLocalEdit()
    service.catalogRefreshed()
    await service.syncNow()
    await new Promise((r) => setTimeout(r, 20))
    expect(pushCalls()).toBe(before + 1)
    expect(service.status().error).toBe(SERVER_SIGNED_OUT)
    expect(revokeCalls()).toBe(revokesBefore)
  })

  it('the token never appears in status or events', async () => {
    addEntry(db, { printingId: pid(db, 'LOB-EN005'), imageId: DM, quantity: 2 }, T1)
    const service = makeService()
    service.start()
    const token = await signInAs(service, me(alice, 'alice'))
    await service.syncNow()
    const signedIn = service.status()
    await service.signOut()
    const all = JSON.stringify([emitted, signedIn, service.status()])
    expect(emitted.length).toBeGreaterThan(3)
    expect(all).not.toContain(token)
    expect(all).not.toMatch(/token/i)
  })

  it('a catalog refresh applies pending entries', async () => {
    // The server holds a card on a printing this computer's catalog doesn't have yet.
    addEntry(
      portal.serverDb,
      { printingId: pid(portal.serverDb, 'LOB-EN119'), imageId: POT, quantity: 2 },
      T1,
      userScope(alice, 'ygo')
    )
    db.prepare(
      "UPDATE card_printings SET set_code = 'ZZ-LOB-EN119' WHERE set_code = 'LOB-EN119'"
    ).run()
    const service = makeService()
    await signInAs(service, me(alice, 'alice'))
    expect(listEntries(db, ALL)).toEqual([])
    expect(service.status().pendingCount).toBe(1)

    // The catalog gains the printing.
    db.prepare(
      "UPDATE card_printings SET set_code = 'LOB-EN119' WHERE set_code = 'ZZ-LOB-EN119'"
    ).run()
    emitDataChanged.mockClear()
    service.catalogRefreshed()
    expect(listEntries(db, ALL).map((e) => [e.card.id, e.quantity])).toEqual([[POT, 2]])
    expect(emitDataChanged).toHaveBeenCalledTimes(1)
    expect(service.status().pendingCount).toBe(0)
  })

  it('updates the catalog before pushing', async () => {
    // The server gains a printing this computer doesn't have, and a web entry on it.
    portal.serverDb
      .prepare(
        "INSERT INTO card_printings (card_id, set_name, set_code, set_rarity, language) VALUES (?, 'Server Set', 'SRV-EN001', 'Common', 'en')"
      )
      .run(DM)
    addEntry(
      portal.serverDb,
      { printingId: pid(portal.serverDb, 'SRV-EN001'), imageId: DM, quantity: 2 },
      T1,
      userScope(alice, 'ygo')
    )
    const service = makeService()
    await signInAs(service, me(alice, 'alice'))

    // The catalog was asked before any sync call, so the entry landed without waiting.
    expect(firstCall('/api/catalog/changes')).toBeGreaterThanOrEqual(0)
    expect(firstCall('/api/catalog/changes')).toBeLessThan(firstCall('/api/sync/'))
    expect(onCatalogChanged).toHaveBeenCalledWith({ imagesChanged: false })
    expect(service.status().pendingCount).toBe(0)
    const [entry] = listEntries(db, ALL)
    expect([entry.card.id, entry.quantity]).toEqual([DM, 2])

    // A local edit on it pushes.
    updateEntry(db, entry.id, { quantity: 5 }, T3)
    await service.syncNow()
    expect(serverRows(alice)).toEqual([expect.objectContaining({ quantity: 5 })])
  })

  it('a 401 during the catalog pull signs out and keeps the catalog', async () => {
    const first = makeService()
    await signInAs(first, me(alice, 'alice'))
    first.stop()
    const name = cardName(db, DM)
    const cards = db.prepare('SELECT * FROM cards ORDER BY id').all()
    portal.serverDb.prepare("UPDATE cards SET name = 'Renamed' WHERE id = ?").run(DM)
    portal.serverDb.prepare('DELETE FROM sessions').run()
    const catalogBefore = catalogCalls()
    const pushesBefore = pushCalls()

    const second = makeService()
    second.start()
    await vi.waitFor(() => expect(second.status().state).toBe('signed-out'))

    expect(second.status().error).toBe(SERVER_SIGNED_OUT)
    expect(catalogCalls()).toBe(catalogBefore + 1)
    expect(pushCalls()).toBe(pushesBefore)
    expect(cardName(db, DM)).toBe(name)
    expect(db.prepare('SELECT * FROM cards ORDER BY id').all()).toEqual(cards)
    expect(onCatalogChanged).not.toHaveBeenCalled()
  })

  it('a catalog failure that never reached the server keeps the next run forced', async () => {
    // Fresh enough that only a forced update calls the server.
    setMeta(db, 'last_sync_at', NOW().toISOString())
    const realFetch = fetchSpy.getMockImplementation()!
    let refuse = true
    fetchSpy.mockImplementation(async (input, init) =>
      refuse && String(input).includes('/api/catalog/changes')
        ? new Response(JSON.stringify({ error: 'bad request' }), { status: 400 })
        : realFetch(input, init)
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const service = makeService()
    await signInAs(service, me(alice, 'alice'))
    warn.mockRestore()
    expect(catalog.status().state).toBe('error')
    const before = catalogCalls()

    refuse = false
    await service.syncNow()
    expect(catalogCalls()).toBe(before + 1)
    expect(catalog.status()).toMatchObject({ state: 'idle', error: null })
  })

  it('refreshCatalog forces an update and returns the catalog status', async () => {
    const service = makeService()
    expect(await service.refreshCatalog()).toEqual(catalog.status())
    expect(catalogCalls()).toBe(0)

    await signInAs(service, me(alice, 'alice'))
    portal.serverDb.prepare("UPDATE cards SET name = 'Renamed' WHERE id = ?").run(DM)
    emitDataChanged.mockClear()
    const s = await service.refreshCatalog()
    expect(s).toMatchObject({ state: 'idle', blocked: null, error: null })
    expect(cardName(db, DM)).toBe('Renamed')
    expect(emitDataChanged).toHaveBeenCalledTimes(1)
    expect(onCatalogChanged).toHaveBeenCalledWith({ imagesChanged: false })
  })

  it('a run that pulls web edits tells the renderer', async () => {
    const service = makeService()
    await signInAs(service, me(alice, 'alice'))
    emitDataChanged.mockClear()
    await service.syncNow()
    expect(emitDataChanged).not.toHaveBeenCalled()

    addEntry(
      portal.serverDb,
      { printingId: pid(portal.serverDb, 'LOB-EN005'), imageId: DM, quantity: 3 },
      T3,
      userScope(alice, 'ygo')
    )
    await service.syncNow()
    expect(emitDataChanged).toHaveBeenCalledTimes(1)
    expect(listEntries(db, ALL).map((e) => [e.card.id, e.quantity])).toEqual([[DM, 3]])
  })

  it('the first run refreshes the account name and user from the server', async () => {
    const service = makeService()
    await signInAs(service, {
      id: alice,
      username: 'old',
      displayName: 'Old Name',
      avatarUrl: null
    })
    expect(service.status()).toMatchObject({
      localOwner: 'alice',
      user: { id: alice, username: 'alice', displayName: null }
    })
  })

  it('offline and failing runs show their state; a push the server refuses shows its message', async () => {
    const service = makeService()
    await signInAs(service, me(alice, 'alice'))
    addEntry(db, { printingId: pid(db, 'LOB-EN005'), imageId: DM, quantity: 4 }, T2)

    unreachable = true
    expect(await service.syncNow()).toMatchObject({ state: 'offline', user: { id: alice } })
    unreachable = false

    online = false
    expect(await service.syncNow()).toMatchObject({ state: 'offline' })
    online = true

    const realFetch = fetchSpy.getMockImplementation()!
    fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/api/sync/push')
        ? new Response(JSON.stringify({ error: 'Invalid entry' }), { status: 400 })
        : realFetch(input, init)
    )
    const before = pushCalls()
    expect(await service.syncNow()).toMatchObject({ state: 'error', error: 'Invalid entry' })
    // Backing off: no automatic retry follows straight away.
    await new Promise((r) => setTimeout(r, 50))
    expect(pushCalls()).toBe(before + 1)
    expect(service.isSignedIn()).toBe(true)

    fetchSpy.mockImplementation(realFetch)
    expect(await service.syncNow()).toMatchObject({ state: 'idle', error: null })
  })

  it('signing out cancels a sign-in in progress', async () => {
    let signal: AbortSignal | undefined
    const service = createAccountService({
      db,
      tokens: new TokenStore(tokenFile(), fakeCipher),
      client: () => {
        throw new Error('no client while signing in')
      },
      signIn: (s) => {
        signal = s
        return new Promise((_, reject) =>
          s.addEventListener('abort', () => reject(new Error('Sign-in was cancelled')))
        )
      },
      emit: (s) => emitted.push(s),
      emitDataChanged,
      isOnline: () => true,
      catalog,
      onCatalogChanged,
      now: NOW
    })
    services.push(service)
    const pending = service.signIn()
    expect(service.status().state).toBe('signing-in')
    expect(await service.signOut()).toMatchObject({ state: 'signed-out', error: null })
    expect(signal?.aborted).toBe(true)
    expect(await pending).toMatchObject({ state: 'signed-out', error: null })
  })

  it('a failed sign-in shows why', async () => {
    const service = makeService()
    expect(await service.signIn()).toMatchObject({
      state: 'signed-out',
      error: "Sign-in didn't go through"
    })
  })

  it('a stored token signs in at start and syncs', async () => {
    const first = makeService()
    await signInAs(first, me(alice, 'alice'))
    first.stop()
    addEntry(db, { printingId: pid(db, 'LOB-EN005'), imageId: DM, quantity: 4 }, T2)

    const second = makeService()
    expect(second.status()).toMatchObject({ state: 'idle', user: { id: alice } })
    second.start()
    await vi.waitFor(() => expect(serverRows(alice)).toHaveLength(1))
  })
  it('sign-out clears the token file before any network call', async () => {
    const service = makeService()
    const token = await signInAs(service, me(alice, 'alice'))
    addEntry(db, { printingId: pid(db, 'LOB-EN005'), imageId: DM, quantity: 4 }, T2)
    const open = blockPushes()
    const pushesBefore = pushCalls()

    const signingOut = service.signOut()
    await vi.waitFor(() => expect(pushCalls()).toBe(pushesBefore + 1))
    // Quitting now would start the next launch signed out, with the token queued for revoking.
    const store = new TokenStore(tokenFile(), fakeCipher)
    expect(store.get()).toBeNull()
    expect(store.pendingRevokes()).toEqual([token])
    expect(getMeta(db, 'cloud_user')).toBeNull()
    expect(service.isSignedIn()).toBe(false)
    // Settings shows the signed-out layout at once, not after the final push and revoke.
    expect(service.status()).toMatchObject({ state: 'signed-out', user: null, error: null })
    expect(emitted.at(-1)).toMatchObject({ state: 'signed-out', user: null, error: null })
    // A sign-in meanwhile waits for the sign-out to finish.
    await willSignInAs(me(alice, 'alice'))
    let signedInAgain = false
    const signingIn = service.signIn().then((st) => {
      signedInAgain = true
      return st
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(signedInAgain).toBe(false)

    open()
    expect(await signingOut).toMatchObject({ state: 'signed-out', error: null })
    expect((await signingIn).user?.id).toBe(alice)
    // The final push still went through with the in-memory token, and the revoke cleared the queue.
    expect(serverRows(alice)).toEqual([{ uid: localRows()[0].uid, quantity: 4, deleted_at: null }])
    expect(store.pendingRevokes()).toEqual([])
    await expect(authCheck(token)).rejects.toBeInstanceOf(CloudAuthError)
  })

  it('a 401 during the final sign-out push still signs out cleanly', async () => {
    const service = makeService()
    await signInAs(service, me(alice, 'alice'))
    addEntry(db, { printingId: pid(db, 'LOB-EN005'), imageId: DM, quantity: 4 }, T2)
    portal.serverDb.prepare('DELETE FROM sessions').run()

    const s = await service.signOut()

    expect(s).toMatchObject({ state: 'signed-out', user: null, error: null, localOwner: 'alice' })
    expect(new TokenStore(tokenFile(), fakeCipher).pendingRevokes()).toEqual([])
    expect(localRows()).toEqual([expect.objectContaining({ owner_id: alice, dirty: 1 })])
    expect(emitted.at(-1)).toMatchObject({ state: 'signed-out', error: null })
  })

  it('a failing me() on the first run still tells the renderer about pulled changes', async () => {
    addEntry(
      portal.serverDb,
      { printingId: pid(portal.serverDb, 'LOB-EN005'), imageId: DM, quantity: 3 },
      T1,
      userScope(alice, 'ygo')
    )
    const realFetch = fetchSpy.getMockImplementation()!
    fetchSpy.mockImplementation(async (input, init) =>
      String(input).endsWith('/api/me')
        ? new Response('down', { status: 503 })
        : realFetch(input, init)
    )
    const service = makeService()
    await signInAs(service, me(alice, 'alice'))
    // Once for the owner switch, once for the pulled entry.
    expect(emitDataChanged).toHaveBeenCalledTimes(2)
    expect(listEntries(db, ALL)).toHaveLength(1)
    expect(service.status().state).toBe('offline')
  })

  it('a run skipped for want of network shows offline, then idle after the next run', async () => {
    online = false
    const service = makeService()
    await willSignInAs(me(alice, 'alice'))
    await service.signIn()
    expect(service.status().state).toBe('offline')
    expect(emitted.at(-1)?.state).toBe('offline')
    online = true
    expect(await service.syncNow()).toMatchObject({ state: 'idle', error: null })
  })

  it('stop() during a run in flight resolves promptly', async () => {
    const service = makeService()
    await signInAs(service, me(alice, 'alice'))
    addEntry(db, { printingId: pid(db, 'LOB-EN005'), imageId: DM, quantity: 4 }, T2)
    blockPushes()
    const pushesBefore = pushCalls()
    const syncing = service.syncNow()
    await vi.waitFor(() => expect(pushCalls()).toBe(pushesBefore + 1))
    service.stop()
    const done = await Promise.race([
      syncing.then(() => 'done'),
      new Promise((r) => setTimeout(() => r('hung'), 1_000))
    ])
    expect(done).toBe('done')
    // The edit waits, dirty, for the next run.
    expect(localRows()).toEqual([expect.objectContaining({ dirty: 1 })])
  })

  it('stop() during a sign-in resolves promptly', async () => {
    const service = createAccountService({
      db,
      tokens: new TokenStore(tokenFile(), fakeCipher),
      client: () => {
        throw new Error('no client while signing in')
      },
      signIn: (signal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('Sign-in was cancelled')))
        ),
      emit: (s) => emitted.push(s),
      emitDataChanged,
      isOnline: () => true,
      catalog,
      onCatalogChanged,
      now: NOW
    })
    services.push(service)
    const signingIn = service.signIn()
    service.stop()
    const done = await Promise.race([
      signingIn.then(() => 'done'),
      new Promise((r) => setTimeout(() => r('hung'), 1_000))
    ])
    expect(done).toBe('done')
    expect(service.isSignedIn()).toBe(false)
  })
})

describe('account portal calls', () => {
  const rpcCalls = (): number =>
    fetchSpy.mock.calls.filter(([input]) => String(input).includes('/api/rpc/')).length

  it('rejects while signed out, without calling the portal', async () => {
    const service = makeService()
    await expect(service.portal('friends:overview', [])).rejects.toThrow(FRIENDS_SIGNED_OUT)
    expect(rpcCalls()).toBe(0)
  })

  it('calls the channel as the signed-in account', async () => {
    const service = makeService()
    await signInAs(service, me(alice, 'alice'))
    await expect(service.portal('friends:overview', [])).resolves.toBeDefined()
    expect(rpcCalls()).toBe(1)
  })

  it('rejects with the offline message and leaves the status alone', async () => {
    const service = makeService()
    await signInAs(service, me(alice, 'alice'))
    const before = service.status()
    unreachable = true
    await expect(service.portal('friends:overview', [])).rejects.toThrow(OFFLINE_MESSAGE)
    expect(service.status()).toEqual(before)
  })

  it('discards a result that lands after the account signed out', async () => {
    const service = makeService()
    await signInAs(service, me(alice, 'alice'))
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    fetchSpy.mockImplementationOnce(async (input, init) => {
      await gate
      return portal.fetch(input, init)
    })
    const pending = service.portal('friends:overview', [])
    const rejected = expect(pending).rejects.toThrow(FRIENDS_SIGNED_OUT)
    await service.signOut()
    release()
    await rejected
  })

  it('cuts off a call still waiting when the account signs out', async () => {
    const service = makeService()
    await signInAs(service, me(alice, 'alice'))
    fetchSpy.mockImplementationOnce(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          )
        })
    )
    const pending = service.portal('friends:overview', [])
    const rejected = expect(pending).rejects.toThrow(FRIENDS_SIGNED_OUT)
    await service.signOut()
    await rejected
  })

  it('signs out when the server no longer knows the token', async () => {
    const service = makeService()
    const token = await signInAs(service, me(alice, 'alice'))
    portal.serverDb.prepare('DELETE FROM sessions').run()
    await expect(service.portal('friends:overview', [])).rejects.toThrow(SERVER_SIGNED_OUT)
    expect(service.status().state).toBe('signed-out')
    expect(service.status().error).toBe(SERVER_SIGNED_OUT)
    expect(service.isSignedIn()).toBe(false)
    expect(new TokenStore(tokenFile(), fakeCipher).get()).toBeNull()
    expect(token).toBeTruthy()
  })

  it('training calls answer signed-out without a token, and a 401 signs out', async () => {
    const service = makeService()
    const send = vi.fn(async () => ({ ok: true as const, summary: null }))
    expect(await service.training(send)).toEqual({ ok: false, retry: true, reason: 'signed-out' })
    expect(send).not.toHaveBeenCalled()

    await signInAs(service, me(alice, 'alice'))
    portal.serverDb.prepare('DELETE FROM sessions').run()
    const r = await service.training((c) => c.trainingSummary('ygo'))
    expect(r).toEqual({ ok: false, retry: true, reason: 'signed-out' })
    expect(service.status().state).toBe('signed-out')
    expect(service.isSignedIn()).toBe(false)
  })
})

describe('price requests', () => {
  const requestCalls = (): number =>
    fetchSpy.mock.calls.filter(([input]) => String(input).includes('/api/sync/price-requests'))
      .length
  /** A Japanese printing nobody owns, in both catalogs (same pkey); its desktop id. */
  function japanesePrinting(): number {
    const insert = `INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity)
      VALUES (${DM}, 'ja', 'Legend of Blue Eyes White Dragon', 'LB-01', 'Ultra Rare') RETURNING id`
    portal.serverDb.prepare(insert).get()
    switchedAndCurrent(db)
    return (db.prepare(insert).get() as { id: number }).id
  }
  const serverRequests = (): number =>
    (portal.serverDb.prepare('SELECT COUNT(*) AS n FROM price_requests').get() as { n: number }).n
  const localRequests = (): number =>
    (db.prepare('SELECT COUNT(*) AS n FROM price_requests').get() as { n: number }).n

  it('does nothing signed out or offline', async () => {
    const id = japanesePrinting()
    const service = makeService()
    await service.requestPrices([id])
    await signInAs(service, me(alice, 'alice'))
    online = false
    await service.requestPrices([id])
    expect(requestCalls()).toBe(0)
    expect(localRequests()).toBe(0)
  })

  it('asks once, and the price the portal finds comes down with the next sync', async () => {
    const id = japanesePrinting()
    const service = makeService()
    await signInAs(service, me(alice, 'alice'))
    // English printings and unknown ids are never sent.
    await service.requestPrices([pid(db, 'LOB-EN005'), 999_999])
    expect(requestCalls()).toBe(0)

    await service.requestPrices([id])
    expect(requestCalls()).toBe(1)
    expect(serverRequests()).toBe(1)
    expect(portal.priceQueue.soon).toHaveBeenCalledWith({ paced: true })
    // Seen again within hours: not asked again.
    await service.requestPrices([id])
    expect(requestCalls()).toBe(1)

    // The portal's price alarm finds it...
    const lookup = vi.fn(async () => ({
      price: 11,
      listingCount: 5,
      checkedAt: '2026-10-25T20:00:30.000Z'
    }))
    const storage = {
      alarm: null as number | null,
      getAlarm: async () => null,
      setAlarm: async () => {}
    }
    await runPriceAlarm(portal.serverDb, { lookup } as unknown as PriceClient, storage, () => NOW())
    expect(lookup).toHaveBeenCalledTimes(1)
    // ...and the next sync brings it to this computer, telling the renderer.
    emitDataChanged.mockClear()
    await service.syncNow()
    expect(db.prepare('SELECT price FROM intl_prices WHERE printing_id = ?').get(id)).toEqual({
      price: 11
    })
    expect(emitDataChanged).toHaveBeenCalled()
  })

  it('rejects ids that are not a list of whole numbers', async () => {
    const service = makeService()
    await expect(service.requestPrices('1')).rejects.toThrow(/Printing ids/)
    await expect(service.requestPrices([1.5])).rejects.toThrow(/Printing ids/)
  })
})

describe('updateUser', () => {
  it("stores the portal's new me and emits it", async () => {
    const service = makeService()
    await signInAs(service, me(alice, 'alice'))
    const changed = await service.portal<Me>('account:setUsername', ['Alice_2'])
    expect(changed.username).toBe('Alice_2')
    emitted = []
    const s = service.updateUser(changed)
    expect(s.user?.username).toBe('Alice_2')
    expect(s.localOwner).toBe('Alice_2')
    expect(emitted.at(-1)?.user?.username).toBe('Alice_2')
    expect(service.status().user?.usernameChosen).toBe(true)
  })

  it("ignores another account's me, and any signed out", async () => {
    const service = makeService()
    await signInAs(service, me(alice, 'alice'))
    emitted = []
    expect(service.updateUser(me(bob, 'bob')).user?.username).toBe('alice')
    expect(emitted).toEqual([])
    await service.signOut()
    expect(service.updateUser(me(alice, 'Alice_3')).user).toBeNull()
  })
})

describe('email sign-in', () => {
  const user = me(7, 'mailer')
  function makeEmailService(opts: {
    reply?: (step: string, body: Record<string, unknown>) => unknown
    claimOutcome?: { claim: string; email: string; verifier: string }
  }): { service: AccountService; calls: { step: string; body: Record<string, unknown> }[] } {
    const calls: { step: string; body: Record<string, unknown> }[] = []
    const service = createAccountService({
      db,
      tokens: new TokenStore(tokenFile(), fakeCipher),
      client: (token, o = {}) =>
        createCloudClient({
          baseUrl: PORTAL,
          token,
          fetch: fetchSpy as unknown as typeof fetch,
          timeoutMs: o.timeoutMs,
          signal: o.signal
        }),
      signIn: async () => opts.claimOutcome ?? { token: 'unused', user },
      linkDiscord: async () => ({ code: 'link-code', verifier: 'ver-1' }),
      emailAuth: async (step, body) => {
        calls.push({ step, body })
        return opts.reply!(step, body) as never
      },
      emailEnabled: async () => true,
      emit: (s) => emitted.push(s),
      emitDataChanged,
      isOnline: () => false,
      catalog,
      onCatalogChanged,
      now: NOW
    })
    services.push(service)
    return { service, calls }
  }
  const signedInReply = { next: 'signed-in', token: 'secret-tok', user, created: false }

  it('emailAuth signed-in stores the token and the renderer never sees it', async () => {
    const { service } = makeEmailService({ reply: () => signedInReply })
    const view = await service.emailAuth('password', { email: 'a@b.co', password: 'pw123456' })
    expect(view).toEqual({ next: 'signed-in', user, created: false })
    expect(JSON.stringify(view)).not.toContain('secret-tok')
    expect(JSON.stringify(service.status())).not.toContain('secret-tok')
    expect(service.isSignedIn()).toBe(true)
    expect(service.status().user).toEqual(user)
    expect(new TokenStore(tokenFile(), fakeCipher).get()).toBe('secret-tok')
  })

  it('other replies pass through and sign nobody in', async () => {
    const { service } = makeEmailService({
      reply: () => ({ next: 'code', ticket: 't', email: 'a@b.co', purpose: 'signup' })
    })
    expect(await service.emailAuth('create', {})).toMatchObject({ next: 'code', ticket: 't' })
    expect(service.isSignedIn()).toBe(false)
  })

  it('emailLinkDiscord sends the link code and verifier with the ticket', async () => {
    const { service, calls } = makeEmailService({ reply: () => signedInReply })
    await service.emailLinkDiscord('tk')
    expect(calls).toEqual([
      { step: 'link-discord', body: { ticket: 'tk', code: 'link-code', verifier: 'ver-1' } }
    ])
    expect(service.isSignedIn()).toBe(true)
  })

  it('a Discord claim shows in status and claim(password) signs in', async () => {
    const { service, calls } = makeEmailService({
      claimOutcome: { claim: 'claim-tk', email: 'a@b.co', verifier: 'v-9' },
      reply: () => signedInReply
    })
    const status = await service.signIn()
    expect(status).toMatchObject({
      state: 'signed-out',
      claim: { email: 'a@b.co', provider: 'discord' }
    })
    expect(JSON.stringify(status)).not.toContain('claim-tk')
    expect(JSON.stringify(status)).not.toContain('v-9')
    expect(emitted.at(-1)?.claim).toEqual({ email: 'a@b.co', provider: 'discord' })

    await service.claim('hunter22')
    expect(calls).toEqual([
      { step: 'claim', body: { ticket: 'claim-tk', verifier: 'v-9', password: 'hunter22' } }
    ])
    expect(service.isSignedIn()).toBe(true)
    expect(service.status().claim).toBeUndefined()
  })

  it('claim(null) makes the separate account', async () => {
    const { service, calls } = makeEmailService({
      claimOutcome: { claim: 'claim-tk', email: 'a@b.co', verifier: 'v-9' },
      reply: () => ({ ...signedInReply, created: true })
    })
    await service.signIn()
    expect(await service.claim(null)).toEqual({ next: 'signed-in', user, created: true })
    expect(calls).toEqual([
      { step: 'claim-separate', body: { ticket: 'claim-tk', verifier: 'v-9' } }
    ])
  })

  it('a wrong password keeps the claim, and signing out drops it', async () => {
    const { service } = makeEmailService({
      claimOutcome: { claim: 'claim-tk', email: 'a@b.co', verifier: 'v-9' },
      reply: () => {
        throw new Error("That password doesn't match.")
      }
    })
    await service.signIn()
    await expect(service.claim('nope-nope')).rejects.toThrow("That password doesn't match.")
    expect(service.status().claim).toBeDefined()
    const out = await service.signOut()
    expect(out.claim).toBeUndefined()
    expect(emitted.at(-1)?.claim).toBeUndefined()
    await expect(service.claim('x')).rejects.toThrow()
  })

  it('emailEnabled asks the portal', async () => {
    const { service } = makeEmailService({ reply: () => signedInReply })
    expect(await service.emailEnabled()).toBe(true)
  })
})
