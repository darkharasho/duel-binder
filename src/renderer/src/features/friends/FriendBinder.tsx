import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ScanSession, ScanSessionCard } from '@shared/scanSessions'
import type { Friend } from '@shared/types'
import { PageHeader } from '@/components/PageHeader'
import { api, queryKeys } from '@/lib/api'
import { useBackHandler } from '@/lib/backStack'
import { useGame } from '@/lib/game'
import { DEFAULT_FILTERS } from '../collection/defaultFilters'
import { SessionCardSheet } from '../sessions/SessionCardSheet'
import { SessionFeed } from '../sessions/SessionFeed'
import { FriendBinders } from '../binders/FriendBinders'
import { CollectionPage } from '../collection/CollectionPage'
import { FriendWishlist } from '../wishlist/FriendWishlist'
import { FriendDashboard } from './FriendDashboard'
import { FriendCardSheet } from './FriendCardSheet'
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
  useBackHandler(true, onBack)
  const [chosen, setTabState] = useState<BinderTab>('dashboard')
  // An older portal answers with an error, and a friend may share none: the tab stays hidden.
  const binders = useQuery({
    queryKey: queryKeys.friendBinders(friend.id),
    queryFn: () => api.friends.binders(friend.id),
    retry: false
  })
  const showBinders = (binders.data?.length ?? 0) > 0
  const { game } = useGame()
  const sessions = useQuery({
    queryKey: queryKeys.friendSessions(friend.id, game),
    queryFn: () => api.friends.sessions(friend.id),
    retry: false
  })
  const showSessions = (sessions.data?.length ?? 0) > 0
  const tab =
    (chosen === 'binders' && !showBinders) || (chosen === 'sessions' && !showSessions)
      ? 'dashboard'
      : chosen
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
      showSessions={showSessions}
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
    case 'sessions':
      return <FriendSessions friend={friend} sessions={sessions.data ?? []} header={header()} />
  }
}

/** The scan sessions a friend shows: the feed without owner controls; a tile opens their copies. */
function FriendSessions({
  friend,
  sessions,
  header
}: {
  friend: Friend
  sessions: ScanSession[]
  header: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState<ScanSessionCard | null>(null)
  return (
    <div className="space-y-4 p-8 max-md:p-4">
      <PageHeader>{header}</PageHeader>
      <SessionFeed sessions={sessions} owner={false} variant="desktop" onOpenCard={setOpen} />
      {open && <TileSheet friend={friend} card={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** Their copies of the card when they have any, otherwise the plain card. */
function TileSheet({
  friend,
  card,
  onClose
}: {
  friend: Friend
  card: ScanSessionCard
  onClose: () => void
}): React.JSX.Element | null {
  const all = useQuery({
    queryKey: queryKeys.friendEntries(friend.id, DEFAULT_FILTERS),
    queryFn: () => api.friends.collection(friend.id, DEFAULT_FILTERS),
    retry: false
  })
  if (all.isPending) return null
  if (all.data?.some((e) => e.card.id === card.cardId))
    return <FriendCardSheet friend={friend} cardId={card.cardId} onClose={onClose} />
  return <SessionCardSheet card={card} onClose={onClose} />
}
