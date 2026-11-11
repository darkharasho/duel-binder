/**
 * How a Pokémon Reverse Holofoil printing looks, drawn over the one flat image every finish shares:
 * the card's own reverse pattern where we have drawn its era's (Scarlet & Violet's stained glass,
 * Sword & Shield's chevrons, Sun & Moon's Energy symbols), and everywhere a dimmed, duller body
 * around the art, the way the foil film mutes the print (Mega Evolution's reverses, and the eras
 * whose patterns aren't drawn). The art itself and the card's border are left alone.
 */
import { eraPattern, type EraPattern, type PatternEra } from './reversePatterns'

/** The art's box, as percent of the card: `top`/`bottom` from its top, `left`/`right` inset. */
interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

/** The card's border, as percent of the card: the look stops inside it. */
interface Border {
  x: number
  y: number
}

/** A traced outline, as `[x, y]` percent of the card. */
type Outline = readonly (readonly [number, number])[]

interface Layout {
  art: Box
  border: Border
  /** The silver Pokédex bar under a Pokémon's art, starting where the art ends; left plain too. */
  strip?: Box | Outline
  /**
   * Where the drawn pattern fades in from the top, as percent of the card: clear above the first,
   * full from the second, so the name, HP and the Basic, Stage or TRAINER heading stay legible.
   */
  fade: readonly [number, number]
}

const MODERN_BORDER: Border = { x: 4, y: 2.8 }
/**
 * Mega Evolution's body starts 3.7–4% in and 2.7–2.9% down depending on the image's source, so the
 * look reaches the nearest of them: a dulled sliver of silver border shows less than a bright one
 * of body.
 */
const ME_BORDER: Border = { x: 3.65, y: 2.65 }
const MODERN_ART: Box = { top: 9.3, bottom: 47.6, left: 7.4, right: 7.2 }
const MODERN_TRAINER_ART: Box = { top: 14.8, bottom: 53, left: 8, right: 7.3 }

/**
 * Mega Evolution's Pokédex bar: a rounded left end and a tail that tapers up to the right, traced
 * just inside the silver so no body shows around it.
 */
const ME_STRIP: Outline = [
  [6.8, 47.6],
  [95, 47.6],
  [94.6, 48.3],
  [93.8, 48.8],
  [92.8, 49.2],
  [92, 49.9],
  [91.6, 50.3],
  [6.6, 50.3],
  [5.6, 49.7],
  [5.4, 48.8],
  [5.8, 48]
]

// Measured on sample cards of each layout (733 × 1024 scans).
const LAYOUTS = {
  modern: {
    art: MODERN_ART,
    border: MODERN_BORDER,
    strip: { top: 47.6, bottom: 50.3, left: 4.6, right: 4.2 },
    fade: [8, 11]
  },
  'modern-trainer': {
    art: MODERN_TRAINER_ART,
    border: MODERN_BORDER,
    fade: [13, 16]
  },
  me: { art: MODERN_ART, border: ME_BORDER, strip: ME_STRIP, fade: [8, 11] },
  'me-trainer': { art: MODERN_TRAINER_ART, border: ME_BORDER, fade: [13, 16] },
  // XY and Black & White Trainers carry a taller name banner over the art.
  'banner-trainer': {
    art: { top: 17.1, bottom: 53, left: 8.6, right: 7 },
    border: MODERN_BORDER,
    fade: [15, 18]
  },
  wotc: {
    art: { top: 11.6, bottom: 50.8, left: 10.5, right: 10.5 },
    border: { x: 5.5, y: 4 },
    fade: [9, 12]
  },
  'wotc-trainer': {
    art: { top: 15.2, bottom: 55.8, left: 9.2, right: 7.8 },
    border: { x: 5.5, y: 4 },
    fade: [13, 16]
  },
  ereader: {
    art: { top: 10.8, bottom: 48.5, left: 9.7, right: 4.2 },
    border: { x: 4, y: 3 },
    fade: [8.5, 11.5]
  },
  'ereader-trainer': {
    art: { top: 15.4, bottom: 51.5, left: 9.7, right: 10 },
    border: { x: 4, y: 3 },
    fade: [13, 16]
  }
} as const satisfies Record<string, Layout>

type LayoutName = keyof typeof LAYOUTS

// Set-code prefixes ("SK 1/144"), the only era a printing carries.
const EREADER_SETS = new Set(['EX', 'AQ', 'SK'])
const WOTC_SETS = new Set(['BS', 'JU', 'FO', 'B2', 'RO', 'G1', 'G2', 'N1', 'N2', 'N3', 'N4'])
const LEGENDARY_COLLECTION = 'LC'
const ME_SETS = new Set(['MEG', 'PFL', 'ASC', 'POR', 'CRI', 'PBL', 'DLR', 'MEE', 'MEP'])
const BANNER_TRAINER_SETS = new Set([
  // Black & White
  'BLW',
  'EP',
  'NVI',
  'NXD',
  'DEX',
  'DRX',
  'DRV',
  'BCR',
  'PLS',
  'PLF',
  'PLB',
  'LTR',
  'BWP',
  'RC',
  // XY
  'XY',
  'FLF',
  'FFI',
  'PHF',
  'PRC',
  'DCR',
  'ROS',
  'AOR',
  'BKT',
  'BKP',
  'GEN',
  'FCO',
  'STS',
  'EVO',
  'KSS',
  'XYP'
])

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
  'SVP',
  'MFB'
])
const SWSH_SETS = new Set([
  'SSH',
  'RCL',
  'DAA',
  'CPA',
  'VIV',
  'SHF',
  'BST',
  'CRE',
  'EVS',
  'FST',
  'BRS',
  'ASR',
  'PGO',
  'LOR',
  'SIT',
  'CRZ'
])
const SM_SETS = new Set([
  'SUM',
  'GRI',
  'BUS',
  'SLG',
  'CIN',
  'UPR',
  'FLI',
  'CES',
  'DRM',
  'LOT',
  'TEU',
  'DET',
  'UNB',
  'UNM',
  'HIF',
  'CEC'
])

const setPrefix = (setCode: string): string => setCode.trim().split(/\s/)[0].toUpperCase()

function layoutFor(set: string, category: string): LayoutName {
  const trainer = category !== 'pokemon'
  if (WOTC_SETS.has(set) || set === LEGENDARY_COLLECTION) return trainer ? 'wotc-trainer' : 'wotc'
  if (EREADER_SETS.has(set)) return trainer ? 'ereader-trainer' : 'ereader'
  if (ME_SETS.has(set)) return trainer ? 'me-trainer' : 'me'
  if (!trainer) return 'modern'
  return BANNER_TRAINER_SETS.has(set) ? 'banner-trainer' : 'modern-trainer'
}

function patternEra(set: string): PatternEra | null {
  if (SV_SETS.has(set)) return 'sv'
  if (SWSH_SETS.has(set)) return 'swsh'
  return SM_SETS.has(set) ? 'sm' : null
}

const W = 733
const H = 1024
const r1 = (n: number): number => Math.round(n * 10) / 10

/**
 * Sword & Shield's and Sun & Moon's weakness, resistance and retreat bars, across the card above
 * the flavour text: silver, so left plain. Scarlet & Violet prints that row straight on the body.
 */
const STAT_BARS: Box = { top: 85.6, bottom: 89.4, left: 4.1, right: 4.1 }

/** White inside the border, cut by the art's box (and `bars`): where the look is drawn. */
function regionMask({ art, border, strip }: Layout, bars: Box | null): string {
  const [bx, by] = [(border.x / 100) * W, (border.y / 100) * H]
  const radius = 14
  const inner =
    `M${r1(bx + radius)} ${r1(by)}H${r1(W - bx - radius)}Q${r1(W - bx)} ${r1(by)} ${r1(W - bx)} ${r1(by + radius)}` +
    `V${r1(H - by - radius)}Q${r1(W - bx)} ${r1(H - by)} ${r1(W - bx - radius)} ${r1(H - by)}` +
    `H${r1(bx + radius)}Q${r1(bx)} ${r1(H - by)} ${r1(bx)} ${r1(H - by - radius)}` +
    `V${r1(by + radius)}Q${r1(bx)} ${r1(by)} ${r1(bx + radius)} ${r1(by)}Z`
  // Holes must not overlap, or even-odd fills the overlap back in.
  const hole = (b: Box | Outline): string => {
    if (Array.isArray(b)) {
      const pts = (b as Outline).map(([x, y]) => `${r1((x / 100) * W)} ${r1((y / 100) * H)}`)
      return `M${pts[0]}${pts
        .slice(1)
        .map((p) => `L${p}`)
        .join('')}Z`
    }
    const box = b as Box
    const [x0, x1] = [(box.left / 100) * W, W - (box.right / 100) * W]
    const [y0, y1] = [(box.top / 100) * H, (box.bottom / 100) * H]
    return `M${r1(x0)} ${r1(y0)}H${r1(x1)}V${r1(y1)}H${r1(x0)}Z`
  }
  const holes = hole(art) + (strip ? hole(strip) : '') + (bars ? hole(bars) : '')
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' preserveAspectRatio='none'>` +
    `<path fill='#fff' fill-rule='evenodd' d='${inner}${holes}'/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

const masks = new Map<string, string>()
function maskFor(layout: LayoutName, bars: boolean): string {
  const key = `${layout}${bars ? '+bars' : ''}`
  let mask = masks.get(key)
  if (!mask) {
    mask = regionMask(LAYOUTS[layout], bars ? STAT_BARS : null)
    masks.set(key, mask)
  }
  return mask
}

export interface ReverseLook {
  /** CSS mask (a url()) of the card's body around its art, inside the border. */
  region: string
  /** The era's drawn pattern, tinted by the card's type; null: only the dimmed body. */
  pattern: (EraPattern & { css: string; opacity: number; fade: string }) | null
}

export interface ReverseCard {
  /** "Pokemon", "Trainer" or "Energy"; unknown is taken as a Pokémon. */
  category?: string | null
  /** The card's Energy types; the first picks the pattern's symbol and colour. */
  types?: readonly string[] | null
}

/** A finish is a reverse ("Reverse Holofoil", "Set Logo Reverse Holofoil", "Mirror Reverse Holo"). */
export const isReverseFinish = (finish: string | null | undefined): boolean =>
  /\breverse\b/i.test(finish ?? '')

/**
 * A Pokémon printing's reverse look, or null when its finish isn't a reverse. `setCode` is the
 * printing's ("DRI 040/182") or its set's ("DRI").
 */
export function reverseLook(
  finish: string | null | undefined,
  setCode: string,
  card: ReverseCard | null | undefined
): ReverseLook | null {
  if (!isReverseFinish(finish)) return null
  const set = setPrefix(setCode)
  const category = (card?.category ?? 'pokemon').trim().toLowerCase()
  const era = patternEra(set)
  let pattern: EraPattern | null = null
  if (era) {
    const type = category === 'pokemon' ? card?.types?.[0] : undefined
    pattern = eraPattern(era, type ?? 'plain') ?? eraPattern(era, 'plain')
  }
  const layout = layoutFor(set, category)
  const [clear, full] = LAYOUTS[layout].fade
  return {
    region: maskFor(layout, layout === 'modern' && (era === 'swsh' || era === 'sm')),
    // Sun & Moon's symbols are small, so they need more weight to read through the print.
    pattern: pattern && {
      ...pattern,
      css: `url("${pattern.url}")`,
      opacity: era === 'sm' ? 0.85 : 0.55,
      fade: `linear-gradient(transparent ${clear}%, #000 ${full}%)`
    }
  }
}

/** `reverseLook` for a printing and its card row (`type` is a Pokémon card's category). */
export function printingReverseLook(
  printing: { setRarity: string; setCode: string } | null | undefined,
  card: { type?: string; pokemon?: { category: string; types: string[] } } | null | undefined
): ReverseLook | null {
  if (!printing) return null
  return reverseLook(printing.setRarity, printing.setCode, {
    category: card?.pokemon?.category ?? card?.type,
    types: card?.pokemon?.types
  })
}

/**
 * The CSS mask size that crops a mask drawn over a whole image the way `object-cover` crops that
 * image in a frame: one side 100%, the other overflowing. Null when they're the same shape.
 */
export function coverFit(frame: number, image: number | null): string | null {
  if (!image || Math.abs(image / frame - 1) < 0.002) return null
  return image < frame
    ? `100% ${((frame / image) * 100).toFixed(2)}%`
    : `${((image / frame) * 100).toFixed(2)}% 100%`
}
