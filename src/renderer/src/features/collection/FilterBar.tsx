import { useEffect, useState } from 'react'
import { ArrowDownAZ, ArrowUpAZ, Search } from 'lucide-react'
import type { FilterDef, GameDef } from '@shared/games'
import type { CollectionFilters, Facets, SortKey } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FacetMenu } from '@/components/FacetMenu'
import { LanguageSelect } from '@/components/LanguageSelect'
import { RangeFilter } from '@/components/RangeFilter'
import { rangeFilters } from '@/lib/rangeFilters'
import { useGame } from '@/lib/game'
import { useLanguageFilter } from '@/lib/languageFilter'
import { useSetNames } from '@/lib/setLabels'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

type GameKey =
  'cardTypes' | 'attributes' | 'archetypes' | 'pkmCategories' | 'pkmTypes' | 'pkmStages'
type ListKey = GameKey | 'setNames' | 'rarities'

const GAME_KEYS: readonly string[] = [
  'cardTypes',
  'attributes',
  'archetypes',
  'pkmCategories',
  'pkmTypes',
  'pkmStages'
] satisfies GameKey[]

/** The collection's own names for some of the games' filters. */
const LABELS: Partial<Record<GameKey, string>> = { cardTypes: 'Card type' }

/** The game's list filters the collection has (no Race), then Set and the game's word for rarity. */
function facetsFor(def: GameDef): { key: ListKey; label: string }[] {
  return [
    ...def.filters
      .filter(
        (f): f is FilterDef & { key: GameKey } => f.kind === 'multi' && GAME_KEYS.includes(f.key)
      )
      .map((f) => ({ key: f.key, label: LABELS[f.key] ?? f.label })),
    { key: 'setNames', label: 'Set' },
    { key: 'rarities', label: def.vocab.rarity }
  ]
}

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'value', label: 'Total value' },
  { value: 'unitPrice', label: 'Single value' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'added', label: 'Date added' }
]

interface Props {
  filters: CollectionFilters
  facets: Facets | undefined
  onChange: (patch: Partial<CollectionFilters>) => void
  onClear: () => void
}

export function FilterBar({ filters, facets, onChange, onClear }: Props): React.JSX.Element {
  const [text, setText] = useState(filters.q ?? '')
  const [language, setLanguage] = useLanguageFilter()
  const setNames = useSetNames(language)
  const { def } = useGame()

  // Debounce search text into the page's filter state.
  useEffect(() => {
    if (text === (filters.q ?? '')) return
    const t = setTimeout(() => onChange({ q: text === '' ? undefined : text }), 200)
    return () => clearTimeout(t)
  }, [text, filters.q, onChange])

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="relative mr-1 max-md:mr-0 max-md:w-full">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search collection"
          placeholder="Search collection…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-8 w-52 pl-8 max-md:w-full"
        />
      </div>
      {facetsFor(def).map(({ key, label }) => (
        <FacetMenu
          key={key}
          label={label}
          options={
            key === 'setNames'
              ? (facets?.setNames ?? []).filter(setNames.inLanguage)
              : (facets?.[key] ?? [])
          }
          selected={filters[key] ?? []}
          onChange={(next) => onChange({ [key]: next })}
          labelOf={key === 'setNames' ? setNames.labelOf : undefined}
        />
      ))}
      <LanguageSelect value={language} onChange={setLanguage} available={facets?.languages ?? []} />
      {rangeFilters(def.filters).map((f) => (
        <RangeFilter key={f.key} filter={f} values={filters} onChange={onChange} />
      ))}
      <div className="ml-auto flex items-center gap-1">
        <Select value={filters.sort} onValueChange={(v) => onChange({ sort: v as SortKey })}>
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
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={filters.dir === 'asc' ? 'Sort ascending' : 'Sort descending'}
          onClick={() => onChange({ dir: filters.dir === 'asc' ? 'desc' : 'asc' })}
        >
          {filters.dir === 'asc' ? <ArrowUpAZ /> : <ArrowDownAZ />}
        </Button>
      </div>
      <Button variant="ghost" size="sm" onClick={onClear} className="text-muted-foreground">
        Clear filters
      </Button>
    </div>
  )
}
