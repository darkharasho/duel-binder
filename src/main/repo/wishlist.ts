import { getMeta } from '../db/meta'
import type { SqlDb } from '../db/sql'
import { MAX_WANTED } from '../../shared/cloud'
import type { CardWish, WishlistItem } from '../../shared/types'
import { rowToCard, rowToPrinting, type CardDbRow, type PrintingDbRow } from './cards'
import { CollectionError, cardPriceColumns, entryPrice } from './collection'
import { LOCAL, type Scope } from './scope'

/** SQL for the copies of a printing the scope's owner has; `p` is the printing. */
const ownedSql = (scope: Scope): string =>
  `(SELECT COALESCE(SUM(e.quantity), 0) FROM collection_entries e WHERE e.printing_id = p.id AND ${scope.where('e')})`

/**
 * The scope's wanted printings, newest first, priced by the same rules as a collection entry. A want
 * whose printing isn't in this catalog stays out until it is.
 */
export function listWishlist(db: SqlDb, scope: Scope = LOCAL): WishlistItem[] {
  const rows = db
    .prepare(
      `SELECT w.pkey AS w_pkey, w.quantity AS w_quantity, w.created_at AS w_created_at,
              ${ownedSql(scope)} AS w_owned,
              (SELECT i.image_id FROM card_images i WHERE i.card_id = c.id ORDER BY i.sort_order LIMIT 1) AS w_image_id,
              ${cardPriceColumns(scope)}
       FROM wishlist_entries w
       JOIN card_printings p ON p.pkey = w.pkey AND +p.game = ${scope.game}
       JOIN cards c ON c.id = p.card_id AND +c.game = ${scope.game}
       LEFT JOIN pokemon_cards pc ON pc.card_id = c.id
       LEFT JOIN intl_prices ip ON ip.printing_id = p.id
       WHERE ${scope.where('w')}
       ORDER BY w.created_at DESC, w.pkey`
    )
    .all() as Record<string, unknown>[]
  const status = getMeta(db, 'price_service_status')
  return rows.map((r) => {
    const card = rowToCard(r as unknown as CardDbRow)
    const printing = rowToPrinting({ ...(r as unknown as PrintingDbRow), id: r.p_id as number })
    const { unitPrice, priceApproximate } = entryPrice(r, card, printing, status)
    return {
      pkey: r.w_pkey as string,
      card,
      printing,
      imageId: Number(r.w_image_id ?? 0),
      printingScan: true,
      quantity: r.w_quantity as number | null,
      owned: Number(r.w_owned),
      unitPrice,
      priceApproximate,
      addedAt: r.w_created_at as string
    }
  })
}

/** The scope's wanted printings of one card. */
export function wishesForCard(db: SqlDb, cardId: number, scope: Scope = LOCAL): CardWish[] {
  const rows = db
    .prepare(
      `SELECT p.id, w.quantity FROM wishlist_entries w
       JOIN card_printings p ON p.pkey = w.pkey AND +p.game = ${scope.game}
       WHERE ${scope.where('w')} AND +p.card_id = ?`
    )
    .all(cardId) as { id: number; quantity: number | null }[]
  return rows.map((r) => ({ printingId: r.id, quantity: r.quantity }))
}

function printingOf(db: SqlDb, printingId: number, scope: Scope): { pkey: string; owned: number } {
  const row = db
    .prepare(
      `SELECT p.pkey, ${ownedSql(scope)} AS owned FROM card_printings p WHERE p.id = ? AND +p.game = ${scope.game}`
    )
    .get(printingId) as { pkey: string; owned: number } | undefined
  if (!row) throw new CollectionError(`Printing ${printingId} not found`)
  return { pkey: row.pkey, owned: Number(row.owned) }
}

/**
 * Wants a printing, `quantity` copies or (null) with no target. A target at or under the copies
 * owned would be met already, so it becomes one more than those.
 */
export function setWish(
  db: SqlDb,
  printingId: number,
  quantity: unknown,
  now = new Date(),
  scope: Scope = LOCAL
): void {
  if (
    quantity !== null &&
    (typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_WANTED)
  )
    throw new CollectionError(`Quantity must be empty or a whole number from 1 to ${MAX_WANTED}`)
  const { pkey, owned } = printingOf(db, printingId, scope)
  const wanted = quantity === null ? null : Math.min(Math.max(quantity, owned + 1), MAX_WANTED)
  const { ownerCol, owner, markerCol, marker, touch } = scope.wishlist
  const same = db
    .prepare(
      `SELECT 1 FROM wishlist_entries w WHERE w.pkey = ? AND w.quantity IS ? AND ${scope.where('w')}`
    )
    .get(pkey, wanted)
  if (same) return
  const ts = now.toISOString()
  db.prepare(
    `INSERT INTO wishlist_entries (${ownerCol}, pkey, game, quantity, created_at, updated_at, ${markerCol})
     VALUES (${owner}, ?, ${scope.game}, ?, ?, ?, ${marker})
     ON CONFLICT(${ownerCol}, pkey) DO UPDATE SET quantity = excluded.quantity, game = excluded.game,
       created_at = CASE WHEN deleted_at IS NULL THEN created_at ELSE excluded.created_at END,
       updated_at = excluded.updated_at, deleted_at = NULL, ${touch}`
  ).run(pkey, wanted, ts, ts)
}

/** Stops wanting a printing. A tombstone, so other devices hear of it. */
export function removeWish(
  db: SqlDb,
  printingId: number,
  now = new Date(),
  scope: Scope = LOCAL
): void {
  const { pkey } = printingOf(db, printingId, scope)
  const ts = now.toISOString()
  db.prepare(
    `UPDATE wishlist_entries AS w SET deleted_at = ?, updated_at = ?, ${scope.wishlist.touch}
     WHERE w.pkey = ? AND ${scope.where('w')}`
  ).run(ts, ts, pkey)
}

/**
 * Removes the wants whose target the collection has reached. A want with no target stays, marked
 * as owned, until the user removes it. Runs after a write that can add copies, and after a sync
 * brings in copies added elsewhere. Returns how many it removed.
 */
export function settleWishlist(db: SqlDb, scope: Scope = LOCAL, now = new Date()): number {
  const met = db
    .prepare(
      `SELECT w.pkey FROM wishlist_entries w
       WHERE w.quantity IS NOT NULL AND ${scope.where('w')} AND w.quantity <= (
         SELECT COALESCE(SUM(e.quantity), 0) FROM card_printings p
         JOIN collection_entries e ON e.printing_id = p.id
         WHERE p.pkey = w.pkey AND ${scope.where('e')})`
    )
    .all() as { pkey: string }[]
  if (met.length === 0) return 0
  const ts = now.toISOString()
  // One statement per row: the server's touch reads the next seq once per statement.
  const drop = db.prepare(
    `UPDATE wishlist_entries AS w SET deleted_at = ?, updated_at = ?, ${scope.wishlist.touch}
     WHERE w.pkey = ? AND ${scope.where('w')}`
  )
  db.transaction(() => {
    for (const { pkey } of met) drop.run(ts, ts, pkey)
  })()
  return met.length
}
