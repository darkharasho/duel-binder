/**
 * Matches Bandai entries to TCGplayer products, one series (or the promo pool) at a time. Entries
 * and products share a number; the kind (base, SP, TR, parallel, or a promo's name) splits them
 * into partitions, and art settles which product is which. A product already stored on a printing
 * keeps it while its art still agrees.
 */
import { distance, FINISH_MARGIN, MATCH_MARGIN, MATCH_MAX, STAMP_MAX } from './art'
import type { OpProduct } from './tcgcsv'
import type { BandaiEntry, BandaiSeries } from './types'
import { entryKind, productVersion, promoKey, reprintProduct } from './versions'

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
  const entriesOf = new Map<string, BandaiEntry[]>()
  for (const e of o.entries) entriesOf.set(e.number, [...(entriesOf.get(e.number) ?? []), e])
  const inPartition = (e: BandaiEntry, p: OpProduct): boolean => {
    const kind = kinds.get(e.bandaiId)!
    const v = versions.get(p.productId)!
    if (kind === 'promo') return v.label !== null && promoKey(v.label) === promoKey(e.cardSets)
    if (kind === 'reprint') return reprintProduct(v)
    // A premium booster's SP is TCGplayer's Jolly Roger Foil, Full Art, Gold, Manga...: any parallel.
    if (kind === 'sp') return v.kind === 'sp' || (v.kind === 'parallel' && !reprintProduct(v))
    return v.kind === kind
  }
  const dist = (e: BandaiEntry, p: OpProduct): number | null => {
    const a = o.bandaiHash(e.bandaiId)
    const b = o.tcgHash(p)
    return a === null || b === null ? null : distance(a, b)
  }
  /**
   * The product the rule picks among `pool`, or why none: the best must be within STAMP_MAX and
   * ahead of the runner-up (any product of the pool with a hash, near or not) by MATCH_MARGIN.
   * Past MATCH_MAX (a stamp-free scan) no other entry of the number may be nearer the product.
   */
  const pick = (e: BandaiEntry, pool: OpProduct[]): { product: OpProduct; d: number } | Reason => {
    if (pool.length === 0) return 'no candidate'
    const hashed = pool
      .map((p) => ({ product: p, d: dist(e, p) }))
      .filter((s): s is { product: OpProduct; d: number } => s.d !== null)
      .sort((a, b) => a.d - b.d)
    if (hashed.length === 0) return 'no art yet'
    const best = hashed[0]
    if (best.d > STAMP_MAX) return 'art disagrees'
    if (hashed.length >= 2 && hashed[1].d - best.d < MATCH_MARGIN) return 'ambiguous'
    if (best.d > MATCH_MAX && (entriesOf.get(e.number) ?? []).some((x) => {
      if (x === e) return false
      const d = dist(x, best.product)
      return d !== null && d <= best.d
    })) return 'art disagrees'
    return best
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
      if (p && d !== null && d <= STAMP_MAX) {
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

  // 3b. Mutual nearest among what is left of a number. One picture in two finishes (a premium
  // booster's Jolly Roger Foil and Textured Foil) hashes a steady few bits apart, well inside
  // MATCH_MARGIN: an entry takes the product it is nearest to by FINISH_MARGIN, when no other
  // entry left for that product is within FINISH_MARGIN of it either.
  const taken = new Set([...reserved, ...[...matches.values()].map((m) => m.product.productId)])
  const left = open.filter((e) => !matches.has(e.bandaiId))
  for (const e of left) {
    const near = (byNumber.get(e.number) ?? [])
      .filter((p) => !taken.has(p.productId) && inPartition(e, p))
      .map((p) => ({ product: p, d: dist(e, p) }))
      .filter((s): s is { product: OpProduct; d: number } => s.d !== null)
      .sort((a, b) => a.d - b.d)
    if (near.length === 0 || near[0].d > MATCH_MAX) continue
    if (near.length >= 2 && near[1].d - near[0].d < FINISH_MARGIN) continue
    const best = near[0]
    const rival = left.some((x) => {
      if (x === e || x.number !== e.number || matches.has(x.bandaiId) || !inPartition(x, best.product)) return false
      const d = dist(x, best.product)
      return d !== null && d - best.d < FINISH_MARGIN
    })
    if (rival) continue
    take(e, best.product)
    taken.add(best.product.productId)
  }

  // 3c. A reprint entry with no reprint product may be a parallel under another name: a premium
  // booster files its Manga cards as `_r2`. It takes a parallel left over, by the strict rule, when
  // no other entry of the number is within FINISH_MARGIN of that product (the plain reprint of a
  // foil whose foil entry is matched is not that foil).
  for (const e of left) {
    if (matches.has(e.bandaiId) || kinds.get(e.bandaiId) !== 'reprint') continue
    const same = o.entries.filter((x) => x !== e && x.number === e.number)
    const pool = (byNumber.get(e.number) ?? []).filter((p) => {
      const v = versions.get(p.productId)!
      return !taken.has(p.productId) && v.kind === 'parallel' && !reprintProduct(v)
    })
    const r = pick(e, pool)
    if (typeof r === 'string') continue
    const rival = same.some((x) => {
      const d = dist(x, r.product)
      return d !== null && d - r.d < FINISH_MARGIN
    })
    if (rival) continue
    take(e, r.product)
    taken.add(r.product.productId)
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
