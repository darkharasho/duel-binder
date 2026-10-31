import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const CHIP = 'inline-flex h-7 shrink-0 items-center gap-1 rounded-md whitespace-nowrap text-xs'

/** An active filter under the search row, with an x to remove it. */
export function FilterChip({
  label,
  onRemove
}: {
  label: string
  onRemove: () => void
}): React.JSX.Element {
  return (
    <span className={cn(CHIP, 'bg-white/[0.08] pl-2.5 pr-1')}>
      {label}
      <button
        type="button"
        aria-label={`Remove ${label} filter`}
        onClick={onRemove}
        className="rounded-sm p-0.5 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

/** A choice in the filter panel; same chip, pressed when it's on. */
export function FilterOptionChip({
  label,
  count,
  selected,
  onClick
}: {
  label: string
  count?: number
  selected: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        CHIP,
        'px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'bg-primary text-primary-foreground' : 'bg-white/[0.08] hover:bg-white/[0.14]'
      )}
    >
      {label}
      {count !== undefined && <span className="tabular-nums opacity-70">{count}</span>}
    </button>
  )
}
