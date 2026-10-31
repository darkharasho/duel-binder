/**
 * Anonymous usage counts: the app tallies a fixed set of events and sends only the totals, which
 * the portal adds to per-day counters with no account, device or IP attached.
 */

export const USAGE_PLATFORMS = ['desktop', 'web', 'phone', 'ios'] as const
export type UsagePlatform = (typeof USAGE_PLATFORMS)[number]

export const USAGE_EVENTS = [
  'open',
  'page:dashboard',
  'page:collection',
  'page:wishlist',
  'page:sets',
  'page:browse',
  'page:scan',
  'page:rip',
  'page:friends',
  'page:settings',
  'card:add',
  'scan:add',
  'rip:pack',
  'friend:request'
] as const
export type UsageEvent = (typeof USAGE_EVENTS)[number]

/** Event totals since the last report. */
export type UsageCounts = Partial<Record<UsageEvent, number>>

/** The most one report may count for a single event. */
export const MAX_USAGE_COUNT = 1000

/** The body of `POST /api/usage`. */
export interface UsageReport {
  platform: UsagePlatform
  events: UsageCounts
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The report, checked; throws on anything outside the fixed platforms, events and counts. */
export function checkUsageReport(v: unknown): UsageReport {
  if (!isObject(v) || !isObject(v.events)) throw new Error('bad-report')
  const platform = v.platform
  if (!USAGE_PLATFORMS.includes(platform as UsagePlatform)) throw new Error('bad-platform')
  const events: UsageCounts = {}
  for (const [name, count] of Object.entries(v.events)) {
    if (!USAGE_EVENTS.includes(name as UsageEvent)) throw new Error('bad-event')
    if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > MAX_USAGE_COUNT)
      throw new Error('bad-count')
    events[name as UsageEvent] = count as number
  }
  return { platform: platform as UsagePlatform, events }
}
