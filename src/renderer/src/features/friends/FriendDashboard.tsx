import { useQuery } from '@tanstack/react-query'
import type { Friend } from '@shared/types'
import { cardArtUrl, useArtWash } from '@/components/artWashContext'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, queryKeys } from '@/lib/api'
import { formatUsd } from '@/lib/format'
import { friendsErrorMessage } from '@/lib/friends'
import { Breakdowns, MostValuable, PriceNotes } from '../dashboard/DashboardPage'

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
    </div>
  )
}

/** A friend's stats in the game shown, read-only. */
export function FriendDashboard({
  friend,
  header,
  onOpenEntry,
  onSeeAll
}: {
  friend: Friend
  header: React.ReactNode
  onOpenEntry: (entryId: number) => void
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
            <MostValuable stats={data} onOpen={onOpenEntry} onSeeAll={onSeeAll} />
            <Breakdowns stats={data} onOpen={onOpenEntry} />
          </>
        )}
      </div>
    </TooltipProvider>
  )
}
