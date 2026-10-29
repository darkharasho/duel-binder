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
const TYPES: Record<string, string> = { normal: 'Normal', holo: 'Holofoil', reverse: 'Reverse Holofoil' }

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
  const stamps = (v.stamp ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean)
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
 * it touches, and is reported once. With no versions at all the card gets a single Normal.
 * Sorted by label.
 */
export function cardVersions(
  card: TdCard,
  matched: { product: TcProduct; variantSubtype: string | null }[],
  prices: Map<number, TcPrice[]>
): { versions: PkmVersion[]; problems: string[] } {
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
      const label = prefix(sub) + canonicalLabel(name)
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

  for (const v of card.variants_detailed ?? []) {
    const base = variantBase(v)
    const label = variantLabel(v)
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
    const ids = new Set(matched.map((m) => m.product.productId))
    versions.push({ label: 'Normal', productId: ids.size === 1 ? [...ids][0] : null, subTypeName: null, price: null })
  }
  versions.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  return { versions, problems }
}
