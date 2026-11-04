import type { TcGroup } from '../pokemon/types'
import type { OpProduct } from './tcgcsv'
import type { BandaiEntry, BandaiSeries } from './types'

/** `reprint` is an entry's kind only: a card a starter deck borrows from another set. */
export type OpKind = 'base' | 'sp' | 'tr' | 'parallel' | 'reprint'

/** Upper case with every `-` removed: `OP-17` and `OP17` meet. */
export const normalizeCode = (code: string): string => code.toUpperCase().replace(/-/g, '')

/** Lower case, alphanumerics only, without a leading "included in". */
export const promoKey = (s: string): string => s.toLowerCase().replace(/^\s*included in\b/, '').replace(/[^a-z0-9]/g, '')

/**
 * Reads a TCGplayer product name such as `Kaido (062) (Super Alternate Art)` or
 * `Luffy (Super Pre-Release) [Participant]`. The trailing parenthesised groups are read from the
 * right; a number tag (three digits, or the product's own number) is dropped and the rest is the label.
 */
export function productVersion(p: OpProduct): { kind: OpKind; label: string | null; skip: 'don' | 'sealed' | null } {
  let name = p.name.trim()
  let suffix = ''
  const bracket = /\s*(\[[^\]]*\])$/.exec(name)
  if (bracket) { suffix = bracket[1]; name = name.slice(0, bracket.index).trim() }
  const groups: string[] = []
  // A tag follows a space, or is several words (`Jinbe - PRB02-007(Alternate Art)`): a name's own
  // one-word part stays (`Miss Doublefinger(Zala)`, `Mr.3(Galdino)`).
  const TAG = /(?:\s+\(([^()]*)\)|\(([^()]*\s[^()]*)\))$/
  for (let m = TAG.exec(name); m; m = TAG.exec(name)) {
    m[1] = m[1] ?? m[2]
    groups.unshift(m[1].trim())
    name = name.slice(0, m.index)
  }
  const words = groups.filter((g) => !/^\d{3}$/.test(g) && g !== p.number)
  const core = words.join(' ')
  const kind: OpKind = core === 'SP' ? 'sp' : core === 'TR' ? 'tr' : core === '' ? 'base' : 'parallel'
  const label = [core, suffix].filter(Boolean).join(' ') || null
  return { kind, label, skip: isDonProduct(p) ? 'don' : p.number === null ? 'sealed' : null }
}

/**
 * A DON!! card: TCGplayer's DON!! rarity, or a `DON!! Card` name with a rarity (promo DON!! cards
 * are PR). A `DON!! Card Pack` has no rarity: it is sealed.
 */
export function isDonProduct(p: Pick<OpProduct, 'name' | 'rarity'>): boolean {
  return p.rarity === 'DON!!' || (p.rarity !== null && /^DON!! Card\b/.test(p.name))
}

/** A reprint takes a product with no version words (`Nami`, `Luffy (ST21-001)`) or `(Reprint)`. */
export const reprintProduct = (v: { kind: OpKind; label: string | null }): boolean =>
  v.kind === 'base' || v.label === 'Reprint'

/**
 * The version a Bandai entry stands for. A `_p` entry whose number belongs to another set than its
 * series is a borrowed card and TCGplayer files it as SP, whatever rarity Bandai gives it; but in a
 * starter deck a borrowed card is a reprint, as is every `_r` entry, and TCGplayer lists those
 * under their own number with no version, or as `(Reprint)`.
 */
export function entryKind(e: BandaiEntry, series: Pick<BandaiSeries, 'kind' | 'setCode'>): OpKind | 'promo' {
  if (series.kind === 'promo' || series.kind === 'other') return 'promo'
  if (e.rarity === 'SP') return 'sp'
  if (e.rarity === 'TR') return 'tr'
  if (/_r\d+$/.test(e.bandaiId)) return 'reprint'
  if (!e.bandaiId.includes('_')) return 'base'
  // Whole parts only: `P` sits inside `OP17` but is not one of its parts.
  const prefix = normalizeCode(e.number.split('-')[0])
  if (series.setCode.split('-').map(normalizeCode).includes(prefix)) return 'parallel'
  return series.kind === 'deck' ? 'reprint' : 'sp'
}

export function mapGroups(series: BandaiSeries[], groups: TcGroup[]): {
  bySeries: Map<string, TcGroup>; promoPool: TcGroup[]; stampGroups: TcGroup[]
} {
  const bySeries = new Map<string, TcGroup>()
  const promoPool: TcGroup[] = []
  const stampGroups: TcGroup[] = []
  for (const g of groups) {
    const abbr = g.abbreviation ?? ''
    if (abbr.includes(' ')) { stampGroups.push(g); continue }
    const code = normalizeCode(abbr)
    const s = abbr ? series.find((x) => x.kind !== 'promo' && x.kind !== 'other' && normalizeCode(x.setCode) === code) : undefined
    if (s) bySeries.set(s.id, g)
    else promoPool.push(g)
  }
  return { bySeries, promoPool, stampGroups }
}
