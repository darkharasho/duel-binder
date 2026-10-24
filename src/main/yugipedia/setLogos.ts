import type Database from 'better-sqlite3'
import { getMeta, setMeta } from '../db/meta'
import { yugipediaImageKey } from '../images/cache'
import type { YugipediaClient } from './client'

/**
 * English set logos from Yugipedia, which names them "<set code>-LogoEN.png". Only some sets have
 * one (mostly core boosters); the rest show their pack instead. Checked weekly, as logos get added.
 */
export const SET_LOGOS_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

const logoFile = (setCode: string): string => `${setCode}-LogoEN.png`

export function shouldRefreshSetLogos(db: Database.Database, now: Date): boolean {
  const last = getMeta(db, 'set_logos_synced_at')
  if (!last) return true
  const t = Date.parse(last)
  return Number.isNaN(t) || now.getTime() - t >= SET_LOGOS_INTERVAL_MS
}

/** Never rejects. Returns how many English sets have a logo afterwards. */
export async function refreshSetLogos(
  db: Database.Database,
  client: Pick<YugipediaClient, 'fetchImageUrls'>,
  now = new Date()
): Promise<number> {
  const sets = db
    .prepare(
      `SELECT set_name, set_code FROM sets
       WHERE language = 'en' AND set_code GLOB '[A-Za-z0-9]*' AND set_code NOT GLOB '*[^A-Za-z0-9]*'`
    )
    .all() as { set_name: string; set_code: string }[]
  let urls: Map<string, string>
  try {
    urls = await client.fetchImageUrls([...new Set(sets.map((s) => logoFile(s.set_code)))])
  } catch (e) {
    console.warn('Set logos failed:', e instanceof Error ? e.message : String(e))
    return 0 // keep what's stored; try again next start
  }

  const insert = db.prepare(
    'INSERT OR IGNORE INTO set_logos (set_name, image_url, image_key) VALUES (?, ?, ?)'
  )
  let n = 0
  db.transaction(() => {
    db.exec('DELETE FROM set_logos')
    for (const s of sets) {
      const url = urls.get(logoFile(s.set_code)) ?? null
      const key = yugipediaImageKey(url)
      if (url && key) n += insert.run(s.set_name, url, key).changes
    }
  })()
  setMeta(db, 'set_logos_synced_at', now.toISOString())
  console.info(`Set logos: ${n} of ${sets.length} English sets`)
  return n
}
