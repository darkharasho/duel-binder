import { useEffect, useState } from 'react'
import { ArrowDownAZ, ArrowUpAZ, Search, X } from 'lucide-react'
import type { CollectionFilters, Facets, SortKey } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FacetMenu } from '@/components/FacetMenu'
import { LanguageSelect } from '@/components/LanguageSelect'
import { RangeFilter } from '@/components/RangeFilter'
import { RANGE_FIELDS, rangeFilters } from '@/lib/rangeFilters'
import { useGame } from '@/lib/game'
import { useLanguageFilter } from '@/lib/languageFilter'
import { useSetNames } from '@/lib/setLabels'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { activeFilterCount, facetsFor } from './filterFacets'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

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

/** The collection's search box; its text reaches the filters after a short pause. */
export function CollectionSearch({
  filters,
  onChange,
  className
}: Pick<Props, 'filters' | 'onChange'> & { className?: string }): React.JSX.Element {
  const [text, setText] = useState(filters.q ?? '')

  // Debounce search text into the page's filter state.
  useEffect(() => {
    if (text === (filters.q ?? '')) return
    const t = setTimeout(() => onChange({ q: text === '' ? undefined : text }), 200)
    return () => clearTimeout(t)
  }, [text, filters.q, onChange])

  return (
    <div className={className ?? 'relative mr-1 max-md:mr-0 max-md:w-full'}>
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
  )
}

function FacetMenus({
  filters,
  facets,
  onChange
}: Pick<Props, 'filters' | 'facets' | 'onChange'>): React.JSX.Element {
  const [language] = useLanguageFilter()
  const setNames = useSetNames(language)
  const { def } = useGame()
  return (
    <>
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
    </>
  )
}

/** The game's range filters (Level for Yu-Gi-Oh!, HP for Pokémon). */
function Ranges({ filters, onChange }: Pick<Props, 'filters' | 'onChange'>): React.JSX.Element {
  const { def } = useGame()
  return (
    <>
      {rangeFilters(def.filters).map((f) => (
        <RangeFilter key={f.key} filter={f} values={filters} onChange={onChange} />
      ))}
    </>
  )
}

function DirButton({ filters, onChange }: Pick<Props, 'filters' | 'onChange'>): React.JSX.Element {
  return (
    <Button
      variant="outline"
      size="icon-sm"
      aria-label={filters.dir === 'asc' ? 'Sort ascending' : 'Sort descending'}
      onClick={() => onChange({ dir: filters.dir === 'asc' ? 'desc' : 'asc' })}
    >
      {filters.dir === 'asc' ? <ArrowUpAZ /> : <ArrowDownAZ />}
    </Button>
  )
}

/** The desktop's one row of search, facets, language, ranges and sort. */
export function FilterBar({ filters, facets, onChange, onClear }: Props): React.JSX.Element {
  const [language, setLanguage] = useLanguageFilter()

  return (
    <div className="flex items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <CollectionSearch filters={filters} onChange={onChange} />
        <FacetMenus filters={filters} facets={facets} onChange={onChange} />
        <LanguageSelect
          value={language}
          onChange={setLanguage}
          available={facets?.languages ?? []}
        />
        <Ranges filters={filters} onChange={onChange} />
      </div>
      {/* Sort stays on the top row when the filters wrap, rather than alone on a row of its own. */}
      <div className="flex shrink-0 items-center gap-1">
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
        <DirButton filters={filters} onChange={onChange} />
        <Button variant="ghost" size="sm" onClick={onClear} className="text-muted-foreground">
          Clear filters
        </Button>
      </div>
    </div>
  )
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * The phone's filter sheet body: facets, language, ranges and sort, without the search box
 * (which stays on the page, so opening the sheet never raises the keyboard).
 */
export function FilterSheetBody({ filters, facets, onChange, onClear }: Props): React.JSX.Element {
  const [language, setLanguage] = useLanguageFilter()
  const { def } = useGame()
  return (
    <div className="flex flex-col gap-5 px-4 pb-4">
      <Section title="Filter">
        <div className="-ml-2 flex flex-wrap items-center gap-1">
          <FacetMenus filters={filters} facets={facets} onChange={onChange} />
        </div>
      </Section>
      {rangeFilters(def.filters).map((f) => (
        <Section key={f.key} title={f.label}>
          <RangeFilter filter={f} values={filters} onChange={onChange} showLabel={false} />
        </Section>
      ))}
      <Section title="Language">
        <LanguageSelect
          value={language}
          onChange={setLanguage}
          available={facets?.languages ?? []}
        />
      </Section>
      <Section title="Sort by">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            aria-label="Sort by"
            className="flex-wrap"
            value={filters.sort}
            onValueChange={(v) => {
              if (v) onChange({ sort: v as SortKey })
            }}
          >
            {SORTS.map((s) => (
              <ToggleGroupItem key={s.value} value={s.value}>
                {s.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <DirButton filters={filters} onChange={onChange} />
        </div>
      </Section>
      <Button variant="outline" size="sm" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  )
}

/** A removable chip per active filter, under the phone's search box. */
export function FilterChips({
  filters,
  onChange,
  onClear
}: Pick<Props, 'filters' | 'onChange' | 'onClear'>): React.JSX.Element | null {
  const [language] = useLanguageFilter()
  const setNames = useSetNames(language)
  const { def } = useGame()
  if (activeFilterCount(filters, def) === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {facetsFor(def).flatMap(({ key }) =>
        (filters[key] ?? []).map((v) => {
          const label = key === 'setNames' ? setNames.labelOf(v) : v
          return (
            <Chip
              key={`${key}:${v}`}
              label={label}
              onRemove={() => {
                const next = (filters[key] ?? []).filter((x) => x !== v)
                onChange({ [key]: next.length > 0 ? next : undefined })
              }}
            />
          )
        })
      )}
      {rangeFilters(def.filters).map((f) => {
        const { min, max } = RANGE_FIELDS[f.key]
        if (filters[min] === undefined && filters[max] === undefined) return null
        return (
          <Chip
            key={f.key}
            label={`${f.label} ${filters[min] ?? ''}–${filters[max] ?? ''}`}
            onRemove={() => onChange({ [min]: undefined, [max]: undefined })}
          />
        )
      })}
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
    </div>
  )
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
