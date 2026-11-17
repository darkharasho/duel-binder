import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  BookOpenIcon,
  CircleDotIcon,
  EllipsisIcon,
  HeartIcon,
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
import { ArtWashContext, createWashStore, type WashStore } from '@/components/artWashContext'
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
import { AccountNotices } from '@/features/account/AccountNotices'
import type { EngineFactory } from '@/features/scan/engine'
import { GameSegments } from '@/components/GameSwitch'
import { api, mutationInvalidationKeys } from '@/lib/api'
import { useFriendsOverview } from '@/lib/friends'
import { GameProvider, pageInGame, useGame } from '@/lib/game'
import type { GameId } from '@shared/games'
import { cn } from '@/lib/utils'
import { useBackHandler } from './backButton'
import { usePhone } from './context'
import type { PhoneStore } from './data/store'
import { refreshAllFingerprints } from './refreshFingerprints'
import { ScannerScreen } from './ScannerScreen'
import { Settings } from './Settings'
import { StatusLine } from './StatusLine'
import { useReloadAsGamesLand } from './useCatalogStatus'
import { ContributeScreen } from './training/ContributeScreen'
import { trainingOutbox } from './training/outbox'
import { UpdateBanner } from './UpdateBanner'
import { useHomeIdleSwitch } from './liveUpdateSwitch'

const TABS: { page: Page; label: string; icon: LucideIcon }[] = [
  { page: 'dashboard', label: 'Home', icon: HouseIcon },
  { page: 'collection', label: 'Collection', icon: LibraryIcon },
  { page: 'scan', label: 'Scan', icon: ScanLineIcon },
  { page: 'sets', label: 'Sets', icon: LayoutGridIcon }
]
const MORE: { page: Page; label: string; icon: LucideIcon }[] = [
  { page: 'binders', label: 'Binders', icon: BookOpenIcon },
  { page: 'pokedex', label: 'Pokédex', icon: CircleDotIcon },
  { page: 'wishlist', label: 'Wishlist', icon: HeartIcon },
  { page: 'browse', label: 'Browse', icon: SearchIcon },
  { page: 'friends', label: 'Friends', icon: UsersIcon },
  { page: 'settings', label: 'Settings', icon: SettingsIcon }
]
/** The tab bar's grid by column count: the tabs plus More (5 with Scan, 4 without). */
const GRID_COLS: Record<number, string> = { 4: 'grid-cols-4', 5: 'grid-cols-5' }
const IN_MORE = new Set<Page>(MORE.map((m) => m.page))

/** Sends any training photos (and deletes) waiting from earlier; never throws. */
function drainTraining(store: PhoneStore, userId: number): void {
  // No IndexedDB (jsdom, or a browser that lacks it): nothing can be waiting.
  if (typeof indexedDB === 'undefined') return
  try {
    void trainingOutbox()
      .drain(userId, {
        upload: (id, label, jpeg) => store.trainingUpload(id, label, jpeg),
        remove: (id) => store.trainingDelete(id)
      })
      .catch(() => undefined)
  } catch {
    // Best effort: the next start or the next time online tries again.
  }
}

/**
 * Once the app is ready: a sync, the card data still to come down (the account's other games after
 * first run) and the daily check, the fingerprints, persistent storage and the training photo
 * outbox. The card data and the outbox go on again whenever the phone comes back online.
 */
function useReadyChecks(): void {
  const { store, user } = usePhone()
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
    void refreshAllFingerprints(store).catch(() => undefined)
    drainTraining(store, user.id)
  }, [store, qc, user.id])
  useReloadAsGamesLand()
  useEffect(() => {
    const online = (): void => {
      drainTraining(store, user.id)
      // A download cut off by going offline picks up where it stopped.
      void store.updateCatalog().catch(() => undefined)
    }
    window.addEventListener('online', online)
    return () => window.removeEventListener('online', online)
  }, [store, user.id])
}

/**
 * The phone app once signed in and set up: the desktop's pages (the same page switch as the
 * desktop shell) above a bottom tab bar, with the status line at the top of each page. It opens
 * on Home, once the game shown is known. `engineFactory` is for tests.
 */
export function PhoneShell({
  engineFactory
}: {
  engineFactory?: EngineFactory
}): React.JSX.Element {
  return (
    <GameProvider fallback={<div className="fixed inset-0 bg-background" />}>
      <Shell engineFactory={engineFactory} />
    </GameProvider>
  )
}

function Shell({ engineFactory }: { engineFactory?: EngineFactory }): React.JSX.Element {
  const pages = usePages('dashboard')
  const { page, onNavigate } = pages
  const [moreOpen, setMoreOpen] = useState(false)
  const requests = useFriendsOverview().data?.incoming.length ?? 0
  const { game, def, available, setGame } = useGame()
  // Scan only for a game that has it; on Pokémon the raised Scan tab goes.
  const tabs = TABS.filter((t) => pageInGame(t.page, def))
  const more = MORE.filter((m) => pageInGame(m.page, def))
  useReadyChecks()
  useHomeIdleSwitch(page)
  // A switch to a game without this page (Scan) goes Home.
  useEffect(() => {
    if (!pageInGame(page, def)) onNavigate('dashboard')
  }, [page, def, onNavigate])

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
  // Held outside the shell's state: a page's wash pick re-renders only the wash, not the page.
  const [washStore] = useState(createWashStore)
  // Each page opens at its top.
  useLayoutEffect(() => {
    scroll.set(0)
  }, [page, scroll])

  const scan = page === 'scan'
  const go = (next: Page): void => {
    setMoreOpen(false)
    onNavigate(next)
  }
  // Android's back from any other page (the scanner included) goes Home; from Home it leaves.
  useBackHandler(page !== 'dashboard', () => go('dashboard'))

  // Training photos for a tester game. Held here, outside the page switch's per-game remount, so
  // the switch to that game doesn't drop it.
  // Closing goes back to the game shown before, so a tester isn't left in the hidden game.
  const [contribute, setContribute] = useState<GameId | null>(null)
  const returnGame = useRef<GameId | null>(null)
  const openContribute = async (g: GameId): Promise<void> => {
    returnGame.current = g === game ? null : game
    await setGame(g)
    setContribute(g)
  }
  const closeContribute = (): void => {
    setContribute(null)
    const back = returnGame.current
    returnGame.current = null
    if (back !== null) void setGame(back)
  }
  // Registered after the page's, so back closes the screen first.
  useBackHandler(contribute !== null, closeContribute)

  return (
    <div
      data-phone-shell
      className="fixed inset-0 isolate flex flex-col overflow-hidden bg-background text-foreground tabular-nums"
    >
      <ShellWash store={washStore} enabled={!scan} />
      <main
        ref={mainRef}
        data-main-scroll
        className={cn(
          'min-h-0 flex-1',
          // The scanner is full screen and pads for the notch itself. Elsewhere the scroll box
          // starts below the status bar, which the iOS app draws over the page: cards scrolling up
          // stop at its edge, and the wash (fixed to the whole window) shows behind the clock.
          scan
            ? 'overflow-hidden'
            : 'mt-[env(safe-area-inset-top)] overflow-auto overscroll-contain'
        )}
      >
        <ArtWashContext.Provider value={washStore.set}>
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
              settings={<Settings onContribute={(g) => void openContribute(g)} />}
            />
          </MainScrollContext.Provider>
        </ArtWashContext.Provider>
      </main>

      {contribute !== null && (
        <div className="fixed inset-0 z-50">
          <ContributeScreen
            game={contribute}
            onClose={closeContribute}
            engineFactory={engineFactory}
          />
        </div>
      )}

      {/* The Android APK's newer version, when there is one. */}
      {!scan && <UpdateBanner />}
      {!scan && <AccountNotices />}

      {/* Only there while something waits or fails; pb-7 keeps it clear of the raised Scan button. */}
      {!scan && <StatusLine className="relative z-30 shrink-0 pb-7" />}

      {/* The scanner is full screen; its × goes back to Home. */}
      <nav
        aria-label="Tabs"
        className={cn('relative z-40 shrink-0 pb-[env(safe-area-inset-bottom)]', scan && 'hidden')}
      >
        <div className={cn('mx-auto grid h-16 max-w-lg items-end', GRID_COLS[tabs.length + 1])}>
          {tabs.map(({ page: p, label, icon: Icon }) =>
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
                    '-mt-6 flex size-14 items-center justify-center rounded-full shadow-lg transition-colors',
                    page === p ? 'bg-chip-on text-chip-on-ink' : 'bg-chip text-foreground'
                  )}
                >
                  <Icon className="size-6" />
                </span>
                <span className={page === p ? 'font-semibold' : undefined}>{label}</span>
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
          className="rounded-t-3xl border-0 bg-popover pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
            <SheetDescription className="sr-only">More pages</SheetDescription>
          </SheetHeader>
          {available.length > 1 && (
            <div className="px-4 pb-2">
              <GameSegments />
            </div>
          )}
          <div className="px-4">
            {more.map(({ page: p, label, icon: Icon }) => (
              <button
                key={p}
                type="button"
                aria-label={p === 'friends' && requests > 0 ? undefined : label}
                aria-current={page === p ? 'page' : undefined}
                onClick={() => go(p)}
                className="flex h-14 w-full items-center gap-4 text-left text-base active:bg-chip"
              >
                <Icon aria-hidden className="size-5" />
                {label}
                {p === 'friends' && requests > 0 && (
                  <span className="ml-auto rounded-full bg-chip-on px-2 font-mono text-xs font-semibold leading-5 text-chip-on-ink">
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

/** The art wash, reading the store the pages set. */
function ShellWash({ store, enabled }: { store: WashStore; enabled: boolean }): React.JSX.Element {
  const wash = useSyncExternalStore(store.subscribe, store.get)
  return <ArtWash wash={wash} enabled={enabled} />
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
        current && 'font-semibold'
      )}
    >
      <Icon aria-hidden className="size-6" />
      {label}
      {current && (
        <span aria-hidden className="absolute bottom-0.5 h-1 w-5 rounded-full bg-foreground" />
      )}
      {badge > 0 && (
        <span
          aria-hidden
          className="absolute left-1/2 top-2 ml-2 rounded-full bg-chip-on px-1.5 font-mono text-[10px] font-semibold leading-4 text-chip-on-ink"
        >
          {badge}
        </span>
      )}
    </button>
  )
}
