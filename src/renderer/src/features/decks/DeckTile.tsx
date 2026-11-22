import { CardArt } from '@/components/CardArt'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'
import { formatOf } from '@shared/decks/formats'
import { checkDeck, verdictChange } from '@shared/decks/check'
import { deckCost } from '@shared/decks/cost'
import type { PackState } from '@shared/decks/pack'
import type { DeckCard, DeckSummary } from '@shared/decks/types'
import { BADGE, changeSummary } from './deckEntries'

/** One deck on the list: cover, name, format, counts, legality and what it costs to finish. */
export function DeckTile({
  deck,
  cards,
  pack,
  today,
  onOpen
}: {
  deck: DeckSummary
  cards: Record<number, DeckCard>
  pack: PackState | undefined
  today: string
  onOpen: () => void
}): React.JSX.Element {
  const format = formatOf(deck.game, deck.format)
  const verdict = pack ? checkDeck(deck, cards, pack, today) : null
  const change = verdict ? verdictChange(deck.lastSeen, verdict) : null
  const changed = change ? changeSummary(change.added) : null
  const count = (s: string): number =>
    deck.cards.reduce((n, e) => (e.section === s ? n + e.qty : n), 0)
  const cost = format ? deckCost(deck.cards, cards, format.priceRegion) : null
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        className="group/deck flex w-full gap-3 rounded-lg border bg-card/60 p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="w-16 shrink-0">
          {deck.coverImageId ? (
            <CardArt
              imageId={deck.coverImageId}
              size="small"
              alt=""
              className="w-full rounded-[2px]"
            />
          ) : (
            <div className="aspect-[59/86] rounded-[2px] bg-muted" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="truncate font-medium">{deck.name}</div>
          <div className="text-xs text-muted-foreground">{format?.label ?? deck.format}</div>
          <div className="text-xs tabular-nums">
            {`Main ${count('main')} · Extra ${count('extra')} · Side ${count('side')}`}
          </div>
          {verdict && (
            <div className={cn('text-xs font-medium', BADGE[verdict.status])}>{verdict.badge}</div>
          )}
          {change && (
            <div className="text-xs text-muted-foreground">
              <div>{`Changed with the ${change.version} list`}</div>
              {changed && <div className="truncate">{changed}</div>}
            </div>
          )}
          {cost && (
            <div className="text-xs tabular-nums">
              {cost.missing.length === 0
                ? 'Complete'
                : `${cost.total > 0 || cost.unpricedCopies === 0 ? formatUsd(cost.total) : ''}${
                    cost.unpricedCopies > 0
                      ? `${cost.total > 0 ? ' ' : ''}+${cost.unpricedCopies} unpriced`
                      : ''
                  }`}
            </div>
          )}
        </div>
      </button>
    </li>
  )
}
