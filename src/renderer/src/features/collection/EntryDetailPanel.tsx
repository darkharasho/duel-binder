import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Language } from '@shared/languages'
import { printingChip, printingTitle } from '@shared/printingLabel'
import type { EntryView, UpdateEntryInput } from '@shared/types'
import { CardDetails } from '@/components/CardDetails'
import { PanelCardArt } from '@/components/PanelCardArt'
import type { PanelNav } from '@/components/panelNav'
import { scanFor } from '@/components/scanFor'
import { LanguageTag } from '@/components/LanguageTag'
import { PrintingLabel } from '@/components/PrintingLabel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { api, mutationInvalidationKeys, queryKeys } from '@/lib/api'
import { cn } from '@/lib/utils'
import { EbayPriceLine, EntryValue, StaleBadge, displayTotal } from './EntryValue'

interface Props {
  cardId: number
  entryId: number
  onSelectEntry: (entryId: number) => void
  onClose: () => void
  nav?: PanelNav
}

/** Edit form for one entry; remounted (via `key`) when the selected entry changes. */
function EntryEditor({
  entry,
  printings,
  onSelectEntry,
  onClose
}: {
  entry: EntryView
  printings: {
    id: number
    setCode: string
    setName: string
    setRarity: string
    language: Language
    missingFromApi: boolean
  }[]
  onSelectEntry: (entryId: number) => void
  onClose: () => void
}): React.JSX.Element {
  const qc = useQueryClient()
  const [quantity, setQuantity] = useState(String(entry.quantity))
  const [notes, setNotes] = useState(entry.notes)
  const [confirming, setConfirming] = useState(false)

  const invalidate = (): Promise<unknown[]> =>
    Promise.all(mutationInvalidationKeys.map((k) => qc.invalidateQueries({ queryKey: [...k] })))

  const update = useMutation({
    mutationFn: (patch: UpdateEntryInput) => api.collection.update(entry.id, patch),
    onSuccess: async (result) => {
      await invalidate()
      if (result.id !== entry.id) {
        onSelectEntry(result.id)
        toast.success('Merged with an existing entry')
      } else {
        toast.success('Saved')
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save')
  })

  const remove = useMutation({
    mutationFn: () => api.collection.remove(entry.id),
    onSuccess: async () => {
      await invalidate()
      toast.success(`Removed ${entry.card.name}`)
      onClose()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not remove')
  })

  const qtyNum = Number(quantity)
  const qtyValid = quantity.trim() !== '' && Number.isInteger(qtyNum) && qtyNum >= 1
  const dirty = qtyNum !== entry.quantity || notes !== entry.notes
  const busy = update.isPending || remove.isPending

  const save = (): void => {
    const patch: UpdateEntryInput = {}
    if (qtyNum !== entry.quantity) patch.quantity = qtyNum
    if (notes !== entry.notes) patch.notes = notes
    update.mutate(patch)
  }

  // The card's printings leave out contributed ones, but this entry's own printing must be listed
  // (contributed or not) or the picker shows nothing.
  const withOwn = printings.some((p) => p.id === entry.printing.id)
    ? printings
    : [...printings, entry.printing].sort((a, b) =>
        a.setCode < b.setCode ? -1 : a.setCode > b.setCode ? 1 : a.id - b.id
      )
  const choosable = withOwn.filter((p) => !p.missingFromApi || p.id === entry.printing.id)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Value</span>
        <EntryValue entry={entry} amount={displayTotal(entry)} />
      </div>
      <EbayPriceLine entry={entry} />
      <StaleBadge entry={entry} />

      <div className="space-y-1.5">
        <label htmlFor="entry-qty" className="text-sm font-medium">
          Quantity
        </label>
        <Input
          id="entry-qty"
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="w-28 tabular-nums"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="entry-notes" className="text-sm font-medium">
          Notes
        </label>
        <Input id="entry-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <Button onClick={save} disabled={!dirty || !qtyValid || busy}>
        Save changes
      </Button>

      {choosable.length > 1 && (
        <div className="space-y-1.5">
          <div className="text-sm font-medium">Printing</div>
          <Select
            value={String(entry.printing.id)}
            disabled={busy}
            onValueChange={(v) => update.mutate({ printingId: Number(v) })}
          >
            <SelectTrigger
              aria-label="Printing"
              className="w-full *:data-[slot=select-value]:min-w-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-w-[min(36rem,calc(100vw-2rem))]">
              {choosable.map((p) => {
                const label = { setCode: p.setCode, setName: p.setName, rarity: p.setRarity }
                return (
                  <SelectItem key={p.id} value={String(p.id)} className="*:[span]:last:min-w-0">
                    <PrintingLabel
                      chip={printingChip(label)}
                      title={printingTitle(label)}
                      tag={<LanguageTag language={p.language} />}
                    />
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="border-t pt-4">
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-sm">Remove this entry?</span>
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => remove.mutate()}>
              Confirm
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
            Remove
          </Button>
        )}
      </div>
    </div>
  )
}

/** An owned card with its copies and the selected entry's editor; rendered inside a CardSheet. */
export function EntryDetailPanel({
  cardId,
  entryId,
  onSelectEntry,
  onClose,
  nav
}: Props): React.JSX.Element {
  const detail = useQuery({
    queryKey: queryKeys.card(cardId),
    queryFn: () => api.cards.get(cardId)
  })
  const copies = useQuery({
    queryKey: queryKeys.forCard(cardId),
    queryFn: () => api.collection.forCard(cardId)
  })
  const entry = copies.data?.find((c) => c.id === entryId)
  // Keep the last art up while a stepped-to card's copies load, so the floated card stays put.
  const [lastEntry, setLastEntry] = useState(entry)
  if (entry && entry !== lastEntry) setLastEntry(entry)
  const artEntry = entry ?? lastEntry
  const card = detail.data?.card ?? entry?.card
  const typeLine = card ? [card.type, card.attribute, card.race].filter(Boolean).join(' · ') : ''

  return (
    <>
      <SheetHeader>
        <SheetTitle>{card?.name ?? 'Card'}</SheetTitle>
        <SheetDescription>{typeLine}</SheetDescription>
      </SheetHeader>
      <div className="space-y-5 px-4 pb-6">
        {artEntry && (
          <PanelCardArt
            imageId={artEntry.imageId}
            printingId={scanFor(artEntry)}
            alt={artEntry.card.name}
            nav={nav}
          />
        )}
        <CardDetails card={card} printing={entry?.printing} />

        {(copies.data?.length ?? 0) > 0 && (
          <section aria-label="Your copies" className="space-y-1.5">
            <h3 className="text-sm font-medium">Your copies</h3>
            <ul className="space-y-1">
              {copies.data?.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-current={c.id === entryId}
                    onClick={() => onSelectEntry(c.id)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      c.id === entryId ? 'bg-accent' : 'hover:bg-accent/50'
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      {c.printing.setCode} · {c.printing.setRarity}
                      <LanguageTag language={c.printing.language} />
                    </span>
                    <span className="tabular-nums text-muted-foreground">×{c.quantity}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {entry && (
          <EntryEditor
            key={`${entry.id}:${entry.updatedAt}`}
            entry={entry}
            printings={detail.data?.printings ?? []}
            onSelectEntry={onSelectEntry}
            onClose={onClose}
          />
        )}
      </div>
    </>
  )
}
