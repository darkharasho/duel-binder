import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { UnderlineTabs } from '@/components/UnderlineTabs'
import { cn } from '@/lib/utils'
import { api, queryKeys } from '@/lib/api'
import type { RipSet } from '../../../../shared/rip/types'
import { HistoryTab } from './HistoryTab'
import { PackOpener } from './PackOpener'
import { SessionSummary } from './SessionSummary'
import { SetPicker } from './SetPicker'

type Tab = 'open' | 'history'
const TABS = [
  { value: 'open', label: 'Open packs' },
  { value: 'history', label: 'History' }
] as const

/** Picking a set, opening its packs, and the summary after the last one. */
type View =
  | { kind: 'picker' }
  | { kind: 'opening'; sessionId: number; set: RipSet; packCount: number }
  | { kind: 'summary'; sessionId: number; set: RipSet; packCount: number }

function SummaryView({
  sessionId,
  onRipMore,
  onPickSet,
  starting,
  error
}: {
  sessionId: number
  onRipMore: () => void
  onPickSet: () => void
  starting: boolean
  error: string | null
}): React.JSX.Element {
  const q = useQuery({
    queryKey: queryKeys.ripSession(sessionId),
    queryFn: () => api.rip.session(sessionId)
  })
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!q.data) {
    return (
      <div className="flex flex-col items-start gap-3 text-sm">
        <p className="text-muted-foreground">Couldn&apos;t load this session.</p>
        <Button variant="outline" onClick={onPickSet}>
          Pick another set
        </Button>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <SessionSummary
        session={q.data}
        onRipMore={onRipMore}
        onPickSet={onPickSet}
        starting={starting}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export function RipPage(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('open')
  const [view, setView] = useState<View>({ kind: 'picker' })
  const [lastSetName, setLastSetName] = useState<string | null>(null)

  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const start = async (set: RipSet, packCount: number): Promise<void> => {
    const sessionId = await api.rip.start(set.setName, packCount)
    setLastSetName(set.setName)
    setView({ kind: 'opening', sessionId, set, packCount })
  }

  const ripMore = async (set: RipSet, packCount: number): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    setStarting(true)
    setStartError(null)
    try {
      await start(set, packCount)
    } catch (e) {
      setStartError(e instanceof Error && e.message ? e.message : 'Could not start the session.')
    } finally {
      inFlight.current = false
      setStarting(false)
    }
  }

  // Opening, its summary and History fill the window below the header, so a summary is never
  // below the fold.
  const filling =
    tab === 'history' || (tab === 'open' && (view.kind === 'opening' || view.kind === 'summary'))

  return (
    <div
      className={cn(
        'space-y-5 p-8 max-md:p-4',
        filling && 'flex min-h-full flex-col space-y-0 gap-5 pb-4'
      )}
    >
      <PageHeader>
        <h1 className="text-2xl font-semibold tracking-tight">Rip</h1>
        <UnderlineTabs
          label="Rip view"
          value={tab}
          options={TABS}
          onChange={setTab}
          className="border-b border-white/[0.08]"
        />
      </PageHeader>
      {tab === 'history' && <HistoryTab />}
      {/* Kept mounted (hidden) on the History tab, so an opening in progress keeps its place. */}
      <div hidden={tab !== 'open'} className={cn(filling && 'flex min-h-0 flex-1 flex-col')}>
        {view.kind === 'opening' ? (
          <PackOpener
            key={view.sessionId}
            sessionId={view.sessionId}
            packCount={view.packCount}
            setName={view.set.setName}
            packArt={view.set}
            active={tab === 'open'}
            onDone={() =>
              setView({
                kind: 'summary',
                sessionId: view.sessionId,
                set: view.set,
                packCount: view.packCount
              })
            }
          />
        ) : view.kind === 'summary' ? (
          <SummaryView
            sessionId={view.sessionId}
            starting={starting}
            error={startError}
            onRipMore={() => void ripMore(view.set, view.packCount)}
            onPickSet={() => {
              setStartError(null)
              setView({ kind: 'picker' })
            }}
          />
        ) : (
          <SetPicker onRip={start} initialSetName={lastSetName} />
        )}
      </div>
    </div>
  )
}
