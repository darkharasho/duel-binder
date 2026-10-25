import type Database from 'better-sqlite3'
import { getMeta, setMeta } from '../../src/main/db/meta'
import {
  CloudAuthError,
  CloudOfflineError,
  createCloudClient,
  type CloudClient
} from '../../src/main/cloud/client'
import { syncOnce } from '../../src/main/cloud/engine'
import {
  accountState,
  ensureAccount,
  pendingCount,
  setActiveOwner
} from '../../src/main/cloud/localSync'
import { addEntry, listEntries, removeEntry, updateEntry } from '../../src/main/repo/collection'
import { userScope } from '../../workers/portal/src/scope'
import { inProcessPortal, PORTAL } from './cloudHelpers'
import { seededDb } from './helpers'

const ALL = { sort: 'name', dir: 'asc' } as const
const T1 = new Date('2026-10-25T11:00:00.000Z')
const T2 = new Date('2026-10-25T12:00:00.000Z')
const T3 = new Date('2026-10-25T13:00:00.000Z')
const T4 = new Date('2026-10-25T14:00:00.000Z')
const NOW = (): Date => new Date('2026-10-25T20:00:00.000Z')
const DM = 46986414
const POT = 55144522

type Portal = Awaited<ReturnType<typeof inProcessPortal>>

interface Row {
  uid: string
  quantity: number
  notes: string
  deleted_at: string | null
}
type LocalRow = Row & { dirty: number; owner_id: number }

const pid = (db: Database.Database, code: string): number =>
  (db.prepare('SELECT id FROM card_printings WHERE set_code = ?').get(code) as { id: number }).id
const localRows = (db: Database.Database): LocalRow[] =>
  db
    .prepare(
      'SELECT uid, owner_id, quantity, notes, deleted_at, dirty FROM collection_entries ORDER BY id'
    )
    .all() as LocalRow[]
const live = <T extends Row>(rows: T[]): T[] => rows.filter((r) => r.deleted_at === null)

/** Hides a printing from a catalog by changing its set code (and so its pkey); returns the undo. */
const hidePrinting = (db: Database.Database, code: string): (() => void) => {
  db.prepare('UPDATE card_printings SET set_code = ? WHERE set_code = ?').run(`ZZ-${code}`, code)
  return () =>
    void db
      .prepare('UPDATE card_printings SET set_code = ? WHERE set_code = ?')
      .run(code, `ZZ-${code}`)
}

let portal: Portal
let user: number
let token: string
const desktops: Database.Database[] = []

const serverRows = (userId = user): Row[] =>
  portal.serverDb
    .prepare(
      'SELECT uid, quantity, notes, deleted_at FROM collection_entries WHERE user_id = ? ORDER BY server_seq'
    )
    .all(userId) as Row[]

/** A desktop signed in as `owner`, showing that owner's collection. */
async function desktop(owner = user): Promise<Database.Database> {
  const db = await seededDb()
  ensureAccount(db, owner, 'alice')
  setActiveOwner(db, owner)
  desktops.push(db)
  return db
}

const client = (opts: { token?: string; fetch?: typeof fetch } = {}): CloudClient =>
  createCloudClient({
    baseUrl: PORTAL,
    token: opts.token ?? token,
    fetch: opts.fetch ?? portal.fetch
  })

const sync = (db: Database.Database, c: CloudClient = client()) => syncOnce(db, user, c, NOW)

/** Web-side edits through the shared repo, as the portal's RPC would make them. */
const web = {
  add: (code: string, imageId: number, quantity: number, at: Date) =>
    addEntry(
      portal.serverDb,
      { printingId: pid(portal.serverDb, code), imageId, quantity },
      at,
      userScope(user)
    ),
  update: (uid: string, patch: { quantity?: number; notes?: string }, at: Date) => {
    const { id } = portal.serverDb
      .prepare('SELECT id FROM collection_entries WHERE uid = ?')
      .get(uid) as {
      id: number
    }
    return updateEntry(portal.serverDb, id, patch, at, userScope(user))
  }
}

beforeEach(async () => {
  portal = await inProcessPortal()
  user = portal.addUser('alice')
  token = await portal.desktopToken(user)
})
afterEach(() => {
  for (const db of desktops.splice(0)) db.close()
  portal.serverDb.close()
})

describe('syncOnce', () => {
  it('first sync uploads the whole local collection', async () => {
    const a = await desktop()
    addEntry(a, { printingId: pid(a, 'LOB-EN005'), imageId: DM, quantity: 2 }, T1)
    addEntry(a, { printingId: pid(a, 'LOB-EN119'), imageId: POT, quantity: 1 }, T2)
    const notes = updateEntry(a, listEntries(a, ALL)[0].id, { notes: 'binder 1' }, T2)
    removeEntry(
      a,
      addEntry(a, { printingId: pid(a, 'SDY-006'), imageId: DM, quantity: 1 }, T1).id,
      T2
    )

    const out = await sync(a)

    expect(out).toMatchObject({ pushed: 3, pushedLive: 2, pulled: 2, pending: 0, changed: false })
    const local = localRows(a)
    expect(local).toHaveLength(2)
    expect(local.every((r) => r.dirty === 0)).toBe(true)
    expect(
      serverRows()
        .map(({ uid, quantity, notes, deleted_at }) => ({ uid, quantity, notes, deleted_at }))
        .sort((x, y) => x.uid.localeCompare(y.uid))
    ).toEqual(
      local
        .map(({ uid, quantity, notes, deleted_at }) => ({ uid, quantity, notes, deleted_at }))
        .sort((x, y) => x.uid.localeCompare(y.uid))
    )
    expect(serverRows().find((r) => r.notes === 'binder 1')).toBeDefined()
    expect(notes.notes).toBe('binder 1')
    expect(portal.priceQueue.soon).toHaveBeenCalled()
    const state = accountState(a, user)
    expect(state.cursor).toBeGreaterThan(0)
    expect(state.syncedAt).toBe(NOW().toISOString())
    expect(await sync(a)).toEqual({
      pushed: 0,
      pushedLive: 0,
      pulled: 0,
      pending: 0,
      changed: false
    })
  })

  it('web edits reach the desktop and desktop edits reach the web', async () => {
    const a = await desktop()
    addEntry(a, { printingId: pid(a, 'LOB-EN005'), imageId: DM, quantity: 2 }, T1)
    await sync(a)
    const [dm] = localRows(a)

    web.update(dm.uid, { quantity: 5 }, T2)
    web.add('LOB-EN119', POT, 3, T2)
    const out = await sync(a)
    expect(out).toMatchObject({ pushed: 0, pulled: 2, changed: true })
    expect(
      listEntries(a, ALL)
        .map((e) => [e.card.id, e.quantity])
        .sort()
    ).toEqual(
      [
        [DM, 5],
        [POT, 3]
      ].sort()
    )
    expect(localRows(a).every((r) => r.dirty === 0)).toBe(true)

    const pot = listEntries(a, ALL).find((e) => e.card.id === POT)!
    updateEntry(a, pot.id, { quantity: 4, notes: 'trade binder' }, T3)
    expect(await sync(a)).toMatchObject({ pushed: 1, pushedLive: 1 })
    expect(live(serverRows()).map((r) => [r.quantity, r.notes])).toEqual(
      expect.arrayContaining([
        [5, ''],
        [4, 'trade binder']
      ])
    )
    expect(live(serverRows())).toHaveLength(2)
  })

  it('a delete on one desktop never comes back', async () => {
    const a = await desktop()
    const b = await desktop()
    addEntry(a, { printingId: pid(a, 'LOB-EN005'), imageId: DM, quantity: 2 }, T1)
    await sync(a)
    await sync(b)
    expect(listEntries(b, ALL)).toHaveLength(1)

    removeEntry(b, listEntries(b, ALL)[0].id, T2)
    await sync(b)
    await sync(a)
    await sync(b)
    await sync(a)

    expect(listEntries(a, ALL)).toEqual([])
    expect(listEntries(b, ALL)).toEqual([])
    // Clean tombstones are purged locally; the server keeps its tombstone.
    expect(localRows(a)).toEqual([])
    expect(localRows(b)).toEqual([])
    expect(serverRows()).toEqual([expect.objectContaining({ deleted_at: T2.toISOString() })])
  })

  it('the same card added on two desktops converges to one entry with the latest quantity', async () => {
    const a = await desktop()
    const b = await desktop()
    addEntry(b, { printingId: pid(b, 'LOB-EN005'), imageId: DM, quantity: 2 }, T1)
    addEntry(a, { printingId: pid(a, 'LOB-EN005'), imageId: DM, quantity: 3 }, T2)

    await sync(a)
    // B's older entry loses on the server (merged): B tombstones its own uid and takes A's.
    const out = await sync(b)
    expect(out).toMatchObject({ pushed: 1, pushedLive: 0 })
    await sync(a)

    for (const db of [a, b]) {
      expect(listEntries(db, ALL).map((e) => e.quantity)).toEqual([3])
      expect(localRows(db)).toEqual([expect.objectContaining({ quantity: 3, dirty: 0 })])
    }
    expect(localRows(a)[0].uid).toBe(localRows(b)[0].uid)
    expect(live(serverRows())).toEqual([
      expect.objectContaining({ uid: localRows(a)[0].uid, quantity: 3 })
    ])
  })

  it('a merged push result tombstones the pushed entry before taking the winner', async () => {
    const a = await desktop()
    const b = await desktop()
    addEntry(b, { printingId: pid(b, 'LOB-EN005'), imageId: DM, quantity: 2 }, T1)
    addEntry(a, { printingId: pid(a, 'LOB-EN005'), imageId: DM, quantity: 3 }, T2)
    await sync(a)
    const loser = localRows(b)[0].uid

    const out = await sync(b)

    // One push: B's own uid ends a clean tombstone (purged), not a dirty one to push again.
    expect(out.pushed).toBe(1)
    expect(localRows(b)).toEqual([
      expect.objectContaining({ uid: localRows(a)[0].uid, quantity: 3, dirty: 0, deleted_at: null })
    ])
    expect(serverRows().find((r) => r.uid === loser)).toMatchObject({
      deleted_at: T1.toISOString()
    })
  })

  it('a merged push result does not tombstone an entry edited during the push', async () => {
    const a = await desktop()
    const b = await desktop()
    addEntry(b, { printingId: pid(b, 'LOB-EN005'), imageId: DM, quantity: 2 }, T1)
    addEntry(a, { printingId: pid(a, 'LOB-EN005'), imageId: DM, quantity: 3 }, T2)
    await sync(a)
    const mine = listEntries(b, ALL)[0]
    const mineUid = localRows(b)[0].uid

    let edited = false
    const editingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!edited && String(input).endsWith('/api/sync/push')) {
        edited = true
        // The user edits the entry while its push is in flight.
        updateEntry(b, mine.id, { quantity: 7 }, T3)
      }
      return portal.fetch(input, init)
    }) as typeof fetch

    await sync(b, client({ fetch: editingFetch }))

    expect(edited).toBe(true)
    // The edit survives the merged result (still live, not tombstoned) and wins when pushed again.
    expect(live(localRows(b))).toEqual([
      expect.objectContaining({ uid: mineUid, quantity: 7, dirty: 0 })
    ])
    expect(live(serverRows())).toEqual([expect.objectContaining({ uid: mineUid, quantity: 7 })])
    await sync(a)
    for (const db of [a, b]) {
      expect(listEntries(db, ALL).map((e) => e.quantity)).toEqual([7])
      expect(localRows(db).every((r) => r.dirty === 0)).toBe(true)
    }
    expect(live(serverRows()).map((r) => r.quantity)).toEqual([7])
    expect(live(localRows(a))[0].uid).toBe(mineUid)
  })

  it('a printing the desktop doesn’t know waits and arrives after the catalog gains it', async () => {
    const a = await desktop()
    const restore = hidePrinting(a, 'SDY-006')
    web.add('SDY-006', DM, 2, T1)

    const out = await sync(a)
    expect(out).toMatchObject({ pulled: 1, pending: 1 })
    expect(pendingCount(a, user)).toBe(1)
    expect(localRows(a)).toEqual([])

    restore()
    const after = await sync(a)
    expect(after).toMatchObject({ pending: 0, changed: true })
    expect(listEntries(a, ALL).map((e) => [e.printing.setCode, e.quantity])).toEqual([
      ['SDY-006', 2]
    ])
    expect(localRows(a)[0].dirty).toBe(0)
  })

  it('an entry on a printing the server lacks stays dirty and is retried', async () => {
    const a = await desktop()
    addEntry(a, { printingId: pid(a, 'SDY-006'), imageId: DM, quantity: 2 }, T1)
    const restore = hidePrinting(portal.serverDb, 'SDY-006')

    expect(await sync(a)).toMatchObject({ pushed: 1, pushedLive: 0 })
    expect(localRows(a)).toEqual([expect.objectContaining({ dirty: 1 })])
    expect(serverRows()).toEqual([])

    restore()
    expect(await sync(a)).toMatchObject({ pushed: 1, pushedLive: 1 })
    expect(localRows(a)).toEqual([expect.objectContaining({ dirty: 0, quantity: 2 })])
    expect(serverRows()).toEqual([
      expect.objectContaining({ uid: localRows(a)[0].uid, quantity: 2 })
    ])
  })

  it('a sync cut off after push resumes without duplicates', async () => {
    const a = await desktop()
    addEntry(a, { printingId: pid(a, 'LOB-EN005'), imageId: DM, quantity: 2 }, T1)
    let pulls = 0
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/sync/pull') && pulls++ === 0)
        throw new TypeError('fetch failed')
      return portal.fetch(input, init)
    }) as typeof fetch
    const c = client({ fetch: flaky })

    await expect(sync(a, c)).rejects.toBeInstanceOf(CloudOfflineError)
    expect(accountState(a, user)).toEqual({ cursor: 0, syncedAt: null })

    await sync(a, c)
    expect(localRows(a)).toEqual([
      expect.objectContaining({ quantity: 2, dirty: 0, deleted_at: null })
    ])
    expect(serverRows()).toEqual([
      expect.objectContaining({ uid: localRows(a)[0].uid, quantity: 2 })
    ])
    const { cursor } = accountState(a, user)
    expect(cursor).toBeGreaterThan(0)
    expect(await sync(a, c)).toMatchObject({ pushed: 0, pulled: 0 })
    expect(accountState(a, user).cursor).toBe(cursor)
  })

  it('server prices reach the desktop without calling the eBay Worker', async () => {
    const a = await desktop()
    addEntry(a, { printingId: pid(a, 'LOB-EN005'), imageId: DM, quantity: 2 }, T1)
    portal.serverDb
      .prepare(
        'INSERT INTO intl_prices (printing_id, price, listing_count, checked_at) VALUES (?, ?, ?, ?)'
      )
      .run(pid(portal.serverDb, 'LOB-EN005'), 12.5, 4, T4.toISOString())
    setMeta(portal.serverDb, 'price_service_status', 'ok')
    const requested: string[] = []
    const watching = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requested.push(String(input))
      return portal.fetch(input, init)
    }) as typeof fetch

    const out = await sync(a, client({ fetch: watching }))

    expect(out.changed).toBe(true)
    expect(requested.every((u) => u.startsWith(`${PORTAL}/`))).toBe(true)
    expect(requested.some((u) => u.endsWith('/api/sync/prices'))).toBe(true)
    expect(listEntries(a, ALL)[0]).toMatchObject({
      unitPrice: 12.5,
      priceSource: 'ebay',
      priceListingCount: 4
    })
    expect(getMeta(a, 'price_service_status')).toBe('ok')
  })

  it('the echo of our own push changes nothing and records no snapshot', async () => {
    const a = await desktop()
    addEntry(a, { printingId: pid(a, 'LOB-EN005'), imageId: DM, quantity: 2 }, T1)
    const snapshots = (): number =>
      (a.prepare('SELECT COUNT(*) AS n FROM value_snapshots').get() as { n: number }).n
    const before = snapshots()

    const out = await sync(a)

    expect(out).toMatchObject({ pushed: 1, pulled: 1, changed: false })
    expect(snapshots()).toBe(before)
    expect(localRows(a)).toEqual([expect.objectContaining({ quantity: 2, dirty: 0 })])
  })

  it('a push result the server leaves out does not make the loop push forever', async () => {
    const a = await desktop()
    addEntry(a, { printingId: pid(a, 'LOB-EN005'), imageId: DM, quantity: 2 }, T1)
    addEntry(a, { printingId: pid(a, 'LOB-EN119'), imageId: POT, quantity: 1 }, T1)
    const real = client()
    let pushes = 0
    const dropping: CloudClient = {
      ...real,
      push: async (entries) => {
        if (++pushes > 5) throw new Error('push loop did not terminate')
        // The server answers for every entry but the first.
        return (await real.push(entries)).slice(1)
      }
    }

    const out = await sync(a, dropping)

    expect(pushes).toBe(1)
    expect(out.pushed).toBe(2)
    // The unanswered row stays dirty for the next run.
    expect(localRows(a).filter((r) => r.dirty === 1)).toHaveLength(1)
    expect(await sync(a)).toMatchObject({ pushed: 1 })
    expect(localRows(a).every((r) => r.dirty === 0)).toBe(true)
  })

  it('a 401 throws CloudAuthError and changes nothing locally', async () => {
    const a = await desktop()
    addEntry(a, { printingId: pid(a, 'LOB-EN005'), imageId: DM, quantity: 2 }, T1)
    const before = localRows(a)

    await expect(sync(a, client({ token: 'not-a-real-token' }))).rejects.toBeInstanceOf(
      CloudAuthError
    )

    expect(localRows(a)).toEqual(before)
    expect(accountState(a, user)).toEqual({ cursor: 0, syncedAt: null })
    expect(serverRows()).toEqual([])
  })
})

describe('createCloudClient', () => {
  const recorder = (res: () => Response) => {
    const calls: Request[] = []
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Request(input, init))
      return res()
    }) as typeof fetch
    return { calls, f }
  }

  it('sends the Bearer token and JSON bodies', async () => {
    const { calls, f } = recorder(() => Response.json({ results: [] }))
    const c = createCloudClient({ baseUrl: `${PORTAL}/`, token: 'tok', fetch: f })
    expect(await c.push([])).toEqual([])
    expect(calls[0].url).toBe(`${PORTAL}/api/sync/push`)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].headers.get('authorization')).toBe('Bearer tok')
    expect(calls[0].headers.get('content-type')).toBe('application/json')
    expect(await calls[0].json()).toEqual({ entries: [] })
  })

  it('never lets the bearer token follow a redirect', async () => {
    const seen: (RequestInit | undefined)[] = []
    const f = (async (_: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init)
      // What fetch does with redirect: 'error' when the server redirects.
      if (init?.redirect === 'error') throw new TypeError('unexpected redirect')
      return Response.json({ id: 1 })
    }) as typeof fetch
    await expect(
      createCloudClient({ baseUrl: PORTAL, token: 't', fetch: f }).me()
    ).rejects.toBeInstanceOf(CloudOfflineError)
    expect(seen[0]?.redirect).toBe('error')
  })

  it('maps statuses to errors', async () => {
    const at = (status: number, body: unknown = {}) =>
      createCloudClient({
        baseUrl: PORTAL,
        token: 't',
        fetch: recorder(() => Response.json(body, { status })).f
      })
    await expect(at(401).pull(0)).rejects.toBeInstanceOf(CloudAuthError)
    await expect(at(503).pull(0)).rejects.toBeInstanceOf(CloudOfflineError)
    await expect(
      at(400, { error: 'cursor must be a whole number of at least 0' }).pull(0)
    ).rejects.toThrow('cursor must be a whole number of at least 0')
    const e = await at(413, {})
      .push([])
      .catch((x: unknown) => x)
    expect(e).toBeInstanceOf(Error)
    expect(e).not.toBeInstanceOf(CloudOfflineError)
    expect((e as Error).message).toBe('Request failed (413)')
  })

  it('treats a thrown fetch or a timeout as offline', async () => {
    const thrown = createCloudClient({
      baseUrl: PORTAL,
      token: 't',
      fetch: (async () => {
        throw new TypeError('fetch failed')
      }) as typeof fetch
    })
    await expect(thrown.me()).rejects.toBeInstanceOf(CloudOfflineError)

    const hanging = createCloudClient({
      baseUrl: PORTAL,
      token: 't',
      timeoutMs: 20,
      fetch: ((_: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          )
        )) as typeof fetch
    })
    await expect(hanging.me()).rejects.toBeInstanceOf(CloudOfflineError)
  })
})
