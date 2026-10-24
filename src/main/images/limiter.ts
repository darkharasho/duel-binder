export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>

/** Runs at most `concurrency` tasks at once, starting them at least `minIntervalMs` apart. */
export function createLimiter(opts: { concurrency: number; minIntervalMs: number }): Limiter {
  const queue: Array<() => Promise<unknown>> = []
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
      void job().finally(() => {
        active--
        pump()
      })
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => Promise.resolve().then(fn).then(resolve, reject))
      pump()
    })
}
