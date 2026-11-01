import { XIcon } from 'lucide-react'
import type { BinderCard } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { CardArt } from '@/components/CardArt'
import { LanguageTag } from '@/components/LanguageTag'
import { TiltCard } from '@/components/TiltCard'
import { useTileImage } from '@/lib/cardSize'
import { formatUsd } from '@/lib/format'
import { useChunkedList } from '@/lib/useChunkedList'
import { cn } from '@/lib/utils'

interface Props {
  cards: BinderCard[]
  onOpen: (card: BinderCard) => void
  /** Takes a slot out of the binder; the control shows only when this is given and not `readOnly`. */
  onRemove?: (card: BinderCard) => void
  readOnly?: boolean
}

/** A binder's slots: owned cards as tiles, missing ones as dashed slots showing their art dimmed. */
export function BinderGrid({ cards, onOpen, onRemove, readOnly }: Props): React.JSX.Element {
  const shown = useChunkedList(cards)
  const tileImage = useTileImage()
  return (
    <ul
      className="grid grid-cols-[repeat(auto-fill,minmax(calc(150px*var(--card-scale,1)),1fr))] gap-x-4 gap-y-6 max-md:grid-cols-3 max-md:gap-x-2 max-md:gap-y-4"
      aria-label="Binder cards"
    >
      {shown.map((c) => {
        const missing = c.owned === 0
        return (
          <li
            key={c.key}
            className="lazy-item group/slot relative [--lazy-h:calc(310px*var(--card-scale,1))]"
          >
            <button
              type="button"
              onClick={() => onOpen(c)}
              aria-label={missing ? `${c.card.name}, missing` : c.card.name}
              className="flex w-full flex-col gap-2 rounded-md p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <TiltCard>
                <div
                  className={cn(
                    'overflow-hidden rounded-[4px]',
                    missing
                      ? 'border border-dashed border-white/25'
                      : 'shadow-[0_8px_20px_rgb(0_0_0/0.45)]'
                  )}
                >
                  <CardArt
                    imageId={c.imageId}
                    printingId={c.printingScan && c.printing ? c.printing.id : null}
                    size={tileImage}
                    alt=""
                    className={cn('w-full', missing && 'opacity-30 grayscale')}
                  />
                </div>
                {!missing && c.owned > 1 && (
                  <Badge className="absolute right-1.5 top-1.5 font-mono shadow">×{c.owned}</Badge>
                )}
                {c.added && (
                  <Badge variant="secondary" className="absolute left-1.5 top-1.5 text-[10px]">
                    added by hand
                  </Badge>
                )}
              </TiltCard>
              <div className="min-w-0 space-y-0.5">
                <div className="truncate text-[13px] font-semibold">{c.card.name}</div>
                <div className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                  {c.printing ? (
                    <>
                      <span className="truncate">
                        {c.printing.setCode} · {c.printing.setRarity}
                      </span>
                      <LanguageTag language={c.printing.language} />
                    </>
                  ) : (
                    <span>{missing ? 'missing' : 'owned'}</span>
                  )}
                </div>
                {missing && c.price != null && (
                  <div className="font-mono text-xs">{formatUsd(c.price)}</div>
                )}
              </div>
            </button>
            {!readOnly && onRemove && (
              <button
                type="button"
                aria-label={`Remove ${c.card.name} from this binder`}
                onClick={() => onRemove(c)}
                className="absolute right-2 top-2 z-10 rounded bg-background/80 p-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/slot:opacity-100"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
