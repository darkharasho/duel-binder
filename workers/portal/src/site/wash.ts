import { WASHES } from './washes'

export type Wash = (typeof WASHES)[number]

/** A random wash for this page load, so each visit shows a different card's colours. */
export function pickWash(rand: () => number = Math.random): Wash {
  return WASHES[Math.min(WASHES.length - 1, Math.floor(rand() * WASHES.length))]
}

/** The `style` for `<html>`: the base colour shows under the wash and when the page overscrolls. */
export const washRootStyle = (w: Wash): string => `background:${w.base}`

/**
 * The colour field fixed behind the page. One layer painted once: no blend modes or filters, so
 * scrolling on a phone only moves the content over it.
 */
export const washLayer = (w: Wash): string =>
  `<div class="wash" aria-hidden="true" data-card="${w.card.replace(/[&"<>]/g, '')}" style="background:${w.pools}"></div>`
