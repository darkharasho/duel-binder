import { useRef, useState } from 'react'
import { SearchInput } from '@/components/SearchInput'
import { Checkbox } from '@/components/ui/checkbox'

const SHOWN_MAX = 200

/** A long facet's list in the filter panel, with a search box; what's selected is listed first. */
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
  // The selection as the list opened; it stays on top (checked or not) so rows don't jump while clicking.
  const [pinned] = useState(selected)
  const list = useRef<HTMLDivElement>(null)
  const needle = q.trim().toLowerCase()
  const matches = (
    needle ? options.filter((o) => labelOf(o).toLowerCase().includes(needle)) : options
  ).filter((o) => !pinned.includes(o))
  const shown = matches.slice(0, SHOWN_MAX)

  const item = (opt: string): React.JSX.Element => (
    <label key={opt} className="flex items-center gap-2 rounded-sm px-1 py-1 text-sm">
      <Checkbox
        checked={selected.includes(opt)}
        onCheckedChange={(on) => {
          const next = on === true ? [...selected, opt] : selected.filter((s) => s !== opt)
          onChange(next.length > 0 ? next : undefined)
        }}
      />
      <span className="min-w-0 flex-1 truncate">{labelOf(opt)}</span>
    </label>
  )

  return (
    <div className="flex flex-col gap-2">
      <SearchInput
        label={`Search ${label.toLowerCase()}`}
        value={q}
        onChange={setQ}
        debounceMs={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            list.current?.querySelector<HTMLElement>('[role="checkbox"]')?.focus()
          }
        }}
      />
      <div ref={list} className="max-h-64 overflow-y-auto overscroll-contain">
        {pinned.map(item)}
        {pinned.length > 0 && shown.length > 0 && <hr className="my-1 border-white/[0.08]" />}
        {pinned.length === 0 && shown.length === 0 && (
          <div className="px-1 py-1.5 text-sm text-muted-foreground">No options</div>
        )}
        {shown.map(item)}
        {matches.length > SHOWN_MAX && (
          <div className="px-1 py-1.5 text-xs text-muted-foreground">
            {matches.length - SHOWN_MAX} more — search to narrow
          </div>
        )}
      </div>
    </div>
  )
}
