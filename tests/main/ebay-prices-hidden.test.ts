import { describe, expect, it, vi } from 'vitest'
import { seededDb } from './helpers'
import type { CloudClient } from '../../src/main/cloud/client'
import { requestPrices } from '../../src/main/cloud/priceRequests'
import { addEntry, listEntries } from '../../src/main/repo/collection'
import { ebayPricesHidden, setEbayPricesHidden } from '../../src/main/repo/scope'

const ALL = { sort: 'name' } as Parameters<typeof listEntries>[1]

describe('hiding eBay prices', () => {
  it('takes them out of a price and puts them back, leaving the rows alone', async () => {
    const db = await seededDb()
    const p = db
      .prepare(
        "SELECT id, card_id FROM card_printings WHERE language <> 'en' AND game = 'ygo' LIMIT 1"
      )
      .get() as { id: number; card_id: number } | undefined
    const printing =
      p ??
      (db.prepare("SELECT id, card_id FROM card_printings WHERE game = 'ygo' LIMIT 1").get() as {
        id: number
        card_id: number
      })
    db.prepare('UPDATE card_printings SET market_price = NULL, set_price = NULL WHERE id = ?').run(
      printing.id
    )
    db.prepare(
      "INSERT OR REPLACE INTO intl_prices (printing_id, price, checked_at, listing_count) VALUES (?, 99, '2026-11-01', 3)"
    ).run(printing.id)
    const { image_id: imageId } = db
      .prepare('SELECT image_id FROM card_images WHERE card_id = ? LIMIT 1')
      .get(printing.card_id) as { image_id: number }
    addEntry(db, { printingId: printing.id, imageId, quantity: 1 }, new Date('2026-11-01'))
    const price = (): number | null => listEntries(db, ALL)[0].unitPrice

    expect(ebayPricesHidden(db)).toBe(false)
    expect(price()).toBe(99)
    setEbayPricesHidden(db, true)
    expect(ebayPricesHidden(db)).toBe(true)
    expect(price()).not.toBe(99)
    setEbayPricesHidden(db, false)
    expect(price()).toBe(99)
  })

  it('stops asking the portal for eBay prices', async () => {
    const db = await seededDb()
    setEbayPricesHidden(db, true)
    const client = { requestPrices: vi.fn() } as unknown as CloudClient
    expect(await requestPrices(db, client, [1], new Date())).toBe(0)
    expect(client.requestPrices).not.toHaveBeenCalled()
  })
})
