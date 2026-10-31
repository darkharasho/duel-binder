import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LayoutGrid, List } from 'lucide-react'
import type { GameId } from '@shared/games'
import type { Language } from '@shared/languages'
import type { CardSearchResult, CountMode, SetSummary } from '@shared/types'
import { SET_TYPES, type SetType } from '@shared/setTypes'
import { coverArtUrl, setArtUrl, useArtWash } from '@/components/artWashContext'
import { FilterBar } from '@/components/FilterBar'
import { useMainScroll } from '@/components/mainScroll'
import { PageHeader } from '@/components/PageHeader'
import { SearchInput } from '@/components/SearchInput'
import { SortControl } from '@/components/SortControl'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, queryKeys } from '@/lib/api'
import { languageChip, type ActiveChip, type SortOption } from '@/lib/filters'
import { useGame } from '@/lib/game'
import { matchesLanguage, useLanguageFilter } from '@/lib/languageFilter'
import { isPhone } from '@/lib/platform'
import { useFilterPanel } from '@/lib/useFilterPanel'
import { SetChecklist } from './SetChecklist'
import { SetsFilterPanel } from './SetsFilterPanel'
import { SetsList } from './SetsList'
import { UpcomingSets } from './UpcomingSets'
import { useUpcomingCutoff } from './useUpcomingCutoff'
import {
  filterSets,
  setsHeader,
  sortSets,
  splitUpcoming,
  typeCounts,
  type SetFilter,
  type SetSort
} from './setsView'

type View = 'grid' | 'list'
const VIEW_KEY = 'sets.view'
const MODE_KEY = 'sets.countMode'
const FILTER_KEY = 'sets.filter'
/** Set types are each game's own, so each game keeps its own; Yu-Gi-Oh! keeps the original key. */
const typesKey = (game: GameId): string => (game === 'ygo' ? 'sets.types' : `sets.types:${game}`)
const UPCOMING_KEY = 'sets.upcomingOpen'

const SORTS: SortOption<SetSort>[] = [
  { value: 'date', dir: 'desc', label: 'Date: newest first' },
  { value: 'complete', dir: 'desc', label: 'Completion: high to low' },
  { value: 'name', dir: 'asc', label: 'Name: A to Z' }
]

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

function readMode(): CountMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'rarities' ? 'rarities' : 'cards'
  } catch {
    return 'cards'
  }
}

function readFilter(): SetFilter {
  try {
    const f = localStorage.getItem(FILTER_KEY)
    return f === 'started' || f === 'complete' ? f : 'all'
  } catch {
    return 'all'
  }
}

function readUpcomingOpen(): boolean {
  try {
    return localStorage.getItem(UPCOMING_KEY) === 'open'
  } catch {
    return false
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: preference just isn't remembered */
  }
}

function readTypes(game: GameId): SetType[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(typesKey(game)) ?? '[]')
    if (!Array.isArray(raw)) return []
    return SET_TYPES.map((t) => t.value).filter((v) => raw.includes(v))
  } catch {
    return []
  }
}

interface SetsPageProps {
  onAddCard: () => void
  onAddMissing: (card: CardSearchResult, printingId: number) => void
}

export function SetsPage({ onAddCard, onAddMissing }: SetsPageProps): React.JSX.Element {
  const [storedView, setView] = useState<View>(readView)
  // The phone is too narrow for the grid's columns, so it always lists sets in one column.
  const phone = isPhone()
  const view: View = phone ? 'list' : storedView
  const [mode, setMode] = useState<CountMode>(readMode)
  const [filter, setFilterState] = useState<SetFilter>(readFilter)
  // The page remounts on a game switch (PageSwitch), so the types are read for the game shown.
  const { game } = useGame()
  const [types, setTypes] = useState<SetType[]>(() => readTypes(game))
  const panel = useFilterPanel()
  const [upcomingOpen, setUpcomingOpenState] = useState(readUpcomingOpen)
  const [q, setQ] = useState('')
  // Collapsing the banner while a search forces it open lasts until the search changes.
  const [searchCollapsed, setSearchCollapsed] = useState(false)
  const [sort, setSort] = useState<SetSort>('date')
  const [openSet, setOpenSetState] = useState<{ setName: string; language: Language } | null>(null)
  const main = useMainScroll()
  // Where the list was scrolled when a set was opened, restored on the way back.
  const listScroll = useRef<number | null>(null)
  const setOpenSet = useCallback(
    (next: { setName: string; language: Language } | null): void => {
      if (next && main) listScroll.current = main.get()
      setOpenSetState(next)
    },
    [main]
  )
  const openFromList = useCallback(
    (setName: string, language: Language): void => setOpenSet({ setName, language }),
    [setOpenSet]
  )
  useLayoutEffect(() => {
    if (!main) return
    if (openSet) main.set(0)
    else if (listScroll.current !== null) {
      main.set(listScroll.current)
      listScroll.current = null
    }
  }, [openSet, main])

  const [language, setLanguage] = useLanguageFilter()

  const sets = useQuery({ queryKey: queryKeys.setsList, queryFn: () => api.sets.list() })
  const all = useMemo(() => sets.data ?? [], [sets.data])
  const inLanguage = useMemo(
    () => all.filter((s) => matchesLanguage(language, s.language)),
    [all, language]
  )
  const available = useMemo(() => [...new Set(all.map((s) => s.language))], [all])
  const header = setsHeader(inLanguage, mode)
  // Sets more than a month out (and not started) wait under the upcoming banner.
  const cutoff = useUpcomingCutoff(sets.dataUpdatedAt)
  const { current: visible, upcoming } = useMemo(
    () =>
      splitUpcoming(
        sortSets(filterSets(all, { filter, q, mode, language, types, game }), sort, mode),
        cutoff
      ),
    [all, filter, q, mode, sort, language, types, game, cutoff]
  )

  const counts = useMemo(
    () => typeCounts(all, { filter, mode, language, game }),
    [all, filter, mode, language, game]
  )
  const changeTypes = (t: SetType[]): void => {
    setTypes(t)
    persist(typesKey(game), JSON.stringify(t))
  }
  const clearFilters = (): void => {
    changeTypes([])
    setFilter('all')
    setLanguage('all')
  }
  const changeView = (v: string): void => {
    if (v !== 'grid' && v !== 'list') return
    setView(v)
    persist(VIEW_KEY, v)
  }
  const changeMode = (m: string): void => {
    if (m !== 'cards' && m !== 'rarities') return
    setMode(m)
    persist(MODE_KEY, m)
  }
  // A search that only matches upcoming sets shows them open, without touching the saved choice.
  const searchForcesOpen = q.trim() !== '' && visible.length === 0 && upcoming.length > 0
  const upcomingShown = searchForcesOpen ? !searchCollapsed : upcomingOpen
  const setUpcomingOpen = (open: boolean): void => {
    if (searchForcesOpen) {
      setSearchCollapsed(!open)
      return
    }
    setUpcomingOpenState(open)
    persist(UPCOMING_KEY, open ? 'open' : 'closed')
  }
  const setFilter = (f: SetFilter): void => {
    setFilterState(f)
    persist(FILTER_KEY, f)
  }
  // The most complete set in view (else the first) tints the page; an open set tints its own.
  const hasArt = (s: SetSummary): boolean => s.coverImageId !== null || s.imageKey !== null
  const washSet =
    visible.find((s) => hasArt(s) && (s.ownedCards > 0 || s.ownedRarities > 0)) ??
    visible.find(hasArt)
  useArtWash(
    openSet
      ? undefined
      : washSet?.coverImageId
        ? coverArtUrl(washSet.coverImageId)
        : washSet?.imageKey
          ? setArtUrl(washSet.imageKey)
          : null
  )

  const chips: ActiveChip[] = [
    ...languageChip(language, setLanguage),
    ...types.map((t) => ({
      key: t,
      label: SET_TYPES.find((x) => x.value === t)?.label ?? t,
      onRemove: () => changeTypes(types.filter((x) => x !== t))
    })),
    ...(filter === 'all'
      ? []
      : [
          {
            key: 'progress',
            label: filter === 'started' ? 'Started' : 'Complete',
            onRemove: () => setFilter('all')
          }
        ])
  ]
  const shownCount = visible.length + upcoming.length

  const noneStarted =
    filter === 'started' && types.length === 0 && q.trim() === '' && header.started === 0

  // The list stays mounted under an open set, so the way back is instant and keeps its scroll.
  return (
    <>
      {openSet !== null && (
        <SetChecklist
          key={`${openSet.language}|${openSet.setName}`}
          setName={openSet.setName}
          language={openSet.language}
          mode={mode}
          onModeChange={changeMode}
          onBack={() => setOpenSet(null)}
          onAddMissing={onAddMissing}
        />
      )}
      <div hidden={openSet !== null}>
        <div className="flex items-start">
          <div className="min-w-0 flex-1 space-y-4 p-8 max-md:p-4">
            <PageHeader>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Sets</h1>
                {sets.isSuccess && (
                  <p className="mt-0.5 text-[13px] text-foreground/75 tabular-nums">
                    You&apos;ve started {header.started} of {header.total} sets · {header.complete}{' '}
                    complete
                  </p>
                )}
              </div>
              <FilterBar
                search={
                  <SearchInput
                    label="Search sets"
                    placeholder="Search sets by name or code"
                    value={q}
                    onChange={(text) => {
                      setQ(text)
                      setSearchCollapsed(false)
                    }}
                  />
                }
                filtersOpen={panel.open}
                onToggleFilters={() => panel.setOpen(!panel.open)}
                sort={
                  <SortControl
                    options={SORTS}
                    value={sort}
                    dir={SORTS.find((s) => s.value === sort)?.dir ?? 'desc'}
                    onChange={(s) => setSort(s)}
                  />
                }
                toggle={
                  !phone && (
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      value={view}
                      onValueChange={changeView}
                    >
                      <ToggleGroupItem value="list" aria-label="List view">
                        <List />
                      </ToggleGroupItem>
                      <ToggleGroupItem value="grid" aria-label="Grid view">
                        <LayoutGrid />
                      </ToggleGroupItem>
                    </ToggleGroup>
                  )
                }
                chips={chips}
                onClearAll={clearFilters}
                resultCount={`${shownCount.toLocaleString('en-US')} ${shownCount === 1 ? 'set' : 'sets'}`}
              />
            </PageHeader>

            <UpcomingSets
              sets={upcoming}
              cutoff={cutoff}
              open={upcomingShown}
              onOpenChange={setUpcomingOpen}
              mode={mode}
              view={view}
              onOpen={openFromList}
            />

            {sets.isSuccess && visible.length === 0 ? (
              // Only upcoming sets match: the banner above is the whole answer.
              upcoming.length > 0 ? null : (
                <div className="flex flex-col items-center gap-3 py-24 text-center">
                  {noneStarted ? (
                    <>
                      <p className="text-lg font-medium">You haven&apos;t started any sets yet</p>
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setFilter('all')}>
                          Show all sets
                        </Button>
                        <Button onClick={onAddCard}>Add card</Button>
                      </div>
                    </>
                  ) : (
                    <p className="text-lg font-medium">No sets match</p>
                  )}
                </div>
              )
            ) : (
              <SetsList sets={visible} mode={mode} view={view} onOpen={openFromList} />
            )}
          </div>
          <SetsFilterPanel
            wide={panel.wide}
            open={panel.open}
            onOpenChange={panel.setOpen}
            types={types}
            onTypesChange={changeTypes}
            counts={counts}
            filter={filter}
            onFilterChange={setFilter}
            mode={mode}
            onModeChange={changeMode}
            language={language}
            onLanguageChange={setLanguage}
            availableLanguages={available}
            onClearAll={chips.length > 0 ? clearFilters : undefined}
          />
        </div>
      </div>
    </>
  )
}
