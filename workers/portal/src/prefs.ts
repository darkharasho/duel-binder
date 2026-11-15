import type { SqlDb } from '../../../src/main/db/sql'
import { CollectionError } from '../../../src/main/repo/collection'
import { parsePrefs, validPrefsPatch, type Prefs } from '../../../src/shared/prefs'

/** The user's synced preferences; stored text that is missing or corrupt reads as the defaults. */
export function getPrefs(db: SqlDb, userId: number): Prefs {
  const row = db.prepare('SELECT prefs FROM users WHERE id = ?').get(userId) as
    | { prefs: string | null }
    | undefined
  let raw: unknown = null
  if (row?.prefs) {
    try {
      raw = JSON.parse(row.prefs)
    } catch {
      raw = null
    }
  }
  return parsePrefs(raw)
}

/**
 * Merges `patch` over the stored prefs and stores the result. The merge is shallow, at the top level
 * only: `{ ...current, ...patch }`. So a patch's `wash` replaces the stored `wash` as a whole object
 * (a stored `locked` is dropped unless the patch's `wash` carries it too), and an empty patch changes
 * nothing. Throws CollectionError (a 400) on an invalid patch, leaving the stored value alone.
 */
export function setPrefs(db: SqlDb, userId: number, patch: unknown): Prefs {
  const valid = validPrefsPatch(patch)
  if (!valid) throw new CollectionError('invalid prefs')
  const merged = parsePrefs({ ...getPrefs(db, userId), ...valid })
  db.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(merged), userId)
  return merged
}
