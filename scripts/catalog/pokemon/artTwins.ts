import type { TdCard, TdSet } from './types'

/**
 * English art for Simplified Chinese cards with none of their own. The list's twin (`englishTwin`)
 * is the English card of the same rules, not of the same print: all rows of one effect share one
 * twin, so an AR Gloom shows the plain Gloom and a deck's Nest Ball shows Sun & Moon's. The picture
 * may be another print's; the app labels it as English art, and that beats a placeholder. A card
 * borrows art when its set, number and name agree. Traditional Chinese cards have no link to an
 * English card at all.
 * Borrowed art is only ever a link (`art_twin_id`): `image_url` stays the card's own, so own art
 * wins whenever it arrives and the scanner's fingerprints never see English art on a Chinese card.
 *
 * Traditional Chinese art is the better borrow: own art, then Traditional, then English, then the
 * placeholder. No list ties the two Chinese catalogs together, so a card takes a Traditional card
 * by English name and category, rarity too where both have one, and only when exactly one remains
 * (`traditionalTwins`); anything else keeps its English twin. The link is its own column,
 * `traditional_twin_id`, beside `art_twin_id`: an app from before the column ignores it and goes on
 * showing the English twin, correctly labelled, where `art_twin_id` holding a Traditional card
 * would have it call that "English art".
 */

export type TwinOutcome =
  | 'linked'
  | 'no twin'
  | 'unmapped set'
  | 'number missing'
  | 'name mismatch'
  | 'no English art'

/** Case, accents, spacing and punctuation apart. */
const nameKey = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase()

const numberKey = (n: string): string => n.replace(/^0+(?=\d)/, '').toUpperCase()

/** Traditional card names are only trusted once `nameTraditional` has run. */
export type TraditionalOutcome =
  | 'linked'
  | 'unnamed'
  | 'no candidate'
  | 'category mismatch'
  | 'rarity mismatch'
  | 'ambiguous'

export interface EnglishPlan {
  set: TdSet
  cards: { card: TdCard; imageUrl: string | null }[]
}

export interface TwinFinder {
  find(card: TdCard, name: string): { outcome: TwinOutcome; twin: TdCard | null }
}

export function englishTwins(sets: EnglishPlan[]): TwinFinder {
  // Only a set's official abbreviation: without one a set's id can read like a code ("sp", Sample).
  const byCode = new Map<string, EnglishPlan[]>()
  for (const s of sets) {
    const code = s.set.abbreviation?.official?.trim()
    if (code) byCode.set(code, [...(byCode.get(code) ?? []), s])
  }

  return {
    find(card, name) {
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
      return hit.imageUrl ? { outcome: 'linked', twin } : no('no English art')
    }
  }
}

export interface TraditionalPlan {
  set: TdSet
  cards: { card: TdCard; name: string; imageUrl: string | null }[]
}

export interface TraditionalFinder {
  find(card: TdCard, name: string, setId: string): { outcome: TraditionalOutcome; twin: TdCard | null }
}

/** The name `nameTraditional` and the Simplified list give a card nothing names. */
const isUnnamed = (name: string, setId: string, localId: string): boolean =>
  name === `${setId} ${localId}`

/** "Triple rare" and "Triple Rare" are one rarity. */
const rarityKey = (rarity: string | null | undefined): string => rarity?.trim().toLowerCase() ?? ''

export function traditionalTwins(sets: TraditionalPlan[]): TraditionalFinder {
  const byName = new Map<string, TdCard[]>()
  for (const { set, cards } of sets) {
    for (const { card, name, imageUrl } of cards) {
      if (!imageUrl || isUnnamed(name, set.id, card.localId)) continue
      const key = nameKey(name)
      byName.set(key, [...(byName.get(key) ?? []), card])
    }
  }

  return {
    find(card, name, setId) {
      const no = (outcome: TraditionalOutcome): { outcome: TraditionalOutcome; twin: null } => ({
        outcome,
        twin: null
      })
      if (isUnnamed(name, setId, card.localId)) return no('unnamed')
      const named = byName.get(nameKey(name)) ?? []
      if (named.length === 0) return no('no candidate')
      const sameKind = card.category ? named.filter((c) => c.category === card.category) : []
      if (sameKind.length === 0) return no('category mismatch')
      const rarity = rarityKey(card.rarity)
      const left = sameKind.filter((c) => {
        const theirs = rarityKey(c.rarity)
        return !rarity || !theirs || rarity === theirs
      })
      if (left.length === 0) return no('rarity mismatch')
      return left.length === 1 ? { outcome: 'linked', twin: left[0] } : no('ambiguous')
    }
  }
}
