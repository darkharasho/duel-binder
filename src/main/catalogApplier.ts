import type { Worker } from 'node:worker_threads'
import type Database from 'better-sqlite3'
import { runApplyJob, withoutForeignKeys, type CatalogApplyJob } from './catalog/applyJob'

/**
 * A job cut off because the applier was stopped (the app is quitting): not a failure of the job,
 * so whatever it was doing is left to carry on next launch.
 */
export class CatalogApplierStopped extends Error {
  constructor() {
    super('Catalog worker stopped')
    this.name = 'CatalogApplierStopped'
  }
}

/** Applies staged catalog changes and rebuilds the search index (see runApplyJob). */
export interface CatalogApplier {
  run(job: CatalogApplyJob): Promise<void>
  dispose(): void
}

/** On the main process's own connection: tests, and the dev profile with fake data. */
export function inProcessApplier(db: Database.Database): CatalogApplier {
  return {
    async run(job) {
      withoutForeignKeys(db, () => runApplyJob(db, job))
    },
    dispose() {
      // Nothing runs off the main process.
    }
  }
}

type Reply = { id: number; error?: string }

/**
 * On a worker thread (src/main/catalogApplyWorker.ts) that `start` makes: on the first job, and
 * again after it dies. Jobs run one at a time, in the order sent.
 */
export function workerApplier(start: () => Worker): CatalogApplier {
  let worker: Worker | null = null
  let nextId = 1
  const waiting = new Map<number, { resolve(): void; reject(e: Error): void }>()

  const failAll = (e: Error): void => {
    for (const w of waiting.values()) w.reject(e)
    waiting.clear()
  }

  const ensure = (): Worker => {
    if (worker) return worker
    const w = start()
    w.on('message', (r: Reply) => {
      const p = waiting.get(r.id)
      if (!p) return
      waiting.delete(r.id)
      if (r.error !== undefined) p.reject(new Error(r.error))
      else p.resolve()
    })
    const dead = (e: Error): void => {
      if (worker === w) worker = null
      failAll(e)
    }
    w.on('error', dead)
    w.on('exit', (code) => dead(new Error(`Catalog worker exited (${code})`)))
    // Never keeps the app from quitting: what it committed stays, the rest stays staged.
    w.unref()
    worker = w
    return w
  }

  return {
    run(job) {
      return new Promise<void>((resolve, reject) => {
        const id = nextId++
        waiting.set(id, { resolve, reject })
        try {
          ensure().postMessage({ id, job })
        } catch (e) {
          waiting.delete(id)
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      })
    },
    dispose() {
      const w = worker
      worker = null
      failAll(new CatalogApplierStopped())
      void w?.terminate()
    }
  }
}
