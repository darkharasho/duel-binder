import { useRef, useState } from 'react'
import { useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { englishSetName } from '@shared/setNames'
import type { BrowsePage, ChecklistCard, EntryView, Printing, SetChecklist } from '@shared/types'
import { LanguageTag } from '@/components/LanguageTag'
import { pickableRow } from '@/components/pickableRow'
import { Button } from '@/components/ui/button'
import { replaceChecklistCard } from '@/features/sets/setsView'
import { api, mutationInvalidationKeys, queryKeys } from '@/lib/api'
import { formatUsd } from '@/lib/format'
import { createSerialQueue } from '@/lib/serialQueue'
import { cn } from '@/lib/utils'
import type { CardTypeRow } from './cardTypes'

interface CardTypeListProps {
  cardId: number
  cardName: string
  rows: CardTypeRow[]
  copies: EntryView[] | undefined
  /** The row the panel shows. */
  selectedKey: string | undefined
  onSelect: (row: CardTypeRow) => void
}

/** The list's clicks not yet answered, in queue order, over the server's last count per printing. */
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
 * Every type of a card, owned or not: the row picked is what the panel shows, and a −/count/+ on a
 * row goes through `sets.adjust`, the path the Sets page uses. Give it a key per card so counts in
 * flight never carry over.
 */
export function CardTypeList({
  cardId,
  cardName,
  rows,
  copies,
  selectedKey,
  onSelect
}: CardTypeListProps): React.JSX.Element {
  const qc = useQueryClient()
  const queue = useRef(createSerialQueue())
  const [pending, setPending] = useState(0)
  const flight = useRef<InFlight | null>(null)
  // Counts shown since the last click, with the forCard data they were shown over.
  const [local, setLocal] = useState<{
    base: EntryView[] | undefined
    counts: Map<number, number>
  } | null>(null)
  const printingIds = [...new Set(rows.map((r) => r.printing.id))]
  const serverOwned = (printingId: number): number =>
    (copies ?? []).filter((c) => c.printing.id === printingId).reduce((n, c) => n + c.quantity, 0)
  // Our counts hold until forCard catches up (it is refetched once the clicks are done).
  const overlay = local && (pending > 0 || local.base === copies) ? local.counts : null
  const ownedOf = (printingId: number): number =>
    overlay?.get(printingId) ?? serverOwned(printingId)
  const total =
    (copies ?? []).reduce((n, c) => n + c.quantity, 0) +
    printingIds.reduce((n, id) => n + ownedOf(id) - serverOwned(id), 0)

  /**
   * Queues one +/- of a printing. The count moves at once; each answer from the server becomes
   * the confirmed count with later clicks re-applied. Browse pages get the card's new owned count
   * patched in, and other lists refresh in the background once the clicks are done.
   */
  const adjust = (p: Printing, delta: 1 | -1): void => {
    if (!flight.current)
      flight.current = { confirmed: new Map(printingIds.map((id) => [id, ownedOf(id)])), ops: [] }
    const f = flight.current
    const show = (): void =>
      setLocal({ base: qc.getQueryData(queryKeys.forCard(cardId)), counts: countsOf(f) })
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
        if (after !== before) patchBrowseOwned(qc, cardId, after - before)
        // The set page behind the panel shows the new count at once, as its own steppers do.
        qc.setQueryData<SetChecklist | null>(
          queryKeys.setChecklist(p.setName, p.language),
          (old) => (old ? replaceChecklistCard(old, answer) : old)
        )
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
    <section aria-label="Printings" className="space-y-2">
      <h3 className="text-sm font-medium">
        {total > 0 ? `You have ${total}` : 'You have none yet'}
      </h3>
      {rows.map((row) => {
        const p = row.printing
        const name = `${cardName} ${p.setCode} ${p.setRarity}`
        // Rows of one printing need telling apart.
        const label = row.key.startsWith('e') ? `${name} entry ${row.entry?.id}` : name
        const owned = ownedOf(p.id)
        const price = row.entry ? row.entry.unitPrice : p.setPrice
        return (
          <div
            key={row.key}
            role="group"
            aria-label={label}
            {...pickableRow(
              row.key === selectedKey,
              () => onSelect(row),
              'flex items-center gap-1.5'
            )}
          >
            <div className="min-w-0 flex-1 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="truncate">{englishSetName(p.setName, p.setCode)}</span>
                <LanguageTag language={p.language} />
              </div>
              <div className="truncate text-muted-foreground">
                {p.setCode} · {p.setRarity}
              </div>
            </div>
            {price !== null && (
              <span className="text-xs text-muted-foreground tabular-nums">{formatUsd(price)}</span>
            )}
            {row.stepper ? (
              <>
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
                    owned === 0 ? 'text-muted-foreground' : 'font-semibold',
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
              </>
            ) : (
              <span className="px-1 text-sm font-semibold tabular-nums">
                ×{row.entry?.quantity}
              </span>
            )}
          </div>
        )
      })}
    </section>
  )
}
