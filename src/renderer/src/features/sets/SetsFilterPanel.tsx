import type { Language, LanguageFilter } from '@shared/languages'
import { SET_TYPES, type SetType } from '@shared/setTypes'
import type { CountMode } from '@shared/types'
import { FilterOptionChip } from '@/components/FilterChip'
import { ChipOptions, FilterPanel, FilterSection, LanguageSection } from '@/components/FilterPanel'
import type { SetFilter } from './setsView'

export interface SetsFilterPanelProps {
  wide: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  types: SetType[]
  onTypesChange: (t: SetType[]) => void
  counts: Record<SetType, number>
  filter: SetFilter
  onFilterChange: (f: SetFilter) => void
  mode: CountMode
  onModeChange: (m: CountMode) => void
  language: LanguageFilter
  onLanguageChange: (l: LanguageFilter) => void
  availableLanguages: Language[]
  /** Left out with nothing to clear. */
  onClearAll?: () => void
}

const PROGRESS: { value: SetFilter; label: string }[] = [
  { value: 'started', label: 'Started' },
  { value: 'all', label: 'All' },
  { value: 'complete', label: 'Complete' }
]
const MODES: { value: CountMode; label: string }[] = [
  { value: 'cards', label: 'Each card once' },
  { value: 'rarities', label: 'Every rarity' }
]

export function SetsFilterPanel(p: SetsFilterPanelProps): React.JSX.Element {
  const toggleType = (t: SetType): void => {
    const next = new Set(p.types)
    if (!next.delete(t)) next.add(t)
    p.onTypesChange(SET_TYPES.map((s) => s.value).filter((v) => next.has(v)))
  }

  return (
    <FilterPanel
      wide={p.wide}
      open={p.open}
      onOpenChange={p.onOpenChange}
      description="Filter the sets list"
      onClearAll={p.onClearAll}
    >
      <LanguageSection
        value={p.language}
        onChange={p.onLanguageChange}
        available={p.availableLanguages}
      />
      <FilterSection title="Type" defaultOpen picked={p.types.length}>
        <ChipOptions>
          {SET_TYPES.map((t) => (
            <FilterOptionChip
              key={t.value}
              label={t.label}
              count={p.counts[t.value]}
              selected={p.types.includes(t.value)}
              onClick={() => toggleType(t.value)}
            />
          ))}
        </ChipOptions>
      </FilterSection>
      <FilterSection title="Progress" defaultOpen picked={p.filter === 'all' ? 0 : 1}>
        <ChipOptions>
          {PROGRESS.map((o) => (
            <FilterOptionChip
              key={o.value}
              label={o.label}
              selected={p.filter === o.value}
              onClick={() => p.onFilterChange(o.value)}
            />
          ))}
        </ChipOptions>
      </FilterSection>
      <FilterSection title="Count" defaultOpen>
        <ChipOptions>
          {MODES.map((o) => (
            <FilterOptionChip
              key={o.value}
              label={o.label}
              selected={p.mode === o.value}
              onClick={() => p.onModeChange(o.value)}
            />
          ))}
        </ChipOptions>
      </FilterSection>
    </FilterPanel>
  )
}
