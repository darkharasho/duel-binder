import { memo } from 'react'
import { Minus, Plus } from 'lucide-react'
import type { ChecklistCard, ChecklistRarity } from '@shared/types'
import { CardArt } from '@/components/CardArt'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { formatUsd } from '@/lib/format'
import { rarityColor, rarityTextColor } from '@/lib/rarityColors'
import { cn } from '@/lib/utils'

interface BulkTileProps {
  card: ChecklistCard
  rarity: ChecklistRarity
  /** The chosen code's printing; the parent owns the choice. */
  printingId: number
  onPickCode: (printingId: number) => void
  /** Called instead of returning focus to the code picker when it closes. */
  onPickerClose?: () => void
  busy: boolean
  highlighted: boolean
  onAdjust: (printingId: number, delta: 1 | -1) => void
}

/** Keeps focus in bulk mode's search box when a tile button is clicked. */
const keepFocus = (e: React.MouseEvent): void => e.preventDefault()

/** One rarity of a card in bulk mode: a big photo, its code, and a −/count/+ stepper. */
export const BulkTile = memo(function BulkTile({
  card,
  rarity,
  printingId: chosenId,
  onPickCode,
  onPickerClose,
  busy,
  highlighted,
  onAdjust
}: BulkTileProps): React.JSX.Element {
  // A sync can drop the chosen printing; fall back to the default rather than adjusting a dead id.
  const printingId = rarity.codes.some((c) => c.printingId === chosenId)
    ? chosenId
    : rarity.defaultPrintingId
  const selected = rarity.codes.find((c) => c.printingId === printingId)
  const label = `${card.name} ${rarity.rarity}`
  const showOwned = rarity.codes.filter((c) => c.owned > 0).length > 1
  const owned = rarity.owned > 0

  return (
    <li>
      <div
        role="group"
        aria-label={label}
        aria-current={highlighted || undefined}
        data-tile-key={`${card.cardId}:${rarity.rarity}`}
        data-highlighted={highlighted}
        data-owned={owned}
        className={cn(
          'flex flex-col gap-1.5 rounded-lg bg-card p-1.5',
          owned && 'ring-2 ring-emerald-500',
          // Declared after the owned ring so the highlight wins when both apply.
          highlighted && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
        )}
      >
        <div className="relative">
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={keepFocus}
            aria-label={`Add one ${label} (photo)`}
            onClick={() => onAdjust(printingId, 1)}
            className="block w-full cursor-pointer rounded-[6px]"
          >
            <CardArt
              imageId={card.imageId}
              size="small"
              alt={card.name}
              printingId={printingId}
              className="w-full"
            />
          </button>
          <span
            style={{
              backgroundColor: rarityColor(rarity.rarity),
              color: rarityTextColor(rarity.rarity)
            }}
            className="pointer-events-none absolute top-1 left-1 rounded-full px-2 py-0.5 text-[10px] leading-none font-semibold shadow-sm"
          >
            {rarity.rarity}
          </span>
        </div>
        <div className="min-w-0 px-0.5 text-xs">
          <div className="flex items-baseline justify-between gap-1">
            <span className="truncate text-muted-foreground">{selected?.setCode}</span>
            {rarity.price !== null && (
              <span className="text-muted-foreground tabular-nums">{formatUsd(rarity.price)}</span>
            )}
          </div>
          <div className="truncate font-medium">{card.name}</div>
        </div>
        {rarity.codes.length > 1 && (
          <Select value={String(printingId)} onValueChange={(v) => onPickCode(Number(v))}>
            <SelectTrigger
              size="sm"
              aria-label={`Set code for ${label}`}
              className="h-7 w-full px-2 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              onCloseAutoFocus={
                onPickerClose
                  ? (e) => {
                      e.preventDefault()
                      onPickerClose()
                    }
                  : undefined
              }
            >
              {rarity.codes.map((c) => (
                <SelectItem key={c.printingId} value={String(c.printingId)}>
                  {c.setCode}
                  {showOwned && c.owned > 0 && ` ×${c.owned}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center justify-between gap-1.5">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={`Remove one ${label}`}
            onMouseDown={keepFocus}
            disabled={!selected || selected.owned === 0}
            onClick={() => onAdjust(printingId, -1)}
          >
            <Minus />
          </Button>
          <span
            aria-busy={busy}
            className={cn('text-center text-sm tabular-nums', busy && 'text-muted-foreground')}
          >
            {rarity.owned}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={`Add one ${label}`}
            onMouseDown={keepFocus}
            onClick={() => onAdjust(printingId, 1)}
          >
            <Plus />
          </Button>
        </div>
      </div>
    </li>
  )
})
