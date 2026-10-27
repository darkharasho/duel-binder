import { createHash } from 'node:crypto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import type { SqlDb } from '../../src/main/db/sql'
import { getMeta } from '../../src/main/db/meta'
import { CloudAuthError, CloudOfflineError, createCloudClient } from '../../src/main/cloud/client'
import { activeOwner, recordSyncIssue } from '../../src/main/cloud/localSync'
import { PHONE_TABLES } from '../../src/shared/catalogFeed'
import type { Me } from '../../src/shared/cloud'
import { encodeFingerprints } from '../../src/shared/scan/fingerprintFile'
import { HASH_WORDS } from '../../src/shared/scan/fingerprint'
import { openWasmDb } from '../../src/phone/data/wasmSql'
import { PHONE_FORMAT } from '../../src/phone/data/phoneSchema'
import { createPhoneStore, type PhoneStore } from '../../src/phone/data/store'
import { inProcessPortal, PORTAL, SERVER_NOW } from './cloudHelpers'

type Portal = Awaited<ReturnType<typeof inProcessPortal>>

const DM = 46986414
/** Small pages, so the fixture catalog comes in several. */
const PAGE = 3

let sqlite3: Sqlite3Static
let portal: Portal
let userId: number
let token: string
let me: Me
let db: SqlDb
let clock: Date
/** What the store's fetch does; tests swap it to go offline or break a request. */
let net: typeof fetch
/** Every URL the store asked for, in order. */
let requests: { url: string; headers: Headers }[]
let store: PhoneStore

const offline = (async () => {
  throw new TypeError('Failed to fetch')
}) as typeof fetch

/** The portal, with catalog pages limited to PAGE rows. */
const real = (async (input: RequestInfo | URL, init?: RequestInit) => {
  let url = String(input)
  if (url.includes('/api/catalog/changes')) url += `&limit=${PAGE}`
  return portal.fetch(url, init)
}) as typeof fetch

/**
 * Edits take their time from the system clock (the data handlers use `new Date()`). It runs a day
 * before the server's clock and a minute on per edit, so the server never clamps an edit time to its
 * own and two edits never tie.
 */
let editClock: number
const tick = (): void => {
  editClock += 60_000
  vi.setSystemTime(editClock)
}

const since = (url: string): number => Number(new URL(url).searchParams.get('since'))
const catalogRequests = (): string[] =>
  requests.map((r) => r.url).filter((u) => u.includes('/api/catalog/changes'))

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule()
})

beforeEach(async () => {
  portal = await inProcessPortal()
  userId = portal.addUser('alice')
  token = await portal.desktopToken(userId)
  me = { id: userId, username: 'alice', displayName: 'Alice', avatarUrl: null }
  db = openWasmDb(sqlite3, {})
  clock = new Date(SERVER_NOW)
  editClock = SERVER_NOW.getTime() - 86_400_000
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(editClock)
  net = real
  requests = []
  store = createPhoneStore({
    db,
    portal: PORTAL,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) })
      return net(input, init)
    }) as typeof fetch,
    now: () => clock
  })
})
afterEach(() => {
  vi.useRealTimers()
  portal.serverDb.close()
})

/** Signed in and filled: the state after first run. */
async function ready(): Promise<void> {
  await store.signIn(token, me)
  await store.fillCatalog(() => {})
}

/** Dark Magician's first printing and artwork, on the phone. */
function dmPick(): { printingId: number; imageId: number; pkey: string } {
  const p = db
    .prepare('SELECT id, pkey FROM card_printings WHERE card_id = ? ORDER BY id LIMIT 1')
    .get(DM) as { id: number; pkey: string }
  const i = db
    .prepare('SELECT image_id FROM card_images WHERE card_id = ? ORDER BY sort_order LIMIT 1')
    .get(DM) as { image_id: number }
  return { printingId: p.id, imageId: i.image_id, pkey: p.pkey }
}

/** Another card's printing, so two entries don't merge. */
function otherPick(): { printingId: number; imageId: number } {
  const p = db
    .prepare(
      `SELECT p.id, i.image_id FROM card_printings p JOIN card_images i ON i.card_id = p.card_id
       WHERE p.card_id <> ? ORDER BY p.id LIMIT 1`
    )
    .get(DM) as { id: number; image_id: number }
  return { printingId: p.id, imageId: p.image_id }
}

type Pick = { printingId: number; imageId: number }
const add = (pick: Pick, quantity = 1): Promise<{ id: number }> => {
  tick()
  return store.invoke('collection:add', [{ ...pick, quantity }]) as Promise<{ id: number }>
}

type PhoneRow = { uid: string; quantity: number; deleted_at: string | null; dirty: number }
type ServerRow = { uid: string; quantity: number; deleted_at: string | null }
const phoneEntries = (): PhoneRow[] =>
  db
    .prepare('SELECT uid, quantity, deleted_at, dirty FROM collection_entries ORDER BY id')
    .all() as PhoneRow[]

const serverEntries = (): ServerRow[] =>
  portal.serverDb
    .prepare(
      'SELECT uid, quantity, deleted_at FROM collection_entries WHERE user_id = ? ORDER BY server_seq'
    )
    .all(userId) as ServerRow[]

const count = (table: string): number =>
  Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n)

describe('phone store', () => {
  it('fill downloads the phone tables page by page and reports progress', async () => {
    // Dark Magician changed after its printings: the feed lists the card after them, on a later page.
    portal.serverDb.prepare('UPDATE cards SET "desc" = "desc" || \' \' WHERE id = ?').run(DM)
    await store.signIn(token, me)
    expect(await store.catalog()).toMatchObject({ filled: false, cursor: 0 })
    const progress: { cursor: number; latest: number }[] = []
    await store.fillCatalog((p) => progress.push(p))

    expect(progress.length).toBeGreaterThan(2)
    for (let i = 1; i < progress.length; i++)
      expect(progress[i].cursor).toBeGreaterThan(progress[i - 1].cursor)
    const latest = progress.at(-1)!.latest
    expect(progress.at(-1)!.cursor).toBe(latest)
    for (const url of catalogRequests())
      expect(new URL(url).searchParams.get('tables')).toBe(PHONE_TABLES.join(','))

    const code = (
      portal.serverDb.prepare('SELECT set_code FROM card_printings LIMIT 1').get() as {
        set_code: string
      }
    ).set_code
    const found = (await store.invoke('scan:printingsByCode', [code])) as unknown[]
    expect(found.length).toBeGreaterThan(0)
    const serverCards = portal.serverDb.prepare('SELECT COUNT(*) AS n FROM cards').get() as {
      n: number
    }
    expect(count('cards')).toBe(serverCards.n)
    expect(await store.invoke('cards:search', ['magician'])).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Dark Magician' })])
    )
    expect(await store.catalog()).toMatchObject({
      filled: true,
      cursor: latest,
      latest,
      lastSyncAt: SERVER_NOW.toISOString()
    })
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })

  it('collection:update and collection:remove through invoke sync to the server', async () => {
    await ready()
    const a = await add(dmPick())
    const b = await add(otherPick())
    const [ua, ub] = phoneUids(a.id, b.id)
    await store.sync()
    expect(serverEntries()).toHaveLength(2)

    tick()
    await store.invoke('collection:update', [a.id, { quantity: 3 }])
    tick()
    await store.invoke('collection:remove', [b.id])
    expect((await store.syncState()).waiting).toBe(2)
    const state = await store.sync()
    expect(state).toMatchObject({ waiting: 0, problems: 0, signedOut: false })

    const server = new Map(serverEntries().map((e) => [e.uid, e]))
    expect(server.get(ua)).toMatchObject({ quantity: 3, deleted_at: null })
    expect(server.get(ub)?.deleted_at).not.toBeNull()
  })

  it('invoke rejects a channel that is not a data channel', async () => {
    await expect(store.invoke('friends:overview' as never, [])).rejects.toThrow(/channel/i)
  })

  it("portal('friends:overview') sends the Bearer token", async () => {
    await store.signIn(token, me)
    const overview = await store.portal('friends:overview', [])
    expect(overview).toBeTruthy()
    const call = requests.find((r) => r.url.endsWith('/api/rpc/friends:overview'))
    expect(call?.headers.get('authorization')).toBe(`Bearer ${token}`)

    net = offline
    const err = (await store.portal('friends:overview', []).catch((e: unknown) => e)) as Error
    expect(err).toBeInstanceOf(CloudOfflineError)
    expect(err.message).toBe('Could not reach Duel Binder. Check your connection and try again.')
  })

  it('resumes a fill after a failed page', async () => {
    await store.signIn(token, me)
    const cursors: number[] = []
    let pages = 0
    net = (async (input, init) => {
      if (String(input).includes('/api/catalog/changes') && ++pages === 3)
        throw new TypeError('Failed to fetch')
      return real(input, init)
    }) as typeof fetch
    await expect(store.fillCatalog((p) => cursors.push(p.cursor))).rejects.toBeInstanceOf(
      CloudOfflineError
    )
    expect(cursors).toHaveLength(2)
    expect((await store.catalog()).cursor).toBe(cursors[1])
    expect((await store.catalog()).filled).toBe(false)

    net = real
    requests = []
    await store.fillCatalog(() => {})
    expect(since(catalogRequests()[0])).toBe(cursors[1])
    const serverCards = portal.serverDb.prepare('SELECT COUNT(*) AS n FROM cards').get() as {
      n: number
    }
    expect(count('cards')).toBe(serverCards.n)
    expect((await store.catalog()).filled).toBe(true)
    // The search index covers cards from both runs.
    expect(await store.invoke('cards:search', ['magician'])).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Dark Magician' })])
    )
  })

  it('update applies a later server change and a tombstone', async () => {
    await ready()
    const gone = (
      portal.serverDb
        .prepare('SELECT pkey FROM card_printings WHERE card_id <> ? ORDER BY id LIMIT 1')
        .get(DM) as { pkey: string }
    ).pkey
    portal.serverDb.prepare('UPDATE cards SET name = ? WHERE id = ?').run('Dark Magician X', DM)
    portal.serverDb.prepare('DELETE FROM card_printings WHERE pkey = ?').run(gone)
    expect(db.prepare('SELECT 1 FROM card_printings WHERE pkey = ?').get(gone)).toBeDefined()

    // Fresh (just filled) and not forced: nothing to do.
    expect(await store.updateCatalog()).toBe(false)
    expect(await store.updateCatalog({ force: true })).toBe(true)
    expect(
      (db.prepare('SELECT name FROM cards WHERE id = ?').get(DM) as { name: string }).name
    ).toBe('Dark Magician X')
    expect(db.prepare('SELECT 1 FROM card_printings WHERE pkey = ?').get(gone)).toBeUndefined()
    const latest = (
      portal.serverDb.prepare('SELECT seq FROM catalog_clock').get() as { seq: number }
    ).seq
    expect(await store.catalog()).toMatchObject({ cursor: latest, latest })

    // A day later an unforced update runs again.
    portal.serverDb.prepare('UPDATE cards SET name = ? WHERE id = ?').run('Dark Magician', DM)
    clock = new Date(SERVER_NOW.getTime() + 25 * 3_600_000)
    expect(await store.updateCatalog()).toBe(true)
    expect(await store.invoke('cards:search', ['magician'])).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Dark Magician' })])
    )
  })

  it('add then sync puts the entry on the server', async () => {
    await ready()
    await add(dmPick())
    const [{ uid }] = phoneEntries()
    expect(await store.syncState()).toMatchObject({ waiting: 1, signedOut: false })
    const state = await store.sync()
    expect(state).toMatchObject({ waiting: 0, problems: 0, signedOut: false })
    expect(state.lastSyncedAt).toBe(SERVER_NOW.toISOString())
    expect(serverEntries()).toEqual([{ uid, quantity: 1, deleted_at: null }])
  })

  it("an entry that can't sync counts as a problem, not as waiting", async () => {
    await ready()
    await add(dmPick())
    await add(otherPick())
    const [{ uid }] = phoneEntries()
    recordSyncIssue(db, activeOwner(db), uid, 'k', 'unknown-printing', clock)
    expect(await store.syncState()).toMatchObject({ waiting: 1, problems: 1 })
  })

  it('sync reports whether it changed what the user sees', async () => {
    await ready()
    expect(await store.sync()).toMatchObject({ changed: false })
    const pkey = dmPick().pkey
    const imageId = dmPick().imageId
    const other = createCloudClient({
      baseUrl: PORTAL,
      token: await portal.desktopToken(userId),
      fetch: portal.fetch
    })
    const at = '2026-10-24T10:00:00.000Z'
    await other.push([
      {
        uid: crypto.randomUUID(),
        pkey,
        imageId,
        quantity: 1,
        notes: '',
        createdAt: at,
        updatedAt: at,
        deletedAt: null
      }
    ])
    expect(await store.sync()).toMatchObject({ changed: true })
    expect(await store.sync()).toMatchObject({ changed: false })
  })

  it('an add made before a failed push syncs once on the next run', async () => {
    await ready()
    await add(dmPick())
    const [{ uid }] = phoneEntries()

    net = offline
    expect(await store.sync()).toMatchObject({ waiting: 1, signedOut: false })
    // The push reaches the server but its answer is lost.
    net = (async (input, init) => {
      const res = await real(input, init)
      if (String(input).includes('/api/sync/push')) throw new TypeError('Network lost')
      return res
    }) as typeof fetch
    expect(await store.sync()).toMatchObject({ waiting: 1 })
    expect(serverEntries()).toEqual([{ uid, quantity: 1, deleted_at: null }])

    net = real
    expect(await store.sync()).toMatchObject({ waiting: 0 })
    expect(serverEntries()).toEqual([{ uid, quantity: 1, deleted_at: null }])
    expect(phoneEntries()).toEqual([{ uid, quantity: 1, deleted_at: null, dirty: 0 }])
  })

  it('an offline add of a card the server already holds merges on sync', async () => {
    await store.signIn(token, me)
    // Seeded through another device's token: uid B, quantity 2.
    const pkey = (
      portal.serverDb
        .prepare('SELECT pkey FROM card_printings WHERE card_id = ? ORDER BY id LIMIT 1')
        .get(DM) as { pkey: string }
    ).pkey
    const imageId = (
      portal.serverDb
        .prepare('SELECT image_id FROM card_images WHERE card_id = ? ORDER BY sort_order LIMIT 1')
        .get(DM) as { image_id: number }
    ).image_id
    const other = createCloudClient({
      baseUrl: PORTAL,
      token: await portal.desktopToken(userId),
      fetch: portal.fetch
    })
    const at = '2026-10-24T10:00:00.000Z'
    const B = crypto.randomUUID()
    await other.push([
      {
        uid: B,
        pkey,
        imageId,
        quantity: 2,
        notes: '',
        createdAt: at,
        updatedAt: at,
        deletedAt: null
      }
    ])

    // First run syncs once, pulling B.
    await store.fillCatalog(() => {})
    expect(phoneEntries()).toEqual([{ uid: B, quantity: 2, deleted_at: null, dirty: 0 }])
    expect(dmPick().pkey).toBe(pkey)

    net = offline
    await add(dmPick())
    expect(await store.sync()).toMatchObject({ waiting: 1 })
    net = real
    expect(await store.sync()).toMatchObject({ waiting: 0 })

    expect(phoneEntries().filter((e) => e.deleted_at === null)).toEqual([
      { uid: B, quantity: 3, deleted_at: null, dirty: 0 }
    ])
    expect(serverEntries().filter((e) => e.deleted_at === null)).toEqual([
      { uid: B, quantity: 3, deleted_at: null }
    ])
  })

  it('first run is not done until the first sync has pulled the collection', async () => {
    await store.signIn(token, me)
    net = (async (input, init) => {
      if (String(input).includes('/api/sync/')) throw new TypeError('Failed to fetch')
      return real(input, init)
    }) as typeof fetch
    await expect(store.fillCatalog(() => {})).rejects.toBeInstanceOf(CloudOfflineError)
    const after = await store.catalog()
    expect(after.filled).toBe(false)
    expect(after.cursor).toBe(after.latest)

    expect(await store.sync()).toMatchObject({ signedOut: false })
    expect((await store.catalog()).filled).toBe(false)

    net = real
    expect(await store.sync()).toMatchObject({ signedOut: false, waiting: 0 })
    expect((await store.catalog()).filled).toBe(true)
  })

  it('another account signing in on a filled phone syncs before first run is done', async () => {
    await ready()
    await store.signOut()
    const bob = portal.addUser('bob')
    await store.signIn(await portal.desktopToken(bob), {
      id: bob,
      username: 'bob',
      displayName: null,
      avatarUrl: null
    })
    expect((await store.catalog()).filled).toBe(false)
    expect(await store.sync()).toMatchObject({ signedOut: false })
    expect((await store.catalog()).filled).toBe(true)

    // The same account again stays done.
    await store.signOut()
    await store.signIn(await portal.desktopToken(bob), {
      id: bob,
      username: 'bob',
      displayName: null,
      avatarUrl: null
    })
    expect((await store.catalog()).filled).toBe(true)
  })

  it('a 401 on sync reports signed-out and keeps dirty rows', async () => {
    await ready()
    await add(dmPick())
    portal.serverDb.prepare('DELETE FROM sessions').run()

    const state = await store.sync()
    expect(state).toMatchObject({ signedOut: true, waiting: 1 })
    expect(await store.account()).toEqual({ state: 'signed-out' })
    expect(phoneEntries()).toMatchObject([{ quantity: 1, dirty: 1 }])
    expect(await store.syncState()).toMatchObject({ signedOut: true, waiting: 1 })
    await expect(store.portal('friends:overview', [])).rejects.toThrow()
  })

  it('a 401 on fill signs out', async () => {
    await store.signIn(token, me)
    portal.serverDb.prepare('DELETE FROM sessions').run()
    await expect(store.fillCatalog(() => {})).rejects.toBeInstanceOf(CloudAuthError)
    expect(await store.account()).toEqual({ state: 'signed-out' })
  })

  it('sign out keeps waiting adds for the same user', async () => {
    await ready()
    expect(await store.account()).toEqual({ state: 'signed-in', user: me })
    net = offline
    await add(dmPick())
    await store.sync()
    net = real

    expect(await store.signOut()).toEqual({ waiting: 1 })
    expect(await store.account()).toEqual({ state: 'signed-out' })
    // The token was revoked on the server.
    const hash = createHash('sha256').update(token).digest('hex')
    expect(portal.serverDb.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').get(hash)).toBe(
      undefined
    )
    expect(await store.syncState()).toMatchObject({ signedOut: true, waiting: 1 })
    expect(phoneEntries()).toHaveLength(1)

    await store.signIn(await portal.desktopToken(userId), me)
    expect(await store.sync()).toMatchObject({ waiting: 0, signedOut: false })
    expect(serverEntries()).toEqual([{ uid: phoneEntries()[0].uid, quantity: 1, deleted_at: null }])
  })

  it('sign out works offline', async () => {
    await store.signIn(token, me)
    net = offline
    expect(await store.signOut()).toEqual({ waiting: 0 })
    expect(await store.account()).toEqual({ state: 'signed-out' })
  })

  it("delete account removes this owner's rows and the token", async () => {
    await ready()
    await add(dmPick())
    await store.sync()
    const before = count('cards')

    await store.deleteAccount()
    const call = requests.find((r) => r.url.endsWith('/api/account/delete'))
    expect(call?.headers.get('authorization')).toBe(`Bearer ${token}`)
    expect(portal.serverDb.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)).toBe(undefined)
    expect(count('collection_entries')).toBe(0)
    expect(count('value_snapshots')).toBe(0)
    expect(count('cloud_accounts')).toBe(0)
    expect(activeOwner(db)).toBe(0)
    expect(db.prepare("SELECT 1 FROM phone_state WHERE key IN ('token', 'user')").get()).toBe(
      undefined
    )
    expect(await store.account()).toEqual({ state: 'signed-out' })
    // The card catalog stays.
    expect(count('cards')).toBe(before)
  })

  it('delete account offline changes nothing', async () => {
    await ready()
    await add(dmPick())
    net = offline
    await expect(store.deleteAccount()).rejects.toBeInstanceOf(CloudOfflineError)
    expect(count('collection_entries')).toBe(1)
    expect(await store.account()).toEqual({ state: 'signed-in', user: me })
  })

  it('fingerprints are downloaded once and then revalidated with If-None-Match', async () => {
    const file = (n: number): Uint8Array =>
      encodeFingerprints(
        Array.from({ length: n }, (_, i) => ({
          imageId: i + 1,
          hash: new Uint32Array(HASH_WORDS).fill(i)
        }))
      )
    const put = (bytes: Uint8Array): Promise<unknown> =>
      portal.images.put('scan/fingerprints.bin', bytes.slice().buffer, {
        httpMetadata: { contentType: 'application/octet-stream' }
      })
    const fpRequests = (): typeof requests =>
      requests.filter((r) => r.url.endsWith('/scan/fingerprints'))

    expect(await store.fingerprints()).toBeNull()
    expect(await store.refreshFingerprints()).toEqual({ state: 'missing', count: 0 })

    await put(file(2))
    expect(await store.refreshFingerprints({ force: true })).toEqual({
      state: 'ready',
      count: 2,
      updated: true
    })
    expect(new Uint8Array((await store.fingerprints())!)).toEqual(file(2))
    expect(fpRequests().at(-1)!.headers.get('if-none-match')).toBeNull()

    // Within a day: no request.
    const n = fpRequests().length
    expect(await store.refreshFingerprints()).toEqual({ state: 'ready', count: 2 })
    expect(fpRequests()).toHaveLength(n)

    // A day later: revalidated, unchanged (304).
    clock = new Date(SERVER_NOW.getTime() + 25 * 3_600_000)
    expect(await store.refreshFingerprints()).toEqual({ state: 'ready', count: 2 })
    const etag = portal.images.store.get('scan/fingerprints.bin')!.etag
    expect(fpRequests().at(-1)!.headers.get('if-none-match')).toBe(etag)
    expect(
      (
        db.prepare("SELECT checked_at FROM phone_files WHERE name = 'fingerprints'").get() as {
          checked_at: string
        }
      ).checked_at
    ).toBe(clock.toISOString())
    // Checked just now: within a day again.
    expect(await store.refreshFingerprints()).toEqual({ state: 'ready', count: 2 })
    expect(fpRequests()).toHaveLength(n + 1)

    // A new file on the server, forced.
    await put(file(3))
    expect(await store.refreshFingerprints({ force: true })).toEqual({
      state: 'ready',
      count: 3,
      updated: true
    })
    expect(new Uint8Array((await store.fingerprints())!)).toEqual(file(3))

    // Offline keeps the file.
    net = offline
    expect(await store.refreshFingerprints({ force: true })).toEqual({ state: 'ready', count: 3 })
    expect(new Uint8Array((await store.fingerprints())!)).toEqual(file(3))
  })

  it('an older format resets the catalog but keeps collection entries', async () => {
    await ready()
    const pick = dmPick()
    await add(pick)
    await store.sync()
    const cards = count('cards')
    const entries = phoneEntries()
    db.prepare("UPDATE phone_state SET value = '0' WHERE key = 'format'").run()
    expect((await store.catalog()).filled).toBe(false)

    // The download fails at once: the reset is visible on its own.
    net = (async (input, init) => {
      if (String(input).includes('/api/catalog/changes')) throw new TypeError('Failed to fetch')
      return real(input, init)
    }) as typeof fetch
    await expect(store.fillCatalog(() => {})).rejects.toBeInstanceOf(CloudOfflineError)
    expect(count('cards')).toBe(1)
    expect(count('sets')).toBe(0)
    expect(count('card_printings')).toBe(1)
    expect(phoneEntries()).toEqual(entries)
    expect(getMeta(db, 'catalog_cursor')).toBe('0')
    expect(db.prepare("SELECT value FROM phone_state WHERE key = 'format'").get()).toEqual({
      value: String(PHONE_FORMAT)
    })
    expect(await store.catalog()).toMatchObject({ filled: false, cursor: 0 })

    net = real
    requests = []
    await store.fillCatalog(() => {})
    expect(since(catalogRequests()[0])).toBe(0)
    expect(count('cards')).toBe(cards)
    expect(dmPick()).toEqual(pick)
    expect(phoneEntries()).toEqual(entries)
    expect((await store.catalog()).filled).toBe(true)
  })

  it('runs one call at a time', async () => {
    await store.signIn(token, me)
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    net = (async (input, init) => {
      if (String(input).includes('/api/catalog/changes') && order.length === 0) {
        order.push('fill-started')
        await gate
      }
      return real(input, init)
    }) as typeof fetch
    const fill = store.fillCatalog(() => {}).then(() => order.push('fill-done'))
    const state = store.syncState().then(() => order.push('state'))
    await new Promise((r) => setTimeout(r, 10))
    expect(order).toEqual(['fill-started'])
    release()
    await Promise.all([fill, state])
    expect(order).toEqual(['fill-started', 'fill-done', 'state'])
  })
})

function phoneUids(...ids: number[]): string[] {
  return ids.map(
    (id) =>
      (db.prepare('SELECT uid FROM collection_entries WHERE id = ?').get(id) as { uid: string }).uid
  )
}
