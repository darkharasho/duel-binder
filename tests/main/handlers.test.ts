import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { INVOKE_CHANNELS } from '../../src/shared/ipc'
import { createHandlers } from '../../src/main/ipc/handlers'
import { seededDb } from './helpers'

async function makeHandlers() {
  const db = await seededDb()
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
    }
  })
  return { db, handlers }
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
    const list = (await handlers['collection:list']({ sort: 'name', dir: 'asc' })) as { id: number }[]
    expect(list.map((e) => e.id)).toContain(added.id)
    const today = db.prepare('SELECT total_cards AS n FROM value_snapshots').all() as { n: number }[]
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
    const today = db.prepare('SELECT total_cards AS n FROM value_snapshots').all() as { n: number }[]
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
})
