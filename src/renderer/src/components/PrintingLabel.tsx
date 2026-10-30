import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * A printing as every printing picker shows it: its code in a chip that never shrinks, then
 * "Set name - Rarity" truncated to fit, then an optional language tag. No chip when the printing
 * has no code. Build `chip` and `title` with @shared/printingLabel.
 */
export function PrintingLabel({
  chip,
  title,
  tag,
  className,
  chipClassName
}: {
  chip: string | null | undefined
  title: string
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
      <span className="min-w-0 truncate">{title}</span>
      {tag && ' '}
      {tag}
    </span>
  )
}
