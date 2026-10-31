import type { EntryView } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { CardArt } from '@/components/CardArt'
import { TiltCard } from '@/components/TiltCard'
import { scanFor } from '@/components/scanFor'
import { LanguageTag } from '@/components/LanguageTag'
import { useChunkedList } from '@/lib/useChunkedList'
import { EntryValue, StaleBadge, displayTotal } from './EntryValue'

interface Props {
  entries: EntryView[]
  selectedId: number | null
  onSelect: (entry: EntryView) => void
}

export function CollectionGrid({ entries, selectedId, onSelect }: Props): React.JSX.Element {
  const shown = useChunkedList(entries)
  return (
    <ul
      className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6 max-md:grid-cols-3 max-md:gap-x-2 max-md:gap-y-4"
      aria-label="Collection grid"
    >
      {shown.map((e) => (
        <li key={e.id} className="lazy-item [--lazy-h:310px]">
          <button
            type="button"
            data-nav-key={e.id}
            onClick={() => onSelect(e)}
            aria-pressed={e.id === selectedId}
            className="group flex w-full flex-col gap-2 rounded-md p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-white/[0.06]"
          >
            <TiltCard>
              <CardArt
                imageId={e.imageId}
                printingId={scanFor(e)}
                size="small"
                alt={e.card.name}
                className="w-full rounded-[4px] shadow-[0_8px_20px_rgb(0_0_0/0.45)]"
              />
              <Badge className="absolute right-1.5 top-1.5 font-mono shadow">×{e.quantity}</Badge>
            </TiltCard>
            <div className="min-w-0 space-y-0.5">
              <div className="truncate text-[13px] font-semibold">{e.card.name}</div>
              <div className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                <span className="truncate">
                  {e.printing.setCode} · {e.printing.setRarity}
                </span>
                <LanguageTag language={e.printing.language} />
              </div>
              <div className="font-mono text-xs">
                <EntryValue entry={e} amount={displayTotal(e)} />
              </div>
              <StaleBadge entry={e} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}
