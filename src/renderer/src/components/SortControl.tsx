import { ArrowUpDown } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { SortOption } from '@/lib/filters'

/** The one sort control: each choice carries its direction. An icon alone on a phone's row. */
export function SortControl<T extends string>({
  options,
  value,
  dir,
  onChange
}: {
  options: readonly SortOption<T>[]
  value: T
  dir: 'asc' | 'desc'
  onChange: (value: T, dir: 'asc' | 'desc') => void
}): React.JSX.Element {
  const keyOf = (o: { value: T; dir: 'asc' | 'desc' }): string => `${o.value}:${o.dir}`
  return (
    <Select
      value={keyOf({ value, dir })}
      onValueChange={(k) => {
        const o = options.find((x) => keyOf(x) === k)
        if (o) onChange(o.value, o.dir)
      }}
    >
      <SelectTrigger
        aria-label="Sort by"
        className="w-56 min-w-0 shrink max-lg:w-44 max-md:w-9 max-md:shrink-0 max-md:justify-center max-md:px-0 max-md:[&>svg:last-child]:hidden max-md:[&>[data-slot=select-value]]:hidden!"
      >
        <ArrowUpDown aria-hidden className="md:hidden" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={keyOf(o)} value={keyOf(o)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
