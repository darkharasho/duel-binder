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
 * walked down (dark) or up (light) until the theme's text passes `minContrast` on it. Dark aims past
 * the 4.5:1 floor (5.5:1) so the wash sits a little deeper than the bare minimum.
 */
const THEMES = {
  dark: {
    startL: 0.62,
    chromaBoost: 1.9,
    maxC: 0.24,
    step: -0.01,
    minContrast: 5.5,
    base: { L: [0.17, 0.24], C: 0.08 }
  },
  light: {
    startL: 0.72,
    chromaBoost: 1.7,
    maxC: 0.19,
    step: 0.01,
    minContrast: 4.5,
    base: { L: [0.95, 0.96], C: 0.025 }
  }
}

/** Fit families to a theme: every pool and the base pass at least 4.5:1 against that theme's text. */
export function fit({ fams, dark }: Families, theme: WashTheme): Fitted {
  const t = THEMES[theme]
  const ink = INK[theme]
  const pools = fams.map(({ lab, share }) => {
    let C = lch(lab)[1]
    const H = lch(lab)[2]
    C = Math.min(t.maxC, C * t.chromaBoost)
    let L = t.startL
    let rgb = fromOklab(unlch([L, C, H]))
    while (contrast(rgb, ink) < t.minContrast && L > 0.05 && L < 0.99) {
      L += t.step
      rgb = fromOklab(unlch([L, C, H]))
    }
    return { rgb, share }
  })
  const [dL, dC, dH] = lch(fams[0] ? dark : [0.25, 0, 0])
  const H = fams[0] ? lch(fams[0].lab)[2] : dH
  const bL = theme === 'dark' ? Math.min(t.base.L[1], Math.max(t.base.L[0], dL)) : t.base.L[0]
  const base = fromOklab(
    unlch([
      bL,
      Math.min(t.base.C, theme === 'dark' ? dC * 1.5 : t.base.C),
      theme === 'dark' ? dH : H
    ])
  )
  return {
    pools,
    base,
    worst: Math.min(...pools.map((p) => contrast(p.rgb, ink)), contrast(base, ink))
  }
}
