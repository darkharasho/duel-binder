/**
 * The Runs tab's reading of GitHub Actions runs: which runs to show, their state, step timings
 * and how long is left. Ported from the portal's /admin page so both read the same.
 */
import type { AdminWorkflow, GhJob, GhRun, GhStep } from '@shared/admin'
import type { Api } from '@shared/ipc'

/** The watched workflows; `listed` ones show their steps. Release is several jobs, so only its progress. */
export const WATCHED: readonly { name: string; file: AdminWorkflow; listed: boolean }[] = [
  { name: 'Catalog', file: 'catalog.yml', listed: true },
  { name: 'Release', file: 'release.yml', listed: false }
]
/** GitHub's own bookkeeping, which says nothing about the job. */
const PLUMBING = /^(Set up job|Complete job|Post |Run actions[/]|Check portal settings)/
export const POLL_MS = 120_000

export type Tone = 'good' | 'bad' | 'live' | ''

const STATES: Record<string, [string, Tone]> = {
  success: ['Passed', 'good'],
  failure: ['Failed', 'bad'],
  cancelled: ['Cancelled', 'bad'],
  timed_out: ['Timed out', 'bad']
}
const TRIGGERS: Record<string, string> = {
  schedule: 'nightly',
  workflow_dispatch: 'manual',
  push: 'tag'
}

export const trigger = (r: GhRun): string => TRIGGERS[r.event] ?? r.event
export const started = (r: GhRun): number => new Date(r.run_started_at).getTime()
export const took = (r: GhRun): number => new Date(r.updated_at).getTime() - started(r)
export const isLive = (r: GhRun): boolean => r.status !== 'completed'

export function minutes(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}
const seconds = (ms: number): string =>
  ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} s` : minutes(ms)

/** The usual length of this workflow's passed runs, or null with none to go on. */
export function typical(runs: GhRun[]): number | null {
  const done = runs
    .filter((r) => r.conclusion === 'success')
    .map(took)
    .sort((a, b) => a - b)
  return done.length ? done[Math.floor(done.length / 2)] : null
}

export function stateOf(r: GhRun): [string, Tone] {
  if (r.status === 'queued' || r.status === 'pending' || r.status === 'waiting')
    return ['Queued', 'live']
  if (isLive(r)) return ['Running', 'live']
  return STATES[r.conclusion ?? ''] ?? [r.conclusion ?? 'Finished', '']
}

/** What a step's row says on its right, and its tone. */
export function stepState(s: GhStep, now = Date.now()): [string, Tone] {
  if (s.status === 'in_progress')
    return [
      s.started_at ? `${seconds(now - new Date(s.started_at).getTime())} so far` : 'running',
      'live'
    ]
  if (s.status !== 'completed') return ['waiting', '']
  if (s.conclusion === 'skipped') return ['skipped', '']
  const time =
    s.started_at && s.completed_at
      ? seconds(new Date(s.completed_at).getTime() - new Date(s.started_at).getTime())
      : 'done'
  return s.conclusion === 'success'
    ? [time, '']
    : [`${STATES[s.conclusion ?? '']?.[0] ?? s.conclusion} · ${time}`, 'bad']
}

export const realSteps = (jobs: GhJob[]): GhStep[] =>
  jobs.flatMap((j) => j.steps ?? []).filter((s) => !PLUMBING.test(s.name))
export const stepDone = (s: GhStep): boolean =>
  s.status === 'completed' && s.conclusion !== 'skipped'

/** A step's seconds so far, or null before it starts. */
export function stepSeconds(s: GhStep, now = Date.now()): number | null {
  if (!s.started_at) return null
  const end = s.completed_at ? new Date(s.completed_at).getTime() : now
  return Math.max(1, (end - new Date(s.started_at).getTime()) / 1000)
}

export interface ShownRun {
  run: GhRun
  jobs: GhJob[] | null
}

export interface WorkflowView {
  name: string
  listed: boolean
  usual: number | null
  shown: ShownRun[]
  /** Each step's seconds in the last finished run, for steps yet to run. */
  past: Map<string, number | null> | null
}

export interface RunsView {
  workflows: WorkflowView[]
  /** Every listed run with its workflow's name, newest first. */
  all: (GhRun & { name: string })[]
  live: boolean
  /** When this was read: times "so far" count to it. */
  at: number
}

/** Reads the watched workflows: their running runs and last finished one, with jobs where shown. */
export async function loadRuns(admin: NonNullable<Api['admin']>): Promise<RunsView> {
  const lists = await Promise.all(WATCHED.map((w) => admin.runs(w.file, 6)))
  const workflows: WorkflowView[] = []
  const all: RunsView['all'] = []
  let live = false
  for (const [i, w] of WATCHED.entries()) {
    const runs = lists[i]
    all.push(...runs.map((r) => ({ ...r, name: w.name })))
    const picked = runs.filter(isLive)
    const last = runs.find((r) => !isLive(r))
    if (last) picked.push(last)
    const shown: ShownRun[] = []
    for (const r of picked) {
      const wanted = r.status === 'in_progress' || (w.listed && !isLive(r))
      shown.push({ run: r, jobs: wanted ? await admin.jobs(r.id) : null })
      live ||= isLive(r)
    }
    const lastJobs = shown.find((s) => s.run === last)?.jobs
    const past = lastJobs ? new Map(realSteps(lastJobs).map((s) => [s.name, stepSeconds(s)])) : null
    workflows.push({ name: w.name, listed: w.listed, usual: typical(runs), shown, past })
  }
  all.sort((a, b) => started(b) - started(a))
  return { workflows, all, live, at: Date.now() }
}
