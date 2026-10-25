import type Database from 'better-sqlite3'
import type { SyncStatus } from '@shared/types'
import { getMeta } from '../db/meta'
import type { YgoClient } from '../ygo/client'
import type { YugipediaClient } from '../yugipedia/client'
import { runSync, shouldSync } from './sync'
import { hasSetData, refreshSets } from './sets'
import { refreshIntlSets, shouldRefreshIntl } from './intl'
import { refreshSetLogos, shouldRefreshSetLogos } from '../yugipedia/setLogos'
import { refreshPackArt, shouldRefreshPackArt } from '../konami/packArt'
import { refreshKonamiLogos, shouldRefreshKonamiLogos } from '../konami/logos'
import { refreshTcgCatalog, shouldRefreshTcgCatalog } from '../tcgplayer/catalog'
import { applyTcgPrices, refreshTcgPrices } from '../tcgplayer/prices'

// Runs headless in the nightly catalog job (ELECTRON_RUN_AS_NODE), so nothing reachable from
// here may import 'electron'.

export interface RefreshCatalogDeps {
  client: YgoClient
  yugipedia: YugipediaClient
  version: string
  now?: () => Date
  onSyncProgress?: (s: SyncStatus) => void
  /** Called right after a successful card sync, before the remaining refreshes. */
  onSynced?: () => void
  /** Called whenever a step changed data the UI shows. */
  onChanged?: () => void
  /**
   * Which sets' TCGplayer prices to keep: only those holding an owned English printing (desktop,
   * the default), or every set (the nightly job, which shares them with the portal).
   */
  tcgPrices?: 'owned' | 'all'
}

/**
 * Brings the shared card catalog up to date: card sync, English sets, TCGplayer catalog and prices, pack
 * art, set logos, Konami logos and non-English sets, each only when its interval has passed.
 * `changed` is true when the cards or the non-English sets were refreshed.
 */
export async function refreshCatalog(
  db: Database.Database,
  deps: RefreshCatalogDeps
): Promise<{ changed: boolean }> {
  const { client, yugipedia, version } = deps
  const now = deps.now ?? ((): Date => new Date())
  const onChanged = deps.onChanged ?? ((): void => {})
  // These refreshers stamp their sync time when they finish unless given one; pass it only when
  // the caller fixes the clock, so desktop keeps finish-time stamps.
  const stamp = (): { now?: Date } => (deps.now ? { now: deps.now() } : {})
  let changed = false
  /** Printings or their TCGplayer products changed, so market prices must be matched again. */
  let rematch = false
  if (shouldSync(getMeta(db, 'last_sync_at'), now())) {
    const status = await runSync(db, client, deps.onSyncProgress ?? (() => {}), now())
    if (status.state === 'idle') {
      deps.onSynced?.()
      changed = true
      rematch = true
    }
  } else if (!hasSetData(db)) {
    changed = await refreshSets(db, client)
  }
  if (shouldRefreshTcgCatalog(db, now())) {
    // A few minutes at most; English cards then show their TCGplayer photos.
    const tcg = await refreshTcgCatalog(db, { version, ...stamp() })
    if (tcg.updatedGroups > 0) {
      rematch = true
      onChanged()
    }
  }
  const prices = await refreshTcgPrices(db, { version, scope: deps.tcgPrices ?? 'owned', ...stamp() })
  if ((rematch || prices.updatedGroups > 0) && applyTcgPrices(db) > 0) onChanged()
  if (hasSetData(db) && shouldRefreshPackArt(db, now())) {
    if ((await refreshPackArt(db, { version, ...stamp() })) > 0) onChanged()
  }
  if (hasSetData(db) && shouldRefreshSetLogos(db, now())) {
    if ((await refreshSetLogos(db, yugipedia, now())) > 0) onChanged()
  }
  if (hasSetData(db) && shouldRefreshKonamiLogos(db, now())) {
    if ((await refreshKonamiLogos(db, { version, ...stamp() })) > 0) onChanged()
  }
  const { n } = db.prepare('SELECT count(*) AS n FROM cards').get() as { n: number }
  if (n > 0 && shouldRefreshIntl(db, now())) {
    // Each saved batch calls onChanged, so sets appear while a long first sync runs.
    await refreshIntlSets(db, yugipedia, now(), deps.onChanged)
    changed = true
  }
  return { changed }
}
