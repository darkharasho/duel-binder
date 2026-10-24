import type { EntryView } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatRelative, formatUsd } from '@/lib/format'

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

const NO_PRICE_TIPS = {
  'no-listings': 'No eBay listings found',
  pending: 'Checking eBay…',
  unavailable: 'Prices unavailable'
} as const

/**
 * An entry's price. YGOPRODeck prices render as `ValueText`; eBay (non-English) prices are labelled
 * as asking prices with their checked date, or "No price" with the reason.
 */
export function EntryValue({
  entry,
  amount
}: {
  entry: EntryView
  amount: number | null
}): React.JSX.Element {
  if (entry.priceSource !== 'ebay') {
    return <ValueText amount={amount} approximate={entry.priceApproximate} />
  }
  const noPrice = amount === null
  const tip = noPrice
    ? NO_PRICE_TIPS[entry.noPriceReason ?? 'unavailable']
    : `eBay asking price · checked ${formatRelative(entry.priceCheckedAt)}`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={noPrice ? 'text-muted-foreground' : 'tabular-nums'}>
          {noPrice ? 'No price' : formatUsd(amount)}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
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
