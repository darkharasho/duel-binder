import type { Worker } from 'node:worker_threads'
import { rollupJobKey, type RollupJob } from './repo/rollupJobs'

/** Builds catalog rollups on a worker thread (src/main/rollupWorker.ts), one at a time. */
export interface RollupRunner {
  /** The job's rollup, stored by the worker; rejects when the worker fails. A job already running is shared. */
  build(job: RollupJob): Promise<unknown>
  dispose(): void
}

type Reply = { id: number; value?: unknown; error?: string }

/**
 * `start` makes the worker (it is started on the first job and again after it dies). Jobs with
 * the same rollup key share one build.
 */
export function createRollupRunner(start: () => Worker): RollupRunner {
  let worker: Worker | null = null
  let nextId = 1
  const waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()
  const running = new Map<string, Promise<unknown>>()

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
      else p.resolve(r.value)
    })
    const dead = (e: Error): void => {
      if (worker === w) worker = null
      failAll(e)
    }
    w.on('error', dead)
    w.on('exit', (code) => dead(new Error(`Rollup worker exited (${code})`)))
    // Never keeps the app from quitting.
    w.unref()
    worker = w
    return w
  }

  return {
    build(job) {
      const key = rollupJobKey(job)
      const already = running.get(key)
      if (already) return already
      const p = new Promise<unknown>((resolve, reject) => {
        const id = nextId++
        waiting.set(id, { resolve, reject })
        try {
          ensure().postMessage({ id, job })
        } catch (e) {
          waiting.delete(id)
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      }).finally(() => running.delete(key))
      running.set(key, p)
      return p
    },
    dispose() {
      const w = worker
      worker = null
      failAll(new Error('Rollup worker stopped'))
      void w?.terminate()
    }
  }
}
