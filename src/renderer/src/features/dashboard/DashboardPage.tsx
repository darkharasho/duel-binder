import { useQuery } from '@tanstack/react-query'
import type { CollectionStats } from '@shared/types'
import type { NavigateFn } from '@/components/AppShell'
import { cardArtUrl, useArtWash } from '@/components/artWash'
import { CardArt } from '@/components/CardArt'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { EntryValue, StaleBadge, displayTotal } from '@/features/collection/EntryValue'
import { api, queryKeys } from '@/lib/api'
import { formatRelative, formatUsd } from '@/lib/format'

interface Props {
  onNavigate: NavigateFn
  onAddCard?: () => void
}

// Rarities and card types keep colours a collector would expect; anything else falls back in order.
const RARITY_COLORS: Record<string, string> = {
  'Ultra Rare': '#e9c46a',
  'Secret Rare': '#c8b6ff',
  'Super Rare': '#8ab4f8',
  Rare: '#d9d6cf',
  Common: '#6d6b67',
  'Short Print': '#8f8d88',
  'Super Short Print': '#a8a59f',
  'Ghost Rare': '#b9e3ef',
  'Starlight Rare': '#f3d9a4',
  'Prismatic Secret Rare': '#f0b4d0',
  'Quarter Century Secret Rare': '#e6a96b',
  'Ultimate Rare': '#c9a35c',
  'Gold Rare': '#d4a93c'
}
const FRAME_COLORS: Record<string, string> = {
  normal: '#e3c56a',
  effect: '#e08a46',
  spell: '#2fae98',
  trap: '#c0508f',
  fusion: '#9b6fd0',
  ritual: '#6b8fd6',
  synchro: '#e8e6e1',
  xyz: '#5d5d66',
  link: '#3d7fd6',
  token: '#a8a39a',
  skill: '#4fa3d1'
}
const FALLBACK = ['#7aa38a', '#b98b6b', '#8a87b8', '#b8869c', '#7f9cad', '#a3a06a']

const colorFor = (map: Record<string, string>, key: string, i: number): string =>
  map[key] ?? (key.includes('_') ? map[key.split('_')[0]] : undefined) ?? FALLBACK[i % FALLBACK.length]

interface Segment {
  label: string
  amount: number
  text: string
  color: string
}

/** One stacked bar with a legend underneath, largest first. */
function Breakdown({ title, segments }: { title: string; segments: Segment[] }): React.JSX.Element {
  const sorted = [...segments].sort((a, b) => b.amount - a.amount)
  const total = sorted.reduce((n, s) => n + s.amount, 0)
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {sorted.length === 0 || total === 0 ? (
        <p className="text-sm text-muted-foreground">No data yet</p>
      ) : (
        <>
          <div aria-hidden className="mb-3 flex h-2.5 overflow-hidden rounded-[2px] bg-white/5">
            {sorted.map((s) => (
              <div
                key={s.label}
                style={{ width: `${(s.amount / total) * 100}%`, background: s.color }}
              />
            ))}
          </div>
          <ul aria-label={title} className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]">
            {sorted.map((s) => (
              <li key={s.label} className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ background: s.color }}
                />
                <span className="truncate">{s.label}</span>
                <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                  {s.text}
                </span>
              </li>
            ))}
          </ul>
        </>
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

function Content({
  stats,
  onNavigate
}: {
  stats: CollectionStats
  onNavigate: NavigateFn
}): React.JSX.Element {
  const n = stats.approximateCount
  const stale = isStale(stats.pricesUpdatedAt)
  return (
    <>
      <header>
        <p className="text-[13px] text-foreground/75">Your collection is worth</p>
        <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">
          {formatUsd(stats.totalValue)}
        </p>
        {n > 0 && (
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            ≈ includes {n} approximate {n === 1 ? 'price' : 'prices'}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-foreground/75">
          <div className="flex gap-1.5">
            <span className="font-semibold text-foreground">{stats.totalCards}</span>
            <span>Total cards</span>
          </div>
          <div className="flex gap-1.5">
            <span className="font-semibold text-foreground">{stats.uniqueCards}</span>
            <span>Unique cards</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span>Prices updated</span>
            <span className={stale ? 'text-amber-400' : undefined}>
              {formatRelative(stats.pricesUpdatedAt)}
            </span>
            {stale && (
              <span className="rounded-sm border border-amber-400/50 px-1 text-[11px] text-amber-400">
                stale
              </span>
            )}
          </div>
        </div>
      </header>

      {stats.topEntries.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Most valuable</h2>
            <button
              type="button"
              onClick={() => onNavigate('collection')}
              className="text-[13px] text-muted-foreground hover:text-foreground"
            >
              See all
            </button>
          </div>
          <ul className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-2">
            {stats.topEntries.slice(0, 10).map((e) => (
              <li key={e.id} className="w-28 shrink-0">
                <button
                  type="button"
                  onClick={() => onNavigate('collection', { entryId: e.id })}
                  className="group flex w-full flex-col gap-2 rounded-md p-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <CardArt
                    imageId={e.imageId}
                    printingId={e.printing.id}
                    size="small"
                    alt=""
                    className="w-full rounded-[4px] shadow-[0_8px_20px_rgb(0_0_0/0.5)] transition-transform duration-200 group-hover:-translate-y-1"
                  />
                  <span className="min-w-0 text-xs leading-snug">
                    <span className="line-clamp-2">{e.card.name}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {e.printing.setCode}
                      {e.quantity > 1 && ` ×${e.quantity}`}
                    </span>
                    <span className="block font-mono text-[11px]">
                      <EntryValue entry={e} amount={displayTotal(e)} />
                    </span>
                    <StaleBadge entry={e} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-10 lg:grid-cols-2">
        <Breakdown
          title="By rarity"
          segments={stats.byRarity.map((r, i) => ({
            label: r.rarity,
            amount: r.value,
            text: `${formatUsd(r.value)} · ${r.count}`,
            color: colorFor(RARITY_COLORS, r.rarity, i)
          }))}
        />
        <Breakdown
          title="By card type"
          segments={stats.byFrameType.map((r, i) => ({
            label: titleCase(r.frameType),
            amount: r.count,
            text: String(r.count),
            color: colorFor(FRAME_COLORS, r.frameType, i)
          }))}
        />
      </div>
    </>
  )
}

export function DashboardPage({ onNavigate, onAddCard }: Props): React.JSX.Element {
  const stats = useQuery({ queryKey: queryKeys.stats, queryFn: () => api.stats.get() })
  const data = stats.data
  const top = data?.topEntries[0]
  useArtWash(top ? cardArtUrl(top.imageId) : null)

  return (
    <TooltipProvider>
      <div className="max-w-5xl space-y-10 px-8 pb-10 pt-3">
        <h1 className="sr-only">Dashboard</h1>
        {data && data.totalCards === 0 ? (
          <div className="flex flex-col items-start gap-3 py-16">
            <p className="text-2xl font-semibold">Your collection is empty</p>
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
