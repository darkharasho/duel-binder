import type { EntryView } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { CardArt } from '@/components/CardArt'
import { StaleBadge, ValueText, displayTotal } from './EntryValue'

interface Props {
  entries: EntryView[]
  selectedId: number | null
  onSelect: (entry: EntryView) => void
}

export function CollectionGrid({ entries, selectedId, onSelect }: Props): React.JSX.Element {
  return (
    <ul
      className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4"
      aria-label="Collection grid"
    >
      {entries.map((e) => (
        <li key={e.id}>
          <button
            type="button"
            onClick={() => onSelect(e)}
            aria-pressed={e.id === selectedId}
            className="group flex w-full flex-col gap-2 rounded-xl p-2 text-left outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="relative">
              <CardArt imageId={e.imageId} size="small" alt={e.card.name} className="w-full" />
              <Badge className="absolute right-1.5 top-1.5 tabular-nums shadow">
                ×{e.quantity}
              </Badge>
            </div>
            <div className="min-w-0 space-y-0.5">
              <div className="truncate text-sm font-medium">{e.card.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {e.printing.setCode} · {e.printing.setRarity}
              </div>
              <div className="text-xs">
                <ValueText amount={displayTotal(e)} approximate={e.priceApproximate} />
              </div>
              <StaleBadge entry={e} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}
