import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * "Set name - Rarity" fitted to its space: the set's name truncates first, as a long one would
 * otherwise push the rarity out of sight, and the hover text keeps the whole of it.
 */
export function PrintingTitle({
  title,
  rarity,
  className
}: {
  title: string
  rarity?: string
  className?: string
}): React.JSX.Element {
  return (
    <span className={cn('flex min-w-0', className)} title={rarity ? `${title} - ${rarity}` : title}>
      <span className="min-w-0 shrink-[9999] truncate">{title}</span>
      {rarity && ' '}
      {rarity && <span className="ml-1 min-w-0 truncate">{`- ${rarity}`}</span>}
    </span>
  )
}

/**
 * A printing as every printing picker shows it: its code in a chip that never shrinks, then
 * "Set name - Rarity" (see PrintingTitle), then an optional language tag. No chip when the
 * printing has no code. Build `chip`, `title` and `rarity` with @shared/printingLabel.
 */
export function PrintingLabel({
  chip,
  title,
  rarity,
  tag,
  className,
  chipClassName
}: {
  chip: string | null | undefined
  title: string
  rarity?: string
  /** A language tag or other trailing bit, kept whole after the truncated title. */
  tag?: React.ReactNode
  className?: string
  chipClassName?: string
}): React.JSX.Element {
  return (
    <span className={cn('flex min-w-0 flex-1 items-center gap-2', className)}>
      {/* The spaces are invisible in the flex row but keep the accessible name readable. */}
      {chip && (
        <Badge variant="secondary" className={cn('shrink-0 font-mono', chipClassName)}>
          {chip}
        </Badge>
      )}{' '}
      <PrintingTitle title={title} rarity={rarity} />
      {tag && ' '}
      {tag}
    </span>
  )
}
