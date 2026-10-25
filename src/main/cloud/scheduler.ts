export interface SyncScheduler {
  /** Starts scheduling and runs once right away. */
  start(): void
  /** Clears every timer; a run in flight finishes but nothing follows it. */
  stop(): void
  /** Asks for a run `delayMs` from now (default: the debounce); a later poke replaces an earlier one. */
  poke(delayMs?: number): void
  /** Runs as soon as possible (after the run in flight, if any); resolves when that run ends. Never rejects. */
  runNow(): Promise<void>
}

/**
 * When background sync runs: once at start, `debounceMs` after the last edit, every `periodMs`, and when
 * the network comes back. One run at a time; asking during a run queues exactly one more. A failed run
 * (`run` rejects) retries on the `backoffMs` ladder, and no poke runs sooner; a success resets it.
 */
export function createSyncScheduler(opts: {
  run: () => Promise<void>
  isOnline: () => boolean
  debounceMs?: number
  periodMs?: number
  onlinePollMs?: number
  backoffMs?: number[]
}): SyncScheduler {
  const debounceMs = opts.debounceMs ?? 5_000
  const periodMs = opts.periodMs ?? 300_000
  const onlinePollMs = opts.onlinePollMs ?? 30_000
  const backoffMs = opts.backoffMs ?? [30_000, 60_000, 120_000, 300_000, 900_000]

  let started = false
  let running = false
  let queued = false
  let failures = 0
  /** No automatic run before this time (ms since epoch) while backing off. */
  let notBefore = 0
  let wasOnline = true
  let nextTimer: ReturnType<typeof setTimeout> | null = null
  let pokeTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  /** runNow callers waiting for the next run to start and finish. */
  let waiting: (() => void)[] = []

  const clear = (t: ReturnType<typeof setTimeout> | null): null => {
    if (t !== null) clearTimeout(t)
    return null
  }

  const release = (list: (() => void)[]): void => {
    for (const resolve of list) resolve()
  }

  /** Runs now unless stopped or offline; during a run, queues one more. */
  function trigger(): void {
    if (!started) return release(waiting.splice(0))
    if (!opts.isOnline()) {
      wasOnline = false
      return release(waiting.splice(0))
    }
    if (running) {
      queued = true
      return
    }
    void execute()
  }

  async function execute(): Promise<void> {
    running = true
    nextTimer = clear(nextTimer)
    pokeTimer = clear(pokeTimer)
    const mine = waiting
    waiting = []
    let ok = true
    try {
      await opts.run()
    } catch {
      ok = false
    }
    running = false
    release(mine)
    if (!started) return release(waiting.splice(0))

    if (ok) {
      failures = 0
      notBefore = 0
    } else {
      failures++
      notBefore = Date.now() + backoffMs[Math.min(failures, backoffMs.length) - 1]
    }
    if (queued) {
      queued = false
      // A queued request waits out a backoff like any other, unless a runNow caller is waiting.
      if (ok || waiting.length > 0) return trigger()
    }
    schedule(ok ? periodMs : notBefore - Date.now())
  }

  function schedule(delayMs: number): void {
    nextTimer = clear(nextTimer)
    nextTimer = setTimeout(
      () => {
        nextTimer = null
        trigger()
      },
      Math.max(0, delayMs)
    )
  }

  return {
    start() {
      if (started) return
      started = true
      failures = 0
      notBefore = 0
      wasOnline = opts.isOnline()
      pollTimer = setInterval(() => {
        const online = opts.isOnline()
        if (online && !wasOnline) trigger()
        wasOnline = online
      }, onlinePollMs)
      trigger()
      // Offline at start: the period still applies, and the poll runs it when the network is back.
      if (!running && nextTimer === null) schedule(periodMs)
    },
    stop() {
      started = false
      queued = false
      nextTimer = clear(nextTimer)
      pokeTimer = clear(pokeTimer)
      if (pollTimer !== null) clearInterval(pollTimer)
      pollTimer = null
      release(waiting.splice(0))
    },
    poke(delayMs = debounceMs) {
      if (!started) return
      pokeTimer = clear(pokeTimer)
      const wait = Math.max(delayMs, notBefore - Date.now())
      pokeTimer = setTimeout(() => {
        pokeTimer = null
        trigger()
      }, wait)
    },
    runNow() {
      if (!started) return Promise.resolve()
      return new Promise<void>((resolve) => {
        waiting.push(resolve)
        trigger()
      })
    }
  }
}
