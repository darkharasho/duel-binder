import type { EntryView } from '@shared/types'
import { EbayPriceLine, EntryValue } from '@/features/collection/EntryValue'
import { formatUsd } from '@/lib/format'

/**
 * The price line of a card side panel. When the user owns the viewed printing (`entry`), it shows
 * the collection's own price for it (eBay marker, listings and date, or "No price" with its
 * reason); otherwise the YGOPRODeck `price`, labelled by `label`. Null when there is nothing to show.
 */
export function PanelPrice({
  entry,
  price,
  label
}: {
  entry: EntryView | undefined
  price: number | null
  label: string
}): React.JSX.Element | null {
  if (entry) {
    return (
      <div className="space-y-0.5">
        <p className="text-sm">
          <span className="text-muted-foreground">Market price · {entry.printing.setRarity}</span>{' '}
          <span className="font-medium">
            <EntryValue entry={entry} amount={entry.unitPrice} />
          </span>
        </p>
        <EbayPriceLine entry={entry} />
      </div>
    )
  }
  if (price === null) return null
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">Market price · {label}</span>{' '}
      <span className="font-medium tabular-nums">{formatUsd(price)}</span>
    </p>
  )
}
