import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { getMeta } from '../../src/main/db/meta'
import {
  createAccountService,
  SERVER_SIGNED_OUT,
  type AccountService
} from '../../src/main/cloud/account'
import { CloudAuthError, createCloudClient } from '../../src/main/cloud/client'
import { activeOwner } from '../../src/main/cloud/localSync'
import { TokenStore, type Cipher } from '../../src/main/cloud/tokenStore'
import { createHandlers } from '../../src/main/ipc/handlers'
import { addEntry, listEntries, updateEntry } from '../../src/main/repo/collection'
import type { Me } from '../../src/shared/cloud'
import { FRIENDS_SIGNED_OUT, OFFLINE_MESSAGE } from '../../src/shared/friends'
import type { AccountStatus } from '../../src/shared/types'
import { userScope } from '../../workers/portal/src/scope'
import { inProcessPortal, PORTAL } from './cloudHelpers'
import { seededDb } from './helpers'

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
let nextSignIn: { token: string; user: Me } | null
let emitted: AccountStatus[]
let emitDataChanged: Mock<() => void>
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

function makeService(): AccountService {
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
  dir = mkdtempSync(join(tmpdir(), 'duel-binder-account-'))
  online = true
  unreachable = false
  pushGate = null
  nextSignIn = null
  emitted = []
  emitDataChanged = vi.fn<() => void>()
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
    return portal.fetch(input, init)
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
      pendingCount: 0
    })
    expect(service.isSignedIn()).toBe(false)
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
      userScope(bob)
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

  it('while signed in no request goes to the eBay Worker', async () => {
    const service = makeService()
    const lookup = vi.fn(async () => ({
      price: 1.5,
      listingCount: 2,
      checkedAt: NOW().toISOString()
    }))
    const handlers = createHandlers({
      db,
      client: { fetchDbVersion: vi.fn(), fetchCardInfo: vi.fn(), fetchCardSets: vi.fn() },
      images: {
        get: vi.fn(),
        getSet: vi.fn(),
        getPrinting: vi.fn(),
        sizeBytes: async () => 0,
        clear: async () => {}
      },
      emitSync: () => {},
      app: {
        version: () => '0.0.0',
        openDataFolder: async () => {},
        backupDatabase: async () => null,
        updateStatus: async () => ({ state: 'idle', mode: 'auto', version: null, error: null }),
        checkForUpdates: async () => ({ state: 'none', mode: 'auto', version: null, error: null }),
        applyUpdate: async () => {}
      },
      window: {
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
        isMaximized: () => false
      },
      prices: {
        client: () => ({ lookup }),
        settings: () => ({ url: '', defaultUrl: '', isDefault: true, envOverride: false }),
        setUrl: () => ({ url: '', defaultUrl: '', isDefault: true, envOverride: false })
      },
      emitDataChanged,
      account: service,
      fingerprints: {
        read: async () => null,
        status: () => ({ state: 'missing', count: 0 }),
        refresh: async () => ({ state: 'missing', count: 0 })
      }
    })

    await signInAs(service, me(alice, 'alice'))
    await handlers['collection:add']({ printingId: pid(db, 'LOB-EN005'), imageId: DM, quantity: 1 })
    await new Promise((r) => setTimeout(r, 20))
    expect(lookup).not.toHaveBeenCalled()

    await handlers['account:signOut']()
    await handlers['collection:add']({
      printingId: pid(db, 'LOB-EN119'),
      imageId: POT,
      quantity: 1
    })
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(1))
  })

  it('a catalog refresh applies pending entries', async () => {
    // The server holds a card on a printing this computer's catalog doesn't have yet.
    addEntry(
      portal.serverDb,
      { printingId: pid(portal.serverDb, 'LOB-EN119'), imageId: POT, quantity: 2 },
      T1,
      userScope(alice)
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
      userScope(alice)
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
      userScope(alice)
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
})
