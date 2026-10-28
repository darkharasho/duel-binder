// A card's look, measured region by region (vision/rarityFeatures.ts), and a learned model that
// reads a rarity from it among the rarities a card's set code was printed in, after the name and
// frame rules (rarity.ts) and only where they positively fit its pick. Fitted and evaluated by
// scripts/scan/rarity/fit-look.ts; its numbers live in lookModel.ts.
//
// Not used by the app. Held out by card, at its threshold it made no wrong pick on any source
// and raised the pick rate on eBay photos from 8% to 13% and on degraded scans from 2-3% to 4-7%,
// but on the owner's webcam shots it picked no more than the rules (5 of 81): its probabilities
// run high on webcam frames, where glitter doesn't show. It waits for more webcam data.
import { pickRarityByCues, rarityFits, type RarityCues } from './rarity'

/** The regions measured, in vector order. */
export const LOOK_REGIONS = ['name', 'art', 'frame', 'text'] as const

/**
 * Measurements of one region. Hue is the angle of (red - green, yellow - blue), which stands in
 * for HSV hue without trigonometry.
 */
export const LOOK_REGION_STATS = [
  'l', // mean luma, 0-1
  'a', // mean red - green, 0-1 scale
  'b', // mean yellow - blue
  'sat', // mean HSV saturation
  'satSd', // its spread
  'hued', // share of pixels saturated enough to have a hue
  'hueSpread', // 1 - mean resultant length of those hues: 0 one hue, 1 every hue
  'specular', // share of pixels with luma 235 or more
  'bright', // share of pixels 40 levels above the region's mean
  'fine', // mean |L - mean of its 4 neighbours|
  'mid', // mean |3x3 mean - 7x7 mean|
  'coarse', // mean |7x7 mean - 15x15 mean|
  'chromaFine', // the same as fine on red - green and yellow - blue: colour noise, rainbow glitter
  'axis', // mean |horizontal| + |vertical| gradient
  'diagonal', // mean |both diagonal| gradients
  'skew' // mean ||one diagonal| - |the other||: hatching one way
] as const

/** Measurements of the name's ink against its bar; all 0 when no name line was read. */
export const LOOK_NAME_STATS = [
  'read', // 1 when a name line was found
  'polarity', // 1 ink as plain names on this frame read, -1 the other way
  'contrast', // (bar - ink) luma, 0-1, signed so plain ink on its own frame is positive
  'inkSat',
  'barSat',
  'inkHueCos', // saturation-weighted mean hue of the ink
  'inkHueSin',
  'inkHueSpread',
  'inkLSd', // spread of the ink's luma: foil catches light unevenly
  'topSat', // saturation of the brightest eighth of the ink
  'topHueCos',
  'topHueSin',
  'topL', // their luma against the bar's
  'haloSat' // saturation of the ink dilated by 2 px, less the bar's: colour bled by the camera
] as const

/** Frame groups, one-hot. */
export const LOOK_FRAMES = ['blackName', 'whiteName', 'xyz', 'link', 'pendulum'] as const

/** Every feature's name, in vector order. */
export const LOOK_FEATURES: readonly string[] = [
  ...LOOK_REGIONS.flatMap((r) => LOOK_REGION_STATS.map((s) => `${r}.${s}`)),
  ...LOOK_NAME_STATS.map((s) => `name.${s}`),
  ...LOOK_FRAMES.map((f) => `frame.${f}`)
]

/** Frames whose plain names are printed white; the rest (but Skill) print them black. */
const WHITE_NAME_FRAMES = new Set(['spell', 'trap', 'xyz', 'xyz_pendulum', 'link'])

/** The LOOK_FRAMES groups of a frame type. */
export function frameGroups(frameType: string): number[] {
  return [
    !WHITE_NAME_FRAMES.has(frameType) && frameType !== 'skill' ? 1 : 0,
    WHITE_NAME_FRAMES.has(frameType) ? 1 : 0,
    frameType.startsWith('xyz') ? 1 : 0,
    frameType === 'link' ? 1 : 0,
    frameType.endsWith('_pendulum') ? 1 : 0
  ]
}

const NAME_AT = LOOK_REGIONS.length * LOOK_REGION_STATS.length
const FRAME_AT = NAME_AT + LOOK_NAME_STATS.length

/**
 * Features measured as on a black-name frame, for a card of frameType: the name's polarity and
 * contrast flipped where plain names are white (so positive always means ink as plain names
 * read), and the frame groups set.
 */
export function withFrame(features: readonly number[], frameType: string): number[] {
  const out = [...features]
  const sign = WHITE_NAME_FRAMES.has(frameType) ? -1 : frameType === 'skill' ? 0 : 1
  out[NAME_AT + 1] *= sign
  out[NAME_AT + 2] *= sign
  out.splice(FRAME_AT, LOOK_FRAMES.length, ...frameGroups(frameType))
  return out
}

/**
 * A multinomial logistic model over the features: one score per rarity family, a linear function
 * of the features after taking logs of the texture and highlight measures (log(v + offset), for
 * offset > 0) and standardizing. Probabilities among a card's rarities are the softmax of their
 * scores divided by temperature.
 */
export interface LookModel {
  features: readonly string[]
  /** Per feature: 0 to use it as is, else the offset added before taking its log. */
  logOffset: readonly number[]
  mean: readonly number[]
  spread: readonly number[]
  classes: readonly string[]
  /** Per class, one weight per feature. */
  weights: readonly (readonly number[])[]
  bias: readonly number[]
  temperature: number
  /** The probability a pick needs. */
  minProbability: number
}

/** The model's standardized inputs from features already set for the frame (withFrame). */
export function lookInputs(model: LookModel, features: readonly number[]): number[] {
  return features.map((v, j) => {
    const x = model.logOffset[j] ? Math.log(Math.max(0, v) + model.logOffset[j]) : v
    return (x - model.mean[j]) / model.spread[j]
  })
}

/** Each class's score (log-odds up to a constant, before the temperature) for one frame. */
export function lookScores(
  model: LookModel,
  features: readonly number[],
  frameType: string
): number[] {
  const z = lookInputs(model, withFrame(features, frameType))
  return model.classes.map((_, k) =>
    z.reduce((s, v, j) => s + v * model.weights[k][j], model.bias[k])
  )
}

/** Rarities that look like another, read as it. */
const LOOK_ALIASES: Record<string, string> = {
  'Short Print': 'Common',
  'Super Short Print': 'Common'
}

/**
 * Rarities the catalog leaves out of the many-rarity reprint sets (Rarity Collection and kin,
 * which list Collector's, Ultimate and Platinum Secret together): a card from one of those sets
 * can be one of them, so they count against every listed rarity but are never picked.
 */
const UNLISTED = {
  when: ["Collector's Rare", 'Ultimate Rare', 'Platinum Secret Rare'],
  add: ["Prismatic Collector's Rare", 'Prismatic Ultimate Rare']
}

const OVER_FRAME = /overframe|full art/i

const familyOf = (r: string): string => {
  const base = r.replace(/\s*\(.*\)\s*$/, '')
  return LOOK_ALIASES[base] ?? base
}

/**
 * The probability of each of a card's rarity families given the mean of its frames' scores
 * (averaging log-odds over the frames of one showing), or null when the model doesn't know one
 * of them. Families keyed by the base rarity, aliases resolved.
 */
export function lookOdds(
  model: LookModel,
  scores: readonly number[],
  available: readonly string[]
): Map<string, number> | null {
  // Artwork run over the frame looks like a foil frame, so with such an option nothing is read.
  if (available.some((r) => OVER_FRAME.test(r))) return null
  const families = [...new Set(available.map(familyOf))]
  const index = families.map((f) => model.classes.indexOf(f))
  if (index.some((k) => k === -1)) return null
  if (UNLISTED.when.every((f) => families.includes(f)))
    for (const f of UNLISTED.add) {
      const k = model.classes.indexOf(f)
      if (k !== -1 && !index.includes(k)) index.push(k)
    }
  const logits = index.map((k) => scores[k] / model.temperature)
  const top = Math.max(...logits)
  const exp = logits.map((v) => Math.exp(v - top))
  const total = exp.reduce((a, b) => a + b, 0)
  return new Map(families.map((f, i) => [f, exp[i] / total]))
}

/** The mean of several frames' scores; null without any. */
export function meanScores(frames: readonly (readonly number[])[]): number[] | null {
  if (!frames.length) return null
  return frames[0].map((_, k) => frames.reduce((s, f) => s + f[k], 0) / frames.length)
}

/** The family of a rarity as the look model reads it. */
export const lookFamily = familyOf

/** Rarities foil all over, frame included, whose look on a frame is its texture. */
const WHOLE_CARD_FOILS = new Set(['Starlight Rare', 'Quarter Century Secret Rare'])

/** The model's likeliest rarity for a showing, and whether the guards let it be picked. */
export interface LookCandidate {
  rarity: string
  family: string
  probability: number
  /** The next likeliest family. */
  runnerUp: string
  /**
   * Whether the guards allow it: it is the only printing of its family among the options, the
   * name and frame cues (rarityFits) positively fit it, and on Link frames (whose printed pattern
   * reads as texture) it isn't a whole-card foil, nor on Xyz frames (whose black hides glitter)
   * a plain-frame rarity over a whole-card foil, as surfaceLook reads those frames.
   */
  allowed: boolean
}

/**
 * The look model's best guess among `available` for a card of frameType, from the features of
 * the frames of one showing (averaging their scores, i.e. their log-odds) and the cues over
 * them; null when it has nothing to go on or doesn't know one of the rarities.
 */
export function lookCandidate(
  model: LookModel,
  available: string[],
  cues: RarityCues,
  frames: readonly (readonly number[])[],
  frameType: string
): LookCandidate | null {
  const scores = meanScores(frames.map((f) => lookScores(model, f, frameType)))
  return scores && candidateOf(model, scores, available, cues, frameType)
}

/** lookCandidate from the mean of the frames' scores. */
export function candidateOf(
  model: LookModel,
  scores: readonly number[],
  available: string[],
  cues: RarityCues,
  frameType: string
): LookCandidate | null {
  const odds = lookOdds(model, scores, available)
  if (!odds) return null
  const [[family, probability], [runnerUp] = ['']] = [...odds].sort((a, b) => b[1] - a[1])
  const options = [...new Set(available)].filter((r) => familyOf(r) === family)
  const fit = rarityFits(available, cues, frameType).find((f) => f.rarity === options[0])?.fit
  const xyz = frameType.startsWith('xyz')
  const mirrored =
    (frameType === 'link' && WHOLE_CARD_FOILS.has(family)) ||
    (xyz && !WHOLE_CARD_FOILS.has(family) && WHOLE_CARD_FOILS.has(runnerUp))
  return {
    rarity: options[0],
    family,
    probability,
    runnerUp,
    allowed: options.length === 1 && fit === 'fits' && !mirrored
  }
}

/**
 * pickRarityByCues, and when it can't decide, the look model's candidate when the guards allow it
 * and its probability reaches the model's minProbability.
 */
export function pickRarityByLook(
  model: LookModel,
  available: string[],
  cues: RarityCues,
  frames: readonly (readonly number[])[],
  frameType: string
): { rarity: string; certain: boolean } {
  const byCues = pickRarityByCues(available, cues, frameType)
  if (byCues.certain) return byCues
  const look = lookCandidate(model, available, cues, frames, frameType)
  return look?.allowed && look.probability >= model.minProbability
    ? { rarity: look.rarity, certain: true }
    : byCues
}
