/**
 * Our own drawings of the reverse foils that carry the card's type: Sword & Shield's chevron tiles
 * and Sun & Moon's petal cells, each with an Energy symbol. Only alpha matters, since it masks the
 * foil: more alpha, more foil.
 */

/** Simple Energy glyphs, about 24 units wide around 0,0; drawn here, even-odd so holes are cut. */
const GLYPHS: Record<string, string> = {
  Grass: 'M0-12C8-7 9 3 0 12C-9 3-8-7 0-12ZM-.8-5V8H.8V-5Z',
  Fire: 'M1-12C3-6 9-3 8 4C7 9 3 12 0 12C-5 12-8 8-8 3C-8-1-5-3-4-6C-3-3-2-2-1-2C0-5 0-9 1-12Z',
  Water: 'M0-12C4-6 8-2 8 4A8 8 0 0 1-8 4C-8-2-4-6 0-12Z',
  Lightning: 'M3-12L-7 2H-1L-3 12L7-3H1Z',
  Psychic: 'M-12 0C-6-8 6-8 12 0C6 8-6 8-12 0ZM0-4A4 4 0 1 0 0 4A4 4 0 1 0 0-4Z',
  Fighting: 'M-9-7H9V5A4 4 0 0 1 5 9H-5A4 4 0 0 1-9 5ZM-4.5-7H-3V-1H-4.5ZM.8-7H2.3V-1H.8Z',
  Darkness: 'M4-11A11 11 0 1 0 4 11A8.5 8.5 0 1 1 4-11Z',
  Metal: 'M0-12L10-6V6L0 12L-10 6V-6ZM0-4.5A4.5 4.5 0 1 0 0 4.5A4.5 4.5 0 1 0 0-4.5Z',
  Dragon: 'M-11-10L0-3L11-10L6 3L0 12L-6 3Z',
  Fairy: 'M0-12L3-3L12 0L3 3L0 12L-3 3L-12 0L-3-3Z',
  Colorless: 'M0-12L3.5-3.7H12L5.2 1.6L7.4 10L0 5.2L-7.4 10L-5.2 1.6L-12-3.7H-3.5Z'
}

/** Each type's tint at rest: pale, so it lifts the print's own colour in the pattern's shape. */
const TINTS: Record<string, string> = {
  Grass: '#d6f5c8',
  Fire: '#ffd8c4',
  Water: '#cfe9ff',
  Lightning: '#fff1b0',
  Psychic: '#efd2ff',
  Fighting: '#f7dcc0',
  Darkness: '#2c5560',
  Metal: '#bcc2ce',
  Dragon: '#f0e2a8',
  Fairy: '#ffd6ea',
  Colorless: '#c9ccd6',
  plain: '#c9ccd6'
}

/** Cards this pale need the pattern darkened into them: overlay leaves near-white alone. */
const PALE = new Set(['Metal', 'Colorless', 'plain'])
/** Cards this dark need it lightened into them: overlay leaves near-black alone too. */
const DARK = new Set(['Darkness'])

const WIDTH = 733
const HEIGHT = 1024
/** The card's border stays plain: the pattern stops at this inset. */
const INSET = 29
const INNER = WIDTH - INSET * 2

const svgUrl = (defs: string, body: string): string => {
  const box = INSET
  const h = HEIGHT - INSET * 2
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${WIDTH} ${HEIGHT}' preserveAspectRatio='none'>` +
    `<defs>${defs}<clipPath id='c'><rect x='${box}' y='${box}' width='${INNER}' height='${h}' rx='14'/></clipPath></defs>` +
    `<g clip-path='url(#c)'>${body}</g></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const glyphDef = (glyph: string | null): string =>
  glyph ? `<path id='g' fill-rule='evenodd' d='${glyph}'/>` : ''

/** Sword & Shield: columns of chevron tiles, alternating tone, a symbol in each. */
function chevrons(glyph: string | null): string {
  const columns = 7
  const point = 15
  const w = INNER / columns
  const h = 62
  // Centred on 0,0 so a symbol can be cut straight out of it.
  const [l, r, t, b] = [-w / 2, w / 2, -(h + point) / 2, (h + point) / 2]
  const tile = `M${l} ${t}L0 ${t + point}L${r} ${t}V${b - point}L0 ${b}L${l} ${b - point}Z`
  const parts: string[] = []
  // Rows run up from the bottom, so the top bar gets the partial ones.
  for (let row = 0; row * h < HEIGHT; row++) {
    const cy = HEIGHT - INSET - row * h - h + (h + point) / 2
    for (let col = 0; col < columns; col++) {
      const cx = INSET + col * w + w / 2
      const at = `x='${cx}' y='${cy}'`
      if ((col + row) % 2 === 0) {
        // A strong tile with its symbol cut out, so the symbol reads darker.
        parts.push(`<use href='#c1' ${at} fill-opacity='.72'/>`)
      } else {
        // A weak tile with its symbol on top, so the symbol reads lighter.
        parts.push(`<use href='#t' ${at} fill-opacity='.3'/>`)
        if (glyph) parts.push(`<use href='#g' ${at} fill-opacity='.6'/>`)
      }
    }
  }
  const cut = `<path id='c1' fill-rule='evenodd' d='${tile}${glyph ?? ''}'/>`
  return svgUrl(`<path id='t' d='${tile}'/>${cut}${glyphDef(glyph)}`, parts.join(''))
}

/** Sun & Moon: staggered rows of petal cells with light outlines, a symbol in each. */
function petals(glyph: string | null): string {
  const w = INNER / 8
  const r = w / 2
  const h = 84
  const cell = `M0 ${r}A${r} ${r} 0 0 1 ${w} ${r}V${h - 8}A${r} ${r} 0 0 1 0 ${h - 8}Z`
  const parts: string[] = []
  for (let row = 0; row * (h - 22) < HEIGHT; row++) {
    const y = INSET - 40 + row * (h - 22)
    const shift = row % 2 === 0 ? 0 : -w / 2
    for (let col = 0; col < 9; col++) {
      const x = INSET + shift + col * w
      parts.push(
        `<use href='#p' x='${x}' y='${y}' fill-opacity='.34' stroke='#000' stroke-opacity='.85' stroke-width='3'/>`
      )
      if (glyph) parts.push(`<use href='#g' x='${x + r}' y='${y + h / 2}' fill-opacity='.8'/>`)
    }
  }
  return svgUrl(`<path id='p' d='${cell}'/>${glyphDef(glyph)}`, parts.join(''))
}

export type PatternEra = 'swsh' | 'sm'

export interface EraPattern {
  url: string
  tint: string
  restBlend?: 'multiply' | 'screen'
}

const made = new Map<string, EraPattern>()

/**
 * An era's reverse pattern for a type; `plain` is the same pattern with no symbol (Trainers and
 * Energy). Null for a type with no glyph. Drawn on first use and kept.
 */
export function eraPattern(era: PatternEra, type: string): EraPattern | null {
  const glyph = type === 'plain' ? null : GLYPHS[type]
  if (glyph === undefined) return null
  const key = `${era}/${type}`
  let pattern = made.get(key)
  if (!pattern) {
    pattern = {
      url: era === 'swsh' ? chevrons(glyph) : petals(glyph),
      tint: TINTS[type],
      ...(PALE.has(type) ? { restBlend: 'multiply' as const } : {}),
      ...(DARK.has(type) ? { restBlend: 'screen' as const } : {})
    }
    made.set(key, pattern)
  }
  return pattern
}
