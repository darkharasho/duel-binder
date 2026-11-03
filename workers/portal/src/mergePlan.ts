import type { SqlDb } from '../../../src/main/db/sql'
import type { CardChoice } from '../../../src/shared/account'

/** A live collection row, as the merge reads it. */
export interface EntryRow {
  id: number
  user_id: number
  uid: string
  printing_id: number
  image_id: number
  quantity: number
  notes: string
  created_at: string
  updated_at: string
}

/**
 * One change to the surviving account's cards: copy a closed account's row over, set a survivor
 * row's count (`fromUid` is the closed account's row it matched), or remove a survivor row.
 */
export type CardOp =
  | { kind: 'insert'; from: EntryRow }
  | { kind: 'update'; id: number; quantity: number; fromUid: string }
  | { kind: 'tombstone'; id: number }

/** One card: a printing in one art. Different arts or printings of a card never match. */
const keyOf = (e: EntryRow): string => `${e.printing_id}:${e.image_id}`

function liveEntries(db: SqlDb, userId: number): EntryRow[] {
  return db
    .prepare(
      `SELECT id, user_id, uid, printing_id, image_id, quantity, notes, created_at, updated_at
         FROM collection_entries WHERE user_id = ? AND deleted_at IS NULL ORDER BY id`
    )
    .all(userId) as EntryRow[]
}

/**
 * The changes to `survivor`'s cards that merge `closed`'s into them under `choice`, over both
 * accounts' live rows in every game, matched by (printing, art):
 * - `higher`: a card on both gets the larger count; one only `closed` has is copied over.
 * - `sum`: a card on both gets both counts added; one only `closed` has is copied over.
 * - `mine`: nothing changes.
 * - `theirs`: a card on both gets `closed`'s count, one only `closed` has is copied over, and one
 *   only `survivor` has is removed.
 */
export function planCardMerge(
  db: SqlDb,
  survivor: number,
  closed: number,
  choice: CardChoice
): CardOp[] {
  if (choice === 'mine') return []
  const mine = new Map(liveEntries(db, survivor).map((e) => [keyOf(e), e]))
  const ops: CardOp[] = []
  const matched = new Set<string>()
  for (const theirs of liveEntries(db, closed)) {
    const key = keyOf(theirs)
    const own = mine.get(key)
    if (!own) {
      ops.push({ kind: 'insert', from: theirs })
      continue
    }
    matched.add(key)
    const quantity =
      choice === 'higher'
        ? Math.max(own.quantity, theirs.quantity)
        : choice === 'sum'
          ? own.quantity + theirs.quantity
          : theirs.quantity
    if (quantity !== own.quantity)
      ops.push({ kind: 'update', id: own.id, quantity, fromUid: theirs.uid })
  }
  if (choice === 'theirs')
    for (const [key, own] of mine)
      if (!matched.has(key)) ops.push({ kind: 'tombstone', id: own.id })
  return ops
}

/** How many cards `survivor` has once `ops` (from planCardMerge) are applied. */
export function cardTotal(db: SqlDb, survivor: number, ops: CardOp[]): number {
  const counts = new Map(liveEntries(db, survivor).map((e) => [e.id, e.quantity]))
  let total = 0
  for (const n of counts.values()) total += n
  for (const op of ops) {
    if (op.kind === 'insert') total += op.from.quantity
    else if (op.kind === 'update') total += op.quantity - (counts.get(op.id) ?? 0)
    else total -= counts.get(op.id) ?? 0
  }
  return total
}
