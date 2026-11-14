import { INK, type RGB, contrast, fromOklab, lch, unlch } from './color'
import type { Families } from './families'

export type WashTheme = 'dark' | 'light'
export interface Fitted {
  pools: { rgb: RGB; share: number }[]
  base: RGB
  worst: number
}

/**
 * Per theme: where each pool starts (lightness + how hard chroma is pushed), then lightness is
 * walked down (dark) or up (light) until the theme's text passes 4.5:1 on it.
 */
const THEMES = {
  dark: { startL: 0.62, chromaBoost: 1.9, maxC: 0.24, step: -0.01, base: { L: [0.2, 0.27], C: 0.08 } },
  light: { startL: 0.72, chromaBoost: 1.7, maxC: 0.19, step: 0.01, base: { L: [0.95, 0.96], C: 0.025 } }
}
const MIN_CONTRAST = 4.5

/** Fit families to a theme: every pool and the base pass 4.5:1 against that theme's text. */
export function fit({ fams, dark }: Families, theme: WashTheme): Fitted {
  const t = THEMES[theme]
  const ink = INK[theme]
  const pools = fams.map(({ lab, share }) => {
    let C = lch(lab)[1]
    const H = lch(lab)[2]
    C = Math.min(t.maxC, C * t.chromaBoost)
    let L = t.startL
    let rgb = fromOklab(unlch([L, C, H]))
    while (contrast(rgb, ink) < MIN_CONTRAST && L > 0.05 && L < 0.99) {
      L += t.step
      rgb = fromOklab(unlch([L, C, H]))
    }
    return { rgb, share }
  })
  const [dL, dC, dH] = lch(fams[0] ? dark : [0.25, 0, 0])
  const H = fams[0] ? lch(fams[0].lab)[2] : dH
  const bL = theme === 'dark' ? Math.min(t.base.L[1], Math.max(t.base.L[0], dL)) : t.base.L[0]
  const base = fromOklab(
    unlch([bL, Math.min(t.base.C, theme === 'dark' ? dC * 1.5 : t.base.C), theme === 'dark' ? dH : H])
  )
  return { pools, base, worst: Math.min(...pools.map((p) => contrast(p.rgb, ink)), contrast(base, ink)) }
}
