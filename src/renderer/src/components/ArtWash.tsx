import { useEffect, useMemo, useState } from 'react'
import { useGame } from '@/lib/game'
import { isPhone } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { css } from '@/lib/wash/color'
import { field, GRAIN, GRAIN_PLAIN } from '@/lib/wash/field'
import { fit } from '@/lib/wash/fit'
import { useWashPref } from '@/lib/washPref'
import { applyWashPref } from '@/lib/wash/applyPref'
import type { WashState } from './artWashContext'

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

type Layers = { active: 0 | 1; bg: [string, string] }

const SHADE = 'linear-gradient(180deg, transparent 45%, rgb(8 7 12 / .5))'
/** Its own compositing layer (iOS WebKit and Chromium both promote on a 3D transform). */
const OWN_LAYER: React.CSSProperties = { transform: 'translateZ(0)' }

/**
 * A full-window colour field painted from one card's art: a base colour, two pool layers that
 * cross-fade when the wash changes, a shade toward the bottom and a little grain. Purely decorative.
 * `enabled` is off where something else (the scan camera) fills the background.
 *
 * On the phone the field is fixed to the window and split into still compositing layers: the base,
 * each pool layer (kept, so a cross-fade only animates opacity on the GPU instead of repainting
 * fourteen full-screen gradients each frame) and the shade with a plain-blended grain on top. The
 * page scrolls over them without repainting them. It also skips the `--wash-*` variables on the
 * root, which only the desktop's pinned header reads: setting them restyles every element.
 */
export function ArtWash({
  wash,
  enabled = true
}: {
  wash: WashState | null
  enabled?: boolean
}): React.JSX.Element | null {
  const { game } = useGame()
  const { wash: pref } = useWashPref()
  const phone = isPhone()
  const { families, seed, strength } = useMemo(
    () => applyWashPref(wash, pref, game),
    [wash, pref, game]
  )

  const { base, pools } = useMemo(() => {
    const fitted = fit(families, 'dark')
    return { base: css(fitted.base), pools: field(fitted, { seed, withBase: false }) }
  }, [families, seed])

  // Adjusting state while rendering: when `pools` changes, fade to the other layer.
  const [layers, setLayers] = useState<Layers>({ active: 0, bg: [pools, ''] })
  if (layers.bg[layers.active] !== pools) {
    setLayers(
      layers.active === 0
        ? { active: 1, bg: [layers.bg[0], pools] }
        : { active: 0, bg: [pools, layers.bg[1]] }
    )
  }

  // The pinned header row fades from this colour, so it reads as the wash rather than a bar.
  useEffect(() => {
    if (!enabled || phone) return
    const root = document.documentElement
    root.style.setProperty('--wash-base', base)
    root.style.setProperty('--wash-pools', pools)
    root.style.setProperty('--wash-grain', GRAIN)
    return () => {
      root.style.removeProperty('--wash-grain')
      root.style.removeProperty('--wash-base')
      root.style.removeProperty('--wash-pools')
    }
  }, [base, pools, enabled, phone])

  if (!enabled) return null
  const transition = reducedMotion() ? 'none' : 'opacity 700ms ease'
  const layer = (i: 0 | 1, id: string): React.JSX.Element => (
    <div
      data-testid={id}
      className="absolute inset-0"
      style={{
        background: layers.bg[i],
        opacity: layers.active === i ? strength : 0,
        transition,
        ...(phone && { willChange: 'opacity' })
      }}
    />
  )
  return (
    <div
      aria-hidden
      data-game={game}
      data-testid="art-wash"
      className={cn(
        'pointer-events-none inset-0 -z-10 overflow-hidden',
        phone ? 'fixed' : 'absolute'
      )}
      style={phone ? OWN_LAYER : undefined}
    >
      <div
        className="absolute inset-0"
        style={{
          background: base,
          transition: reducedMotion() ? 'none' : 'background-color 700ms ease',
          ...(phone && OWN_LAYER)
        }}
      />
      {layer(0, 'wash-a')}
      {layer(1, 'wash-b')}
      {phone ? (
        <div
          data-testid="wash-grain"
          className="absolute inset-0"
          style={{ background: `${GRAIN_PLAIN}, ${SHADE}`, ...OWN_LAYER }}
        />
      ) : (
        <>
          <div className="absolute inset-0" style={{ background: SHADE }} />
          <div
            data-testid="wash-grain"
            className="absolute inset-0"
            style={{ backgroundImage: GRAIN, opacity: 0.22, mixBlendMode: 'overlay' }}
          />
        </>
      )}
    </div>
  )
}
