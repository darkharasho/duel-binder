import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MinusIcon, MoreHorizontalIcon, PinIcon, PlusIcon } from 'lucide-react'
import type { SectionDef } from '@shared/decks/formats'
import type { DeckCard, DeckEntry } from '@shared/decks/types'
import { CardArt } from '@/components/CardArt'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { api, queryKeys } from '@/lib/api'
import { cn } from '@/lib/utils'
import { entryDomId, entryKey } from './deckEntries'

export interface EntryActions {
  onQty: (e: DeckEntry, delta: 1 | -1) => void
  onPin: (e: DeckEntry, printing: string | undefined) => void
  onRemove: (e: DeckEntry) => void
  onCover: (e: DeckEntry) => void
}

/** A section's header count and its entries, already sorted; `actions` absent = read-only. */
export function DeckSectionList({
  def,
  entries,
  cards,
  printingArt,
  have,
  cover,
  highlight,
  actions
}: {
  def: SectionDef
  entries: DeckEntry[]
  cards: Record<number, DeckCard>
  printingArt: Record<string, number>
  /** Owned copies given to each entry (by entryKey), shared out over the deck. */
  have: Map<string, number>
  cover: number | null
  highlight: string | null
  actions?: EntryActions
}): React.JSX.Element {
  const count = entries.reduce((n, e) => n + e.qty, 0)
  return (
    <section aria-label={def.label} id={`deck-section-${def.id}`} className="space-y-2">
      <h2 className="text-sm font-semibold tabular-nums">
        {`${def.label} ${count} / ${def.min}–${def.max}`}
      </h2>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No cards yet.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {entries.map((e) => {
            const key = entryKey(e)
            const card = cards[e.card]
            const name = card?.name ?? `Card #${e.card}`
            const imageId = (e.printing ? printingArt[e.printing] : undefined) ?? card?.imageId
            return (
              <li
                key={key}
                id={entryDomId(key)}
                aria-label={name}
                data-highlight={highlight === key ? 'true' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-1 py-1.5 transition-colors',
                  highlight === key && 'bg-primary/10 ring-2 ring-primary'
                )}
              >
                <div className="w-9 shrink-0">
                  {imageId ? (
                    <CardArt
                      imageId={imageId}
                      size="small"
                      alt=""
                      className="w-full rounded-[2px]"
                    />
                  ) : (
                    <div className="aspect-[59/86] rounded-[2px] bg-muted" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{name}</div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {e.printing && (
                      <span title={`Pinned printing ${e.printing}`} className="flex items-center">
                        <PinIcon aria-label="Pinned printing" className="size-3" />
                      </span>
                    )}
                    {cover === e.card && <span>Cover</span>}
                  </div>
                </div>
                <span
                  className="shrink-0 text-xs tabular-nums text-muted-foreground"
                  title="Owned / in this deck"
                >
                  {`${have.get(key) ?? 0}/${e.qty}`}
                </span>
                {actions && <EntryControls entry={e} name={name} actions={actions} />}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function EntryControls({
  entry,
  name,
  actions
}: {
  entry: DeckEntry
  name: string
  actions: EntryActions
}): React.JSX.Element {
  const [picking, setPicking] = useState(false)
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Remove a copy of ${name}`}
        onClick={() => actions.onQty(entry, -1)}
      >
        <MinusIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Add a copy of ${name}`}
        onClick={() => actions.onQty(entry, 1)}
      >
        <PlusIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Pin a printing of ${name}`}
        className={cn(entry.printing && 'text-primary')}
        onClick={() => setPicking(true)}
      >
        <PinIcon />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`More for ${name}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => actions.onCover(entry)}>Use as cover</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => actions.onRemove(entry)}>
            Remove from deck
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {picking && (
        <PrintingPicker
          entry={entry}
          name={name}
          onPick={(p) => {
            setPicking(false)
            actions.onPin(entry, p)
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}

/** The card's printings to pin one (or any printing); sets the entry's `printing` to its pkey. */
function PrintingPicker({
  entry,
  name,
  onPick,
  onClose
}: {
  entry: DeckEntry
  name: string
  onPick: (printing: string | undefined) => void
  onClose: () => void
}): React.JSX.Element {
  const q = useQuery({
    queryKey: queryKeys.card(entry.card),
    queryFn: () => api.cards.get(entry.card)
  })
  const printings = (q.data?.printings ?? []).filter((p) => p.pkey)
  const row = (selected: boolean): string =>
    cn(
      'flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
      selected && 'bg-accent'
    )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Printing of ${name}`}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-0.5 overflow-y-auto">
          <button type="button" className={row(!entry.printing)} onClick={() => onPick(undefined)}>
            Any printing
          </button>
          {q.isPending && <p className="px-2 text-xs text-muted-foreground">Loading printings…</p>}
          {q.isError && (
            <p className="px-2 text-xs text-destructive">Could not load the printings.</p>
          )}
          {printings.map((p) => (
            <button
              key={p.pkey}
              type="button"
              className={row(entry.printing === p.pkey)}
              onClick={() => onPick(p.pkey)}
            >
              <span className="min-w-0 truncate">{p.setName}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {`${p.setCode} · ${p.setRarity}`}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
