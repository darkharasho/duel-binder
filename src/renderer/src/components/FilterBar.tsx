import { CardSizePicker } from './CardSizePicker'
import { SlidersHorizontal } from 'lucide-react'
import { FilterChip } from '@/components/FilterChip'
import { Button } from '@/components/ui/button'
import type { ActiveChip } from '@/lib/filters'
import { isPhone } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { usePinned } from './pageHeaderContext'

/**
 * The bar every list page shares. Row 1: search, Filters, sort, then the page's own toggle. Row 2,
 * only with something active: the removable chips, Clear all and the result count. On desktop
 * it never wraps, so the pinned header row stays two rows: a long run of chips scrolls sideways. On a
 * phone the search takes its own line above the buttons. Its controls
 * size to the bar rather than the window, since an open side panel narrows the bar too.
 */
export function FilterBar({
  search,
  filtersOpen,
  onToggleFilters,
  sort,
  toggle,
  sizable,
  chips = [],
  onClearAll,
  resultCount,
  lead
}: {
  search?: React.ReactNode
  filtersOpen?: boolean
  /** Left out where the page has nothing to filter by. */
  onToggleFilters?: () => void
  sort?: React.ReactNode
  toggle?: React.ReactNode
  /** Offers the card size, for a page of card tiles. */
  sizable?: boolean
  chips?: ActiveChip[]
  /** Clears the filters; the search and sort stay. */
  onClearAll?: () => void
  /** "1,204 cards". */
  resultCount?: string
  /** Shown before the search only while the bar is pinned at the top, e.g. a Back button. */
  lead?: React.ReactNode
}): React.JSX.Element {
  const pinned = usePinned()
  const active = chips.length
  // On a phone the search takes its own full-width line; the buttons share the line below.
  const phone = isPhone()
  return (
    <div data-pin className="@container space-y-2">
      <div className={cn('flex items-center gap-2', phone && 'flex-wrap')}>
        {pinned && lead}
        <div className={cn('min-w-28 flex-1', phone && 'min-w-40 basis-full')}>{search}</div>
        {onToggleFilters && (
          <Button
            variant={active > 0 ? 'default' : 'outline'}
            aria-label={active > 0 ? `Filters, ${active} active` : 'Filters'}
            aria-expanded={filtersOpen}
            onClick={onToggleFilters}
          >
            <SlidersHorizontal />
            Filters
            {active > 0 && (
              <span className="rounded-sm bg-primary-foreground/20 px-1.5 text-xs tabular-nums">
                {active}
              </span>
            )}
          </Button>
        )}
        {sort}
        {sizable && <CardSizePicker />}
        {toggle}
      </div>
      {active > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
            {chips.map((c) => (
              <FilterChip key={c.key} label={c.label} onRemove={c.onRemove} />
            ))}
          </div>
          <Button variant="ghost" size="xs" className="h-7 shrink-0" onClick={onClearAll}>
            Clear all
          </Button>
          {resultCount !== undefined && (
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
              {resultCount}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
