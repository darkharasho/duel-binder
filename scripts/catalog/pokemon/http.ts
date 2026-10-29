export const REPO_URL = 'https://github.com/darkharasho/duel-binder'
export const MAX_CONCURRENCY = 4
export const MAX_ATTEMPTS = 3

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>

/** Runs at most `max` tasks at once; the rest queue in order. */
export function createLimiter(max: number = MAX_CONCURRENCY): Limiter {
  let active = 0
  const queue: (() => void)[] = []
  const next = (): void => {
    if (active >= max) return
    const go = queue.shift()
    if (go) go()
  }
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        active++
        fn().then(resolve, reject).finally(() => { active--; next() })
      }
      queue.push(run)
      next()
    })
}

export interface GetJsonOpts {
  fetch: typeof fetch
  userAgent: string
  limiter: Limiter
  /** Base backoff; attempt n (0-based) waits base * 2^n. */
  retryDelayMs?: number
  log?: (l: string) => void
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * GET a URL as JSON. Network errors, 429 and 5xx are retried (3 attempts in all, with backoff);
 * any other failure, or the last retryable one, throws.
 */
export function getJson<T>(url: string, opts: GetJsonOpts): Promise<T> {
  const base = opts.retryDelayMs ?? 500
  return opts.limiter(async () => {
    let lastErr: Error | undefined
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(base * 2 ** (attempt - 1))
      let res: Response
      try {
        res = await opts.fetch(url, { headers: { 'User-Agent': opts.userAgent, Accept: 'application/json' } })
      } catch (e) {
        lastErr = new Error(`GET ${url} failed: ${(e as Error).message}`)
        opts.log?.(`retry ${attempt + 1}/${MAX_ATTEMPTS}: ${lastErr.message}`)
        continue
      }
      if (res.ok) return (await res.json()) as T
      lastErr = new Error(`GET ${url} returned ${res.status}`)
      if (res.status !== 429 && res.status < 500) throw lastErr
      opts.log?.(`retry ${attempt + 1}/${MAX_ATTEMPTS}: ${lastErr.message}`)
    }
    throw lastErr as Error
  })
}
