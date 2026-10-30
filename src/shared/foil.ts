import { artBox } from './rip/rarity'
import { gameOfId, type GameId } from './games'
import { MIN_CONFIDENCE, type DetectedArtWindow } from './artWindow'

/**
 * How a printing's foil looks, for the shine drawn over its (flat) scan:
 * - `none`: no foil, so nothing at all is drawn (Normal printings, non-holo Rares).
 * - `reverse`: foil over the whole card except the artwork (Pokémon's Reverse Holofoil). The strip
 *   under the art is foil too.
 * - `holo`: foil inside the artwork only, stopping at its bottom edge.
 * - `fullart`: textured foil over the whole card: the card is all art, so there's no window.
 * - `gold`: `fullart` in gold (hyper rares).
 */
export type FoilKind = 'none' | 'reverse' | 'holo' | 'fullart' | 'gold'

/** The artwork's box as percent of the card: `top`/`bottom` from its top, `left`/`right` inset. */
export interface ArtWindow {
  top: number
  bottom: number
  left: number
  right: number
  /** Rounds the two left corners, by this percent of the card's width (the e-Reader sets). */
  leftRadius?: number
}

/**
 * Where the art sits by layout, measured on a sample of each: the fallback when a card's image
 * doesn't show its box clearly. `modern` holds from EX to Scarlet & Violet, near enough.
 */
export const ART_WINDOWS = {
  modern: { top: 9.2, bottom: 50, left: 7.2, right: 7.2 },
  'modern-trainer': { top: 14, bottom: 52, left: 8.5, right: 8.5 },
  wotc: { top: 11.6, bottom: 50.8, left: 10.5, right: 10.5 },
  'wotc-trainer': { top: 15.2, bottom: 55.8, left: 9.2, right: 7.8 },
  ereader: { top: 10.8, bottom: 48.5, left: 9.7, right: 4.2, leftRadius: 7 },
  'ereader-trainer': { top: 15.4, bottom: 51.5, left: 9.7, right: 10, leftRadius: 7 }
} as const satisfies Record<string, ArtWindow>

export type ArtLayout = keyof typeof ART_WINDOWS

/**
 * How a foil moves and what its texture is, on top of where it sits (`FoilKind`). Each is one
 * `[data-finish]` block in index.css.
 */
export type FoilFinish =
  | 'none'
  | 'lines' // modern holo: upright streaks against a broad wash
  | 'stars' // WotC holo: fixed star flecks in a slow sheen
  | 'sheen' // EX holo: a broad diagonal sheen over fine grain
  | 'glitter' // e-Reader holo: dense even glitter
  | 'amazing' // coarse weave with saturated patches
  | 'reverse' // modern reverse: large embossed pattern, brightest head-on
  | 'reverse-flat' // EX and e-Reader reverse: plain mirror sheen
  | 'sparkle' // V and ex: diagonal patches of fine sparkle
  | 'contour' // full art: fingerprint lines
  | 'ridges' // VMAX: raised stripes, slow colour
  | 'vstar' // contour lines with flashing glitter
  | 'lattice' // radiant: huge crossing bands that travel
  | 'feather' // shiny: pale feathery lines
  | 'fields' // gallery: two big colour fields that swap
  | 'scanlines' // full art trainer: silver stacked lines
  | 'rainbow' // secret: glitter over a tint, the print's rainbow left alone
  | 'gold' // one hue, heavy glitter, dim head-on

// Set-code prefixes ("SK 1/144"), the only era a printing carries.
const EREADER_SETS = new Set(['EX', 'AQ', 'SK'])
const EX_SETS = new Set([
  'RS',
  'SS',
  'DR',
  'MA',
  'HL',
  'RG',
  'TR',
  'DX',
  'EM',
  'UF',
  'DS',
  'LM',
  'HP',
  'CG',
  'DF',
  'PK'
])
const WOTC_SETS = new Set([
  'BS',
  'JU',
  'FO',
  'B2',
  'RO',
  'G1',
  'G2',
  'N1',
  'N2',
  'N3',
  'N4',
  'LC',
  'BASEP'
])

/**
 * A Pokémon card's layout, from its printing's set code and its category; null when neither says
 * (Energy, or a card with no category), which leaves only what the image shows.
 */
export function pokemonLayoutFor(
  setCode: string,
  category: string | null | undefined
): ArtLayout | null {
  const kind = category?.trim().toLowerCase()
  if (kind !== 'pokemon' && kind !== 'trainer') return null
  const suffix = kind === 'trainer' ? '-trainer' : ''
  const era = eraOf(setCode)
  return `${era === 'ex' ? 'modern' : era}${suffix}` as ArtLayout
}

type Era = 'wotc' | 'ereader' | 'ex' | 'modern'

function eraOf(setCode: string): Era {
  const set = setCode.trim().split(/\s/)[0]
  if (EREADER_SETS.has(set)) return 'ereader'
  if (WOTC_SETS.has(set)) return 'wotc'
  return EX_SETS.has(set) ? 'ex' : 'modern'
}

const PKM_FINISHES: Record<string, FoilFinish> = {
  'ultra rare': 'contour',
  'illustration rare': 'contour',
  'special illustration rare': 'contour',
  'art rare': 'contour',
  'special art rare': 'contour',
  'black white rare': 'contour',
  'double rare': 'sparkle',
  'triple rare': 'sparkle',
  'holo rare v': 'sparkle',
  'ace spec rare': 'sparkle',
  'holo rare vmax': 'ridges',
  'holo rare vstar': 'vstar',
  'radiant rare': 'lattice',
  'shiny rare': 'feather',
  'shiny rare v': 'feather',
  'shiny rare vmax': 'feather',
  'shiny ultra rare': 'feather',
  'character rare': 'fields',
  'character super rare': 'fields',
  'full art trainer': 'scanlines',
  'secret rare': 'rainbow',
  'amazing rare': 'amazing'
}

/** A foil's look: the card's rarity where it has its own, else its era's holo or reverse. */
export function foilFinishFor(
  kind: FoilKind,
  game: GameId,
  setCode: string,
  cardRarity?: string | null
): FoilFinish {
  if (kind === 'none') return 'none'
  if (kind === 'gold') return 'gold'
  if (game === 'ygo') return kind === 'holo' ? 'lines' : 'contour'
  const own = PKM_FINISHES[(cardRarity ?? '').trim().toLowerCase()]
  if (own) return own
  const era = eraOf(setCode)
  if (kind === 'reverse') return era === 'modern' || era === 'wotc' ? 'reverse' : 'reverse-flat'
  if (kind === 'holo') {
    return era === 'wotc'
      ? 'stars'
      : era === 'ereader'
        ? 'glitter'
        : era === 'ex'
          ? 'sheen'
          : 'lines'
  }
  return 'contour'
}

// Pokémon card rarities (TCGdex's spelling, compared lower-cased) that are foil on every printing.
// Anything not listed takes its foil from the printing's finish alone.
const PKM_GOLD = new Set(['hyper rare', 'mega hyper rare'])
const PKM_WHOLE_CARD = new Set([
  'ultra rare',
  'double rare',
  'triple rare',
  'illustration rare',
  'special illustration rare',
  'art rare',
  'special art rare',
  'secret rare',
  'shiny rare',
  'shiny rare v',
  'shiny rare vmax',
  'shiny ultra rare',
  'character rare',
  'character super rare',
  'full art trainer',
  'black white rare',
  'holo rare v',
  'holo rare vmax',
  'holo rare vstar',
  'radiant rare',
  'ace spec rare'
])

// Yu-Gi-Oh! rarities (exact labels). Super/Ultra/Secret foil is the artwork; the rest cover the card.
const YGO_HOLO = new Set([
  'Super Rare',
  'Ultra Rare',
  'Secret Rare',
  'Ultimate Rare',
  'Ghost Rare',
  'Prismatic Secret Rare',
  'Quarter Century Secret Rare',
  'Platinum Secret Rare',
  'Ultra Secret Rare',
  'Extra Secret Rare',
  "Collector's Rare",
  '10000 Secret Rare'
])
const YGO_WHOLE_CARD = new Set(['Starlight Rare', 'Ghost/Gold Rare'])
const YGO_GOLD = new Set(['Gold Rare', 'Premium Gold Rare', 'Gold Secret Rare'])

/**
 * The foil a printing is drawn with: the one place that turns catalog data into a foil.
 *
 * Pokémon: `setRarity` is the printing's finish ("Normal", "Holofoil", "Reverse Holofoil", often
 * with a stamp in front: "1st Edition Holofoil", "Set Logo Reverse Holofoil") and `cardRarity` the
 * card's rarity. A rarity that's foil on every printing wins, the catalog sometimes calling those
 * "Normal"; otherwise the finish decides, so one card's Normal printing is `none` and its Reverse
 * Holofoil `reverse`.
 *
 * Yu-Gi-Oh!: `setRarity` is the rarity; `cardRarity` is unused.
 */
export function foilKindFor(
  printing: { setRarity: string },
  game: GameId,
  cardRarity?: string | null
): FoilKind {
  const label = printing.setRarity.trim()
  if (game === 'ygo') {
    if (YGO_GOLD.has(label)) return 'gold'
    if (YGO_WHOLE_CARD.has(label)) return 'fullart'
    if (YGO_HOLO.has(label)) return 'holo'
    return 'none'
  }
  const rarity = (cardRarity ?? '').trim().toLowerCase()
  if (PKM_GOLD.has(rarity)) return 'gold'
  if (PKM_WHOLE_CARD.has(rarity)) return 'fullart'
  const finish = label.toLowerCase()
  if (/\breverse\b/.test(finish)) return 'reverse'
  if (/\bholo(foil)?\b/.test(finish)) return 'holo'
  return 'none'
}

/** A picture the light of a reverse foil shows up, and where the art sits in that picture. */
export interface FoilTexture {
  url: string
  art: ArtWindow
}

/**
 * Optional pictures for Scarlet & Violet reverse foils, by `${type}/${stage}`: the catalog's type
 * ("Grass", "Darkness", "Colorless") and `basic` or `stage`. Their alpha is the pattern. Empty: a
 * card with no entry keeps the plain reverse foil.
 */
export const REVERSE_TEXTURES: Record<string, FoilTexture> = {}

const SV_SETS = new Set([
  'SVI',
  'PAL',
  'OBF',
  'MEW',
  'PAR',
  'PAF',
  'TEF',
  'TWM',
  'SFA',
  'SCR',
  'SSP',
  'PRE',
  'JTG',
  'DRI',
  'BLK',
  'WHT',
  'SVE',
  'SVP'
])

/**
 * A reverse foil's picture: Scarlet & Violet Pokémon only, chosen by the card's first type and
 * whether it's a Basic or evolved. Null for anything else (Trainers, Energy, other eras).
 */
export function reverseTextureFor(
  setCode: string,
  pokemon: FoilCard['pokemon'],
  table: Record<string, FoilTexture> = REVERSE_TEXTURES
): FoilTexture | null {
  if (!SV_SETS.has(setCode.trim().split(/\s/)[0])) return null
  const type = pokemon?.types?.[0]
  const stage =
    pokemon?.stage === 'Basic' ? 'basic' : /^Stage\d/.test(pokemon?.stage ?? '') ? 'stage' : null
  if (pokemon?.category.toLowerCase() !== 'pokemon' || !type || !stage) return null
  return table[`${type}/${stage}`] ?? null
}

/**
 * The CSS size and position that lay a texture over the card with its art on `window`. Percent
 * positions divide by the room left over, so a size of exactly 100% is nudged off it.
 */
export function texturePlacement(
  art: ArtWindow,
  window: ArtWindow | null
): {
  size: string
  position: string
} {
  if (!window) return { size: '100% 100%', position: '0% 0%' }
  const axis = (from: number, to: number, artFrom: number, artTo: number): [number, number] => {
    const scale = (to - from) / (artTo - artFrom)
    const size = Math.abs(scale - 1) < 0.002 ? 100.2 : scale * 100
    const offset = from - artFrom * scale
    return [round(size), round((offset / (100 - size)) * 100)]
  }
  const [w, x] = axis(window.left, 100 - window.right, art.left, 100 - art.right)
  const [h, y] = axis(window.top, window.bottom, art.top, art.bottom)
  return { size: `${w}% ${h}%`, position: `${x}% ${y}%` }
}

/** What PanelCardArt needs to draw a card's foil. */
export interface CardFoil {
  kind: FoilKind
  finish: FoilFinish
  /** A picture for the light to show up, in place of the finish's own pattern. */
  texture: FoilTexture | null
  /** The art's box from data, before the image is looked at; null when data doesn't say. */
  window: ArtWindow | null
  /** The card's image should be searched for its box. */
  detect: boolean
  /** Search for the e-Reader sets' rounded box. */
  roundedLeft: boolean
}

export const NO_FOIL: CardFoil = {
  kind: 'none',
  finish: 'none',
  texture: null,
  window: null,
  detect: false,
  roundedLeft: false
}

interface FoilCard {
  id: number
  frameType?: string
  pokemon?: {
    rarity: string | null
    category: string
    types?: string[]
    stage?: string | null
  } | null
}

/**
 * A printing's foil, decided from data first: a kind with no art window (or no foil) never reaches
 * image detection. Yu-Gi-Oh!'s frames are fixed, so its box comes straight from the frame type.
 */
export function cardFoil(
  printing: { setRarity: string; setCode: string } | null | undefined,
  card: FoilCard | null | undefined
): CardFoil {
  if (!printing || !card) return NO_FOIL
  const game = gameOfId(card.id)
  const kind = foilKindFor(printing, game, card.pokemon?.rarity)
  const finish = foilFinishFor(kind, game, printing.setCode, card.pokemon?.rarity)
  if (kind !== 'holo' && kind !== 'reverse') return { ...NO_FOIL, kind, finish }
  if (game === 'ygo') {
    const box = artBox(card.frameType ?? '')
    const window = { top: box.top, bottom: 100 - box.bottom, left: box.left, right: box.right }
    return { kind, finish, texture: null, window, detect: false, roundedLeft: false }
  }
  const layout = pokemonLayoutFor(printing.setCode, card.pokemon?.category)
  return {
    kind,
    finish,
    texture: kind === 'reverse' ? reverseTextureFor(printing.setCode, card.pokemon) : null,
    window: layout && ART_WINDOWS[layout],
    detect: true,
    roundedLeft: layout === 'ereader' || layout === 'ereader-trainer'
  }
}

/** Further than this (percent of the card) from the layout's box, a found box is a false find. */
const MAX_DRIFT = 4

/**
 * The window to draw: the box found in the image when it is confident (and agrees with the card's
 * layout), else the layout's. Null when neither is known: the foil is then a faint whole-card sheen.
 */
export function chooseArtWindow(
  detected: DetectedArtWindow | null | undefined,
  layout: ArtWindow | null
): ArtWindow | null {
  if (!detected || detected.confidence < MIN_CONFIDENCE) return layout
  if (!layout) return detected.window
  const { window: w } = detected
  const fits =
    Math.abs(w.top - layout.top) <= MAX_DRIFT &&
    Math.abs(w.bottom - layout.bottom) <= MAX_DRIFT &&
    Math.abs(w.left - layout.left) <= MAX_DRIFT &&
    Math.abs(w.right - layout.right) <= MAX_DRIFT
  return fits ? { ...w, leftRadius: layout.leftRadius } : layout
}

const round = (n: number): number => Math.round(n * 100) / 100

/** The box's outline, clockwise, as x, y points; the left corners as short arcs when rounded. */
export function artOutline(w: ArtWindow, cardRatio: number): [number, number][] {
  const left = w.left
  const right = 100 - w.right
  const r = w.leftRadius ?? 0
  const points: [number, number][] = [
    [right, w.top],
    [right, w.bottom]
  ]
  if (r === 0) points.push([left, w.bottom], [left, w.top])
  else {
    const ry = r * cardRatio
    const steps = 6
    const arc = (cx: number, cy: number, from: number): void => {
      for (let i = 0; i <= steps; i++) {
        const a = from + (i / steps) * (Math.PI / 2)
        points.push([cx + r * Math.cos(a), cy + ry * Math.sin(a)])
      }
    }
    arc(left + r, w.bottom - ry, Math.PI / 2)
    arc(left + r, w.top + ry, Math.PI)
  }
  return points.map(([x, y]) => [round(x), round(y)])
}

/**
 * The mask that puts a foil where it belongs on a card of `aspect` (width over height): inside
 * the art for holo, around it for reverse (the strip under the art stays in), and nowhere for the
 * whole-card kinds or when there's no window. An SVG stretched over the card, so its units are
 * percent of the card.
 */
export function foilMask(
  kind: FoilKind,
  window: ArtWindow | null,
  aspect: number
): string | undefined {
  if (!window || (kind !== 'holo' && kind !== 'reverse')) return undefined
  const box = `M${artOutline(window, aspect)
    .map(([x, y]) => `${x} ${y}`)
    .join('L')}Z`
  const path = kind === 'holo' ? box : `M0 0H100V100H0Z${box}`
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>` +
    `<path fill-rule='evenodd' d='${path}'/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}
