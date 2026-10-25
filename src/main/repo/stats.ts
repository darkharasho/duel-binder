import type { SqlDb } from '../db/sql'
import type { CollectionStats } from '../../shared/types'
import { getMeta } from '../db/meta'
import { listEntries } from './collection'
import { LOCAL, type Scope } from './scope'

const TOP_ENTRY_LIMIT = 10

export function getStats(db: SqlDb, scope: Scope = LOCAL): CollectionStats {
  const entries = listEntries(db, { sort: 'value', dir: 'desc' }, scope)
  const cardIds = new Set<number>()
  const rarities = new Map<string, { count: number; value: number }>()
  const frames = new Map<string, number>()
  let totalCards = 0
  let totalValue = 0
  let approximateCount = 0

  for (const e of entries) {
    totalCards += e.quantity
    totalValue += e.totalValue
    if (e.priceApproximate) approximateCount++
    cardIds.add(e.card.id)
    const r = rarities.get(e.printing.setRarity) ?? { count: 0, value: 0 }
    r.count += e.quantity
    r.value += e.totalValue
    rarities.set(e.printing.setRarity, r)
    frames.set(e.card.frameType, (frames.get(e.card.frameType) ?? 0) + e.quantity)
  }

  return {
    totalCards,
    uniqueCards: cardIds.size,
    totalValue,
    approximateCount,
    byRarity: [...rarities].map(([rarity, v]) => ({ rarity, ...v })).sort((a, b) => b.value - a.value),
    byFrameType: [...frames].map(([frameType, count]) => ({ frameType, count })).sort((a, b) => b.count - a.count),
    topEntries: entries.slice(0, TOP_ENTRY_LIMIT),
    pricesUpdatedAt: getMeta(db, 'last_sync_at')
  }
}

const pad = (n: number): string => String(n).padStart(2, '0')
const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Upserts today's (local date) total value and card count. */
export function recordSnapshot(db: SqlDb, now = new Date(), scope: Scope = LOCAL): void {
  const { totalValue, totalCards } = getStats(db, scope)
  const { insertCols, insertVals } = scope.snapshotTable
  db.prepare(
    `INSERT INTO value_snapshots (${insertCols}date, total_value, total_cards) VALUES (${insertVals}?, ?, ?)
     ON CONFLICT(${insertCols}date) DO UPDATE SET total_value = excluded.total_value, total_cards = excluded.total_cards`
  ).run(localDate(now), totalValue, totalCards)
}
