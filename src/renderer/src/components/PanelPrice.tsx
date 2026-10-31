import type { EntryView } from '@shared/types'
import { EbayPriceLine, EntryValue } from '@/features/collection/EntryValue'
import { formatUsd } from '@/lib/format'

const LABEL = 'block text-xs text-muted-foreground'
const FIGURE = 'block text-3xl leading-tight font-semibold tabular-nums'

/**
 * The headline price of a card side panel. When the selected row is a collection entry (`entry`),
 * it shows the collection's own price for it (eBay marker, listings and date, or "No price" with
 * its reason); otherwise the YGOPRODeck `price`, labelled by `label`, or "No price" for a row with
 * none. Null when no row is selected and there is nothing to show. `plain` leaves the rarity out of
 * the label, for a panel that shows it on its own.
 */
export function PanelPrice({
  entry,
  price,
  label,
  plain = false
}: {
  entry: EntryView | undefined
  price: number | null
  label: string | undefined
  plain?: boolean
}): React.JSX.Element | null {
  if (entry) {
    return (
      <div className="space-y-0.5">
        <p>
          <span className={LABEL}>
            {plain ? 'Market price' : `Market price · ${entry.printing.setRarity}`}
          </span>{' '}
          <span className={FIGURE}>
            <EntryValue entry={entry} amount={entry.unitPrice} />
          </span>
        </p>
        <EbayPriceLine entry={entry} />
      </div>
    )
  }
  if (label === undefined) return null
  return (
    <p>
      <span className={LABEL}>{plain ? 'Market price' : `Market price · ${label}`}</span>{' '}
      {price === null ? (
        <span className="block text-lg leading-tight text-muted-foreground">No price</span>
      ) : (
        <span className={FIGURE}>{formatUsd(price)}</span>
      )}
    </p>
  )
}
