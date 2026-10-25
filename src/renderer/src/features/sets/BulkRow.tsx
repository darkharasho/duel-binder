import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import type { ChecklistCard, ChecklistRarity } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'

interface BulkRowProps {
  card: ChecklistCard
  rarity: ChecklistRarity
  busy: boolean
  onAdjust: (printingId: number, delta: 1 | -1) => void
  /** Shows the rarity's price before the stepper (the side panel has room; bulk tiles don't). */
  showPrice?: boolean
}

/** One rarity of a card in bulk mode: a code picker and a −/count/+ stepper. */
export function BulkRow({
  card,
  rarity,
  busy,
  onAdjust,
  showPrice
}: BulkRowProps): React.JSX.Element {
  const [chosenId, setPrintingId] = useState(rarity.defaultPrintingId)
  // A sync can drop the chosen printing; fall back to the default rather than adjusting a dead id.
  const printingId = rarity.codes.some((c) => c.printingId === chosenId)
    ? chosenId
    : rarity.defaultPrintingId
  const selected = rarity.codes.find((c) => c.printingId === printingId)
  const label = `${card.name} ${rarity.rarity}`
  const showOwned = rarity.codes.filter((c) => c.owned > 0).length > 1

  return (
    <div role="group" aria-label={label} className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1 text-xs">
        {rarity.codes.length === 1 ? (
          <span className="block truncate text-muted-foreground">
            {rarity.rarity} · {rarity.codes[0].setCode}
          </span>
        ) : (
          <Select value={String(printingId)} onValueChange={(v) => setPrintingId(Number(v))}>
            <SelectTrigger
              size="sm"
              aria-label={`Set code for ${label}`}
              className="h-7 w-full px-2 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {rarity.codes.map((c) => (
                <SelectItem key={c.printingId} value={String(c.printingId)}>
                  {c.setCode}
                  {showOwned && c.owned > 0 && ` ×${c.owned}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {showPrice && rarity.price !== null && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatUsd(rarity.price)}
        </span>
      )}
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={`Remove one ${label}`}
        disabled={!selected || selected.owned === 0}
        onClick={() => onAdjust(printingId, -1)}
      >
        <Minus />
      </Button>
      <span
        aria-busy={busy}
        className={cn('w-6 text-center text-sm tabular-nums', busy && 'text-muted-foreground')}
      >
        {rarity.owned}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={`Add one ${label}`}
        onClick={() => onAdjust(printingId, 1)}
      >
        <Plus />
      </Button>
    </div>
  )
}
