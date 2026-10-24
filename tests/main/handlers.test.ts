import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { INVOKE_CHANNELS } from '../../src/shared/ipc'
import { createHandlers } from '../../src/main/ipc/handlers'
import { seededDb } from './helpers'

async function makeHandlers() {
  const db = await seededDb()
  const lookup = vi.fn(async () => ({ price: 12.5, listingCount: 3, checkedAt: '2026-10-23T12:00:00.000Z' }))
  const emitDataChanged = vi.fn()
  const handlers = createHandlers({
    db,
    client: { fetchDbVersion: vi.fn(), fetchCardInfo: vi.fn(), fetchCardSets: vi.fn() },
    images: { get: vi.fn(), getSet: vi.fn(), sizeBytes: async () => 0, clear: async () => {} },
    emitSync: () => {},
    app: {
      version: () => '0.0.0',
      openDataFolder: async () => {},
      backupDatabase: async () => null,
      updateStatus: async () => ({ state: 'idle', mode: 'auto', version: null, error: null }),
      checkForUpdates: async () => ({ state: 'none', mode: 'auto', version: null, error: null }),
      applyUpdate: async () => {}
    },
    priceClient: { lookup },
    emitDataChanged
  })
  return { db, handlers, lookup, emitDataChanged }
}

describe('createHandlers', () => {
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

  it('an English add looks up nothing and emits nothing', async () => {
    const { db, handlers, lookup, emitDataChanged } = await makeHandlers()
    const printing = db
      .prepare(
        'SELECT p.id AS printingId, i.image_id AS imageId FROM card_printings p JOIN card_images i ON i.card_id = p.card_id LIMIT 1'
      )
      .get() as { printingId: number; imageId: number }
    await handlers['collection:add']({ ...printing, quantity: 1 })
    await new Promise((r) => setTimeout(r, 10))
    expect(lookup).not.toHaveBeenCalled()
    expect(emitDataChanged).not.toHaveBeenCalled()
  })
})
