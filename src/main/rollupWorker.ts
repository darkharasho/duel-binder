import { parentPort, workerData } from 'node:worker_threads'
import Database from 'better-sqlite3'
import { buildRollup, type RollupJob } from './repo/rollupJobs'

/**
 * The catalog rollup builder (src/main/rollupRunner.ts): its own connection to the collection
 * database, opened after the main process has migrated it. A busy write lock is waited out briefly;
 * the main process's writes are short.
 */
const db = new Database((workerData as { file: string }).file)
db.pragma('busy_timeout = 5000')

parentPort?.on('message', ({ id, job }: { id: number; job: RollupJob }) => {
  try {
    parentPort?.postMessage({ id, value: buildRollup(db, job) })
  } catch (e) {
    parentPort?.postMessage({ id, error: e instanceof Error ? e.message : String(e) })
  }
})
