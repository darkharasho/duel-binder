import type { TcGroup, TcProduct, TdCard, TdSet } from './types'
import { versionSubtype } from './versions'

interface CardId { id: number; subtype: string | null }

/** The TCGplayer product ids on a card's variants, each with the variant's version subtype. */
function variantIds(card: TdCard): CardId[] {
  const out: CardId[] = []
  for (const v of card.variants_detailed ?? []) {
    const id = v.thirdParty?.tcgplayer
    if (typeof id === 'number') out.push({ id, subtype: versionSubtype(v.subtype) })
  }
  return out
}

/** The card's own TCGplayer product id, if any. */
function cardLevelId(card: TdCard): CardId[] {
  const id = card.thirdParty?.tcgplayer
  return typeof id === 'number' ? [{ id, subtype: null }] : []
}

/** A set or group name with any leading "{code}: ", case and punctuation removed. */
function normalizeName(name: string): string {
  return name
    .replace(/^\S+:\s+/, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function unique<T>(hits: T[]): T | null {
  return hits.length === 1 ? hits[0] : null
}

/**
 * The TCGCSV group of a TCGdex set: the group holding most of the set's product ids, if at least
 * half; else the unique group whose abbreviation is the set's (case insensitive; the TCGdex set id
 * stands in when the set has no official abbreviation); else the unique group with the same
 * normalized name; else null. Ids found in no group still count toward the "half".
 */
export function matchGroup(
  set: TdSet,
  cards: TdCard[],
  groups: TcGroup[],
  productGroup: Map<number, number>
): number | null {
  const ids = new Set<number>()
  for (const c of cards) for (const { id } of [...variantIds(c), ...cardLevelId(c)]) ids.add(id)
  if (ids.size > 0) {
    const votes = new Map<number, number>()
    for (const id of ids) {
      const g = productGroup.get(id)
      if (g !== undefined) votes.set(g, (votes.get(g) ?? 0) + 1)
    }
    const ranked = [...votes].sort((a, b) => b[1] - a[1])
    const top = ranked[0]
    const tied = ranked.length > 1 && ranked[1][1] === top?.[1]
    if (top && !tied && top[1] * 2 >= ids.size) return top[0]
  }

  const abbrev = (set.abbreviation?.official ?? set.id).trim().toLowerCase()
  if (abbrev) {
    const hit = unique(groups.filter((g) => g.abbreviation?.trim().toLowerCase() === abbrev))
    if (hit) return hit.groupId
  }

  const name = normalizeName(set.name)
  if (name) {
    const hit = unique(groups.filter((g) => normalizeName(g.name) === name))
    if (hit) return hit.groupId
  }
  return null
}

/** The collector number of a TCGCSV Number ("001/083" → "001"). */
const numberPart = (n: string): string => n.split('/')[0].trim()

/** Whether a card's localId and a product's number part name the same card. */
function sameNumber(localId: string, number: string): boolean {
  const a = localId.trim()
  const b = numberPart(number)
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return parseInt(a, 10) === parseInt(b, 10)
  return a === b
}

export interface MatchedProduct { product: TcProduct; variantSubtype: string | null }

/**
 * The TCGplayer products of a card. Its TCGdex ids are used first: the variants' ids (each with the
 * variant's version subtype, see versionSubtype), and the card-level id only when no variant carries one. A card with no ids is
 * matched by number within its set's group (`products`), only when exactly one product has that
 * number. A product whose Number disagrees with the card's localId, or that is in no product list, is
 * dropped and reported.
 */
export function matchProducts(
  card: TdCard,
  groupId: number | null,
  products: TcProduct[],
  productById: Map<number, TcProduct>
): { products: MatchedProduct[]; problems: string[] } {
  const problems: string[] = []
  const fromVariants = variantIds(card)
  const ids = fromVariants.length > 0 ? fromVariants : cardLevelId(card)

  if (ids.length === 0) {
    if (groupId === null) return { products: [], problems }
    const hits = products.filter(
      (p) => p.groupId === groupId && p.number !== null && sameNumber(card.localId, p.number)
    )
    return { products: hits.length === 1 ? [{ product: hits[0], variantSubtype: null }] : [], problems }
  }

  const out: MatchedProduct[] = []
  const seen = new Set<string>()
  for (const { id, subtype } of ids) {
    const key = `${id}\u0000${subtype ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const product = productById.get(id)
    if (!product) {
      problems.push(`${card.id}: TCGplayer product ${id} is in no TCGCSV product list`)
      continue
    }
    if (product.number !== null && !sameNumber(card.localId, product.number)) {
      problems.push(
        `${card.id}: TCGplayer product ${id} has Number ${product.number}, not ${card.localId}; rejected`
      )
      continue
    }
    out.push({ product, variantSubtype: subtype })
  }
  return { products: out, problems }
}
