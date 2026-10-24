import { LayoutDashboard, Library, Plus, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SyncBanner } from './SyncBanner'

export type Page = 'dashboard' | 'collection' | 'settings'
export type NavigateFn = (page: Page, opts?: { entryId?: number }) => void

const NAV = [
  { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { page: 'collection', label: 'Collection', icon: Library },
  { page: 'settings', label: 'Settings', icon: Settings }
] as const

interface AppShellProps {
  page: Page
  onNavigate: NavigateFn
  onAddCard: () => void
  children: React.ReactNode
}

export function AppShell({ page, onNavigate, onAddCard, children }: AppShellProps): React.JSX.Element {
  return (
    <div className="flex h-screen bg-background text-foreground tabular-nums">
      <aside className="flex w-[220px] shrink-0 flex-col gap-4 border-r p-3">
        <div className="px-2 pt-2 text-sm font-semibold leading-tight tracking-tight">
          Yugioh Collection Tracker
        </div>
        <Button onClick={onAddCard} className="justify-start gap-2">
          <Plus className="size-4" aria-hidden />
          Add card
          <kbd className="ml-auto text-xs font-normal opacity-70">Ctrl K</kbd>
        </Button>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {NAV.map(({ page: p, label, icon: Icon }) => (
            <button
              key={p}
              type="button"
              aria-current={page === p ? 'page' : undefined}
              onClick={() => onNavigate(p)}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
                page === p && 'bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary'
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <SyncBanner />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
