import type { GameId } from './games'

export type SetType = 'booster' | 'deck' | 'tin' | 'collection' | 'promo'

export const SET_TYPES: readonly { value: SetType; label: string }[] = [
  { value: 'booster', label: 'Booster sets' },
  { value: 'deck', label: 'Decks' },
  { value: 'tin', label: 'Tins' },
  { value: 'collection', label: 'Collections' },
  { value: 'promo', label: 'Promos' }
]

/** Exact set names the rules below misfile. Keep short. */
const OVERRIDES: Record<string, SetType> = {}

/** Ordered rules on the lower-cased name; first match wins, no match is a booster. */
const RULES: [SetType, RegExp][] = [
  ['deck', /\bdecks?\b|\bstarter sets?\b|\bsuper starter\b/],
  ['tin', /\btins?\b|\bmega-tins?\b/],
  [
    'collection',
    /\bcollection\b|\bduelist pack\b|\bbattles of legend\b|\bmaximum gold\b|\bhidden arsenal\b|\bghosts from the past\b|\bduel devastator\b|\bquarter century bonanza\b|\bmega pack\b|\bchampion pack\b|special edition|\blegendary duelists\b|\bgold series\b|\bpremium gold\b|\bking['’]s court\b|\banniversary pack\b|\bcollector box\b|\badvent calendar\b/
  ],
  [
    'promo',
    /promo|prize|sweepstakes|collaboration|distribution|participation|\bots\b|sneak peek|championship|magazine|\bjump\b|movie|theater|game promotional|\btournament pack\b|winner['’]s pack|thank you pack|\bexclusive pack\b|\bevent pack\b|\blimited pack\b|collector['’]s edition/
  ]
]

/** A One Piece set by its code: ST decks, the Promotion and Other Product series, else boosters. */
function onePieceSetType(setCode: string): SetType {
  // FDS: the Japanese Family Deck Set.
  if (setCode.startsWith('ST') || setCode === 'FDS') return 'deck'
  if (setCode === 'P') return 'promo'
  if (setCode === 'OPC') return 'collection'
  return 'booster'
}

/**
 * Classify a set into one of the five set types. Yu-Gi-Oh! sets go by name (the rules below); One
 * Piece sets by code (onePieceSetType). Pokémon sets are all boosters until it has rules of its own.
 */
export function setType(s: { setName: string; setCode: string }, game: GameId = 'ygo'): SetType {
  if (game === 'op') return onePieceSetType(s.setCode)
  if (game !== 'ygo') return 'booster'
  const override = OVERRIDES[s.setName]
  if (override) return override
  const name = s.setName.toLowerCase()
  for (const [type, re] of RULES) if (re.test(name)) return type
  return 'booster'
}
