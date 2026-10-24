import { useCallback, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { LayoutGrid, Table2 } from 'lucide-react'
import type { CollectionFilters, EntryView, SortKey } from '@shared/types'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, queryKeys } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import { useLanguageFilter } from '@/lib/languageFilter'
import { CollectionGrid } from './CollectionGrid'
import { CollectionTable } from './CollectionTable'
import { EntryDetailPanel } from './EntryDetailPanel'
import { FilterBar } from './FilterBar'

type View = 'grid' | 'table'
const VIEW_KEY = 'collection.view'
const DEFAULT_FILTERS: CollectionFilters = { sort: 'added', dir: 'desc' }

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'grid'
  } catch {
    return 'grid'
  }
}

function hasActiveFilters(f: CollectionFilters): boolean {
  return Boolean(
    f.q ||
    f.cardTypes?.length ||
    f.attributes?.length ||
    f.archetypes?.length ||
    f.setNames?.length ||
    f.rarities?.length ||
    f.levelMin !== undefined ||
    f.levelMax !== undefined
  )
}

interface Props {
  /** Opens this entry's detail panel on mount (dashboard "top entries" navigation). */
  initialEntryId?: number
  onAddCard?: () => void
}

export function CollectionPage({ initialEntryId, onAddCard }: Props): React.JSX.Element {
  const [pageFilters, setFilters] = useState<CollectionFilters>(DEFAULT_FILTERS)
  const [languageFilter] = useLanguageFilter()
  // The language is the shared app-wide setting, not page state.
  const filters = useMemo<CollectionFilters>(
    () => ({ ...pageFilters, language: languageFilter === 'all' ? undefined : languageFilter }),
    [pageFilters, languageFilter]
  )
  const [view, setView] = useState<View>(readView)
  const [selectedId, setSelectedId] = useState<number | null>(initialEntryId ?? null)
  const [resetCount, setResetCount] = useState(0)
  const [pickedCardId, setCardId] = useState<number | null>(null)

  const entries = useQuery({
    queryKey: queryKeys.entries(filters),
    queryFn: () => api.collection.list(filters),
    placeholderData: keepPreviousData
  })
  const facets = useQuery({ queryKey: queryKeys.facets, queryFn: () => api.collection.facets() })
  const stats = useQuery({ queryKey: queryKeys.stats, queryFn: () => api.stats.get() })

  // An entry opened by id (initialEntryId) resolves its card once the list has loaded;
  // persist it so later filtering that excludes the entry does not unmount the panel.
  const resolvedCardId =
    pickedCardId === null && selectedId !== null
      ? entries.data?.find((e) => e.id === selectedId)?.card.id
      : undefined
  if (resolvedCardId !== undefined) setCardId(resolvedCardId)
  const cardId = pickedCardId ?? resolvedCardId ?? null

  const onChange = useCallback(
    (patch: Partial<CollectionFilters>) => setFilters((f) => ({ ...f, ...patch })),
    []
  )
  // Bumping resetCount remounts FilterBar so its local search text resets too.
  const clear = useCallback(() => {
    setFilters(DEFAULT_FILTERS)
    setResetCount((n) => n + 1)
  }, [])

  const changeView = (v: string): void => {
    if (v !== 'grid' && v !== 'table') return
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* storage unavailable: view just isn't remembered */
    }
  }

  const onSort = (key: SortKey): void =>
    setFilters((f) =>
      f.sort === key
        ? { ...f, dir: f.dir === 'asc' ? 'desc' : 'asc' }
        : { ...f, sort: key, dir: key === 'name' ? 'asc' : 'desc' }
    )

  const select = (e: EntryView): void => {
    setSelectedId(e.id)
    setCardId(e.card.id)
  }

  const list = entries.data ?? []
  const filtered = hasActiveFilters(filters)

  return (
    <TooltipProvider>
      <div className="space-y-4 p-8">
        <header className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">Collection</h1>
            <p className="text-sm text-muted-foreground tabular-nums">
              {list.length} {list.length === 1 ? 'entry' : 'entries'} · Prices updated{' '}
              {formatRelative(stats.data?.pricesUpdatedAt ?? null)}
            </p>
          </div>
          <ToggleGroup type="single" variant="outline" value={view} onValueChange={changeView}>
            <ToggleGroupItem value="grid" aria-label="Grid view">
              <LayoutGrid />
            </ToggleGroupItem>
            <ToggleGroupItem value="table" aria-label="Table view">
              <Table2 />
            </ToggleGroupItem>
          </ToggleGroup>
        </header>

        <FilterBar
          key={resetCount}
          filters={filters}
          facets={facets.data}
          onChange={onChange}
          onClear={clear}
        />

        {entries.isSuccess && list.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            {filtered ? (
              <>
                <p className="text-lg font-medium">No cards match these filters</p>
                <Button variant="outline" onClick={clear}>
                  Clear filters
                </Button>
              </>
            ) : (
              <>
                <p className="text-lg font-medium">No cards yet</p>
                <Button onClick={onAddCard}>Add card</Button>
              </>
            )}
          </div>
        ) : view === 'grid' ? (
          <CollectionGrid entries={list} selectedId={selectedId} onSelect={select} />
        ) : (
          <CollectionTable
            entries={list}
            selectedId={selectedId}
            sort={filters.sort}
            dir={filters.dir}
            onSort={onSort}
            onSelect={select}
          />
        )}

        {selectedId !== null && cardId !== null && (
          <EntryDetailPanel
            cardId={cardId}
            entryId={selectedId}
            onSelectEntry={setSelectedId}
            onClose={() => {
              setSelectedId(null)
              setCardId(null)
            }}
          />
        )}
      </div>
    </TooltipProvider>
  )
}
