import { hasNativeScript } from '../../../src/shared/setNames'
import { baseEnglish } from './englishNames'
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
 * stands in when the set has no official abbreviation), or, when several share it, the only one of
 * those whose name holds every word of the set's name; else the unique group with the same
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
    const hits = groups.filter((g) => g.abbreviation?.trim().toLowerCase() === abbrev)
    const words = normalizeName(set.name).split(' ').filter(Boolean)
    const named = hits.filter((g) => {
      const own = new Set(normalizeName(g.name).split(' '))
      return words.length > 0 && words.every((w) => own.has(w))
    })
    const hit = unique(hits) ?? unique(named)
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

/** Digits with an optional letter suffix, such as "050a". */
const NUMBER_RE = /^(\d+)([a-z]*)$/i

/**
 * Whether a card's localId and a product's number part name the same card: numbers compared as
 * numbers, keeping any letter suffix ("50a" is "050a", not "050b"), else exact strings.
 */
function sameNumber(localId: string, number: string): boolean {
  const a = NUMBER_RE.exec(localId.trim())
  const b = NUMBER_RE.exec(numberPart(number))
  if (a && b) return parseInt(a[1], 10) === parseInt(b[1], 10) && a[2].toLowerCase() === b[2].toLowerCase()
  return localId.trim() === numberPart(number)
}

/** A name without its number tail or notes; both spellings occur ("Muk - 004/092", "Muk -004/092"). */
const namePart = (name: string): string =>
  name.replace(/\s+-\s*\S*\d.*$/, '').replace(/\s+-\s.*$/, '').replace(/\s*[([].*$/, '')

/** A card name for comparing: no number tail or notes, no accents, case or punctuation. */
function plainName(name: string): string {
  return namePart(name)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/☆/g, ' star')
    .replace(/δ/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Whether a product names the card: the same name, or the same base name (a Japanese card's English
 * name is built from its species, and may lack a product's "Dark" or owner).
 */
export function sameCardName(cardName: string, productName: string): boolean {
  const a = plainName(cardName)
  const b = plainName(productName)
  if (!a || !b) return false
  if (a === b) return true
  const c = plainName(baseEnglish(namePart(cardName)))
  return c !== '' && c === plainName(baseEnglish(namePart(productName)))
}

/** Edit distance of at most one: TCGplayer's own typos ("Drowsee", "Imposter Professor Oak"). */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return (
    a.slice(i + 1) === b.slice(i + 1) ||
    a.slice(i) === b.slice(i + 1) ||
    a.slice(i + 1) === b.slice(i)
  )
}

/** The shortest name a typo allowance applies to; shorter names differ by a letter on purpose. */
const MIN_TYPO_LENGTH = 6

const firstWord = (name: string): string => plainName(namePart(name).split(/\s+/)[0] ?? '')

/** A name's words, its notes and number included. */
const allWords = (name: string): string[] =>
  name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['’]/g, '')
    .replace(/δ/g, 'delta')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

/** Whether a product can be the card, by name: TCGdex's product ids and numbers can be wrong. */
export type NameCheck = (card: TdCard, productName: string) => boolean

/**
 * Whether a product could be an English card, more loosely than sameCardName: a false mismatch costs
 * a good price, so this only refuses a product that plainly names something else. Every word of the
 * card's name may sit anywhere in the product's ("Pikachu (Flying)", "Unown [A]", "Basic Water Energy",
 * "Finizen 60/197"). TCGplayer shortens Trainers and Energy ("Hiding D Energy", "Unit Energy GRW",
 * "Fairy Charm L"), so those need only their first word. A name TCGdex left in Japanese can't be
 * compared.
 */
export const namesCard: NameCheck = (card, productName) => {
  if (hasNativeScript(card.name) || sameCardName(card.name, productName)) return true
  const a = plainName(card.name)
  const b = plainName(productName)
  if (Math.min(a.length, b.length) >= MIN_TYPO_LENGTH && oneEditApart(a, b)) return true
  const words = new Set(allWords(productName))
  if (allWords(card.name).every((w) => words.has(w))) return true
  return card.category !== 'Pokemon' && firstWord(card.name) === firstWord(productName)
}

/**
 * The check for Japanese cards, whose names can't be compared with a product's: the product's
 * species must be the card's. A product name no English card uses says nothing, and neither does a
 * card with no `dexId` (Trainers, Energy). TCGdex's Japanese `dexId` is wrong now and then (ダストダス
 * has Bunnelby's), so a product of another species is refused only when the card's Japanese name
 * doesn't hold that species' Japanese name either, and that species has one to go by (every
 * ウオチルドン has Arctozolt's `dexId`, so Arctovish has none).
 */
export function speciesCheck(enCards: TdCard[], jaCards: TdCard[]): NameCheck {
  const dexOf = new Map<string, Set<number>>()
  for (const c of enCards) {
    if (c.category !== 'Pokemon' || c.dexId?.length !== 1) continue
    const base = plainName(baseEnglish(namePart(c.name)))
    if (!base) continue
    const set = dexOf.get(base)
    if (set) set.add(c.dexId[0])
    else dexOf.set(base, new Set(c.dexId))
  }
  const jaNames = new Map<number, Set<string>>()
  for (const c of jaCards) {
    if (c.category !== 'Pokemon' || c.dexId?.length !== 1) continue
    const set = jaNames.get(c.dexId[0])
    if (set) set.add(c.name.normalize('NFKC'))
    else jaNames.set(c.dexId[0], new Set([c.name.normalize('NFKC')]))
  }
  return (card, productName) => {
    if (card.category !== 'Pokemon' || !card.dexId?.length) return true
    const dex = dexOf.get(plainName(baseEnglish(namePart(productName))))
    if (!dex || card.dexId.some((d) => dex.has(d))) return true
    const own = card.name.normalize('NFKC')
    const names = [...dex].flatMap((d) => [...(jaNames.get(d) ?? [])])
    return names.length === 0 || names.some((n) => own.includes(n))
  }
}

/**
 * Sets whose cards TCGdex numbers on its own (CC001, 001) while the card itself prints the reprinted
 * card's number (2/102). Their numbers say nothing, so names decide.
 */
export const OWN_NUMBERS: ReadonlySet<string> = new Set(['cel25cc', '30th-c'])

/** A printed number as a letter prefix and a value: "BW04" and "BW004" are one number. */
const PREFIXED_RE = /^([a-z]+)0*(\d+)([a-z]*)$/i

/**
 * Whether a card's localId and a product's Number are one number, more loosely than sameNumber: art
 * only, with the name also compared. TCGdex url-encodes a few ids ("%3F" for the Unown "?").
 */
export function isSameNumber(localId: string, number: string): boolean {
  let id = localId
  try {
    id = decodeURIComponent(localId)
  } catch {
    // Not encoded: a "%" of its own.
  }
  if (sameNumber(id, number)) return true
  const a = PREFIXED_RE.exec(id.trim())
  const b = PREFIXED_RE.exec(numberPart(number))
  return (
    !!a && !!b &&
    a[1].toLowerCase() === b[1].toLowerCase() &&
    parseInt(a[2], 10) === parseInt(b[2], 10) &&
    a[3].toLowerCase() === b[3].toLowerCase()
  )
}

export interface MatchedProduct { product: TcProduct; variantSubtype: string | null }

/**
 * The TCGplayer products of a card. Its TCGdex ids are used first: the variants' ids (each with the
 * variant's version subtype, see versionSubtype), and the card-level id only when no variant carries one. A card with no ids is
 * matched within its set's group (`products`) when exactly one product has its number; in OWN_NUMBERS
 * sets, whose group prints the reprinted cards' numbers, when exactly one product has its name.
 * Every product must also pass `nameOk`, TCGdex's own ids too: they can point at another card. A
 * product whose Number disagrees with the card's localId, that fails `nameOk`, or that is in no
 * product list, is dropped and reported.
 */
export function matchProducts(
  card: TdCard,
  groupId: number | null,
  products: TcProduct[],
  productById: Map<number, TcProduct>,
  nameOk: NameCheck = () => true
): { products: MatchedProduct[]; problems: string[] } {
  const problems: string[] = []
  const fromVariants = variantIds(card)
  const ids = fromVariants.length > 0 ? fromVariants : cardLevelId(card)
  const ownNumbers = OWN_NUMBERS.has(card.set.id)

  if (ids.length === 0) {
    if (groupId === null) return { products: [], problems }
    const hits = products.filter(
      (p) =>
        p.groupId === groupId &&
        (ownNumbers
          ? sameCardName(card.name, p.name)
          : p.number !== null && sameNumber(card.localId, p.number))
    )
    if (hits.length !== 1) return { products: [], problems }
    if (!nameOk(card, hits[0].name)) {
      problems.push(`${card.id}: product ${hits[0].productId} is "${hits[0].name}"; rejected`)
      return { products: [], problems }
    }
    return { products: [{ product: hits[0], variantSubtype: null }], problems }
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
    if (!ownNumbers && product.number !== null && !sameNumber(card.localId, product.number)) {
      problems.push(
        `${card.id}: TCGplayer product ${id} has Number ${product.number}, not ${card.localId}; rejected`
      )
      continue
    }
    if (!nameOk(card, product.name) || (ownNumbers && !sameCardName(card.name, product.name))) {
      problems.push(`${card.id}: TCGplayer product ${id} is "${product.name}"; rejected`)
      continue
    }
    out.push({ product, variantSubtype: subtype })
  }
  return { products: out, problems }
}
