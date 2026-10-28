import { TiltCard } from '@/components/TiltCard'
import { CardArt } from '@/components/CardArt'
import { cn } from '@/lib/utils'
import { artBox, holoKind, isStarlight, nameBox, nameInk } from '../../../../shared/rip/rarity'
import type { ArtBox, RipCard } from '../../../../shared/rip/types'

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
 * A pulled card, tilting with a glare. Every foil gets the same crosshatch rainbow (the rip-foil
 * classes in index.css), faint at rest and flashing where the pointer's glare band crosses it:
 * over the art for Secret and the softer foils, over the whole card for Starlight. Secret and
 * Starlight also get a foil name.
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
      {showHolo && (
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
            data-foil={starlight ? 'starlight' : kind === 'soft' ? 'soft' : 'secret'}
            className={cn(
              'rip-foil',
              starlight ? 'rip-foil-starlight' : 'rip-foil-secret',
              rounded
            )}
            style={inset}
          />
          {kind !== 'soft' && (
            <div
              aria-hidden
              data-foil="name"
              data-ink={nameInk(card.frameType)}
              className="rip-foil rip-foil-name"
              style={insetOf(nameBox())}
            />
          )}
        </>
      )}
    </TiltCard>
  )
}
