import type { TcPrice, TcProduct, TdCard, TdVariant } from './types'

/**
 * Version labels (spec "Version labels"). Both sources map into one canonical vocabulary, so a card
 * that is unmatched tonight and matched later keeps the same labels; the label is part of the pkey.
 */

/** TCGplayer subTypeName → canonical label. Anything else is used verbatim and reported. */
const SUBTYPES: Record<string, string> = {
  Normal: 'Normal',
  Unlimited: 'Normal',
  Holofoil: 'Holofoil',
  'Unlimited Holofoil': 'Holofoil',
  'Reverse Holofoil': 'Reverse Holofoil',
  '1st Edition': '1st Edition',
  '1st Edition Holofoil': '1st Edition Holofoil'
}

/** TCGdex variant type → canonical label (no stamp). */
const TYPES: Record<string, string> = {
  normal: 'Normal',
  holo: 'Holofoil',
  reverse: 'Reverse Holofoil',
  // The Chinese list's finishes (chinese.ts): patterns and a stamp, spelled as the version labels.
  'poke ball pattern': 'Poke Ball Pattern',
  'master ball pattern': 'Master Ball Pattern',
  'starlight holo': 'Starlight Holo',
  'set logo holofoil': 'Set Logo Holofoil'
}

/** The finish a card sold as the key can't also be printed in unless it's sold so too (rule 6). */
const EXCLUDES: Record<string, string> = { Normal: 'Holofoil', Holofoil: 'Normal' }

/** TCGdex variant type with the 1st-edition stamp → canonical label. */
const FIRST_EDITION: Record<string, string> = { normal: '1st Edition', holo: '1st Edition Holofoil' }

/** TCGdex variant subtypes that are the plain printing, so add no prefix ("unlimited" is TCGplayer's Normal/Holofoil). */
const PLAIN_SUBTYPES = new Set(['unlimited'])

const titleCase = (s: string): string =>
  s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')

/** The subtype a TCGdex variant's versions are prefixed with, or null for none (absent or plain). */
export function versionSubtype(subtype: string | null | undefined): string | null {
  const s = subtype?.trim()
  return s && !PLAIN_SUBTYPES.has(s.toLowerCase()) ? s : null
}

const prefix = (subtype: string | null): string => (subtype ? `${titleCase(subtype)} ` : '')

/** The canonical label of a TCGplayer subTypeName ("Unlimited Holofoil" → "Holofoil"). */
export function canonicalLabel(subTypeName: string): string {
  const s = subTypeName.trim()
  return SUBTYPES[s] ?? s
}

/** A variant's label without its subtype prefix, and whether it is in the table. */
function variantBase(v: TdVariant): { label: string; known: boolean } {
  const type = v.type.trim().toLowerCase()
  // TCGdex spells one stamp several ways ("1st-edition", "1st edition", "1st Edition").
  // Sorted and deduped: the label is frozen at first write, and TCGdex's stamp order isn't stable.
  const stamps = [...new Set((v.stamp ?? []).map((s) => s.trim().toLowerCase().replace(/[\s_]+/g, '-')).filter(Boolean))].sort()
  if (stamps.length === 0 && TYPES[type]) return { label: TYPES[type], known: true }
  if (stamps.length === 1 && stamps[0] === '1st-edition' && FIRST_EDITION[type]) {
    return { label: FIRST_EDITION[type], known: true }
  }
  return { label: [...stamps.map(titleCase), TYPES[type] ?? titleCase(type)].join(' '), known: false }
}

/** The canonical label of a TCGdex variant, prefixed by its subtype ("Shadowless 1st Edition Holofoil"). */
export function variantLabel(v: TdVariant): string {
  return prefix(versionSubtype(v.subtype)) + variantBase(v).label
}

export interface PkmVersion { label: string; productId: number | null; subTypeName: string | null; price: number | null }

/**
 * Finish evidence (owner report 2026-10-30: "ground set lists in full truth").
 *
 * TCGdex serves two kinds of `variants_detailed`. A curated list (each variant has its own id) is
 * what TCGdex's editors recorded for that card. When a card has no curated list, TCGdex builds one
 * from its legacy `variants` booleans and marks every entry `variantId: "generated"`; those
 * booleans default to normal = true, reverse = false, holo = false when the set or card file says
 * nothing (tcgdex/cards-database server/compiler/utils/cardUtil.ts, variantsToVariantsDetailed and
 * cardToCardSingle). So a generated list is often TCGdex's default, not data: every card of the
 * 30th Celebration set is generated "normal", while TCGplayer sells each one only as Holofoil.
 *
 * The rules, in order:
 * 1. A curated TCGdex variant is a real printing.
 * 2. A TCGplayer subtype of a matched product is a real printing: TCGplayer lists one SKU per finish
 *    it sells, priced or not (TCGCSV's prices rows are those SKUs).
 * 3. A generated TCGdex variant is used only when the card has no TCGplayer row from a product
 *    matched to its plain printing; when it has one, TCGplayer's subtypes are the card's finishes
 *    and the generated guesses are dropped.
 * 4. A generated (or fallback) non-foil variant of an always-foil rarity is read as that rarity's
 *    foil. The list is measured, not assumed: of the cards with TCGplayer rows (2026-10-30, EN+JA),
 *    these rarities show a non-foil row on 0 cards, except Double (3/916), Secret (5/692), Holo Rare
 *    V (1/237), Hyper (1/184) and Ultra Rare (1/2097). Holo Rare (38/739), LEGEND (4/18), Rare PRIME
 *    (7/26) and Rare Holo LV.X (4/58) do show them, so they are left out. Nothing else is ever
 *    added: Common, Rare, Promo and the like keep what TCGdex says, and reverse holos are never
 *    inferred.
 * 5. A card TCGplayer has no row for, in a group where every row is one finish and the rows cover
 *    at least the set's card count, takes that finish in place of its generated variants: the
 *    whole set is sold that way. Reprint sets need this: 30th Classic Collection keeps each
 *    reprint's original number on TCGplayer ("4/102"), so its products can't be told apart by
 *    number. The version has no product and no price, since no row is known to be this card's.
 * 6. A curated Normal on a card whose plain product is sold as Holofoil and not Normal isn't a
 *    printing, nor is a curated Holofoil on one sold as Normal and not Holofoil: SM Black Star Promos
 *    has 157 curated Normals of cards sold only as Holofoil. A reverse holo is never dropped this
 *    way: TCGplayer has no row for many real ones of old sets (Skyridge, Legendary Collection).
 * 7. A foil pattern is its own version (productTreatment). TCGplayer sells each as a separate product
 *    whose row says Holofoil even on a Common with no plain holo ("Snivy (Poke Ball Pattern)"), and
 *    TCGdex files it as `reverse`; under either plain label it would make up a finish, and the
 *    label's several rows would leave it unpriced.
 * Cards that reach rule 3 or 4 have no confirmed finish; the report counts them as unverified.
 */
export const GENERATED_VARIANT_ID = 'generated'

/** TCGdex rarity names (lower case) that only exist as foil; see rule 4 above. */
const ALWAYS_FOIL = new Set([
  'rare holo', 'holo rare v', 'holo rare vmax', 'holo rare vstar', 'ultra rare', 'double rare', 'triple rare', 'illustration rare',
  'special illustration rare', 'secret rare', 'hyper rare', 'mega hyper rare', 'shiny rare',
  'shiny rare v', 'shiny rare vmax', 'shiny ultra rare', 'ace spec rare', 'radiant rare',
  'amazing rare', 'character rare', 'character super rare', 'black white rare', 'rgb rare'
])

/** Whether a TCGdex rarity is only ever printed as foil. */
export const alwaysFoil = (rarity: string | null | undefined): boolean =>
  ALWAYS_FOIL.has((rarity ?? '').trim().toLowerCase())

/**
 * The one finish a TCGplayer group is sold in (rule 5), or null: its rows must all be one subtype
 * and cover at least `cardCount` products.
 */
export function groupFinish(
  products: TcProduct[],
  prices: Map<number, TcPrice[]>,
  cardCount: number
): string | null {
  const names = new Set<string>()
  let covered = 0
  for (const p of products) {
    const rows = prices.get(p.productId) ?? []
    if (rows.length > 0) covered++
    for (const r of rows) names.add(canonicalLabel(r.subTypeName))
  }
  return names.size === 1 && covered >= cardCount ? [...names][0] : null
}

/** The foils TCGplayer names in a product's trailing brackets, by the words that give them away. */
const TREATMENT = /\b(?:ball|pattern|cosmos?|cracked ice|water web|wave foil|mirror|sheen|galaxy|tinsel|crosshatch)\b/i

/**
 * The foil pattern a TCGplayer product is sold as, in one spelling per pattern, or null for a plain
 * product, a stamp, or a bracket that only says which finish ("(Holo)", "(Non-Holo)").
 */
export function productTreatment(name: string): string | null {
  const raw = /\(([^()]*)\)\s*$/.exec(name)?.[1].trim()
  if (!raw || !TREATMENT.test(raw) || /stamp|league/i.test(raw)) return null
  if (/^cosmos?\s+(holo|holofoil|foil)$/i.test(raw)) return 'Cosmos Holo'
  if (/^cracked ice$/i.test(raw)) return 'Cracked Ice Holo'
  return /\bball$/i.test(raw) ? `${raw} Pattern` : raw
}

/** Whether TCGdex made this variant up from its legacy booleans rather than recording it. */
export const isGenerated = (v: TdVariant): boolean => v.variantId === GENERATED_VARIANT_ID

interface Source { productId: number; subTypeName: string; price: number | null }
interface Entry { sources: Map<string, Source>; candidates: Set<number>; ambiguous: boolean }

const usablePrice = (p: number | null): number | null =>
  typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : null

/**
 * A card's versions: the union, by label, of its TCGdex variants and the TCGplayer subtypes of its
 * matched products. A version taken from a (product, subtype) price row carries that row's positive
 * finite marketPrice, else null; there is no fallback to another subtype or product. A label two
 * different (product, subtype) rows would share is kept once, unpriced and with no product, and
 * reported. A version only TCGdex knows has no price; it keeps the product its variant points at, or
 * the only matched product with its subtype. A product reached under more than one variant subtype
 * (after versionSubtype, so none and "unlimited" are one) gives no product or price to any version
 * it touches, and is reported once. Generated TCGdex variants follow the finish rules above
 * (`unverified` says the card's finishes rest on them). With no versions at all the card gets a
 * single Normal (Holofoil for an always-foil rarity), also unverified. Sorted by label.
 */
export function cardVersions(
  card: TdCard,
  matched: { product: TcProduct; variantSubtype: string | null }[],
  prices: Map<number, TcPrice[]>,
  setFinish: string | null = null
): { versions: PkmVersion[]; problems: string[]; unverified: boolean } {
  const problems: string[] = []
  const entries = new Map<string, Entry>()
  const entry = (label: string): Entry => {
    let e = entries.get(label)
    if (!e) entries.set(label, (e = { sources: new Map(), candidates: new Set(), ambiguous: false }))
    return e
  }

  // A product reached under more than one version subtype can't say which printing its rows price:
  // its versions keep their labels (they're stable) but get no product, subtype or price.
  const subtypesOf = new Map<number, Set<string | null>>()
  for (const { product, variantSubtype } of matched) {
    const subs = subtypesOf.get(product.productId) ?? new Set<string | null>()
    subs.add(versionSubtype(variantSubtype))
    subtypesOf.set(product.productId, subs)
  }
  const ambiguous = new Set<number>()
  for (const [id, subs] of subtypesOf) {
    if (subs.size < 2) continue
    ambiguous.add(id)
    const names = [...subs].map((x) => (x === null ? '(none)' : JSON.stringify(x))).join(', ')
    problems.push(`${card.id}: TCGplayer product ${id} is reached under several variant subtypes (${names}); its versions are left unpriced`)
  }

  for (const { product, variantSubtype } of matched) {
    const sub = versionSubtype(variantSubtype)
    for (const row of prices.get(product.productId) ?? []) {
      const name = row.subTypeName.trim()
      if (!(name in SUBTYPES)) {
        problems.push(`${card.id}: TCGplayer subtype "${name}" of product ${product.productId} is not in the version table`)
      }
      const label = (sub === null ? productTreatment(product.name) : null) ?? prefix(sub) + canonicalLabel(name)
      const key = `${product.productId}\u0000${name}`
      if (ambiguous.has(product.productId)) {
        entry(label).ambiguous = true
        continue
      }
      const sources = entry(label).sources
      const price = usablePrice(row.marketPrice)
      const seen = sources.get(key)
      if (!seen) sources.set(key, { productId: product.productId, subTypeName: name, price })
      else if (seen.price !== price) {
        // The same row twice with different prices: no way to tell which is right.
        seen.price = null
        problems.push(`${card.id}: product ${product.productId} has conflicting "${name}" prices; left unpriced`)
      }
    }
  }

  // Rule 3: TCGplayer rows of a product matched to the plain printing settle the card's finishes.
  const plainProducts = matched.filter(
    ({ product, variantSubtype }) =>
      versionSubtype(variantSubtype) === null &&
      productTreatment(product.name) === null &&
      (prices.get(product.productId)?.length ?? 0) > 0
  )
  const plainRows = plainProducts.length > 0
  // Rule 6: the finishes the plain products are sold in.
  const sold = new Set(
    plainProducts.flatMap(({ product }) =>
      (prices.get(product.productId) ?? []).map((r) => canonicalLabel(r.subTypeName))
    )
  )
  const foil = alwaysFoil(card.rarity)
  let unverified = false
  for (const raw of card.variants_detailed ?? []) {
    let v = raw
    if (isGenerated(raw)) {
      if (plainRows) continue
      if (setFinish) {
        entry(setFinish) // Rule 5.
        continue
      }
      unverified = true
      // Rule 4: an always-foil rarity's generated "normal" is its foil.
      if (foil && raw.type.trim().toLowerCase() === 'normal') v = { ...raw, type: 'holo' }
    }
    const base = variantBase(v)
    const pattern = matched.find((m) => m.product.productId === v.thirdParty?.tcgplayer)
    const treatment = pattern && !versionSubtype(v.subtype) && !v.stamp?.length ? productTreatment(pattern.product.name) : null
    const label = treatment ?? variantLabel(v)
    const rival = EXCLUDES[label]
    if (!treatment && rival && sold.has(rival) && !sold.has(label)) continue
    if (!base.known) problems.push(`${card.id}: TCGdex variant ${JSON.stringify(v.type)}${v.stamp?.length ? ` ${JSON.stringify(v.stamp)}` : ''} is not in the version table; labelled "${label}"`)
    const e = entry(label)
    const sub = versionSubtype(v.subtype)
    const id = v.thirdParty?.tcgplayer
    const own = typeof id === 'number'
      ? matched.filter((m) => m.product.productId === id && versionSubtype(m.variantSubtype) === sub)
      : matched.filter((m) => versionSubtype(m.variantSubtype) === sub)
    for (const m of own) if (!ambiguous.has(m.product.productId)) e.candidates.add(m.product.productId)
  }

  const versions: PkmVersion[] = []
  for (const [label, e] of entries) {
    if (e.ambiguous) {
      versions.push({ label, productId: null, subTypeName: null, price: null })
    } else if (e.sources.size > 1) {
      const pairs = [...e.sources.values()].map((s) => `${s.productId} "${s.subTypeName}"`).join(', ')
      problems.push(`${card.id}: version "${label}" comes from several TCGplayer rows (${pairs}); left unpriced`)
      versions.push({ label, productId: null, subTypeName: null, price: null })
    } else if (e.sources.size === 1) {
      const s = [...e.sources.values()][0]
      versions.push({ label, productId: s.productId, subTypeName: s.subTypeName, price: s.price })
    } else {
      const only = e.candidates.size === 1 ? [...e.candidates][0] : null
      versions.push({ label, productId: only, subTypeName: null, price: null })
    }
  }

  if (versions.length === 0) {
    unverified = true
    const ids = new Set(matched.map((m) => m.product.productId))
    versions.push({ label: foil ? 'Holofoil' : 'Normal', productId: ids.size === 1 ? [...ids][0] : null, subTypeName: null, price: null })
  }
  versions.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  return { versions, problems, unverified }
}
