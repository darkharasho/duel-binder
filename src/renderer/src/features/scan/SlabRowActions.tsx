import { useMemo, useState } from 'react'
import { ShieldCheckIcon } from 'lucide-react'
import { GradedForm, type GradedPrinting } from '@/features/graded/GradedForm'
import { cn } from '@/lib/utils'
import { printingOf } from './scanLook'
import type { ScanRow } from './session'

/**
 * The printings a scanned slab may be added as: the row's own card's (a Pokémon row's options may
 * hold reprints in other sets, each a card of its own, listed too as the row's picker lists them).
 */
// eslint-disable-next-line react-refresh/only-export-components -- tested on its own
export function slabPrintings(row: ScanRow): GradedPrinting[] {
  const own = row.game === 'pkm' ? row.options : row.options.filter((o) => o.cardId === row.cardId)
  const seen = new Set<number>()
  return own.flatMap((o) => {
    if (seen.has(o.printingId)) return []
    seen.add(o.printingId)
    return [
      {
        id: o.printingId,
        setCode: o.setCode,
        setName: o.setName,
        setRarity: o.rarity,
        language: o.language,
        missingFromApi: false
      }
    ]
  })
}

const PILL =
  'h-7 rounded-full px-2.5 text-xs font-medium bg-white/[0.08] hover:bg-white/[0.14] active:bg-white/[0.18] disabled:opacity-40'

/**
 * A scanned slab's line on the session list: it is held out of Add, and is added from here as a
 * graded copy (the form opens on the row's printing, and saving takes one copy off the row) or
 * marked as not a slab, which lets Add take it as a raw card again.
 */
export function SlabRowActions({
  row,
  onAdded,
  onNotSlab,
  disabled = false,
  className
}: {
  row: ScanRow
  /** A graded copy was saved for one of the row's copies. */
  onAdded: () => void
  onNotSlab: () => void
  disabled?: boolean
  className?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const printings = useMemo(() => slabPrintings(row), [row])
  const printingId = printingOf(row) ?? row.printingId ?? undefined
  return (
    <div className={cn('mt-1.5 space-y-1.5', className)}>
      <p className="flex items-center gap-1 text-xs text-sky-300">
        <ShieldCheckIcon aria-hidden className="size-3.5 shrink-0" />
        Graded slab: not added as a raw card
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={cn(PILL, 'bg-sky-400/20 text-sky-100 hover:bg-sky-400/30')}
        >
          Add as slab
        </button>
        <button type="button" disabled={disabled} onClick={onNotSlab} className={PILL}>
          Not a slab
        </button>
      </div>
      <GradedForm
        open={open}
        onClose={() => setOpen(false)}
        cardName={row.name}
        printings={printings}
        printingId={printingId}
        onAdded={onAdded}
      />
    </div>
  )
}
