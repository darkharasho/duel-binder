import { byGame, type GameId } from './games'

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

/** Magic, by the word before a finish (`Mythic (Foil)` is a Mythic): Special and Bonus on top. */
const MTG_TOP = /^(special|bonus)\b/i
const MTG_CHASE = /^mythic\b/i

/** A rarity's chase tier in its game; no game is Yu-Gi-Oh! (a draft with no game is one). */
export function chaseTier(game: GameId | undefined, rarity: string | null, name = ''): ChaseTier {
  const r = (rarity ?? '').trim()
  return byGame<() => ChaseTier>(game ?? 'ygo', {
    pkm: () => {
      if (PKM_TOP.test(r)) return 2
      return !PKM_PLAIN.has(r.toLowerCase()) || PKM_RULE_BOX.test(name.trim()) ? 1 : 0
    },
    op: () => (OP_TOP.test(r) ? 2 : OP_CHASE.test(r) ? 1 : 0),
    mtg: () => (MTG_TOP.test(r) ? 2 : MTG_CHASE.test(r) ? 1 : 0),
    ygo: () => (YGO_TOP.test(r) ? 2 : YGO_CHASE.test(r) ? 1 : 0)
  })()
}
