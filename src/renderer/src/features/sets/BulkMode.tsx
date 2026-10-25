import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Search } from 'lucide-react'
import type { ChecklistCard } from '@shared/types'
import { Input } from '@/components/ui/input'
import { BulkTile } from './BulkTile'
import { JustAdded, type AddedItem } from './JustAdded'
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
  highlighted: boolean
  onPick: (key: string, printingId: number) => void
  onAdd: (tile: BulkTileData, printingId: number) => void
  adjustRef: RefObject<Adjust>
}

/** Gives one tile handlers that stay the same across renders, so its memo can hold. */
function BulkSlot({
  tile,
  printingId,
  busy,
  highlighted,
  onPick,
  onAdd,
  adjustRef
}: BulkSlotProps): React.JSX.Element {
  const { key, card, rarity } = tile
  const cardId = card.cardId
  const pick = useCallback((id: number) => onPick(key, id), [onPick, key])
  // Tile data is rebuilt on every count change; read it through a ref to keep `adjust` stable.
  const tileRef = useRef(tile)
  useEffect(() => {
    tileRef.current = tile
  })
  // A + joins the "Just added" strip like Enter does; a − only adjusts.
  const adjust = useCallback(
    (id: number, delta: 1 | -1) =>
      delta === 1 ? onAdd(tileRef.current, id) : void adjustRef.current(cardId, id, delta),
    [onAdd, adjustRef, cardId]
  )
  return (
    <BulkTile
      card={card}
      rarity={rarity}
      printingId={printingId ?? rarity.defaultPrintingId}
      onPickCode={pick}
      busy={busy}
      highlighted={highlighted}
      onAdjust={adjust}
    />
  )
}

/** The tile's chosen printing, or its default when unset or no longer among its codes. */
function printingFor(tile: BulkTileData, chosen: number | undefined): number {
  const { codes, defaultPrintingId } = tile.rarity
  return codes.some((c) => c.printingId === chosen) ? chosen! : defaultPrintingId
}

export function BulkMode({ cards, pending, adjust }: BulkModeProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  // The code chosen per tile (key -> printing); unset means the rarity's default. Kept here, not
  // in the tile, so a choice survives the tile leaving the grid while the search narrows.
  const [chosen, setChosen] = useState<Record<string, number>>({})
  // The tile Enter adds, by key; null (or a key no longer shown) means the first visible tile.
  const [highlightKey, setHighlightKey] = useState<string | null>(null)
  const [added, setAdded] = useState<AddedItem[]>([])
  const nextId = useRef(0)
  const tiles = useMemo(() => bulkTiles(filterBulkCards(cards, query)), [cards, query])
  const highlight = tiles.some((t) => t.key === highlightKey)
    ? highlightKey
    : (tiles[0]?.key ?? null)
  const grid = useRef<HTMLUListElement>(null)
  const adjustRef = useRef(adjust)
  useEffect(() => {
    adjustRef.current = adjust
  })
  const pick = useCallback(
    (key: string, printingId: number) => setChosen((c) => ({ ...c, [key]: printingId })),
    []
  )

  useEffect(() => {
    // jsdom has no scrollIntoView.
    grid.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [highlight])

  /** The one way to add: Enter, a tile's + and its photo all list the card under "Just added". */
  const add = useCallback((tile: BulkTileData, printingId: number) => {
    const { card, rarity } = tile
    const item: AddedItem = {
      id: nextId.current++,
      cardId: card.cardId,
      printingId,
      name: card.name,
      rarity: rarity.rarity,
      setCode: rarity.codes.find((c) => c.printingId === printingId)?.setCode ?? '',
      imageId: card.imageId
    }
    setAdded((list) => [...list, item])
    void adjustRef.current(card.cardId, printingId, 1).then((saved) => {
      // A failed save was rolled back already, so there is nothing left to undo.
      if (!saved) setAdded((list) => list.filter((i) => i.id !== item.id))
    })
  }, [])

  const undo = (id: number): void => {
    const item = added.find((i) => i.id === id)
    if (!item) return
    setAdded((list) => list.filter((i) => i.id !== id))
    void adjust(item.cardId, item.printingId, -1)
  }

  const changeQuery = (q: string): void => {
    setQuery(q)
    setHighlightKey(null)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowUp': {
        if (tiles.length === 0) return
        e.preventDefault()
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
        const at = tiles.findIndex((t) => t.key === highlight)
        const next = Math.min(tiles.length - 1, Math.max(0, at + step))
        setHighlightKey(tiles[next].key)
        return
      }
      case 'Enter': {
        const tile = tiles.find((t) => t.key === highlight)
        if (!tile) return
        e.preventDefault()
        add(tile, printingFor(tile, chosen[tile.key]))
        changeQuery('')
        return
      }
      case 'Backspace': {
        const newest = added[added.length - 1]
        if (query !== '' || !newest) return
        e.preventDefault()
        undo(newest.id)
        return
      }
      case 'Escape':
        if (query === '') return
        // Keep Esc from also leaving the set.
        e.preventDefault()
        e.stopPropagation()
        changeQuery('')
    }
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      <div className="space-y-3 md:sticky md:top-4 md:w-72 md:shrink-0">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a card number or name"
            aria-label="Type a card number or name"
            className="pl-8"
          />
        </div>
        <JustAdded items={added} onUndo={undo} />
      </div>
      <div className="min-w-0 flex-1 space-y-4">
        {tiles.length === 0 && query.trim() !== '' && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No cards in this set match &ldquo;{query.trim()}&rdquo;
          </p>
        )}
        <ul ref={grid} className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
          {tiles.map((tile) => (
            <BulkSlot
              key={tile.key}
              tile={tile}
              printingId={chosen[tile.key]}
              busy={(pending[tile.card.cardId] ?? 0) > 0}
              highlighted={tile.key === highlight}
              onPick={pick}
              onAdd={add}
              adjustRef={adjustRef}
            />
          ))}
        </ul>
      </div>
    </div>
  )
}
