import type { Language, LanguageFilter } from '@shared/languages'
import { SET_TYPES, type SetType } from '@shared/setTypes'
import type { CountMode } from '@shared/types'
import { LanguageSelect } from '@/components/LanguageSelect'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { SetFilter, SetSort } from './setsView'

export interface SetsFilterPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  types: SetType[]
  onTypesChange: (t: SetType[]) => void
  counts: Record<SetType, number>
  filter: SetFilter
  onFilterChange: (f: SetFilter) => void
  sort: SetSort
  onSortChange: (s: SetSort) => void
  mode: CountMode
  onModeChange: (m: CountMode) => void
  language: LanguageFilter
  onLanguageChange: (l: LanguageFilter) => void
  availableLanguages: Language[]
  onReset: () => void
}

const PROGRESS: { value: SetFilter; label: string }[] = [
  { value: 'started', label: 'Started' },
  { value: 'all', label: 'All' },
  { value: 'complete', label: 'Complete' }
]
const SORTS: { value: SetSort; label: string }[] = [
  { value: 'date', label: 'Newest' },
  { value: 'complete', label: 'Most complete' },
  { value: 'name', label: 'Name' }
]
const MODES: { value: CountMode; label: string }[] = [
  { value: 'cards', label: 'Each card once' },
  { value: 'rarities', label: 'Every rarity' }
]

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

function Choice<T extends string>({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label={label}
      className="flex-wrap"
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v as T)
      }}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value}>
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export function SetsFilterPanel(p: SetsFilterPanelProps): React.JSX.Element {
  const toggleType = (t: SetType, checked: boolean): void => {
    const next = new Set(p.types)
    if (checked) next.add(t)
    else next.delete(t)
    p.onTypesChange(SET_TYPES.map((s) => s.value).filter((v) => next.has(v)))
  }

  return (
    <Sheet open={p.open} onOpenChange={p.onOpenChange}>
      <SheetContent side="right" className="w-80 gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Filters &amp; sort</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-4">
          <Section title="Type">
            <div className="flex flex-col gap-2">
              {SET_TYPES.map((t) => {
                const id = `set-type-${t.value}`
                return (
                  <div key={t.value} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={p.types.includes(t.value)}
                      onCheckedChange={(c) => toggleType(t.value, c === true)}
                    />
                    <label htmlFor={id} className="flex-1 text-sm">
                      {t.label}
                    </label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {p.counts[t.value]}
                    </span>
                  </div>
                )
              })}
            </div>
          </Section>
          <Section title="Progress">
            <Choice
              label="Progress"
              options={PROGRESS}
              value={p.filter}
              onChange={p.onFilterChange}
            />
          </Section>
          <Section title="Sort by">
            <Choice label="Sort by" options={SORTS} value={p.sort} onChange={p.onSortChange} />
          </Section>
          <Section title="Count">
            <Choice label="Count" options={MODES} value={p.mode} onChange={p.onModeChange} />
          </Section>
          <Section title="Language">
            <LanguageSelect
              value={p.language}
              onChange={p.onLanguageChange}
              available={p.availableLanguages}
            />
          </Section>
          <Button variant="outline" size="sm" onClick={p.onReset}>
            Reset all
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
