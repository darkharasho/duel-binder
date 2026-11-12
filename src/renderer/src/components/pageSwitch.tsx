import { Fragment, Suspense, lazy, useCallback, useState } from 'react'
import type { Language } from '@shared/languages'
import type { CardSearchResult } from '@shared/types'
import type { NavigateFn, Page } from '@/components/AppShell'
import { useDataChanged } from '@/components/useDataChanged'
import { AddCardDialog } from '@/features/add-card/AddCardDialog'
import { BindersPage } from '@/features/binders/BindersPage'
import { BrowsePage } from '@/features/browse/BrowsePage'
import { CollectionPage } from '@/features/collection/CollectionPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { FriendsPage } from '@/features/friends/FriendsPage'
import { PokedexPage } from '@/features/pokedex/PokedexPage'
import { SessionsPage } from '@/features/sessions/SessionsPage'
import { SetsPage } from '@/features/sets/SetsPage'
import { WishlistPage } from '@/features/wishlist/WishlistPage'
import type { AdminPageTab } from '@/features/admin/adminTabs'
import { api } from '@/lib/api'
import { useFriendsAvailable } from '@/lib/friends'
import { pageInGame, useGame } from '@/lib/game'

// Only admins ever open it, so it loads only then.
const AdminPage = lazy(() =>
  import('@/features/admin/AdminPage').then((m) => ({ default: m.AdminPage }))
)

/** Open Add card at this card's printing step, or at the search step with this text typed. */
export type AddInitial = { card: CardSearchResult; printingId: number } | { query: string }

/** The signed-in app's page state: which page shows, the Add card dialog, and data-changed refetches. */
export interface Pages {
  page: Page
  adminTab: AdminPageTab
  entryId: number | undefined
  /** The set the Sets page opens on, when a link elsewhere asked for one. */
  openSet: { setName: string; language: Language } | undefined
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
  const [openSet, setOpenSet] = useState<Pages['openSet']>()
  const [adminTab, setAdminTab] = useState<AdminPageTab>('overview')
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
    setOpenSet(opts?.set)
    if (opts?.adminTab) setAdminTab(opts.adminTab)
    if (next === 'friends') setFriendsKey((k) => k + 1)
    setPage(next)
  }, [])

  return {
    page,
    adminTab,
    entryId,
    openSet,
    friendsKey,
    onNavigate,
    openAdd,
    addOpen,
    setAddOpen,
    addInitial
  }
}

/**
 * The page for `pages.page`. Scan and Settings differ between the shells, so each passes its
 * own; the rest are the same pages with the same props. A game switch starts the page afresh, so
 * no filter, open card or set carries over from the other game.
 */
export function PageSwitch({
  pages,
  scan,
  settings
}: {
  pages: Pages
  scan: React.ReactNode
  settings: React.ReactNode
}): React.JSX.Element {
  const { entryId, openSet, friendsKey, onNavigate, openAdd, adminTab } = pages
  const { game, def } = useGame()
  // A page the shown game lacks (Scan on One Piece) falls back to the dashboard in this same render;
  // the shell's effect then moves `page` itself.
  const page = pageInGame(pages.page, def) ? pages.page : 'dashboard'
  return (
    <Fragment key={game}>
      {page === 'dashboard' && (
        <DashboardPage
          onNavigate={onNavigate}
          onAddCard={() => openAdd()}
          onSearch={(query) => openAdd({ query })}
        />
      )}
      {page === 'collection' && (
        <CollectionPage
          key={entryId ?? 'all'}
          initialEntryId={entryId}
          onAddCard={() => openAdd()}
          onSearch={(query) => openAdd({ query })}
          onNavigate={onNavigate}
        />
      )}
      {page === 'wishlist' && <WishlistPage />}
      {page === 'binders' && <BindersPage />}
      {page === 'pokedex' && <PokedexPage />}
      {page === 'browse' && (
        <BrowsePage onAddCard={(card, printingId) => openAdd({ card, printingId })} />
      )}
      {page === 'sets' && (
        <SetsPage
          key={openSet ? `${openSet.language}:${openSet.setName}` : 'list'}
          initialSet={openSet}
          onAddCard={() => openAdd()}
          onAddMissing={(card, printingId) => openAdd({ card, printingId })}
        />
      )}
      {page === 'scan' && scan}
      {page === 'sessions' && <SessionsPage />}
      {page === 'friends' && <FriendsPage key={friendsKey} />}
      {page === 'settings' && settings}
      {page === 'admin' && (
        <Suspense fallback={null}>
          <AdminPage
            tab={adminTab}
            onTab={(t) => onNavigate('admin', { adminTab: t })}
            onLeave={() => {
              onNavigate('dashboard')
              // A sync reads the account again, which takes the Admin group away.
              void api.account.syncNow().catch(() => {})
            }}
          />
        </Suspense>
      )}
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
