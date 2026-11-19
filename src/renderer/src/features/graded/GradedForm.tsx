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
import type { SlabRead } from '@shared/scan/slabLabel'
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
 * slab: the printing the panel shows. `onAdded` hears a new slab saved (the scanner's hand-off
 * takes its row off the list).
 */
export function GradedForm({
  open,
  onClose,
  cardName,
  printings,
  printingId,
  slab,
  onAdded,
  initial
}: {
  open: boolean
  onClose: () => void
  cardName: string
  printings: GradedPrinting[]
  printingId: number | undefined
  slab?: GradedCopy
  onAdded?: () => void
  /** A new slab's fields to start from: what a scanned label was read as. */
  initial?: SlabRead
}): React.JSX.Element {
  useBackHandler(open, onClose)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* One column the width of the dialog: a long printing name truncates, not widens it. */}
      <DialogContent className="max-h-[90dvh] grid-cols-[minmax(0,1fr)] gap-5 overflow-y-auto overflow-x-hidden sm:max-w-lg">
        <DialogHeader className="pr-6">
          <DialogTitle>{slab ? 'Edit graded copy' : 'Add graded copy'}</DialogTitle>
          <DialogDescription className="space-y-0.5">
            <span className="block truncate text-foreground">{cardName}</span>
            <span className="block text-xs">
              Tracked one by one. Doesn&apos;t count toward set or binder progress.
            </span>
          </DialogDescription>
        </DialogHeader>
        {open && (
          <Fields
            key={slab?.uid ?? 'new'}
            onClose={onClose}
            printings={printings}
            printingId={printingId}
            slab={slab}
            onAdded={onAdded}
            initial={slab ? undefined : initial}
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
  slab,
  onAdded,
  initial
}: {
  onClose: () => void
  printings: GradedPrinting[]
  printingId: number | undefined
  slab?: GradedCopy
  onAdded?: () => void
  initial?: SlabRead
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
  const startCompany = slab?.company ?? initial?.company ?? 'PSA'
  const [company, setCompany] = useState(isListed(startCompany) ? startCompany : OTHER)
  const [otherCompany, setOtherCompany] = useState(isListed(startCompany) ? '' : startCompany)
  const [grade, setGrade] = useState(
    slab?.grade ?? (initial?.grade && GRADES.includes(initial.grade) ? initial.grade : '10')
  )
  const [label, setLabel] = useState(slab?.label ?? initial?.label ?? '')
  const [cert, setCert] = useState(slab?.cert ?? initial?.cert ?? '')
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
    onSuccess: () => {
      if (!slab) onAdded?.()
      return done(slab ? 'Saved' : 'Graded copy added')
    },
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
    <form onSubmit={submit} className="min-w-0 space-y-6">
      {choosable.length > 1 && (
        <Field label="Printing">
          <Select value={printing} disabled={busy} onValueChange={setPrinting}>
            <SelectTrigger
              aria-label="Printing"
              className="w-full min-w-0 *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate"
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
        </Field>
      )}

      <Section title="Grade">
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
          <Field label="Company">
            <Select value={company} disabled={busy} onValueChange={setCompany}>
              <SelectTrigger aria-label="Grading company" className="w-full min-w-0">
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
          </Field>
          <Field label="Grade">
            <Select value={grade} disabled={busy} onValueChange={setGrade}>
              <SelectTrigger aria-label="Grade" className="w-full min-w-0">
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
          </Field>
        </div>
        {company === OTHER && (
          <Field label="Company name" htmlFor="graded-other">
            <Input
              id="graded-other"
              value={otherCompany}
              maxLength={MAX_COMPANY}
              onChange={(e) => setOtherCompany(e.target.value)}
            />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cert number" htmlFor="graded-cert">
            <Input
              id="graded-cert"
              inputMode="numeric"
              value={cert}
              maxLength={MAX_CERT}
              onChange={(e) => setCert(e.target.value)}
              className="font-mono"
            />
          </Field>
          <Field label="Label" hint="optional" htmlFor="graded-label">
            <Input
              id="graded-label"
              placeholder="Black Label…"
              value={label}
              maxLength={MAX_GRADE_LABEL}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <Section title="Price">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Value (USD)" htmlFor="graded-value">
            <Input
              id="graded-value"
              inputMode="decimal"
              placeholder="0.00"
              value={value}
              aria-invalid={valueNum === undefined}
              onChange={(e) => setValue(e.target.value)}
              className="tabular-nums"
            />
          </Field>
          <Field label="Price paid (USD)" htmlFor="graded-paid">
            <Input
              id="graded-paid"
              inputMode="decimal"
              placeholder="0.00"
              value={paid}
              aria-invalid={paidNum === undefined}
              onChange={(e) => setPaid(e.target.value)}
              className="tabular-nums"
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Left empty, the value shown is eBay&apos;s asking price for this grade once it&apos;s
          known.
        </p>
      </Section>

      <Field label="Notes" htmlFor="graded-notes">
        <Input id="graded-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        {slab &&
          (confirming ? (
            <div className="flex items-center gap-2">
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
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
              Remove
            </Button>
          ))}
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || busy}>
            {slab ? 'Save changes' : 'Add graded copy'}
          </Button>
        </div>
      </div>
    </form>
  )
}

/** A titled group of the form's fields. */
function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  )
}

/** One field: its label (and a quiet hint) over its control. */
function Field({
  label,
  hint,
  htmlFor,
  children
}: {
  label: string
  hint?: string
  htmlFor?: string
  children: React.ReactNode
}): React.JSX.Element {
  const text = (
    <>
      {label}
      {hint && <span className="font-normal text-muted-foreground"> ({hint})</span>}
    </>
  )
  return (
    <div className="min-w-0 space-y-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="block text-sm font-medium">
          {text}
        </label>
      ) : (
        <div className="text-sm font-medium">{text}</div>
      )}
      {children}
    </div>
  )
}
