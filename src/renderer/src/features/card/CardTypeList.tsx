import { useId, useRef, useState } from 'react'
import { useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { Language } from '@shared/languages'
import type { BrowsePage, ChecklistCard, EntryView, Printing, SetChecklist } from '@shared/types'
import { Button } from '@/components/ui/button'
import { AddToBinder } from '@/features/binders/AddToBinder'
import { replaceChecklistCard } from '@/features/sets/setsView'
import { api, invalidateAfterEdit, queryKeys } from '@/lib/api'
import { formatUsd } from '@/lib/format'
import { createSerialQueue } from '@/lib/serialQueue'
import { useGame } from '@/lib/game'
import { useCardWishes } from '@/lib/wishlist'
import { cn } from '@/lib/utils'
import type { CardTypeRow } from './cardTypes'
import { OwnedCopies } from './OwnedCopies'
import { PrintingGroups } from './PrintingGroups'
import { printingSummary } from './printingGroups'

interface CardTypeListProps {
  cardId: number
  cardName: string
  rows: CardTypeRow[]
  copies: EntryView[] | undefined
  /** The row the panel shows. */
  selectedKey: string | undefined
  onSelect: (row: CardTypeRow) => void
  /** The card's original art; undefined until the card's details load. */
  originalImageId: number | undefined
  /** Printings owned when the panel opened: their lines stay, at 0, once the last copy goes. */
  ownedAtOpen: ReadonlySet<number>
  /** Opens on every printing rather than on the user's copies. Read once, on mount. */
  startExpanded: boolean
  /** Always on every printing, with no Show all or Show less: a set page's list is short. */
  alwaysExpanded?: boolean
  /** The set the panel was opened from: its row leads the full list. */
  preferSet?: { setName: string; language: Language }
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

/** A Yu-Gi-Oh! card with more types than this gets a box to narrow them. */
const SEARCH_FROM = 8

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
  onSelect,
  originalImageId,
  ownedAtOpen,
  startExpanded,
  alwaysExpanded = false,
  preferSet
}: CardTypeListProps): React.JSX.Element {
  const { def } = useGame()
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
  // The row whose last copy is waiting on Confirm, and where: a row can have a stepper both on its
  // owned line and in its pill's action row, and the confirm shows only under the one pressed.
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

  /**
   * A row's −/count/+, and the confirm under it when the − would take an entry's last copy. Each
   * place a row is edited calls this, so the count logic is one.
   */
  const renderStepper = (
    row: CardTypeRow,
    label: string,
    place: 'line' | 'action'
  ): React.ReactNode => {
    const owned = ownedOf(row)
    const confirmKey = `${place}:${row.key}`
    return (
      <>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={`Remove one ${label}`}
            disabled={owned === 0}
            onClick={() => {
              if (owned === 1 && row.entry) setConfirming(confirmKey)
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
        {confirming === confirmKey && row.entry && (
          <div className="flex basis-full flex-wrap items-center gap-2 pl-2">
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
      </>
    )
  }

  const selected = rows.find((r) => r.key === selectedKey)
  // A printing owned at open keeps its line after its last copy goes, so a − can be undone.
  const isOwnedLine = (r: CardTypeRow): boolean =>
    r.entry !== undefined || (r.viaPrinting && ownedAtOpen.has(r.printing.id))
  const owned = rows.filter(isOwnedLine)
  const value = owned.reduce(
    (sum, r) => sum + ownedOf(r) * ((r.entry ? r.entry.unitPrice : r.printing.setPrice) ?? 0),
    0
  )
  // Reset per card: the list is keyed by card.
  const [expandedState, setExpanded] = useState(startExpanded)
  const expanded = alwaysExpanded || expandedState
  // Over the full list, Your copies pins only what was owned at open: a copy added there shows on
  // its gold pill, so the list doesn't move under the cursor.
  const pinned = owned.filter((r) => ownedAtOpen.has(r.printing.id))
  // A printing with several entries is still one printing.
  const summary = printingSummary(
    rows.map((r) => r.printing).filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i),
    def.id,
    originalImageId
  )
  // Nothing to show past Your copies when every printing is already one of its lines.
  const ownedIds = new Set(owned.map((r) => r.printing.id))
  const hasUnowned = rows.some((r) => !ownedIds.has(r.printing.id))
  const summaryLine = [
    summary.arts > 1 && `${summary.arts} artworks`,
    summary.sets > 1 && `${summary.sets} sets`,
    summary.languages > 1 && `${summary.languages} languages`
  ]
    .filter(Boolean)
    .join(' · ')
  const wished = (printingId: number): boolean =>
    wishes.data?.some((w) => w.printingId === printingId) ?? false
  const yourCopiesId = useId()
  const ownedCopies = (compact: boolean): React.JSX.Element => (
    <OwnedCopies
      rows={compact ? pinned : owned}
      cardName={cardName}
      originalImageId={originalImageId}
      selectedKey={selectedKey}
      onSelect={onSelect}
      ownedOf={ownedOf}
      pending={pending > 0}
      wished={wished}
      stepper={(row, label) => renderStepper(row, label, 'line')}
      compact={compact}
    />
  )

  return (
    <section aria-label="Printings" className="space-y-2">
      <h3 className="text-sm font-medium">
        {total > 0 ? `You have ${total}` : 'You have none yet'}
        {total > 0 && value > 0 && (
          <span className="text-muted-foreground"> · worth {formatUsd(value)}</span>
        )}
      </h3>
      {!expanded && (
        <>
          {ownedCopies(false)}
          {hasUnowned && (
            <div className="space-y-1 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setExpanded(true)}
              >
                Show all {summary.printings} {summary.printings === 1 ? 'printing' : 'printings'}
              </Button>
              {summaryLine && (
                <p className="text-center text-xs text-muted-foreground">{summaryLine}</p>
              )}
            </div>
          )}
        </>
      )}
      {expanded && pinned.length > 0 && (
        <section aria-labelledby={yourCopiesId} className="space-y-1">
          <p id={yourCopiesId} className="text-xs font-medium text-muted-foreground">
            Your copies
          </p>
          {ownedCopies(true)}
        </section>
      )}
      {expanded && (
        <PrintingGroups
          game={def.id}
          cardId={cardId}
          cardName={cardName}
          rows={rows}
          originalImageId={originalImageId}
          selectedKey={selectedKey}
          onSelect={onSelect}
          ownedOf={ownedOf}
          stepper={(row, label) => renderStepper(row, label, 'action')}
          wished={wished}
          preferSet={preferSet}
          searchable={def.id === 'ygo' && rows.length > SEARCH_FROM}
        />
      )}
      {expanded && !alwaysExpanded && owned.length > 0 && (
        <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setExpanded(false)}>
          Show less
        </Button>
      )}
      <AddToBinder
        cardId={cardId}
        printing={
          selected?.printing.pkey
            ? {
                pkey: selected.printing.pkey,
                label: `${selected.printing.setCode} · ${selected.printing.setRarity}`
              }
            : undefined
        }
      />
    </section>
  )
}
