import { isPhone } from '@/lib/platform'

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
