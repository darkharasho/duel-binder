/**
 * Decides whether the nightly catalog run starts now; run by .github/workflows/catalog-schedule.yml.
 *
 * GitHub starts scheduled workflows late, and for this repo very late: every scheduled catalog run
 * from 2026-10-26 to 2026-11-12 started 6 to 10 hours after its 06:17 UTC cron, so the upload
 * landed in the US morning. The schedule workflow therefore fires several times a night and this
 * gate lets the first trigger that lands in the quiet window dispatch the catalog, once a day.
 *
 * Plain Node (run with --experimental-strip-types, no npm install): no packages.
 */

import { appendFileSync } from 'node:fs'

/** Quiet hours (UTC) a run may start in: midnight to 5 am Pacific, 3 to 8 am Eastern. */
export const WINDOW_START_HOUR = 8
export const WINDOW_END_HOUR = 13
/** With no run for this long the catalog is going stale, so a trigger outside the window runs too. */
export const STALE_HOURS = 48

const HOUR_MS = 60 * 60 * 1000

export interface Decision {
  run: boolean
  reason: string
}

/** `runStarts` are the start (or creation) times of recent catalog runs, any trigger. */
export function decide(now: Date, runStarts: Date[]): Decision {
  const last = runStarts.reduce<Date | null>((a, b) => (a && a > b ? a : b), null)
  const hours = last ? (now.getTime() - last.getTime()) / HOUR_MS : Infinity
  if (hours >= STALE_HOURS) {
    return { run: true, reason: last ? `no catalog run for ${Math.floor(hours)} h` : 'no recent catalog run' }
  }
  const hour = now.getUTCHours()
  if (hour < WINDOW_START_HOUR || hour >= WINDOW_END_HOUR) {
    return { run: false, reason: `${hour}:00 UTC is outside the quiet window` }
  }
  if (last && last.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) {
    return { run: false, reason: `the catalog already ran today (${last.toISOString()})` }
  }
  return { run: true, reason: 'first trigger in the quiet window today' }
}

interface WorkflowRun {
  created_at: string
  run_started_at?: string | null
}

async function main(): Promise<void> {
  const repo = process.env['GITHUB_REPOSITORY']
  const token = process.env['GITHUB_TOKEN']
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN must be set')
  const now = new Date()
  const since = new Date(now.getTime() - (STALE_HOURS + 24) * HOUR_MS).toISOString()
  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/catalog.yml/runs?per_page=50&created=>=${since}`,
    { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } }
  )
  if (!res.ok) throw new Error(`Listing catalog runs failed: HTTP ${res.status}`)
  const { workflow_runs: runs } = (await res.json()) as { workflow_runs: WorkflowRun[] }
  const decision = decide(
    now,
    runs.map((r) => new Date(r.run_started_at ?? r.created_at))
  )
  console.log(`${decision.run ? 'Run' : 'Skip'}: ${decision.reason}`)
  const out = process.env['GITHUB_OUTPUT']
  if (out) appendFileSync(out, `run=${decision.run}\n`)
}

if (process.argv[1]?.endsWith('scheduleGate.mts')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
