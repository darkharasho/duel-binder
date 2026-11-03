import { deleteMeta, getMeta, setMeta } from '../db/meta'
import type { SqlDb } from '../db/sql'
import type { CloudClient } from './client'
import { priceCandidates } from '../prices/candidates'
import type { ContributedPrinting } from '../../shared/catalogFeed'
import type { UnsyncedEntry } from '../../shared/types'
import type { GameId } from '../../shared/games'
import type { BinderEditAction, BinderEditLevel } from '../../shared/binders'
import { isLanguage } from '../../shared/languages'
import {
  MAX_NOTES,
  editTime,
  keepsKey,
  replaces,
  type WireBinder,
  type WireBinderEdit,
  type WireEntry,
  type WireFavourite,
  type WirePrice,
  type WireWish
} from '../../shared/cloud'

/**
 * The desktop side of sync: per-owner SQL the sync engine drives. `owner` is a server user id (≥ 1);
 * owner 0 is this computer's never-signed-in collection. Nothing here goes through the repo write
 * functions, so rows written from the server are never marked dirty.
 */

/** The owner whose collection the app shows (meta `cloud_active_owner`), 0 when none. */
export function activeOwner(db: SqlDb): number {
  const v = getMeta(db, 'cloud_active_owner')
  return v === null ? 0 : Number(v)
}

export function setActiveOwner(db: SqlDb, owner: number): void {
  if (owner === 0) deleteMeta(db, 'cloud_active_owner')
  else setMeta(db, 'cloud_active_owner', String(owner))
}

/** Records the account (or its new display name), keeping its cursor. */
export function ensureAccount(db: SqlDb, owner: number, name: string): void {
  db.prepare(
    `INSERT INTO cloud_accounts (owner_id, name) VALUES (?, ?)
     ON CONFLICT(owner_id) DO UPDATE SET name = excluded.name`
  ).run(owner, name)
}

export function accountName(db: SqlDb, owner: number): string | null {
  const r = db.prepare('SELECT name FROM cloud_accounts WHERE owner_id = ?').get(owner) as
    { name: string } | undefined
  return r?.name ?? null
}

/** The account's pull cursor and last sync time; cursor 0 for an account not yet recorded. */
export function accountState(
  db: SqlDb,
  owner: number
): { cursor: number; syncedAt: string | null } {
  const r = db
    .prepare('SELECT cursor, synced_at FROM cloud_accounts WHERE owner_id = ?')
    .get(owner) as { cursor: number; synced_at: string | null } | undefined
  return { cursor: r ? Number(r.cursor) : 0, syncedAt: r?.synced_at ?? null }
}

/** Updates the given fields of the account, recording it (with no name yet) if `ensureAccount` hasn't. */
export function saveAccountState(
  db: SqlDb,
  owner: number,
  s: { cursor?: number; syncedAt?: string }
): void {
  db.prepare(
    `INSERT INTO cloud_accounts (owner_id, name, cursor, synced_at) VALUES (?, '', COALESCE(?, 0), ?)
     ON CONFLICT(owner_id) DO UPDATE SET cursor = COALESCE(?, cursor), synced_at = COALESCE(?, synced_at)`
  ).run(owner, s.cursor ?? null, s.syncedAt ?? null, s.cursor ?? null, s.syncedAt ?? null)
}

/** A per-game sync feed: the account's entries, wishlist, binders, binder edits or favourites, or the server's price changes. */
export type SyncStream =
  'entries' | 'prices' | 'wishlist' | 'binders' | 'binderEdits' | 'favourites'

const hasLegacyCursor = (game: GameId, stream: SyncStream): boolean =>
  game === 'ygo' && (stream === 'entries' || stream === 'prices')

/**
 * Where `owner` is in one game's feed. Yu-Gi-Oh! keeps its pre-games places (the account's cursor,
 * and this device's `price_feed_cursor`); every other game, and every game's newer feeds, have a
 * `cloud_game_cursors` row, 0 until its first pull.
 */
export function gameCursor(db: SqlDb, owner: number, game: GameId, stream: SyncStream): number {
  if (hasLegacyCursor(game, stream))
    return stream === 'entries'
      ? accountState(db, owner).cursor
      : Number(getMeta(db, 'price_feed_cursor') ?? 0)
  const r = db
    .prepare('SELECT cursor FROM cloud_game_cursors WHERE owner_id = ? AND game = ? AND stream = ?')
    .get(owner, game, stream) as { cursor: number } | undefined
  return r ? Number(r.cursor) : 0
}

export function saveGameCursor(
  db: SqlDb,
  owner: number,
  game: GameId,
  stream: SyncStream,
  cursor: number
): void {
  if (hasLegacyCursor(game, stream)) {
    if (stream === 'entries') saveAccountState(db, owner, { cursor })
    else setMeta(db, 'price_feed_cursor', String(cursor))
    return
  }
  db.prepare(
    `INSERT INTO cloud_game_cursors (owner_id, game, stream, cursor) VALUES (?, ?, ?, ?)
     ON CONFLICT(owner_id, game, stream) DO UPDATE SET cursor = excluded.cursor`
  ).run(owner, game, stream, cursor)
}

/** Whether this computer has never-signed-in entries, wishes, binders or favourites (owner 0), tombstones included. */
export function hasLocalData(db: SqlDb): boolean {
  return ['collection_entries', 'wishlist_entries', 'binders', 'binder_edits', 'favourites'].some(
    (table) => db.prepare(`SELECT 1 FROM ${table} WHERE owner_id = 0 LIMIT 1`).get() !== undefined
  )
}

/**
 * Moves the never-signed-in collection (owner 0) to `owner`, to be pushed; returns the entries moved.
 * Owner-0 rows exist only before the first sign-in ever, so the adopting owner has no local rows yet.
 */
export function adoptLocalData(db: SqlDb, owner: number): number {
  return db.transaction(() => {
    const moved = db
      .prepare('UPDATE collection_entries SET owner_id = ?, dirty = 1 WHERE owner_id = 0')
      .run(owner)
    // A day the owner already has a snapshot for keeps the owner's.
    db.prepare('UPDATE OR IGNORE value_snapshots SET owner_id = ? WHERE owner_id = 0').run(owner)
    db.prepare('DELETE FROM value_snapshots WHERE owner_id = 0').run()
    db.prepare(
      'UPDATE OR IGNORE wishlist_entries SET owner_id = ?, dirty = 1 WHERE owner_id = 0'
    ).run(owner)
    db.prepare('DELETE FROM wishlist_entries WHERE owner_id = 0').run()
    db.prepare('UPDATE OR IGNORE binders SET owner_id = ?, dirty = 1 WHERE owner_id = 0').run(owner)
    db.prepare('DELETE FROM binders WHERE owner_id = 0').run()
    db.prepare('UPDATE OR IGNORE binder_edits SET owner_id = ?, dirty = 1 WHERE owner_id = 0').run(
      owner
    )
    db.prepare('DELETE FROM binder_edits WHERE owner_id = 0').run()
    db.prepare('UPDATE OR IGNORE favourites SET owner_id = ?, dirty = 1 WHERE owner_id = 0').run(
      owner
    )
    db.prepare('DELETE FROM favourites WHERE owner_id = 0').run()
    return moved.changes
  })()
}

const OWNED_TABLES = [
  'collection_entries',
  'wishlist_entries',
  'binders',
  'binder_edits',
  'favourites',
  'value_snapshots',
  'sync_pending',
  'sync_issues'
]

/** Whether this computer holds any row of `owner` (an account the server has since merged away). */
export function hasOwnerRows(db: SqlDb, owner: number): boolean {
  return OWNED_TABLES.some(
    (table) =>
      db.prepare(`SELECT 1 FROM ${table} WHERE owner_id = ? LIMIT 1`).get(owner) !== undefined
  )
}

const holdKey = (from: number): `merge_hold:${number}` => `merge_hold:${from}`

/**
 * Carries the unsent changes of `from`, an account merged into `to`, over to `to`; returns the
 * collection rows carried. Nothing unsent is thrown away except collection deletions: an unsent
 * collection tombstone is dropped, since the merged account's own rows for that card stand.
 * - Collection: unsent live rows stay held under `from` (never pushed, never shown) until `to` has
 *   pulled the merge (`resolveMergeHolds`), so a carried count is compared with the merged one and
 *   never lowers it. Calling this again before then changes nothing.
 * - Wishes, favourites, binders and binder edits keep their keys, and replace `to`'s row on the same
 *   key. Their unsent tombstones move too, so a deletion still reaches the server.
 * Everything already sent is dropped, as is the old account's bookkeeping: the server's merged state
 * reaches this device through the normal cursor sync, and a stale row of `from` must never be pushed
 * over it.
 */
export function adoptMergedData(db: SqlDb, from: number, to: number, now: string): number {
  return db.transaction(() => {
    db.prepare(
      'DELETE FROM collection_entries WHERE owner_id = ? AND NOT (dirty = 1 AND deleted_at IS NULL)'
    ).run(from)
    const held = (
      db.prepare('SELECT COUNT(*) AS n FROM collection_entries WHERE owner_id = ?').get(from) as {
        n: number
      }
    ).n
    if (held > 0) setMeta(db, holdKey(from), String(to))
    for (const table of ['wishlist_entries', 'binders', 'binder_edits', 'favourites']) {
      db.prepare(
        `UPDATE OR REPLACE ${table} SET owner_id = ?, updated_at = ?, dirty = 1 WHERE owner_id = ? AND dirty = 1`
      ).run(to, now, from)
      db.prepare(`DELETE FROM ${table} WHERE owner_id = ?`).run(from)
    }
    for (const table of ['value_snapshots', 'sync_pending', 'sync_issues', 'cloud_accounts']) {
      db.prepare(`DELETE FROM ${table} WHERE owner_id = ?`).run(from)
    }
    db.prepare('DELETE FROM cloud_game_cursors WHERE owner_id = ?').run(from)
    return held
  })()
}

/** The merged-away accounts whose carried collection rows wait for a pull of `to`. */
export function mergeHolds(db: SqlDb, to: number): number[] {
  const rows = db
    .prepare("SELECT key FROM meta WHERE key LIKE 'merge_hold:%' AND value = ?")
    .all(String(to)) as { key: string }[]
  return rows.map((r) => Number(r.key.slice('merge_hold:'.length)))
}

/**
 * Lands the held collection rows of `froms` on `to`; returns the rows resolved. `froms` are holds of
 * `to` read before a pull of `to` began, so `to`'s local rows now include the merge. On a printing
 * and art `to` already has, the larger count is kept: a carried row raises the merged count, never
 * lowers it. A carried card `to` lacks gets a fresh uid (the old one belongs to the merge on the
 * server). Either way the change is stamped `now`, an edit made after the merge.
 */
export function resolveMergeHolds(db: SqlDb, to: number, froms: number[], now: string): number {
  return db.transaction(() => {
    const findOwn = db.prepare(
      `SELECT id, quantity FROM collection_entries
       WHERE owner_id = ? AND printing_id = ? AND image_id = ? AND deleted_at IS NULL`
    )
    const raise = db.prepare(
      'UPDATE collection_entries SET quantity = ?, notes = ?, updated_at = ?, dirty = 1 WHERE id = ?'
    )
    const dropRow = db.prepare('DELETE FROM collection_entries WHERE id = ?')
    const rekeyRow = db.prepare(
      'UPDATE collection_entries SET uid = ?, owner_id = ?, updated_at = ?, dirty = 1 WHERE id = ?'
    )
    let resolved = 0
    for (const from of froms) {
      if (getMeta(db, holdKey(from)) !== String(to)) continue
      const live = db
        .prepare(
          `SELECT id, printing_id, image_id, quantity, notes FROM collection_entries
           WHERE owner_id = ? AND dirty = 1 AND deleted_at IS NULL`
        )
        .all(from) as {
        id: number
        printing_id: number
        image_id: number
        quantity: number
        notes: string
      }[]
      for (const r of live) {
        const own = findOwn.get(to, r.printing_id, r.image_id) as
          { id: number; quantity: number } | undefined
        if (own) {
          if (r.quantity > own.quantity) raise.run(r.quantity, r.notes, now, own.id)
          dropRow.run(r.id)
        } else rekeyRow.run(crypto.randomUUID(), to, now, r.id)
      }
      db.prepare('DELETE FROM collection_entries WHERE owner_id = ?').run(from)
      deleteMeta(db, holdKey(from))
      resolved += live.length
    }
    return resolved
  })()
}

interface LocalRow {
  id: number
  uid: string
  owner_id: number
  printing_id: number
  image_id: number
  pkey: string
  quantity: number
  notes: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  dirty: number
}

const ROW_SELECT = `SELECT e.id, e.uid, e.owner_id, e.printing_id, e.image_id, p.pkey, e.quantity, e.notes,
  e.created_at, e.updated_at, e.deleted_at, e.dirty
  FROM collection_entries e JOIN card_printings p ON p.id = e.printing_id`

const toWire = (r: LocalRow): WireEntry => ({
  uid: r.uid,
  pkey: r.pkey,
  imageId: r.image_id,
  quantity: r.quantity,
  notes: r.notes.slice(0, MAX_NOTES),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at
})

/** Up to `limit` of the owner's unpushed rows, tombstones included, oldest first, leaving out `skip`. */
export function dirtyEntries(
  db: SqlDb,
  owner: number,
  limit: number,
  skip: ReadonlySet<string> = new Set()
): WireEntry[] {
  const rows = db
    .prepare(
      `${ROW_SELECT}
       WHERE e.owner_id = ? AND e.dirty = 1 AND e.uid NOT IN (SELECT value FROM json_each(?))
       ORDER BY e.id LIMIT ?`
    )
    .all(owner, JSON.stringify([...skip]), limit) as LocalRow[]
  return rows.map(toWire)
}

/** Marks a pushed row clean, unless it was edited again since `e` was read; a clean row has no sync issue. */
export function markPushed(db: SqlDb, e: WireEntry): void {
  const row = db.prepare('SELECT owner_id FROM collection_entries WHERE uid = ?').get(e.uid) as
    { owner_id: number } | undefined
  const r = db
    .prepare(
      'UPDATE collection_entries SET dirty = 0 WHERE uid = ? AND updated_at = ? AND deleted_at IS ?'
    )
    .run(e.uid, e.updatedAt, e.deletedAt)
  if (row && r.changes > 0) clearSyncIssue(db, row.owner_id, e.uid)
}

/**
 * Tombstones the pushed entry `e` at `ts`, clean, as the server did (a `merged` push). Like
 * `markPushed`, it leaves a row edited since `e` was read alone: still live and dirty.
 */
export function tombstoneClean(db: SqlDb, e: WireEntry, ts: string): void {
  db.prepare(
    `UPDATE collection_entries SET deleted_at = ?, updated_at = ?, dirty = 0
     WHERE uid = ? AND updated_at = ? AND deleted_at IS ?`
  ).run(ts, ts, e.uid, e.updatedAt, e.deletedAt)
}

const findPrinting = (db: SqlDb, e: WireEntry): number | undefined =>
  (
    db
      .prepare(
        `SELECT p.id FROM card_printings p JOIN card_images i ON i.card_id = p.card_id AND i.image_id = ?
         WHERE p.pkey = ?`
      )
      .get(e.imageId, e.pkey) as { id: number } | undefined
  )?.id

/** Keeps `e` for when the catalog has its printing, unless a newer copy is already waiting. */
function park(db: SqlDb, owner: number, e: WireEntry): void {
  const waiting = db
    .prepare('SELECT entry FROM sync_pending WHERE owner_id = ? AND uid = ?')
    .get(owner, e.uid) as { entry: string } | undefined
  if (waiting && !replaces(e, JSON.parse(waiting.entry) as WireEntry)) return
  db.prepare(
    `INSERT INTO sync_pending (owner_id, uid, pkey, entry, received_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(owner_id, uid) DO UPDATE SET pkey = excluded.pkey, entry = excluded.entry, received_at = excluded.received_at`
  ).run(owner, e.uid, e.pkey, JSON.stringify(e), new Date().toISOString())
}

/** `unchanged`: the local row is clean and already holds exactly this entry (e.g. the echo of our own push). */
export type ApplyResult = 'applied' | 'unchanged' | 'kept-local' | 'pending' | 'ignored'

const sameEntry = (x: WireEntry, y: WireEntry): boolean =>
  x.pkey === y.pkey &&
  x.imageId === y.imageId &&
  x.quantity === y.quantity &&
  x.notes === y.notes &&
  x.createdAt === y.createdAt &&
  x.updatedAt === y.updatedAt &&
  x.deletedAt === y.deletedAt

/**
 * Applies one server entry to `owner`'s rows, clean. A newer unpushed local edit of the same uid is
 * kept; a live-key collision follows `keepsKey`, tombstoning the loser at the incoming entry's edit
 * time as the server does. Entries on a printing the catalog lacks wait in sync_pending.
 */
export function applyRemote(db: SqlDb, owner: number, e: WireEntry): ApplyResult {
  return db.transaction((): ApplyResult => {
    const local = db.prepare(`${ROW_SELECT} WHERE e.uid = ?`).get(e.uid) as LocalRow | undefined
    if (local && local.owner_id !== owner) return 'ignored'
    if (!local && e.deletedAt !== null) return 'ignored'

    if (local && local.dirty === 0 && sameEntry(e, toWire(local))) {
      db.prepare('DELETE FROM sync_pending WHERE owner_id = ? AND uid = ?').run(owner, e.uid)
      return 'unchanged'
    }

    if (local && local.dirty === 1 && !replaces(e, toWire(local))) return 'kept-local'

    let printingId = findPrinting(db, e)
    let imageId = e.imageId
    if (printingId === undefined) {
      if (!(local && e.deletedAt !== null)) {
        park(db, owner, e)
        return 'pending'
      }
      // A delete needs no catalog: keep the row's own printing and art.
      printingId = local.printing_id
      imageId = local.image_id
    }

    const write = (deletedAt: string | null, updatedAt: string, dirty: number): void => {
      const fields = [
        owner,
        printingId,
        imageId,
        e.quantity,
        e.notes,
        e.createdAt,
        updatedAt,
        deletedAt,
        dirty
      ]
      if (local)
        // A delete may keep a printing this catalog has lost, so then the row keeps its game too.
        db.prepare(
          `UPDATE collection_entries SET owner_id = ?, printing_id = ?, image_id = ?, quantity = ?, notes = ?,
             created_at = ?, updated_at = ?, deleted_at = ?, dirty = ?,
             game = COALESCE((SELECT game FROM card_printings WHERE id = ?), game) WHERE uid = ?`
        ).run(...fields, printingId, e.uid)
      else
        db.prepare(
          `INSERT INTO collection_entries (owner_id, printing_id, image_id, quantity, notes, created_at, updated_at,
             deleted_at, dirty, uid, game) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             (SELECT game FROM card_printings WHERE id = ?))`
        ).run(...fields, e.uid, printingId)
      db.prepare('DELETE FROM sync_pending WHERE owner_id = ? AND uid = ?').run(owner, e.uid)
    }

    if (e.deletedAt === null) {
      const other = db
        .prepare(
          `${ROW_SELECT} WHERE e.owner_id = ? AND e.printing_id = ? AND e.image_id = ? AND e.deleted_at IS NULL
             AND e.uid <> ?`
        )
        .get(owner, printingId, imageId, e.uid) as LocalRow | undefined
      if (other) {
        const at = editTime(e)
        if (keepsKey(e, toWire(other))) {
          // The local row loses; it stays dirty so the server hears of the delete.
          db.prepare(
            'UPDATE collection_entries SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?'
          ).run(at, at, other.id)
        } else {
          // The remote loses. A uid held here (on another key) becomes the tombstone the server will make of it.
          if (local) write(at, at, 0)
          return 'ignored'
        }
      }
    }

    write(e.deletedAt, e.updatedAt, 0)
    return 'applied'
  })()
}

/**
 * Retries every owner's waiting entries against the current catalog. A waiting entry no newer than the
 * local row is dropped unapplied, so a late replay can't roll back a row the server has since updated.
 */
export function applyPending(db: SqlDb): { applied: number; remaining: number } {
  return db.transaction(() => {
    const rows = db
      .prepare('SELECT owner_id, uid, entry FROM sync_pending ORDER BY received_at, owner_id')
      .all() as {
      owner_id: number
      uid: string
      entry: string
    }[]
    let applied = 0
    const drop = db.prepare('DELETE FROM sync_pending WHERE owner_id = ? AND uid = ?')
    const byUid = db.prepare(`${ROW_SELECT} WHERE e.uid = ?`)
    for (const r of rows) {
      const e = JSON.parse(r.entry) as WireEntry
      const local = byUid.get(e.uid) as LocalRow | undefined
      if (local && !replaces(e, toWire(local))) {
        drop.run(r.owner_id, r.uid)
        continue
      }
      const result = applyRemote(db, r.owner_id, e)
      if (result === 'applied') applied++
      if (result !== 'pending') drop.run(r.owner_id, r.uid)
    }
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM sync_pending').get() as { n: number }
    return { applied, remaining: Number(n) }
  })()
}

export function pendingCount(db: SqlDb, owner: number): number {
  const { n } = db
    .prepare('SELECT COUNT(*) AS n FROM sync_pending WHERE owner_id = ?')
    .get(owner) as { n: number }
  return Number(n)
}

/** Gives an entry a fresh uid (the server said the old one belongs to another account); returns it. */
export function rekey(db: SqlDb, uid: string): string {
  const fresh = crypto.randomUUID()
  db.prepare('UPDATE collection_entries SET uid = ?, dirty = 1 WHERE uid = ?').run(fresh, uid)
  return fresh
}

export function dropEntry(db: SqlDb, uid: string): void {
  db.prepare('DELETE FROM collection_entries WHERE uid = ?').run(uid)
}

/** Deletes the owner's tombstones the server already has; returns how many. */
export function purgeCleanTombstones(db: SqlDb, owner: number): number {
  return db
    .prepare(
      'DELETE FROM collection_entries WHERE owner_id = ? AND deleted_at IS NOT NULL AND dirty = 0'
    )
    .run(owner).changes
}

interface WishRow {
  pkey: string
  game: GameId
  quantity: number | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  dirty: number
}

const wishToWire = (r: WishRow): WireWish => ({
  pkey: r.pkey,
  game: r.game,
  quantity: r.quantity,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at
})

const wishRow = (db: SqlDb, owner: number, pkey: string): WishRow | undefined =>
  db
    .prepare(
      `SELECT pkey, game, quantity, created_at, updated_at, deleted_at, dirty FROM wishlist_entries
       WHERE owner_id = ? AND pkey = ?`
    )
    .get(owner, pkey) as WishRow | undefined

/** Up to `limit` of the owner's unpushed wishlist rows, tombstones included, leaving out `skip`. */
export function dirtyWishes(
  db: SqlDb,
  owner: number,
  limit: number,
  skip: ReadonlySet<string>
): WireWish[] {
  const rows = db
    .prepare(
      `SELECT pkey, game, quantity, created_at, updated_at, deleted_at, dirty FROM wishlist_entries
       WHERE owner_id = ? AND dirty = 1 AND pkey NOT IN (SELECT value FROM json_each(?))
       ORDER BY updated_at, pkey LIMIT ?`
    )
    .all(owner, JSON.stringify([...skip]), limit) as WishRow[]
  return rows.map(wishToWire)
}

/** Marks a pushed wishlist row clean, unless it was edited again since `w` was read. */
export function markWishPushed(db: SqlDb, owner: number, w: WireWish): void {
  db.prepare(
    `UPDATE wishlist_entries SET dirty = 0
     WHERE owner_id = ? AND pkey = ? AND updated_at = ? AND deleted_at IS ?`
  ).run(owner, w.pkey, w.updatedAt, w.deletedAt)
}

/** Applies one server wishlist row, clean; a newer unpushed local edit is kept. Returns whether it wrote. */
export function applyRemoteWish(db: SqlDb, owner: number, w: WireWish): boolean {
  const local = wishRow(db, owner, w.pkey)
  if (!local && w.deletedAt !== null) return false
  if (local) {
    const same = JSON.stringify(wishToWire(local)) === JSON.stringify(wishToWire(toWishRow(w)))
    if (local.dirty === 0 && same) return false
    if (local.dirty === 1 && !replaces(w, wishToWire(local))) return false
  }
  db.prepare(
    `INSERT INTO wishlist_entries (owner_id, pkey, game, quantity, created_at, updated_at, deleted_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(owner_id, pkey) DO UPDATE SET game = excluded.game, quantity = excluded.quantity,
       created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
       dirty = 0`
  ).run(owner, w.pkey, w.game, w.quantity, w.createdAt, w.updatedAt, w.deletedAt)
  return true
}

const toWishRow = (w: WireWish): WishRow => ({
  pkey: w.pkey,
  game: w.game,
  quantity: w.quantity,
  created_at: w.createdAt,
  updated_at: w.updatedAt,
  deleted_at: w.deletedAt,
  dirty: 0
})

/** Deletes the owner's wishlist tombstones the server already has. */
export function purgeCleanWishes(db: SqlDb, owner: number): void {
  db.prepare(
    'DELETE FROM wishlist_entries WHERE owner_id = ? AND deleted_at IS NOT NULL AND dirty = 0'
  ).run(owner)
}

interface FavouriteRow {
  card_id: number
  game: GameId
  created_at: string
  updated_at: string
  deleted_at: string | null
  dirty: number
}

const FAVOURITE_COLS = 'card_id, game, created_at, updated_at, deleted_at, dirty'

const favouriteToWire = (r: FavouriteRow): WireFavourite => ({
  cardId: r.card_id,
  game: r.game,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at
})

/** Up to `limit` of the owner's unpushed favourites, tombstones included, leaving out the cards in `skip`. */
export function dirtyFavourites(
  db: SqlDb,
  owner: number,
  limit: number,
  skip: ReadonlySet<number>
): WireFavourite[] {
  const rows = db
    .prepare(
      `SELECT ${FAVOURITE_COLS} FROM favourites
       WHERE owner_id = ? AND dirty = 1 AND card_id NOT IN (SELECT value FROM json_each(?))
       ORDER BY updated_at, card_id LIMIT ?`
    )
    .all(owner, JSON.stringify([...skip]), limit) as FavouriteRow[]
  return rows.map(favouriteToWire)
}

/** Marks a pushed favourite clean, unless it was edited again since `f` was read. */
export function markFavouritePushed(db: SqlDb, owner: number, f: WireFavourite): void {
  db.prepare(
    `UPDATE favourites SET dirty = 0
     WHERE owner_id = ? AND card_id = ? AND updated_at = ? AND deleted_at IS ?`
  ).run(owner, f.cardId, f.updatedAt, f.deletedAt)
}

/** Applies one server favourite, clean; a newer unpushed local edit is kept. Returns whether it wrote. */
export function applyRemoteFavourite(db: SqlDb, owner: number, f: WireFavourite): boolean {
  const local = db
    .prepare(`SELECT ${FAVOURITE_COLS} FROM favourites WHERE owner_id = ? AND card_id = ?`)
    .get(owner, f.cardId) as FavouriteRow | undefined
  if (!local && f.deletedAt !== null) return false
  if (local) {
    const wire = favouriteToWire(local)
    const same =
      wire.game === f.game &&
      wire.createdAt === f.createdAt &&
      wire.updatedAt === f.updatedAt &&
      wire.deletedAt === f.deletedAt
    if (local.dirty === 0 && same) return false
    if (local.dirty === 1 && !replaces(f, wire)) return false
  }
  db.prepare(
    `INSERT INTO favourites (owner_id, card_id, game, created_at, updated_at, deleted_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(owner_id, card_id) DO UPDATE SET game = excluded.game,
       created_at = excluded.created_at, updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at, dirty = 0`
  ).run(owner, f.cardId, f.game, f.createdAt, f.updatedAt, f.deletedAt)
  return true
}

/** Deletes the owner's favourite tombstones the server already has. */
export function purgeCleanFavourites(db: SqlDb, owner: number): void {
  db.prepare(
    'DELETE FROM favourites WHERE owner_id = ? AND deleted_at IS NOT NULL AND dirty = 0'
  ).run(owner)
}

interface BinderRow {
  uid: string
  game: GameId
  name: string
  rules: string
  goal: string
  languages: string
  friends_visible: number
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  dirty: number
}

const BINDER_COLS = `uid, game, name, rules, goal, languages, friends_visible, sort_order, created_at,
  updated_at, deleted_at, dirty`

const binderToWire = (r: BinderRow): WireBinder => ({
  uid: r.uid,
  game: r.game,
  name: r.name,
  rules: r.rules,
  goal: r.goal,
  languages: r.languages,
  friendsVisible: r.friends_visible !== 0,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at
})

/** Whether two rows of one wire shape hold the same values, whatever order their keys came in. */
const sameFields = <T extends object>(x: T, y: T): boolean =>
  (Object.keys(x) as (keyof T)[]).every((k) => x[k] === y[k])

/** Up to `limit` of the owner's unpushed binders, tombstones included, leaving out the uids in `skip`. */
export function dirtyBinders(
  db: SqlDb,
  owner: number,
  limit: number,
  skip: ReadonlySet<string>
): WireBinder[] {
  const rows = db
    .prepare(
      `SELECT ${BINDER_COLS} FROM binders
       WHERE owner_id = ? AND dirty = 1 AND uid NOT IN (SELECT value FROM json_each(?))
       ORDER BY updated_at, uid LIMIT ?`
    )
    .all(owner, JSON.stringify([...skip]), limit) as BinderRow[]
  return rows.map(binderToWire)
}

/** Marks a pushed binder clean, unless it was edited again since `b` was read. */
export function markBinderPushed(db: SqlDb, owner: number, b: WireBinder): void {
  db.prepare(
    'UPDATE binders SET dirty = 0 WHERE owner_id = ? AND uid = ? AND updated_at = ? AND deleted_at IS ?'
  ).run(owner, b.uid, b.updatedAt, b.deletedAt)
}

/**
 * Applies one server binder, clean, keeping its rules, goal and languages as they came (a newer app's
 * may be unreadable here); a newer unpushed local edit is kept. Returns whether it wrote.
 */
export function applyRemoteBinder(db: SqlDb, owner: number, b: WireBinder): boolean {
  const local = db
    .prepare(`SELECT ${BINDER_COLS} FROM binders WHERE owner_id = ? AND uid = ?`)
    .get(owner, b.uid) as BinderRow | undefined
  if (!local && b.deletedAt !== null) return false
  if (local) {
    const wire = binderToWire(local)
    if (local.dirty === 0 && sameFields(wire, b)) return false
    if (local.dirty === 1 && !replaces(b, wire)) return false
  }
  db.prepare(
    `INSERT INTO binders (owner_id, uid, game, name, rules, goal, languages, friends_visible, sort_order,
                          created_at, updated_at, deleted_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(owner_id, uid) DO UPDATE SET game = excluded.game, name = excluded.name,
       rules = excluded.rules, goal = excluded.goal, languages = excluded.languages,
       friends_visible = excluded.friends_visible, sort_order = excluded.sort_order,
       created_at = excluded.created_at, updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at, dirty = 0`
  ).run(
    owner,
    b.uid,
    b.game,
    b.name,
    b.rules,
    b.goal,
    b.languages,
    b.friendsVisible ? 1 : 0,
    b.sortOrder,
    b.createdAt,
    b.updatedAt,
    b.deletedAt
  )
  return true
}

/** Deletes the owner's binder tombstones the server already has. */
export function purgeCleanBinders(db: SqlDb, owner: number): void {
  db.prepare('DELETE FROM binders WHERE owner_id = ? AND deleted_at IS NOT NULL AND dirty = 0').run(
    owner
  )
}

interface BinderEditRow {
  binder_uid: string
  level: BinderEditLevel
  target: string
  game: GameId
  action: BinderEditAction
  created_at: string
  updated_at: string
  deleted_at: string | null
  dirty: number
}

const EDIT_COLS =
  'binder_uid, level, target, game, action, created_at, updated_at, deleted_at, dirty'

const editToWire = (r: BinderEditRow): WireBinderEdit => ({
  binderUid: r.binder_uid,
  level: r.level,
  target: r.target,
  game: r.game,
  action: r.action,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at
})

/** Up to `limit` of the owner's unpushed binder edits, tombstones included, leaving out those whose binderEditKey is in `skip`. */
export function dirtyBinderEdits(
  db: SqlDb,
  owner: number,
  limit: number,
  skip: ReadonlySet<string>
): WireBinderEdit[] {
  const rows = db
    .prepare(
      `SELECT ${EDIT_COLS} FROM binder_edits
       WHERE owner_id = ? AND dirty = 1
         AND binder_uid || char(31) || level || char(31) || target NOT IN (SELECT value FROM json_each(?))
       ORDER BY updated_at, binder_uid, level, target LIMIT ?`
    )
    .all(owner, JSON.stringify([...skip]), limit) as BinderEditRow[]
  return rows.map(editToWire)
}

/** Marks a pushed binder edit clean, unless it was edited again since `e` was read. */
export function markBinderEditPushed(db: SqlDb, owner: number, e: WireBinderEdit): void {
  db.prepare(
    `UPDATE binder_edits SET dirty = 0
     WHERE owner_id = ? AND binder_uid = ? AND level = ? AND target = ? AND updated_at = ? AND deleted_at IS ?`
  ).run(owner, e.binderUid, e.level, e.target, e.updatedAt, e.deletedAt)
}

/**
 * Applies one server binder edit, clean; a newer unpushed local edit is kept. Returns whether it wrote.
 * An edit is stored whether or not its binder is here: the binder may be on its way, and this edit's
 * cursor won't come back to it. Reads only look at live binders' edits, so an orphan does nothing.
 */
export function applyRemoteBinderEdit(db: SqlDb, owner: number, e: WireBinderEdit): boolean {
  const local = db
    .prepare(
      `SELECT ${EDIT_COLS} FROM binder_edits
       WHERE owner_id = ? AND binder_uid = ? AND level = ? AND target = ?`
    )
    .get(owner, e.binderUid, e.level, e.target) as BinderEditRow | undefined
  if (!local && e.deletedAt !== null) return false
  if (local) {
    const wire = editToWire(local)
    if (local.dirty === 0 && sameFields(wire, e)) return false
    if (local.dirty === 1 && !replaces(e, wire)) return false
  }
  db.prepare(
    `INSERT INTO binder_edits (owner_id, binder_uid, level, target, game, action, created_at, updated_at,
                               deleted_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(owner_id, binder_uid, level, target) DO UPDATE SET game = excluded.game,
       action = excluded.action, created_at = excluded.created_at, updated_at = excluded.updated_at,
       deleted_at = excluded.deleted_at, dirty = 0`
  ).run(
    owner,
    e.binderUid,
    e.level,
    e.target,
    e.game,
    e.action,
    e.createdAt,
    e.updatedAt,
    e.deletedAt
  )
  return true
}

/** Deletes the owner's binder edit tombstones the server already has. */
export function purgeCleanBinderEdits(db: SqlDb, owner: number): void {
  db.prepare(
    'DELETE FROM binder_edits WHERE owner_id = ? AND deleted_at IS NOT NULL AND dirty = 0'
  ).run(owner)
}

/** Printing keys whose price is missing or stale, most needed first. */
export function stalePricePkeys(db: SqlDb, now: Date, limit: number): string[] {
  return priceCandidates(db, now, { limit }).map((c) => c.pkey)
}

/** Stores server prices for printings this computer knows, where fresher than the local price; a server null never erases a local price. Returns rows written. */
export function applyPrices(db: SqlDb, prices: WirePrice[]): number {
  const upsert = db.prepare(
    `INSERT INTO intl_prices (printing_id, price, listing_count, checked_at)
     SELECT p.id, ?, ?, ? FROM card_printings p WHERE p.pkey = ?
     ON CONFLICT(printing_id) DO UPDATE SET price = COALESCE(excluded.price, intl_prices.price),
       listing_count = CASE WHEN excluded.price IS NULL AND intl_prices.price IS NOT NULL
         THEN intl_prices.listing_count ELSE excluded.listing_count END,
       checked_at = excluded.checked_at
     WHERE julianday(excluded.checked_at) > julianday(intl_prices.checked_at)`
  )
  return db.transaction(() =>
    prices.reduce((n, p) => n + upsert.run(p.price, p.listingCount, p.checkedAt, p.pkey).changes, 0)
  )()
}

/**
 * Applies the server's price change feed of `game` from the saved cursor (see gameCursor), page by
 * page; each page and its cursor commit together. Returns rows written.
 */
export async function pullPriceChanges(
  db: SqlDb,
  client: Pick<CloudClient, 'priceChanges'>,
  owner = 0,
  game: GameId = 'ygo'
): Promise<number> {
  let cursor = gameCursor(db, owner, game, 'prices')
  let applied = 0
  for (;;) {
    const page = await client.priceChanges(cursor, game)
    db.transaction(() => {
      applied += applyPrices(db, page.prices)
      saveGameCursor(db, owner, game, 'prices', page.cursor)
    })()
    cursor = page.cursor
    if (!page.more || page.prices.length === 0) break
  }
  return applied
}

/** A printing to offer the server and the entries (uids) that sit on it. */
interface ContributionGroup {
  printing: ContributedPrinting
  pkey: string
  uids: string[]
}

/**
 * The owner's entries among `uids`, grouped by printing so each is offered once. `missing` holds uids
 * whose printing row isn't in this catalog (nothing to offer for them).
 */
export function contributionGroups(
  db: SqlDb,
  owner: number,
  uids: string[]
): { groups: ContributionGroup[]; missing: string[] } {
  const find = db.prepare(
    `SELECT p.id AS printing_id, p.pkey, p.card_id, p.set_name, p.set_code, p.set_rarity, p.set_rarity_code,
       p.language, p.variant, p.tcg_product_id
     FROM collection_entries e JOIN card_printings p ON p.id = e.printing_id
     WHERE e.owner_id = ? AND e.uid = ?`
  )
  const groups = new Map<number, ContributionGroup>()
  const missing: string[] = []
  for (const uid of uids) {
    const r = find.get(owner, uid) as
      | {
          printing_id: number
          pkey: string
          card_id: number
          set_name: string
          set_code: string
          set_rarity: string
          set_rarity_code: string | null
          language: string
          variant: string | null
          tcg_product_id: number | null
        }
      | undefined
    if (!r) {
      missing.push(uid)
      continue
    }
    const group = groups.get(r.printing_id)
    if (group) group.uids.push(uid)
    else
      groups.set(r.printing_id, {
        pkey: r.pkey,
        printing: {
          card_id: r.card_id,
          set_name: r.set_name,
          set_code: r.set_code,
          set_rarity: r.set_rarity,
          // The server rejects an omitted field, so an empty optional one is an explicit null.
          set_rarity_code: r.set_rarity_code || null,
          language: r.language,
          variant: r.variant || null,
          tcg_product_id: r.tcg_product_id ?? null
        },
        uids: [uid]
      })
  }
  return { groups: [...groups.values()], missing }
}

/** The distinct printings of the owner's entries `uids`, in the shape the server's contribute takes. */
export function printingsToContribute(
  db: SqlDb,
  owner: number,
  uids: string[]
): ContributedPrinting[] {
  return contributionGroups(db, owner, uids).groups.map((g) => g.printing)
}

/** Notes that an entry can't sync; an issue already recorded for the uid keeps its `since`. */
export function recordSyncIssue(
  db: SqlDb,
  owner: number,
  uid: string,
  pkey: string,
  reason: string,
  now: Date
): void {
  db.prepare(
    `INSERT INTO sync_issues (owner_id, uid, pkey, reason, since) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(owner_id, uid) DO UPDATE SET pkey = excluded.pkey, reason = excluded.reason`
  ).run(owner, uid, pkey, reason, now.toISOString())
}

export function clearSyncIssue(db: SqlDb, owner: number, uid: string): void {
  db.prepare('DELETE FROM sync_issues WHERE owner_id = ? AND uid = ?').run(owner, uid)
}

/** Forgets the owner's issues for uids not in `keep` (entries that synced, were removed or re-keyed). */
export function pruneSyncIssues(db: SqlDb, owner: number, keep: ReadonlySet<string>): void {
  db.prepare(
    'DELETE FROM sync_issues WHERE owner_id = ? AND uid NOT IN (SELECT value FROM json_each(?))'
  ).run(owner, JSON.stringify([...keep]))
}

export function syncIssueCount(db: SqlDb, owner: number): number {
  const { n } = db
    .prepare(
      `SELECT COUNT(*) AS n FROM sync_issues i
       JOIN collection_entries e ON e.uid = i.uid AND e.owner_id = i.owner_id AND e.deleted_at IS NULL
       WHERE i.owner_id = ?`
    )
    .get(owner) as { n: number }
  return Number(n)
}

/**
 * The owner's entries that can't sync, with what the user needs to recognise them, oldest issue
 * first. Lists every entry `syncIssueCount` counts: one whose printing (or card) row is missing
 * locally still shows, named through its image's card and with set details left blank.
 */
export function listSyncIssues(db: SqlDb, owner: number): UnsyncedEntry[] {
  const rows = db
    .prepare(
      `SELECT i.uid, COALESCE(c.name, ic.name, 'Unknown card') AS name,
              COALESCE(p.set_code, '') AS set_code, COALESCE(p.set_name, '') AS set_name,
              COALESCE(p.set_rarity, '') AS set_rarity, p.language, i.pkey, e.quantity, i.reason
       FROM sync_issues i
       JOIN collection_entries e ON e.uid = i.uid AND e.owner_id = i.owner_id AND e.deleted_at IS NULL
       LEFT JOIN card_printings p ON p.id = e.printing_id
       LEFT JOIN cards c ON c.id = p.card_id
       LEFT JOIN card_images im ON im.image_id = e.image_id
       LEFT JOIN cards ic ON ic.id = im.card_id
       WHERE i.owner_id = ?
       ORDER BY i.since, name, i.uid`
    )
    .all(owner) as {
    uid: string
    name: string
    set_code: string
    set_name: string
    set_rarity: string
    language: string | null
    pkey: string
    quantity: number
    reason: string
  }[]
  return rows.map((r) => {
    // With no printing row, the pkey's first part is still the language.
    const language = r.language ?? r.pkey.split('|')[0]
    return {
      uid: r.uid,
      name: r.name,
      setCode: r.set_code,
      setName: r.set_name,
      rarity: r.set_rarity,
      language: isLanguage(language) ? language : 'en',
      quantity: r.quantity,
      reason: r.reason
    }
  })
}
