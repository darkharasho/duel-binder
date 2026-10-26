import { describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { INVOKE_CHANNELS } from '../../src/shared/ipc'
import { createHandlers } from '../../src/main/ipc/handlers'
import type { AccountService } from '../../src/main/cloud/account'
import type { PortalChannel } from '../../src/shared/portal'
import type { AccountStatus } from '../../src/shared/types'
import { seededDb } from './helpers'

type FakeAccount = { [K in Exclude<keyof AccountService, 'portal'>]: Mock<AccountService[K]> } & {
  portal: Mock<(channel: PortalChannel, args: unknown[]) => Promise<unknown>>
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
  const lookup = vi.fn(async () => ({
    price: 12.5,
    listingCount: 3,
    checkedAt: '2026-10-23T12:00:00.000Z'
  }))
  const emitDataChanged = vi.fn()
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
    account: account as unknown as AccountService,
    fingerprints: {
      read: async () => null,
      status: () => ({ state: 'missing', count: 0 }),
      refresh: async () => ({ state: 'missing', count: 0 })
    },
    ocr: { read: async () => [], dispose: async () => {} }
  })
  return { db, handlers, lookup, emitDataChanged, account }
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
      unsyncedCount: 0
    }
    account.status.mockReturnValue(status)
    for (const m of ['signIn', 'signOut', 'syncNow'] as const) account[m].mockResolvedValue(status)
    for (const m of ['status', 'signIn', 'signOut', 'syncNow'] as const) {
      await expect(handlers[`account:${m}`]()).resolves.toEqual(status)
      expect(account[m]).toHaveBeenCalledTimes(1)
    }
  })

  it('signed in, adds and a new price address never reach the eBay Worker', async () => {
    const { db, handlers, lookup } = await makeHandlers({ signedIn: true })
    const printing = db
      .prepare(
        'SELECT p.id AS printingId, i.image_id AS imageId FROM card_printings p JOIN card_images i ON i.card_id = p.card_id LIMIT 1'
      )
      .get() as { printingId: number; imageId: number }
    await handlers['collection:add']({ ...printing, quantity: 1 })
    await handlers['prices:setUrl']('https://prices.example')
    await new Promise((r) => setTimeout(r, 10))
    expect(lookup).not.toHaveBeenCalled()
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

  it('collection:add of a ja printing looks up its price once, then emits data changed', async () => {
    const { db, handlers, lookup, emitDataChanged } = await makeHandlers()
    const ja = db
      .prepare(
        `INSERT INTO card_printings (card_id, language, set_name, set_code, set_rarity)
         VALUES (46986414, 'ja', 'Legend of Blue Eyes White Dragon', 'LB-05', 'Ultra Rare') RETURNING id`
      )
      .get() as { id: number }
    await handlers['collection:add']({ printingId: ja.id, imageId: 46986414, quantity: 1 })
    expect(emitDataChanged).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(emitDataChanged).toHaveBeenCalledTimes(1))
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledWith({
      code: 'LB-05',
      name: expect.any(String),
      set: 'Legend of Blue Eyes White Dragon',
      rarity: 'Ultra Rare',
      lang: 'ja'
    })
    // A fresh price is not looked up again.
    await handlers['collection:add']({ printingId: ja.id, imageId: 46986414, quantity: 1 })
    await new Promise((r) => setTimeout(r, 10))
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(emitDataChanged).toHaveBeenCalledTimes(1)
  })

  it('an English add is looked up like any other printing', async () => {
    const { db, handlers, lookup, emitDataChanged } = await makeHandlers()
    const printing = db
      .prepare(
        'SELECT p.id AS printingId, i.image_id AS imageId FROM card_printings p JOIN card_images i ON i.card_id = p.card_id LIMIT 1'
      )
      .get() as { printingId: number; imageId: number }
    await handlers['collection:add']({ ...printing, quantity: 1 })
    await new Promise((r) => setTimeout(r, 10))
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ lang: 'en' }))
    expect(emitDataChanged).toHaveBeenCalledTimes(1)
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
