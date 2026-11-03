import { afterEach, describe, expect, it, vi } from 'vitest'
import { DATA_CHANNELS } from '../../src/main/ipc/dataHandlers'
import { createPhoneStore, type PhoneStore } from '../../src/phone/data/store'
import { applyPhoneSchema } from '../../src/phone/data/phoneSchema'
import type { PhoneDb } from '../../src/phone/data/wasmSql'
import type { Me } from '../../src/shared/cloud'
import { seedPokemon } from '../fixtures/pokemon'
import { seededDb } from '../main/helpers'
import {
  createPhoneApi,
  createPhoneEvents,
  reportPlatform,
  type PhoneEvents
} from '../../src/phone/api'
import type { Api } from '../../src/shared/ipc'
import type { Ocr } from '../../src/shared/scan/ocr'
import type { OcrBand } from '../../src/shared/scan/types'
import type { EntryView } from '../../src/shared/types'

const ME = { id: 7, username: 'alice', displayName: 'Alice', avatarUrl: null }

function fakeStore(over: Partial<PhoneStore> = {}): PhoneStore {
  return {
    account: vi.fn(async () => ({ state: 'signed-in' as const, user: ME })),
    signIn: vi.fn(async () => {}),
    updateUser: vi.fn(async () => {}),
    signOut: vi.fn(async () => ({ waiting: 0 })),
    deleteAccount: vi.fn(async () => {}),
    catalog: vi.fn(async () => ({
      filled: true,
      cursor: 10,
      latest: 10,
      lastSyncAt: '2026-10-27T10:00:00.000Z',
      dbVersion: 'v1'
    })),
    fillCatalog: vi.fn(async () => {}),
    updateCatalog: vi.fn(async () => false),
    sync: vi.fn(async () => ({
      waiting: 0,
      problems: 0,
      lastSyncedAt: '2026-10-27T11:00:00.000Z',
      signedOut: false,
      changed: false,
      awaitingPrices: false
    })),
    syncState: vi.fn(async () => ({
      waiting: 2,
      problems: 1,
      lastSyncedAt: '2026-10-27T11:00:00.000Z',
      signedOut: false
    })),
    syncProblems: vi.fn(async () => []),
    invoke: vi.fn(async () => 'ok'),
    portal: vi.fn(async () => 'portal') as PhoneStore['portal'],
    portalRead: vi.fn(async () => []) as PhoneStore['portalRead'],
    requestPrices: vi.fn(async () => 0),
    reportUsage: vi.fn(async () => {}),
    reportError: vi.fn(async () => {}),
    fingerprints: vi.fn(async () => null),
    fingerprintRefs: vi.fn(async () => []),
    fingerprintStatus: vi.fn(async () => ({ state: 'ready' as const, count: 3 })),
    refreshFingerprints: vi.fn(async () => ({ state: 'ready' as const, count: 3 })),
    ...over
  }
}

function fakeOcr(): Ocr {
  return {
    read: vi.fn(async (bands: OcrBand[]) => bands.map(() => 'LOB-001')),
    readText: vi.fn(async () => ({
      text: 'Lorsque cette carte est invoquée, de la',
      confidence: 90
    })),
    dispose: vi.fn(async () => {})
  }
}

function setup(
  store = fakeStore(),
  ocr = fakeOcr()
): {
  api: Api
  store: PhoneStore
  ocr: Ocr
  triggers: { afterAdd: ReturnType<typeof vi.fn>; afterPriceRequest: ReturnType<typeof vi.fn> }
  events: PhoneEvents
} {
  const triggers = { afterAdd: vi.fn(), afterPriceRequest: vi.fn() }
  const events = createPhoneEvents()
  const api = createPhoneApi({ store, ocr, triggers, events })
  return { api, store, ocr, triggers, events }
}

const band = (width: number, height: number): OcrBand => ({
  width,
  height,
  data: new Uint8Array(width * height)
})

type Loose = Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('phone api', () => {
  it('every DATA_CHANNELS method calls store.invoke with its channel', async () => {
    for (const channel of DATA_CHANNELS) {
      const { api, store } = setup()
      const [ns, method] = channel.split(':')
      await (api as unknown as Loose)[ns][method]('a', 2)
      expect(store.invoke).toHaveBeenCalledWith(channel, ['a', 2])
    }
  })

  it("collection.add calls store.invoke('collection:add')", async () => {
    const { api, store } = setup()
    const input = { printingId: 1, imageId: 2, quantity: 1 }
    await expect(api.collection.add(input as never)).resolves.toBe('ok')
    expect(store.invoke).toHaveBeenCalledWith('collection:add', [input])
  })

  it('collection.list rejects', async () => {
    const { api } = setup(
      fakeStore({
        invoke: vi.fn(async () => {
          throw new Error('no such table')
        })
      })
    )
    await expect(api.collection.list({} as never)).rejects.toThrow('no such table')
  })

  it('collection.update triggers one sync', async () => {
    const { api, triggers } = setup()
    await api.collection.update(3, { quantity: 2 })
    expect(triggers.afterAdd).toHaveBeenCalledTimes(1)
  })

  it('every local edit triggers a sync once it lands, reads do not', async () => {
    const { api, triggers } = setup()
    await api.collection.add({} as never)
    await api.collection.remove(1)
    await api.sets.adjust('LOB', 'en', 1, 1)
    expect(triggers.afterAdd).toHaveBeenCalledTimes(3)
    await api.collection.list({} as never)
    await api.stats.get()
    await api.sets.list()
    expect(triggers.afterAdd).toHaveBeenCalledTimes(3)
  })

  it('a failed edit triggers no sync', async () => {
    const { api, triggers } = setup(
      fakeStore({
        invoke: vi.fn(async () => {
          throw new Error('Notes are too long')
        })
      })
    )
    await expect(api.collection.update(1, {})).rejects.toThrow('Notes are too long')
    expect(triggers.afterAdd).not.toHaveBeenCalled()
  })

  it('friends.collection clears printingScan', async () => {
    const entries = [
      { id: 1, printingScan: true },
      { id: 2, printingScan: false }
    ] as EntryView[]
    const portal = vi.fn(async () => entries)
    const { api } = setup(fakeStore({ portal: portal as unknown as PhoneStore['portal'] }))
    const got = await api.friends.collection(5, {} as never)
    expect(got.map((e) => e.printingScan)).toEqual([false, false])
    expect(portal).toHaveBeenCalledWith('friends:collection', [5, {}])
  })

  it('friends calls go to store.portal', async () => {
    const { api, store } = setup()
    await api.friends.request('bob')
    expect(store.portal).toHaveBeenCalledWith('friends:request', ['bob'])
    await api.friends.block(4)
    expect(store.portal).toHaveBeenCalledWith('friends:block', [4])
  })

  it('scan.ocr rejects malformed bands', async () => {
    const { api, ocr } = setup()
    await expect(
      api.scan.ocr([{ width: 2, height: 2, data: new Uint8Array(3) }], 'code')
    ).rejects.toThrow('OCR band data must be one byte per pixel')
    await expect(api.scan.ocr([band(2, 2)], 'words' as never)).rejects.toThrow()
    expect(ocr.read).not.toHaveBeenCalled()
    await expect(api.scan.ocr([band(2, 2)], 'code')).resolves.toEqual(['LOB-001'])
  })

  it('scan.language uses cardLanguage', async () => {
    const { api, ocr } = setup()
    await expect(api.scan.language([band(4, 2)])).resolves.toBe('fr')
    expect(ocr.readText).toHaveBeenCalledWith(expect.objectContaining({ width: 4 }), 'eng')
    await expect(api.scan.language('nope' as never)).rejects.toThrow()
  })

  it('scan.readText reads each band with the one model asked for, as it is', async () => {
    const { api, ocr } = setup()
    await expect(api.scan.readText([band(4, 2), band(3, 2)], 'jpn')).resolves.toEqual([
      'Lorsque cette carte est invoquée, de la',
      'Lorsque cette carte est invoquée, de la'
    ])
    expect(ocr.readText).toHaveBeenCalledTimes(2)
    expect(ocr.readText).toHaveBeenCalledWith(expect.objectContaining({ width: 3 }), 'jpn')
    await expect(api.scan.readText([band(4, 2)], 'chi_sim' as never)).rejects.toThrow(
      'Unknown OCR model'
    )
    await expect(api.scan.readText('nope' as never, 'eng')).rejects.toThrow()
    expect(ocr.readText).toHaveBeenCalledTimes(2)
  })

  it('scan.ocr reads Pokémon collector numbers', async () => {
    const { api, ocr } = setup()
    await api.scan.ocr([band(2, 2)], 'number')
    expect(ocr.read).toHaveBeenCalledWith([band(2, 2)], 'number')
  })

  it('scan fingerprints go to the store', async () => {
    const { api, store } = setup()
    await api.scan.fingerprints('ygo')
    await expect(api.scan.refreshFingerprints('ygo')).resolves.toEqual({ state: 'ready', count: 3 })
    expect(store.fingerprints).toHaveBeenCalled()
    expect(store.refreshFingerprints).toHaveBeenCalledWith({ game: 'ygo' })
  })

  it('scanWindow.isOpen is false', async () => {
    const { api } = setup()
    await expect(api.scanWindow.isOpen()).resolves.toBe(false)
    await expect(api.scanWindow.open()).resolves.toBeUndefined()
    expect(() => api.scanWindow.send({} as never)).not.toThrow()
    expect(typeof api.scanWindow.onMessage(() => {})).toBe('function')
  })

  it('reports usage and errors as the app it runs in', () => {
    expect(reportPlatform('web')).toBe('phone')
    expect(reportPlatform('ios')).toBe('ios')
    expect(reportPlatform('android')).toBe('android')
  })

  it('reports the phone platform and the build version', async () => {
    vi.stubGlobal('__APP_VERSION__', '0.9.0')
    const { api } = setup()
    expect(api.window.platform).toBe('phone')
    await expect(api.app.version()).resolves.toBe('0.9.0')
    await expect(api.images.cacheSize()).resolves.toBe(0)
    await expect(api.app.updateStatus()).resolves.toMatchObject({ state: 'idle' })
    await expect(api.app.backupDatabase()).rejects.toThrow('Not in the phone app')
    await expect(api.app.checkForUpdates()).rejects.toThrow('Not in the phone app')
  })

  it('sync.status is built from the catalog', async () => {
    const { api } = setup()
    await expect(api.sync.status()).resolves.toEqual({
      state: 'idle',
      lastSyncAt: '2026-10-27T10:00:00.000Z',
      dbVersion: 'v1',
      cardCount: 1,
      error: null,
      blocked: null,
      blockedRetry: null
    })
  })

  it('sync.run forces a catalog update and reports progress and changes', async () => {
    const store = fakeStore({ updateCatalog: vi.fn(async () => true) })
    const { api, events } = setup(store)
    const states: string[] = []
    api.sync.onProgress((s) => states.push(s.state))
    const changed = vi.fn()
    api.app.onDataChanged(changed)
    await expect(api.sync.run()).resolves.toMatchObject({ state: 'idle' })
    expect(store.updateCatalog).toHaveBeenCalledWith({ force: true })
    expect(states).toEqual(['checking', 'idle'])
    expect(changed).toHaveBeenCalledTimes(1)
    expect(events).toBeDefined()
  })

  it('a failed catalog update reports the error', async () => {
    const store = fakeStore({
      updateCatalog: vi.fn(async () => {
        throw new Error('The portal is unreachable')
      })
    })
    const { api } = setup(store)
    await expect(api.sync.run()).resolves.toMatchObject({
      state: 'error',
      error: 'The portal is unreachable'
    })
  })

  it('account.status is built from the account and sync state', async () => {
    const { api } = setup()
    await expect(api.account.status()).resolves.toEqual({
      state: 'idle',
      user: ME,
      localOwner: 'Alice',
      lastSyncedAt: '2026-10-27T11:00:00.000Z',
      error: null,
      pendingCount: 0,
      unsyncedCount: 1,
      signInRequired: true
    })
  })

  it('account.status signed out', async () => {
    const { api } = setup(
      fakeStore({ account: vi.fn(async () => ({ state: 'signed-out' as const })) })
    )
    await expect(api.account.status()).resolves.toMatchObject({
      state: 'signed-out',
      user: null,
      signInRequired: true
    })
  })

  it('account.syncNow runs a sync and tells listeners', async () => {
    const store = fakeStore()
    ;(store.sync as ReturnType<typeof vi.fn>).mockResolvedValue({
      waiting: 0,
      problems: 0,
      lastSyncedAt: 'x',
      signedOut: false,
      changed: true
    })
    const { api } = setup(store)
    const states: string[] = []
    api.account.onChange((s) => states.push(s.state))
    const changed = vi.fn()
    api.app.onDataChanged(changed)
    await expect(api.account.syncNow()).resolves.toMatchObject({ state: 'idle' })
    expect(store.sync).toHaveBeenCalledTimes(1)
    expect(states).toEqual(['syncing', 'idle'])
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('prices.request asks the store and syncs shortly after only when something was queued', async () => {
    const store = fakeStore()
    const { api, triggers } = setup(store)
    await api.prices.request([7, 8])
    expect(store.requestPrices).toHaveBeenCalledWith([7, 8])
    expect(triggers.afterPriceRequest).not.toHaveBeenCalled()
    ;(store.requestPrices as ReturnType<typeof vi.fn>).mockResolvedValue(2)
    await api.prices.request([9])
    expect(triggers.afterPriceRequest).toHaveBeenCalledTimes(1)
  })

  it('a sync that leaves requested prices on their way syncs again shortly', async () => {
    const store = fakeStore()
    const { api, triggers } = setup(store)
    await api.account.syncNow()
    expect(triggers.afterPriceRequest).not.toHaveBeenCalled()
    ;(store.sync as ReturnType<typeof vi.fn>).mockResolvedValue({
      waiting: 0,
      problems: 0,
      lastSyncedAt: 'x',
      signedOut: false,
      changed: false,
      awaitingPrices: true
    })
    await api.account.syncNow()
    expect(triggers.afterPriceRequest).toHaveBeenCalledTimes(1)
  })

  it('account.unsynced and deleteAccount go to the store', async () => {
    const { api, store } = setup()
    await api.account.unsynced()
    expect(store.invoke).toHaveBeenCalledWith('account:unsynced', [])
    await api.account.deleteAccount()
    expect(store.deleteAccount).toHaveBeenCalled()
  })

  it('account RPCs go to the portal; a returned me is stored and emitted', async () => {
    const changed = { ...ME, username: 'Alice_2', usernameChosen: true }
    const store = fakeStore({ portal: vi.fn(async () => changed) as PhoneStore['portal'] })
    const { api, events } = setup(store)
    const seen: unknown[] = []
    events.on('account', (s) => seen.push(s))
    await expect(api.account.setUsername('Alice_2')).resolves.toEqual(changed)
    expect(store.portal).toHaveBeenLastCalledWith('account:setUsername', ['Alice_2'])
    expect(store.updateUser).toHaveBeenLastCalledWith(changed)
    expect(seen).toHaveLength(1)
    await api.account.dismissLinkHint()
    expect(store.portal).toHaveBeenLastCalledWith('account:dismissLinkHint', [])
    expect(store.updateUser).toHaveBeenCalledTimes(2)
    expect(seen).toHaveLength(2)
    await api.account.signIns()
    expect(store.portal).toHaveBeenLastCalledWith('account:signIns', [])
    await api.account.removeSignIn('apple')
    expect(store.portal).toHaveBeenLastCalledWith('account:removeSignIn', ['apple'])
    expect(store.updateUser).toHaveBeenCalledTimes(2)
    const choice = { cards: 'sum', username: 'theirs' } as const
    await expect(api.account.merge('ticket-1', choice)).resolves.toEqual(changed)
    expect(store.portal).toHaveBeenLastCalledWith('account:merge', ['ticket-1', choice])
    expect(store.updateUser).toHaveBeenCalledTimes(3)
    expect(seen).toHaveLength(3)
  })

  describe('active game', () => {
    const OWNER: Me = { ...ME, games: ['ygo', 'pkm'] }
    const NOW = '2026-10-29T12:00:00.000Z'

    /** A phone database with one Yu-Gi-Oh! and one Pokémon entry of OWNER, already synced. */
    async function phoneDb(): Promise<Awaited<ReturnType<typeof seededDb>>> {
      const db = await seededDb()
      applyPhoneSchema(db)
      seedPokemon(db)
      for (const game of ['ygo', 'pkm']) {
        const p = db
          .prepare(
            `SELECT p.id, (SELECT image_id FROM card_images WHERE card_id = p.card_id LIMIT 1) AS imageId
             FROM card_printings p WHERE p.game = ? ORDER BY p.id LIMIT 1`
          )
          .get(game) as { id: number; imageId: number }
        db.prepare(
          `INSERT INTO collection_entries (uid, owner_id, game, printing_id, image_id, quantity, created_at, updated_at, dirty)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0)`
        ).run(crypto.randomUUID(), OWNER.id, game, p.id, p.imageId, NOW, NOW)
      }
      return db
    }

    /** `db` as the phone store takes it (better-sqlite3's `inTransaction` is a property). */
    const asPhoneDb = (db: Awaited<ReturnType<typeof seededDb>>): PhoneDb => ({
      prepare: (sql) => db.prepare(sql),
      exec: (sql) => void db.exec(sql),
      transaction: (fn) => db.transaction(fn),
      inTransaction: () => db.inTransaction
    })

    /** The phone Api over a real store on `db`, offline: what a page load builds. */
    function load(db: Awaited<ReturnType<typeof seededDb>>): { api: Api; events: PhoneEvents } {
      const store = createPhoneStore({
        db: asPhoneDb(db),
        portal: 'https://portal.test',
        fetch: (async () => {
          throw new TypeError('Failed to fetch')
        }) as typeof fetch
      })
      const events = createPhoneEvents()
      const triggers = { afterAdd: vi.fn(), afterPriceRequest: vi.fn() }
      return { api: createPhoneApi({ store, ocr: fakeOcr(), triggers, events }), events }
    }

    const listedGames = async (
      api: Api,
      db: Awaited<ReturnType<typeof seededDb>>
    ): Promise<string[]> =>
      (await api.collection.list({ sort: 'name', dir: 'asc' } as never)).map(
        (e) =>
          (
            db.prepare('SELECT game FROM collection_entries WHERE id = ?').get(e.id) as {
              game: string
            }
          ).game
      )

    it('opening signed out with Pokémon stored shows Yu-Gi-Oh! before any read', async () => {
      const db = await phoneDb()
      db.prepare("INSERT INTO meta (key, value) VALUES ('active_game', 'pkm')").run()
      load(db)
      expect(
        (db.prepare("SELECT value FROM meta WHERE key = 'active_game'").get() as { value: string })
          .value
      ).toBe('ygo')
    })

    it("setActive('pkm') rejects for an account without Pokémon", async () => {
      const db = await phoneDb()
      const { api, events } = load(db)
      await api.account.status()
      const reload = vi.fn()
      events.on('dataChanged', reload)
      await expect(api.games.available()).resolves.toEqual(['ygo'])
      await expect(api.games.setActive('pkm')).rejects.toThrow("isn't available")
      expect(reload).not.toHaveBeenCalled()
      await expect(api.games.active()).resolves.toBe('ygo')
    })

    it('the owner switches to Pokémon, every page reloads, and the choice survives a reload', async () => {
      const db = await phoneDb()
      const first = load(db)
      const store = createPhoneStore({
        db: asPhoneDb(db),
        portal: 'https://portal.test',
        fetch: vi.fn()
      })
      await store.signIn('token', OWNER)
      await expect(first.api.games.available()).resolves.toEqual(['ygo', 'pkm'])
      expect(await listedGames(first.api, db)).toEqual(['ygo'])
      const reload = vi.fn()
      first.events.on('dataChanged', reload)
      await first.api.games.setActive('pkm')
      expect(reload).toHaveBeenCalledTimes(1)
      expect(await listedGames(first.api, db)).toEqual(['pkm'])

      const second = load(db)
      await expect(second.api.games.active()).resolves.toBe('pkm')
      expect(await listedGames(second.api, db)).toEqual(['pkm'])
    })

    it('signing out, then in as an account without Pokémon, shows Yu-Gi-Oh! only', async () => {
      const db = await phoneDb()
      const { api } = load(db)
      const store = createPhoneStore({
        db: asPhoneDb(db),
        portal: 'https://portal.test',
        fetch: (async () => new Response(null, { status: 204 })) as typeof fetch
      })
      await store.signIn('token', OWNER)
      await api.games.setActive('pkm')
      await api.account.signOut()
      expect(
        (db.prepare("SELECT value FROM meta WHERE key = 'active_game'").get() as { value: string })
          .value
      ).toBe('ygo')
      await store.signIn('token-2', { ...ME, id: OWNER.id })
      await expect(api.games.active()).resolves.toBe('ygo')
      expect(await listedGames(api, db)).toEqual(['ygo'])
    })
  })

  describe('merged accounts', () => {
    it("signing in to a merged account adopts the old owner's unsent rows", async () => {
      const db = await seededDb()
      applyPhoneSchema(db)
      const p = db
        .prepare(
          `SELECT p.id, (SELECT image_id FROM card_images WHERE card_id = p.card_id LIMIT 1) AS imageId
           FROM card_printings p WHERE p.game = 'ygo' ORDER BY p.id LIMIT 1`
        )
        .get() as { id: number; imageId: number }
      const T = '2026-10-29T12:00:00.000Z'
      db.prepare(
        `INSERT INTO collection_entries (uid, owner_id, game, printing_id, image_id, quantity, created_at, updated_at, dirty)
         VALUES ('old-uid', 7, 'ygo', ?, ?, 2, ?, ?, 1)`
      ).run(p.id, p.imageId, T, T)
      db.prepare(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('cloud_active_owner', '7')"
      ).run()
      const phoneDb: PhoneDb = {
        prepare: (sql) => db.prepare(sql),
        exec: (sql) => void db.exec(sql),
        transaction: (fn) => db.transaction(fn),
        inTransaction: () => db.inTransaction
      }
      const store = createPhoneStore({ db: phoneDb, portal: 'https://portal.test', fetch: vi.fn() })
      await store.signIn('token', { ...ME, id: 9, mergedFrom: [7] })
      const rows = db
        .prepare('SELECT uid, owner_id, quantity, dirty FROM collection_entries')
        .all() as {
        uid: string
      }[]
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ owner_id: 9, quantity: 2, dirty: 1 })
      expect(rows[0].uid).not.toBe('old-uid')
    })

    it("a sync whose me() reports a merge adopts the old owner's unsent rows and pushes them", async () => {
      const db = await seededDb()
      applyPhoneSchema(db)
      const ps = db
        .prepare(
          `SELECT p.id, (SELECT image_id FROM card_images WHERE card_id = p.card_id LIMIT 1) AS imageId
           FROM card_printings p WHERE p.game = 'ygo' ORDER BY p.id LIMIT 2`
        )
        .all() as { id: number; imageId: number }[]
      const T = '2026-10-29T12:00:00.000Z'
      const insert = db.prepare(
        `INSERT INTO collection_entries (uid, owner_id, game, printing_id, image_id, quantity, created_at, updated_at, dirty)
         VALUES (?, ?, 'ygo', ?, ?, ?, ?, ?, ?)`
      )
      // Account 9 is signed in with a clean row; account 7's unsent rows include one on the same card.
      insert.run('own-uid', 9, ps[0].id, ps[0].imageId, 1, T, T, 0)
      insert.run('old-1', 7, ps[0].id, ps[0].imageId, 4, T, T, 1)
      insert.run('old-2', 7, ps[1].id, ps[1].imageId, 2, T, T, 1)
      const pushed: { uid: string; quantity: number }[] = []
      const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/api/me'))
          return Response.json({ ...ME, id: 9, games: ['ygo'], mergedFrom: [7] })
        if (url.includes('/api/sync/push')) {
          const { entries } = JSON.parse(String(init?.body)) as {
            entries: { uid: string; quantity: number }[]
          }
          pushed.push(...entries)
          return Response.json({ results: entries.map((e) => ({ uid: e.uid, status: 'applied' })) })
        }
        if (url.includes('/api/sync/pull'))
          return Response.json({ entries: [], cursor: 0, more: false })
        if (url.includes('/api/sync/price-changes'))
          return Response.json({ prices: [], cursor: 0, more: false })
        if (url.includes('/api/sync/prices')) return Response.json({ prices: [], status: null })
        return new Response('{}', { status: 404 })
      }) as typeof fetch
      const phoneDb: PhoneDb = {
        prepare: (sql) => db.prepare(sql),
        exec: (sql) => void db.exec(sql),
        transaction: (fn) => db.transaction(fn),
        inTransaction: () => db.inTransaction
      }
      const store = createPhoneStore({
        db: phoneDb,
        portal: 'https://portal.test',
        fetch: fetchMock
      })
      await store.signIn('token', { ...ME, id: 9 })
      await store.sync()
      await store.sync()
      const rows = db
        .prepare('SELECT uid, owner_id, quantity, dirty FROM collection_entries ORDER BY quantity')
        .all() as { uid: string; owner_id: number; quantity: number; dirty: number }[]
      expect(rows.map((r) => [r.owner_id, r.quantity, r.dirty])).toEqual([
        [9, 2, 0],
        [9, 4, 0]
      ])
      expect(rows.find((r) => r.quantity === 4)?.uid).toBe('own-uid')
      expect(pushed.map((e) => e.quantity).sort()).toEqual([2, 4])
    })
  })
})
