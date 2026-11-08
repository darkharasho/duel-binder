import type { SqlDb } from '../db/sql'
// Imported by the phone's store worker too.
import type { LocalPrintings } from '../../shared/friendPrintings'

/** This catalog's id for each server printing id it has (friendPrintings.ts), by remote_id. */
export function localPrintings(db: SqlDb, serverIds: number[]): LocalPrintings {
  const ids = [...new Set(serverIds.filter((id) => Number.isSafeInteger(id)))]
  const out = new Map<number, number>()
  if (ids.length === 0) return out
  const rows = db
    .prepare(
      'SELECT remote_id, id FROM card_printings WHERE remote_id IN (SELECT value FROM json_each(?))'
    )
    .all(JSON.stringify(ids)) as { remote_id: number; id: number }[]
  for (const r of rows) out.set(r.remote_id, r.id)
  return out
}
