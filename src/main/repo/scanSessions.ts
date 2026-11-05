import type { SqlDb } from '../db/sql'
import type { GameId } from '../../shared/games'
import {
  MAX_SESSION_CARDS,
  MAX_SESSION_PKEY,
  type ScanSession,
  type ScanSessionCard
} from '../../shared/scanSessions'
import { CollectionError } from './collection'
import { LOCAL, type Scope } from './scope'
import { printingPrice } from './sets'

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const nullableText = (v: unknown): v is string | null => v === null || typeof v === 'string'
const nullableInt = (v: unknown): v is number | null => v === null || isInt(v)

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
      typeof c.pkey === 'string' &&
      c.pkey.length >= 1 &&
      c.pkey.length <= MAX_SESSION_PKEY &&
      nullableInt(c.printingId) &&
      isInt(c.imageId) &&
      nullableInt(c.photoId) &&
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
      pkey: c.pkey as string,
      printingId: c.printingId as number | null,
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

/**
 * Validates the cards the scanner records (printing ids of this catalog) and names each printing by
 * its pkey, the identity it syncs by. A card whose printing this catalog lacks is left out.
 */
export function sessionCardsOf(db: SqlDb, v: unknown): ScanSessionCard[] {
  if (!Array.isArray(v) || v.length === 0) return checkSessionCards(v)
  const pkeyOf = db.prepare('SELECT pkey FROM card_printings WHERE id = ?')
  const named = v.flatMap((raw, i) => {
    const c = (raw ?? {}) as Record<string, unknown>
    if (!isInt(c.printingId)) throw new CollectionError(`Invalid session card at position ${i + 1}`)
    const row = pkeyOf.get(c.printingId) as { pkey: string } | undefined
    return row ? [{ ...c, pkey: row.pkey }] : []
  })
  return named.length === 0 ? [] : checkSessionCards(named)
}

/** Whether two lists are the same cards in the same order (printing by pkey, image, added time). */
export function sameSessionCardList(a: ScanSessionCard[], b: ScanSessionCard[]): boolean {
  return (
    a.length === b.length &&
    a.every((c, i) => {
      const n = b[i]
      return c.pkey === n.pkey && c.imageId === n.imageId && c.addedAt === n.addedAt
    })
  )
}

/**
 * Combines a stored session's cards with an incoming copy of the same session: a price once set is
 * never changed, a stored null takes the incoming price. A session's cards never change otherwise,
 * so lists that differ in length or card identity (pkey, image, added time) keep the stored ones.
 * Printing ids aren't compared: each device has its own.
 */
export function mergeSessionCards(
  stored: ScanSessionCard[],
  incoming: ScanSessionCard[]
): ScanSessionCard[] {
  if (!sameSessionCardList(stored, incoming)) return stored
  return stored.map((c, i) => (c.price === null ? { ...c, price: incoming[i].price } : c))
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

/**
 * Gives each card this catalog's printing id for its pkey, and its photo when it had one. The
 * stored ids may be another device's, so they are never kept: a pkey this catalog lacks gets no
 * printing (null), and its art is the card's.
 */
export function localizeSessions<S extends { cards: ScanSessionCard[] }>(
  db: SqlDb,
  sessions: S[]
): S[] {
  const pkeys = [...new Set(sessions.flatMap((s) => s.cards.map((c) => c.pkey)))]
  const ids = new Map<string, number>()
  if (pkeys.length > 0) {
    const rows = db
      .prepare('SELECT pkey, id FROM card_printings WHERE pkey IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(pkeys)) as { pkey: string; id: number }[]
    for (const r of rows) ids.set(r.pkey, r.id)
  }
  return sessions.map((s) => ({
    ...s,
    cards: s.cards.map((c) => {
      const id = ids.get(c.pkey) ?? null
      return { ...c, printingId: id, photoId: c.photoId !== null ? id : null }
    })
  }))
}

/** The scope's live sessions of a game, newest first, with their cards as stored. */
function storedSessions(db: SqlDb, game: GameId, scope: Scope): ScanSession[] {
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

/** The scope's live sessions of a game, newest first, with this catalog's printing ids. */
export function listScanSessions(db: SqlDb, game: GameId, scope: Scope = LOCAL): ScanSession[] {
  return localizeSessions(db, storedSessions(db, game, scope))
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
 * Gives each unpriced card its printing's current price (found by pkey), once: a card that has a
 * price keeps it. A fill changes the cards only: the edit time stays, so it can never carry this
 * device's hidden or deleted state over a newer one from elsewhere (the sync merges cards whatever
 * the edit times). Returns how many sessions changed.
 */
export function fillScanSessionPrices(db: SqlDb, game: GameId, scope: Scope = LOCAL): number {
  const sessions = storedSessions(db, game, scope).filter((s) =>
    s.cards.some((c) => c.price === null)
  )
  if (sessions.length === 0) return 0
  const lookup = db.prepare(
    `SELECT ${printingPrice(scope)} AS price FROM card_printings p
     LEFT JOIN intl_prices ip ON ip.printing_id = p.id AND ${scope.ebayPrices}
     WHERE p.pkey = ?`
  )
  const cache = new Map<string, number | null>()
  const priceOf = (pkey: string): number | null => {
    if (!cache.has(pkey)) {
      const row = lookup.get(pkey) as { price: number | null } | undefined
      cache.set(pkey, row?.price ?? null)
    }
    return cache.get(pkey) ?? null
  }
  const { ownerCol, owner, touch } = scope.sessions
  const update = db.prepare(
    `UPDATE scan_sessions SET cards = ?, ${touch}
     WHERE ${ownerCol} = ${owner} AND uid = ? AND deleted_at IS NULL`
  )
  let changed = 0
  db.transaction(() => {
    for (const s of sessions) {
      let any = false
      const cards = s.cards.map((c) => {
        if (c.price !== null) return c
        const price = priceOf(c.pkey)
        if (price === null) return c
        any = true
        return { ...c, price }
      })
      if (!any) continue
      update.run(JSON.stringify(cards), s.uid)
      changed++
    }
  })()
  return changed
}
