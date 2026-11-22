import { SupporterHeart } from '@/components/SupporterHeart'
import { ArrowLeft } from 'lucide-react'
import type { Friend } from '@shared/types'
import { Button } from '@/components/ui/button'
import { UnderlineTabs } from '@/components/UnderlineTabs'
import { formatRelative } from '@/lib/format'
import { FriendAvatar } from './FriendAvatar'

export type BinderTab =
  'dashboard' | 'collection' | 'sets' | 'wishlist' | 'graded' | 'binders' | 'decks' | 'sessions'

const BINDER_TABS = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'collection', label: 'Collection' },
  { value: 'sets', label: 'Sets' },
  { value: 'wishlist', label: 'Wishlist' },
  { value: 'graded', label: 'Graded' },
  { value: 'binders', label: 'Binders' },
  { value: 'decks', label: 'Decks' },
  { value: 'sessions', label: 'Sessions' }
] as const

/** Whose binder this is and its tabs, at the top of every tab's page header. */
export function FriendHeader({
  friend,
  tab,
  onTab,
  onBack,
  trailing,
  showBinders = false,
  showSessions = false,
  showGraded = false,
  showDecks = false
}: {
  friend: Friend
  tab: BinderTab
  onTab: (tab: BinderTab) => void
  onBack: () => void
  /** Sits on the tabs' row, at its right. */
  trailing?: React.ReactNode
  /** Whether they share any binders; the Binders tab is hidden otherwise. */
  showBinders?: boolean
  /** Whether they show any scan sessions; the Sessions tab is hidden otherwise. */
  showSessions?: boolean
  /** Whether they have any slabs in this game; the Graded tab is hidden otherwise. */
  showGraded?: boolean
  /** Whether they share any decks in this game; the Decks tab is hidden otherwise. */
  showDecks?: boolean
}): React.JSX.Element {
  return (
    <>
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="-ml-2 shrink-0" onClick={onBack}>
          <ArrowLeft />
          <span className="max-md:sr-only">All friends</span>
        </Button>
        <FriendAvatar user={friend} className="size-9 text-base" />
        <div className="min-w-0">
          <h1 className="flex items-center gap-1.5 text-lg font-semibold leading-tight">
            <span className="truncate">{friend.displayName ?? friend.username}</span>
            {friend.supporter && <SupporterHeart />}
          </h1>
          <p className="truncate text-xs leading-tight text-muted-foreground">
            @{friend.username} · Updated {formatRelative(friend.updatedAt)}
          </p>
        </div>
      </div>
      <div className="flex items-end justify-between gap-4">
        <UnderlineTabs
          label="Collection"
          value={tab}
          options={BINDER_TABS.filter(
            (t) =>
              (t.value !== 'binders' || showBinders) &&
              (t.value !== 'sessions' || showSessions) &&
              (t.value !== 'graded' || showGraded) &&
              (t.value !== 'decks' || showDecks)
          )}
          onChange={onTab}
        />
        {trailing && <div className="flex items-center gap-3 pb-1">{trailing}</div>}
      </div>
    </>
  )
}
