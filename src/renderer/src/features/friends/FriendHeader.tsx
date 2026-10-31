import { ArrowLeft } from 'lucide-react'
import type { Friend } from '@shared/types'
import { Button } from '@/components/ui/button'
import { UnderlineTabs } from '@/components/UnderlineTabs'
import { formatRelative } from '@/lib/format'
import { FriendAvatar } from './FriendAvatar'

export type BinderTab = 'dashboard' | 'collection' | 'sets' | 'wishlist'

const BINDER_TABS = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'collection', label: 'Collection' },
  { value: 'sets', label: 'Sets' },
  { value: 'wishlist', label: 'Wishlist' }
] as const

/** Whose binder this is and its tabs, at the top of every tab's page header. */
export function FriendHeader({
  friend,
  tab,
  onTab,
  onBack,
  trailing
}: {
  friend: Friend
  tab: BinderTab
  onTab: (tab: BinderTab) => void
  onBack: () => void
  /** Sits on the tabs' row, at its right. */
  trailing?: React.ReactNode
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
          <h1 className="truncate text-lg font-semibold leading-tight">
            {friend.displayName ?? friend.username}
          </h1>
          <p className="truncate text-xs leading-tight text-muted-foreground">
            @{friend.username} · Updated {formatRelative(friend.updatedAt)}
          </p>
        </div>
      </div>
      <div className="flex items-end justify-between gap-4">
        <UnderlineTabs label="Binder" value={tab} options={BINDER_TABS} onChange={onTab} />
        {trailing && <div className="flex items-center gap-3 pb-1">{trailing}</div>}
      </div>
    </>
  )
}
