import { useRef, useState } from 'react'
import {
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient
} from '@tanstack/react-query'
import { Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { BrowseCard, BrowsePage, ChecklistCard, EntryView, Printing } from '@shared/types'
import { CardDetails } from '@/components/CardDetails'
import { PanelCardArt } from '@/components/PanelCardArt'
import type { PanelNav } from '@/components/panelNav'
import { PanelPrice } from '@/components/PanelPrice'
import { LanguageTag } from '@/components/LanguageTag'
import { Button } from '@/components/ui/button'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { api, mutationInvalidationKeys, queryKeys } from '@/lib/api'
import { createSerialQueue } from '@/lib/serialQueue'
import { formatUsd } from '@/lib/format'
import { cn } from '@/lib/utils'

interface BrowseCardPanelProps {
  card: BrowseCard
  /** Opens the full Add Card dialog (artwork, quantity, notes). */
  onMoreOptions: (printingId: number) => void
  nav?: PanelNav
}

/** The panel's clicks not yet answered, in queue order, over the server's last count per printing. */
interface InFlight {
  confirmed: Map<number, number>
  ops: { printingId: number; delta: 1 | -1 }[]
}

function countsOf(f: InFlight): Map<number, number> {
  const counts = new Map(f.confirmed)
  for (const op of f.ops)
    counts.set(op.printingId, Math.max(0, (counts.get(op.printingId) ?? 0) + op.delta))
  return counts
}

/** Moves a card's owned count in every cached Browse page, without refetching them. */
function patchBrowseOwned(qc: QueryClient, cardId: number, by: number): void {
  qc.setQueriesData<InfiniteData<BrowsePage>>(
    { queryKey: ['browse'], predicate: (q) => q.queryKey[1] !== 'facets' },
    (old) =>
      old?.pages
        ? {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              cards: page.cards.map((c) =>
                c.id === cardId ? { ...c, owned: Math.max(0, c.owned + by) } : c
              )
            }))
          }
        : old
  )
}

/** A printing's owned count in the checklist card `sets.adjust` answers with. */
const ownedIn = (card: ChecklistCard, printingId: number): number | undefined =>
  card.rarities.flatMap((r) => r.codes).find((c) => c.printingId === printingId)?.owned

/**
 * A card from Browse with a −/count/+ stepper per printing; English printings first.
 * Rendered inside a CardSheet; give it a key per card so counts in flight never carry over.
 */
export function BrowseCardPanel({
  card,
  onMoreOptions,
  nav
}: BrowseCardPanelProps): React.JSX.Element {
  const qc = useQueryClient()
  const queue = useRef(createSerialQueue())
  const [pending, setPending] = useState(0)
  const flight = useRef<InFlight | null>(null)
  // Counts shown since the last click, with the forCard data they were shown over.
  const [local, setLocal] = useState<{
    base: EntryView[] | undefined
    counts: Map<number, number>
  } | null>(null)
  const detail = useQuery({
    queryKey: queryKeys.card(card.id),
    queryFn: () => api.cards.get(card.id)
  })
  const copies = useQuery({
    queryKey: queryKeys.forCard(card.id),
    queryFn: () => api.collection.forCard(card.id)
  })
  const info = detail.data?.card
  const typeLine = info
    ? [info.type, info.attribute, info.race].filter(Boolean).join(' · ')
    : card.type
  const printings = [...(detail.data?.printings ?? [])].sort(
    (a, b) => Number(a.language !== 'en') - Number(b.language !== 'en')
  )
  const serverOwned = (printingId: number): number =>
    (copies.data ?? [])
      .filter((c) => c.printing.id === printingId)
      .reduce((n, c) => n + c.quantity, 0)
  // Our counts hold until forCard catches up (it is refetched once the clicks are done).
  const overlay = local && (pending > 0 || local.base === copies.data) ? local.counts : null
  const ownedOf = (printingId: number): number =>
    overlay?.get(printingId) ?? serverOwned(printingId)
  const total =
    (copies.data ?? []).reduce((n, c) => n + c.quantity, 0) +
    printings.reduce((n, p) => n + ownedOf(p.id) - serverOwned(p.id), 0)
  const moreFor = card.defaultPrintingId ?? printings[0]?.id
  // Price the printing the art shows; rarities of one card can differ by orders of magnitude.
  const shown = printings.find((p) => p.id === card.defaultPrintingId)
  const price = shown?.setPrice ?? card.price
  const priceLabel = shown?.setPrice != null ? shown.setRarity : 'cheapest printing'
  // An owned printing shows the price the collection shows (eBay-first), not YGOPRODeck's.
  const ownedEntry = shown ? (copies.data ?? []).find((c) => c.printing.id === shown.id) : undefined

  /**
   * Queues one +/- of a printing. The count moves at once; each answer from the server becomes
   * the confirmed count with later clicks re-applied. Browse pages get the card's new owned count
   * patched in, and other lists refresh in the background once the clicks are done.
   */
  const adjust = (p: Printing, delta: 1 | -1): void => {
    if (!flight.current)
      flight.current = { confirmed: new Map(printings.map((x) => [x.id, ownedOf(x.id)])), ops: [] }
    const f = flight.current
    const show = (): void =>
      setLocal({ base: qc.getQueryData(queryKeys.forCard(card.id)), counts: countsOf(f) })
    f.ops.push({ printingId: p.id, delta })
    show()
    setPending((n) => n + 1)
    queue
      .current(async () => {
        let answer: ChecklistCard
        try {
          answer = await api.sets.adjust(p.setName, p.language, p.id, delta)
        } finally {
          f.ops.shift()
        }
        const before = f.confirmed.get(p.id) ?? 0
        const after = ownedIn(answer, p.id) ?? Math.max(0, before + delta)
        f.confirmed.set(p.id, after)
        if (after !== before) patchBrowseOwned(qc, card.id, after - before)
      })
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : 'Could not update the collection')
      })
      .finally(() => {
        // A failed click is simply dropped: the counts roll back to the last confirmed ones.
        show()
        setPending((n) => n - 1)
        if (f.ops.length > 0) return
        flight.current = null
        // Mark Browse stale without refetching every loaded page; its counts are patched above.
        void qc.invalidateQueries({ queryKey: ['browse'], refetchType: 'none' })
        for (const k of mutationInvalidationKeys) {
          if (k[0] !== 'browse') void qc.invalidateQueries({ queryKey: [...k] })
        }
      })
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{card.name}</SheetTitle>
        <SheetDescription>{typeLine}</SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-4 pb-6">
        <PanelCardArt
          imageId={card.imageId}
          printingId={card.defaultPrintingId}
          alt={card.name}
          nav={nav}
        />
        <PanelPrice entry={ownedEntry} price={price} label={priceLabel} />

        <CardDetails card={info} printing={shown} />

        <section aria-label="Printings" className="space-y-2">
          <h3 className="text-sm font-medium">
            {total > 0 ? `You have ${total}` : 'You have none yet'}
          </h3>
          {printings.map((p) => {
            const owned = ownedOf(p.id)
            const label = `${card.name} ${p.setCode} ${p.setRarity}`
            return (
              <div key={p.id} role="group" aria-label={label} className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate">{p.setName}</span>
                    <LanguageTag language={p.language} />
                  </div>
                  <div className="truncate text-muted-foreground">
                    {p.setCode} · {p.setRarity}
                  </div>
                </div>
                {p.setPrice !== null && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatUsd(p.setPrice)}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Remove one ${label}`}
                  disabled={owned === 0}
                  onClick={() => adjust(p, -1)}
                >
                  <Minus />
                </Button>
                <span
                  aria-busy={pending > 0}
                  className={cn(
                    'w-6 text-center text-sm tabular-nums',
                    pending > 0 && 'text-muted-foreground'
                  )}
                >
                  {owned}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Add one ${label}`}
                  onClick={() => adjust(p, 1)}
                >
                  <Plus />
                </Button>
              </div>
            )
          })}
        </section>

        {moreFor !== undefined && (
          <Button variant="outline" size="sm" onClick={() => onMoreOptions(moreFor)}>
            More options…
          </Button>
        )}
      </div>
    </>
  )
}
