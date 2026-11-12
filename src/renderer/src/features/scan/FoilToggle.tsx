import { SparklesIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { finishTwin } from './resolveMagic'
import type { ScanRow } from './session'

/**
 * A Magic row's Foil switch: picks the same printing in the other finish, as picking it from the
 * printing list would (its price and collection entry follow). Shown only for a Magic row whose
 * printing comes in both finishes.
 */
export function FoilToggle({
  row,
  onPick,
  disabled = false,
  className
}: {
  row: Pick<ScanRow, 'game' | 'printingId' | 'options'>
  onPick: (printingId: number) => void
  disabled?: boolean
  className?: string
}): React.JSX.Element | null {
  if (row.game !== 'mtg' || row.printingId === null) return null
  const current = row.options.find((o) => o.printingId === row.printingId)
  const twin = current && finishTwin(current, row.options)
  if (!current || !twin) return null
  const foil = / \((Foil|Etched Foil)\)$/.test(current.rarity)
  return (
    <button
      type="button"
      aria-pressed={foil}
      disabled={disabled}
      onClick={() => onPick(twin.printingId)}
      className={cn(
        'flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs disabled:opacity-40',
        foil
          ? 'border-amber-300/50 bg-amber-300/15 text-amber-200'
          : 'border-white/[0.12] bg-white/[0.08] text-white/75 hover:bg-white/[0.14]',
        className
      )}
    >
      <SparklesIcon aria-hidden className="size-3.5 shrink-0" />
      Foil
    </button>
  )
}
