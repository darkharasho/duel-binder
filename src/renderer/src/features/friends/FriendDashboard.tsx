import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LoadingState } from '@/components/ui/loading'
import type { EntryView, Friend } from '@shared/types'
import { cardArtUrl, useArtWash } from '@/components/artWashContext'
import { CardSheet } from '@/components/CardSheet'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, queryKeys } from '@/lib/api'
import { formatUsd } from '@/lib/format'
import { friendsErrorMessage } from '@/lib/friends'
import { DEFAULT_FILTERS } from '../collection/defaultFilters'
import { Breakdowns, MostValuable, PriceNotes } from '../dashboard/DashboardPage'
import { FriendEntryPanel } from './FriendEntryPanel'

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
    </div>
  )
}

/** A friend's stats in the game shown, read-only. A card opens over it, with the friend's copies. */
export function FriendDashboard({
  friend,
  header,
  onSeeAll
}: {
  friend: Friend
  header: React.ReactNode
  onSeeAll: () => void
}): React.JSX.Element {
  const name = friend.displayName ?? friend.username
  const stats = useQuery({
    queryKey: queryKeys.friendStats(friend.id),
    queryFn: () => api.friends.stats(friend.id),
    retry: false
  })
  const data = stats.data
  const top = data?.topEntries[0]
  useArtWash(top ? cardArtUrl(top.imageId) : null)
  const [open, setOpen] = useState<EntryView | null>(null)
  // The friend's other copies of the card, for the panel's list; the opened entry shows meanwhile.
  const all = useQuery({
    queryKey: queryKeys.friendEntries(friend.id, DEFAULT_FILTERS),
    queryFn: () => api.friends.collection(friend.id, DEFAULT_FILTERS),
    enabled: open !== null
  })
  const copies = open ? (all.data ?? [open]).filter((e) => e.card.id === open.card.id) : []

  return (
    <TooltipProvider>
      <div className="max-w-[1800px] space-y-8 p-8 max-md:p-4">
        <PageHeader>{header}</PageHeader>
        {stats.isError && !data && (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-muted-foreground">
              {friendsErrorMessage(stats.error)}
            </p>
            <Button variant="outline" onClick={() => void stats.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {stats.isPending && <LoadingState label={`Loading ${name}'s collection…`} />}
        {data && data.totalCards === 0 && (
          <p className="text-lg font-medium">{name} hasn&apos;t added any cards yet</p>
        )}
        {data && data.totalCards > 0 && (
          <>
            <section aria-label="Stats">
              <div className="grid grid-cols-4 gap-6 max-md:grid-cols-2">
                <Stat label="Total value" value={formatUsd(data.totalValue)} />
                <Stat label="Cards" value={data.totalCards.toLocaleString()} />
                <Stat label="Unique" value={data.uniqueCards.toLocaleString()} />
                <Stat label="You both own" value={data.sharedCards.toLocaleString()} />
              </div>
              <PriceNotes stats={data} />
            </section>
            <MostValuable stats={data} onOpen={setOpen} onSeeAll={onSeeAll} />
            <Breakdowns stats={data} onOpen={setOpen} />
          </>
        )}
        {open && (
          <CardSheet onClose={() => setOpen(null)}>
            <FriendEntryPanel
              entry={open}
              copies={copies.length ? copies : [open]}
              onSelectEntry={(id) => setOpen(copies.find((e) => e.id === id) ?? open)}
            />
          </CardSheet>
        )}
      </div>
    </TooltipProvider>
  )
}
