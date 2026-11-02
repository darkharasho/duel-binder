import type { GameId } from '../games/types'
import { pairWinner, tiltFinish, type TiltModel, type TiltPair } from './tilt'

type Pairs = readonly (readonly [string, string])[]

/** The finish pairs a tilt reading may settle for a counted row. */
export const TILT_READ_PAIRS: Partial<Record<GameId, Pairs>> = {
  pkm: [['Normal', 'Reverse Holofoil']],
  ygo: [
    ['Common', 'Ultra Rare'],
    ['Common', 'Super Rare']
  ]
}

const sameSet = (p: readonly [string, string], a: string, b: string): boolean =>
  (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a)

/** The enabled pairs among `finishes`: in `pairs` and in the model, both members present. */
function enabledPairs(model: TiltModel, finishes: readonly string[], pairs: Pairs): TiltPair[] {
  return model.pairs.filter(
    (mp) =>
      finishes.includes(mp.a) &&
      finishes.includes(mp.b) &&
      pairs.some((p) => sameSet(p, mp.a, mp.b))
  )
}

/**
 * The finishes among `rarities` a tilt reading may choose between, or null when it may not
 * update the row: none overframe or full art, every finish one the model knows (an unknown one
 * could be the true finish), and at least one enabled pair among them.
 */
export function readFinishes(
  game: GameId,
  rarities: readonly string[],
  model: TiltModel,
  pairs: Pairs = TILT_READ_PAIRS[game] ?? []
): string[] | null {
  if (rarities.some((r) => /overframe|full art/i.test(r))) return null
  const known = [...new Set(rarities.map((r) => tiltFinish(game, r)))]
  if (known.some((f) => !model.classes.includes(f))) return null
  return enabledPairs(model, known, pairs).length ? known : null
}

/**
 * The finish that wins every enabled pair it is in, is in at least one, and is the only one to do
 * so; null otherwise (including when no enabled pair is in the model).
 */
export function pickByRead(
  model: TiltModel,
  features: readonly number[],
  finishes: readonly string[],
  pairs: Pairs
): string | null {
  const live = enabledPairs(model, finishes, pairs)
  const inPairs = new Map<string, number>()
  const won = new Map<string, number>()
  for (const pair of live) {
    const winner = pairWinner(pair, features)
    for (const f of [pair.a, pair.b]) inPairs.set(f, (inPairs.get(f) ?? 0) + 1)
    won.set(winner, (won.get(winner) ?? 0) + 1)
  }
  const sweeps = [...inPairs].filter(([f, n]) => won.get(f) === n).map(([f]) => f)
  return sweeps.length === 1 ? sweeps[0] : null
}
