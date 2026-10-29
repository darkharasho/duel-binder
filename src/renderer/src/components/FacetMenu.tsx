import { useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { isPhone } from '@/lib/platform'

const SHOWN_MAX = 200

/** A multi-select filter menu with a search box; what's selected is listed first. */
export function FacetMenu({
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
  /** What an option reads as; searched too. Defaults to the option itself. */
  labelOf?: (opt: string) => string
}): React.JSX.Element {
  const [q, setQ] = useState('')
  // The selection as the menu opened; it stays on top (checked or not) so rows don't jump while clicking.
  const [pinned, setPinned] = useState<string[]>([])
  const search = useRef<HTMLInputElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const needle = q.trim().toLowerCase()
  const matches = (
    needle ? options.filter((o) => labelOf(o).toLowerCase().includes(needle)) : options
  ).filter((o) => !pinned.includes(o))
  const shown = matches.slice(0, SHOWN_MAX)

  const item = (opt: string): React.JSX.Element => (
    <DropdownMenuCheckboxItem
      key={opt}
      checked={selected.includes(opt)}
      onSelect={(e) => e.preventDefault()}
      onCheckedChange={(on) => {
        const next = on ? [...selected, opt] : selected.filter((s) => s !== opt)
        onChange(next.length > 0 ? next : undefined)
      }}
    >
      {labelOf(opt)}
    </DropdownMenuCheckboxItem>
  )

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) return setQ('')
        setPinned(selected)
        // After the menu has taken focus itself on opening. Not on the phone, where focusing
        // the box would raise the keyboard over the options; a tap on it searches there.
        if (!isPhone()) requestAnimationFrame(() => search.current?.focus())
      }}
    >
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
      <DropdownMenuContent ref={content} align="start" className="max-h-80 w-64 overflow-y-auto">
        <input
          ref={search}
          aria-label={`Search ${label.toLowerCase()}`}
          placeholder={`Search ${label.toLowerCase()}…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              content.current?.querySelector<HTMLElement>('[role="menuitemcheckbox"]')?.focus()
            }
            // Keep typing in the box instead of the menu's type-ahead.
            e.stopPropagation()
          }}
          className="mb-1 h-8 w-full rounded-sm border border-input bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
        />
        {pinned.map(item)}
        {pinned.length > 0 && shown.length > 0 && <DropdownMenuSeparator />}
        {pinned.length === 0 && shown.length === 0 && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">No options</div>
        )}
        {shown.map(item)}
        {matches.length > SHOWN_MAX && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {matches.length - SHOWN_MAX} more — search to narrow
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
