import { TiltCard } from '@/components/TiltCard'
import { CardArt } from '@/components/CardArt'
import { cn } from '@/lib/utils'
import { artBox, holoKind } from '../../../../shared/rip/rarity'
import type { RipCard } from '../../../../shared/rip/types'

const RAINBOW =
  'linear-gradient(115deg, #ff5f6d, #ffc371, #f7ff6a, #6dff9c, #5ad7ff, #8b7bff, #ff6ad5, #ff5f6d)'
const LINES = 'repeating-linear-gradient(135deg, #000 0 1.2px, transparent 1.2px 3.4px)'
/** The softer foil: a pale, faintly rainbow band of light that follows the tilt. */
const SHEEN =
  'linear-gradient(115deg, transparent 25%, rgb(255 255 255 / 0.55) 42%, rgb(170 220 255 / 0.5) 48%, rgb(255 190 240 / 0.45) 54%, rgb(255 255 255 / 0.4) 60%, transparent 76%)'

interface HoloCardProps {
  card: RipCard
  size: 'small' | 'full'
  className?: string
  /** False leaves the sheen off (e.g. a card that's only an edge in the hand). Default true. */
  holo?: boolean
}

/**
 * A pulled card, tilting with a glare; Secret-family cards shine over the art, Starlight over all,
 * and the other foils get a softer sheen over the art.
 */
export function HoloCard({ card, size, className, holo = true }: HoloCardProps): React.JSX.Element {
  const kind = holoKind(card.rarity, card.variant)
  const showHolo = holo && kind !== 'none' && card.imageId != null
  const inset: React.CSSProperties =
    kind === 'art' || kind === 'soft'
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
            'pointer-events-none absolute mix-blend-color-dodge transition-[background-position] duration-100',
            kind === 'soft' ? 'opacity-60' : 'opacity-75',
            '[background-position:var(--glare-x,50%)_var(--glare-y,50%)] motion-reduce:[background-position:50%_50%] motion-reduce:transition-none',
            kind === 'full' && 'rounded-[6px]'
          )}
          style={
            kind === 'soft'
              ? { ...inset, backgroundImage: SHEEN, backgroundSize: '250% 250%' }
              : {
                  ...inset,
                  backgroundImage: RAINBOW,
                  backgroundSize: '300% 300%',
                  maskImage: LINES,
                  WebkitMaskImage: LINES
                }
          }
        />
      )}
    </TiltCard>
  )
}
