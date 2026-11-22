import { useState } from 'react'
import { ChevronUpIcon, CopyIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { DeckProblem, DeckVerdict } from '@shared/decks/check'
import type { DeckCost } from '@shared/decks/cost'
import type { DeckCard } from '@shared/decks/types'
import type { Printing } from '@shared/types'
import { BuyLinks } from '@/components/BuyLinks'
import { Button } from '@/components/ui/button'
import { formatUsd } from '@/lib/format'
import { isPhone } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { BADGE } from './deckEntries'

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

/** The verdict, its problems and what is left to buy; beside the deck, or a bottom sheet on phone. */
export function FeedbackPanel({
  verdict,
  cost,
  cards,
  priceRegion,
  onProblem
}: {
  /** Null while the rules are being read. */
  verdict: DeckVerdict | null
  cost: DeckCost | null
  cards: Record<number, DeckCard>
  priceRegion: 'en' | 'asia'
  onProblem: (p: DeckProblem) => void
}): React.JSX.Element {
  const phone = isPhone()
  const [open, setOpen] = useState(false)
  const badge = verdict && (
    <div className={cn('text-sm font-medium', BADGE[verdict.status])}>{verdict.badge}</div>
  )
  const body = (
    <div className="space-y-4">
      {!phone && badge}
      {verdict && verdict.problems.length > 0 && (
        <ul aria-label="Problems" className="space-y-1">
          {verdict.problems.map((p) => (
            <li key={p.key}>
              <button
                type="button"
                onClick={() => {
                  if (phone) setOpen(false)
                  onProblem(p)
                }}
                className={cn(
                  'w-full rounded-md px-2 py-1 text-left text-xs hover:bg-accent',
                  p.severity === 'error' ? 'text-destructive' : 'text-amber-500'
                )}
              >
                {p.message}
              </button>
            </li>
          ))}
        </ul>
      )}
      {cost && <MissingCards cost={cost} cards={cards} priceRegion={priceRegion} />}
    </div>
  )
  if (!phone)
    return (
      <aside
        aria-label="Deck check"
        className="space-y-4 rounded-lg border bg-card/60 p-3 lg:sticky lg:top-4"
      >
        {body}
      </aside>
    )
  return (
    <aside
      aria-label="Deck check"
      className="fixed inset-x-0 bottom-0 z-40 rounded-t-2xl border-t bg-popover/95 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 py-1"
      >
        {badge ?? <span className="text-sm text-muted-foreground">Checking…</span>}
        <ChevronUpIcon className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="max-h-[60dvh] overflow-y-auto pt-2">{body}</div>}
    </aside>
  )
}

function MissingCards({
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
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Missing cards</h3>
        <Button variant="ghost" size="sm" onClick={() => void copy()}>
          <CopyIcon className="size-3.5" />
          Copy as list
        </Button>
      </div>
      <div className="text-sm tabular-nums">
        {`Total ${formatUsd(cost.total)}${cost.unpricedCopies > 0 ? ` +${cost.unpricedCopies} unpriced` : ''}`}
      </div>
      <ul aria-label="Missing cards" className="space-y-2">
        {cost.missing.map((m) => (
          <li key={m.card} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">{`${m.copies} × ${nameOf(m.card)}`}</span>
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
