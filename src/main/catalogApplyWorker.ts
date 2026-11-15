import { parentPort, workerData } from 'node:worker_threads'
import Database from 'better-sqlite3'
import { runApplyJob, type CatalogApplyJob } from './catalog/applyJob'

/**
 * Applies pulled catalog changes (src/main/catalogApplier.ts) on its own connection to the
 * collection database, opened after the main process has migrated it. A first Magic pull is about
 * two million rows: applied on the main process it froze the app for minutes. Foreign keys stay
 * off on this connection (see runApplyJob); each transaction takes the write lock up front and is
 * short, with a pause after it, so the main process's writes barely wait; a busy lock here is waited
 * out.
 */
const db = new Database((workerData as { file: string }).file)
db.pragma('busy_timeout = 10000')
db.pragma('foreign_keys = OFF')

const nap = new Int32Array(new SharedArrayBuffer(4))
/** Leaves the write lock free as long as a chunk held it, so the main process gets its turn. */
const pause = (heldMs: number): void => {
  Atomics.wait(nap, 0, 0, Math.min(Math.max(heldMs, 5), 250))
}

parentPort?.on('message', ({ id, job }: { id: number; job: CatalogApplyJob }) => {
  try {
    runApplyJob(db, job, { immediate: true, pause })
    parentPort?.postMessage({ id })
  } catch (e) {
    parentPort?.postMessage({ id, error: e instanceof Error ? e.message : String(e) })
  }
})
