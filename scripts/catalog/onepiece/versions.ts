import type { TcGroup } from '../pokemon/types'
import type { OpProduct } from './tcgcsv'
import type { BandaiEntry, BandaiSeries } from './types'

export type OpKind = 'base' | 'sp' | 'tr' | 'parallel'

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
  for (let m = /\s*\(([^()]*)\)$/.exec(name); m; m = /\s*\(([^()]*)\)$/.exec(name)) {
    groups.unshift(m[1].trim())
    name = name.slice(0, m.index)
  }
  const words = groups.filter((g) => !/^\d{3}$/.test(g) && g !== p.number)
  const core = words.join(' ')
  const kind: OpKind = core === 'SP' ? 'sp' : core === 'TR' ? 'tr' : core === '' ? 'base' : 'parallel'
  const label = [core, suffix].filter(Boolean).join(' ') || null
  const skip = p.rarity === 'DON!!' || p.name.startsWith('DON!! Card') ? 'don' : p.number === null ? 'sealed' : null
  return { kind, label, skip }
}

/**
 * The version a Bandai entry stands for. A `_p` entry whose number belongs to another set than its
 * series is a borrowed card and TCGplayer files it as SP, whatever rarity Bandai gives it.
 */
export function entryKind(e: BandaiEntry, series: Pick<BandaiSeries, 'kind' | 'setCode'>): OpKind | 'promo' {
  if (series.kind === 'promo' || series.kind === 'other') return 'promo'
  if (e.rarity === 'SP') return 'sp'
  if (e.rarity === 'TR') return 'tr'
  if (!e.bandaiId.includes('_')) return 'base'
  const prefix = normalizeCode(e.number.split('-')[0])
  return normalizeCode(series.setCode).includes(prefix) ? 'parallel' : 'sp'
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
