import type { SqlDb } from '../db/sql'
import type { FingerprintRefsFile, ScanRef } from '../../shared/scan/fingerprintRefs'

// Imported by the phone's store worker too: keep it to this one lookup.

/**
 * The refs file's refs with their printings as this catalog's printing ids, found by natural key
 * (card_printings.pkey). Printings the catalog doesn't have are left out, and so is a ref left
 * with none.
 */
export function scanRefs(db: SqlDb, file: FingerprintRefsFile): ScanRef[] {
  const keys = [...new Set(file.refs.flatMap((r) => r.printings))]
  const idOf = new Map<string, number>()
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500)
    const rows = db
      .prepare(
        `SELECT id, pkey FROM card_printings WHERE pkey IN (${chunk.map(() => '?').join(',')})`
      )
      .all(...chunk) as { id: number; pkey: string }[]
    for (const r of rows) idOf.set(r.pkey, r.id)
  }
  return file.refs.flatMap((r) => {
    const printingIds = r.printings.flatMap((k) => idOf.get(k) ?? [])
    return printingIds.length ? [{ h: r.h, imageId: r.imageId, printingIds }] : []
  })
}
