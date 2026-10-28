import { TiltCard } from '@/components/TiltCard'
import { CardArt } from '@/components/CardArt'
import { cn } from '@/lib/utils'
import { artBox, holoKind, isStarlight, nameBox, nameInk } from '../../../../shared/rip/rarity'
import type { ArtBox, RipCard } from '../../../../shared/rip/types'

/** The softer foil: a pale, faintly rainbow band of light that follows the tilt. */
const SHEEN =
  'linear-gradient(115deg, transparent 25%, rgb(255 255 255 / 0.55) 42%, rgb(170 220 255 / 0.5) 48%, rgb(255 190 240 / 0.45) 54%, rgb(255 255 255 / 0.4) 60%, transparent 76%)'

const WHOLE_CARD: React.CSSProperties = { top: '0px', left: '0px', right: '0px', bottom: '0px' }

const insetOf = (b: ArtBox): React.CSSProperties => ({
  top: `${b.top}%`,
  left: `${b.left}%`,
  right: `${b.right}%`,
  bottom: `${b.bottom}%`
})

interface HoloCardProps {
  card: RipCard
  size: 'small' | 'full'
  className?: string
  /** False leaves the sheen off (e.g. a card that's only an edge in the hand). Default true. */
  holo?: boolean
  /** A box-shadow (a hit's glow) on the card itself, so it leans with the card as it tilts. */
  shadow?: string
}

/**
 * A pulled card, tilting with a glare. Secret-family cards get a fine crosshatch foil over the
 * art and Starlight a glittery prismatic foil over the whole card, both with a foil name; these
 * (the rip-foil classes in index.css) stay faint until the pointer's glare band crosses them.
 * The other foils get a softer sheen over the art.
 */
export function HoloCard({
  card,
  size,
  className,
  holo = true,
  shadow
}: HoloCardProps): React.JSX.Element {
  const kind = holoKind(card.rarity, card.variant)
  const showHolo = holo && kind !== 'none' && card.imageId != null
  const inset = kind === 'full' ? WHOLE_CARD : insetOf(artBox(card.frameType))
  const starlight = isStarlight(card.rarity)
  const rounded = kind === 'full' && 'rounded-[6px]'

  return (
    <TiltCard
      className={className}
      innerStyle={shadow ? { boxShadow: shadow } : undefined}
      innerClassName={cn(
        shadow &&
          (size === 'full' ? 'rounded-[6px]' : 'rounded-[3px]') +
            ' transition-[transform,box-shadow] motion-reduce:transition-none'
      )}
    >
      <CardArt imageId={card.imageId ?? 0} size={size} alt={card.name} className="w-full" />
      {showHolo &&
        (kind === 'soft' ? (
          <div
            aria-hidden
            data-holo={kind}
            className={cn(
              'pointer-events-none absolute mix-blend-color-dodge transition-[background-position] duration-100',
              'opacity-60',
              '[background-position:var(--glare-x,50%)_var(--glare-y,50%)] motion-reduce:[background-position:50%_50%] motion-reduce:transition-none'
            )}
            style={{ ...inset, backgroundImage: SHEEN, backgroundSize: '250% 250%' }}
          />
        ) : (
          <>
            {starlight && (
              <div
                aria-hidden
                data-foil="prism"
                className={cn('rip-foil rip-foil-prism', rounded)}
                style={inset}
              />
            )}
            <div
              aria-hidden
              data-holo={kind}
              data-foil={starlight ? 'starlight' : 'secret'}
              className={cn(
                'rip-foil',
                starlight ? 'rip-foil-starlight' : 'rip-foil-secret',
                rounded
              )}
              style={inset}
            />
            <div
              aria-hidden
              data-foil="name"
              data-ink={nameInk(card.frameType)}
              className="rip-foil rip-foil-name"
              style={insetOf(nameBox())}
            />
          </>
        ))}
    </TiltCard>
  )
}
