import { TiltCard } from '@/components/TiltCard'
import { CardArt } from '@/components/CardArt'
import { cn } from '@/lib/utils'
import { artBox, holoKind } from '../../../../shared/rip/rarity'
import type { RipCard } from '../../../../shared/rip/types'

const RAINBOW =
  'linear-gradient(115deg, #ff5f6d, #ffc371, #f7ff6a, #6dff9c, #5ad7ff, #8b7bff, #ff6ad5, #ff5f6d)'
const LINES = 'repeating-linear-gradient(135deg, #000 0 1.2px, transparent 1.2px 3.4px)'

interface HoloCardProps {
  card: RipCard
  size: 'small' | 'full'
  className?: string
}

/** A pulled card, tilting with a glare; Secret-family cards shine over the art, Starlight over all. */
export function HoloCard({ card, size, className }: HoloCardProps): React.JSX.Element {
  const kind = holoKind(card.rarity, card.variant)
  const showHolo = kind !== 'none' && card.imageId != null
  const inset: React.CSSProperties =
    kind === 'art'
      ? (() => {
          const b = artBox(card.frameType)
          return {
            top: `${b.top}%`,
            left: `${b.left}%`,
            right: `${b.right}%`,
            bottom: `${b.bottom}%`
          }
        })()
      : { top: '0px', left: '0px', right: '0px', bottom: '0px' }

  return (
    <TiltCard className={className}>
      <CardArt imageId={card.imageId ?? 0} size={size} alt={card.name} className="w-full" />
      {showHolo && (
        <div
          aria-hidden
          data-holo={kind}
          className={cn(
            'pointer-events-none absolute opacity-75 mix-blend-color-dodge transition-[background-position] duration-100',
            'motion-reduce:transition-none',
            kind === 'full' && 'rounded-[6px]'
          )}
          style={{
            ...inset,
            backgroundImage: RAINBOW,
            backgroundSize: '300% 300%',
            backgroundPosition: 'var(--glare-x, 50%) var(--glare-y, 50%)',
            maskImage: LINES,
            WebkitMaskImage: LINES
          }}
        />
      )}
    </TiltCard>
  )
}
