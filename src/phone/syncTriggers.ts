/** A sync runs this long after the last local edit, so a run of adds goes up together. */
export const EDIT_DELAY_MS = 2_000
/** While the app is on screen, it syncs this often. */
export const PERIOD_MS = 5 * 60_000

/**
 * When the phone syncs: shortly after the last local edit, on coming back online, on becoming
 * visible, and every PERIOD_MS while visible. One sync runs at a time; any trigger during a sync
 * schedules exactly one more run after it. Edits and the timer don't sync while offline (the
 * online event catches up).
 */
export function createSyncTriggers(deps: {
  sync(): Promise<unknown>
  online(): boolean
  on(event: 'online' | 'visible', cb: () => void): () => void
  setTimer: typeof setTimeout
  clearTimer: typeof clearTimeout
  /** Whether the page is on screen; the periodic sync skips while it isn't. Defaults to true. */
  visible?(): boolean
}): { afterAdd(): void; dispose(): void } {
  const visible = deps.visible ?? ((): boolean => true)
  let running = false
  let again = false
  let disposed = false
  let editTimer: ReturnType<typeof setTimeout> | undefined
  let periodTimer: ReturnType<typeof setTimeout> | undefined

  const run = (): void => {
    if (disposed) return
    if (running) {
      again = true
      return
    }
    running = true
    void deps
      .sync()
      .catch(() => {
        // The sync reports its own failures; the next trigger tries again.
      })
      .finally(() => {
        running = false
        if (again) {
          again = false
          run()
        }
      })
  }

  const whenOnline = (): void => {
    if (deps.online()) run()
  }

  const schedulePeriod = (): void => {
    periodTimer = deps.setTimer(() => {
      if (visible()) whenOnline()
      if (!disposed) schedulePeriod()
    }, PERIOD_MS)
  }
  schedulePeriod()

  const unsubscribe = [deps.on('online', run), deps.on('visible', whenOnline)]

  return {
    afterAdd() {
      if (disposed) return
      if (editTimer !== undefined) deps.clearTimer(editTimer)
      editTimer = deps.setTimer(() => {
        editTimer = undefined
        whenOnline()
      }, EDIT_DELAY_MS)
    },
    dispose() {
      disposed = true
      if (editTimer !== undefined) deps.clearTimer(editTimer)
      if (periodTimer !== undefined) deps.clearTimer(periodTimer)
      for (const off of unsubscribe) off()
    }
  }
}
