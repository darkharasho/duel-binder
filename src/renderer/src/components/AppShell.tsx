import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import logo from '@/assets/logo.svg'
import { useFriendsAvailable, useFriendsOverview } from '@/lib/friends'
import { pageInGame, useGame } from '@/lib/game'
import { isMac, isWeb } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { track, trackOpen } from '@/lib/usage'
import { fetchMe } from '@/web/account'
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
  | 'browse'
  | 'scan'
  | 'rip'
  | 'friends'
  | 'sets'
  | 'settings'
export type NavigateFn = (page: Page, opts?: { entryId?: number }) => void

const NAV = [
  { page: 'dashboard', label: 'Dashboard' },
  { page: 'collection', label: 'Collection' },
  { page: 'wishlist', label: 'Wishlist' },
  { page: 'sets', label: 'Sets' },
  { page: 'browse', label: 'Browse' },
  { page: 'scan', label: 'Scan' },
  { page: 'rip', label: 'Rip' },
  { page: 'friends', label: 'Friends' },
  { page: 'settings', label: 'Settings' }
] as const

interface AppShellProps {
  page: Page
  onNavigate: NavigateFn
  onAddCard: () => void
  children: React.ReactNode
}

export function AppShell({
  page,
  onNavigate,
  onAddCard,
  children
}: AppShellProps): React.JSX.Element {
  const friendsAvailable = useFriendsAvailable()
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
  // Shares the account section's query; the portal flags only the owner's account as admin.
  const me = useQuery({ queryKey: ['me'], queryFn: () => fetchMe(), enabled: isWeb() })
  // Each page opens at its top, not wherever the previous page was scrolled to.
  useLayoutEffect(() => {
    scroll.set(0)
  }, [page, scroll])
  useEffect(() => trackOpen(), [])
  useEffect(() => track(`page:${page}`), [page])
  // A switch to a game without this page (Scan or Rip) leaves it.
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
        <aside className="flex w-[200px] shrink-0 flex-col gap-6 border-r border-white/[0.06] px-4 pb-5 pt-1">
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
          <nav aria-label="Main" className="flex flex-col">
            {NAV.filter(
              ({ page: p }) =>
                (p !== 'friends' || friendsAvailable) &&
                ((p !== 'scan' && p !== 'rip') || !isWeb()) &&
                pageInGame(p, def)
            ).map(({ page: p, label }) => (
              <button
                key={p}
                type="button"
                aria-label={
                  p === 'friends' && requests > 0
                    ? `Friends, ${requests} ${requests === 1 ? 'request' : 'requests'}`
                    : undefined
                }
                aria-current={page === p ? 'page' : undefined}
                onClick={() => onNavigate(p)}
                className={cn(
                  'flex items-center gap-2 rounded-sm py-1.5 text-left text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
                  page === p && 'font-semibold text-foreground'
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'size-1.5 rounded-full',
                    page === p ? 'bg-foreground' : 'bg-transparent'
                  )}
                />
                {label}
                {p === 'friends' && requests > 0 && (
                  <span
                    aria-hidden
                    className="rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-4 text-primary-foreground"
                  >
                    {requests}
                  </span>
                )}
              </button>
            ))}
          </nav>
          {me.data?.admin && (
            <a
              href="/admin"
              className="-mt-4 flex items-center gap-2 rounded-sm py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span aria-hidden className="size-1.5 rounded-full bg-transparent" />
              Admin
            </a>
          )}
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
