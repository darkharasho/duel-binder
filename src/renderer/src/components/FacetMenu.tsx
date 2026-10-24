import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

const SEARCHABLE_AT = 12
const SHOWN_MAX = 200

/** A multi-select filter menu; long lists get a search box. */
export function FacetMenu({
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
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const matches = needle ? options.filter((o) => o.toLowerCase().includes(needle)) : options
  // Selected options stay visible even when the search hides them.
  const shown = [...selected.filter((s) => !matches.includes(s)), ...matches].slice(0, SHOWN_MAX)
  return (
    <DropdownMenu onOpenChange={(open) => !open && setQ('')}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label} className="text-foreground/80">
          {label}
          {selected.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-xs tabular-nums text-primary-foreground">
              {selected.length}
            </span>
          )}
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
        {options.length > SEARCHABLE_AT && (
          <input
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder={`Search ${label.toLowerCase()}…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            // Keep typing in the box instead of the menu's type-ahead.
            onKeyDown={(e) => e.stopPropagation()}
            className="mb-1 h-8 w-full rounded-sm border border-input bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
          />
        )}
        {shown.length === 0 && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">No options</div>
        )}
        {shown.map((opt) => (
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
        {matches.length > SHOWN_MAX && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {matches.length - SHOWN_MAX} more — search to narrow
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
