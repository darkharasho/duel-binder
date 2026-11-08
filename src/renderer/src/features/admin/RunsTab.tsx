import type { GhJob, GhRun } from '@shared/admin'
import { cn } from '@/lib/utils'
import { shortWhen } from './adminTabs'
import { Grid, Meter, Note, Panel } from './parts'
import {
  isLive,
  minutes,
  realSteps,
  stateOf,
  stepDone,
  stepSeconds,
  stepState,
  started,
  took,
  trigger,
  type RunsView,
  type Tone,
  type WorkflowView
} from './runs'

const TEXT: Record<Tone, string> = {
  good: 'text-emerald-400',
  bad: 'text-destructive',
  live: 'text-primary',
  '': 'text-muted-foreground'
}
const FILL: Record<Tone, string> = {
  good: 'bg-emerald-400/80',
  bad: 'bg-destructive',
  live: 'bg-primary',
  '': 'bg-white/20'
}

export function Dot({ tone }: { tone: Tone }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-[7px] shrink-0 rounded-full',
        tone === '' ? 'bg-muted-foreground' : FILL[tone],
        tone === 'live' && 'shadow-[0_0_0_3px] shadow-primary/15'
      )}
    />
  )
}

function RunLink({ run, label }: { run: GhRun; label: string }): React.JSX.Element {
  return (
    <a href={run.html_url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
      {label}
    </a>
  )
}

function Timeline({
  jobs,
  past,
  now
}: {
  jobs: GhJob[]
  past: WorkflowView['past']
  now: number
}): React.JSX.Element {
  return (
    <div aria-hidden className="my-2.5 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
      {realSteps(jobs)
        .filter((s) => s.conclusion !== 'skipped')
        .map((s, i) => {
          const tone: Tone =
            s.status === 'in_progress'
              ? 'live'
              : stepState(s, now)[1] || (stepDone(s) ? 'good' : '')
          return (
            <div
              key={i}
              title={s.name}
              className={cn('min-w-[3px]', FILL[tone])}
              style={{ flexGrow: stepSeconds(s, now) ?? past?.get(s.name) ?? 60 }}
            />
          )
        })}
    </div>
  )
}

function Steps({ jobs, now }: { jobs: GhJob[]; now: number }): React.JSX.Element {
  return (
    <ul className="text-[13px]">
      {realSteps(jobs).map((s, i) => {
        const [said, tone] = stepState(s, now)
        return (
          <li
            key={i}
            className={cn(
              'flex justify-between gap-3 border-t border-white/[0.06] py-1 first:border-t-0',
              tone ? TEXT[tone] : stepDone(s) ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            <span>{s.name}</span>
            <span className="font-mono text-xs">{said}</span>
          </li>
        )
      })}
    </ul>
  )
}

function RunRow({
  w,
  run,
  jobs,
  now
}: {
  w: WorkflowView
  run: GhRun
  jobs: GhJob[] | null
  now: number
}): React.JSX.Element {
  const [label, tone] = stateOf(run)
  const elapsed = now - started(run)
  const steps = (jobs ?? []).flatMap((j) => j.steps ?? [])
  const finished = steps.filter((s) => s.status === 'completed').length
  const current = steps.find((s) => s.status === 'in_progress')
  const left = w.usual && elapsed < w.usual ? `, about ${minutes(w.usual - elapsed)} left` : ''
  const step = current ? `${current.name} (step ${finished + 1} of ${steps.length}) · ` : ''
  const running = run.status === 'in_progress'
  // Time, not steps: most of a run is one step. Held under 100 so an overrun doesn't read as done.
  const part = w.usual
    ? Math.min(0.97, elapsed / w.usual)
    : steps.length
      ? finished / steps.length
      : 0
  return (
    <div className="border-t border-white/[0.06] py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[13px]">
        <RunLink run={run} label={w.name} />
        <span className={cn('text-xs font-semibold', TEXT[tone])}>{label}</span>
        <span className="text-xs text-muted-foreground">
          {trigger(run)} · {shortWhen(run.run_started_at)}
          {isLive(run) ? '' : ` · ${minutes(took(run))}`}
        </span>
      </div>
      {w.listed && jobs ? (
        <>
          <Timeline jobs={jobs} past={w.past} now={now} />
          {running && <Note>{`${step}${minutes(elapsed)} so far${left}`}</Note>}
          <Steps jobs={jobs} now={now} />
        </>
      ) : (
        running && (
          <>
            <Meter part={part} />
            <Note>{`${step}${minutes(elapsed)} so far${left}`}</Note>
          </>
        )
      )}
    </div>
  )
}

function RunCell({ run }: { run: RunsView['all'][number] }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-2">
      <Dot tone={stateOf(run)[1]} />
      <RunLink run={run} label={run.name} />
    </span>
  )
}

export function RunsTab({ view }: { view: RunsView }): React.JSX.Element {
  return (
    <div className="grid gap-4">
      <Panel title="Latest">
        {view.workflows.flatMap((w) =>
          w.shown.map(({ run, jobs }) => (
            <RunRow key={run.id} w={w} run={run} jobs={jobs} now={view.at} />
          ))
        )}
        <div className="mt-2">
          <Note>
            {view.live ? 'Updates every 2 minutes while something runs.' : 'Nothing running.'}
          </Note>
        </div>
      </Panel>
      <Panel title="History">
        {view.all.length === 0 ? (
          <Note>No runs yet.</Note>
        ) : (
          <Grid
            heads={['Run', 'Result', 'Trigger', 'Started', 'Took']}
            rows={view.all.map((r) => ({
              key: r.id,
              cells: [
                <RunCell key="c" run={r} />,
                stateOf(r)[0],
                trigger(r),
                shortWhen(r.run_started_at),
                isLive(r) ? '–' : minutes(took(r))
              ]
            }))}
          />
        )}
      </Panel>
    </div>
  )
}

/** The Overview's three newest runs. */
export function LatestRuns({ view }: { view: RunsView | undefined }): React.JSX.Element | null {
  if (!view) return null
  return (
    <Panel title="Latest runs">
      {view.all.length === 0 ? (
        <Note>No runs yet.</Note>
      ) : (
        <Grid
          heads={['', '']}
          rows={view.all.slice(0, 3).map((r) => ({
            key: r.id,
            cells: [<RunCell key="c" run={r} />, isLive(r) ? stateOf(r)[0] : minutes(took(r))]
          }))}
        />
      )}
    </Panel>
  )
}

/** The header's line on every tab: what's running, or how the last catalog went. */
export function Pulse({ view }: { view: RunsView | undefined }): React.JSX.Element | null {
  const r = view?.all.find(isLive) ?? view?.all.find((x) => x.name === 'Catalog')
  if (!r) return null
  const [label, tone] = stateOf(r)
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Dot tone={tone} />
      {r.name} {label.toLowerCase()}
      {isLive(r) ? ` · ${minutes(view!.at - started(r))}` : ''}
    </span>
  )
}
