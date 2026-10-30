import { printingChip, printingTitle } from '@shared/printingLabel'
import type { ChecklistRarity } from '@shared/types'
import { PrintingLabel } from '@/components/PrintingLabel'
import { SelectContent, SelectItem, SelectValue } from '@/components/ui/select'

/** Each code's owned count shows once more than one code of the rarity is owned. */
function ownedNote(rarity: ChecklistRarity, owned: number): string | null {
  const several = rarity.codes.filter((c) => c.owned > 0).length > 1
  return several && owned > 0 ? `×${owned}` : null
}

/**
 * The closed code picker of bulk mode: the picked code (the set's name for an uncoded printing),
 * kept short to fit a tile, with its owned count.
 */
export function CodeValue({
  rarity,
  printingId,
  setName = ''
}: {
  rarity: ChecklistRarity
  printingId: number
  setName?: string
}): React.JSX.Element {
  const picked = rarity.codes.find((c) => c.printingId === printingId)
  const note = picked ? ownedNote(rarity, picked.owned) : null
  return (
    <SelectValue>
      {picked && `${picked.setCode || setName || rarity.rarity}${note ? ` ${note}` : ''}`}
    </SelectValue>
  )
}

/**
 * The open code picker of bulk mode: each printing of the rarity as every printing picker shows
 * it, its code as a chip, then "Set name - Rarity", then its owned count.
 */
export function CodeOptions({
  rarity,
  setName = '',
  onCloseAutoFocus
}: {
  rarity: ChecklistRarity
  setName?: string
  onCloseAutoFocus?: React.ComponentProps<typeof SelectContent>['onCloseAutoFocus']
}): React.JSX.Element {
  return (
    <SelectContent
      className="max-w-[min(32rem,calc(100vw-2rem))]"
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {rarity.codes.map((c) => {
        const label = { setCode: c.setCode, setName, rarity: rarity.rarity }
        const note = ownedNote(rarity, c.owned)
        return (
          <SelectItem
            key={c.printingId}
            value={String(c.printingId)}
            className="*:[span]:last:min-w-0"
          >
            <PrintingLabel
              chip={printingChip(label)}
              title={printingTitle(label)}
              tag={
                note && <span className="shrink-0 tabular-nums text-muted-foreground">{note}</span>
              }
            />
          </SelectItem>
        )
      })}
    </SelectContent>
  )
}
