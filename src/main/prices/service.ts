import type Database from 'better-sqlite3'
import type { PriceSettings } from '@shared/types'
import { getMeta, setMeta } from '../db/meta'
import { createPriceClient, type PriceClient } from './client'
import { normalizeWorkerUrl, priceWorkerUrl, PRICE_WORKER_URL } from './config'

/** Holds the current price client, rebuilt when the address changes in Settings. */
export interface PriceService {
  client(): PriceClient | null
  settings(): PriceSettings
  /** Saves an address ('' turns prices off) or, with null, goes back to the built-in one. */
  setUrl(url: string | null): PriceSettings
}

export function createPriceService(db: Database.Database): PriceService {
  let current: PriceClient | null = null
  const rebuild = (): void => {
    const url = priceWorkerUrl(getMeta(db, 'price_worker_url'))
    current = url ? createPriceClient({ url }) : null
    if (!current) setMeta(db, 'price_service_status', 'unavailable')
  }
  rebuild()
  const settings = (): PriceSettings => {
    const saved = getMeta(db, 'price_worker_url')
    return {
      url: saved ?? PRICE_WORKER_URL,
      defaultUrl: PRICE_WORKER_URL,
      isDefault: saved === null,
      envOverride: process.env['YGO_PRICE_WORKER_URL'] !== undefined
    }
  }
  return {
    client: () => current,
    settings,
    setUrl(url) {
      if (url === null) db.prepare("DELETE FROM meta WHERE key = 'price_worker_url'").run()
      else setMeta(db, 'price_worker_url', normalizeWorkerUrl(url))
      rebuild()
      return settings()
    }
  }
}
