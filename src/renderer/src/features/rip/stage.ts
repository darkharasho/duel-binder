/** The dark spotlight behind the opener and the summary. */
export const STAGE = 'radial-gradient(ellipse at 50% 42%, #1f1f2a 0%, #0c0c11 72%)'

/** True when the OS asks for less motion; Rip then drops its slides, landings and sparkles. */
export const prefersReducedMotion = (): boolean =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
