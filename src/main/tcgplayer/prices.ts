import type Database from 'better-sqlite3'
import { createLimiter } from '../images/limiter'
import { createTcgProductResolver, TCGCSV_URL, tcgcsvReader } from './catalog'

/**
 * TCGplayer market prices, read from TCGCSV like the catalog. TCGCSV refreshes them once a day, so a
 * set's prices are refetched after most of a day has passed. The app doesn't record which edition a
 * copy is, so each product gets one price: its 1st Edition market price, else Limited, else Unlimited.
 */
export const TCG_PRICES_INTERVAL_MS = 20 * 60 * 60 * 1000
const EDITIONS = ['1st Edition', 'Limited', 'Unlimited']

interface PriceRow {
  productId?: number
  subTypeName?: string
  marketPrice?: number | null
}

export interface TcgPricesResult {
  groups: number
  updatedGroups: number
  failedGroups: number
  /** Sets whose stored prices were replaced or dropped; pass to applyTcgPrices. */
  changedGroups: number[]
}

/** A price must move by both this much and this share to be rewritten, so it doesn't churn (and re-upload) over cents. */
const MIN_MOVE_USD = 0.05
const MIN_MOVE_SHARE = 0.02

/**
 * Whether a stored price should be rewritten: it appeared, disappeared, or moved by at least both
 * MIN_MOVE_USD and MIN_MOVE_SHARE of the old price. Equal prices (both null included) never move.
 */
export function movedEnough(old: number | null, next: number | null): boolean {
  if (old === next) return false
  if (old === null || next === null) return true
  const move = Math.abs(next - old)
  return move >= MIN_MOVE_USD && move >= old * MIN_MOVE_SHARE
}

/** One product's price across its editions (see EDITIONS); null when none has a market price. */
export function pickMarketPrice(rows: PriceRow[]): number | null {
  const rank = (r: PriceRow): number => {
    const i = EDITIONS.indexOf(r.subTypeName ?? '')
    return i === -1 ? EDITIONS.length : i
  }
  const priced = rows
    .filter(
      (r) =>
        typeof r.marketPrice === 'number' && Number.isFinite(r.marketPrice) && r.marketPrice > 0
    )
    .sort((a, b) => rank(a) - rank(b))
  return priced.length > 0 ? (priced[0].marketPrice as number) : null
}

/** Sets holding an owned English Yu-Gi-Oh! printing (any owner, tombstones excluded). */
function ownedGroups(db: Database.Database): Set<number> {
  const resolve = createTcgProductResolver(db)
  const ids = db
    .prepare(
      `SELECT DISTINCT p.id FROM card_printings p
       WHERE p.language = 'en' AND p.game = 'ygo' AND EXISTS
         (SELECT 1 FROM collection_entries e WHERE e.printing_id = p.id AND e.deleted_at IS NULL)`
    )
    .all() as { id: number }[]
  const groups = new Set<number>()
  for (const { id } of ids) {
    const product = resolve(id)
    if (product) groups.add(product.group_id)
  }
  return groups
}

/**
 * Fetches the prices of each due set: in "all" scope every catalog set, in "owned" scope only sets
 * holding an owned English printing. A set is due when its prices were never fetched or are older than
 * TCG_PRICES_INTERVAL_MS. A failed set stays due. In "owned" scope, prices of sets no longer owned
 * are dropped. Never rejects.
 */
export async function refreshTcgPrices(
  db: Database.Database,
  opts: { version: string; scope: 'owned' | 'all'; fetchFn?: typeof fetch; now?: Date }
): Promise<TcgPricesResult> {
  const now = opts.now ?? new Date()
  const cutoff = new Date(now.getTime() - TCG_PRICES_INTERVAL_MS).toISOString()
  const all = db
    .prepare(
      `SELECT g.group_id, f.fetched_at FROM tcgplayer_groups g
       LEFT JOIN tcgplayer_price_groups f ON f.group_id = g.group_id`
    )
    .all() as { group_id: number; fetched_at: string | null }[]
  const inScope = opts.scope === 'all' ? null : ownedGroups(db)
  const due = all.filter(
    (g) =>
      (inScope === null || inScope.has(g.group_id)) &&
      (g.fetched_at === null || g.fetched_at <= cutoff)
  )
  const result: TcgPricesResult = {
    groups: due.length,
    updatedGroups: 0,
    failedGroups: 0,
    changedGroups: []
  }
  if (inScope !== null) {
    const stale = all
      .filter((g) => g.fetched_at !== null && !inScope.has(g.group_id))
      .map((g) => g.group_id)
    const dropPrices = db.prepare('DELETE FROM tcgplayer_prices WHERE group_id = ?')
    const dropFetched = db.prepare('DELETE FROM tcgplayer_price_groups WHERE group_id = ?')
    db.transaction(() => {
      for (const id of stale) {
        dropPrices.run(id)
        dropFetched.run(id)
      }
    })()
    result.changedGroups.push(...stale)
  }
  if (due.length === 0) return result

  const getJson = tcgcsvReader(opts.version, opts.fetchFn)
  const del = db.prepare('DELETE FROM tcgplayer_prices WHERE group_id = ?')
  const ins = db.prepare(
    'INSERT OR REPLACE INTO tcgplayer_prices (product_id, group_id, price) VALUES (?, ?, ?)'
  )
  const stamp = db.prepare(
    `INSERT INTO tcgplayer_price_groups (group_id, fetched_at) VALUES (?, ?)
     ON CONFLICT(group_id) DO UPDATE SET fetched_at = excluded.fetched_at`
  )
  const limit = createLimiter({ concurrency: 4, minIntervalMs: 50 })
  await Promise.all(
    due.map((g) =>
      limit(async () => {
        let rows: PriceRow[]
        try {
          rows = await getJson<PriceRow>(`${TCGCSV_URL}/${g.group_id}/prices`)
        } catch {
          result.failedGroups++
          return
        }
        const byProduct = new Map<number, PriceRow[]>()
        for (const r of rows) {
          if (!Number.isSafeInteger(r.productId)) continue
          const list = byProduct.get(r.productId as number) ?? []
          list.push(r)
          byProduct.set(r.productId as number, list)
        }
        db.transaction(() => {
          del.run(g.group_id)
          for (const [productId, list] of byProduct) {
            const price = pickMarketPrice(list)
            if (price !== null) ins.run(productId, g.group_id, price)
          }
          stamp.run(g.group_id, now.toISOString())
        })()
        result.updatedGroups++
        result.changedGroups.push(g.group_id)
      })
    )
  )
  console.info(
    `TCGplayer prices: ${result.updatedGroups} of ${due.length} sets updated` +
      (result.failedGroups > 0 ? `, ${result.failedGroups} failed` : '')
  )
  return result
}

/**
 * Sets each English Yu-Gi-Oh! printing's market_price from its TCGplayer product's price, or null when
 * it has none (TCGCSV matching is Yu-Gi-Oh! only; other games' printings are never touched). A printing matched only loosely (see createTcgProductResolver) is priced only when no other
 * printing matches that product, since TCGplayer may list just one of several rarities. Moves under
 * MIN_MOVE_USD and MIN_MOVE_SHARE are ignored. With `groups`, only printings in those sets are
 * looked at. Returns how many printings changed.
 */
export function applyTcgPrices(db: Database.Database, groups?: number[]): number {
  if (groups && groups.length === 0) return 0
  const resolve = createTcgProductResolver(db)
  const priceOf = db.prepare('SELECT price FROM tcgplayer_prices WHERE product_id = ?')
  const update = db.prepare('UPDATE card_printings SET market_price = ? WHERE id = ?')
  const inGroups = groups
    ? `AND set_code COLLATE NOCASE IN (SELECT number FROM tcgplayer_products
         WHERE group_id IN (${groups.map(() => '?').join(',')}))`
    : ''
  const printings = db
    .prepare(
      `SELECT id, market_price FROM card_printings WHERE language = 'en' AND game = 'ygo' AND set_code <> '' ${inGroups}`
    )
    .all(...(groups ?? [])) as { id: number; market_price: number | null }[]
  const matches = printings.map((p) => ({ ...p, match: resolve(p.id) }))
  const claims = new Map<number, number>()
  for (const { match } of matches) {
    if (match) claims.set(match.product_id, (claims.get(match.product_id) ?? 0) + 1)
  }
  let changed = 0
  db.transaction(() => {
    for (const { id, market_price: old, match } of matches) {
      const usable = match && (match.exact || claims.get(match.product_id) === 1)
      const price = usable
        ? ((priceOf.get(match.product_id) as { price: number } | undefined)?.price ?? null)
        : null
      if (!movedEnough(old, price)) continue
      update.run(price, id)
      changed++
    }
  })()
  return changed
}
