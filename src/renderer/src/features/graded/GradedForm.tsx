import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  GRADES,
  GRADING_COMPANIES,
  MAX_CERT,
  MAX_COMPANY,
  MAX_GRADE_LABEL,
  type GradedCopy,
  type GradedDraft
} from '@shared/graded'
import type { Language } from '@shared/languages'
import { printingChip, printingParts } from '@shared/printingLabel'
import { LanguageTag } from '@/components/LanguageTag'
import { PrintingLabel } from '@/components/PrintingLabel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { api, invalidateAfterEdit } from '@/lib/api'
import { useBackHandler } from '@/lib/backStack'

export interface GradedPrinting {
  id: number
  setCode: string
  setName: string
  setRarity: string
  language: Language
  missingFromApi: boolean
}

const OTHER = 'Other'
const isListed = (company: string): boolean =>
  (GRADING_COMPANIES as readonly string[]).includes(company)

/** "12.5" → 12.5, "" → null, anything else → undefined (invalid). */
function dollars(text: string): number | null | undefined {
  const t = text.trim().replace(/^\$/, '').replace(/,/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

const moneyText = (n: number | null): string => (n === null ? '' : String(n))

/**
 * Adds a graded copy of a card, or edits or removes one (`slab`). Opens on `printingId` for a new
 * slab: the printing the panel shows.
 */
export function GradedForm({
  open,
  onClose,
  cardName,
  printings,
  printingId,
  slab
}: {
  open: boolean
  onClose: () => void
  cardName: string
  printings: GradedPrinting[]
  printingId: number | undefined
  slab?: GradedCopy
}): React.JSX.Element {
  useBackHandler(open, onClose)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{slab ? 'Edit graded copy' : 'Add graded copy'}</DialogTitle>
          <DialogDescription>
            {cardName}. Slabs are tracked one by one and don&apos;t count toward set or binder
            progress.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <Fields
            key={slab?.uid ?? 'new'}
            onClose={onClose}
            printings={printings}
            printingId={printingId}
            slab={slab}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function Fields({
  onClose,
  printings,
  printingId,
  slab
}: {
  onClose: () => void
  printings: GradedPrinting[]
  printingId: number | undefined
  slab?: GradedCopy
}): React.JSX.Element {
  const qc = useQueryClient()
  // A slab's own printing is listed even when the card's list leaves it out (contributed).
  const choosable = [
    ...(slab && !printings.some((p) => p.id === slab.printing.id) ? [slab.printing] : []),
    ...printings.filter((p) => !p.missingFromApi || p.id === slab?.printing.id)
  ]
  const [printing, setPrinting] = useState(
    String(slab?.printing.id ?? printingId ?? choosable[0]?.id ?? '')
  )
  const startCompany = slab?.company ?? 'PSA'
  const [company, setCompany] = useState(isListed(startCompany) ? startCompany : OTHER)
  const [otherCompany, setOtherCompany] = useState(isListed(startCompany) ? '' : startCompany)
  const [grade, setGrade] = useState(slab?.grade ?? '10')
  const [label, setLabel] = useState(slab?.label ?? '')
  const [cert, setCert] = useState(slab?.cert ?? '')
  const [value, setValue] = useState(moneyText(slab?.value ?? null))
  const [paid, setPaid] = useState(moneyText(slab?.paid ?? null))
  const [notes, setNotes] = useState(slab?.notes ?? '')
  const [confirming, setConfirming] = useState(false)

  const done = async (message: string): Promise<void> => {
    await invalidateAfterEdit(qc)
    toast.success(message)
    onClose()
  }
  const save = useMutation({
    mutationFn: (draft: GradedDraft) => api.graded.save(draft),
    onSuccess: () => done(slab ? 'Saved' : 'Graded copy added'),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save')
  })
  const remove = useMutation({
    mutationFn: () => api.graded.remove(slab!.uid),
    onSuccess: () => done('Graded copy removed'),
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not remove')
  })
  const busy = save.isPending || remove.isPending

  const companyName = company === OTHER ? otherCompany.trim() : company
  const valueNum = dollars(value)
  const paidNum = dollars(paid)
  const valid =
    printing !== '' && companyName !== '' && valueNum !== undefined && paidNum !== undefined

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!valid) return
    const chosen = Number(printing)
    save.mutate({
      ...(slab ? { uid: slab.uid } : {}),
      printingId: chosen,
      // An edit on the same printing keeps the slab's art; a new printing takes its own.
      ...(slab && chosen === slab.printing.id ? { imageId: slab.imageId } : {}),
      company: companyName,
      grade,
      label: label.trim(),
      cert: cert.trim(),
      value: valueNum ?? null,
      paid: paidNum ?? null,
      notes: notes.trim()
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {choosable.length > 1 && (
        <div className="space-y-1.5">
          <div className="text-sm font-medium">Printing</div>
          <Select value={printing} disabled={busy} onValueChange={setPrinting}>
            <SelectTrigger
              aria-label="Printing"
              className="w-full *:data-[slot=select-value]:min-w-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-w-[min(36rem,calc(100vw-2rem))]">
              {choosable.map((p) => {
                const parts = { setCode: p.setCode, setName: p.setName, rarity: p.setRarity }
                return (
                  <SelectItem key={p.id} value={String(p.id)} className="*:[span]:last:min-w-0">
                    <PrintingLabel
                      chip={printingChip(parts)}
                      {...printingParts(parts)}
                      tag={<LanguageTag language={p.language} />}
                    />
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <div className="text-sm font-medium">Grading company</div>
          <Select value={company} disabled={busy} onValueChange={setCompany}>
            <SelectTrigger aria-label="Grading company" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...GRADING_COMPANIES, OTHER].map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <div className="text-sm font-medium">Grade</div>
          <Select value={grade} disabled={busy} onValueChange={setGrade}>
            <SelectTrigger aria-label="Grade" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRADES.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {company === OTHER && (
        <div className="space-y-1.5">
          <label htmlFor="graded-other" className="block text-sm font-medium">
            Company name
          </label>
          <Input
            id="graded-other"
            value={otherCompany}
            maxLength={MAX_COMPANY}
            onChange={(e) => setOtherCompany(e.target.value)}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="graded-label" className="block text-sm font-medium">
            Label <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Input
            id="graded-label"
            placeholder="Black Label, Pristine…"
            value={label}
            maxLength={MAX_GRADE_LABEL}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="graded-cert" className="block text-sm font-medium">
            Cert number
          </label>
          <Input
            id="graded-cert"
            inputMode="numeric"
            value={cert}
            maxLength={MAX_CERT}
            onChange={(e) => setCert(e.target.value)}
            className="font-mono"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor="graded-value" className="block text-sm font-medium">
            Value (USD)
          </label>
          <Input
            id="graded-value"
            inputMode="decimal"
            placeholder="0.00"
            value={value}
            aria-invalid={valueNum === undefined}
            onChange={(e) => setValue(e.target.value)}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="graded-paid" className="block text-sm font-medium">
            Price paid (USD)
          </label>
          <Input
            id="graded-paid"
            inputMode="decimal"
            placeholder="0.00"
            value={paid}
            aria-invalid={paidNum === undefined}
            onChange={(e) => setPaid(e.target.value)}
            className="tabular-nums"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="graded-notes" className="block text-sm font-medium">
          Notes
        </label>
        <Input id="graded-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button type="submit" disabled={!valid || busy}>
          {slab ? 'Save changes' : 'Add graded copy'}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {slab && (
          <div className="ml-auto flex items-center gap-2">
            {confirming ? (
              <>
                <span className="text-sm">Remove?</span>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => remove.mutate()}
                >
                  Confirm
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
                Remove
              </Button>
            )}
          </div>
        )}
      </div>
    </form>
  )
}
