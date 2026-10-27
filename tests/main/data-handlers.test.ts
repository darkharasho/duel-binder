import { describe, expect, it, vi } from 'vitest'
import { INVOKE_CHANNELS } from '../../src/shared/ipc'
import { DATA_CHANNELS, createDataHandlers } from '../../src/main/ipc/dataHandlers'
import { seededDb } from './helpers'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function make() {
  const db = await seededDb()
  const onEdit = vi.fn()
  return { db, onEdit, handlers: createDataHandlers({ db, onEdit }) }
}

describe('data handlers', () => {
  it('covers exactly DATA_CHANNELS', async () => {
    const { handlers } = await make()
    expect(Object.keys(handlers).sort()).toEqual([...DATA_CHANNELS].sort())
  })

  it('every data channel is an INVOKE_CHANNELS member', () => {
    for (const c of DATA_CHANNELS) expect(INVOKE_CHANNELS).toContain(c)
  })

  it('collection:add calls onEdit once and records a snapshot', async () => {
    const { db, onEdit, handlers } = await make()
    const printing = db
      .prepare(
        'SELECT p.id AS printingId, i.image_id AS imageId FROM card_printings p JOIN card_images i ON i.card_id = p.card_id LIMIT 1'
      )
      .get() as { printingId: number; imageId: number }
    await handlers['collection:add']({ ...printing, quantity: 2 })
    expect(onEdit).toHaveBeenCalledTimes(1)
    const rows = db.prepare('SELECT total_cards AS n FROM value_snapshots').all()
    expect(rows).toEqual([{ n: 2 }])
  })

  it('scan:cardsForImages rejects non-integer ids', async () => {
    const { handlers } = await make()
    await expect(handlers['scan:cardsForImages']([1, 'x'])).rejects.toThrow('list of integers')
  })
})
