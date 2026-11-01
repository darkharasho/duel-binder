import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Friend } from '@shared/types'
import { api, queryKeys } from '@/lib/api'
import { FriendBinders } from '../binders/FriendBinders'
import { CollectionPage } from '../collection/CollectionPage'
import { FriendWishlist } from '../wishlist/FriendWishlist'
import { FriendDashboard } from './FriendDashboard'
import { FriendHeader, type BinderTab } from './FriendHeader'
import { FriendSets } from './FriendSets'

/** A friend's binder, read-only: their header above whichever tab is open. */
export function FriendBinder({
  friend,
  onBack
}: {
  friend: Friend
  onBack: () => void
}): React.JSX.Element {
  const [chosen, setTabState] = useState<BinderTab>('dashboard')
  // An older portal answers with an error, and a friend may share none: the tab stays hidden.
  const binders = useQuery({
    queryKey: queryKeys.friendBinders(friend.id),
    queryFn: () => api.friends.binders(friend.id),
    retry: false
  })
  const showBinders = (binders.data?.length ?? 0) > 0
  const tab = chosen === 'binders' && !showBinders ? 'dashboard' : chosen
  // The card the Dashboard sent over, opened once by the Collection tab.
  const [openEntry, setOpenEntry] = useState<number | undefined>()
  const setTab = (next: BinderTab): void => {
    setOpenEntry(undefined)
    setTabState(next)
  }
  const header = (trailing?: React.ReactNode): React.JSX.Element => (
    <FriendHeader
      friend={friend}
      tab={tab}
      onTab={setTab}
      onBack={onBack}
      trailing={trailing}
      showBinders={showBinders}
    />
  )
  switch (tab) {
    case 'dashboard':
      return (
        <FriendDashboard
          friend={friend}
          header={header()}
          onOpenEntry={(id) => {
            setOpenEntry(id)
            setTabState('collection')
          }}
          onSeeAll={() => setTab('collection')}
        />
      )
    case 'collection':
      return (
        <CollectionPage
          key={openEntry ?? 'all'}
          friend={friend}
          friendHeader={header}
          initialEntryId={openEntry}
        />
      )
    case 'sets':
      return <FriendSets friend={friend} header={header()} />
    case 'wishlist':
      return <FriendWishlist friend={friend} header={header()} />
    case 'binders':
      return <FriendBinders friend={friend} binders={binders.data ?? []} header={header()} />
  }
}
