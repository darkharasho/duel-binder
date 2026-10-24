import { useEffect, useState } from 'react'
import { ArrowDownAZ, ArrowUpAZ, ChevronDown, Search } from 'lucide-react'
import type { CollectionFilters, Facets, SortKey } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
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

function FacetMenu({
  label,
  options,
  selected,
  onChange
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (next: string[] | undefined) => void
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={label}>
          {label}
          {selected.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-xs tabular-nums text-primary-foreground">
              {selected.length}
            </span>
          )}
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {options.length === 0 && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">No options</div>
        )}
        {options.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt}
            checked={selected.includes(opt)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(on) => {
              const next = on ? [...selected, opt] : selected.filter((s) => s !== opt)
              onChange(next.length > 0 ? next : undefined)
            }}
          >
            {opt}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
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
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search collection"
          placeholder="Search collection…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-56 pl-8"
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
      <Input
        type="number"
        aria-label="Level min"
        placeholder="Min Lv"
        value={filters.levelMin ?? ''}
        onChange={(e) => onChange({ levelMin: parseLevel(e.target.value) })}
        className="w-24 tabular-nums"
      />
      <Input
        type="number"
        aria-label="Level max"
        placeholder="Max Lv"
        value={filters.levelMax ?? ''}
        onChange={(e) => onChange({ levelMax: parseLevel(e.target.value) })}
        className="w-24 tabular-nums"
      />
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
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  )
}
