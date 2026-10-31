import { useState } from 'react'
import type { Friend } from '@shared/types'
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
  const [tab, setTabState] = useState<BinderTab>('dashboard')
  // The card the Dashboard sent over, opened once by the Collection tab.
  const [openEntry, setOpenEntry] = useState<number | undefined>()
  const setTab = (next: BinderTab): void => {
    setOpenEntry(undefined)
    setTabState(next)
  }
  const header = <FriendHeader friend={friend} tab={tab} onTab={setTab} onBack={onBack} />
  switch (tab) {
    case 'dashboard':
      return (
        <FriendDashboard
          friend={friend}
          header={header}
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
      return <FriendSets friend={friend} header={header} />
    case 'wishlist':
      return <FriendWishlist friend={friend} header={header} />
  }
}
