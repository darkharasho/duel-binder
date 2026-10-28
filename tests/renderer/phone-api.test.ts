import { afterEach, describe, expect, it, vi } from 'vitest'
import { DATA_CHANNELS } from '../../src/main/ipc/dataHandlers'
import type { PhoneStore } from '../../src/phone/data/store'
import { createPhoneApi, createPhoneEvents, type PhoneEvents } from '../../src/phone/api'
import type { Api } from '../../src/shared/ipc'
import type { Ocr } from '../../src/shared/scan/ocr'
import type { OcrBand } from '../../src/shared/scan/types'
import type { EntryView } from '../../src/shared/types'

const ME = { id: 7, username: 'alice', displayName: 'Alice', avatarUrl: null }

function fakeStore(over: Partial<PhoneStore> = {}): PhoneStore {
  return {
    account: vi.fn(async () => ({ state: 'signed-in' as const, user: ME })),
    signIn: vi.fn(async () => {}),
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
    requestPrices: vi.fn(async () => 0),
    fingerprints: vi.fn(async () => null),
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

  it('friends.collection clears originalArt', async () => {
    const entries = [
      { id: 1, originalArt: true },
      { id: 2, originalArt: false }
    ] as EntryView[]
    const portal = vi.fn(async () => entries)
    const { api } = setup(fakeStore({ portal: portal as unknown as PhoneStore['portal'] }))
    const got = await api.friends.collection(5, {} as never)
    expect(got.map((e) => e.originalArt)).toEqual([false, false])
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

  it('scan fingerprints go to the store', async () => {
    const { api, store } = setup()
    await api.scan.fingerprints()
    await expect(api.scan.refreshFingerprints()).resolves.toEqual({ state: 'ready', count: 3 })
    expect(store.fingerprints).toHaveBeenCalled()
    expect(store.refreshFingerprints).toHaveBeenCalled()
  })

  it('scanWindow.isOpen is false', async () => {
    const { api } = setup()
    await expect(api.scanWindow.isOpen()).resolves.toBe(false)
    await expect(api.scanWindow.open()).resolves.toBeUndefined()
    expect(() => api.scanWindow.send({} as never)).not.toThrow()
    expect(typeof api.scanWindow.onMessage(() => {})).toBe('function')
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
})
