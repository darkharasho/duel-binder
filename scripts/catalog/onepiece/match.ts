/**
 * Matches Bandai entries to TCGplayer products, one series (or the promo pool) at a time. Entries
 * and products share a number; the kind (base, SP, TR, parallel, or a promo's name) splits them
 * into partitions, and art settles which product is which. A product already stored on a printing
 * keeps it while its art still agrees.
 */
import { distance, MATCH_MARGIN, MATCH_MAX } from './art'
import type { OpProduct } from './tcgcsv'
import type { BandaiEntry, BandaiSeries } from './types'
import { entryKind, productVersion, promoKey } from './versions'

export interface OpMatch { bandaiId: string; product: OpProduct; label: string | null }

export interface MatchOptions {
  series: BandaiSeries
  entries: BandaiEntry[]
  /** The group's, or the promo pool's. */
  products: OpProduct[]
  bandaiHash: (id: string) => string | null
  tcgHash: (p: OpProduct) => string | null
  /** bandaiId to the product id already on its printing. */
  stored: Map<string, number>
}

type Reason = 'no candidate' | 'no art yet' | 'ambiguous' | 'art disagrees'

export function matchSeries(o: MatchOptions): { matches: Map<string, OpMatch>; notes: string[]; tcgOnly: number; don: number } {
  const matches = new Map<string, OpMatch>()
  const notes: string[] = []
  let don = 0
  const live: OpProduct[] = []
  const versions = new Map<number, ReturnType<typeof productVersion>>()
  for (const p of o.products) {
    const v = productVersion(p)
    if (v.skip === 'don') don++
    if (v.skip) continue
    versions.set(p.productId, v)
    live.push(p)
  }
  const byId = new Map(live.map((p) => [p.productId, p]))
  const byNumber = new Map<string, OpProduct[]>()
  for (const p of live) {
    if (p.number === null) continue
    const list = byNumber.get(p.number) ?? []
    list.push(p)
    byNumber.set(p.number, list)
  }

  const kinds = new Map(o.entries.map((e) => [e.bandaiId, entryKind(e, o.series)]))
  const inPartition = (e: BandaiEntry, p: OpProduct): boolean => {
    const kind = kinds.get(e.bandaiId)!
    const v = versions.get(p.productId)!
    if (kind === 'promo') return v.label !== null && promoKey(v.label) === promoKey(e.cardSets)
    return v.kind === kind
  }
  const dist = (e: BandaiEntry, p: OpProduct): number | null => {
    const a = o.bandaiHash(e.bandaiId)
    const b = o.tcgHash(p)
    return a === null || b === null ? null : distance(a, b)
  }
  /** The product the rule picks among `pool`, or why none. Margin applies once there are two candidates. */
  const pick = (e: BandaiEntry, pool: OpProduct[]): { product: OpProduct; d: number } | Reason => {
    if (pool.length === 0) return 'no candidate'
    const scored = pool.map((p) => ({ product: p, d: dist(e, p) }))
    const near = scored
      .filter((s): s is { product: OpProduct; d: number } => s.d !== null && s.d <= MATCH_MAX)
      .sort((a, b) => a.d - b.d)
    if (near.length === 0) return scored.some((s) => s.d === null) ? 'no art yet' : 'art disagrees'
    if (near.length >= 2 && near[1].d - near[0].d < MATCH_MARGIN) return 'ambiguous'
    return near[0]
  }
  const label = (e: BandaiEntry, p: OpProduct): string | null =>
    kinds.get(e.bandaiId) === 'parallel' ? versions.get(p.productId)!.label : null
  const take = (e: BandaiEntry, p: OpProduct): void => {
    matches.set(e.bandaiId, { bandaiId: e.bandaiId, product: p, label: label(e, p) })
  }

  // 1. Stored products that still agree.
  const reserved = new Set<number>()
  const kept: BandaiEntry[] = []
  const open: BandaiEntry[] = []
  for (const e of o.entries) {
    const old = o.stored.get(e.bandaiId)
    if (old !== undefined) {
      const p = byId.get(old)
      const d = p ? dist(e, p) : null
      if (p && d !== null && d <= MATCH_MAX) {
        take(e, p)
        reserved.add(p.productId)
        kept.push(e)
        continue
      }
      notes.push(`${e.bandaiId}: stored product ${old} is gone or disagrees`)
    }
    open.push(e)
  }

  // 3. Assignment among unreserved products.
  const picks = new Map<string, { product: OpProduct; d: number }>()
  const failed = new Map<string, Reason>()
  for (const e of open) {
    const pool = (byNumber.get(e.number) ?? []).filter((p) => !reserved.has(p.productId) && inPartition(e, p))
    const r = pick(e, pool)
    if (typeof r === 'string') failed.set(e.bandaiId, r)
    else picks.set(e.bandaiId, r)
  }
  const users = new Map<number, number>()
  for (const r of picks.values()) users.set(r.product.productId, (users.get(r.product.productId) ?? 0) + 1)
  for (const e of open) {
    const r = picks.get(e.bandaiId)
    if (r && users.get(r.product.productId) === 1) take(e, r.product)
    else failed.set(e.bandaiId, failed.get(e.bandaiId) ?? 'ambiguous')
  }
  for (const e of open) {
    const reason = matches.has(e.bandaiId) ? undefined : failed.get(e.bandaiId)
    if (reason) notes.push(`${e.bandaiId}: no unambiguous TCGplayer product (${reason})`)
  }

  // 4. A closer product than the stored one: noted, never taken. The stored product is left out of
  // the comparison, since an old match and a new one can sit within MATCH_MARGIN of each other.
  for (const e of kept) {
    const mine = matches.get(e.bandaiId)!.product
    const pool = (byNumber.get(e.number) ?? []).filter((p) => p.productId !== mine.productId && inPartition(e, p))
    const r = pick(e, pool)
    if (typeof r !== 'string' && r.d < dist(e, mine)!) {
      notes.push(`${e.bandaiId}: matches ${r.product.productId} now, keeps ${mine.productId}`)
    }
  }

  // 5. TCGplayer-only.
  const matched = new Set([...matches.values()].map((m) => m.product.productId))
  const tcgOnly = live.filter((p) => !matched.has(p.productId)).length
  return { matches, notes, tcgOnly, don }
}
