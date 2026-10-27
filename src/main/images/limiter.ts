export interface Limiter {
  /**
   * Queues `fn`. A priority job goes ahead of everything waiting; a `key` lets it be promoted
   * later.
   */
  <T>(fn: () => Promise<T>, opts?: { priority?: boolean; key?: string }): Promise<T>
  /** Moves the queued job with this key to the front. False if it isn't waiting (or never was). */
  promote(key: string): boolean
}

interface Job {
  run: () => Promise<unknown>
  key?: string
}

/** Runs at most `concurrency` tasks at once, starting them at least `minIntervalMs` apart. */
export function createLimiter(opts: { concurrency: number; minIntervalMs: number }): Limiter {
  const queue: Job[] = []
  let active = 0
  let lastStart = -Infinity
  let timer: ReturnType<typeof setTimeout> | null = null

  const pump = (): void => {
    if (timer) return
    while (active < opts.concurrency && queue.length > 0) {
      const wait = lastStart + opts.minIntervalMs - Date.now()
      if (wait > 0) {
        timer = setTimeout(() => {
          timer = null
          pump()
        }, wait)
        return
      }
      const job = queue.shift()!
      active++
      lastStart = Date.now()
      void job.run().finally(() => {
        active--
        pump()
      })
    }
  }

  const limit = (<T>(
    fn: () => Promise<T>,
    { priority = false, key }: { priority?: boolean; key?: string } = {}
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const job: Job = { run: () => Promise.resolve().then(fn).then(resolve, reject), key }
      if (priority) queue.unshift(job)
      else queue.push(job)
      pump()
    })) as Limiter
  limit.promote = (key) => {
    const i = queue.findIndex((j) => j.key === key)
    if (i < 0) return false
    queue.unshift(...queue.splice(i, 1))
    return true
  }
  return limit
}
