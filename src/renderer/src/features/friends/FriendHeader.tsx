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
  onBack
}: {
  friend: Friend
  tab: BinderTab
  onTab: (tab: BinderTab) => void
  onBack: () => void
}): React.JSX.Element {
  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft />
        All friends
      </Button>
      <div className="flex items-center gap-3">
        <FriendAvatar user={friend} className="size-11 text-lg" />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">
            {friend.displayName ?? friend.username}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            @{friend.username} · Updated {formatRelative(friend.updatedAt)}
          </p>
        </div>
      </div>
      <UnderlineTabs label="Binder" value={tab} options={BINDER_TABS} onChange={onTab} />
    </>
  )
}
