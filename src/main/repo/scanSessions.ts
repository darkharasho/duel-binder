import type { SqlDb } from '../db/sql'
import type { GameId } from '../../shared/games'
import {
  MAX_SESSION_CARDS,
  type ScanSession,
  type ScanSessionCard
} from '../../shared/scanSessions'
import { CollectionError } from './collection'
import { LOCAL, type Scope } from './scope'
import { printingPrice } from './sets'

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const nullableText = (v: unknown): v is string | null => v === null || typeof v === 'string'

/** Validates a session's cards (a list from outside the app), throwing CollectionError on any problem. */
export function checkSessionCards(v: unknown): ScanSessionCard[] {
  if (!Array.isArray(v) || v.length === 0)
    throw new CollectionError('A session needs at least one card')
  if (v.length > MAX_SESSION_CARDS)
    throw new CollectionError(`A session holds at most ${MAX_SESSION_CARDS} cards`)
  return v.map((raw, i) => {
    const c = (raw ?? {}) as Record<string, unknown>
    const ok =
      isInt(c.cardId) &&
      isInt(c.printingId) &&
      isInt(c.imageId) &&
      (c.photoId === null || isInt(c.photoId)) &&
      typeof c.name === 'string' &&
      nullableText(c.setCode) &&
      nullableText(c.rarity) &&
      isInt(c.quantity) &&
      c.quantity >= 1 &&
      (c.price === null ||
        (typeof c.price === 'number' && Number.isFinite(c.price) && c.price >= 0)) &&
      typeof c.guess === 'boolean' &&
      typeof c.addedAt === 'number' &&
      Number.isFinite(c.addedAt)
    if (!ok) throw new CollectionError(`Invalid session card at position ${i + 1}`)
    return {
      cardId: c.cardId as number,
      printingId: c.printingId as number,
      imageId: c.imageId as number,
      photoId: c.photoId as number | null,
      name: c.name as string,
      setCode: c.setCode as string | null,
      rarity: c.rarity as string | null,
      quantity: c.quantity as number,
      price: c.price as number | null,
      guess: c.guess as boolean,
      addedAt: c.addedAt as number
    }
  })
}

/** Records one Add as a session, visible to friends. Does nothing for a uid already held or no cards. */
export function recordScanSession(
  db: SqlDb,
  s: { uid: string; game: GameId; cards: ScanSessionCard[] },
  scope: Scope = LOCAL
): void {
  if (s.cards.length === 0) return
  const now = new Date().toISOString()
  const { ownerCol, owner, markerCol, marker } = scope.sessions
  db.prepare(
    `INSERT INTO scan_sessions (${ownerCol}, uid, game, cards, friends_visible, created_at, updated_at, ${markerCol})
     VALUES (${owner}, ?, ?, ?, 1, ?, ?, ${marker})
     ON CONFLICT(${ownerCol}, uid) DO NOTHING`
  ).run(s.uid, s.game, JSON.stringify(s.cards), now, now)
}

interface SessionRow {
  uid: string
  game: GameId
  cards: string
  friends_visible: number
  created_at: string
  updated_at: string
}

/** The scope's live sessions of a game, newest first. */
export function listScanSessions(db: SqlDb, game: GameId, scope: Scope = LOCAL): ScanSession[] {
  const { ownerCol, owner } = scope.sessions
  const rows = db
    .prepare(
      `SELECT uid, game, cards, friends_visible, created_at, updated_at FROM scan_sessions
       WHERE ${ownerCol} = ${owner} AND game = ? AND deleted_at IS NULL
       ORDER BY created_at DESC, uid`
    )
    .all(game) as SessionRow[]
  return rows.map((r) => ({
    uid: r.uid,
    game: r.game,
    cards: JSON.parse(r.cards) as ScanSessionCard[],
    friendsVisible: r.friends_visible === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }))
}

/** Hides a session from friends (or shows it again). */
export function setScanSessionHidden(
  db: SqlDb,
  uid: string,
  hidden: boolean,
  scope: Scope = LOCAL
): void {
  const { ownerCol, owner, touch } = scope.sessions
  db.prepare(
    `UPDATE scan_sessions SET friends_visible = ?, updated_at = ?, ${touch}
     WHERE ${ownerCol} = ${owner} AND uid = ? AND deleted_at IS NULL`
  ).run(hidden ? 0 : 1, new Date().toISOString(), uid)
}

/** Deletes a session by tombstone, so the deletion can sync. */
export function deleteScanSession(db: SqlDb, uid: string, scope: Scope = LOCAL): void {
  const { ownerCol, owner, touch } = scope.sessions
  const now = new Date().toISOString()
  db.prepare(
    `UPDATE scan_sessions SET deleted_at = ?, updated_at = ?, ${touch}
     WHERE ${ownerCol} = ${owner} AND uid = ? AND deleted_at IS NULL`
  ).run(now, now, uid)
}

/**
 * Gives each unpriced card its printing's current price, once: a card that has a price keeps it.
 * Returns how many sessions changed.
 */
export function fillScanSessionPrices(db: SqlDb, game: GameId, scope: Scope = LOCAL): number {
  const sessions = listScanSessions(db, game, scope).filter((s) =>
    s.cards.some((c) => c.price === null)
  )
  if (sessions.length === 0) return 0
  const lookup = db.prepare(
    `SELECT ${printingPrice(scope)} AS price FROM card_printings p
     LEFT JOIN intl_prices ip ON ip.printing_id = p.id AND ${scope.ebayPrices}
     WHERE p.id = ?`
  )
  const cache = new Map<number, number | null>()
  const priceOf = (printingId: number): number | null => {
    if (!cache.has(printingId)) {
      const row = lookup.get(printingId) as { price: number | null } | undefined
      cache.set(printingId, row?.price ?? null)
    }
    return cache.get(printingId) ?? null
  }
  const { ownerCol, owner, touch } = scope.sessions
  const update = db.prepare(
    `UPDATE scan_sessions SET cards = ?, updated_at = ?, ${touch}
     WHERE ${ownerCol} = ${owner} AND uid = ? AND deleted_at IS NULL`
  )
  const now = new Date().toISOString()
  let changed = 0
  db.transaction(() => {
    for (const s of sessions) {
      let any = false
      const cards = s.cards.map((c) => {
        if (c.price !== null) return c
        const price = priceOf(c.printingId)
        if (price === null) return c
        any = true
        return { ...c, price }
      })
      if (!any) continue
      update.run(JSON.stringify(cards), now, s.uid)
      changed++
    }
  })()
  return changed
}
