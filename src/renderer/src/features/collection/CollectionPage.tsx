import { useCallback, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { LayoutGrid, Table2 } from 'lucide-react'
import { LANGUAGES } from '@shared/languages'
import type { CollectionFilters, EntryView, Friend, SortKey } from '@shared/types'
import { cardArtUrl, useArtWash } from '@/components/artWashContext'
import { CardSheet } from '@/components/CardSheet'
import { FilterBar } from '@/components/FilterBar'
import { CardFilterSections, FilterPanel, LanguageSection } from '@/components/FilterPanel'
import { PageHeader } from '@/components/PageHeader'
import { listNav } from '@/components/panelNav'
import { SearchInput } from '@/components/SearchInput'
import { SortControl } from '@/components/SortControl'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, queryKeys } from '@/lib/api'
import {
  cardFilterChips,
  clearedFilters,
  facetsFor,
  languageChip,
  sortOptions
} from '@/lib/filters'
import { formatRelative } from '@/lib/format'
import { friendsErrorMessage } from '@/lib/friends'
import { useGame } from '@/lib/game'
import { DEFAULT_LANGUAGE, useLanguageFilter } from '@/lib/languageFilter'
import { isPhone } from '@/lib/platform'
import { rangeFilters } from '@/lib/rangeFilters'
import { useSetNames } from '@/lib/setLabels'
import { useFilterPanel } from '@/lib/useFilterPanel'
import { CollectionGrid } from './CollectionGrid'
import { CollectionTable } from './CollectionTable'
import { CardPanel } from '../card/CardPanel'
import { FriendEntryPanel } from '../friends/FriendEntryPanel'
import { DEFAULT_FILTERS } from './defaultFilters'

type View = 'grid' | 'table'
const VIEW_KEY = 'collection.view'

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'grid'
  } catch {
    return 'grid'
  }
}

const SORTS = sortOptions<SortKey>([
  { value: 'name', label: 'Name', kind: 'text', dir: 'asc' },
  { value: 'value', label: 'Total price', kind: 'number', dir: 'desc' },
  { value: 'unitPrice', label: 'Price', kind: 'number', dir: 'desc' },
  { value: 'quantity', label: 'Quantity', kind: 'number', dir: 'desc' },
  { value: 'added', label: 'Date added', kind: 'date', dir: 'desc' },
  { value: 'released', label: 'Release date', kind: 'date', dir: 'desc' }
])

const cardCount = (n: number): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? 'card' : 'cards'}`

interface Props {
  /** Opens this entry's detail panel on mount (dashboard "top entries" navigation). */
  initialEntryId?: number
  onAddCard?: () => void
  /** Shows this friend's collection read-only instead of your own. */
  friend?: Friend
  /** Whose binder this is, shown above a friend's collection. */
  /** Takes the entry count and view toggle when they fit on its tabs' row (not on the phone). */
  friendHeader?: (trailing?: React.ReactNode) => React.ReactNode
}

export function CollectionPage({
  initialEntryId,
  onAddCard,
  friend,
  friendHeader
}: Props): React.JSX.Element {
  const [pageFilters, setFilters] = useState<CollectionFilters>(DEFAULT_FILTERS)
  const [languageFilter, setLanguageFilter] = useLanguageFilter()
  // The language is the shared app-wide setting, not page state.
  const filters = useMemo<CollectionFilters>(
    () => ({ ...pageFilters, language: languageFilter === 'all' ? undefined : languageFilter }),
    [pageFilters, languageFilter]
  )
  const [storedView, setView] = useState<View>(readView)
  // The table needs desktop width, so the phone always shows the grid.
  const phone = isPhone()
  const view: View = phone ? 'grid' : storedView
  const panel = useFilterPanel()
  const [selectedId, setSelectedId] = useState<number | null>(initialEntryId ?? null)
  const [pickedCardId, setCardId] = useState<number | null>(null)

  const friendId = friend?.id
  const entries = useQuery({
    queryKey:
      friendId !== undefined
        ? queryKeys.friendEntries(friendId, filters)
        : queryKeys.entries(filters),
    queryFn: () =>
      friendId !== undefined
        ? api.friends.collection(friendId, filters)
        : api.collection.list(filters),
    placeholderData: keepPreviousData
  })
  const facets = useQuery({
    queryKey: friendId !== undefined ? queryKeys.friendFacets(friendId) : queryKeys.facets,
    queryFn: () => (friendId !== undefined ? api.friends.facets(friendId) : api.collection.facets())
  })
  const stats = useQuery({
    queryKey: queryKeys.stats,
    queryFn: () => api.stats.get(),
    enabled: !friend
  })
  const friendName = friend ? (friend.displayName ?? friend.username) : ''

  // An entry opened by id (initialEntryId) resolves its card once the list has loaded;
  // persist it so later filtering that excludes the entry does not unmount the panel.
  // The dashboard ranks every language, so an entry the language filter hides resolves
  // from the unfiltered list instead.
  const unfilteredEntries = useQuery({
    queryKey: queryKeys.entries(DEFAULT_FILTERS),
    queryFn: () => api.collection.list(DEFAULT_FILTERS),
    enabled: !friend && initialEntryId !== undefined && pickedCardId === null
  })
  const resolvedCardId =
    pickedCardId === null && selectedId !== null
      ? (
          entries.data?.find((e) => e.id === selectedId) ??
          unfilteredEntries.data?.find((e) => e.id === selectedId)
        )?.card.id
      : undefined
  if (resolvedCardId !== undefined) setCardId(resolvedCardId)
  const cardId = pickedCardId ?? resolvedCardId ?? null

  const onChange = useCallback(
    (patch: Partial<CollectionFilters>) => setFilters((f) => ({ ...f, ...patch })),
    []
  )
  const clearFilters = useCallback(() => {
    setFilters((f) => clearedFilters(f, DEFAULT_FILTERS))
    setLanguageFilter(DEFAULT_LANGUAGE)
  }, [setLanguageFilter])
  const changeSearch = useCallback(
    (q: string) => onChange({ q: q === '' ? undefined : q }),
    [onChange]
  )

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
  const close = (): void => {
    setSelectedId(null)
    setCardId(null)
  }

  const list = entries.data ?? []
  // A friend's open card lists all their copies, not just those the filters let through.
  const allFriendEntries = useQuery({
    queryKey: queryKeys.friendEntries(friendId ?? 0, DEFAULT_FILTERS),
    queryFn: () => api.friends.collection(friendId ?? 0, DEFAULT_FILTERS),
    enabled: friendId !== undefined && selectedId !== null
  })
  const selectedEntry =
    list.find((e) => e.id === selectedId) ??
    (friend ? allFriendEntries.data?.find((e) => e.id === selectedId) : undefined)
  // A failed background refetch keeps the cards already shown; a failed first load (or a load for
  // filters whose results never arrived) shows the error in their place.
  const friendLoadFailed =
    friend !== undefined &&
    entries.isError &&
    (entries.data === undefined || entries.isPlaceholderData)
  const nav = listNav(
    list,
    list.findIndex((e) => e.id === selectedId),
    select,
    (e) => e.id
  )
  // The collection tints the page with its first card in the current order.
  useArtWash(list[0] ? cardArtUrl(list[0].imageId) : null)
  const { def } = useGame()
  const setNames = useSetNames(languageFilter)
  const facetList = facetsFor(def)
  const ranges = rangeFilters(def.filters)
  const cardChips = cardFilterChips(filters, facetList, ranges, setNames.labelOf, onChange)
  const chips = [...languageChip(languageFilter, setLanguageFilter), ...cardChips]
  const filtered = Boolean(filters.q) || cardChips.length > 0
  // Entries exist, but the language filter alone hides them all.
  const hiddenByLanguage =
    !filtered &&
    languageFilter !== 'all' &&
    (friend ? friend.cardCount > 0 : (stats.data?.uniqueCards ?? 0) > 0)
  const languageLabel = LANGUAGES.find((l) => l.code === languageFilter)?.label ?? ''
  const entryCount = (
    <p className="text-sm text-muted-foreground tabular-nums">
      {list.length} {list.length === 1 ? 'entry' : 'entries'}
      {!friend && <> · Prices updated {formatRelative(stats.data?.pricesUpdatedAt ?? null)}</>}
    </p>
  )
  const viewToggle = (
    <ToggleGroup type="single" variant="outline" value={view} onValueChange={changeView}>
      <ToggleGroupItem value="grid" aria-label="Grid view">
        <LayoutGrid />
      </ToggleGroupItem>
      <ToggleGroupItem value="table" aria-label="Table view">
        <Table2 />
      </ToggleGroupItem>
    </ToggleGroup>
  )
  const inFriendHeader = !!friendHeader && !phone

  return (
    <TooltipProvider>
      <div className="flex items-start">
        <div className="min-w-0 flex-1 space-y-4 p-8 max-md:p-4">
          <PageHeader>
            {friendHeader?.(
              inFriendHeader && (
                <>
                  {entryCount}
                  {viewToggle}
                </>
              )
            )}
            {!inFriendHeader && (
              <header className="flex flex-wrap items-end justify-between gap-2 max-md:flex-col max-md:items-start">
                <div>
                  {!friend && <h1 className="text-xl font-semibold">Collection</h1>}
                  {entryCount}
                </div>
              </header>
            )}

            <FilterBar
              sizable
              search={
                <SearchInput
                  label="Search collection"
                  placeholder="Search collection by name or set code"
                  value={filters.q ?? ''}
                  onChange={changeSearch}
                />
              }
              filtersOpen={panel.open}
              onToggleFilters={() => panel.setOpen(!panel.open)}
              sort={
                <SortControl
                  options={SORTS}
                  value={filters.sort}
                  dir={filters.dir}
                  onChange={(sort, dir) => onChange({ sort, dir })}
                />
              }
              toggle={!phone && !inFriendHeader && viewToggle}
              chips={chips}
              onClearAll={clearFilters}
              resultCount={cardCount(list.length)}
            />
          </PageHeader>

          {friend && entries.isError && !friendLoadFailed && (
            <p role="alert" className="mb-3 text-sm text-muted-foreground">
              Couldn&apos;t refresh {friendName}&apos;s collection:{' '}
              {friendsErrorMessage(entries.error)}
            </p>
          )}
          {friendLoadFailed && entries.isError ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              <p role="alert" className="text-sm text-muted-foreground">
                {friendsErrorMessage(entries.error)}
              </p>
              <Button variant="outline" onClick={() => void entries.refetch()}>
                Retry
              </Button>
            </div>
          ) : entries.isSuccess && list.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              {hiddenByLanguage ? (
                <>
                  <p className="text-lg font-medium">No {languageLabel} cards</p>
                  <Button variant="outline" onClick={() => setLanguageFilter('all')}>
                    Show all languages
                  </Button>
                </>
              ) : filtered ? (
                <>
                  <p className="text-lg font-medium">No cards match these filters</p>
                  {chips.length > 0 ? (
                    <Button variant="outline" onClick={clearFilters}>
                      Clear all
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => changeSearch('')}>
                      Clear search
                    </Button>
                  )}
                </>
              ) : friend ? (
                <p className="text-lg font-medium">{friendName} hasn&apos;t added any cards yet</p>
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

          {friend && selectedEntry && (
            <CardSheet onClose={close}>
              <FriendEntryPanel
                entry={selectedEntry}
                copies={(allFriendEntries.data ?? list).filter(
                  (e) => e.card.id === selectedEntry.card.id
                )}
                onSelectEntry={setSelectedId}
                nav={nav}
              />
            </CardSheet>
          )}
          {!friend && selectedId !== null && cardId !== null && (
            <CardSheet onClose={close}>
              <CardPanel
                cardId={cardId}
                entryId={selectedId}
                onSelectEntry={setSelectedId}
                onClose={close}
                nav={nav}
              />
            </CardSheet>
          )}
        </div>
        <FilterPanel
          wide={panel.wide}
          open={panel.open}
          onOpenChange={panel.setOpen}
          description="Filter the collection"
          onClearAll={chips.length > 0 ? clearFilters : undefined}
        >
          <LanguageSection
            value={languageFilter}
            onChange={setLanguageFilter}
            available={facets.data?.languages ?? []}
          />
          <CardFilterSections
            facetList={facetList}
            ranges={ranges}
            filters={filters}
            options={(key) => {
              if (key === 'races') return []
              const options = facets.data?.[key] ?? []
              return key === 'setNames' ? options.filter(setNames.inLanguage) : options
            }}
            setLabelOf={setNames.labelOf}
            onChange={onChange}
          />
        </FilterPanel>
      </div>
    </TooltipProvider>
  )
}
