import type Database from 'better-sqlite3'
import type { YgoClient } from '../ygo/client'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface SetRow {
  set_name: string
  set_code: string
  tcg_date: string | null
  image_url: string | null
}

export function hasSetData(db: Database.Database): boolean {
  return db.prepare('SELECT 1 FROM sets LIMIT 1').get() !== undefined
}

/** Replaces the sets table with the API list. Never rejects; failures keep the old rows. */
export async function refreshSets(db: Database.Database, client: YgoClient): Promise<boolean> {
  try {
    const payload = await client.fetchCardSets()
    const rows = new Map<string, SetRow>()
    for (const s of payload) {
      if (!s || typeof s.set_name !== 'string' || s.set_name === '') continue
      rows.set(s.set_name, {
        set_name: s.set_name,
        set_code: s.set_code ?? '',
        tcg_date: typeof s.tcg_date === 'string' && DATE_RE.test(s.tcg_date) ? s.tcg_date : null,
        image_url: typeof s.set_image === 'string' ? s.set_image : null
      })
    }
    if (rows.size === 0) {
      console.warn('Set list contained no valid sets; keeping existing set data')
      return false
    }
    const insert = db.prepare(
      'INSERT INTO sets (set_name, set_code, tcg_date, image_url) VALUES (@set_name, @set_code, @tcg_date, @image_url)'
    )
    db.transaction(() => {
      db.exec('DELETE FROM sets')
      for (const row of rows.values()) insert.run(row)
    })()
    return true
  } catch (e) {
    console.warn('Set list refresh failed; keeping existing set data', e)
    return false
  }
}
