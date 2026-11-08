import type { GameId } from './games'

/**
 * How much of a chase a printing's rarity is: 2 for the top rarities (a Starlight, an overframe, a
 * Special Illustration Rare), 1 for the rest worth showing off (a Secret Rare, an ex), 0 for none.
 * A rip replay fills its spare places with these when they have no price to earn one.
 */
export type ChaseTier = 0 | 1 | 2

const YGO_TOP =
  /starlight|ghost|quarter century|collector|overframe|10000|grand master|prismatic|platinum secret|plscr/i
const YGO_CHASE = /secret|ultimate|premium gold|platinum|scr\b|millennium/i

/** Pokémon's plain rarities; anything else (an ex's Double Rare, an Illustration Rare, a V) is a chase. */
const PKM_PLAIN = new Set(['', 'common', 'uncommon', 'rare', 'holo rare', 'promo', 'none'])
const PKM_TOP = /special illustration|special art|hyper|secret|shiny ultra|gold|amazing|crown/i
/** A Pokémon card named as one of the big rule-box kinds is a chase whatever its rarity says. */
const PKM_RULE_BOX = /(\bex|-EX|\bEX|\bGX|\bV|\bVMAX|\bVSTAR|\bV-UNION|\bLV\.X)$/

const OP_TOP = /^(SEC|SP|TR)\b|manga/i
const OP_CHASE = /^SR\b|alternate art|parallel/i

export function chaseTier(game: GameId | undefined, rarity: string | null, name = ''): ChaseTier {
  const r = (rarity ?? '').trim()
  if (game === 'pkm') {
    if (PKM_TOP.test(r)) return 2
    return !PKM_PLAIN.has(r.toLowerCase()) || PKM_RULE_BOX.test(name.trim()) ? 1 : 0
  }
  if (game === 'op') return OP_TOP.test(r) ? 2 : OP_CHASE.test(r) ? 1 : 0
  return YGO_TOP.test(r) ? 2 : YGO_CHASE.test(r) ? 1 : 0
}
