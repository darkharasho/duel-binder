import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LayoutGrid, List, Search } from 'lucide-react'
import type { Language } from '@shared/languages'
import type { CardSearchResult, CountMode, SetSummary } from '@shared/types'
import { coverArtUrl, setArtUrl, useArtWash } from '@/components/artWashContext'
import { LanguageSelect } from '@/components/LanguageSelect'
import { useMainScroll } from '@/components/mainScroll'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { UnderlineTabs } from '@/components/UnderlineTabs'
import { api, queryKeys } from '@/lib/api'
import { matchesLanguage, useLanguageFilter } from '@/lib/languageFilter'
import { SetChecklist } from './SetChecklist'
import { SetsList } from './SetsList'
import { filterSets, setsHeader, sortSets, type SetFilter, type SetSort } from './setsView'

type View = 'grid' | 'list'
const VIEW_KEY = 'sets.view'
const MODE_KEY = 'sets.countMode'
const FILTER_KEY = 'sets.filter'

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

const FILTERS = [
  { value: 'all', label: 'All sets' },
  { value: 'started', label: 'Started' },
  { value: 'complete', label: 'Complete' }
] as const satisfies readonly { value: SetFilter; label: string }[]

const SORTS: { value: SetSort; label: string }[] = [
  { value: 'date', label: 'Newest' },
  { value: 'complete', label: 'Most complete' },
  { value: 'name', label: 'Name' }
]

interface SetsPageProps {
  onAddCard: () => void
  onAddMissing: (card: CardSearchResult, printingId: number) => void
}

export function SetsPage({ onAddCard, onAddMissing }: SetsPageProps): React.JSX.Element {
  const [view, setView] = useState<View>(readView)
  const [mode, setMode] = useState<CountMode>(readMode)
  const [filter, setFilterState] = useState<SetFilter>(readFilter)
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
    () => sortSets(filterSets(all, { filter, q, mode, language, types: [] }), sort, mode),
    [all, filter, q, mode, sort, language]
  )

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

  const noneStarted = filter === 'started' && q.trim() === '' && header.started === 0

  return (
    <div className="space-y-4 p-8">
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
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2 border-b border-white/[0.08]">
          <UnderlineTabs label="Show" value={filter} options={FILTERS} onChange={setFilter} />
          <div className="ml-auto flex flex-wrap items-center gap-2 pb-2">
            <div className="relative w-56">
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
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={mode}
              onValueChange={changeMode}
            >
              <ToggleGroupItem value="cards">Each card once</ToggleGroupItem>
              <ToggleGroupItem value="rarities">Every rarity</ToggleGroupItem>
            </ToggleGroup>
            <LanguageSelect value={language} onChange={setLanguage} available={available} />
            <Select value={sort} onValueChange={(v) => setSort(v as SetSort)}>
              <SelectTrigger size="sm" aria-label="Sort by" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          </div>
        </div>
      </PageHeader>

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
