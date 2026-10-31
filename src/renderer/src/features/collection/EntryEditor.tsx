import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Language } from '@shared/languages'
import { printingChip, printingTitle } from '@shared/printingLabel'
import type { EntryView, UpdateEntryInput } from '@shared/types'
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
import { api, mutationInvalidationKeys } from '@/lib/api'
import { EntryValue, StaleBadge, displayTotal } from './EntryValue'

/** Edit form for one entry; remounted (via `key`) when the selected entry changes. */
export function EntryEditor({
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
