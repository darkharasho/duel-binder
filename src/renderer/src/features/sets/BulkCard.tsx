import type { ChecklistCard } from '@shared/types'
import { CardArt } from '@/components/CardArt'
import { BulkRow } from './BulkRow'

interface BulkCardProps {
  card: ChecklistCard
  busy: boolean
  onAdjust: (printingId: number, delta: 1 | -1) => void
}

/** A card in bulk mode: art, name and one stepper row per rarity. */
export function BulkCard({ card, busy, onAdjust }: BulkCardProps): React.JSX.Element {
  return (
    <li className="flex gap-2 rounded-lg border p-2">
      <CardArt imageId={card.imageId} size="small" alt="" className="w-14 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="truncate text-xs font-medium">{card.name}</div>
        {card.rarities.map((r) => (
          <BulkRow key={r.rarity} card={card} rarity={r} busy={busy} onAdjust={onAdjust} />
        ))}
      </div>
    </li>
  )
}
