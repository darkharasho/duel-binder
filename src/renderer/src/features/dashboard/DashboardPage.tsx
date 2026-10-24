import { useQuery } from '@tanstack/react-query'
import type { CollectionStats } from '@shared/types'
import type { NavigateFn } from '@/components/AppShell'
import { CardArt } from '@/components/CardArt'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StaleBadge, ValueText } from '@/features/collection/EntryValue'
import { api, queryKeys } from '@/lib/api'
import { formatRelative, formatUsd } from '@/lib/format'

interface Props {
  onNavigate: NavigateFn
  onAddCard?: () => void
}

function Tile({ label, children, note }: { label: string; children: React.ReactNode; note?: string }): React.JSX.Element {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{children}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground tabular-nums">{note}</p>}
    </div>
  )
}

interface BarRow {
  label: string
  amount: number
  text: string
}

/** Horizontal CSS bars: violet fill on a zinc track, direct labels, sorted descending. */
function BarList({ title, rows }: { title: string; rows: BarRow[] }): React.JSX.Element {
  const sorted = [...rows].sort((a, b) => b.amount - a.amount)
  const max = Math.max(...sorted.map((r) => r.amount), 0)
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-sm font-medium">{title}</h2>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data yet</p>
      ) : (
        <ul aria-label={title} className="space-y-2">
          {sorted.map((r) => (
            <li key={r.label} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate">{r.label}</span>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${max > 0 ? Math.max((r.amount / max) * 100, 2) : 0}%` }}
                />
              </div>
              <span className="min-w-20 text-right tabular-nums text-muted-foreground">{r.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const titleCase = (s: string): string =>
  s
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')

const STALE_MS = 24 * 60 * 60 * 1000
const isStale = (iso: string | null): boolean => {
  if (iso === null) return true
  const t = new Date(iso).getTime()
  return Number.isNaN(t) || Date.now() - t > STALE_MS
}

function Content({ stats, onNavigate }: { stats: CollectionStats; onNavigate: NavigateFn }): React.JSX.Element {
  const n = stats.approximateCount
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Total cards">{stats.totalCards}</Tile>
        <Tile label="Unique cards">{stats.uniqueCards}</Tile>
        <Tile
          label="Estimated value"
          note={n > 0 ? `≈ includes ${n} approximate ${n === 1 ? 'price' : 'prices'}` : undefined}
        >
          {formatUsd(stats.totalValue)}
        </Tile>
        <Tile label="Prices updated">
          {isStale(stats.pricesUpdatedAt) ? (
            <span className="flex items-baseline gap-2">
              <span className="text-lg text-amber-500">{formatRelative(stats.pricesUpdatedAt)}</span>
              <span className="rounded border border-amber-500/60 px-1.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                stale
              </span>
            </span>
          ) : (
            <span className="text-lg">{formatRelative(stats.pricesUpdatedAt)}</span>
          )}
        </Tile>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BarList
          title="By rarity"
          rows={stats.byRarity.map((r) => ({
            label: r.rarity,
            amount: r.value,
            text: `${formatUsd(r.value)} · ${r.count}`
          }))}
        />
        <BarList
          title="By card type"
          rows={stats.byFrameType.map((r) => ({
            label: titleCase(r.frameType),
            amount: r.count,
            text: String(r.count)
          }))}
        />
      </div>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-sm font-medium">Most valuable</h2>
        <ul className="divide-y">
          {stats.topEntries.slice(0, 10).map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onNavigate('collection', { entryId: e.id })}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CardArt imageId={e.imageId} size="small" alt="" className="w-9 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{e.card.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {e.printing.setCode} · {e.printing.setRarity}
                  </span>
                  <StaleBadge entry={e} />
                </span>
                <span className="text-sm tabular-nums text-muted-foreground">×{e.quantity}</span>
                <span className="min-w-20 text-right text-sm">
                  <ValueText amount={e.totalValue} approximate={e.priceApproximate} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

export function DashboardPage({ onNavigate, onAddCard }: Props): React.JSX.Element {
  const stats = useQuery({ queryKey: queryKeys.stats, queryFn: () => api.stats.get() })
  const data = stats.data

  return (
    <TooltipProvider>
      <div className="space-y-6 p-8">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        {data && data.totalCards === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
            <p className="text-lg font-medium">Your collection is empty</p>
            <p className="text-sm text-muted-foreground">Add a card to see your stats here.</p>
            <Button onClick={onAddCard}>Add your first card</Button>
          </div>
        ) : data ? (
          <Content stats={data} onNavigate={onNavigate} />
        ) : null}
      </div>
    </TooltipProvider>
  )
}
