import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import type { FilterDef } from '@shared/games'
import { LANGUAGES, type Language, type LanguageFilter } from '@shared/languages'
import { FacetMenu } from '@/components/FacetMenu'
import { FilterOptionChip } from '@/components/FilterChip'
import { RangeFilter } from '@/components/RangeFilter'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import type { CardFilterValues, ListKey } from '@/lib/filters'
import { RANGE_FIELDS, type RangeKey } from '@/lib/rangeFilters'
import { cn } from '@/lib/utils'

/** Lists up to this long show as chips, open; longer ones collapse, with a search inside. */
const SHORT_MAX = 12

/** The panel beside the page: sticks to the scroll area, its own height, and scrolls by itself. */
function SidePanel({
  onClose,
  children
}: {
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const main = el?.closest<HTMLElement>('main[data-main-scroll]')
    if (!el || !main) return
    const update = (): void => {
      el.style.height = `${main.clientHeight}px`
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(main)
    return () => observer?.disconnect()
  }, [])
  return (
    <aside
      ref={ref}
      aria-label="Filters"
      className="sticky top-0 z-10 h-dvh w-80 shrink-0 overflow-y-auto overscroll-contain border-l border-white/[0.06] bg-background/60 backdrop-blur-xl"
    >
      <div className="flex items-center justify-between px-4 pt-3">
        <h2 className="font-semibold">Filters</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close filters" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="px-4 pb-4">{children}</div>
    </aside>
  )
}

/**
 * Every filter of a page: a side panel that pushes the content (place it after the page in a
 * flex row) when `wide`, a bottom sheet otherwise. `description` names it for screen readers.
 */
export function FilterPanel({
  wide,
  open,
  onOpenChange,
  description,
  onClearAll,
  children
}: {
  wide: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  description: string
  /** Offered in the sheet, which covers the row Clear all sits on; left out with nothing to clear. */
  onClearAll?: () => void
  children: React.ReactNode
}): React.JSX.Element | null {
  if (wide) {
    return open ? <SidePanel onClose={() => onOpenChange(false)}>{children}</SidePanel> : null
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        data-layout="bottom-sheet"
        className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-3xl border-white/[0.08] pb-[max(1rem,env(safe-area-inset-bottom))]"
        // Nothing takes focus on opening, so no field raises the keyboard over the sheet.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription className="sr-only">{description}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          {children}
          {onClearAll && (
            <Button variant="outline" size="sm" className="mt-3 w-full" onClick={onClearAll}>
              Clear all
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** One section of the panel; its heading opens and closes it, and counts what's picked inside. */
export function FilterSection({
  title,
  defaultOpen = false,
  count,
  picked = 0,
  children
}: {
  title: string
  defaultOpen?: boolean
  /** How many options it holds, shown on a section that collapses. */
  count?: number
  picked?: number
  children: React.ReactNode
}): React.JSX.Element {
  // Until it's touched the section follows defaultOpen, which can change as its options load.
  const [touched, setTouched] = useState<boolean | null>(null)
  const open = touched ?? defaultOpen
  return (
    <section className="border-b border-white/[0.06] py-2.5 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-label={picked > 0 ? `${title}, ${picked} selected` : title}
        onClick={() => setTouched(!open)}
        className="flex w-full items-center gap-2 rounded-sm py-0.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {picked > 0 && (
          <span className="rounded-sm bg-primary px-1.5 tabular-nums text-primary-foreground">
            {picked}
          </span>
        )}
        {count !== undefined && <span className="font-normal tabular-nums">{count}</span>}
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="pt-2">{children}</div>}
    </section>
  )
}

/** Short lists' selectable chips. */
export function ChipOptions({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex flex-wrap gap-1.5">{children}</div>
}

/** Language: always the first section, open. "All" plus the languages that have data. */
export function LanguageSection({
  value,
  onChange,
  available
}: {
  value: LanguageFilter
  onChange: (l: LanguageFilter) => void
  available: Language[]
}): React.JSX.Element {
  const shown = LANGUAGES.filter((l) => l.code === value || available.includes(l.code))
  return (
    <FilterSection title="Language" defaultOpen>
      <ChipOptions>
        <FilterOptionChip label="All" selected={value === 'all'} onClick={() => onChange('all')} />
        {shown.map((l) => (
          <FilterOptionChip
            key={l.code}
            label={l.label}
            selected={value === l.code}
            onClick={() => onChange(l.code)}
          />
        ))}
      </ChipOptions>
    </FilterSection>
  )
}

/** A multi-select facet: chips while it's short, a collapsed searchable list when it's long. */
function FacetSection({
  label,
  options,
  selected,
  onChange,
  labelOf = (opt) => opt
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (next: string[] | undefined) => void
  labelOf?: (opt: string) => string
}): React.JSX.Element {
  const long = options.length > SHORT_MAX
  const toggle = (opt: string): void => {
    const next = selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]
    onChange(next.length > 0 ? next : undefined)
  }
  return (
    <FilterSection
      title={label}
      defaultOpen={!long}
      count={long ? options.length : undefined}
      picked={selected.length}
    >
      {long ? (
        <FacetMenu
          label={label}
          options={options}
          selected={selected}
          onChange={onChange}
          labelOf={labelOf}
        />
      ) : options.length === 0 && selected.length === 0 ? (
        <p className="text-sm text-muted-foreground">No options</p>
      ) : (
        <ChipOptions>
          {/* A picked value can fall outside the options, as a set of another language does. */}
          {[...options, ...selected.filter((s) => !options.includes(s))].map((o) => (
            <FilterOptionChip
              key={o}
              label={labelOf(o)}
              selected={selected.includes(o)}
              onClick={() => toggle(o)}
            />
          ))}
        </ChipOptions>
      )}
    </FilterSection>
  )
}

/** The card facets and range filters the Collection and Browse share. */
export function CardFilterSections({
  facetList,
  ranges,
  filters,
  options,
  setLabelOf,
  onChange
}: {
  facetList: { key: ListKey; label: string }[]
  ranges: (FilterDef & { key: RangeKey })[]
  filters: CardFilterValues
  options: (key: ListKey) => string[]
  setLabelOf: (setName: string) => string
  onChange: (patch: CardFilterValues) => void
}): React.JSX.Element {
  return (
    <>
      {facetList.map(({ key, label }) => (
        <FacetSection
          key={key}
          label={label}
          options={options(key)}
          selected={filters[key] ?? []}
          onChange={(next) => onChange({ [key]: next })}
          labelOf={key === 'setNames' ? setLabelOf : undefined}
        />
      ))}
      {ranges.map((f) => {
        const { min, max } = RANGE_FIELDS[f.key]
        const set = filters[min] !== undefined || filters[max] !== undefined
        return (
          <FilterSection key={f.key} title={f.label} picked={set ? 1 : 0}>
            <RangeFilter filter={f} values={filters} onChange={onChange} showLabel={false} />
          </FilterSection>
        )
      })}
    </>
  )
}
