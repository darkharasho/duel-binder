import { SlidersHorizontal } from 'lucide-react'
import { FilterChip } from '@/components/FilterChip'
import { Button } from '@/components/ui/button'
import type { ActiveChip } from '@/lib/filters'

/**
 * The bar every list page shares. Row 1: search, Filters, sort, then the page's own toggle. Row 2,
 * only with something active: the removable chips, Clear all and the result count. It never
 * wraps, so a sticky header stays two rows: a long run of chips scrolls sideways. Its controls
 * size to the bar rather than the window, since an open side panel narrows the bar too.
 */
export function FilterBar({
  search,
  filtersOpen,
  onToggleFilters,
  sort,
  toggle,
  chips = [],
  onClearAll,
  resultCount
}: {
  search?: React.ReactNode
  filtersOpen?: boolean
  /** Left out where the page has nothing to filter by. */
  onToggleFilters?: () => void
  sort?: React.ReactNode
  toggle?: React.ReactNode
  chips?: ActiveChip[]
  /** Clears the filters; the search and sort stay. */
  onClearAll?: () => void
  /** "1,204 cards". */
  resultCount?: string
}): React.JSX.Element {
  const active = chips.length
  return (
    <div className="@container space-y-2">
      <div className="flex items-center gap-2">
        <div className="min-w-28 flex-1">{search}</div>
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
