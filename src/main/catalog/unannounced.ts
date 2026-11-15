import type { SqlDb } from '../db/sql'
import { getMeta, setMeta } from '../db/meta'
import { finishApply } from './apply'

/** Committed catalog work not yet announced; stored as JSON in meta `catalog_unannounced`. */
export interface Unannounced {
  cardsChanged: boolean
  imagesChanged: boolean
  /** `finishApply` (the search index rebuild) hasn't run for it yet. */
  needsFinish: boolean
}

/**
 * Catalog work already committed but not yet reported by a successful update (and, with
 * `needsFinish`, not yet followed by `finishApply`). Survives a failed update and a restart.
 */
export function unannounced(db: SqlDb): Unannounced | null {
  const raw = getMeta(db, 'catalog_unannounced')
  if (raw === null) return null
  try {
    return JSON.parse(raw) as Unannounced
  } catch {
    return { cardsChanged: true, imagesChanged: true, needsFinish: true }
  }
}

/** ORs `work` into the unannounced record; call it in the transaction that commits the work. */
export function noteUnannounced(db: SqlDb, work: Unannounced): void {
  const u = unannounced(db)
  const merged: Unannounced = {
    cardsChanged: work.cardsChanged || (u?.cardsChanged ?? false),
    imagesChanged: work.imagesChanged || (u?.imagesChanged ?? false),
    needsFinish: work.needsFinish || (u?.needsFinish ?? false)
  }
  setMeta(db, 'catalog_unannounced', JSON.stringify(merged))
}

/**
 * Runs the `finishApply` committed work still waits for. `run` wraps the transaction (a worker
 * passes one that takes the write lock up front).
 */
export function finishPending(
  db: SqlDb,
  run: (fn: () => void) => void = (fn) => db.transaction(fn)()
): void {
  if (!unannounced(db)?.needsFinish) return
  run(() => {
    const u = unannounced(db)
    if (!u?.needsFinish) return
    finishApply(db, { applied: 1, cardsChanged: u.cardsChanged, imagesChanged: u.imagesChanged })
    setMeta(db, 'catalog_unannounced', JSON.stringify({ ...u, needsFinish: false }))
  })
}
