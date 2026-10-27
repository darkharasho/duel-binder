import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { api, queryKeys } from '@/lib/api'
import { rarityColor } from '@/lib/rarityColors'
import { baseOf } from '../../../../shared/rip/rarity'
import type { RipSessionSummary } from '../../../../shared/rip/types'
import { HoloCard } from './HoloCard'
import { SessionSummary } from './SessionSummary'

const PAGE = 50

const formatSessionDate = (iso: string): string => {
  const t = Date.parse(iso)
  return Number.isNaN(t)
    ? iso
    : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
        t
      )
}

function Stat({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function SessionDetail({ id, onBack }: { id: number; onBack: () => void }): React.JSX.Element {
  const q = useQuery({ queryKey: queryKeys.ripSession(id), queryFn: () => api.rip.session(id) })
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back to history
        </Button>
      </div>
      {q.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.isError && <p className="text-sm text-destructive">Couldn&apos;t load this session.</p>}
      {q.isSuccess &&
        (q.data ? (
          <SessionSummary session={q.data} />
        ) : (
          <p className="text-sm text-muted-foreground">This session is gone.</p>
        ))}
    </div>
  )
}

function SessionRow({
  s,
  onOpen
}: {
  s: RipSessionSummary
  onOpen: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/50"
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{s.setName}</span>
        <span className="text-xs text-muted-foreground">
          {s.packsOpened} {s.packsOpened === 1 ? 'pack' : 'packs'} ·{' '}
          {formatSessionDate(s.startedAt)}
        </span>
      </span>
      {s.best && (
        <span className="flex min-w-0 items-center gap-2 text-xs">
          <span
            aria-hidden
            style={{ backgroundColor: rarityColor(baseOf(s.best.rarity)) }}
            className="size-2 shrink-0 rounded-full"
          />
          <span className="truncate">{s.best.name}</span>
        </span>
      )}
    </button>
  )
}

/** All-time totals, the best pulls ever, and past sessions (click one for its summary). */
export function HistoryTab(): React.JSX.Element {
  const [openId, setOpenId] = useState<number | null>(null)
  const q = useInfiniteQuery({
    queryKey: queryKeys.ripHistory,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.rip.history({ sessionOffset: pageParam }),
    getNextPageParam: (last, pages) =>
      last.sessions.length < PAGE ? undefined : pages.reduce((n, p) => n + p.sessions.length, 0)
  })

  if (openId !== null) return <SessionDetail id={openId} onBack={() => setOpenId(null)} />
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (q.isError) return <p className="text-sm text-destructive">Couldn&apos;t load your history.</p>

  const first = q.data.pages[0]
  // Offset paging can repeat a session when a new one lands between pages.
  const sessions = [
    ...new Map(q.data.pages.flatMap((p) => p.sessions).map((s) => [s.id, s])).values()
  ]
  if (first.packsOpened === 0 && sessions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing ripped yet. Open some packs and they&apos;ll show up here.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
        <Stat label="Packs opened" value={first.packsOpened} />
        <Stat label="Cards pulled" value={first.cardsPulled} />
        <Stat label="Sets ripped" value={first.setsRipped} />
      </div>

      {first.bestPulls.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Best pulls ever</h2>
          <div className="flex flex-wrap gap-3">
            {first.bestPulls.map((c, i) => (
              <div key={`${c.pkey}-${i}`} className="w-28">
                <HoloCard card={c} size="small" />
                <p className="mt-1 truncate text-xs">{c.name}</p>
                <p className="truncate text-xs text-muted-foreground">{c.rarity}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Sessions</h2>
        {sessions.map((s) => (
          <SessionRow key={s.id} s={s} onOpen={() => setOpenId(s.id)} />
        ))}
        {q.hasNextPage && (
          <div>
            <Button
              variant="outline"
              disabled={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
            >
              Show more
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
