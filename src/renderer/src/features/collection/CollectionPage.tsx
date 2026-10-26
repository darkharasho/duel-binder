import { useCallback, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { LayoutGrid, Table2 } from 'lucide-react'
import { LANGUAGES } from '@shared/languages'
import type { CollectionFilters, EntryView, Friend, SortKey } from '@shared/types'
import { cardArtUrl, useArtWash } from '@/components/artWashContext'
import { CardSheet } from '@/components/CardSheet'
import { PageHeader } from '@/components/PageHeader'
import { listNav } from '@/components/panelNav'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, queryKeys } from '@/lib/api'
import { formatRelative } from '@/lib/format'
import { friendsErrorMessage } from '@/lib/friends'
import { useLanguageFilter } from '@/lib/languageFilter'
import { CollectionGrid } from './CollectionGrid'
import { CollectionTable } from './CollectionTable'
import { EntryDetailPanel } from './EntryDetailPanel'
import { FriendEntryPanel } from '../friends/FriendEntryPanel'
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
  /** Shows this friend's collection read-only instead of your own. */
  friend?: Friend
  onBackToMine?: () => void
}

export function CollectionPage({
  initialEntryId,
  onAddCard,
  friend,
  onBackToMine
}: Props): React.JSX.Element {
  const [pageFilters, setFilters] = useState<CollectionFilters>(DEFAULT_FILTERS)
  const [languageFilter, setLanguageFilter] = useLanguageFilter()
  // The language is the shared app-wide setting, not page state.
  const filters = useMemo<CollectionFilters>(
    () => ({ ...pageFilters, language: languageFilter === 'all' ? undefined : languageFilter }),
    [pageFilters, languageFilter]
  )
  const [view, setView] = useState<View>(readView)
  const [selectedId, setSelectedId] = useState<number | null>(initialEntryId ?? null)
  const [resetCount, setResetCount] = useState(0)
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
  const close = (): void => {
    setSelectedId(null)
    setCardId(null)
  }

  const list = entries.data ?? []
  const selectedEntry = list.find((e) => e.id === selectedId)
  const nav = listNav(
    list,
    list.findIndex((e) => e.id === selectedId),
    select,
    (e) => e.id
  )
  // The collection tints the page with its first card in the current order.
  useArtWash(list[0] ? cardArtUrl(list[0].imageId) : null)
  const filtered = hasActiveFilters(filters)
  // Entries exist, but the language filter alone hides them all.
  const hiddenByLanguage =
    !filtered &&
    languageFilter !== 'all' &&
    (friend ? friend.cardCount > 0 : (stats.data?.uniqueCards ?? 0) > 0)
  const languageLabel = LANGUAGES.find((l) => l.code === languageFilter)?.label ?? ''

  return (
    <TooltipProvider>
      <div className="space-y-4 p-8">
        <PageHeader>
          <header className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold">
                {friend ? `${friendName}'s collection` : 'Collection'}
              </h1>
              <p className="text-sm text-muted-foreground tabular-nums">
                {list.length} {list.length === 1 ? 'entry' : 'entries'}
                {!friend && (
                  <> · Prices updated {formatRelative(stats.data?.pricesUpdatedAt ?? null)}</>
                )}
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

          {friend && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">
                Viewing {friendName}&apos;s collection
              </p>
              <Button variant="outline" size="sm" onClick={onBackToMine}>
                Back to mine
              </Button>
            </div>
          )}

          <FilterBar
            key={resetCount}
            filters={filters}
            facets={facets.data}
            onChange={onChange}
            onClear={clear}
          />
        </PageHeader>

        {friend && entries.isError ? (
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
                <Button variant="outline" onClick={clear}>
                  Clear filters
                </Button>
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
              copies={list.filter((e) => e.card.id === selectedEntry.card.id)}
              onSelectEntry={setSelectedId}
              nav={nav}
            />
          </CardSheet>
        )}
        {!friend && selectedId !== null && cardId !== null && (
          <CardSheet onClose={close}>
            <EntryDetailPanel
              cardId={cardId}
              entryId={selectedId}
              onSelectEntry={setSelectedId}
              onClose={close}
              nav={nav}
            />
          </CardSheet>
        )}
      </div>
    </TooltipProvider>
  )
}
