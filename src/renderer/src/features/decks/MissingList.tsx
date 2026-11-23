import { CopyIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { DeckCost } from '@shared/decks/cost'
import type { DeckCard } from '@shared/decks/types'
import type { Printing } from '@shared/types'
import { BuyLinks } from '@/components/BuyLinks'
import { Button } from '@/components/ui/button'
import { formatUsd } from '@/lib/format'
import { unknownCardText } from './deckEntries'

/** A buy search by name: the deck holds cards, not printings to buy. */
const anyPrinting = (cardId: number, region: 'en' | 'asia'): Printing => ({
  id: 0,
  cardId,
  setName: '',
  setCode: '',
  setRarity: '',
  setRarityCode: '',
  setPrice: null,
  missingFromApi: false,
  language: region === 'asia' ? 'ja' : 'en'
})

/** The copies the deck needs that you don't own: what they cost, where to buy, copy as a list. */
export function MissingList({
  cost,
  cards,
  priceRegion
}: {
  cost: DeckCost
  cards: Record<number, DeckCard>
  priceRegion: 'en' | 'asia'
}): React.JSX.Element {
  const nameOf = (id: number): string => cards[id]?.name ?? `Card #${id}`
  if (cost.missing.length === 0)
    return <p className="text-sm text-muted-foreground">You own every card in this deck.</p>
  const copy = async (): Promise<void> => {
    const text = cost.missing.map((m) => `${m.copies} ${nameOf(m.card)}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied the missing cards')
    } catch {
      toast.error("Couldn't copy the list")
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm tabular-nums">
          {`Total ${formatUsd(cost.total)}${cost.unpricedCopies > 0 ? ` +${cost.unpricedCopies} unpriced` : ''}`}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void copy()}>
          <CopyIcon className="size-3.5" />
          Copy as list
        </Button>
      </div>
      <ul aria-label="Missing cards" className="space-y-2">
        {cost.missing.map((m) => (
          <li key={m.card} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">
                {`${m.copies} × ${cards[m.card] ? nameOf(m.card) : unknownCardText(m.card)}`}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatUsd(m.unit)}
              </span>
            </div>
            <BuyLinks
              card={{ id: m.card, name: nameOf(m.card) }}
              printing={anyPrinting(m.card, priceRegion)}
              compact
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
