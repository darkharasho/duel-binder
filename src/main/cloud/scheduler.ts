export interface SyncScheduler {
  /** Starts scheduling and runs once right away. */
  start(): void
  /** Clears every timer; a run in flight finishes but nothing follows it. */
  stop(): void
  /**
   * With no delay, asks for a run `debounceMs` after the last such poke (a debounce). With a delay, asks for
   * a run then; of several delayed pokes the earliest deadline wins, and a run starting meanwhile keeps it.
   */
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
  /** Called when a requested run is skipped because the network is down. */
  onSkippedOffline?: () => void
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
  /** The debounced edit poke. */
  let pokeTimer: ReturnType<typeof setTimeout> | null = null
  /** The earliest delayed poke, and when it is due. */
  let laterTimer: ReturnType<typeof setTimeout> | null = null
  let laterAt = Infinity
  let pollTimer: ReturnType<typeof setInterval> | null = null
  /** runNow callers waiting for the next run to start and finish. */
  let waiting: (() => void)[] = []
  /** runNow callers waiting for the run in flight. */
  let inRun: (() => void)[] = []

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
      opts.onSkippedOffline?.()
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
    // An edit poked before this run started is in it; a delayed poke still runs at its own time.
    pokeTimer = clear(pokeTimer)
    inRun = waiting
    waiting = []
    let ok = true
    try {
      await opts.run()
    } catch {
      ok = false
    }
    running = false
    release(inRun.splice(0))
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
      laterTimer = clear(laterTimer)
      laterAt = Infinity
      if (pollTimer !== null) clearInterval(pollTimer)
      pollTimer = null
      // Nobody waits on a stopped scheduler, not even for the run in flight.
      release(waiting.splice(0))
      release(inRun.splice(0))
    },
    poke(delayMs?: number) {
      if (!started) return
      if (delayMs === undefined) {
        pokeTimer = clear(pokeTimer)
        pokeTimer = setTimeout(
          () => {
            pokeTimer = null
            trigger()
          },
          Math.max(debounceMs, notBefore - Date.now())
        )
        return
      }
      const at = Date.now() + Math.max(delayMs, notBefore - Date.now())
      if (at >= laterAt) return
      laterTimer = clear(laterTimer)
      laterAt = at
      laterTimer = setTimeout(() => {
        laterTimer = null
        laterAt = Infinity
        trigger()
      }, at - Date.now())
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
