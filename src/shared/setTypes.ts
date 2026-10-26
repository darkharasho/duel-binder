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

/** Classify a set into one of the five set types from its name (the code is accepted for overrides/future rules). */
export function setType(s: { setName: string; setCode: string }): SetType {
  const override = OVERRIDES[s.setName]
  if (override) return override
  const name = s.setName.toLowerCase()
  for (const [type, re] of RULES) if (re.test(name)) return type
  return 'booster'
}
