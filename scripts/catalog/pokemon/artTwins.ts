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
