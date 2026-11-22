import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import logoMark from '@/assets/logo-mark.svg'
import { toast } from 'sonner'
import type { Language } from '@shared/languages'
import type { AdminPageTab } from '@/features/admin/adminTabs'
import { useAccountUser } from '@/lib/accountUser'
import { api } from '@/lib/api'
import { useFriendsAvailable, useFriendsOverview } from '@/lib/friends'
import { useContribute } from '@/features/training/contributeContext'
import { pageInGame, useGame } from '@/lib/game'
import { isMac, isWeb } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { track, trackOpen } from '@/lib/usage'
import { ArtWash } from './ArtWash'
import { ArtWashContext, type WashState } from './artWashContext'
import { SidebarGameSwitch } from './GameSwitch'
import { MainScrollContext, type MainScroll } from './mainScroll'
import { ArtDownloads } from './ArtDownloads'
import { SyncBanner } from './SyncBanner'
import { TitleBar } from './TitleBar'

export type Page =
  | 'dashboard'
  | 'collection'
  | 'graded'
  | 'wishlist'
  | 'binders'
  | 'decks'
  | 'pokedex'
  | 'browse'
  | 'scan'
  | 'sessions'
  | 'friends'
  | 'sets'
  | 'settings'
  | 'admin'
export type NavigateFn = (
  page: Page,
  opts?: {
    entryId?: number
    adminTab?: AdminPageTab
    set?: { setName: string; language: Language }
  }
) => void

// Pages in groups, so the list reads as a few places rather than one long run. Settings sits at the
// bottom with the other extras.
const NAV_GROUPS: readonly { heading?: string; pages: readonly { page: Page; label: string }[] }[] =
  [
    { pages: [{ page: 'dashboard', label: 'Dashboard' }] },
    {
      heading: 'My cards',
      pages: [
        { page: 'collection', label: 'Collection' },
        { page: 'graded', label: 'Graded' },
        { page: 'binders', label: 'Binders' },
        { page: 'decks', label: 'Decks' },
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

// Plain ink text over the wash, fully opaque. The active link grows and gets a dot to its left.
const ITEM =
  'relative flex items-center gap-2 rounded-sm py-[3px] text-left text-[15px] font-normal text-foreground transition-colors duration-150 hover:underline focus-visible:outline-2 focus-visible:outline-ring'

interface AppShellProps {
  page: Page
  onNavigate: NavigateFn
  onAddCard: () => void
  children: React.ReactNode
}

const GROUP_HEADING =
  'mb-1 mt-4 font-mono text-[10.5px] font-medium uppercase tracking-[1.5px] text-foreground'

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
  const [wash, setWash] = useState<WashState | null>(null)
  // The portal flags only the owner's account as admin.
  const { user } = useAccountUser()
  // Each page opens at its top, not wherever the previous page was scrolled to.
  useLayoutEffect(() => {
    scroll.set(0)
  }, [page, scroll])
  useEffect(() => trackOpen(), [])
  useEffect(() => {
    // Decks has no usage event yet: the portal refuses events it doesn't know.
    if (page !== 'admin' && page !== 'decks') track(`page:${page}`)
  }, [page])
  // A switch to a game without this page (Scan) leaves it.
  useEffect(() => {
    if (!pageInGame(page, def)) onNavigate('dashboard')
  }, [page, def, onNavigate])
  return (
    <div className="group/shell relative isolate flex h-screen flex-col overflow-hidden bg-background text-foreground tabular-nums">
      <ArtWash wash={wash} enabled={page !== 'scan'} />
      {!isWeb() && <TitleBar />}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[200px] shrink-0 flex-col gap-5 pb-5 pl-6 pr-3 pt-3">
          <div className="flex flex-col items-start gap-3">
            <div className="-ml-1 flex items-center gap-2">
              <img src={logoMark} alt="" className="h-auto w-[34px] shrink-0" />
              <span className="whitespace-nowrap font-display text-[24px] leading-none">
                Duel Binder
              </span>
            </div>
            {available.length > 1 && <SidebarGameSwitch />}
          </div>
          <nav
            aria-label="Main"
            className="-ml-6 -mr-1 flex min-h-0 flex-1 flex-col overflow-y-auto pl-6 pr-1"
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
                      indent={heading !== undefined}
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
          <Button
            type="button"
            variant="outline"
            onClick={onAddCard}
            className="justify-between px-4"
          >
            Add card
            <kbd className="font-mono text-xs font-normal">{isMac() ? '⌘K' : 'Ctrl K'}</kbd>
          </Button>
          <div className="-mt-2 flex flex-col pt-2">
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
  badge = 0,
  indent = false
}: {
  label: string
  active: boolean
  onClick: () => void
  badge?: number
  /** Set in from its group heading. */
  indent?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={
        badge > 0 ? `${label}, ${badge} ${badge === 1 ? 'request' : 'requests'}` : undefined
      }
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(ITEM, indent && 'ml-3', active && 'text-base font-extrabold')}
    >
      {active && (
        <span
          aria-hidden
          className="absolute -left-3.5 top-1/2 size-[7px] -translate-y-1/2 rounded-full bg-foreground"
        />
      )}
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
