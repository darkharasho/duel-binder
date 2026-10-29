import { Fragment, useCallback, useState } from 'react'
import type { CardSearchResult } from '@shared/types'
import type { NavigateFn, Page } from '@/components/AppShell'
import { useDataChanged } from '@/components/useDataChanged'
import { AddCardDialog } from '@/features/add-card/AddCardDialog'
import { BrowsePage } from '@/features/browse/BrowsePage'
import { CollectionPage } from '@/features/collection/CollectionPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { FriendsPage } from '@/features/friends/FriendsPage'
import { SetsPage } from '@/features/sets/SetsPage'
import { useFriendsAvailable } from '@/lib/friends'
import { useGame } from '@/lib/game'

export interface AddInitial {
  card: CardSearchResult
  printingId: number
}

/** The signed-in app's page state: which page shows, the Add card dialog, and data-changed refetches. */
export interface Pages {
  page: Page
  entryId: number | undefined
  friendsKey: number
  onNavigate: NavigateFn
  openAdd: (initial?: AddInitial | null) => void
  addOpen: boolean
  setAddOpen: (open: boolean) => void
  addInitial: AddInitial | null
}

/** The page state both shells (desktop and phone) use; `initial` is the page shown first. */
// eslint-disable-next-line react-refresh/only-export-components -- the hook belongs with its switch
export function usePages(initial: Page = 'dashboard'): Pages {
  const [chosenPage, setPage] = useState<Page>(initial)
  const [entryId, setEntryId] = useState<number | undefined>()
  const [friendsKey, setFriendsKey] = useState(0)
  const friendsAvailable = useFriendsAvailable()
  // Desktop sign-out takes the Friends nav item away; don't leave its page showing.
  const page: Page = chosenPage === 'friends' && !friendsAvailable ? 'dashboard' : chosenPage
  const [addOpen, setAddOpen] = useState(false)
  const [addInitial, setAddInitial] = useState<AddInitial | null>(null)
  useDataChanged()

  const openAdd = useCallback((initial: AddInitial | null = null): void => {
    setAddInitial(initial)
    setAddOpen(true)
  }, [])

  const onNavigate: NavigateFn = useCallback((next, opts) => {
    setEntryId(opts?.entryId)
    if (next === 'friends') setFriendsKey((k) => k + 1)
    setPage(next)
  }, [])

  return { page, entryId, friendsKey, onNavigate, openAdd, addOpen, setAddOpen, addInitial }
}

/**
 * The page for `pages.page`. Scan, Rip and Settings differ between the shells, so each passes its
 * own; the rest are the same pages with the same props. A game switch starts the page afresh, so
 * no filter, open card or set carries over from the other game.
 */
export function PageSwitch({
  pages,
  scan,
  rip,
  settings
}: {
  pages: Pages
  scan: React.ReactNode
  rip: React.ReactNode
  settings: React.ReactNode
}): React.JSX.Element {
  const { page, entryId, friendsKey, onNavigate, openAdd } = pages
  const { game } = useGame()
  return (
    <Fragment key={game}>
      {page === 'dashboard' && (
        <DashboardPage onNavigate={onNavigate} onAddCard={() => openAdd()} />
      )}
      {page === 'collection' && (
        <CollectionPage
          key={entryId ?? 'all'}
          initialEntryId={entryId}
          onAddCard={() => openAdd()}
        />
      )}
      {page === 'browse' && (
        <BrowsePage onAddCard={(card, printingId) => openAdd({ card, printingId })} />
      )}
      {page === 'sets' && (
        <SetsPage
          onAddCard={() => openAdd()}
          onAddMissing={(card, printingId) => openAdd({ card, printingId })}
        />
      )}
      {page === 'scan' && scan}
      {page === 'rip' && rip}
      {page === 'friends' && (
        <FriendsPage key={friendsKey} onBackToMine={() => onNavigate('collection')} />
      )}
      {page === 'settings' && settings}
    </Fragment>
  )
}

/** The Add card dialog the pages open. */
export function PagesAddCard({ pages }: { pages: Pages }): React.JSX.Element {
  return (
    <AddCardDialog
      open={pages.addOpen}
      onOpenChange={pages.setAddOpen}
      initial={pages.addInitial}
    />
  )
}
