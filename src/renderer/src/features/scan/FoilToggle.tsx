import { SparklesIcon, StarIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { finishTwin } from './resolveMagic'
import { reverseTwin } from './reverseCheck'
import type { ScanRow } from './session'

/**
 * A row's finish switch: picks the same printing in the other finish, as picking it from the
 * printing list would (its price and collection entry follow). A Magic row gets "Foil", shown
 * only when its printing comes in both finishes; a Pokémon row gets "RH" (reverse holo), shown
 * only when its printing has a reverse-holo twin (or, on a reverse, a non-reverse one).
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
  if ((row.game !== 'mtg' && row.game !== 'pkm') || row.printingId === null) return null
  const pokemon = row.game === 'pkm'
  const current = row.options.find((o) => o.printingId === row.printingId)
  const twin = current && (pokemon ? reverseTwin : finishTwin)(current, row.options)
  if (!current || !twin) return null
  const on = pokemon
    ? current.rarity === 'Reverse Holofoil'
    : / \((Foil|Etched Foil)\)$/.test(current.rarity)
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={pokemon ? 'Reverse holo' : undefined}
      disabled={disabled}
      onClick={() => onPick(twin.printingId)}
      className={cn(
        'flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs disabled:opacity-40',
        on
          ? 'border-amber-300/50 bg-amber-300/15 text-amber-200'
          : 'border-white/[0.12] bg-white/[0.08] text-white/75 hover:bg-white/[0.14]',
        className
      )}
    >
      {pokemon ? (
        <StarIcon aria-hidden className="size-3.5 shrink-0" />
      ) : (
        <SparklesIcon aria-hidden className="size-3.5 shrink-0" />
      )}
      {pokemon ? 'RH' : 'Foil'}
    </button>
  )
}
