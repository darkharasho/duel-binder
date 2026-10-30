import { GAMES } from '@shared/games'
import { isPhone } from '@/lib/platform'

/**
 * The card's width over its height and the inverse, as calc() ratios. Rip is Yu-Gi-Oh! only (its
 * game's `features.rip`), so its cards take Yu-Gi-Oh!'s aspect.
 */
const { width: RIP_W, height: RIP_H } = GAMES.ygo.cardAspect
export const W_PER_H = `${RIP_W} / ${RIP_H}`
export const H_PER_W = `${RIP_H} / ${RIP_W}`

/**
 * The phone's narrow layouts: the card on its own with a caption under it, no side panel. Read
 * once, when Rip loads: the page loads after the phone's `window.api` is in place.
 */
export const PHONE = isPhone()

/** The dark spotlight behind the opener and the summary. */
export const STAGE = 'radial-gradient(ellipse at 50% 42%, #1f1f2a 0%, #0c0c11 72%)'

/** True when the OS asks for less motion; Rip then drops its slides, landings and sparkles. */
export const prefersReducedMotion = (): boolean =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
