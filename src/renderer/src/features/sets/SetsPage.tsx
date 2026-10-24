import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LayoutGrid, List, Search } from 'lucide-react'
import type { Language } from '@shared/languages'
import type { CardSearchResult, CountMode } from '@shared/types'
import { LanguageSelect } from '@/components/LanguageSelect'
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
import { api, queryKeys } from '@/lib/api'
import { useLanguageFilter } from '@/lib/languageFilter'
import { SetChecklist } from './SetChecklist'
import { SetsList } from './SetsList'
import { filterSets, setsHeader, sortSets, type SetFilter, type SetSort } from './setsView'

type View = 'grid' | 'list'
const VIEW_KEY = 'sets.view'
const MODE_KEY = 'sets.countMode'

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

function readMode(): CountMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'rarities' ? 'rarities' : 'cards'
  } catch {
    return 'cards'
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: preference just isn't remembered */
  }
}

const SORTS: { value: SetSort; label: string }[] = [
  { value: 'complete', label: 'Most complete' },
  { value: 'name', label: 'Name' },
  { value: 'date', label: 'Release date' }
]

interface SetsPageProps {
  onAddCard: () => void
  onAddMissing: (card: CardSearchResult, printingId: number) => void
}

export function SetsPage({ onAddCard, onAddMissing }: SetsPageProps): React.JSX.Element {
  const [view, setView] = useState<View>(readView)
  const [mode, setMode] = useState<CountMode>(readMode)
  const [filter, setFilter] = useState<SetFilter>('started')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SetSort>('complete')
  const [openSet, setOpenSet] = useState<{ setName: string; language: Language } | null>(null)

  const [language, setLanguage] = useLanguageFilter()

  const sets = useQuery({ queryKey: queryKeys.setsList, queryFn: () => api.sets.list() })
  const all = useMemo(() => sets.data ?? [], [sets.data])
  const inLanguage = useMemo(
    () => all.filter((s) => language === 'all' || s.language === language),
    [all, language]
  )
  const available = useMemo(() => [...new Set(all.map((s) => s.language))], [all])
  const header = setsHeader(inLanguage, mode)
  const visible = useMemo(
    () => sortSets(filterSets(all, { filter, q, mode, language }), sort, mode),
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
  const changeFilter = (f: string): void => {
    if (f === 'started' || f === 'all' || f === 'complete') setFilter(f)
  }

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
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Sets</h1>
          {sets.isSuccess && (
            <p className="text-sm text-muted-foreground tabular-nums">
              You&apos;ve started {header.started} of {header.total} sets · {header.complete}{' '}
              complete
            </p>
          )}
        </div>
        <ToggleGroup type="single" variant="outline" value={view} onValueChange={changeView}>
          <ToggleGroupItem value="grid" aria-label="Grid view">
            <LayoutGrid />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="List view">
            <List />
          </ToggleGroupItem>
        </ToggleGroup>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filter}
          onValueChange={changeFilter}
        >
          <ToggleGroupItem value="started">Started</ToggleGroupItem>
          <ToggleGroupItem value="all">All sets</ToggleGroupItem>
          <ToggleGroupItem value="complete">Complete</ToggleGroupItem>
        </ToggleGroup>
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
        <div className="relative min-w-56 flex-1">
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
        <LanguageSelect value={language} onChange={setLanguage} available={available} />
        <Select value={sort} onValueChange={(v) => setSort(v as SetSort)}>
          <SelectTrigger size="sm" aria-label="Sort by" className="w-40">
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
      </div>

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
