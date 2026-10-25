import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import logo from '@/assets/logo.png'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ArtWash } from './ArtWash'
import { ArtWashContext } from './artWashContext'
import { MainScrollContext, type MainScroll } from './mainScroll'
import { SyncBanner } from './SyncBanner'
import { TitleBar } from './TitleBar'

export type Page = 'dashboard' | 'collection' | 'browse' | 'sets' | 'settings'
export type NavigateFn = (page: Page, opts?: { entryId?: number }) => void

const NAV = [
  { page: 'dashboard', label: 'Dashboard' },
  { page: 'collection', label: 'Collection' },
  { page: 'browse', label: 'Browse' },
  { page: 'sets', label: 'Sets' },
  { page: 'settings', label: 'Settings' }
] as const

interface AppShellProps {
  page: Page
  onNavigate: NavigateFn
  onAddCard: () => void
  children: React.ReactNode
}

export function AppShell({ page, onNavigate, onAddCard, children }: AppShellProps): React.JSX.Element {
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
  // Each page opens at its top, not wherever the previous page was scrolled to.
  useLayoutEffect(() => {
    scroll.set(0)
  }, [page, scroll])
  return (
    <div className="group/shell relative isolate flex h-screen flex-col overflow-hidden bg-background text-foreground tabular-nums">
      <ArtWash src={wash} />
      {/* Carries a page header's glass up to the top of the window, so it doesn't float as a box. */}
      <div
        aria-hidden
        className="absolute left-[199px] right-0 top-0 hidden h-9 border-l border-white/[0.06] bg-background/60 backdrop-blur-xl group-has-[[data-page-header]]/shell:block"
      />
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[200px] shrink-0 flex-col gap-6 border-r border-white/[0.06] px-4 pb-5 pt-1">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="" className="h-9 w-auto" />
            <span className="text-[13px] font-semibold leading-tight">
              Yugioh
              <br />
              Collection Tracker
            </span>
          </div>
          <nav aria-label="Main" className="flex flex-col">
            {NAV.map(({ page: p, label }) => (
              <button
                key={p}
                type="button"
                aria-current={page === p ? 'page' : undefined}
                onClick={() => onNavigate(p)}
                className={cn(
                  'flex items-center gap-2 rounded-sm py-1.5 text-left text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
                  page === p && 'font-semibold text-foreground'
                )}
              >
                <span
                  aria-hidden
                  className={cn('size-1.5 rounded-full', page === p ? 'bg-foreground' : 'bg-transparent')}
                />
                {label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            onClick={onAddCard}
            className="flex items-center justify-between rounded-md border border-white/20 px-3 py-1.5 text-sm font-semibold transition-colors hover:border-white/40 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-ring"
          >
            Add card
            <kbd className="font-mono text-xs font-normal text-muted-foreground">
              {api.window.platform === 'darwin' ? '⌘K' : 'Ctrl K'}
            </kbd>
          </button>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <SyncBanner />
          <main ref={mainRef} data-main-scroll className="min-h-0 flex-1 overflow-auto">
            <ArtWashContext.Provider value={setWash}>
              <MainScrollContext.Provider value={scroll}>{children}</MainScrollContext.Provider>
            </ArtWashContext.Provider>
          </main>
        </div>
      </div>
    </div>
  )
}
