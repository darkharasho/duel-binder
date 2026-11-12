import { Heart } from 'lucide-react'
import { englishSetName } from '@shared/setNames'
import { CardArt } from '@/components/CardArt'
import { LanguageTag } from '@/components/LanguageTag'
import { pickableRow } from '@/components/pickableRow'
import { scanFor } from '@/components/scanFor'
import { useGame } from '@/lib/game'
import { formatUsd } from '@/lib/format'
import { rarityColor } from '@/lib/rarityColors'
import { cn } from '@/lib/utils'
import type { CardTypeRow } from './cardTypes'

interface OwnedCopiesProps {
  /**
   * The rows with an entry on them, and those of a printing owned at open whose last copy has
   * gone, in the list's order.
   */
  rows: CardTypeRow[]
  cardName: string
  /** The card's original art, for a line whose entry has gone. */
  originalImageId: number | undefined
  selectedKey?: string
  onSelect: (row: CardTypeRow) => void
  ownedOf: (row: CardTypeRow) => number
  /** Clicks are in flight; the stepper shows it. */
  pending: boolean
  /** Whether the printing is on the user's wishlist. */
  wished: (printingId: number) => boolean
  /** The row's −/count/+, and its last-copy confirm. */
  stepper: (row: CardTypeRow, label: string) => React.ReactNode
  /** Leaves out the set name, year and price, under the full list. */
  compact: boolean
}

/** A row's accessible name, as the full list names it: rows of one printing need telling apart. */
const rowLabel = (row: CardTypeRow, cardName: string): string => {
  const p = row.printing
  const name = `${cardName} ${p.setCode} ${p.setRarity}`
  return row.key.startsWith('e') ? `${name} entry ${row.entry?.id}` : name
}

/**
 * The user's copies of a card, one line per entry: its own art, so a copy on other art is told
 * apart at a glance, with set, rarity and a −/count/+. A printing owned at open keeps its line, at
 * 0, once its last copy goes. A line is picked as the full list's rows are.
 */
export function OwnedCopies({
  rows,
  cardName,
  originalImageId,
  selectedKey,
  onSelect,
  ownedOf,
  wished,
  stepper,
  compact
}: OwnedCopiesProps): React.JSX.Element {
  const { def } = useGame()
  return (
    <div className="space-y-1">
      {rows.map((row) => {
        const { entry, printing: p } = row
        const label = rowLabel(row, cardName)
        const year = (p.releaseDate ?? entry?.releaseDate)?.slice(0, 4)
        // A line whose entry has gone shows the printing's own scan over the card's art.
        const art = entry
          ? { imageId: entry.imageId, printingId: scanFor(entry) }
          : { imageId: p.artImageId ?? originalImageId, printingId: p.id }
        const price = entry ? entry.unitPrice : p.setPrice
        return (
          <div
            key={row.key}
            role="group"
            aria-label={label}
            {...pickableRow(
              row.key === selectedKey,
              () => onSelect(row),
              'flex flex-wrap items-center gap-x-2 gap-y-1'
            )}
          >
            {art.imageId !== undefined ? (
              <CardArt
                imageId={art.imageId}
                printingId={art.printingId}
                size="small"
                alt=""
                className={cn('shrink-0 rounded-[4px]', compact ? 'w-7' : 'w-9')}
              />
            ) : (
              <span aria-hidden className={cn('shrink-0', compact ? 'w-7' : 'w-9')} />
            )}
            <div className="min-w-0 flex-1 space-y-0.5 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[11px]">{p.setCode}</span>
                {compact && <LanguageTag language={p.language} />}
                {wished(p.id) && (
                  <Heart
                    role="img"
                    aria-label="On your wishlist"
                    className="size-3 shrink-0 fill-rose-400 text-rose-400"
                  />
                )}
              </div>
              {!compact && (
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-muted-foreground">
                    {englishSetName(p.setName, p.setCode)}
                  </span>
                  <LanguageTag language={p.language} />
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'inline-flex min-w-0 items-center gap-1 rounded-full border px-1.5 py-px text-[11px]',
                    // Gold while owned; a line taken to 0 greys.
                    ownedOf(row) > 0 ? 'border-amber-400/50' : 'border-border text-muted-foreground'
                  )}
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: rarityColor(p.setRarity, def.id) }}
                  />
                  <span className="truncate">{p.setRarity}</span>
                </span>
                {!compact && year && (
                  <span className="text-muted-foreground tabular-nums">{year}</span>
                )}
              </div>
            </div>
            {!compact && price !== null && (
              <span className="text-xs text-muted-foreground tabular-nums">{formatUsd(price)}</span>
            )}
            {stepper(row, label)}
          </div>
        )
      })}
    </div>
  )
}
