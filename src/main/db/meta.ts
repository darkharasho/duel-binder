import type Database from 'better-sqlite3'

export type MetaKey = 'last_sync_at' | 'db_version' | 'intl_sets_synced_at' | 'price_service_status'

export function getMeta(db: Database.Database, key: MetaKey): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setMeta(db: Database.Database, key: MetaKey, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}
