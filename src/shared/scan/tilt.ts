import type { GameId } from '../games/types'
import { rarityFamily } from './rarity'

/** One pair of finishes the model tells apart, nearest centroid over the features it reads. */
export interface TiltPair {
  a: string
  b: string
  /** Indices into TiltModel.features: the k this pair reads. */
  use: readonly number[]
  /** Standardizing over `use`, from the pair's training clips. */
  mean: readonly number[]
  spread: readonly number[]
  /** Each class's centroid, standardized, over `use`. */
  ca: readonly number[]
  cb: readonly number[]
}

/** The fitted tilt classifier: the finishes it knows and a nearest-centroid pair for each two of them. */
export interface TiltModel {
  features: readonly string[]
  /** Finishes, as tiltFinish names them. */
  classes: readonly string[]
  pairs: readonly TiltPair[]
}

const YGO_PLAIN = new Set([
  'Common',
  'Short Print',
  'Super Short Print',
  'Normal Rare',
  'Kaiba Corporation Common',
  'Kaiba Corporation Rare',
  'Duel Terminal Technology Common',
  'c',
  'SP'
])

/** A catalog rarity's finish: a Yu-Gi-Oh! rarity's family, or a Pokémon version without its stamp. */
export function tiltFinish(game: GameId, rarity: string): string {
  if (game === 'ygo') return rarityFamily(rarity)
  if (/reverse/i.test(rarity)) return 'Reverse Holofoil'
  if (/pattern$/i.test(rarity)) return rarity
  if (/^Mirror\b/i.test(rarity)) return rarity
  if (/holofoil$/i.test(rarity)) return 'Holofoil'
  // Normal, any stamped Normal, and a bare stamp ("1st Edition") are all plain.
  if (/normal$/i.test(rarity) || /^(shadowless )?1st edition$/i.test(rarity)) return 'Normal'
  return rarity
}

/** Whether a finish is one the card shows a shifting shine in; unknown labels count as holo-type. */
export function isHoloType(game: GameId, finish: string): boolean {
  if (game === 'ygo') return !(YGO_PLAIN.has(finish) || /^Rare\b/.test(finish))
  return !(finish === 'Normal' || finish === 'Reverse Holofoil' || /pattern$/i.test(finish))
}

/** The known finishes among `rarities` to pick from, or null when no tilt is due. */
export function tiltFinishes(
  game: GameId,
  rarities: readonly string[],
  model: TiltModel
): string[] | null {
  if (rarities.some((r) => /overframe|full art/i.test(r))) return null
  const known = [...new Set(rarities.map((r) => tiltFinish(game, r)))].filter((f) =>
    model.classes.includes(f)
  )
  return known.filter((f) => isHoloType(game, f)).length >= 2 ? known : null
}

/**
 * The finish among `finishes` the features are nearest to: a round robin over the pairs the
 * model has, the nearer centroid winning each, most wins taking it and the larger summed margin
 * breaking a tie. Null when fewer than two of the finishes are classes, or the model has no pair
 * among them (no evidence to guess from).
 */
export function pickByTilt(
  model: TiltModel,
  features: readonly number[],
  finishes: readonly string[]
): { finish: string; margin: number } | null {
  const known = [...new Set(finishes)].filter((f) => model.classes.includes(f))
  if (known.length < 2) return null
  const wins = new Map(known.map((f) => [f, 0]))
  const margins = new Map(known.map((f) => [f, 0]))
  let scored = 0
  for (const pair of model.pairs) {
    if (!wins.has(pair.a) || !wins.has(pair.b)) continue
    let da = 0
    let db = 0
    pair.use.forEach((idx, i) => {
      const z = ((features[idx] ?? 0) - pair.mean[i]) / (pair.spread[i] || 1)
      da += (z - pair.ca[i]) ** 2
      db += (z - pair.cb[i]) ** 2
    })
    scored++
    const margin = Math.abs(Math.sqrt(da) - Math.sqrt(db))
    const winner = da <= db ? pair.a : pair.b
    wins.set(winner, wins.get(winner)! + 1)
    margins.set(winner, margins.get(winner)! + margin)
  }
  if (!scored) return null
  let best = known[0]
  for (const f of known) {
    const w = wins.get(f)!
    const bw = wins.get(best)!
    if (w > bw || (w === bw && margins.get(f)! > margins.get(best)!)) best = f
  }
  return { finish: best, margin: margins.get(best)! }
}
