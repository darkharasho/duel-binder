import type { SqlDb } from '../db/sql'
import type { GameId } from '../../shared/games'
import { isLanguage, type Language } from '../../shared/languages'
import { browseFacets, facetsRollupKey } from './browse'
import { catalogSets, setsRollupKey } from './sets'
import { localScope } from './scope'
import { readRollup, storeRollup } from './rollup'

/**
 * A rollup the desktop builds off the main process (src/main/rollupWorker.ts): Magic's Sets list
 * and Browse filters take seconds over its 900k printings, and on the main process that froze the
 * app after every catalog update.
 */
export type RollupJob =
  { kind: 'sets'; game: GameId } | { kind: 'facets'; game: GameId; language?: Language }

export function rollupJobKey(job: RollupJob): string {
  return job.kind === 'sets' ? setsRollupKey(job.game) : facetsRollupKey(job.game, job.language)
}

/** The job's result from the catalog alone, for its game whatever game is being shown. */
function computeRollupJob(db: SqlDb, job: RollupJob): unknown {
  const scope = localScope(`'${job.game}'`)
  return job.kind === 'sets'
    ? catalogSets(db, scope)
    : browseFacets(db, scope, isLanguage(job.language) ? job.language : undefined)
}

/** How many times a build starts over when the game's catalog changed while it ran. */
const BUILD_TRIES = 3

/**
 * The job's rollup, built and stored unless one is already stored. Meant for a connection of its
 * own (the worker's), where it holds no lock while it computes, so another connection may change
 * the catalog meanwhile. A marker row with the job's game goes in first: the rollup triggers drop it
 * with the game's rollups, so finding it gone after the build means the result may be stale, and
 * the build starts over. After the last try the result is returned but not stored.
 */
export function buildRollup(db: SqlDb, job: RollupJob): unknown {
  const key = rollupJobKey(job)
  const marker = `building:${key}`
  let value: unknown
  for (let attempt = 0; attempt < BUILD_TRIES; attempt++) {
    const stored = readRollup(db, key)
    if (stored !== undefined) return stored
    storeRollup(db, marker, job.game, true)
    // Unable to write (the catalog update holding the lock): build it once, unstored.
    if (readRollup(db, marker) === undefined) return computeRollupJob(db, job)
    db.exec('BEGIN')
    try {
      value = computeRollupJob(db, job)
    } finally {
      db.exec('COMMIT')
    }
    const kept = db.transaction(() => {
      if (readRollup(db, marker) === undefined) return false
      db.prepare('DELETE FROM catalog_rollups WHERE key = ?').run(marker)
      storeRollup(db, key, job.game, value)
      return true
    })()
    if (kept) return value
  }
  return value
}
