import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { EntryView, UpdateEntryInput } from '@shared/types'
import { CardArt } from '@/components/CardArt'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { api, mutationInvalidationKeys, queryKeys } from '@/lib/api'
import { cn } from '@/lib/utils'
import { StaleBadge, ValueText } from './EntryValue'

interface Props {
  cardId: number
  entryId: number
  onSelectEntry: (entryId: number) => void
  onClose: () => void
}

/** Edit form for one entry; remounted (via `key`) when the selected entry changes. */
function EntryEditor({
  entry,
  images,
  printings,
  onSelectEntry,
  onClose
}: {
  entry: EntryView
  images: { imageId: number }[]
  printings: {
    id: number
    setCode: string
    setName: string
    setRarity: string
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

  const choosable = printings.filter((p) => !p.missingFromApi || p.id === entry.printing.id)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Value</span>
        <ValueText amount={entry.totalValue} approximate={entry.priceApproximate} />
      </div>
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

      {images.length > 1 && (
        <div className="space-y-1.5">
          <div className="text-sm font-medium">Artwork</div>
          <div role="radiogroup" aria-label="Artwork" className="flex flex-wrap gap-2">
            {images.map((im, i) => (
              <button
                key={im.imageId}
                type="button"
                role="radio"
                aria-checked={im.imageId === entry.imageId}
                aria-label={`Artwork ${i + 1}`}
                disabled={busy}
                onClick={() =>
                  im.imageId !== entry.imageId && update.mutate({ imageId: im.imageId })
                }
                className={cn(
                  'rounded-lg p-1 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring',
                  im.imageId === entry.imageId
                    ? 'bg-primary/20 ring-2 ring-primary'
                    : 'hover:bg-accent'
                )}
              >
                <CardArt imageId={im.imageId} size="small" alt="" className="w-14" />
              </button>
            ))}
          </div>
        </div>
      )}

      {choosable.length > 1 && (
        <div className="space-y-1.5">
          <div className="text-sm font-medium">Printing</div>
          <Select
            value={String(entry.printing.id)}
            disabled={busy}
            onValueChange={(v) => update.mutate({ printingId: Number(v) })}
          >
            <SelectTrigger aria-label="Printing" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choosable.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.setCode} · {p.setRarity} — {p.setName}
                </SelectItem>
              ))}
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

export function EntryDetailPanel({
  cardId,
  entryId,
  onSelectEntry,
  onClose
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
  const card = detail.data?.card ?? entry?.card
  const typeLine = card ? [card.type, card.attribute, card.race].filter(Boolean).join(' · ') : ''
  const stats = card
    ? [
        card.atk !== null && `ATK ${card.atk}`,
        card.def !== null && `DEF ${card.def}`,
        card.level !== null && `Level ${card.level}`,
        card.linkval !== null && `Link ${card.linkval}`
      ].filter(Boolean)
    : []

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[420px] overflow-y-auto sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>{card?.name ?? 'Card'}</SheetTitle>
          <SheetDescription>{typeLine}</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          {entry && (
            <CardArt
              imageId={entry.imageId}
              size="full"
              alt={entry.card.name}
              className="mx-auto w-48"
            />
          )}
          {stats.length > 0 && (
            <div className="text-sm tabular-nums text-muted-foreground">{stats.join(' · ')}</div>
          )}
          {card && <p className="whitespace-pre-line text-sm">{card.desc}</p>}

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
                      <span>
                        {c.printing.setCode} · {c.printing.setRarity}
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
              images={detail.data?.images ?? []}
              printings={detail.data?.printings ?? []}
              onSelectEntry={onSelectEntry}
              onClose={onClose}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
