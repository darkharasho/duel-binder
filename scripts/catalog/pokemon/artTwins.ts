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
 * by English name and category, the same rarity if the card has one, and only when exactly one remains
 * (`traditionalTwins`); anything else keeps its English twin. The link is its own column,
 * `traditional_twin_id`, beside `art_twin_id`: an app from before the column ignores it and goes on
 * showing the English twin, correctly labelled, where `art_twin_id` holding a Traditional card
 * would have it call that "English art".
 *
 * A shiny card is the exception to the list's twin: its art is the shiny print's, never the plain
 * card's the list names (151C's shiny Doduo shows Paldean Fates' 199/91, not 151's 084/165). So a
 * Simplified shiny card takes the one English card of its name and rarity, from the list twin's
 * series where several are left (`'shiny print'`). Shiny art is the same picture in every language,
 * where an Illustration Rare's may be a Chinese one of its own, so only shiny cards do this.
 */

export type TwinOutcome =
  | 'linked'
  | 'shiny print'
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

const SHINY_RARITIES = new Set(['shiny rare', 'shiny ultra rare'])

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

  // English shiny cards with art, by name and rarity.
  const shiny = new Map<string, { card: TdCard; serie: string | undefined }[]>()
  for (const s of sets) {
    for (const c of s.cards) {
      const rarity = rarityKey(c.card.rarity)
      if (!c.imageUrl || !SHINY_RARITIES.has(rarity)) continue
      const key = `${nameKey(c.card.name)}|${rarity}`
      shiny.set(key, [...(shiny.get(key) ?? []), { card: c.card, serie: s.set.serie?.id }])
    }
  }

  return {
    find(card, name) {
      const no = (outcome: TwinOutcome): { outcome: TwinOutcome; twin: null } => ({
        outcome,
        twin: null
      })
      const link = card.englishTwin
      const plans = link ? (byCode.get(link.setCode) ?? []) : []
      const plan = plans.length === 1 ? plans[0] : undefined
      const hit =
        link && plan?.cards.find((c) => numberKey(c.card.localId) === numberKey(link.number))
      const rarity = rarityKey(card.rarity)
      if (SHINY_RARITIES.has(rarity) && rarityKey(hit?.card.rarity) !== rarity) {
        const all = shiny.get(`${nameKey(name)}|${rarity}`) ?? []
        const inSerie = all.filter((c) => c.serie === plan?.set.serie?.id)
        const one = all.length === 1 ? all : inSerie
        if (one.length === 1) return { outcome: 'shiny print', twin: one[0].card }
      }
      if (!link) return no('no twin')
      if (!plan) return no('unmapped set')
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
      // A rated card needs a rated match: most unrated Traditional cards are of another print, and
      // an Illustration Rare must not show the plain card.
      const left = sameKind.filter((c) => !rarity || rarity === rarityKey(c.rarity))
      if (left.length === 0) return no('rarity mismatch')
      return left.length === 1 ? { outcome: 'linked', twin: left[0] } : no('ambiguous')
    }
  }
}

/**
 * Simplified Chinese sets printed card for card from a Japanese set, by set id: the Japanese card is
 * the same print, so its art is the right picture where an English twin's is only the same rules.
 * 30th Celebration is M6a, its Classic Collection included; no Traditional Chinese edition exists.
 */
export const JAPANESE_MIRRORS: Readonly<Record<string, string>> = { '30thC': 'M6a' }

export type MirrorOutcome = 'linked' | 'unmatched' | 'no Japanese art'

/** "Basic Grass Energy" in the Japanese catalog is "Grass Energy" in the Simplified list. */
const mirrorKey = (name: string): string => nameKey(name.replace(/^basic\s+/i, ''))

/**
 * Each Simplified card's Japanese print: the card of the same number and name, else, for a card
 * numbered differently (the energies), the one card left of its name when it alone is left with
 * that name. Cards of one name left over together (three RGB Mews) can't be told apart: none.
 */
export function japaneseMirror(
  cards: { card: TdCard; name: string }[],
  japanese: { card: TdCard; name: string; imageUrl: string | null }[]
): Map<string, { outcome: MirrorOutcome; twin: TdCard | null }> {
  const byNumber = new Map(japanese.map((j) => [numberKey(j.card.localId), j]))
  const found = new Map<string, (typeof japanese)[number]>()
  const used = new Set<string>()
  for (const c of cards) {
    const j = byNumber.get(numberKey(c.card.localId))
    if (j && mirrorKey(j.name) === mirrorKey(c.name)) {
      found.set(c.card.id, j)
      used.add(j.card.id)
    }
  }
  const left = cards.filter((c) => !found.has(c.card.id))
  const leftJapanese = japanese.filter((j) => !used.has(j.card.id))
  const ofName = <T extends { name: string }>(list: T[], key: string): T[] =>
    list.filter((x) => mirrorKey(x.name) === key)
  for (const c of left) {
    const key = mirrorKey(c.name)
    const js = ofName(leftJapanese, key)
    if (js.length === 1 && ofName(left, key).length === 1) found.set(c.card.id, js[0])
  }
  return new Map(
    cards.map((c) => {
      const j = found.get(c.card.id)
      const result: { outcome: MirrorOutcome; twin: TdCard | null } = !j
        ? { outcome: 'unmatched', twin: null }
        : j.imageUrl
          ? { outcome: 'linked', twin: j.card }
          : { outcome: 'no Japanese art', twin: null }
      return [c.card.id, result]
    })
  )
}
