import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Search } from 'lucide-react'
import type { ChecklistCard } from '@shared/types'
import { Input } from '@/components/ui/input'
import { BulkTile } from './BulkTile'
import { bulkTiles, filterBulkCards, type BulkTileData } from './setsView'

type Adjust = (cardId: number, printingId: number, delta: 1 | -1) => Promise<boolean>

interface BulkModeProps {
  /** Frozen and sorted, not filtered by the page search: bulk mode has its own. */
  cards: ChecklistCard[]
  pending: Record<number, number>
  /** Resolves true when the server saved the click, false when it failed. */
  adjust: Adjust
}

interface BulkSlotProps {
  tile: BulkTileData
  printingId: number | undefined
  busy: boolean
  onPick: (key: string, printingId: number) => void
  adjustRef: RefObject<Adjust>
}

/** Gives one tile handlers that stay the same across renders, so its memo can hold. */
function BulkSlot({ tile, printingId, busy, onPick, adjustRef }: BulkSlotProps): React.JSX.Element {
  const { key, card, rarity } = tile
  const cardId = card.cardId
  const pick = useCallback((id: number) => onPick(key, id), [onPick, key])
  const adjust = useCallback(
    (id: number, delta: 1 | -1) => void adjustRef.current(cardId, id, delta),
    [adjustRef, cardId]
  )
  return (
    <BulkTile
      card={card}
      rarity={rarity}
      printingId={printingId ?? rarity.defaultPrintingId}
      onPickCode={pick}
      busy={busy}
      highlighted={false}
      onAdjust={adjust}
    />
  )
}

export function BulkMode({ cards, pending, adjust }: BulkModeProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  // The code chosen per tile (key -> printing); unset means the rarity's default. Kept here, not
  // in the tile, so a choice survives the tile leaving the grid while the search narrows.
  const [chosen, setChosen] = useState<Record<string, number>>({})
  const tiles = useMemo(() => bulkTiles(filterBulkCards(cards, query)), [cards, query])
  const adjustRef = useRef(adjust)
  useEffect(() => {
    adjustRef.current = adjust
  })
  const pick = useCallback(
    (key: string, printingId: number) => setChosen((c) => ({ ...c, [key]: printingId })),
    []
  )

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a card number or name"
          aria-label="Type a card number or name"
          className="pl-8"
        />
      </div>
      {tiles.length === 0 && query.trim() !== '' && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No cards in this set match &ldquo;{query.trim()}&rdquo;
        </p>
      )}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
        {tiles.map((tile) => (
          <BulkSlot
            key={tile.key}
            tile={tile}
            printingId={chosen[tile.key]}
            busy={(pending[tile.card.cardId] ?? 0) > 0}
            onPick={pick}
            adjustRef={adjustRef}
          />
        ))}
      </ul>
    </div>
  )
}
