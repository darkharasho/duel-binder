import { MAX_USAGE_COUNT, type UsageCounts, type UsageEvent } from '@shared/usage'

/** Set to '1' when the user turns usage counts off in Settings. */
const OFF_KEY = 'duel-binder-usage-off'
/** Counts wait this long before going out, so a session sends a handful of reports, not one per click. */
export const USAGE_FLUSH_MS = 5 * 60 * 1000

let pending: UsageCounts = {}
let timer: ReturnType<typeof setTimeout> | null = null
let opened = false

export function usageEnabled(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) !== '1'
  } catch {
    return true
  }
}

export function setUsageEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(OFF_KEY)
    else localStorage.setItem(OFF_KEY, '1')
  } catch {
    // No storage: the choice lasts until the app closes.
  }
  if (!on) {
    pending = {}
    if (timer) clearTimeout(timer)
    timer = null
  }
}

/** Counts one event toward the next anonymous report; nothing about the user or card goes with it. */
export function track(event: UsageEvent): void {
  if (!usageEnabled()) return
  pending[event] = Math.min(MAX_USAGE_COUNT, (pending[event] ?? 0) + 1)
  timer ??= setTimeout(flushUsage, USAGE_FLUSH_MS)
}

/** Counts the app opening, once per page load. */
export function trackOpen(): void {
  if (opened) return
  opened = true
  track('open')
}

/** Sends what's counted so far. */
export function flushUsage(): void {
  if (timer) clearTimeout(timer)
  timer = null
  const events = pending
  pending = {}
  // On its own: a portal from before this event refuses a whole report with it in.
  const { 'page:wishlist': wishlist, ...rest } = events
  for (const batch of [rest, wishlist ? { 'page:wishlist': wishlist } : {}]) {
    if (Object.keys(batch).length === 0) continue
    try {
      void window.api?.usage?.report(batch).catch(() => {})
    } catch {
      // No bridge (a test torn down, say): drop the batch.
    }
  }
}

/** Tests: forget anything counted and the open. */
export function resetUsage(): void {
  pending = {}
  if (timer) clearTimeout(timer)
  timer = null
  opened = false
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushUsage()
  })
  window.addEventListener('pagehide', flushUsage)
}
