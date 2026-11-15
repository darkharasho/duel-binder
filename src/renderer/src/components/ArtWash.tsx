import { useEffect, useMemo, useState } from 'react'
import { useGame } from '@/lib/game'
import { css } from '@/lib/wash/color'
import { field, GRAIN } from '@/lib/wash/field'
import { fit } from '@/lib/wash/fit'
import { useWashPref } from '@/lib/washPref'
import { applyWashPref } from '@/lib/wash/applyPref'
import type { WashState } from './artWashContext'

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

type Layers = { active: 0 | 1; bg: [string, string] }

/**
 * A full-window colour field painted from one card's art: a base colour, two pool layers that
 * cross-fade when the wash changes, a shade toward the bottom and a little grain. Purely decorative.
 * `enabled` is off where something else (the scan camera) fills the background.
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
  const { families, seed, strength } = useMemo(
    () => applyWashPref(wash, pref, game),
    [wash, pref, game]
  )

  const { base, pools } = useMemo(() => {
    const fitted = fit(families, 'dark')
    return { base: css(fitted.base), pools: field(fitted, { seed, withBase: false }) }
  }, [families, seed])

  const [layers, setLayers] = useState<Layers>({ active: 0, bg: [pools, ''] })
  useEffect(() => {
    setLayers((l): Layers => {
      if (l.bg[l.active] === pools) return l
      return l.active === 0
        ? { active: 1, bg: [l.bg[0], pools] }
        : { active: 0, bg: [pools, l.bg[1]] }
    })
  }, [pools])

  // The pinned header row fades from this colour, so it reads as the wash rather than a bar.
  useEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    root.style.setProperty('--wash-base', base)
    root.style.setProperty('--wash-pools', pools)
    root.style.setProperty('--wash-grain', GRAIN)
    return () => {
      root.style.removeProperty('--wash-grain')
      root.style.removeProperty('--wash-base')
      root.style.removeProperty('--wash-pools')
    }
  }, [base, pools, enabled])

  if (!enabled) return null
  const transition = reducedMotion() ? 'none' : 'opacity 700ms ease'
  const layer = (i: 0 | 1, id: string): React.JSX.Element => (
    <div
      data-testid={id}
      className="absolute inset-0"
      style={{ background: layers.bg[i], opacity: layers.active === i ? strength : 0, transition }}
    />
  )
  return (
    <div
      aria-hidden
      data-game={game}
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <div
        className="absolute inset-0"
        style={{
          background: base,
          transition: reducedMotion() ? 'none' : 'background-color 700ms ease'
        }}
      />
      {layer(0, 'wash-a')}
      {layer(1, 'wash-b')}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(180deg, transparent 45%, rgb(8 7 12 / .5))' }}
      />
      <div
        className="absolute inset-0"
        style={{ backgroundImage: GRAIN, opacity: 0.22, mixBlendMode: 'overlay' }}
      />
    </div>
  )
}
