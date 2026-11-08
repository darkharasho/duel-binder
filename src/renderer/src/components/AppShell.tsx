import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import logo from '@/assets/logo.svg'
import { toast } from 'sonner'
import type { AdminPageTab } from '@/features/admin/adminTabs'
import { useAccountUser } from '@/lib/accountUser'
import { api } from '@/lib/api'
import { useFriendsAvailable, useFriendsOverview } from '@/lib/friends'
import { useContribute } from '@/features/training/contributeContext'
import { pageInGame, useGame } from '@/lib/game'
import { isMac, isWeb } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { track, trackOpen } from '@/lib/usage'
import { ArtWash } from './ArtWash'
import { ArtWashContext } from './artWashContext'
import { SidebarGameSwitch } from './GameSwitch'
import { MainScrollContext, type MainScroll } from './mainScroll'
import { ArtDownloads } from './ArtDownloads'
import { SyncBanner } from './SyncBanner'
import { TitleBar } from './TitleBar'

export type Page =
  | 'dashboard'
  | 'collection'
  | 'wishlist'
  | 'binders'
  | 'pokedex'
  | 'browse'
  | 'scan'
  | 'sessions'
  | 'friends'
  | 'sets'
  | 'settings'
  | 'admin'
export type NavigateFn = (page: Page, opts?: { entryId?: number; adminTab?: AdminPageTab }) => void

// Pages in groups, so the list reads as a few places rather than one long run. Settings sits at the
// bottom with the other extras.
const NAV_GROUPS: readonly { heading?: string; pages: readonly { page: Page; label: string }[] }[] =
  [
    { pages: [{ page: 'dashboard', label: 'Dashboard' }] },
    {
      heading: 'My cards',
      pages: [
        { page: 'collection', label: 'Collection' },
        { page: 'binders', label: 'Binders' },
        { page: 'pokedex', label: 'Pokédex' },
        { page: 'wishlist', label: 'Wishlist' }
      ]
    },
    {
      heading: 'Catalog',
      pages: [
        { page: 'sets', label: 'Sets' },
        { page: 'browse', label: 'Browse' }
      ]
    },
    {
      heading: 'Scanner',
      pages: [
        { page: 'scan', label: 'Scan' },
        { page: 'sessions', label: 'Sessions' }
      ]
    },
    { heading: 'Social', pages: [{ page: 'friends', label: 'Friends' }] }
  ]

const ITEM =
  'flex items-center gap-2 rounded-sm py-1.5 text-left text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring'

interface AppShellProps {
  page: Page
  onNavigate: NavigateFn
  onAddCard: () => void
  children: React.ReactNode
}

const GROUP_HEADING =
  'mb-0.5 mt-2 text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60'

export function AppShell({
  page,
  onNavigate,
  onAddCard,
  children
}: AppShellProps): React.JSX.Element {
  const friendsAvailable = useFriendsAvailable()
  const { testerGame, open: contribute } = useContribute()
  const { def, available } = useGame()
  const requests = useFriendsOverview().data?.incoming.length ?? 0
  const mainRef = useRef<HTMLElement>(null)
  const scroll = useMemo<MainScroll>(
    () => ({
      get: () => mainRef.current?.scrollTop ?? 0,
      set: (top) => {
        if (mainRef.current) mainRef.current.scrollTop = top
      }
    }),
    []
  )
  const [wash, setWash] = useState<string | null>(null)
  // The portal flags only the owner's account as admin.
  const { user } = useAccountUser()
  // Each page opens at its top, not wherever the previous page was scrolled to.
  useLayoutEffect(() => {
    scroll.set(0)
  }, [page, scroll])
  useEffect(() => trackOpen(), [])
  useEffect(() => {
    if (page !== 'admin') track(`page:${page}`)
  }, [page])
  // A switch to a game without this page (Scan) leaves it.
  useEffect(() => {
    if (!pageInGame(page, def)) onNavigate('dashboard')
  }, [page, def, onNavigate])
  return (
    <div className="group/shell relative isolate flex h-screen flex-col overflow-hidden bg-background text-foreground tabular-nums">
      <ArtWash src={wash} />
      {!isWeb() && (
        <>
          {/* Carries a page header's glass up to the top of the window, so it doesn't float as a box. */}
          <div
            aria-hidden
            className="absolute left-[199px] right-0 top-0 hidden h-9 border-l border-white/[0.06] bg-background/60 backdrop-blur-xl group-has-[[data-page-header]]/shell:block"
          />
          <TitleBar />
        </>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[200px] shrink-0 flex-col gap-5 border-r border-white/[0.06] px-4 pb-5 pt-1">
          {available.length > 1 ? (
            <SidebarGameSwitch />
          ) : (
            <div className="flex items-center gap-2.5">
              <img src={logo} alt="" className="h-9 w-9" />
              <span className="whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em]">
                Duel Binder
              </span>
            </div>
          )}
          <nav
            aria-label="Main"
            className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1"
          >
            {NAV_GROUPS.map(({ heading, pages }) => {
              const shown = pages.filter(
                ({ page: p }) =>
                  (p !== 'friends' || friendsAvailable) &&
                  ((p !== 'scan' && p !== 'sessions') || !isWeb()) &&
                  pageInGame(p, def)
              )
              if (shown.length === 0) return null
              return (
                <div
                  key={heading ?? 'top'}
                  role="group"
                  aria-label={heading}
                  className="flex flex-col"
                >
                  {heading && <h2 className={GROUP_HEADING}>{heading}</h2>}
                  {shown.map(({ page: p, label }) => (
                    <NavItem
                      key={p}
                      label={label}
                      active={page === p}
                      onClick={() => onNavigate(p)}
                      badge={p === 'friends' ? requests : 0}
                    />
                  ))}
                </div>
              )
            })}
          </nav>
          <button
            type="button"
            onClick={onAddCard}
            className="flex items-center justify-between rounded-md border border-white/20 px-3 py-1.5 text-sm font-semibold transition-colors hover:border-white/40 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-ring"
          >
            Add card
            <kbd className="font-mono text-xs font-normal text-muted-foreground">
              {isMac() ? '⌘K' : 'Ctrl K'}
            </kbd>
          </button>
          <div className="-mt-2 flex flex-col border-t border-white/[0.06] pt-2">
            {testerGame !== undefined && (
              <button
                type="button"
                onClick={() => {
                  // The scanner lets go of the camera first.
                  if (page === 'scan') onNavigate('dashboard')
                  contribute(testerGame)
                }}
                className={ITEM}
              >
                <span aria-hidden className="size-1.5 rounded-full bg-transparent" />
                Contribute photos
              </button>
            )}
            {/* Only the admin accounts see this. The desktop opens the admin page in the app, its
                sections as tabs along the top; the web goes to the portal's /admin page instead. */}
            {user?.admin && (
              <div role="group" aria-label="Admin" className="flex flex-col">
                <NavItem
                  label="Admin"
                  active={page === 'admin'}
                  onClick={() =>
                    api.admin
                      ? onNavigate('admin')
                      : void api.account
                          .openAdmin()
                          .catch((e: unknown) =>
                            toast.error(
                              e instanceof Error ? e.message : "Couldn't open the dashboard"
                            )
                          )
                  }
                />
              </div>
            )}
            <NavItem
              label="Settings"
              active={page === 'settings'}
              onClick={() => onNavigate('settings')}
            />
          </div>
        </aside>
        <div className="relative flex min-w-0 flex-1 flex-col">
          <SyncBanner />
          <main ref={mainRef} data-main-scroll className="min-h-0 flex-1 overflow-auto">
            <ArtWashContext.Provider value={setWash}>
              <MainScrollContext.Provider value={scroll}>{children}</MainScrollContext.Provider>
            </ArtWashContext.Provider>
          </main>
          <ArtDownloads />
        </div>
      </div>
    </div>
  )
}

function NavItem({
  label,
  active,
  onClick,
  badge = 0
}: {
  label: string
  active: boolean
  onClick: () => void
  badge?: number
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={
        badge > 0 ? `${label}, ${badge} ${badge === 1 ? 'request' : 'requests'}` : undefined
      }
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(ITEM, active && 'font-semibold text-foreground')}
    >
      <span
        aria-hidden
        className={cn('size-1.5 rounded-full', active ? 'bg-foreground' : 'bg-transparent')}
      />
      {label}
      {badge > 0 && (
        <span
          aria-hidden
          className="rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-4 text-primary-foreground"
        >
          {badge}
        </span>
      )}
    </button>
  )
}
