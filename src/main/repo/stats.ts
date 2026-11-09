import type { SqlDb } from '../db/sql'
import type { CollectionStats, ValuePoint } from '../../shared/types'
import { byGame } from '../../shared/games'
import { getMeta } from '../db/meta'
import { listEntries } from './collection'
import { LOCAL, scopeGame, type Scope } from './scope'

const TOP_ENTRY_LIMIT = 10
const RECENT_ENTRY_LIMIT = 8

/** Owned copies per value of `col` in the game's facts table (joined on card_id). */
function copiesBy(
  db: SqlDb,
  scope: Scope,
  table: 'pokemon_cards' | 'onepiece_cards',
  col: 'category' | 'card_type'
): [string, number][] {
  const rows = db
    .prepare(
      `SELECT d.${col} AS v, SUM(e.quantity) AS n FROM collection_entries e
       JOIN card_printings p ON p.id = e.printing_id AND +p.game = ${scope.game}
       JOIN ${table} d ON d.card_id = p.card_id
       WHERE ${scope.where('e')} GROUP BY d.${col}`
    )
    .all() as { v: string; n: number }[]
  return rows.map((r) => [r.v, r.n])
}

/** Owned copies per Pokémon category (Pokémon/Trainer/Energy): the Pokémon stand-in for frame types. */
const pokemonCategories = (db: SqlDb, scope: Scope): [string, number][] =>
  copiesBy(db, scope, 'pokemon_cards', 'category')

/** Owned copies per One Piece card type (Leader/Character/Event/…), the same way. */
const onePieceCardTypes = (db: SqlDb, scope: Scope): [string, number][] =>
  copiesBy(db, scope, 'onepiece_cards', 'card_type')

export function getStats(db: SqlDb, scope: Scope = LOCAL): CollectionStats {
  const entries = listEntries(db, { sort: 'value', dir: 'desc' }, scope)
  const cardIds = new Set<number>()
  const rarities = new Map<string, { count: number; value: number; unpriced: number }>()
  const frames = new Map<string, number>()
  let totalCards = 0
  let totalValue = 0
  let approximateCount = 0
  let unpricedCount = 0

  for (const e of entries) {
    totalCards += e.quantity
    totalValue += e.totalValue
    if (e.priceApproximate) approximateCount++
    // No price (eBay pending, no listings, service down): left out of the value, not counted as $0.
    if (e.unitPrice === null) unpricedCount += e.quantity
    cardIds.add(e.card.id)
    const r = rarities.get(e.printing.setRarity) ?? { count: 0, value: 0, unpriced: 0 }
    r.count += e.quantity
    r.value += e.totalValue
    if (e.unitPrice === null) r.unpriced += e.quantity
    rarities.set(e.printing.setRarity, r)
    frames.set(e.card.frameType, (frames.get(e.card.frameType) ?? 0) + e.quantity)
  }

  return {
    totalCards,
    uniqueCards: cardIds.size,
    totalValue,
    approximateCount,
    unpricedCount,
    byRarity: [...rarities]
      .map(([rarity, v]) => ({ rarity, ...v }))
      .sort((a, b) => b.value - a.value),
    // Thunks: byGame builds every value, and only the shown game's query should run.
    byFrameType: byGame<() => [string, number][]>(scopeGame(db, scope), {
      ygo: () => [...frames],
      pkm: () => pokemonCategories(db, scope),
      op: () => onePieceCardTypes(db, scope)
    })()
      .map(([frameType, count]) => ({ frameType, count }))
      .sort((a, b) => b.count - a.count),
    topEntries: entries.slice(0, TOP_ENTRY_LIMIT),
    // Stable sort: equal prices keep the higher total first.
    topSingles: [...entries]
      .sort((a, b) => (b.unitPrice ?? 0) - (a.unitPrice ?? 0))
      .slice(0, TOP_ENTRY_LIMIT),
    // By last change, not first add: an extra copy merges into the entry it matches and keeps
    // that entry's created_at, so a scan of a card already owned would never show here.
    recentEntries: [...entries]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
      .slice(0, RECENT_ENTRY_LIMIT),
    valueHistory: db
      .prepare(
        `SELECT date, total_value AS totalValue, total_cards AS totalCards FROM value_snapshots
         WHERE ${scope.snapshotTable.where} ORDER BY date`
      )
      .all() as ValuePoint[],
    pricesUpdatedAt: getMeta(db, 'last_sync_at')
  }
}

const pad = (n: number): string => String(n).padStart(2, '0')
/** A date as the device's local YYYY-MM-DD: the key value history is stored under. */
export const localDate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Upserts today's (local date) total value and card count. */
export function recordSnapshot(db: SqlDb, now = new Date(), scope: Scope = LOCAL): void {
  const { totalValue, totalCards } = getStats(db, scope)
  const { insertCols, insertVals } = scope.snapshotTable
  db.prepare(
    `INSERT INTO value_snapshots (${insertCols}date, total_value, total_cards) VALUES (${insertVals}?, ?, ?)
     ON CONFLICT(${insertCols}date) DO UPDATE SET total_value = excluded.total_value, total_cards = excluded.total_cards`
  ).run(localDate(now), totalValue, totalCards)
}
