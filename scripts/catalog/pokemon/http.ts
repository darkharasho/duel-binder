export const REPO_URL = 'https://github.com/darkharasho/duel-binder'
export const MAX_CONCURRENCY = 4
/**
 * Five attempts, waiting 2, 4, 8 and 16 s between them: TCGdex answers 503 for a few seconds at a
 * time under load, and one request that gives up abandons the whole night's Pokémon refresh.
 */
export const MAX_ATTEMPTS = 5
export const DEFAULT_RETRY_DELAY_MS = 2000

/** The wait before attempt `attempt` (1-based retries): base * 2^(attempt - 1). */
export const retryDelay = (base: number, attempt: number): number => base * 2 ** (attempt - 1)

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
  /** Once aborted, a request still waiting for its slot or a retry throws without fetching. */
  signal?: AbortSignal
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * GET a URL as JSON. Network errors, 429 and 5xx are retried (MAX_ATTEMPTS in all, with backoff);
 * any other failure, or the last retryable one, throws. With an aborted `signal` it throws without
 * fetching.
 */
export function getJson<T>(url: string, opts: GetJsonOpts): Promise<T> {
  const base = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  return opts.limiter(async () => {
    let lastErr: Error | undefined
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(retryDelay(base, attempt))
      if (opts.signal?.aborted) throw new Error(`GET ${url} not sent: an earlier request failed`)
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
