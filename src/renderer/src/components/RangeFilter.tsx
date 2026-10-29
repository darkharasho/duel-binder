import type { FilterDef } from '@shared/games'
import { Input } from '@/components/ui/input'
import { RANGE_FIELDS, type RangeField, type RangeKey } from '@/lib/rangeFilters'

function parseBound(v: string): number | undefined {
  if (v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** "Level [min] – [max]": a number range, either end optional. */
export function RangeFilter({
  filter,
  values,
  onChange
}: {
  filter: FilterDef & { key: RangeKey }
  values: Partial<Record<RangeField, number>>
  onChange: (patch: Partial<Record<RangeField, number | undefined>>) => void
}): React.JSX.Element {
  const { min, max } = RANGE_FIELDS[filter.key]
  return (
    <div className="flex items-center gap-1 text-[13px] text-foreground/80">
      <span className="px-1">{filter.label}</span>
      <Input
        type="number"
        aria-label={`${filter.label} min`}
        placeholder="min"
        value={values[min] ?? ''}
        onChange={(e) => onChange({ [min]: parseBound(e.target.value) })}
        className="h-8 w-14 px-2 font-mono text-xs"
      />
      <span aria-hidden>–</span>
      <Input
        type="number"
        aria-label={`${filter.label} max`}
        placeholder="max"
        value={values[max] ?? ''}
        onChange={(e) => onChange({ [max]: parseBound(e.target.value) })}
        className="h-8 w-14 px-2 font-mono text-xs"
      />
    </div>
  )
}
