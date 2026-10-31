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
import { WishToggle } from '@/features/wishlist/WishToggle'
import { api, invalidateAfterEdit, queryKeys } from '@/lib/api'
import { formatUsd } from '@/lib/format'
import { createSerialQueue } from '@/lib/serialQueue'
import { useCardWishes } from '@/lib/wishlist'
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

/** The list's clicks not yet answered, in queue order, over the server's last count per stepper. */
interface InFlight {
  confirmed: Map<string, number>
  ops: { key: string; delta: 1 | -1 }[]
}

function countsOf(f: InFlight): Map<string, number> {
  const counts = new Map(f.confirmed)
  for (const op of f.ops) counts.set(op.key, Math.max(0, (counts.get(op.key) ?? 0) + op.delta))
  return counts
}

/** What a row's −/+ counts: the printing's original-art copies, or the row's own entry. */
const countKey = (row: CardTypeRow): string =>
  row.viaPrinting ? `p${row.printing.id}` : `e${row.entry?.id}`

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

/**
 * A printing's owned count in the checklist card `sets.adjust` answers with. There is no card for
 * a printing the checklist leaves out: a contributed one, or a retired one once its last copy goes.
 */
const ownedIn = (card: ChecklistCard | undefined, printingId: number): number | undefined =>
  card?.rarities.flatMap((r) => r.codes).find((c) => c.printingId === printingId)?.owned

/**
 * Every type of a card, owned or not: the row picked is what the panel shows. A −/count/+ on a row
 * goes through `sets.adjust`, the path the Sets page uses, or edits the row's own entry when that
 * can't reach it (see CardTypeRow). Taking the last copy of an entry asks first, as the entry
 * editor's Remove does. Give it a key per card so counts in flight never carry over.
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
  const wishes = useCardWishes(cardId)
  const queue = useRef(createSerialQueue())
  const [pending, setPending] = useState(0)
  const flight = useRef<InFlight | null>(null)
  // Counts shown since the last click, with the forCard data they were shown over.
  const [local, setLocal] = useState<{
    base: EntryView[] | undefined
    counts: Map<string, number>
  } | null>(null)
  // The row whose last copy is waiting on Confirm.
  const [confirming, setConfirming] = useState<string | null>(null)
  const serverOwned = (row: CardTypeRow): number => row.entry?.quantity ?? 0
  // Our counts hold until forCard catches up (it is refetched once the clicks are done).
  const overlay = local && (pending > 0 || local.base === copies) ? local.counts : null
  const ownedOf = (row: CardTypeRow): number => overlay?.get(countKey(row)) ?? serverOwned(row)
  const total =
    (copies ?? []).reduce((n, c) => n + c.quantity, 0) +
    rows.reduce((n, row) => n + ownedOf(row) - serverOwned(row), 0)

  /** One +/- through `sets.adjust`; answers the printing's new count. */
  const adjustPrinting = async (p: Printing, delta: 1 | -1, before: number): Promise<number> => {
    const answer: ChecklistCard | undefined = await api.sets.adjust(
      p.setName,
      p.language,
      p.id,
      delta
    )
    // The set page behind the panel shows the new count at once, as its own steppers do.
    if (answer)
      qc.setQueryData<SetChecklist | null>(queryKeys.setChecklist(p.setName, p.language), (old) =>
        old ? replaceChecklistCard(old, answer) : old
      )
    return ownedIn(answer, p.id) ?? Math.max(0, before + delta)
  }

  /** Sets a row's own entry to `quantity`, removing it at 0; answers the entry's new count. */
  const adjustEntry = async (row: CardTypeRow, quantity: number): Promise<number> => {
    if (row.entry === undefined) throw new Error('This row has no copies')
    if (quantity > 0) await api.collection.update(row.entry.id, { quantity })
    else await api.collection.remove(row.entry.id)
    return Math.max(0, quantity)
  }

  /**
   * Queues one +/- of a row. The count moves at once; each answer from the server becomes
   * the confirmed count with later clicks re-applied. Browse pages get the card's new owned count
   * patched in, and other lists refresh in the background once the clicks are done.
   */
  const adjust = (row: CardTypeRow, delta: 1 | -1): void => {
    if (!flight.current)
      flight.current = { confirmed: new Map(rows.map((r) => [countKey(r), ownedOf(r)])), ops: [] }
    const f = flight.current
    const key = countKey(row)
    if (!f.confirmed.has(key)) f.confirmed.set(key, ownedOf(row))
    const show = (): void =>
      setLocal({ base: qc.getQueryData(queryKeys.forCard(cardId)), counts: countsOf(f) })
    f.ops.push({ key, delta })
    show()
    setPending((n) => n + 1)
    queue
      .current(async () => {
        const before = f.confirmed.get(key) ?? 0
        let after: number
        try {
          after = row.viaPrinting
            ? await adjustPrinting(row.printing, delta, before)
            : await adjustEntry(row, before + delta)
        } finally {
          f.ops.shift()
        }
        f.confirmed.set(key, after)
        if (after !== before) patchBrowseOwned(qc, cardId, after - before)
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
        void invalidateAfterEdit(qc, (k) => k[0] === 'browse')
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
        const owned = ownedOf(row)
        const price = row.entry ? row.entry.unitPrice : p.setPrice
        return (
          <div key={row.key} className="space-y-1">
            <div
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
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatUsd(price)}
                </span>
              )}
              {/* One heart per printing: its other rows are only other art. */}
              {row.key.startsWith('p') ? (
                <WishToggle
                  cardId={cardId}
                  printingId={p.id}
                  wanted={wishes.data?.some((w) => w.printingId === p.id) ?? false}
                  label={name}
                />
              ) : (
                <span aria-hidden className="size-8 shrink-0" />
              )}
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={`Remove one ${label}`}
                disabled={owned === 0}
                onClick={() => {
                  if (owned === 1 && row.entry) setConfirming(row.key)
                  else adjust(row, -1)
                }}
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
                // A removed entry has nothing left to add to; its row goes on the next refresh.
                disabled={owned === 0 && !row.viaPrinting}
                onClick={() => {
                  setConfirming(null)
                  adjust(row, 1)
                }}
              >
                <Plus />
              </Button>
            </div>
            {confirming === row.key && row.entry && (
              <div className="flex flex-wrap items-center gap-2 pl-2">
                <span className="text-sm">
                  {row.entry.notes ? 'Remove this entry and its notes?' : 'Remove this entry?'}
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setConfirming(null)
                    adjust(row, -1)
                  }}
                >
                  Confirm
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
