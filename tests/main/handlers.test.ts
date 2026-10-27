import { describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { INVOKE_CHANNELS } from '../../src/shared/ipc'
import { createHandlers } from '../../src/main/ipc/handlers'
import type { AccountService } from '../../src/main/cloud/account'
import type { PortalChannel } from '../../src/shared/portal'
import type { AccountStatus, SyncStatus } from '../../src/shared/types'
import { seededDb } from './helpers'

type FakeAccount = { [K in Exclude<keyof AccountService, 'portal'>]: Mock<AccountService[K]> } & {
  portal: Mock<(channel: PortalChannel, args: unknown[]) => Promise<unknown>>
}

const CATALOG_STATUS: SyncStatus = {
  state: 'idle',
  lastSyncAt: '2026-10-26T00:00:00.000Z',
  dbVersion: null,
  cardCount: 3,
  error: null,
  blocked: null,
  blockedRetry: null
}

const fakeAccount = (signedIn = false): FakeAccount => ({
  status: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  syncNow: vi.fn(),
  isSignedIn: vi.fn(() => signedIn),
  noteLocalEdit: vi.fn(),
  catalogRefreshed: vi.fn(),
  refreshCatalog: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  portal: vi.fn()
})

async function makeHandlers(opts: { signedIn?: boolean } = {}) {
  const db = await seededDb()
  const account = fakeAccount(opts.signedIn)
  const scanWindow = { open: vi.fn(), isOpen: vi.fn(() => true), toggleFullScreen: vi.fn() }
  const catalog = { status: vi.fn(() => ({ ...CATALOG_STATUS })) }
  const handlers = createHandlers({
    db,
    images: {
      get: vi.fn(),
      getSet: vi.fn(),
      getPrinting: vi.fn(),
      sizeBytes: async () => 0,
      clear: async () => {}
    },
    catalog,
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
    scanWindow,
    account: account as unknown as AccountService,
    fingerprints: {
      read: async () => null,
      status: () => ({ state: 'missing', count: 0 }),
      refresh: async () => ({ state: 'missing', count: 0 })
    },
    ocr: {
      read: async () => [],
      readText: async () => ({ text: '', confidence: 0 }),
      dispose: async () => {}
    }
  })
  return { db, handlers, account, catalog, scanWindow }
}

describe('createHandlers', () => {
  it('writes tell the account service', async () => {
    const { db, handlers, account } = await makeHandlers()
    const printing = db
      .prepare(
        'SELECT p.id AS printingId, i.image_id AS imageId FROM card_printings p JOIN card_images i ON i.card_id = p.card_id LIMIT 1'
      )
      .get() as { printingId: number; imageId: number }
    const p = db.prepare('SELECT id, set_name AS setName FROM card_printings LIMIT 1').get() as {
      id: number
      setName: string
    }
    const reads = async (): Promise<void> => {
      await handlers['collection:list']({ sort: 'name', dir: 'asc' })
      await handlers['collection:facets']()
      await handlers['stats:get']()
      await handlers['sets:list']()
      await handlers['sets:checklist'](p.setName, 'en')
      await handlers['account:status']()
    }
    await reads()
    expect(account.noteLocalEdit).not.toHaveBeenCalled()

    const added = (await handlers['collection:add']({ ...printing, quantity: 1 })) as { id: number }
    expect(account.noteLocalEdit).toHaveBeenCalledTimes(1)
    await handlers['collection:update'](added.id, { quantity: 3 })
    expect(account.noteLocalEdit).toHaveBeenCalledTimes(2)
    await handlers['collection:remove'](added.id)
    expect(account.noteLocalEdit).toHaveBeenCalledTimes(3)
    await handlers['sets:adjust'](p.setName, 'en', p.id, 1)
    expect(account.noteLocalEdit).toHaveBeenCalledTimes(4)
    // A rejected write tells nobody.
    await expect(handlers['collection:update'](99_999, { quantity: 2 })).rejects.toThrow()
    await reads()
    expect(account.noteLocalEdit).toHaveBeenCalledTimes(4)
  })

  it('scanWindow handlers call the window manager', async () => {
    const { handlers, scanWindow } = await makeHandlers()
    await handlers['scanWindow:open']()
    await handlers['scanWindow:toggleFullScreen']()
    expect(scanWindow.open).toHaveBeenCalledTimes(1)
    expect(scanWindow.toggleFullScreen).toHaveBeenCalledTimes(1)
    await expect(handlers['scanWindow:isOpen']()).resolves.toBe(true)
  })

  it('scan:printingsByCode is wired to the catalog', async () => {
    const { handlers } = await makeHandlers()
    const rows = (await handlers['scan:printingsByCode']('lob-en005')) as { name: string }[]
    expect(rows.map((r) => r.name)).toEqual(['Dark Magician'])
  })

  it('scan:ocr rejects bands the renderer may not send', async () => {
    const { handlers } = await makeHandlers()
    const bad = [{ width: 10, height: 10, data: new Uint8Array(5) }]
    await expect(handlers['scan:ocr'](bad, 'code')).rejects.toThrow('one byte per pixel')
    await expect(handlers['scan:ocr']([], 'other')).rejects.toThrow('Unknown OCR kind')
    await expect(handlers['scan:ocr']([], 'name')).resolves.toEqual([])
  })

  it('scan:cardsForImages rejects anything but integer ids', async () => {
    const { handlers } = await makeHandlers()
    await expect(handlers['scan:cardsForImages']('1')).rejects.toThrow('list of integers')
    await expect(handlers['scan:cardsForImages']([1.5])).rejects.toThrow('list of integers')
    await expect(handlers['scan:cardsForImages']([])).resolves.toEqual([])
  })

  it('account handlers delegate to the account service', async () => {
    const { handlers, account } = await makeHandlers()
    const status: AccountStatus = {
      state: 'signed-out',
      user: null,
      localOwner: 'alice',
      lastSyncedAt: null,
      error: null,
      pendingCount: 0,
      unsyncedCount: 0,
      signInRequired: true
    }
    account.status.mockReturnValue(status)
    for (const m of ['signIn', 'signOut', 'syncNow'] as const) account[m].mockResolvedValue(status)
    for (const m of ['status', 'signIn', 'signOut', 'syncNow'] as const) {
      await expect(handlers[`account:${m}`]()).resolves.toEqual(status)
      expect(account[m]).toHaveBeenCalledTimes(1)
    }
  })

  it('account:deleteAccount rejects', async () => {
    const { handlers } = await makeHandlers({ signedIn: true })
    await expect(handlers['account:deleteAccount']()).rejects.toThrow(
      new Error('Delete your account from app.duelbinder.com')
    )
  })

  it('sync:status reports the catalog and sync:run refreshes it through the account', async () => {
    const { handlers, account, catalog } = await makeHandlers()
    await expect(handlers['sync:status']()).resolves.toEqual(CATALOG_STATUS)
    expect(catalog.status).toHaveBeenCalledTimes(1)
    const refreshed: SyncStatus = { ...CATALOG_STATUS, state: 'error', error: 'offline' }
    account.refreshCatalog.mockResolvedValue(refreshed)
    await expect(handlers['sync:run']()).resolves.toEqual(refreshed)
    expect(account.refreshCatalog).toHaveBeenCalledTimes(1)
  })

  it('every Api method has a handler', async () => {
    const { handlers } = await makeHandlers()
    expect(Object.keys(handlers).sort()).toEqual([...INVOKE_CHANNELS].sort())
  })

  it('collection:add round-trips through handlers', async () => {
    const { db, handlers } = await makeHandlers()
    const printing = db
      .prepare(
        'SELECT p.id AS printingId, i.image_id AS imageId FROM card_printings p JOIN card_images i ON i.card_id = p.card_id LIMIT 1'
      )
      .get() as { printingId: number; imageId: number }
    const added = (await handlers['collection:add']({
      ...printing,
      quantity: 2
    })) as { id: number; quantity: number }
    expect(added.quantity).toBe(2)
    const list = (await handlers['collection:list']({ sort: 'name', dir: 'asc' })) as {
      id: number
    }[]
    expect(list.map((e) => e.id)).toContain(added.id)
    const today = db.prepare('SELECT total_cards AS n FROM value_snapshots').all() as {
      n: number
    }[]
    expect(today).toEqual([{ n: 2 }])
  })

  it('desktop notes are capped at 2000', async () => {
    const { db, handlers } = await makeHandlers()
    const printing = db
      .prepare(
        'SELECT p.id AS printingId, i.image_id AS imageId FROM card_printings p JOIN card_images i ON i.card_id = p.card_id LIMIT 1'
      )
      .get() as { printingId: number; imageId: number }
    const long = 'x'.repeat(2001)
    await expect(
      handlers['collection:add']({ ...printing, quantity: 1, notes: long } as never)
    ).rejects.toThrow('notes must be at most 2000 characters')
    expect(db.prepare('SELECT COUNT(*) AS n FROM collection_entries').get()).toEqual({ n: 0 })
    const added = (await handlers['collection:add']({ ...printing, quantity: 1 })) as { id: number }
    await expect(handlers['collection:update'](added.id, { notes: long })).rejects.toThrow(
      'notes must be at most 2000 characters'
    )
    const ok = (await handlers['collection:update'](added.id, { notes: 'x'.repeat(2000) })) as {
      notes: string
    }
    expect(ok.notes).toHaveLength(2000)
  })

  it('sets:adjust records the value snapshot', async () => {
    const { db, handlers } = await makeHandlers()
    const p = db.prepare('SELECT id, set_name AS setName FROM card_printings LIMIT 1').get() as {
      id: number
      setName: string
    }
    const card = (await handlers['sets:adjust'](p.setName, 'en', p.id, 1)) as { owned: number }
    expect(card.owned).toBe(1)
    const today = db.prepare('SELECT total_cards AS n FROM value_snapshots').all() as {
      n: number
    }[]
    expect(today).toEqual([{ n: 1 }])
  })

  it('sets:checklist and sets:adjust pass the language through', async () => {
    const { db, handlers } = await makeHandlers()
    const p = db.prepare('SELECT id, set_name AS setName FROM card_printings LIMIT 1').get() as {
      id: number
      setName: string
    }
    expect(await handlers['sets:checklist'](p.setName, 'ja')).toBeNull()
    expect(await handlers['sets:checklist'](p.setName, 'en')).not.toBeNull()
    await expect(handlers['sets:adjust'](p.setName, 'ja', p.id, 1)).rejects.toThrow(/\(ja\)/)
  })

  it('sets handlers reject an unknown or non-string language without writing', async () => {
    const { db, handlers } = await makeHandlers()
    const p = db.prepare('SELECT id, set_name AS setName FROM card_printings LIMIT 1').get() as {
      id: number
      setName: string
    }
    for (const bad of ['xx', 5]) {
      await expect(handlers['sets:checklist'](p.setName, bad)).rejects.toThrow(/language/i)
      await expect(handlers['sets:adjust'](p.setName, bad, p.id, 1)).rejects.toThrow(/language/i)
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM collection_entries').get()).toEqual({ n: 0 })
  })
})

describe('friends handlers', () => {
  it('overview forwards to the account', async () => {
    const { handlers, account } = await makeHandlers({ signedIn: true })
    const overview = { friends: [], incoming: [], outgoing: [] }
    account.portal.mockResolvedValue(overview)
    expect(await handlers['friends:overview']()).toBe(overview)
    expect(account.portal).toHaveBeenCalledWith('friends:overview', [])
  })

  it('collection forwards and marks every entry as not original art', async () => {
    const { handlers, account } = await makeHandlers({ signedIn: true })
    const f = { sort: 'name', dir: 'asc' } as const
    account.portal.mockResolvedValue([
      { id: 1, originalArt: true },
      { id: 2, originalArt: true }
    ])
    const out = await handlers['friends:collection'](7, f)
    expect(account.portal).toHaveBeenCalledWith('friends:collection', [7, f])
    expect(out).toEqual([
      { id: 1, originalArt: false },
      { id: 2, originalArt: false }
    ])
  })

  it('the other channels forward their arguments', async () => {
    const { handlers, account } = await makeHandlers({ signedIn: true })
    account.portal.mockResolvedValue(undefined)
    await handlers['friends:request']('bob')
    await handlers['friends:accept'](3)
    await handlers['friends:ignore'](4)
    await handlers['friends:remove'](5)
    await handlers['friends:facets'](6)
    expect(account.portal.mock.calls).toEqual([
      ['friends:request', ['bob']],
      ['friends:accept', [3]],
      ['friends:ignore', [4]],
      ['friends:remove', [5]],
      ['friends:facets', [6]]
    ])
  })
})
