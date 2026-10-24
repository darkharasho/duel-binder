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

/** The plain-language eBay price description: asking-price label + checked date + listing count. */
export function ebayPriceDetail(entry: EntryView): string {
  if (entry.unitPrice === null) return NO_PRICE_TIPS[entry.noPriceReason ?? 'unavailable']
  const parts = ['eBay asking price']
  if (entry.priceCheckedAt !== null) parts.push(`checked ${formatRelative(entry.priceCheckedAt)}`)
  if (entry.priceListingCount !== null)
    parts.push(`${entry.priceListingCount} ${entry.priceListingCount === 1 ? 'listing' : 'listings'}`)
  return parts.join(' · ')
}

/**
 * An entry's price. YGOPRODeck prices render as `ValueText`; eBay (non-English) prices carry a
 * visible "eBay" marker plus a tooltip with the asking-price label and checked date, or render as
 * "No price" with the reason.
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
    : entry.priceCheckedAt === null
      ? 'eBay asking price'
      : `eBay asking price · checked ${formatRelative(entry.priceCheckedAt)}`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {noPrice ? (
          <span className="text-muted-foreground">No price</span>
        ) : (
          <span className="inline-flex items-baseline gap-1">
            <span className="tabular-nums">{formatUsd(amount)}</span>
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              eBay
            </span>
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

/** Visible eBay price details for a non-English copy (entry detail); null for English copies. */
export function EbayPriceLine({ entry }: { entry: EntryView }): React.JSX.Element | null {
  if (entry.priceSource !== 'ebay') return null
  return <p className="text-xs text-muted-foreground">{ebayPriceDetail(entry)}</p>
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
