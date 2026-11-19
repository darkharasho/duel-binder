import { gradeTitle, type GradedCopy } from '@shared/graded'
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

/**
 * The headline price of a panel opened on a slab: its grader and grade's price, not the raw
 * card's. The value entered, else eBay's asking price for that grade, else "No graded price" with
 * the raw card's price under it for scale.
 */
export function SlabPanelPrice({ slab }: { slab: GradedCopy }): React.JSX.Element {
  const title = gradeTitle(slab)
  if (slab.value !== null)
    return (
      <p>
        <span className={LABEL}>Your value · {title}</span>{' '}
        <span className={FIGURE}>{formatUsd(slab.value)}</span>
      </p>
    )
  if (slab.market)
    return (
      <div className="space-y-0.5">
        <p>
          <span className={LABEL}>eBay asking price · {title}</span>{' '}
          <span className={FIGURE}>{formatUsd(slab.market.price)}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Median of {slab.market.listings} {slab.market.listings === 1 ? 'listing' : 'listings'}
        </p>
      </div>
    )
  return (
    <div className="space-y-0.5">
      <p>
        <span className={LABEL}>Graded price · {title}</span>{' '}
        <span className="block text-lg leading-tight text-muted-foreground">
          No graded price yet
        </span>
      </p>
      {slab.rawPrice !== null && (
        <p className="text-xs text-muted-foreground tabular-nums">
          Raw card: {formatUsd(slab.rawPrice)}
        </p>
      )}
    </div>
  )
}
