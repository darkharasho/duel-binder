import type { TdCard, TdSet } from './types'

/**
 * English art for Simplified Chinese cards with none of their own. The list's twin (`englishTwin`)
 * is the English card of the same rules, not of the same print: all rows of one effect share one
 * twin, so an AR Gloom points at the plain Gloom and a deck's Nest Ball at Sun & Moon's. A wrong
 * picture is worse than a placeholder, so a card borrows art only when its set, number and name all
 * agree and nothing suggests another print:
 *  - its mark says it is the set's regular print, and the English rarity is that tier's;
 *  - the English set is of the same series, and the number inside its count, not a secret rare;
 *  - no other regular English card of those rules in the series has different or unknown art.
 * Cards with no mark are left out: they are deck reprints, and on the Japanese cards, whose
 * illustrators can be compared, about 40% of unmarked cards differ from the English art where
 * under 1% of marked ones do. Traditional Chinese cards have no link to an English card at all.
 * Borrowed art is only ever a link (`art_twin_id`): `image_url` stays the card's own, so own art
 * wins whenever it arrives and the scanner's fingerprints never see English art on a Chinese card.
 */

export type TwinOutcome =
  | 'linked'
  | 'no twin'
  | 'unmapped set'
  | 'number missing'
  | 'name mismatch'
  | 'unmarked'
  | 'special rarity'
  | 'rarity mismatch'
  | 'other series'
  | 'secret number'
  | 'other art of these rules'
  | 'no English art'

const BASE = ['Common', 'Uncommon', 'Rare', 'Holo Rare']

/** The list's marks of a set's regular prints, and the English rarities of each one's tier. */
const REGULAR_MARKS: Readonly<Record<string, readonly string[]>> = {
  C: BASE,
  U: BASE,
  R: BASE,
  RR: ['Double rare', 'Holo Rare V', 'Ultra Rare'],
  RRR: ['Holo Rare VMAX', 'Holo Rare VSTAR'],
  A: ['Amazing Rare'],
  K: ['Radiant Rare'],
  ACE: ['ACE SPEC Rare']
}

const REGULAR_RARITIES = new Set(Object.values(REGULAR_MARKS).flat())

/** The list's series names as TCGdex's series ids. */
const SERIES: Readonly<Record<string, string>> = {
  'Scarlet & Violet': 'sv',
  'Sword & Shield': 'swsh',
  'Sun & Moon': 'sm',
  Mega: 'me'
}

/** Case, accents, spacing and punctuation apart. */
const nameKey = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase()

const numberKey = (n: string): string => n.replace(/^0+(?=\d)/, '').toUpperCase()

/** Inside the set's printed count, so not a secret rare or a gallery card. */
function inCount(set: TdSet, localId: string): boolean {
  const official = set.cardCount?.official
  return /^\d+$/.test(localId) && !!official && Number(localId) <= official
}

export interface EnglishPlan {
  set: TdSet
  cards: { card: TdCard; imageUrl: string | null }[]
}

export interface TwinFinder {
  find(card: TdCard, name: string, set: TdSet): { outcome: TwinOutcome; twin: TdCard | null }
}

/** `rulesOf` is a card's text, so reprints of the same rules are told from new cards of a name. */
export function englishTwins(sets: EnglishPlan[], rulesOf: (c: TdCard) => string): TwinFinder {
  // Only a set's official abbreviation: without one a set's id can read like a code ("sp", Sample).
  const byCode = new Map<string, EnglishPlan[]>()
  for (const s of sets) {
    const code = s.set.abbreviation?.official?.trim()
    if (code) byCode.set(code, [...(byCode.get(code) ?? []), s])
  }
  const rulesKey = (series: string | undefined, c: TdCard): string =>
    [series, c.category, nameKey(c.name), c.hp, rulesOf(c)].join('\u0000')
  const prints = new Map<string, TdCard[]>()
  for (const s of sets) {
    for (const { card } of s.cards) {
      if (!REGULAR_RARITIES.has(card.rarity ?? '') || !inCount(s.set, card.localId)) continue
      const key = rulesKey(s.set.serie?.id, card)
      prints.set(key, [...(prints.get(key) ?? []), card])
    }
  }

  return {
    find(card, name, set) {
      const no = (outcome: TwinOutcome): { outcome: TwinOutcome; twin: null } => ({
        outcome,
        twin: null
      })
      const link = card.englishTwin
      if (!link) return no('no twin')
      const plans = byCode.get(link.setCode) ?? []
      if (plans.length !== 1) return no('unmapped set')
      const [plan] = plans
      const number = numberKey(link.number)
      const hit = plan.cards.find((c) => numberKey(c.card.localId) === number)
      if (!hit) return no('number missing')
      const twin = hit.card
      if (nameKey(twin.name) !== nameKey(name)) return no('name mismatch')
      if (link.mark === '无标记') return no('unmarked')
      const tier = REGULAR_MARKS[link.mark]
      if (!tier) return no('special rarity')
      if (!tier.includes(twin.rarity ?? '')) return no('rarity mismatch')
      const series = plan.set.serie?.id
      if (!series || SERIES[set.serie?.id ?? ''] !== series) return no('other series')
      if (!inCount(plan.set, twin.localId)) return no('secret number')
      const others = prints.get(rulesKey(series, twin)) ?? []
      const another = others.some((c) => c.id !== twin.id && c.illustrator !== twin.illustrator)
      const unknown = others.length > 1 && others.some((c) => !c.illustrator)
      if (another || unknown) return no('other art of these rules')
      return hit.imageUrl ? { outcome: 'linked', twin } : no('no English art')
    }
  }
}
