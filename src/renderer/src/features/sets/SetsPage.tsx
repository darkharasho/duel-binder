import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LayoutGrid, List, Search, SlidersHorizontal, X } from 'lucide-react'
import type { Language } from '@shared/languages'
import type { CardSearchResult, CountMode, SetSummary } from '@shared/types'
import { SET_TYPES, type SetType } from '@shared/setTypes'
import { coverArtUrl, setArtUrl, useArtWash } from '@/components/artWashContext'
import { useMainScroll } from '@/components/mainScroll'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, queryKeys } from '@/lib/api'
import { matchesLanguage, useLanguageFilter } from '@/lib/languageFilter'
import { isPhone } from '@/lib/platform'
import { SetChecklist } from './SetChecklist'
import { SetsFilterPanel } from './SetsFilterPanel'
import { SetsList } from './SetsList'
import {
  activeFilterCount,
  filterSets,
  setsHeader,
  sortSets,
  typeCounts,
  type SetFilter,
  type SetSort
} from './setsView'

type View = 'grid' | 'list'
const VIEW_KEY = 'sets.view'
const MODE_KEY = 'sets.countMode'
const FILTER_KEY = 'sets.filter'
const TYPES_KEY = 'sets.types'

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

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: preference just isn't remembered */
  }
}

function readTypes(): SetType[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(TYPES_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return SET_TYPES.map((t) => t.value).filter((v) => raw.includes(v))
  } catch {
    return []
  }
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] py-0.5 pl-2.5 pr-1 text-xs">
      {label}
      <button
        type="button"
        aria-label={`Remove ${label} filter`}
        onClick={onRemove}
        className="rounded-full p-0.5 hover:bg-white/10"
      >
        <X className="size-3" />
      </button>
    </span>
  )
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
  const [types, setTypes] = useState<SetType[]>(readTypes)
  const [panelOpen, setPanelOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SetSort>('date')
  const [openSet, setOpenSetState] = useState<{ setName: string; language: Language } | null>(null)
  const main = useMainScroll()
  // Where the list was scrolled when a set was opened, restored on the way back.
  const listScroll = useRef<number | null>(null)
  const setOpenSet = (next: { setName: string; language: Language } | null): void => {
    if (next && main) listScroll.current = main.get()
    setOpenSetState(next)
  }
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
  const visible = useMemo(
    () => sortSets(filterSets(all, { filter, q, mode, language, types }), sort, mode),
    [all, filter, q, mode, sort, language, types]
  )

  const counts = useMemo(
    () => typeCounts(all, { filter, mode, language }),
    [all, filter, mode, language]
  )
  const activeCount = activeFilterCount(types, filter)
  const changeTypes = (t: SetType[]): void => {
    setTypes(t)
    persist(TYPES_KEY, JSON.stringify(t))
  }
  const clearFilters = (): void => {
    changeTypes([])
    setFilter('all')
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

  if (openSet !== null) {
    return (
      <SetChecklist
        key={`${openSet.language}|${openSet.setName}`}
        setName={openSet.setName}
        language={openSet.language}
        mode={mode}
        onModeChange={changeMode}
        onBack={() => setOpenSet(null)}
        onAddMissing={onAddMissing}
      />
    )
  }

  const noneStarted =
    filter === 'started' && types.length === 0 && q.trim() === '' && header.started === 0

  return (
    <div className="space-y-4 p-8 max-md:p-4">
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
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] pb-2">
          <div className="relative w-56 max-md:w-auto max-md:min-w-0 max-md:flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search sets by name or code"
              aria-label="Search sets"
              className="h-8 pl-8"
            />
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-label={
                activeCount > 0 ? `Filters & sort, ${activeCount} active` : 'Filters & sort'
              }
              onClick={() => setPanelOpen(true)}
            >
              <SlidersHorizontal />
              Filters &amp; sort
              {activeCount > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 text-xs tabular-nums text-primary-foreground">
                  {activeCount}
                </span>
              )}
            </Button>
            {!phone && (
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
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
            )}
          </div>
        </div>
        {activeCount > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {types.map((t) => {
              const label = SET_TYPES.find((x) => x.value === t)?.label ?? t
              return (
                <Chip
                  key={t}
                  label={label}
                  onRemove={() => changeTypes(types.filter((x) => x !== t))}
                />
              )
            })}
            {filter !== 'all' && (
              <Chip
                label={filter === 'started' ? 'Started' : 'Complete'}
                onRemove={() => setFilter('all')}
              />
            )}
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear
            </Button>
          </div>
        )}
      </PageHeader>

      <SetsFilterPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        types={types}
        onTypesChange={changeTypes}
        counts={counts}
        filter={filter}
        onFilterChange={setFilter}
        sort={sort}
        onSortChange={setSort}
        mode={mode}
        onModeChange={changeMode}
        language={language}
        onLanguageChange={setLanguage}
        availableLanguages={available}
        onReset={() => {
          changeTypes([])
          setFilter('all')
          setSort('date')
          changeMode('cards')
        }}
      />

      {sets.isSuccess && visible.length === 0 ? (
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
      ) : (
        <SetsList
          sets={visible}
          mode={mode}
          view={view}
          onOpen={(setName, language) => setOpenSet({ setName, language })}
        />
      )}
    </div>
  )
}
