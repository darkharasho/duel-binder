/**
 * Our own drawings of the reverse foils that carry the card's type: Scarlet & Violet's stained
 * glass, Sword & Shield's chevron tiles and Sun & Moon's petal cells, each with Energy symbols.
 * Only alpha matters, since it masks the foil: more alpha, more foil.
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

/** Each type's tint: the pattern is this colour, printed into the card at rest. */
const TINTS: Record<string, string> = {
  Grass: '#7fc25e',
  Fire: '#f08a5a',
  Water: '#5aa9e6',
  Lightning: '#e8c53a',
  Psychic: '#b07ad0',
  Fighting: '#e09a4e',
  Darkness: '#3a6c78',
  Metal: '#a4adba',
  Dragon: '#c7a84a',
  Fairy: '#ee9cc6',
  Colorless: '#bfc2cd',
  plain: '#bfc2cd'
}

/** Dark cards need the pattern lightened into them; on the rest it prints darker than the card. */
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

/** The same numbers for the same seed, so a type's glass never changes. */
function seededRandom(seed: string): () => number {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h = (h + 0x6d2b79f5) | 0
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Point = [number, number]

/** A polygon cut down to the side of the line halfway from `a` to `b` that holds `a`. */
function clipToCloser(polygon: Point[], a: Point, b: Point): Point[] {
  const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const normal: Point = [b[0] - a[0], b[1] - a[1]]
  const side = (p: Point): number => (p[0] - mid[0]) * normal[0] + (p[1] - mid[1]) * normal[1]
  const out: Point[] = []
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length]
    const [sp, sq] = [side(p), side(q)]
    if (sp <= 0) out.push(p)
    if (sp < 0 !== sq < 0) {
      const t = sp / (sp - sq)
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
    }
  })
  return out
}

const centreOf = (polygon: Point[]): Point => [
  polygon.reduce((n, p) => n + p[0], 0) / polygon.length,
  polygon.reduce((n, p) => n + p[1], 0) / polygon.length
]

const n1 = (n: number): number => Math.round(n * 10) / 10

/** A cell shrunk towards its centre for the lead line, its corners rounded off like a cobble. */
function cobble(polygon: Point[], gap: number): string {
  const c = centreOf(polygon)
  const shrunk = polygon.map(([x, y]): Point => {
    const d = Math.hypot(x - c[0], y - c[1]) || 1
    return [x - ((x - c[0]) / d) * gap, y - ((y - c[1]) / d) * gap]
  })
  const between = (i: number): Point => {
    const [p, q] = [shrunk[i], shrunk[(i + 1) % shrunk.length]]
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  }
  const first = between(shrunk.length - 1)
  const corners = shrunk.map((p, i) => {
    const m = between(i)
    return `Q${n1(p[0])} ${n1(p[1])} ${n1(m[0])} ${n1(m[1])}`
  })
  return `M${n1(first[0])} ${n1(first[1])}${corners.join('')}Z`
}

/** A symbol at a size, outlined; `size` is its width in card units. */
const outlineGlyph = (x: number, y: number, size: number, width: number): string => {
  const scale = size / 24
  return (
    `<use href='#g' transform='translate(${n1(x)} ${n1(y)}) scale(${scale.toFixed(2)})' ` +
    `fill='none' stroke='#000' stroke-width='${(width / scale).toFixed(2)}'/>`
  )
}

/** The wheel: a spiked ring, a ring of wedges with a small symbol in each, a hub with a big one. */
function wheel(cx: number, cy: number, r: number, hasGlyph: boolean): string {
  const rays = 24
  const inner = r * 0.84
  const wedgeOut = r * 0.8
  const wedgeIn = r * 0.42
  const at = (radius: number, a: number): string =>
    `${n1(cx + radius * Math.cos(a))} ${n1(cy + radius * Math.sin(a))}`
  const spikes: string[] = []
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2
    spikes.push(at(r, a), at(inner, a + Math.PI / rays))
  }
  const hubR = r * 0.36
  const circle = `M${n1(cx - hubR)} ${n1(cy)}a${n1(hubR)} ${n1(hubR)} 0 1 0 ${n1(hubR * 2)} 0a${n1(hubR)} ${n1(hubR)} 0 1 0 ${n1(-hubR * 2)} 0Z`
  const wedges = 12
  const gap = 0.03
  const holes: string[] = []
  const parts: string[] = []
  for (let i = 0; i < wedges; i++) {
    const a0 = (i / wedges) * Math.PI * 2 + gap
    const a1 = ((i + 1) / wedges) * Math.PI * 2 - gap
    const wedge =
      `M${at(wedgeIn, a0)}L${at(wedgeOut, a0)}A${wedgeOut} ${wedgeOut} 0 0 1 ${at(wedgeOut, a1)}` +
      `L${at(wedgeIn, a1)}A${wedgeIn} ${wedgeIn} 0 0 0 ${at(wedgeIn, a0)}Z`
    holes.push(wedge)
    parts.push(`<path d='${wedge}' fill-opacity='${i % 2 ? 0.34 : 0.14}'/>`)
    if (hasGlyph) {
      const m = (a0 + a1) / 2
      const rm = (wedgeOut + wedgeIn) / 2
      parts.push(outlineGlyph(cx + rm * Math.cos(m), cy + rm * Math.sin(m), r * 0.22, 2.5))
    }
  }
  // The dark ring and the lead between wedges: the spiked disc with the wedges and hub cut out.
  parts.unshift(
    `<path fill-rule='evenodd' d='M${spikes.join('L')}Z${holes.join('')}${circle}' fill-opacity='.95'/>`,
    `<path d='${circle}' fill-opacity='.14'/>`
  )
  if (hasGlyph) parts.push(outlineGlyph(cx, cy, r * 0.44, 4))
  return parts.join('')
}

/** Scarlet & Violet: stained-glass cells of two or three tones with a big wheel at lower right. */
function glass(type: string, glyph: string | null): string {
  const random = seededRandom(`glass/${type}`)
  const [left, top, right, bottom] = [INSET, INSET, WIDTH - INSET, HEIGHT - INSET]
  const bounds: Point[] = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom]
  ]
  const columns = 8
  const rows = 12
  const sites: Point[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      sites.push([
        left + ((col + 0.5 + (random() - 0.5) * 0.85) * (right - left)) / columns,
        top + ((row + 0.5 + (random() - 0.5) * 0.85) * (bottom - top)) / rows
      ])
    }
  }
  const reach = ((right - left) / columns) * 3.2
  const tones: string[] = ['', '', '']
  const symbols: string[] = []
  const wheelAt: Point = [WIDTH * 0.66, HEIGHT * 0.67]
  const wheelR = WIDTH * 0.2
  sites.forEach((site, i) => {
    let cell = bounds
    sites.forEach((other, j) => {
      if (i === j || Math.hypot(other[0] - site[0], other[1] - site[1]) > reach) return
      cell = clipToCloser(cell, site, other)
    })
    if (cell.length < 3) return
    tones[Math.floor(random() * tones.length)] += cobble(cell, 5)
    // Scattered cells carry the symbol, any size; those crossing the edge are cut by it.
    const pick = random()
    const size = 34 + random() * 58
    const [cx, cy] = centreOf(cell)
    const clearOfWheel = Math.hypot(cx - wheelAt[0], cy - wheelAt[1]) > wheelR + size / 2
    if (glyph && clearOfWheel && cy > HEIGHT * 0.46 && pick < 0.34) {
      symbols.push(outlineGlyph(cx, cy, size, 4))
    }
  })
  const shapes = tones.map((d, i) => `<path id='s${i}' d='${d}'/>`).join('')
  const hub = `<circle cx='${wheelAt[0]}' cy='${wheelAt[1]}' r='${wheelR}' fill='#000'/>`
  const defs =
    `${shapes}${glyphDef(glyph)}` +
    // The lead is everything that isn't a cell; the wheel lies over the cells.
    `<mask id='lead'><rect width='${WIDTH}' height='${HEIGHT}' fill='#fff'/>` +
    `<use href='#s0' fill='#000'/><use href='#s1' fill='#000'/><use href='#s2' fill='#000'/>${hub}</mask>` +
    `<mask id='open'><rect width='${WIDTH}' height='${HEIGHT}' fill='#fff'/>${hub}</mask>`
  const body =
    `<rect width='${WIDTH}' height='${HEIGHT}' mask='url(#lead)' fill-opacity='.95'/>` +
    `<g mask='url(#open)'><use href='#s0' fill-opacity='.12'/><use href='#s1' fill-opacity='.3'/>` +
    `<use href='#s2' fill-opacity='.5'/>${symbols.join('')}</g>` +
    wheel(wheelAt[0], wheelAt[1], wheelR, glyph !== null)
  return svgUrl(defs, body)
}

export type PatternEra = 'sv' | 'swsh' | 'sm'

export interface EraPattern {
  url: string
  tint: string
  restBlend: 'multiply' | 'screen'
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
      url: era === 'sv' ? glass(type, glyph) : era === 'swsh' ? chevrons(glyph) : petals(glyph),
      tint: TINTS[type],
      restBlend: DARK.has(type) ? 'screen' : 'multiply'
    }
    made.set(key, pattern)
  }
  return pattern
}
