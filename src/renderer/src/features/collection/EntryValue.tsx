import type { EntryView } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatUsd } from '@/lib/format'

const APPROX_TIP = "Set price unavailable — using the card's general TCGplayer price"

/** A USD amount; approximate prices get a `≈` prefix and an explanatory tooltip. */
export function ValueText({
  amount,
  approximate
}: {
  amount: number | null
  approximate: boolean
}): React.JSX.Element {
  const text = formatUsd(amount)
  if (amount === null || !approximate) return <span className="tabular-nums">{text}</span>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="tabular-nums">
          <span aria-label="approximately">≈</span>
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent>{APPROX_TIP}</TooltipContent>
    </Tooltip>
  )
}

/** Total for display: null (shown as "—") when the entry has no price at all. */
export const displayTotal = (e: EntryView): number | null =>
  e.unitPrice === null ? null : e.totalValue

export function StaleBadge({ entry }: { entry: EntryView }): React.JSX.Element | null {
  if (!entry.printing.missingFromApi) return null
  return (
    <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-400">
      No longer in database — price may be stale
    </Badge>
  )
}
