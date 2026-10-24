import { useEffect, useState } from 'react'
import { ArrowDownAZ, ArrowUpAZ, Search } from 'lucide-react'
import type { CollectionFilters, Facets, SortKey } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FacetMenu } from '@/components/FacetMenu'
import { LanguageSelect } from '@/components/LanguageSelect'
import { useLanguageFilter } from '@/lib/languageFilter'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

type ListKey = 'cardTypes' | 'attributes' | 'archetypes' | 'setNames' | 'rarities'

const FACETS: { key: ListKey; label: string }[] = [
  { key: 'cardTypes', label: 'Card type' },
  { key: 'attributes', label: 'Attribute' },
  { key: 'archetypes', label: 'Archetype' },
  { key: 'setNames', label: 'Set' },
  { key: 'rarities', label: 'Rarity' }
]

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'value', label: 'Value' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'added', label: 'Date added' }
]

interface Props {
  filters: CollectionFilters
  facets: Facets | undefined
  onChange: (patch: Partial<CollectionFilters>) => void
  onClear: () => void
}

function parseLevel(v: string): number | undefined {
  if (v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function FilterBar({ filters, facets, onChange, onClear }: Props): React.JSX.Element {
  const [text, setText] = useState(filters.q ?? '')
  const [language, setLanguage] = useLanguageFilter()

  // Debounce search text into the page's filter state.
  useEffect(() => {
    if (text === (filters.q ?? '')) return
    const t = setTimeout(() => onChange({ q: text === '' ? undefined : text }), 200)
    return () => clearTimeout(t)
  }, [text, filters.q, onChange])

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="relative mr-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search collection"
          placeholder="Search collection…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-8 w-52 pl-8"
        />
      </div>
      {FACETS.map(({ key, label }) => (
        <FacetMenu
          key={key}
          label={label}
          options={facets?.[key] ?? []}
          selected={filters[key] ?? []}
          onChange={(next) => onChange({ [key]: next })}
        />
      ))}
      <LanguageSelect
        value={language}
        onChange={setLanguage}
        available={facets?.languages ?? []}
      />
      <div className="flex items-center gap-1 text-[13px] text-foreground/80">
        <span className="px-1">Level</span>
        <Input
          type="number"
          aria-label="Level min"
          placeholder="min"
          value={filters.levelMin ?? ''}
          onChange={(e) => onChange({ levelMin: parseLevel(e.target.value) })}
          className="h-8 w-14 px-2 font-mono text-xs"
        />
        <span aria-hidden>–</span>
        <Input
          type="number"
          aria-label="Level max"
          placeholder="max"
          value={filters.levelMax ?? ''}
          onChange={(e) => onChange({ levelMax: parseLevel(e.target.value) })}
          className="h-8 w-14 px-2 font-mono text-xs"
        />
      </div>
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
