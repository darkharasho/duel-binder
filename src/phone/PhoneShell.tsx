import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  EllipsisIcon,
  HouseIcon,
  LayoutGridIcon,
  LibraryIcon,
  ScanLineIcon,
  SearchIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon
} from 'lucide-react'
import { ArtWash } from '@/components/ArtWash'
import { ArtWashContext } from '@/components/artWashContext'
import type { Page } from '@/components/AppShell'
import { MainScrollContext, type MainScroll } from '@/components/mainScroll'
import { PageSwitch, PagesAddCard, usePages } from '@/components/pageSwitch'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import type { ScanEngine } from '@/features/scan/engine'
import { api, mutationInvalidationKeys } from '@/lib/api'
import { useFriendsOverview } from '@/lib/friends'
import { cn } from '@/lib/utils'
import { usePhone } from './context'
import { ScannerScreen } from './ScannerScreen'
import { Settings } from './Settings'
import { StatusLine } from './StatusLine'

const TABS: { page: Page; label: string; icon: LucideIcon }[] = [
  { page: 'dashboard', label: 'Home', icon: HouseIcon },
  { page: 'collection', label: 'Collection', icon: LibraryIcon },
  { page: 'scan', label: 'Scan', icon: ScanLineIcon },
  { page: 'sets', label: 'Sets', icon: LayoutGridIcon }
]
const MORE: { page: Page; label: string; icon: LucideIcon }[] = [
  { page: 'browse', label: 'Browse', icon: SearchIcon },
  { page: 'friends', label: 'Friends', icon: UsersIcon },
  { page: 'settings', label: 'Settings', icon: SettingsIcon }
]
const IN_MORE = new Set<Page>(MORE.map((m) => m.page))

/** Once the app is ready: a sync, a daily card data check, the fingerprints, and persistent storage. */
function useReadyChecks(): void {
  const { store } = usePhone()
  const qc = useQueryClient()
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    // Asked once; the status line warns while it isn't granted.
    void navigator.storage?.persist?.().catch(() => false)
    void api.account.syncNow().catch(() => undefined)
    void store
      .updateCatalog()
      .then((changed) => {
        if (!changed) return
        for (const queryKey of mutationInvalidationKeys) void qc.invalidateQueries({ queryKey })
        void qc.invalidateQueries({ queryKey: ['card'] })
      })
      .catch(() => undefined)
    void store.refreshFingerprints().catch(() => undefined)
  }, [store, qc])
}

/**
 * The phone app once signed in and set up: the desktop's pages (the same page switch as the
 * desktop shell) above a bottom tab bar, with the status line at the top of each page. It opens
 * on Home. `engineFactory` is for tests.
 */
export function PhoneShell({
  engineFactory
}: {
  engineFactory?: () => ScanEngine
}): React.JSX.Element {
  const pages = usePages('dashboard')
  const { page, onNavigate } = pages
  const [moreOpen, setMoreOpen] = useState(false)
  const requests = useFriendsOverview().data?.incoming.length ?? 0
  useReadyChecks()

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
  // Each page opens at its top.
  useLayoutEffect(() => {
    scroll.set(0)
  }, [page, scroll])

  const scan = page === 'scan'
  const go = (next: Page): void => {
    setMoreOpen(false)
    onNavigate(next)
  }

  return (
    <div
      data-phone-shell
      className="fixed inset-0 isolate flex flex-col overflow-hidden bg-background text-foreground tabular-nums"
    >
      <ArtWash src={scan ? null : wash} />
      <main
        ref={mainRef}
        data-main-scroll
        className={cn(
          'min-h-0 flex-1',
          // The scanner is full screen and pads for the notch itself.
          scan
            ? 'overflow-hidden'
            : 'overflow-auto overscroll-contain pt-[env(safe-area-inset-top)]'
        )}
      >
        <ArtWashContext.Provider value={setWash}>
          <MainScrollContext.Provider value={scroll}>
            <PageSwitch
              pages={pages}
              scan={
                <ScannerScreen
                  engineFactory={engineFactory}
                  onClose={() => go('dashboard')}
                  onOpenSettings={() => go('settings')}
                />
              }
              settings={<Settings />}
            />
          </MainScrollContext.Provider>
        </ArtWashContext.Provider>
      </main>

      {/* Only there while something waits or fails; pb-7 keeps it clear of the raised Scan button. */}
      {!scan && (
        <StatusLine className="relative z-30 shrink-0 border-t border-white/[0.06] bg-background/90 pb-7 backdrop-blur-xl" />
      )}

      {/* The scanner is full screen; its × goes back to Home. */}
      <nav
        aria-label="Tabs"
        className={cn(
          'relative z-40 shrink-0 border-t border-white/[0.08] bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl',
          scan && 'hidden'
        )}
      >
        <div className="mx-auto grid h-16 max-w-lg grid-cols-5 items-end">
          {TABS.map(({ page: p, label, icon: Icon }) =>
            p === 'scan' ? (
              <button
                key={p}
                type="button"
                aria-label={label}
                aria-current={page === p ? 'page' : undefined}
                onClick={() => go(p)}
                className="flex h-full flex-col items-center justify-end gap-1 pb-2 text-[11px] font-medium"
              >
                <span
                  aria-hidden
                  className={cn(
                    '-mt-6 flex size-14 items-center justify-center rounded-full shadow-lg ring-4 ring-background transition-colors',
                    page === p ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground'
                  )}
                >
                  <Icon className="size-6" />
                </span>
                <span className={page === p ? 'text-foreground' : 'text-muted-foreground'}>
                  {label}
                </span>
              </button>
            ) : (
              <TabButton
                key={p}
                label={label}
                icon={Icon}
                current={page === p}
                onClick={() => go(p)}
              />
            )
          )}
          <TabButton
            label="More"
            icon={EllipsisIcon}
            current={IN_MORE.has(page)}
            badge={requests}
            onClick={() => setMoreOpen(true)}
          />
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl border-white/[0.08] pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
            <SheetDescription className="sr-only">More pages</SheetDescription>
          </SheetHeader>
          <div className="divide-y divide-white/[0.06] px-4">
            {MORE.map(({ page: p, label, icon: Icon }) => (
              <button
                key={p}
                type="button"
                aria-label={p === 'friends' && requests > 0 ? undefined : label}
                aria-current={page === p ? 'page' : undefined}
                onClick={() => go(p)}
                className="flex h-14 w-full items-center gap-4 text-left text-base active:bg-white/[0.06]"
              >
                <Icon aria-hidden className="size-5 text-muted-foreground" />
                {label}
                {p === 'friends' && requests > 0 && (
                  <span className="ml-auto rounded-full bg-primary px-2 text-xs font-semibold leading-5 text-primary-foreground">
                    <span className="sr-only">, </span>
                    {requests}
                    <span className="sr-only"> {requests === 1 ? 'request' : 'requests'}</span>
                  </span>
                )}
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      <PagesAddCard pages={pages} />
    </div>
  )
}

function TabButton({
  label,
  icon: Icon,
  current,
  badge = 0,
  onClick
}: {
  label: string
  icon: LucideIcon
  current: boolean
  badge?: number
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'relative flex h-full flex-col items-center justify-end gap-1 pb-2 text-[11px] font-medium transition-colors',
        current ? 'text-foreground' : 'text-muted-foreground'
      )}
    >
      <Icon aria-hidden className="size-6" />
      {label}
      {badge > 0 && (
        <span
          aria-hidden
          className="absolute left-1/2 top-2 ml-2 rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground"
        >
          {badge}
        </span>
      )}
    </button>
  )
}
