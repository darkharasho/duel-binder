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

// Set-code prefixes ("SK 1/144"), the only era a printing carries.
const EREADER_SETS = new Set(['EX', 'AQ', 'SK'])
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
  const set = setCode.trim().split(/\s/)[0]
  const era = EREADER_SETS.has(set) ? 'ereader' : WOTC_SETS.has(set) ? 'wotc' : 'modern'
  return `${era}${suffix}` as ArtLayout
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

/** What PanelCardArt needs to draw a card's foil. */
export interface CardFoil {
  kind: FoilKind
  /** The art's box from data, before the image is looked at; null when data doesn't say. */
  window: ArtWindow | null
  /** The card's image should be searched for its box. */
  detect: boolean
  /** Search for the e-Reader sets' rounded box. */
  roundedLeft: boolean
}

export const NO_FOIL: CardFoil = { kind: 'none', window: null, detect: false, roundedLeft: false }

interface FoilCard {
  id: number
  frameType?: string
  pokemon?: { rarity: string | null; category: string } | null
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
  if (kind !== 'holo' && kind !== 'reverse') return { ...NO_FOIL, kind }
  if (game === 'ygo') {
    const box = artBox(card.frameType ?? '')
    const window = { top: box.top, bottom: 100 - box.bottom, left: box.left, right: box.right }
    return { kind, window, detect: false, roundedLeft: false }
  }
  const layout = pokemonLayoutFor(printing.setCode, card.pokemon?.category)
  return {
    kind,
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

/** The box's outline, clockwise, in `x% y%` points; the left corners as short arcs when rounded. */
function outline(w: ArtWindow, cardRatio: number): string[] {
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
  return points.map(([x, y]) => `${round(x)}% ${round(y)}%`)
}

/**
 * The clip-path that puts a foil where it belongs on a card of `aspect` (width over height):
 * inside the art for holo, around it for reverse (the strip under the art stays in), and nowhere
 * for the whole-card kinds or when there's no window.
 */
export function foilClip(
  kind: FoilKind,
  window: ArtWindow | null,
  aspect: number
): string | undefined {
  if (!window || (kind !== 'holo' && kind !== 'reverse')) return undefined
  const box = outline(window, aspect)
  if (kind === 'holo') return `polygon(${box.join(', ')})`
  // The card, then the box as a hole; even-odd leaves the seam between them out.
  const card = ['0% 0%', '100% 0%', '100% 100%', '0% 100%', '0% 0%']
  return `polygon(evenodd, ${[...card, ...box, box[0], '0% 0%'].join(', ')})`
}
