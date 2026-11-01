import type { SqlDb } from './sql'

export type MetaKey =
  | 'last_sync_at'
  | 'db_version'
  | 'intl_sets_synced_at'
  | 'price_service_status'
  | 'price_worker_url'
  | 'tcgplayer_synced_at'
  | 'pack_art_synced_at'
  | 'set_logos_synced_at'
  | 'konami_logos_synced_at'
  /** When the nightly job last matched Pokémon pack art and fallback logos (pokemon_set_art). */
  | 'pkm_set_art_synced_at'
  /** The cloud account whose collection is shown, as an integer string; absent means 0 (local). */
  | 'cloud_active_owner'
  /** The signed-in user's `Me` as JSON; absent when signed out. */
  | 'cloud_user'
  /** Seq of the last server catalog change applied locally (Yu-Gi-Oh!). */
  | 'catalog_cursor'
  /** The same for Pokémon; absent means its feed starts from 0. */
  | 'catalog_cursor:pkm'
  /**
   * Seq of the last change downloaded into `catalog_staging`: the switch's snapshot until it's done,
   * then a delta pull not yet applied (Yu-Gi-Oh!).
   */
  | 'catalog_staging_cursor'
  /** The same for a Pokémon delta pull. */
  | 'catalog_staging_cursor:pkm'
  /** When this desktop switched to the server's catalog (ISO); absent means not yet. */
  | 'catalog_switched_at'
  /** Path of the database copy taken just before the switch. */
  | 'catalog_switch_backup'
  /** Why the last switch attempt didn't finish, as JSON `{ reason, at, retry }`. */
  | 'catalog_switch_failed'
  /** Catalog work committed but not yet reported, as JSON `{ cardsChanged, imagesChanged, needsFinish }`. */
  | 'catalog_unannounced'
  /** Set once this database has its art links; see backfillArtTwins. */
  | 'art_twins_backfilled'
  | 'traditional_twins_backfilled'
  /** UTC day (YYYY-MM-DD) the portal last listed its eBay sweep prefixes. */
  | 'price_sweeps_listed_at'
  | 'price_sweeps_pkm_listed_at'
  | 'sweep_pokemon_day'
  /** The portal's eBay sweep calls for one UTC day, as `YYYY-MM-DD:N`. */
  | 'sweep_calls_day'
  /** When the token cards were last read from Yugipedia (ISO). */
  | 'token_cards_synced_at'
  /** Seq of the last server price change applied from the price change feed. */
  | 'price_feed_cursor'
  /** The game this device shows ('ygo' or 'pkm'); absent means 'ygo'. Read in SQL as ACTIVE_GAME. */
  | 'active_game'

export function getMeta(db: SqlDb, key: MetaKey): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    { value: string } | undefined
  return row?.value ?? null
}

export function setMeta(db: SqlDb, key: MetaKey, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

export function deleteMeta(db: SqlDb, key: MetaKey): void {
  db.prepare('DELETE FROM meta WHERE key = ?').run(key)
}
