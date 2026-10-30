import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { cssAspect, type CardAspect } from '@shared/games'
import {
  foilMask,
  texturePlacement,
  type ArtWindow,
  type FoilFinish,
  type FoilKind,
  type FoilTexture
} from '@shared/foil'

interface FoilLayerProps {
  kind: FoilKind
  /** How it moves and what its texture is; one `[data-finish]` block in index.css. */
  finish: FoilFinish
  /** A picture the light shows up, laid so its art sits on `window`. */
  texture?: FoilTexture | null
  /** The art's box; null draws a faint whole-card sheen in place of a holo or reverse mask. */
  window: ArtWindow | null
  aspect: CardAspect
  /** Rounds the layer to match the card's corners. */
  className?: string
  /** Lights the foil from the phone's tilt, or a slow drift where that isn't available. */
  device?: boolean
}

/** How far the phone tilts from where it's held, in degrees, to carry the light across the card. */
const TILT_RANGE = 25
/** How much of each reading the resting position follows, so a change of grip recentres the light. */
const RECENTRE = 0.01

const clamp = (n: number): number => Math.min(1, Math.max(-1, n))

/** iOS asks before sharing the tilt, and only from a tap; once it has said yes, for the page's life. */
type AskableOrientation = { requestPermission?: () => Promise<string> }
let tiltAllowed = false

/** Sets TiltCard's light variables on the layer from the phone's tilt, and marks it idle or live. */
function useDeviceLight(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean): void {
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    if (typeof DeviceOrientationEvent === 'undefined') {
      el.dataset.idle = ''
      return
    }
    el.dataset.idle = ''
    let rest: { beta: number; gamma: number } | null = null
    let frame = 0
    const onTilt = (e: DeviceOrientationEvent): void => {
      if (e.beta === null || e.gamma === null) return
      const { beta, gamma } = e
      rest ??= { beta, gamma }
      rest.beta += (beta - rest.beta) * RECENTRE
      rest.gamma += (gamma - rest.gamma) * RECENTRE
      const x = 50 + clamp((gamma - rest.gamma) / TILT_RANGE) * 50
      const y = 50 + clamp((beta - rest.beta) / TILT_RANGE) * 50
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        el.style.setProperty('--glare-x', `${x.toFixed(1)}%`)
        el.style.setProperty('--glare-y', `${y.toFixed(1)}%`)
        el.style.setProperty(
          '--glare-reach',
          Math.max(Math.abs(x - 50), Math.abs(y - 50)) / 50 + ''
        )
        el.style.setProperty('--glare-fall', (y / 100).toFixed(3))
        el.dataset.live = ''
      })
    }
    const listen = (): void => window.addEventListener('deviceorientation', onTilt)
    const ask = (DeviceOrientationEvent as unknown as AskableOrientation).requestPermission
    const card = el.parentElement
    const onTap = (): void => {
      void ask
        ?.call(DeviceOrientationEvent)
        .then((answer) => {
          tiltAllowed = answer === 'granted'
          if (tiltAllowed) listen()
        })
        .catch(() => {})
    }
    if (!ask || tiltAllowed) listen()
    else card?.addEventListener('click', onTap, { once: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('deviceorientation', onTilt)
      card?.removeEventListener('click', onTap)
    }
  }, [ref, enabled])
}

/**
 * The foil over a card's flat scan, inside a TiltCard, whose pointer lights it. Drawn entirely by
 * the `foil` classes in index.css: a parent with no foil renders nothing at all.
 */
export function FoilLayer({
  kind,
  finish,
  texture,
  window: artWindow,
  aspect,
  className,
  device = false
}: FoilLayerProps): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  useDeviceLight(ref, device && kind !== 'none')
  if (kind === 'none') return null
  const mask = foilMask(kind, artWindow, aspect.width / aspect.height)
  const placed = texture && texturePlacement(texture.art, artWindow)
  const masked = kind === 'holo' || kind === 'reverse'
  return (
    <div
      ref={ref}
      aria-hidden
      data-testid="foil-layer"
      data-foil={kind}
      data-finish={finish}
      data-textured={texture ? '' : undefined}
      data-faint={masked && !artWindow ? '' : undefined}
      className={cn('foil', className)}
      // The layers take the mask themselves: masking here would cut them off from the card.
      style={
        {
          aspectRatio: cssAspect(aspect),
          '--foil-mask': mask,
          '--foil-texture': texture ? `url("${texture.url}")` : undefined,
          '--foil-texture-size': placed?.size,
          '--foil-texture-at': placed?.position
        } as React.CSSProperties
      }
    >
      <div className="foil-rest" />
      <div className="foil-wash" />
      <div className="foil-milk" />
      <div className="foil-deep" />
      <div className="foil-shine" />
      <div className="foil-cross" />
      <div className="foil-grain" />
      <div className="foil-bloom" />
    </div>
  )
}
