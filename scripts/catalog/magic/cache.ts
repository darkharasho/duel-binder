import Database from 'better-sqlite3'
import type { SetStat } from '../priceShare'

export interface MagicCache {
  getSetStats(setCode: string): SetStat | null
  putSetStats(row: SetStat): void
  close(): void
}

/** The job-local source cache (catalog-work/magic-src.sqlite): last night's priced share per set. */
export function openMagicCache(path: string): MagicCache {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(
    'CREATE TABLE IF NOT EXISTS set_stats (set_code TEXT PRIMARY KEY, printings INTEGER NOT NULL, priced INTEGER NOT NULL)'
  )
  const sel = db.prepare('SELECT set_code, printings, priced FROM set_stats WHERE set_code = ?')
  const ins = db.prepare(
    'INSERT INTO set_stats (set_code, printings, priced) VALUES (?, ?, ?) ON CONFLICT(set_code) DO UPDATE SET printings = excluded.printings, priced = excluded.priced'
  )
  return {
    getSetStats(code) {
      const r = sel.get(code) as { set_code: string; printings: number; priced: number } | undefined
      return r ? { setCode: r.set_code, printings: r.printings, priced: r.priced } : null
    },
    putSetStats(s) {
      ins.run(s.setCode, s.printings, s.priced)
    },
    close() {
      db.close()
    }
  }
}
